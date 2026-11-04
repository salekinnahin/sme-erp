/**
 * Shared field rules for organizations and master-data modules (customers,
 * and later vendors and products). The database repeats these rules in
 * CHECK constraints and in create_organization(), so keep them in sync.
 *
 * Whitespace and length follow lib/validation/text.ts: one explicit
 * whitespace set and Unicode code-point counting, both matching the database.
 */

import { charLength, hasWhitespace, trimText } from "./text";

export const EMAIL_MAX_LENGTH = 320;
export const PHONE_MAX_LENGTH = 50;

// Whitespace is rejected separately (hasWhitespace), with the shared set.
const EMAIL_RE = /^[^@]+@[^@]+\.[^@]+$/;
// Optional leading +, then digits, spaces, ( ) - and dots.
const PHONE_RE = /^\+?[0-9() .-]+$/;
const PHONE_MIN_DIGITS = 6;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Trims a value. Empty strings become null. */
export function optionalText(value: string): string | null {
  const trimmed = trimText(value);
  return trimmed === "" ? null : trimmed;
}

/** Trims and lowercases an email. Empty strings become null. */
export function normalizeEmail(value: string): string | null {
  return optionalText(value)?.toLowerCase() ?? null;
}

/** Expects a normalized (trimmed, lowercase) email. */
export function isValidEmail(email: string): boolean {
  return (
    charLength(email) <= EMAIL_MAX_LENGTH &&
    !hasWhitespace(email) &&
    EMAIL_RE.test(email)
  );
}

/** Expects a trimmed phone number. Country-agnostic on purpose. */
export function isValidPhone(phone: string): boolean {
  return (
    charLength(phone) <= PHONE_MAX_LENGTH &&
    PHONE_RE.test(phone) &&
    phone.replace(/\D/g, "").length >= PHONE_MIN_DIGITS
  );
}

/** Error message for a text field over its code-point limit. */
export function tooLongMessage(limit: number): string {
  return `Use at most ${limit} characters.`;
}

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}
