export type StakeholderForm = { companyName: string; cacNumber: string; tinNumber: string; businessEmail: string; businessPhone: string; businessAddress: string; contactPerson: string };
export type StakeholderField = keyof StakeholderForm;
export type StakeholderErrors = Partial<Record<StakeholderField, string>>;

const CAC = /^(RC|BN|IT|LLP)?\s?\d{5,8}$/i;
const TIN = /^\d{8,14}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE = /^(?:\+234|234|0)(?:7[0-9]|8[0-9]|9[0-9])\d{8}$/;

export function validateStakeholderProfile(input: StakeholderForm): StakeholderErrors {
  const errors: StakeholderErrors = {};
  if (input.companyName.trim().length < 2) errors.companyName = "Enter the registered business name.";
  if (!CAC.test(input.cacNumber.replace(/[-/]/g, "").trim())) errors.cacNumber = "Enter a valid CAC/RC, BN, IT, or LLP registration number.";
  if (!TIN.test(input.tinNumber.replace(/\D/g, ""))) errors.tinNumber = "TIN must contain 8–14 digits.";
  if (!EMAIL.test(input.businessEmail.trim())) errors.businessEmail = "Enter a valid business email address.";
  if (!PHONE.test(input.businessPhone.replace(/[\s()-]/g, ""))) errors.businessPhone = "Enter a Nigerian mobile number, for example +2348012345678.";
  if (input.businessAddress.trim().length < 10) errors.businessAddress = "Enter the registered address (at least 10 characters).";
  if (input.contactPerson.trim().split(/\s+/).filter(Boolean).length < 2) errors.contactPerson = "Enter the contact person's first and last name.";
  return errors;
}
