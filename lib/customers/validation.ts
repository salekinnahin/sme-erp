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
 * Customer input validation. Runs on the server for friendly, per-field
 * errors. The `customers` table CHECK constraints enforce the same rules for
 * every write path (supabase/migrations/20261104020000_customers.sql and
 * 20261104030000_harden_customer_validation.sql). Keep both in sync.
 *
 * Trimming and lengths use lib/validation/text.ts, so whitespace and
 * character counts match the database exactly (code points, not UTF-16).
 */

export const CUSTOMER_STATUSES = ["active", "inactive"] as const;
export type CustomerStatus = (typeof CUSTOMER_STATUSES)[number];

export function isCustomerStatus(value: unknown): value is CustomerStatus {
  return (CUSTOMER_STATUSES as readonly unknown[]).includes(value);
}

export const CUSTOMER_LIMITS = {
  name: 200,
  companyName: 200,
  phone: PHONE_MAX_LENGTH,
  email: EMAIL_MAX_LENGTH,
  address: 500,
  taxNumber: 100,
  notes: 2000,
} as const;

export type CustomerInput = {
  name: string;
  companyName: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  taxNumber: string | null;
  notes: string | null;
};

export type CustomerField = keyof CustomerInput;
export type CustomerRawInput = Record<CustomerField, string>;
export type CustomerFieldErrors = Partial<Record<CustomerField, string>>;

export const CUSTOMER_FIELDS: readonly CustomerField[] = [
  "name",
  "companyName",
  "phone",
  "email",
  "address",
  "taxNumber",
  "notes",
];

export function validateCustomerInput(
  raw: CustomerRawInput,
):
  | { ok: true; value: CustomerInput }
  | { ok: false; fieldErrors: CustomerFieldErrors } {
  const value: CustomerInput = {
    name: trimText(raw.name),
    companyName: optionalText(raw.companyName),
    phone: optionalText(raw.phone),
    email: normalizeEmail(raw.email),
    address: optionalText(raw.address),
    taxNumber: optionalText(raw.taxNumber),
    notes: optionalText(raw.notes),
  };

  const errors: CustomerFieldErrors = {};
  const L = CUSTOMER_LIMITS;

  if (!value.name) errors.name = "Customer name is required.";
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

export const CUSTOMER_PAGE_SIZE = 25;
export const CUSTOMER_SEARCH_MAX_LENGTH = 100;
const MAX_PAGE = 10_000;

export type CustomerStatusFilter = CustomerStatus | "all";

export type CustomerListParams = {
  search: string;
  status: CustomerStatusFilter;
  page: number;
};

type SearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

/** Parses untrusted query-string values into safe list parameters. */
export function parseCustomerListParams(params: SearchParams): CustomerListParams {
  const search = truncateChars(
    trimText(first(params.q)),
    CUSTOMER_SEARCH_MAX_LENGTH,
  );
  const statusRaw = first(params.status);
  const status: CustomerStatusFilter = isCustomerStatus(statusRaw)
    ? statusRaw
    : "all";
  const pageNum = Number.parseInt(first(params.page), 10);
  const page =
    Number.isFinite(pageNum) && pageNum >= 1 ? Math.min(pageNum, MAX_PAGE) : 1;
  return { search, status, page };
}
