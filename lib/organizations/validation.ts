import {
  EMAIL_MAX_LENGTH,
  PHONE_MAX_LENGTH,
  isValidEmail,
  isValidPhone,
  normalizeEmail,
  optionalText,
  tooLongMessage,
} from "@/lib/validation/fields";
import { charLength, trimText } from "@/lib/validation/text";

/**
 * Organization input validation. Runs on the server before calling the
 * database for friendly, per-field errors.
 *
 * `create_organization()` repeats these rules on purpose: the RPC can be
 * called directly through the Supabase API, bypassing this code. Keep both
 * in sync (supabase/migrations/20261104040000_align_organization_validation.sql).
 *
 * Trimming, lengths, email and phone use the shared rules in
 * lib/validation/ (docs/DECISIONS.md 014), the same as customers.
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
  email: EMAIL_MAX_LENGTH,
  phone: PHONE_MAX_LENGTH,
  address: 500,
  taxNumber: 100,
} as const;

export function currencyOptions(): string[] {
  return [...SUPPORTED_CURRENCIES];
}

export function timezoneOptions(): string[] {
  const zones = Intl.supportedValuesOf("timeZone");
  return zones.includes("UTC") ? zones : ["UTC", ...zones];
}

export function validateOrganizationInput(
  raw: OrganizationRawInput,
):
  | { ok: true; value: OrganizationInput }
  | { ok: false; fieldErrors: OrganizationFieldErrors } {
  const value: OrganizationInput = {
    name: trimText(raw.name),
    email: normalizeEmail(raw.email),
    phone: optionalText(raw.phone),
    address: optionalText(raw.address),
    currency: trimText(raw.currency).toUpperCase(),
    timezone: trimText(raw.timezone),
    taxNumber: optionalText(raw.taxNumber),
  };

  const errors: OrganizationFieldErrors = {};

  if (!value.name) errors.name = "Organization name is required.";
  else if (charLength(value.name) > LIMITS.name)
    errors.name = tooLongMessage(LIMITS.name);

  if (value.email && !isValidEmail(value.email))
    errors.email = "Please enter a valid email address.";

  if (value.phone && !isValidPhone(value.phone))
    errors.phone = "Please enter a valid phone number.";

  if (value.address && charLength(value.address) > LIMITS.address)
    errors.address = tooLongMessage(LIMITS.address);

  if (value.taxNumber && charLength(value.taxNumber) > LIMITS.taxNumber)
    errors.taxNumber = tooLongMessage(LIMITS.taxNumber);

  if (!currencyOptions().includes(value.currency))
    errors.currency = "Please choose a currency.";

  if (!timezoneOptions().includes(value.timezone))
    errors.timezone = "Please choose a time zone.";

  return Object.keys(errors).length
    ? { ok: false, fieldErrors: errors }
    : { ok: true, value };
}
