import { calculateLine } from "./calculations";
import { parseDecimal, type DecimalFormat } from "@/lib/validation/decimal";
import { isUuid, optionalText, tooLongMessage as tooLong } from "@/lib/validation/fields";
import { charLength, trimText, truncateChars } from "@/lib/validation/text";

/**
 * Quotation input validation. Runs on the server for friendly, per-field and
 * per-item errors. The database re-validates everything in
 * create_quotation() / update_quotation_draft() and in CHECK constraints
 * (supabase/migrations/20261104090000_quotations.sql). Keep both in sync.
 *
 * Text uses lib/validation/text.ts (shared whitespace set, code points).
 * Quantities, prices, discounts and tax rates stay decimal strings end to
 * end (lib/validation/decimal.ts); they are never parsed into JavaScript
 * numbers.
 */

// -----------------------------------------------------------------------------
// Status model
// -----------------------------------------------------------------------------

export const QUOTATION_STATUSES = [
  "draft",
  "sent",
  "accepted",
  "rejected",
  "expired",
  "cancelled",
] as const;
export type QuotationStatus = (typeof QUOTATION_STATUSES)[number];

export function isQuotationStatus(value: unknown): value is QuotationStatus {
  return (QUOTATION_STATUSES as readonly unknown[]).includes(value);
}

export const QUOTATION_STATUS_LABELS: Record<QuotationStatus, string> = {
  draft: "Draft",
  sent: "Sent",
  accepted: "Accepted",
  rejected: "Rejected",
  expired: "Expired",
  cancelled: "Cancelled",
};

/**
 * Allowed V1 transitions. The SQL twin is
 * public.quotation_status_transition_allowed(). accepted, rejected, expired
 * and cancelled are terminal.
 */
export const QUOTATION_TRANSITIONS: Record<QuotationStatus, readonly QuotationStatus[]> = {
  draft: ["sent", "cancelled"],
  sent: ["accepted", "rejected", "expired", "cancelled"],
  accepted: [],
  rejected: [],
  expired: [],
  cancelled: [],
};

/** Statuses a quotation can be moved to (never back to draft). */
export type QuotationTargetStatus = Exclude<QuotationStatus, "draft">;

export function isTransitionAllowed(from: QuotationStatus, to: QuotationStatus): boolean {
  return QUOTATION_TRANSITIONS[from].includes(to);
}

export function isTerminalStatus(status: QuotationStatus): boolean {
  return QUOTATION_TRANSITIONS[status].length === 0;
}

// -----------------------------------------------------------------------------
// Limits and formats
// -----------------------------------------------------------------------------

export const QUOTATION_LIMITS = {
  notes: 2000,
  itemDescription: 2000,
  minItems: 1,
  maxItems: 100,
} as const;

/** numeric(18,3) */
export const QUANTITY_FORMAT: DecimalFormat = { integerDigits: 15, scale: 3 };
/** numeric(18,2) */
export const MONEY_FORMAT: DecimalFormat = { integerDigits: 16, scale: 2 };
/** numeric(5,2), at most 100 */
export const TAX_RATE_FORMAT: DecimalFormat = { integerDigits: 3, scale: 2 };

// -----------------------------------------------------------------------------
// Dates
// -----------------------------------------------------------------------------

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * A calendar date in ISO form (YYYY-MM-DD), as sent by <input type="date">.
 * Rejects impossible dates such as 2026-02-30. ISO strings compare correctly
 * as text, so callers can compare two valid dates with < and >.
 */
export function isValidDate(value: string): boolean {
  const match = DATE_RE.exec(value);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return day <= daysInMonth;
}

// -----------------------------------------------------------------------------
// Input
// -----------------------------------------------------------------------------

export type QuotationItemRawInput = {
  productId: string;
  /**
   * Missing (undefined) = use the product's description. A string (also
   * empty) = the user's own description; empty means none.
   */
  description?: string;
  quantity: string;
  /** Empty = use the product's current selling price. */
  unitPrice: string;
  /** Empty = 0. */
  discountAmount: string;
  /** Percent, empty = 0. */
  taxRate: string;
};

export type QuotationRawInput = {
  customerId: string;
  quotationDate: string;
  /** Empty = no expiry date. */
  expiryDate: string;
  notes: string;
  items: QuotationItemRawInput[];
};

export type QuotationItemInput = {
  productId: string;
  /** undefined = the product's description; null = no description. */
  description: string | null | undefined;
  /** Canonical decimal strings. */
  quantity: string;
  /** null = the product's current selling price. */
  unitPrice: string | null;
  discountAmount: string;
  taxRate: string;
};

export type QuotationInput = {
  customerId: string;
  quotationDate: string;
  expiryDate: string | null;
  notes: string | null;
  items: QuotationItemInput[];
};

export type QuotationField = "customerId" | "quotationDate" | "expiryDate" | "notes" | "items";
export type QuotationItemField =
  | "productId"
  | "description"
  | "quantity"
  | "unitPrice"
  | "discountAmount"
  | "taxRate";

export type QuotationFieldErrors = Partial<Record<QuotationField, string>>;
export type QuotationItemErrors = Partial<Record<QuotationItemField, string>>;

export type QuotationValidationErrors = {
  fieldErrors: QuotationFieldErrors;
  /** Same index as the input items; undefined for items without errors. */
  itemErrors: (QuotationItemErrors | undefined)[];
};

export type QuotationValidationResult =
  | { ok: true; value: QuotationInput }
  | ({ ok: false } & QuotationValidationErrors);

function decimalError(
  error: "format" | "scale" | "too_large",
  what: string,
  scale: number,
): string {
  switch (error) {
    case "format":
      return `Enter ${what} using digits and a decimal point (e.g. 1250.50).`;
    case "scale":
      return `Use at most ${scale} decimal places.`;
    case "too_large":
      return "This number is too large.";
  }
}

export const DISCOUNT_EXCEEDS_GROSS_MESSAGE =
  "The discount cannot be more than quantity × unit price.";
export const LINE_TOO_LARGE_MESSAGE = "This line amount is too large.";

/** Item errors for a failed line calculation. */
export function lineAmountErrors(
  error: "discount_exceeds_gross" | "too_large",
): QuotationItemErrors {
  return error === "discount_exceeds_gross"
    ? { discountAmount: DISCOUNT_EXCEEDS_GROSS_MESSAGE }
    : { unitPrice: LINE_TOO_LARGE_MESSAGE };
}

/** Validates and normalizes one item. */
export function validateQuotationItem(
  raw: QuotationItemRawInput,
): { ok: true; value: QuotationItemInput } | { ok: false; errors: QuotationItemErrors } {
  const errors: QuotationItemErrors = {};

  const productId = trimText(raw.productId);
  if (!productId) errors.productId = "Choose a product or service.";
  else if (!isUuid(productId)) errors.productId = "Choose a product or service from the list.";

  let description: string | null | undefined;
  if (raw.description !== undefined) {
    description = optionalText(raw.description);
    if (description && charLength(description) > QUOTATION_LIMITS.itemDescription)
      errors.description = tooLong(QUOTATION_LIMITS.itemDescription);
  }

  let quantity = "";
  const quantityText = trimText(raw.quantity);
  if (!quantityText) errors.quantity = "Quantity is required.";
  else {
    const parsed = parseDecimal(quantityText, QUANTITY_FORMAT);
    if (!parsed.ok)
      errors.quantity = decimalError(parsed.error, "a quantity", QUANTITY_FORMAT.scale);
    else if (/^[0.]+$/.test(parsed.value)) errors.quantity = "Quantity must be more than 0.";
    else quantity = parsed.value;
  }

  let unitPrice: string | null = null;
  const priceText = trimText(raw.unitPrice);
  if (priceText) {
    const parsed = parseDecimal(priceText, MONEY_FORMAT);
    if (parsed.ok) unitPrice = parsed.value;
    else errors.unitPrice = decimalError(parsed.error, "a price of 0 or more", MONEY_FORMAT.scale);
  }

  let discountAmount = "0";
  const discountText = trimText(raw.discountAmount);
  if (discountText) {
    const parsed = parseDecimal(discountText, MONEY_FORMAT);
    if (parsed.ok) discountAmount = parsed.value;
    else
      errors.discountAmount = decimalError(
        parsed.error,
        "a discount of 0 or more",
        MONEY_FORMAT.scale,
      );
  }

  let taxRate = "0";
  const taxText = trimText(raw.taxRate);
  if (taxText) {
    const parsed = parseDecimal(taxText, TAX_RATE_FORMAT);
    if (!parsed.ok || !isTaxRateInRange(parsed.value))
      errors.taxRate = "Enter a tax rate from 0 to 100 with at most 2 decimal places.";
    else taxRate = parsed.value;
  }

  // Amount checks need the unit price. When it comes from the product, the
  // domain function repeats them after loading the product.
  if (!Object.keys(errors).length && unitPrice !== null) {
    const line = calculateLine({ quantity, unitPrice, discountAmount, taxRate });
    if (!line.ok) Object.assign(errors, lineAmountErrors(line.error));
  }

  if (Object.keys(errors).length) return { ok: false, errors };
  return {
    ok: true,
    value: { productId: productId.toLowerCase(), description, quantity, unitPrice, discountAmount, taxRate },
  };
}

/** 0 <= rate <= 100, for a canonical decimal string. */
export function isTaxRateInRange(rate: string): boolean {
  const [intPart, frac = ""] = rate.split(".");
  const n = Number(intPart); // at most 3 digits: exact
  return n < 100 || (n === 100 && /^0*$/.test(frac));
}

/** Validates and normalizes a whole quotation (header and items). */
export function validateQuotationInput(raw: QuotationRawInput): QuotationValidationResult {
  const fieldErrors: QuotationFieldErrors = {};

  const customerId = trimText(raw.customerId);
  if (!customerId) fieldErrors.customerId = "Choose a customer.";
  else if (!isUuid(customerId)) fieldErrors.customerId = "Choose a customer from the list.";

  const quotationDate = trimText(raw.quotationDate);
  if (!quotationDate) fieldErrors.quotationDate = "Quotation date is required.";
  else if (!isValidDate(quotationDate)) fieldErrors.quotationDate = "Enter a valid date.";

  const expiryText = trimText(raw.expiryDate);
  const expiryDate = expiryText === "" ? null : expiryText;
  if (expiryDate !== null) {
    if (!isValidDate(expiryDate)) fieldErrors.expiryDate = "Enter a valid date.";
    else if (!fieldErrors.quotationDate && expiryDate < quotationDate)
      fieldErrors.expiryDate = "The expiry date cannot be before the quotation date.";
  }

  const notes = optionalText(raw.notes);
  if (notes && charLength(notes) > QUOTATION_LIMITS.notes)
    fieldErrors.notes = tooLong(QUOTATION_LIMITS.notes);

  const itemErrors: (QuotationItemErrors | undefined)[] = [];
  const items: QuotationItemInput[] = [];
  if (raw.items.length < QUOTATION_LIMITS.minItems)
    fieldErrors.items = "Add at least one item.";
  else if (raw.items.length > QUOTATION_LIMITS.maxItems)
    fieldErrors.items = `A quotation can have at most ${QUOTATION_LIMITS.maxItems} items.`;
  else
    for (const rawItem of raw.items) {
      const result = validateQuotationItem(rawItem);
      if (result.ok) {
        items.push(result.value);
        itemErrors.push(undefined);
      } else itemErrors.push(result.errors);
    }

  if (Object.keys(fieldErrors).length || itemErrors.some(Boolean))
    return { ok: false, fieldErrors, itemErrors };

  return {
    ok: true,
    value: { customerId: customerId.toLowerCase(), quotationDate, expiryDate, notes, items },
  };
}

// -----------------------------------------------------------------------------
// RPC payload
// -----------------------------------------------------------------------------

export type QuotationRpcItem = {
  product_id: string;
  quantity: string;
  unit_price?: string;
  discount_amount: string;
  tax_rate: string;
  description?: string | null;
};

export type QuotationRpcArgs = {
  p_customer_id: string;
  p_quotation_date: string;
  p_expiry_date: string | null;
  p_notes: string | null;
  p_items: QuotationRpcItem[];
};

/**
 * The arguments for create_quotation() / update_quotation_draft(). Only
 * user-controlled values are sent; product snapshots, line amounts and
 * totals are always computed by the database. Optional keys are omitted
 * (not sent as null) when the database should use the product's value.
 */
export function toQuotationRpcArgs(input: QuotationInput): QuotationRpcArgs {
  return {
    p_customer_id: input.customerId,
    p_quotation_date: input.quotationDate,
    p_expiry_date: input.expiryDate,
    p_notes: input.notes,
    p_items: input.items.map((item) => ({
      product_id: item.productId,
      quantity: item.quantity,
      ...(item.unitPrice !== null && { unit_price: item.unitPrice }),
      discount_amount: item.discountAmount,
      tax_rate: item.taxRate,
      ...(item.description !== undefined && { description: item.description }),
    })),
  };
}

// -----------------------------------------------------------------------------
// List parameters (from the URL query string)
// -----------------------------------------------------------------------------

export const QUOTATION_PAGE_SIZE = 25;
/** Same cap as list_quotations() applies in the database. */
export const QUOTATION_SEARCH_MAX_LENGTH = 100;
const MAX_PAGE = 10_000;

export type QuotationStatusFilter = QuotationStatus | "all";

export type QuotationListParams = {
  /** Quotation number or customer name (snapshot). */
  search: string;
  status: QuotationStatusFilter;
  /** A customer ID, or "all". */
  customer: string;
  page: number;
};

type SearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

/** Parses untrusted query-string values into safe list parameters. */
export function parseQuotationListParams(params: SearchParams): QuotationListParams {
  const search = truncateChars(trimText(first(params.q)), QUOTATION_SEARCH_MAX_LENGTH);
  const statusRaw = first(params.status);
  const customerRaw = first(params.customer);
  const pageNum = Number.parseInt(first(params.page), 10);
  return {
    search,
    status: isQuotationStatus(statusRaw) ? statusRaw : "all",
    customer: isUuid(customerRaw) ? customerRaw.toLowerCase() : "all",
    page: Number.isFinite(pageNum) && pageNum >= 1 ? Math.min(pageNum, MAX_PAGE) : 1,
  };
}

/** The list URL for the given parameters (defaults are left out). */
export function quotationListHref(params: QuotationListParams): string {
  const query = new URLSearchParams();
  if (params.search) query.set("q", params.search);
  if (params.status !== "all") query.set("status", params.status);
  if (params.customer !== "all") query.set("customer", params.customer);
  if (params.page > 1) query.set("page", String(params.page));
  const qs = query.toString();
  return qs ? `/quotations?${qs}` : "/quotations";
}
