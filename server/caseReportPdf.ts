import PDFDocument from "pdfkit";

import { Pool } from "pg";
import { getPgSslConfig } from "./dbSslConfig";

const PG_URL = process.env.DATABASE_URL ?? process.env.POSTGRES_URL ?? "postgresql://postgres:postgres@localhost:5432/ndsep_db";

export async function generateCaseReportPdf(caseId: number): Promise<Buffer> {
  const pool = new Pool({ connectionString: PG_URL, ssl: getPgSslConfig() });
  let caseData: any;
  try {
    const result = await pool.query(
      `SELECT ec.*, o.name AS org_name, o.sector AS org_sector, o.contact_email AS org_contact_email,
              fp.amount AS penalty_amount, fp.currency AS penalty_currency,
              fp.payment_status, fp.due_date, fp.violation_type,
              u.name AS officer_name
       FROM enforcement_cases ec
       LEFT JOIN organizations o ON o.id = ec.organization_id
       LEFT JOIN financial_penalties fp ON fp.id = ec.penalty_id
       LEFT JOIN "user" u ON u.id = ec.assigned_officer_id
       WHERE ec.id = $1`,
      [caseId]
    );
    caseData = result.rows[0];
  } finally {
    await pool.end();
  }

  if (!caseData) throw new Error(`Enforcement case #${caseId} not found`);

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 50 });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const green = "#1a6b3c";
    const darkGray = "#1a1a2e";
    const midGray = "#4a4a6a";
    const lightGray = "#f0f0f5";
    const red = "#c0392b";

    // ── Header Bar ──────────────────────────────────────────────────────────
    doc.rect(0, 0, doc.page.width, 80).fill(darkGray);
    doc.fillColor("#ffffff").fontSize(18).font("Helvetica-Bold")
       .text("NATIONAL DATA SOVEREIGNTY ENFORCEMENT PLATFORM", 50, 20, { width: 500 });
    doc.fontSize(9).font("Helvetica").fillColor("#aaaacc")
       .text("NITDA · Federal Republic of Nigeria · NDPR Enforcement Division", 50, 44);
    doc.fillColor("#ffffff").fontSize(10).font("Helvetica-Bold")
       .text("ENFORCEMENT CASE REPORT", 50, 58);

    // ── Case Reference Block ─────────────────────────────────────────────────
    doc.rect(0, 80, doc.page.width, 40).fill(green);
    doc.fillColor("#ffffff").fontSize(14).font("Helvetica-Bold")
       .text(`Case Reference: ${caseData.case_reference}`, 50, 90);
    const statusLabel = (caseData.status ?? "open").replace(/_/g, " ").toUpperCase();
    doc.fontSize(10).font("Helvetica")
       .text(`Status: ${statusLabel}`, 400, 90, { align: "right", width: 145 });

    let y = 140;

    // ── Section: Organisation Details ────────────────────────────────────────
    doc.fillColor(darkGray).fontSize(12).font("Helvetica-Bold")
       .text("ORGANISATION DETAILS", 50, y);
    y += 18;
    doc.moveTo(50, y).lineTo(545, y).strokeColor(green).lineWidth(1).stroke();
    y += 10;

    const orgFields = [
      ["Organisation Name", caseData.org_name ?? "—"],
      ["Sector", (caseData.org_sector ?? "—").replace(/_/g, " ")],
      ["Contact Email", caseData.org_contact_email ?? "—"],
    ];
    for (const [label, value] of orgFields) {
      doc.fillColor(midGray).fontSize(9).font("Helvetica").text(label + ":", 50, y, { width: 160 });
      doc.fillColor(darkGray).fontSize(9).font("Helvetica-Bold").text(String(value), 220, y);
      y += 16;
    }

    y += 10;

    // ── Section: Penalty Details ─────────────────────────────────────────────
    doc.fillColor(darkGray).fontSize(12).font("Helvetica-Bold").text("PENALTY DETAILS", 50, y);
    y += 18;
    doc.moveTo(50, y).lineTo(545, y).strokeColor(green).lineWidth(1).stroke();
    y += 10;

    const amount = caseData.penalty_amount
      ? `${caseData.penalty_currency ?? "NGN"} ${Number(caseData.penalty_amount).toLocaleString("en-NG")}`
      : "—";
    const dueDate = caseData.due_date
      ? new Date(caseData.due_date).toLocaleDateString("en-NG", { day: "2-digit", month: "long", year: "numeric" })
      : "—";

    const penaltyFields = [
      ["Penalty Amount", amount],
      ["Payment Status", (caseData.payment_status ?? "—").toUpperCase()],
      ["Due Date", dueDate],
      ["Violation Type", caseData.violation_type ?? "—"],
      ["Overdue Days", String(caseData.overdue_days ?? 0)],
    ];
    for (const [label, value] of penaltyFields) {
      doc.fillColor(midGray).fontSize(9).font("Helvetica").text(label + ":", 50, y, { width: 160 });
      const isOverdue = label === "Payment Status" && value.includes("OVERDUE");
      doc.fillColor(isOverdue ? red : darkGray).fontSize(9).font("Helvetica-Bold").text(String(value), 220, y);
      y += 16;
    }

    y += 10;

    // ── Section: Case Details ────────────────────────────────────────────────
    doc.fillColor(darkGray).fontSize(12).font("Helvetica-Bold").text("CASE DETAILS", 50, y);
    y += 18;
    doc.moveTo(50, y).lineTo(545, y).strokeColor(green).lineWidth(1).stroke();
    y += 10;

    const openedAt = caseData.opened_at
      ? new Date(caseData.opened_at).toLocaleDateString("en-NG", { day: "2-digit", month: "long", year: "numeric" })
      : "—";
    const escalatedAt = caseData.escalated_at
      ? new Date(caseData.escalated_at).toLocaleDateString("en-NG", { day: "2-digit", month: "long", year: "numeric" })
      : "—";

    const caseFields = [
      ["Assigned Officer", caseData.officer_name ?? "Unassigned"],
      ["Opened", openedAt],
      ["Escalated to NITDA", escalatedAt],
      ["NITDA Reference", caseData.nitda_reference_number ?? "Not yet assigned"],
    ];
    for (const [label, value] of caseFields) {
      doc.fillColor(midGray).fontSize(9).font("Helvetica").text(label + ":", 50, y, { width: 160 });
      doc.fillColor(darkGray).fontSize(9).font("Helvetica-Bold").text(String(value), 220, y);
      y += 16;
    }

    y += 10;

    // ── Section: Escalation Reason ───────────────────────────────────────────
    if (caseData.escalation_reason) {
      doc.fillColor(darkGray).fontSize(12).font("Helvetica-Bold").text("ESCALATION REASON", 50, y);
      y += 18;
      doc.moveTo(50, y).lineTo(545, y).strokeColor(green).lineWidth(1).stroke();
      y += 10;
      doc.rect(50, y, 495, 50).fill(lightGray);
      doc.fillColor(darkGray).fontSize(9).font("Helvetica")
         .text(caseData.escalation_reason, 58, y + 8, { width: 479 });
      y += 60;
    }

    // ── Section: Resolution Notes ─────────────────────────────────────────────
    if (caseData.resolution_notes) {
      y += 5;
      doc.fillColor(darkGray).fontSize(12).font("Helvetica-Bold").text("RESOLUTION NOTES", 50, y);
      y += 18;
      doc.moveTo(50, y).lineTo(545, y).strokeColor(green).lineWidth(1).stroke();
      y += 10;
      doc.rect(50, y, 495, 60).fill(lightGray);
      doc.fillColor(darkGray).fontSize(9).font("Helvetica")
         .text(caseData.resolution_notes, 58, y + 8, { width: 479 });
      y += 70;
    }

    // ── Status Timeline ───────────────────────────────────────────────────────
    y += 10;
    doc.fillColor(darkGray).fontSize(12).font("Helvetica-Bold").text("ENFORCEMENT TIMELINE", 50, y);
    y += 18;
    doc.moveTo(50, y).lineTo(545, y).strokeColor(green).lineWidth(1).stroke();
    y += 12;

    const statusOrder = ["open", "under_investigation", "notice_issued", "escalated_to_nitda", "settled"];
    const currentIdx = statusOrder.indexOf(caseData.status ?? "open");
    const stepW = 90;
    for (let i = 0; i < statusOrder.length; i++) {
      const sx = 50 + i * stepW;
      const done = i <= currentIdx;
      doc.rect(sx, y, stepW - 4, 22).fill(done ? green : lightGray);
      doc.fillColor(done ? "#ffffff" : midGray).fontSize(7).font("Helvetica-Bold")
         .text(statusOrder[i].replace(/_/g, " ").toUpperCase(), sx + 2, y + 7, { width: stepW - 8, align: "center" });
    }
    y += 35;

    // ── Footer ────────────────────────────────────────────────────────────────
    const footerY = doc.page.height - 60;
    doc.rect(0, footerY, doc.page.width, 60).fill(darkGray);
    doc.fillColor("#aaaacc").fontSize(8).font("Helvetica")
       .text(
         `Generated by NDSEP · ${new Date().toLocaleDateString("en-NG", { day: "2-digit", month: "long", year: "numeric" })} · CONFIDENTIAL — For regulatory use only`,
         50, footerY + 12, { width: 495, align: "center" }
       );
    doc.fillColor("#ffffff").fontSize(7).font("Helvetica")
       .text(
         "National Information Technology Development Agency (NITDA) · Abuja, Nigeria · NDPR 2019",
         50, footerY + 28, { width: 495, align: "center" }
       );

    doc.end();
  });
}
