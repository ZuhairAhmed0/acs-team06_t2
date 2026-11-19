/**
 * Canonical phone number normalization and validation.
 *
 * Rules:
 * - Trims leading and trailing whitespace.
 * - Removes non-digit formatting characters: spaces, hyphens, dots, parentheses.
 * - Preserves a single leading '+' sign if present.
 * - Validates international standard digit length: between 7 and 15 digits (ITU-T E.164).
 * - Never invents or assumes arbitrary country codes.
 *
 * Canonical examples:
 * - "+249912345678" -> "+249912345678"
 * - "0912345678"     -> "0912345678"
 * - "+249 (91) 234-5678" -> "+249912345678"
 */

export const MIN_PHONE_DIGITS = 7;
export const MAX_PHONE_DIGITS = 15;

export function normalizePhoneNumber(rawPhone: string): string {
  if (typeof rawPhone !== "string") {
    throw new Error("Phone number must be a string.");
  }

  const trimmed = rawPhone.trim();
  if (!trimmed) {
    throw new Error("Phone number cannot be empty.");
  }

  const hasLeadingPlus = trimmed.startsWith("+");
  const digitsOnly = trimmed.replace(/\D/g, "");

  if (digitsOnly.length < MIN_PHONE_DIGITS || digitsOnly.length > MAX_PHONE_DIGITS) {
    throw new Error(
      `Phone number must contain between ${MIN_PHONE_DIGITS} and ${MAX_PHONE_DIGITS} digits.`,
    );
  }

  return hasLeadingPlus ? `+${digitsOnly}` : digitsOnly;
}

export function isValidPhoneNumber(rawPhone: unknown): boolean {
  if (typeof rawPhone !== "string") {
    return false;
  }
  try {
    normalizePhoneNumber(rawPhone);
    return true;
  } catch {
    return false;
  }
}
