import { plainDecimal } from "@/lib/format";
import { calculateLine, calculateTotals, type LineAmounts, type QuotationTotals } from "./calculations";
import type { Quotation } from "./quotations";
import {
  QUOTATION_LIMITS,
  validateQuotationItem,
  type QuotationItemErrors,
  type QuotationItemRawInput,
} from "./validation";

/**
 * Pure helpers for the quotation form. Safe to import from Client
 * Components (no server imports).
 *
 * Nothing here is authoritative. The browser only ever sends the customer,
 * dates, notes and per line the product, description, quantity, unit price,
 * discount and tax rate. The database takes every snapshot and computes
 * every amount (create_quotation() / update_quotation_draft()); the preview
 * uses the same Part 1 rules (calculations.ts) so the numbers match.
 */

// -----------------------------------------------------------------------------
// Options
// -----------------------------------------------------------------------------

export type CustomerOption = {
  id: string;
  name: string;
  companyName: string | null;
  /** For telling customers with the same name apart in the selector. */
  phone: string | null;
  email: string | null;
  status: "active" | "inactive";
};

/** A server-side selector search (searchCustomerOptions / searchProductOptions). */
export type OptionSearchResult<T> =
  | {
      ok: true;
      options: T[];
      /** True if more records match than the result shows. */
      more: boolean;
    }
  | { ok: false };

/**
 * The known options plus new ones, by ID. Known entries are never dropped,
 * so a selected or current record stays available whatever later searches
 * return. Returns the same map if nothing is new.
 */
export function rememberOptions<T extends { id: string }>(
  known: ReadonlyMap<string, T>,
  options: readonly T[],
): ReadonlyMap<string, T> {
  const fresh = options.filter((o) => !known.has(o.id));
  if (!fresh.length) return known;
  const next = new Map(known);
  for (const option of fresh) next.set(option.id, option);
  return next;
}

/** Phone and email, for the second line of a customer search result. */
export function customerOptionDetail(c: CustomerOption): string {
  return [c.phone, c.email].filter(Boolean).join(" · ");
}

export type ProductOption = {
  id: string;
  name: string;
  sku: string;
  unit: string;
  description: string | null;
  /** Decimal string, or null if the product has no selling price. */
  sellingPrice: string | null;
  status: "active" | "inactive";
};

/**
 * The listed options plus the current records that are not in the list
 * (inactive, or beyond the cap). Current records come first; no duplicates.
 */
export function withCurrentOptions<T extends { id: string }>(listed: T[], current: T[]): T[] {
  const have = new Set(listed.map((o) => o.id));
  const extra: T[] = [];
  for (const option of current) {
    if (!have.has(option.id)) {
      have.add(option.id);
      extra.push(option);
    }
  }
  return [...extra, ...listed];
}

export function customerOptionLabel(c: CustomerOption): string {
  const base = c.companyName ? `${c.name} — ${c.companyName}` : c.name;
  return c.status === "inactive" ? `${base} (inactive)` : base;
}

export function productOptionLabel(p: Pick<ProductOption, "name" | "sku" | "status">): string {
  const base = `${p.name} (${p.sku})`;
  return p.status === "inactive" ? `${base} (inactive)` : base;
}

// -----------------------------------------------------------------------------
// Form values
// -----------------------------------------------------------------------------

export type QuotationFormLine = {
  /** Client-side identity of the line, for React keys and error mapping. */
  key: string;
  productId: string;
  description: string;
  quantity: string;
  /** Empty = the product's current selling price. */
  unitPrice: string;
  /** Empty = 0. */
  discountAmount: string;
  /** Percent. Empty = 0. */
  taxRate: string;
};

export type QuotationFormValues = {
  customerId: string;
  quotationDate: string;
  expiryDate: string;
  notes: string;
  lines: QuotationFormLine[];
};

export function emptyLine(key: string): QuotationFormLine {
  return { key, productId: "", description: "", quantity: "1", unitPrice: "", discountAmount: "", taxRate: "" };
}

/** A new quotation: today's date (in the organization's time zone), one line. */
export function newQuotationFormValues(today: string): QuotationFormValues {
  return { customerId: "", quotationDate: today, expiryDate: "", notes: "", lines: [emptyLine("line-0")] };
}

/** Zero amounts are shown as blank fields (blank means 0). */
function blankIfZero(value: string): string {
  const plain = plainDecimal(value);
  return /^0*$/.test(plain.replace(".", "")) ? "" : plain;
}

/**
 * Edit form values from a saved draft. Prices, discounts and rates keep the
 * draft's own values (not the product's current price). Saving re-snapshots
 * product name, SKU and unit from current master data (DECISIONS 018).
 */
export function quotationToFormValues(q: Quotation): QuotationFormValues {
  return {
    customerId: q.customerId,
    quotationDate: q.quotationDate,
    expiryDate: q.expiryDate ?? "",
    notes: q.notes ?? "",
    lines: q.items.map((item, index) => ({
      key: `line-${index}`,
      productId: item.productId,
      description: item.description ?? "",
      quantity: plainDecimal(item.quantity),
      unitPrice: item.unitPrice,
      discountAmount: blankIfZero(item.discountAmount),
      taxRate: blankIfZero(item.taxRate),
    })),
  };
}

/**
 * The line after choosing a product: description and unit price are
 * prefilled from the product. Quantity, discount and tax rate are kept.
 * Name, SKU and unit are shown from the product and snapshotted by the
 * database on save.
 */
export function applyProductToLine(
  line: QuotationFormLine,
  product: ProductOption | undefined,
): QuotationFormLine {
  if (!product) return { ...line, productId: "" };
  return {
    ...line,
    productId: product.id,
    description: product.description ?? "",
    unitPrice: product.sellingPrice ?? "",
  };
}

// -----------------------------------------------------------------------------
// Payload (hidden "items" field)
// -----------------------------------------------------------------------------

/** Only the user-controlled fields of each line are sent. */
export function serializeLines(lines: readonly QuotationFormLine[]): string {
  return JSON.stringify(
    lines.map((l) => ({
      key: l.key,
      productId: l.productId,
      description: l.description,
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      discountAmount: l.discountAmount,
      taxRate: l.taxRate,
    })),
  );
}

/** Hard cap on the submitted JSON, well above 100 full lines. */
export const ITEMS_PAYLOAD_MAX_LENGTH = 1_000_000;
/** Lines read from a payload at most; validation still enforces the 100-item limit. */
const MAX_PARSED_LINES = QUOTATION_LIMITS.maxItems + 1;
const KEY_MAX_LENGTH = 64;

export type ParsedFormItems =
  | { ok: true; keys: string[]; items: QuotationItemRawInput[] }
  | { ok: false };

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * Reads the untrusted "items" form field. Only string fields are used; any
 * other key (snapshot names, amounts, totals, organization) is ignored.
 * Returns ok: false for anything that is not a JSON array of objects.
 */
export function parseFormItems(raw: unknown): ParsedFormItems {
  if (typeof raw !== "string" || raw.length > ITEMS_PAYLOAD_MAX_LENGTH) return { ok: false };
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { ok: false };
  }
  if (!Array.isArray(data)) return { ok: false };

  const keys: string[] = [];
  const items: QuotationItemRawInput[] = [];
  const seen = new Set<string>();
  for (const [index, entry] of data.slice(0, MAX_PARSED_LINES).entries()) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return { ok: false };
    const o = entry as Record<string, unknown>;
    let key = str(o.key);
    if (!key || key.length > KEY_MAX_LENGTH || seen.has(key)) key = `line-${index}`;
    while (seen.has(key)) key = `${key}-${index}`;
    seen.add(key);
    keys.push(key);
    items.push({
      productId: str(o.productId),
      // The form always sends its description (prefilled from the product).
      // A missing one falls back to the product's description in the database.
      description: typeof o.description === "string" ? o.description : undefined,
      quantity: str(o.quantity),
      unitPrice: str(o.unitPrice),
      discountAmount: str(o.discountAmount),
      taxRate: str(o.taxRate),
    });
  }
  return { ok: true, keys, items };
}

/** Per-index item errors as a map by line key, for the client form. */
export function itemErrorsByKey<E = QuotationItemErrors>(
  keys: readonly string[],
  errors: readonly (E | undefined)[] | undefined,
): Record<string, E> {
  const out: Record<string, E> = {};
  errors?.forEach((e, i) => {
    if (e && keys[i] !== undefined) out[keys[i]] = e;
  });
  return out;
}

// -----------------------------------------------------------------------------
// Calculation preview
// -----------------------------------------------------------------------------

export type QuotationPreview = {
  /** Same order as the lines; null for lines that are incomplete or invalid. */
  lines: (LineAmounts | null)[];
  /** Totals of the complete lines; null if they overflow. */
  totals: QuotationTotals | null;
  /** Number of lines left out of the totals. */
  incomplete: number;
};

/**
 * Preview of line totals and quotation totals with the Part 1 rules
 * (exact decimal strings, BigInt, half-up rounding). Uses the same parsing
 * as the server (validateQuotationItem), and the product's selling price
 * when the unit price is blank, like the database.
 */
export function previewQuotation(
  lines: readonly QuotationFormLine[],
  products: ReadonlyMap<string, ProductOption>,
): QuotationPreview {
  return previewLines(lines, (line) => products.get(line.productId));
}

/**
 * The preview engine behind previewQuotation(), with the product (and so the
 * default unit price) resolved per line. Sales orders use it for kept lines,
 * whose default price is the line's saved price, not the product's.
 */
export function previewLines<L extends QuotationFormLine>(
  lines: readonly L[],
  productFor: (line: L) => ProductOption | undefined,
): QuotationPreview {
  return previewLinesWithDefaultPrice(lines, (line) => {
    const product = productFor(line);
    return product ? product.sellingPrice : undefined;
  });
}

/**
 * The preview engine with the default unit price resolved per line:
 * undefined = no product chosen (the line is incomplete), null = the product
 * has no default price (a unit price must be entered), otherwise the decimal
 * string the database would use for a blank unit price. Purchase orders use
 * it with purchase prices.
 */
export function previewLinesWithDefaultPrice<L extends QuotationFormLine>(
  lines: readonly L[],
  defaultPriceFor: (line: L) => string | null | undefined,
): QuotationPreview {
  const amounts = lines.map((line): LineAmounts | null => {
    const defaultPrice = defaultPriceFor(line);
    if (defaultPrice === undefined) return null;
    const parsed = validateQuotationItem({
      productId: line.productId,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      discountAmount: line.discountAmount,
      taxRate: line.taxRate,
    });
    if (!parsed.ok) return null;
    const unitPrice = parsed.value.unitPrice ?? defaultPrice;
    if (unitPrice === null) return null;
    const result = calculateLine({ ...parsed.value, unitPrice });
    return result.ok ? result.value : null;
  });

  const complete = amounts.filter((a): a is LineAmounts => a !== null);
  const totals = calculateTotals(complete);
  return {
    lines: amounts,
    totals: totals.ok ? totals.value : null,
    incomplete: amounts.length - complete.length,
  };
}

// -----------------------------------------------------------------------------
// Dates
// -----------------------------------------------------------------------------

/** Today's calendar date (YYYY-MM-DD) in the given IANA time zone. */
export function todayInTimeZone(timeZone: string, now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}
