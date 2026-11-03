/**
 * Organization input validation. Runs on the server before calling the
 * database for friendly, per-field errors.
 *
 * `create_organization()` repeats these rules on purpose: the RPC can be
 * called directly through the Supabase API, bypassing this code. Keep both
 * in sync (supabase/migrations/20261104010000_harden_create_organization_validation.sql).
 */

export const DEFAULT_CURRENCY = "BDT";
export const DEFAULT_TIMEZONE = "Asia/Dhaka";

// Version 1 supported currencies (docs/DECISIONS.md 012). The database
// accepts exactly this list.
export const SUPPORTED_CURRENCIES = ["BDT", "USD", "EUR", "GBP", "INR"] as const;

export type OrganizationInput = {
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  currency: string;
  timezone: string;
  taxNumber: string | null;
};

export type OrganizationField = keyof OrganizationInput;
export type OrganizationRawInput = Record<OrganizationField, string>;
export type OrganizationFieldErrors = Partial<Record<OrganizationField, string>>;

// Keep in sync with the table check constraints and create_organization().
export const LIMITS = {
  name: 200,
  email: 320,
  phone: 50,
  address: 500,
  taxNumber: 100,
} as const;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Optional leading +, then digits, spaces, ( ) - and dots.
const PHONE_RE = /^\+?[0-9() .-]+$/;
const PHONE_MIN_DIGITS = 6;

export function currencyOptions(): string[] {
  return [...SUPPORTED_CURRENCIES];
}

export function timezoneOptions(): string[] {
  const zones = Intl.supportedValuesOf("timeZone");
  return zones.includes("UTC") ? zones : ["UTC", ...zones];
}

function optional(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

export function validateOrganizationInput(
  raw: OrganizationRawInput,
):
  | { ok: true; value: OrganizationInput }
  | { ok: false; fieldErrors: OrganizationFieldErrors } {
  const value: OrganizationInput = {
    name: raw.name.trim(),
    email: optional(raw.email)?.toLowerCase() ?? null,
    phone: optional(raw.phone),
    address: optional(raw.address),
    currency: raw.currency.trim().toUpperCase(),
    timezone: raw.timezone.trim(),
    taxNumber: optional(raw.taxNumber),
  };

  const errors: OrganizationFieldErrors = {};

  if (!value.name) errors.name = "Organization name is required.";
  else if (value.name.length > LIMITS.name)
    errors.name = `Use at most ${LIMITS.name} characters.`;

  if (value.email) {
    if (value.email.length > LIMITS.email || !EMAIL_RE.test(value.email))
      errors.email = "Please enter a valid email address.";
  }

  if (value.phone) {
    if (
      value.phone.length > LIMITS.phone ||
      !PHONE_RE.test(value.phone) ||
      value.phone.replace(/\D/g, "").length < PHONE_MIN_DIGITS
    )
      errors.phone = "Please enter a valid phone number.";
  }

  if (value.address && value.address.length > LIMITS.address)
    errors.address = `Use at most ${LIMITS.address} characters.`;

  if (value.taxNumber && value.taxNumber.length > LIMITS.taxNumber)
    errors.taxNumber = `Use at most ${LIMITS.taxNumber} characters.`;

  if (!currencyOptions().includes(value.currency))
    errors.currency = "Please choose a currency.";

  if (!timezoneOptions().includes(value.timezone))
    errors.timezone = "Please choose a time zone.";

  return Object.keys(errors).length
    ? { ok: false, fieldErrors: errors }
    : { ok: true, value };
}
