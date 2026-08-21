import PDFDocument from "pdfkit";

import { Pool } from "pg";
import { getPgSslConfig } from "./dbSslConfig";

const PG_URL =
  process.env.DATABASE_URL ??
  process.env.POSTGRES_URL ??
  "postgresql://postgres:postgres@localhost:5432/ndsep_db";

export async function generateNationalReportPdf(): Promise<Buffer> {
  const pool = new Pool({ connectionString: PG_URL, ssl: getPgSslConfig() });

  let orgs: Record<string, unknown>[] = [];
  let penalties: Record<string, unknown>[] = [];
  let cases: Record<string, unknown>[] = [];
  let stats: Record<string, unknown> = {};

  try {
    const [orgRes, penaltyRes, caseRes, statsRes] = await Promise.all([
      pool.query(`
        SELECT o.name, o.sector, o.compliance_status, o.compliance_score, o.risk_score,
               COUNT(DISTINCT a.id) AS asset_count,
               COUNT(DISTINCT cv.id) FILTER (WHERE cv.status = 'open') AS open_violations
        FROM organizations o
        LEFT JOIN assets a ON a.organization_id = o.id
        LEFT JOIN compliance_violations cv ON cv.organization_id = o.id
        GROUP BY o.id, o.name, o.sector, o.compliance_status, o.compliance_score, o.risk_score
        ORDER BY o.compliance_score ASC
        LIMIT 20
      `),
      pool.query(`
        SELECT fp.amount, fp.currency, fp.payment_status, fp.violation_type,
               o.name AS org_name
        FROM financial_penalties fp
        LEFT JOIN organizations o ON o.id = fp.organization_id
        ORDER BY fp.created_at DESC
        LIMIT 20
      `),
      pool.query(`
        SELECT ec.case_reference, ec.status, ec.escalation_reason, ec.nitda_reference_number,
               ec.overdue_days, o.name AS org_name
        FROM enforcement_cases ec
        LEFT JOIN organizations o ON o.id = ec.organization_id
        ORDER BY ec.opened_at DESC
        LIMIT 20
      `),
      pool.query(`
        SELECT
          (SELECT COUNT(*) FROM organizations) AS total_orgs,
          (SELECT COUNT(*) FROM organizations WHERE compliance_status = 'compliant') AS compliant_orgs,
          (SELECT ROUND(AVG(compliance_score)::numeric, 1) FROM organizations) AS avg_compliance,
          (SELECT COUNT(*) FROM financial_penalties WHERE payment_status IN ('pending', 'overdue')) AS open_penalties,
          (SELECT COALESCE(SUM(amount), 0) FROM financial_penalties) AS total_penalties_ngn,
          (SELECT COUNT(*) FROM enforcement_cases WHERE status NOT IN ('settled', 'closed')) AS open_cases,
          (SELECT COUNT(*) FROM enforcement_cases WHERE status = 'escalated_to_nitda') AS nitda_cases,
          (SELECT COUNT(*) FROM compliance_violations WHERE status = 'open') AS open_violations
      `),
    ]);
    orgs = orgRes.rows;
    penalties = penaltyRes.rows;
    cases = caseRes.rows;
    stats = statsRes.rows[0];
  } finally {
    await pool.end();
  }

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 50 });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const PAGE_W = doc.page.width - 100;
    const now = new Date();

    // ── Header ──────────────────────────────────────────────────────────────
    doc.rect(0, 0, doc.page.width, 90).fill("#0f172a");
    doc.fillColor("#22d3ee").fontSize(18).font("Helvetica-Bold")
      .text("NATIONAL DATA SOVEREIGNTY ENFORCEMENT PLATFORM", 50, 20, { width: PAGE_W });
    doc.fillColor("#94a3b8").fontSize(10).font("Helvetica")
      .text("National Enforcement Report — NITDA / Federal Ministry of Communications", 50, 46, { width: PAGE_W });
    doc.fillColor("#64748b").fontSize(8)
      .text(`Generated: ${now.toLocaleDateString("en-NG", { day: "2-digit", month: "long", year: "numeric" })} ${now.toLocaleTimeString("en-NG")}   |   CLASSIFICATION: OFFICIAL`, 50, 62, { width: PAGE_W });
    doc.fillColor("#1e293b").rect(0, 90, doc.page.width, 4).fill("#22d3ee");

    doc.y = 110;

    // ── Executive Summary ────────────────────────────────────────────────────
    doc.fillColor("#0f172a").fontSize(13).font("Helvetica-Bold")
      .text("1. EXECUTIVE SUMMARY", 50, doc.y);
    doc.moveDown(0.4);

    const totalOrgs = Number(stats.total_orgs ?? 0);
    const compliantOrgs = Number(stats.compliant_orgs ?? 0);
    const complianceRate = totalOrgs > 0
      ? ((compliantOrgs / totalOrgs) * 100).toFixed(1)
      : "0.0";

    const summaryLines = [
      `Total Registered Organisations: ${stats.total_orgs}`,
      `Compliant Organisations: ${stats.compliant_orgs} (${complianceRate}%)`,
      `National Average Compliance Score: ${stats.avg_compliance ?? "N/A"}`,
      `Open Compliance Violations: ${stats.open_violations}`,
      `Open Financial Penalties: ${stats.open_penalties}`,
      `Total Penalties Issued: ₦${Number(stats.total_penalties_ngn ?? 0).toLocaleString()}`,
      `Active Enforcement Cases: ${stats.open_cases}`,
      `Cases Escalated to NITDA: ${stats.nitda_cases}`,
    ];

    doc.fillColor("#1e293b").fontSize(9).font("Helvetica");
    summaryLines.forEach(line => {
      doc.text(`• ${line}`, 60, doc.y, { width: PAGE_W - 10 });
      doc.moveDown(0.25);
    });

    doc.moveDown(0.8);

    // ── Organisations Table ──────────────────────────────────────────────────
    doc.fillColor("#0f172a").fontSize(13).font("Helvetica-Bold")
      .text("2. ORGANISATION COMPLIANCE STATUS", 50, doc.y);
    doc.moveDown(0.4);

    const orgCols = [
      { label: "Organisation", width: 160 },
      { label: "Sector", width: 80 },
      { label: "Status", width: 80 },
      { label: "Score", width: 45 },
      { label: "Risk", width: 45 },
      { label: "Violations", width: 55 },
    ];

    // Table header
    let x = 50;
    doc.rect(50, doc.y, PAGE_W, 16).fill("#1e3a5f");
    doc.fillColor("#e2e8f0").fontSize(8).font("Helvetica-Bold");
    orgCols.forEach(col => {
      doc.text(col.label, x + 3, doc.y - 14, { width: col.width - 4 });
      x += col.width;
    });
    doc.moveDown(0.1);

    // Table rows
    orgs.forEach((org, i) => {
      if (doc.y > 700) { doc.addPage(); }
      const rowY = doc.y;
      const bg = i % 2 === 0 ? "#f8fafc" : "#ffffff";
      doc.rect(50, rowY, PAGE_W, 14).fill(bg);

      const statusColor: Record<string, string> = {
        compliant: "#15803d", non_compliant: "#b91c1c", under_review: "#b45309", suspended: "#7e22ce"
      };

      x = 50;
      doc.fillColor("#1e293b").fontSize(7.5).font("Helvetica");
      doc.text(String(org.name ?? "").substring(0, 28), x + 3, rowY + 2, { width: orgCols[0].width - 4 }); x += orgCols[0].width;
      doc.text(String(org.sector ?? "").substring(0, 12), x + 3, rowY + 2, { width: orgCols[1].width - 4 }); x += orgCols[1].width;
      doc.fillColor(statusColor[String(org.compliance_status ?? "")] ?? "#475569")
        .text(String(org.compliance_status ?? "").replace("_", " "), x + 3, rowY + 2, { width: orgCols[2].width - 4 }); x += orgCols[2].width;
      doc.fillColor("#1e293b")
        .text(Number(org.compliance_score ?? 0).toFixed(0), x + 3, rowY + 2, { width: orgCols[3].width - 4 }); x += orgCols[3].width;
      doc.fillColor(Number(org.risk_score) > 70 ? "#b91c1c" : Number(org.risk_score) > 50 ? "#b45309" : "#15803d")
        .text(Number(org.risk_score ?? 0).toFixed(1), x + 3, rowY + 2, { width: orgCols[4].width - 4 }); x += orgCols[4].width;
      doc.fillColor("#1e293b")
        .text(String(org.open_violations ?? 0), x + 3, rowY + 2, { width: orgCols[5].width - 4 });

      doc.y = rowY + 14;
    });

    doc.moveDown(1);

    // ── Enforcement Cases ────────────────────────────────────────────────────
    if (doc.y > 600) doc.addPage();
    doc.fillColor("#0f172a").fontSize(13).font("Helvetica-Bold")
      .text("3. ENFORCEMENT CASES", 50, doc.y);
    doc.moveDown(0.4);

    const caseCols = [
      { label: "Case Reference", width: 120 },
      { label: "Organisation", width: 140 },
      { label: "Status", width: 100 },
      { label: "NITDA Ref", width: 100 },
      { label: "Overdue Days", width: 55 },
    ];

    x = 50;
    doc.rect(50, doc.y, PAGE_W, 16).fill("#1e3a5f");
    doc.fillColor("#e2e8f0").fontSize(8).font("Helvetica-Bold");
    caseCols.forEach(col => {
      doc.text(col.label, x + 3, doc.y - 14, { width: col.width - 4 });
      x += col.width;
    });
    doc.moveDown(0.1);

    cases.forEach((c, i) => {
      if (doc.y > 700) doc.addPage();
      const rowY = doc.y;
      doc.rect(50, rowY, PAGE_W, 14).fill(i % 2 === 0 ? "#f8fafc" : "#ffffff");
      x = 50;
      doc.fillColor("#1e293b").fontSize(7.5).font("Helvetica-Bold")
        .text(String(c.case_reference ?? ""), x + 3, rowY + 2, { width: caseCols[0].width - 4 }); x += caseCols[0].width;
      doc.font("Helvetica")
        .text(String(c.org_name ?? "").substring(0, 22), x + 3, rowY + 2, { width: caseCols[1].width - 4 }); x += caseCols[1].width;
      doc.text(String(c.status ?? "").replace(/_/g, " "), x + 3, rowY + 2, { width: caseCols[2].width - 4 }); x += caseCols[2].width;
      doc.text(String(c.nitda_reference_number ?? "—"), x + 3, rowY + 2, { width: caseCols[3].width - 4 }); x += caseCols[3].width;
      doc.fillColor(Number(c.overdue_days) > 60 ? "#b91c1c" : "#1e293b")
        .text(String(c.overdue_days ?? 0) + "d", x + 3, rowY + 2, { width: caseCols[4].width - 4 });
      doc.y = rowY + 14;
    });

    doc.moveDown(1);

    // ── Financial Penalties ──────────────────────────────────────────────────
    if (doc.y > 600) doc.addPage();
    doc.fillColor("#0f172a").fontSize(13).font("Helvetica-Bold")
      .text("4. FINANCIAL PENALTIES", 50, doc.y);
    doc.moveDown(0.4);

    const penaltyCols = [
      { label: "Organisation", width: 160 },
      { label: "Amount (NGN)", width: 100 },
      { label: "Status", width: 80 },
      { label: "Violation Type", width: 120 },
      { label: "Currency", width: 55 },
    ];

    x = 50;
    doc.rect(50, doc.y, PAGE_W, 16).fill("#1e3a5f");
    doc.fillColor("#e2e8f0").fontSize(8).font("Helvetica-Bold");
    penaltyCols.forEach(col => {
      doc.text(col.label, x + 3, doc.y - 14, { width: col.width - 4 });
      x += col.width;
    });
    doc.moveDown(0.1);

    penalties.forEach((p, i) => {
      if (doc.y > 700) doc.addPage();
      const rowY = doc.y;
      doc.rect(50, rowY, PAGE_W, 14).fill(i % 2 === 0 ? "#f8fafc" : "#ffffff");
      x = 50;
      doc.fillColor("#1e293b").fontSize(7.5).font("Helvetica")
        .text(String(p.org_name ?? "").substring(0, 26), x + 3, rowY + 2, { width: penaltyCols[0].width - 4 }); x += penaltyCols[0].width;
      doc.text(`₦${Number(p.amount ?? 0).toLocaleString()}`, x + 3, rowY + 2, { width: penaltyCols[1].width - 4 }); x += penaltyCols[1].width;
      doc.fillColor(p.payment_status === "paid" ? "#15803d" : p.payment_status === "overdue" ? "#b91c1c" : "#b45309")
        .text(String(p.payment_status ?? ""), x + 3, rowY + 2, { width: penaltyCols[2].width - 4 }); x += penaltyCols[2].width;
      doc.fillColor("#1e293b")
        .text(String(p.violation_type ?? "").replace(/_/g, " ").substring(0, 20), x + 3, rowY + 2, { width: penaltyCols[3].width - 4 }); x += penaltyCols[3].width;
      doc.text(String(p.currency ?? "NGN"), x + 3, rowY + 2, { width: penaltyCols[4].width - 4 });
      doc.y = rowY + 14;
    });

    doc.moveDown(1.5);

    // ── Footer ───────────────────────────────────────────────────────────────
    if (doc.y > 680) doc.addPage();
    doc.rect(50, doc.y, PAGE_W, 1).fill("#cbd5e1");
    doc.moveDown(0.5);
    doc.fillColor("#64748b").fontSize(7.5).font("Helvetica")
      .text(
        `This report is generated by the National Data Sovereignty Enforcement Platform (NDSEP) and is intended for official use by NITDA and the Federal Ministry of Communications and Digital Economy. Classification: OFFICIAL. Generated: ${now.toISOString()}.`,
        50, doc.y, { width: PAGE_W }
      );

    doc.end();
  });
}
