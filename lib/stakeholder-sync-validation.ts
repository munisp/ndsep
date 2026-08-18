import { validateStakeholderProfile } from "./stakeholder-validation";
import type { EditableStakeholderPayload } from "./stakeholder-sync-queue";

export function validateDeadLetterEdit(edit: EditableStakeholderPayload): Record<string, string> {
  if (edit.kind === "profile") return validateStakeholderProfile({ companyName: edit.profile?.companyName ?? "", cacNumber: edit.profile?.cacNumber ?? "", tinNumber: edit.profile?.tinNumber ?? "", businessEmail: edit.profile?.businessEmail ?? "", businessPhone: edit.profile?.businessPhone ?? "", businessAddress: edit.profile?.businessAddress ?? "", contactPerson: edit.profile?.contactPerson ?? "" });
  const errors: Record<string, string> = {};
  if (!edit.document?.type.trim()) errors.type = "Document type is required.";
  if (!edit.document?.fileName.trim()) errors.fileName = "Original file name is required.";
  if (!edit.document?.mimeType.trim() || !edit.document.mimeType.includes("/")) errors.mimeType = "Enter a valid MIME type, such as application/pdf.";
  return errors;
}
