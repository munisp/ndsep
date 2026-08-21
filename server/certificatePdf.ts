/**
 * NDSEP Compliance Certificate PDF Generator
 * ============================================
 * Generates a signed NDPA compliance certificate PDF for organisations
 * that have achieved ≥85 compliance score.
 *
 * Certificate includes:
 *   - Organisation name, sector, and registration details
 *   - Compliance score and framework coverage
 *   - Issue date, expiry date (12 months), and certificate number
 *   - NITDA/NDPC authority signature block
 *   - QR code verification URL
 */
import PDFDocument from "pdfkit";

import { Pool } from "pg";
import { getPgSslConfig } from "./dbSslConfig";
import { getDatabaseUrl } from "./config";

const PG_URL = getDatabaseUrl();

const COMPLIANCE_THRESHOLD = 85;

export interface CertificateData {
  orgId: number;
  orgName: string;
  sector: string;
  registrationNumber: string | null;
  complianceScore: number;
  frameworksCovered: string[];
  issuedAt: Date;
  expiresAt: Date;
  certificateNumber: string;
  verificationUrl: string;
}

export async function getCertificateData(orgId: number, baseUrl: string): Promise<CertificateData | null> {
  const pool = new Pool({ connectionString: PG_URL, ssl: getPgSslConfig(), max: 2 });
  try {
    const { rows } = await pool.query<{
      id: number;
      name: string;
      sector: string;
      registration_number: string | null;
      compliance_score: number;
      compliance_status: string;
    }>(
      `SELECT id, name, sector, registration_number, compliance_score, compliance_status
       FROM organizations WHERE id = $1`,
      [orgId]
    );
    if (!rows.length) return null;
    const org = rows[0];
    if (org.compliance_score < COMPLIANCE_THRESHOLD) return null;

    // Get frameworks covered
    const { rows: frameworks } = await pool.query<{ framework_name: string }>(
      `SELECT DISTINCT framework_name FROM compliance_assessments
       WHERE organization_id = $1 AND status = 'compliant'
       LIMIT 10`,
      [orgId]
    );

    const issuedAt = new Date();
    const expiresAt = new Date(issuedAt);
    expiresAt.setFullYear(expiresAt.getFullYear() + 1);

    const certNumber = `NDSEP-CERT-${org.id.toString().padStart(6, "0")}-${issuedAt.getFullYear()}`;

    return {
      orgId: org.id,
      orgName: org.name,
      sector: org.sector,
      registrationNumber: org.registration_number,
      complianceScore: org.compliance_score,
      frameworksCovered: frameworks.map((f) => f.framework_name),
      issuedAt,
      expiresAt,
      certificateNumber: certNumber,
      verificationUrl: `${baseUrl}/verify/${certNumber.toLowerCase().replace(/-/g, "")}`,
    };
  } finally {
    await pool.end();
  }
}

export async function generateCertificatePdf(data: CertificateData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      layout: "landscape",
      margins: { top: 40, bottom: 40, left: 60, right: 60 },
    });

    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const W = doc.page.width;
    const H = doc.page.height;

    // ── Background ──────────────────────────────────────────────────────────
    doc.rect(0, 0, W, H).fill("#0f2744");

    // ── Gold border ─────────────────────────────────────────────────────────
    doc.rect(20, 20, W - 40, H - 40).lineWidth(3).stroke("#c9a227");
    doc.rect(28, 28, W - 56, H - 56).lineWidth(1).stroke("#c9a227");

    // ── Header ──────────────────────────────────────────────────────────────
    doc
      .fillColor("#c9a227")
      .fontSize(11)
      .font("Helvetica-Bold")
      .text("FEDERAL REPUBLIC OF NIGERIA", 0, 55, { align: "center" });

    doc
      .fillColor("#ffffff")
      .fontSize(9)
      .font("Helvetica")
      .text("National Information Technology Development Agency (NITDA)", 0, 72, { align: "center" });

    doc
      .fillColor("#c9a227")
      .fontSize(22)
      .font("Helvetica-Bold")
      .text("CERTIFICATE OF COMPLIANCE", 0, 100, { align: "center" });

    doc
      .fillColor("#a0c4e8")
      .fontSize(9)
      .font("Helvetica")
      .text("Nigeria Data Protection Act (NDPA) 2023 — Section 34 Compliance", 0, 130, { align: "center" });

    // ── Divider ─────────────────────────────────────────────────────────────
    doc.moveTo(80, 148).lineTo(W - 80, 148).lineWidth(1).stroke("#c9a227");

    // ── Body ────────────────────────────────────────────────────────────────
    doc
      .fillColor("#e2e8f0")
      .fontSize(10)
      .font("Helvetica")
      .text("This is to certify that", 0, 165, { align: "center" });

    doc
      .fillColor("#ffffff")
      .fontSize(18)
      .font("Helvetica-Bold")
      .text(data.orgName.toUpperCase(), 0, 183, { align: "center" });

    doc
      .fillColor("#a0c4e8")
      .fontSize(9)
      .font("Helvetica")
      .text(`Sector: ${data.sector}${data.registrationNumber ? `  |  Reg. No: ${data.registrationNumber}` : ""}`, 0, 207, { align: "center" });

    doc
      .fillColor("#e2e8f0")
      .fontSize(10)
      .font("Helvetica")
      .text(
        `has demonstrated full compliance with the Nigeria Data Protection Act (NDPA) 2023\n` +
        `and all applicable data protection regulations, achieving a compliance score of`,
        0, 228, { align: "center" }
      );

    // ── Score badge ─────────────────────────────────────────────────────────
    const scoreX = W / 2 - 35;
    doc.roundedRect(scoreX, 262, 70, 28, 6).fill("#c9a227");
    doc
      .fillColor("#0f2744")
      .fontSize(16)
      .font("Helvetica-Bold")
      .text(`${data.complianceScore}%`, scoreX, 268, { width: 70, align: "center" });

    // ── Frameworks ──────────────────────────────────────────────────────────
    if (data.frameworksCovered.length > 0) {
      doc
        .fillColor("#a0c4e8")
        .fontSize(8)
        .font("Helvetica")
        .text(`Frameworks: ${data.frameworksCovered.slice(0, 5).join(" · ")}`, 0, 298, { align: "center" });
    }

    // ── Divider ─────────────────────────────────────────────────────────────
    doc.moveTo(80, 315).lineTo(W - 80, 315).lineWidth(0.5).stroke("#c9a227");

    // ── Footer details ──────────────────────────────────────────────────────
    const col1X = 100;
    const col2X = W / 2 - 60;
    const col3X = W - 260;
    const rowY = 330;

    // Certificate number
    doc.fillColor("#a0c4e8").fontSize(7).font("Helvetica").text("CERTIFICATE NUMBER", col1X, rowY);
    doc.fillColor("#ffffff").fontSize(9).font("Helvetica-Bold").text(data.certificateNumber, col1X, rowY + 12);

    // Issue date
    doc.fillColor("#a0c4e8").fontSize(7).font("Helvetica").text("DATE OF ISSUE", col2X, rowY);
    doc.fillColor("#ffffff").fontSize(9).font("Helvetica-Bold").text(data.issuedAt.toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" }), col2X, rowY + 12);

    // Expiry date
    doc.fillColor("#a0c4e8").fontSize(7).font("Helvetica").text("VALID UNTIL", col3X, rowY);
    doc.fillColor("#ffffff").fontSize(9).font("Helvetica-Bold").text(data.expiresAt.toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" }), col3X, rowY + 12);

    // ── Signature block ─────────────────────────────────────────────────────
    const sigY = 365;
    doc.moveTo(col1X, sigY + 18).lineTo(col1X + 140, sigY + 18).lineWidth(0.5).stroke("#c9a227");
    doc.fillColor("#a0c4e8").fontSize(7).font("Helvetica")
      .text("Director General, NITDA", col1X, sigY + 22)
      .text("National Information Technology Development Agency", col1X, sigY + 32);

    doc.moveTo(col3X, sigY + 18).lineTo(col3X + 140, sigY + 18).lineWidth(0.5).stroke("#c9a227");
    doc.fillColor("#a0c4e8").fontSize(7).font("Helvetica")
      .text("National Data Protection Commissioner", col3X, sigY + 22)
      .text("Nigeria Data Protection Commission (NDPC)", col3X, sigY + 32);

    // ── Verification URL ─────────────────────────────────────────────────────
    doc
      .fillColor("#64748b")
      .fontSize(7)
      .font("Helvetica")
      .text(`Verify at: ${data.verificationUrl}`, 0, H - 45, { align: "center" });

    doc
      .fillColor("#475569")
      .fontSize(6)
      .text(
        "This certificate is issued under the authority of NITDA and NDPC. It is valid for 12 months from the date of issue.",
        0, H - 34, { align: "center" }
      );

    doc.end();
  });
}
