import PDFDocument from "pdfkit";
import type { Writable } from "stream";

export interface AuditReturnPdfData {
  year: number;
  generatedAt: string;
  jurisdiction: string;
  authority: string;
  reportingPeriod: string;
  breachIncidents: {
    total: number;
    resolved: number;
    notifiedOnTime: number;
    totalAffectedIndividuals: number;
    slaComplianceRate: number;
  };
  dpoAppointments: { total: number; verified: number };
  dpiaAssessments: { total: number; approved: number };
  consentManagement: { total: number; active: number; withdrawn: number };
  staffTraining: { total: number; completed: number };
  ropaRecords: { total: number };
  dataProcessingAgreements: { total: number; active: number };
  privacyNotices: { total: number; published: number };
  cookieConsent: { total: number };
}

/**
 * Generate NDPC-compliant Annual Audit Return PDF
 * Returns a Buffer containing the PDF
 */
export function generateAuditReturnPdf(data: AuditReturnPdfData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const doc = new PDFDocument({ size: "A4", margin: 50 });

    // Collect PDF chunks
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    // Header
    doc.fontSize(20).font("Helvetica-Bold").text("Annual Audit Return", { align: "center" });
    doc.moveDown(0.5);
    doc.fontSize(12).font("Helvetica").text(data.authority, { align: "center" });
    doc.fontSize(10).text(`Jurisdiction: ${data.jurisdiction}`, { align: "center" });
    doc.text(`Reporting Period: ${data.reportingPeriod}`, { align: "center" });
    doc.moveDown(1);

    // Metadata
    doc.fontSize(9).fillColor("#666").text(`Generated: ${new Date(data.generatedAt).toLocaleString("en-NG")}`, { align: "right" });
    doc.fillColor("#000");
    doc.moveDown(1);

    // Section: Breach Incidents
    addSection(doc, "1. Data Breach Incidents (NDPA S.47)");
    addRow(doc, "Total Incidents", data.breachIncidents.total);
    addRow(doc, "Resolved", data.breachIncidents.resolved);
    addRow(doc, "NDPC Notified On Time (72h SLA)", data.breachIncidents.notifiedOnTime);
    addRow(doc, "Total Affected Individuals", data.breachIncidents.totalAffectedIndividuals);
    addRow(doc, "SLA Compliance Rate", `${data.breachIncidents.slaComplianceRate}%`);
    doc.moveDown(1);

    // Section: DPO Appointments
    addSection(doc, "2. Data Protection Officer (DPO) Appointments (NDPA S.27)");
    addRow(doc, "Total Appointments", data.dpoAppointments.total);
    addRow(doc, "Verified Credentials", data.dpoAppointments.verified);
    doc.moveDown(1);

    // Section: DPIA
    addSection(doc, "3. Data Protection Impact Assessments (DPIA) (NDPA S.29)");
    addRow(doc, "Total Assessments", data.dpiaAssessments.total);
    addRow(doc, "Approved", data.dpiaAssessments.approved);
    doc.moveDown(1);

    // Section: Consent
    addSection(doc, "4. Consent Management (NDPA S.8)");
    addRow(doc, "Total Consent Records", data.consentManagement.total);
    addRow(doc, "Active Consents", data.consentManagement.active);
    addRow(doc, "Withdrawn", data.consentManagement.withdrawn);
    doc.moveDown(1);

    // Section: Staff Training
    addSection(doc, "5. Staff Training & Awareness (NDPA S.28)");
    addRow(doc, "Total Training Records", data.staffTraining.total);
    addRow(doc, "Completed", data.staffTraining.completed);
    doc.moveDown(1);

    // Section: ROPA
    addSection(doc, "6. Records of Processing Activities (ROPA) (NDPA S.26)");
    addRow(doc, "Total ROPA Records", data.ropaRecords.total);
    doc.moveDown(1);

    // Section: DPA
    addSection(doc, "7. Data Processing Agreements (DPA)");
    addRow(doc, "Total Agreements", data.dataProcessingAgreements.total);
    addRow(doc, "Active", data.dataProcessingAgreements.active);
    doc.moveDown(1);

    // Section: Privacy Notices
    addSection(doc, "8. Privacy Notices (NDPA S.9)");
    addRow(doc, "Total Notices", data.privacyNotices.total);
    addRow(doc, "Published", data.privacyNotices.published);
    doc.moveDown(1);

    // Section: Cookie Consent
    addSection(doc, "9. Cookie Consent Records");
    addRow(doc, "Total Records", data.cookieConsent.total);
    doc.moveDown(2);

    // Footer
    doc.fontSize(8).fillColor("#666").text(
      "This report is auto-generated from the National Data Sovereignty Enforcement Platform (NDSEP).",
      { align: "center" }
    );
    doc.text("For official submission, please review and sign before filing with NDPC.", { align: "center" });

    doc.end();
  });
}

function addSection(doc: PDFKit.PDFDocument, title: string) {
  doc.fontSize(12).font("Helvetica-Bold").fillColor("#2563eb").text(title);
  doc.fillColor("#000");
  doc.moveDown(0.5);
}

function addRow(doc: PDFKit.PDFDocument, label: string, value: string | number) {
  doc.fontSize(10).font("Helvetica");
  const y = doc.y;
  doc.text(label, 70, y, { width: 300, continued: false });
  doc.text(String(value), 400, y, { width: 150, align: "right" });
  doc.moveDown(0.3);
}
