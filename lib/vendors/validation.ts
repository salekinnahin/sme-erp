import {
  EMAIL_MAX_LENGTH,
  PHONE_MAX_LENGTH,
  isValidEmail,
  isValidPhone,
  normalizeEmail,
  optionalText,
  tooLongMessage as tooLong,
} from "@/lib/validation/fields";
import { charLength, trimText, truncateChars } from "@/lib/validation/text";

/**
 * Vendor input validation. Runs on the server for friendly, per-field
 * errors. The `vendors` table CHECK constraints enforce the same rules for
 * every write path (supabase/migrations/20261104050000_vendors.sql). Keep
 * both in sync.
 *
 * Trimming and lengths use lib/validation/text.ts, so whitespace and
 * character counts match the database exactly (code points, not UTF-16).
 */

export const VENDOR_STATUSES = ["active", "inactive"] as const;
export type VendorStatus = (typeof VENDOR_STATUSES)[number];

export function isVendorStatus(value: unknown): value is VendorStatus {
  return (VENDOR_STATUSES as readonly unknown[]).includes(value);
}

export const VENDOR_LIMITS = {
  name: 200,
  companyName: 200,
  phone: PHONE_MAX_LENGTH,
  email: EMAIL_MAX_LENGTH,
  address: 500,
  taxNumber: 100,
  notes: 2000,
} as const;

export type VendorInput = {
  name: string;
  companyName: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  taxNumber: string | null;
  notes: string | null;
};

export type VendorField = keyof VendorInput;
export type VendorRawInput = Record<VendorField, string>;
export type VendorFieldErrors = Partial<Record<VendorField, string>>;

export const VENDOR_FIELDS: readonly VendorField[] = [
  "name",
  "companyName",
  "phone",
  "email",
  "address",
  "taxNumber",
  "notes",
];

export function validateVendorInput(
  raw: VendorRawInput,
):
  | { ok: true; value: VendorInput }
  | { ok: false; fieldErrors: VendorFieldErrors } {
  const value: VendorInput = {
    name: trimText(raw.name),
    companyName: optionalText(raw.companyName),
    phone: optionalText(raw.phone),
    email: normalizeEmail(raw.email),
    address: optionalText(raw.address),
    taxNumber: optionalText(raw.taxNumber),
    notes: optionalText(raw.notes),
  };

  const errors: VendorFieldErrors = {};
  const L = VENDOR_LIMITS;

  if (!value.name) errors.name = "Vendor name is required.";
  else if (charLength(value.name) > L.name) errors.name = tooLong(L.name);

  if (value.companyName && charLength(value.companyName) > L.companyName)
    errors.companyName = tooLong(L.companyName);

  if (value.phone && !isValidPhone(value.phone))
    errors.phone = "Please enter a valid phone number.";

  if (value.email && !isValidEmail(value.email))
    errors.email = "Please enter a valid email address.";

  if (value.address && charLength(value.address) > L.address)
    errors.address = tooLong(L.address);

  if (value.taxNumber && charLength(value.taxNumber) > L.taxNumber)
    errors.taxNumber = tooLong(L.taxNumber);

  if (value.notes && charLength(value.notes) > L.notes)
    errors.notes = tooLong(L.notes);

  return Object.keys(errors).length
    ? { ok: false, fieldErrors: errors }
    : { ok: true, value };
}

// -----------------------------------------------------------------------------
// List parameters (from the URL query string)
// -----------------------------------------------------------------------------

export const VENDOR_PAGE_SIZE = 25;
export const VENDOR_SEARCH_MAX_LENGTH = 100;
const MAX_PAGE = 10_000;

export type VendorStatusFilter = VendorStatus | "all";

export type VendorListParams = {
  search: string;
  status: VendorStatusFilter;
  page: number;
};

type SearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

/** Parses untrusted query-string values into safe list parameters. */
export function parseVendorListParams(params: SearchParams): VendorListParams {
  const search = truncateChars(
    trimText(first(params.q)),
    VENDOR_SEARCH_MAX_LENGTH,
  );
  const statusRaw = first(params.status);
  const status: VendorStatusFilter = isVendorStatus(statusRaw)
    ? statusRaw
    : "all";
  const pageNum = Number.parseInt(first(params.page), 10);
  const page =
    Number.isFinite(pageNum) && pageNum >= 1 ? Math.min(pageNum, MAX_PAGE) : 1;
  return { search, status, page };
}
