/**
 * DPCO Invoice PDF Generator
 * Produces an NDPA-compliant invoice PDF using PDFKit.
 */
import PDFDocument from "pdfkit";

// ─── Types ────────────────────────────────────────────────────────────────────
export interface InvoicePdfData {
  invoiceNumber: string;
  issueDate: string;
  dueDate: string;
  paidAt?: string | null;
  status: string;
  dpcoOrgName: string;
  dpcoLicenceNumber: string;
  dpcoEmail?: string | null;
  clientName: string;
  clientEmail?: string | null;
  serviceType: string;
  description: string;
  subtotal: number;
  vatAmount: number;
  totalAmount: number;
  platformFeeRate: number;
  platformFeeAmount: number;
  dpcoNetAmount: number;
  currency: string;
  notes?: string | null;
  paymentReference?: string | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function formatNGN(n: number): string {
  return (
    "NGN " +
    n.toLocaleString("en-NG", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  );
}

function formatDate(d: string | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-NG", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

function serviceLabel(s: string): string {
  const map: Record<string, string> = {
    compliance_audit: "Compliance Audit",
    dpia_assessment: "DPIA Assessment",
    training_session: "Training Session",
    policy_drafting: "Policy & Contract Drafting",
    dpo_retainer: "DPO Retainer Service",
    retainer_monthly: "Monthly DPO Retainer",
    breach_support: "Breach Incident Support",
    due_diligence: "Due Diligence Assessment",
  };
  return map[s] ?? s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function statusColor(s: string): string {
  switch (s) {
    case "paid": return "#16a34a";
    case "overdue": return "#dc2626";
    case "sent": return "#2563eb";
    case "draft": return "#64748b";
    case "cancelled": return "#9ca3af";
    default: return "#374151";
  }
}

function addHRule(doc: PDFKit.PDFDocument, y?: number) {
  const yPos = y ?? doc.y;
  doc
    .moveTo(50, yPos)
    .lineTo(545, yPos)
    .strokeColor("#e2e8f0")
    .lineWidth(0.5)
    .stroke();
}

// ─── Generator ────────────────────────────────────────────────────────────────
export function generateInvoicePdf(data: InvoicePdfData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const doc = new PDFDocument({ size: "A4", margin: 50, info: {
      Title: `Invoice ${data.invoiceNumber}`,
      Author: data.dpcoOrgName,
      Subject: "NDPA Compliance Services Invoice",
    }});

    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    // ── Page background ───────────────────────────────────────────────────────
    doc.rect(0, 0, 595, 120).fill("#0f172a");

    // ── NDSEP branding ────────────────────────────────────────────────────────
    doc
      .fontSize(9)
      .font("Helvetica")
      .fillColor("#94a3b8")
      .text("NATIONAL DATA SOVEREIGNTY ENFORCEMENT PLATFORM", 50, 22, { align: "left" });

    doc
      .fontSize(22)
      .font("Helvetica-Bold")
      .fillColor("#f8fafc")
      .text("TAX INVOICE", 50, 38);

    // Invoice number top-right
    doc
      .fontSize(10)
      .font("Helvetica-Bold")
      .fillColor("#94a3b8")
      .text("INVOICE NO.", 380, 38);
    doc
      .fontSize(14)
      .font("Helvetica-Bold")
      .fillColor("#f8fafc")
      .text(data.invoiceNumber, 380, 54);

    // Status badge
    const sColor = statusColor(data.status);
    doc
      .roundedRect(380, 78, 80, 18, 4)
      .fill(sColor);
    doc
      .fontSize(9)
      .font("Helvetica-Bold")
      .fillColor("#ffffff")
      .text(data.status.toUpperCase(), 380, 82, { width: 80, align: "center" });

    // ── From / To ─────────────────────────────────────────────────────────────
    doc.fillColor("#000000");
    let y = 138;

    doc.fontSize(8).font("Helvetica-Bold").fillColor("#64748b").text("FROM", 50, y);
    doc.fontSize(8).font("Helvetica-Bold").fillColor("#64748b").text("TO", 300, y);
    y += 14;

    doc.fontSize(11).font("Helvetica-Bold").fillColor("#0f172a").text(data.dpcoOrgName, 50, y, { width: 230 });
    doc.fontSize(11).font("Helvetica-Bold").fillColor("#0f172a").text(data.clientName, 300, y, { width: 230 });
    y += 16;

    doc.fontSize(9).font("Helvetica").fillColor("#374151")
      .text(`Licence: ${data.dpcoLicenceNumber}`, 50, y, { width: 230 });
    if (data.clientEmail) {
      doc.fontSize(9).font("Helvetica").fillColor("#374151")
        .text(data.clientEmail, 300, y, { width: 230 });
    }
    y += 13;

    if (data.dpcoEmail) {
      doc.fontSize(9).font("Helvetica").fillColor("#374151")
        .text(data.dpcoEmail, 50, y, { width: 230 });
    }
    y += 20;

    addHRule(doc, y);
    y += 12;

    // ── Dates row ─────────────────────────────────────────────────────────────
    const dateFields = [
      { label: "Issue Date", value: formatDate(data.issueDate) },
      { label: "Due Date", value: formatDate(data.dueDate) },
      { label: "Paid Date", value: formatDate(data.paidAt) },
      { label: "Payment Ref", value: data.paymentReference ?? "—" },
    ];
    const colW = 120;
    dateFields.forEach((f, i) => {
      const x = 50 + i * colW;
      doc.fontSize(7).font("Helvetica-Bold").fillColor("#64748b").text(f.label.toUpperCase(), x, y, { width: colW });
      doc.fontSize(9).font("Helvetica").fillColor("#0f172a").text(f.value, x, y + 11, { width: colW });
    });
    y += 36;

    addHRule(doc, y);
    y += 12;

    // ── Service description ───────────────────────────────────────────────────
    doc.fontSize(8).font("Helvetica-Bold").fillColor("#64748b").text("SERVICE TYPE", 50, y);
    y += 12;
    doc.fontSize(10).font("Helvetica-Bold").fillColor("#0f172a").text(serviceLabel(data.serviceType), 50, y);
    y += 16;
    doc.fontSize(9).font("Helvetica").fillColor("#374151").text(data.description, 50, y, { width: 495 });
    y = doc.y + 16;

    // ── Line items table ──────────────────────────────────────────────────────
    // Header
    doc.rect(50, y, 495, 22).fill("#f1f5f9");
    doc.fontSize(8).font("Helvetica-Bold").fillColor("#374151");
    doc.text("DESCRIPTION", 58, y + 7, { width: 260 });
    doc.text("AMOUNT", 370, y + 7, { width: 80, align: "right" });
    doc.text("TOTAL", 460, y + 7, { width: 80, align: "right" });
    y += 22;

    // Row: Subtotal
    doc.rect(50, y, 495, 20).fill("#ffffff");
    doc.fontSize(9).font("Helvetica").fillColor("#0f172a");
    doc.text("Professional Services (excl. VAT)", 58, y + 5, { width: 260 });
    doc.text(formatNGN(data.subtotal), 370, y + 5, { width: 80, align: "right" });
    doc.text(formatNGN(data.subtotal), 460, y + 5, { width: 80, align: "right" });
    y += 20;

    // Row: VAT
    doc.rect(50, y, 495, 20).fill("#f8fafc");
    doc.fontSize(9).font("Helvetica").fillColor("#374151");
    doc.text("VAT (7.5%)", 58, y + 5, { width: 260 });
    doc.text(formatNGN(data.vatAmount), 370, y + 5, { width: 80, align: "right" });
    doc.text(formatNGN(data.vatAmount), 460, y + 5, { width: 80, align: "right" });
    y += 20;

    addHRule(doc, y);
    y += 8;

    // Total
    doc.fontSize(11).font("Helvetica-Bold").fillColor("#0f172a");
    doc.text("TOTAL DUE", 370, y, { width: 80, align: "right" });
    doc.text(formatNGN(data.totalAmount), 460, y, { width: 80, align: "right" });
    y += 24;

    // ── Revenue split (internal) ──────────────────────────────────────────────
    doc.rect(50, y, 495, 56).fill("#fafafa").stroke("#e2e8f0");
    doc.fontSize(8).font("Helvetica-Bold").fillColor("#64748b")
      .text("PLATFORM REVENUE SPLIT (INTERNAL)", 58, y + 8);
    doc.fontSize(9).font("Helvetica").fillColor("#374151");
    doc.text(
      `Platform fee (${(data.platformFeeRate * 100).toFixed(0)}%):  ${formatNGN(data.platformFeeAmount)}`,
      58, y + 22, { width: 230 }
    );
    doc.text(
      `DPCO net earnings:  ${formatNGN(data.dpcoNetAmount)}`,
      58, y + 36, { width: 230 }
    );
    doc.fontSize(8).font("Helvetica-Bold").fillColor("#0f172a")
      .text(`Currency: ${data.currency}`, 370, y + 36, { width: 170, align: "right" });
    y += 68;

    // ── Notes ─────────────────────────────────────────────────────────────────
    if (data.notes) {
      doc.fontSize(8).font("Helvetica-Bold").fillColor("#64748b").text("NOTES", 50, y);
      y += 12;
      doc.fontSize(9).font("Helvetica").fillColor("#374151").text(data.notes, 50, y, { width: 495 });
      y = doc.y + 16;
    }

    // ── Footer ────────────────────────────────────────────────────────────────
    const footerY = 760;
    addHRule(doc, footerY);
    doc.fontSize(7).font("Helvetica").fillColor("#94a3b8")
      .text(
        "This invoice is issued under the National Data Protection Act 2023 (NDPA). " +
        "The issuing DPCO is licensed by the Nigeria Data Protection Commission (NDPC). " +
        `Generated by NDSEP on ${new Date().toLocaleString("en-NG")}.`,
        50, footerY + 8, { width: 495, align: "center" }
      );

    doc.end();
  });
}
