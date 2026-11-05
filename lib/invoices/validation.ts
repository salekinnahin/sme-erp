import {
  isValidDate,
  validateQuotationItem,
  type QuotationItemErrors,
  type QuotationItemInput,
  type QuotationItemRawInput,
} from "@/lib/quotations/validation";
import { isUuid, optionalText, tooLongMessage as tooLong } from "@/lib/validation/fields";
import { charLength, trimText } from "@/lib/validation/text";

/**
 * Invoice input validation. Runs on the server for friendly, per-field and
 * per-item errors. The database re-validates everything in create_invoice(),
 * create_invoice_from_sales_order(), update_invoice_draft() and in CHECK
 * constraints (supabase/migrations/20261104150000_invoices.sql). Keep both
 * in sync.
 *
 * Line rules (quantity, price, discount, tax rate, description) are the
 * quotation rules: this module reuses validateQuotationItem() and the
 * quotation calculation model (DECISIONS 018, 022, 023) instead of copying
 * them.
 */

// -----------------------------------------------------------------------------
// Status model
// -----------------------------------------------------------------------------

export const INVOICE_STATUSES = ["draft", "issued", "partially_paid", "paid", "cancelled"] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export function isInvoiceStatus(value: unknown): value is InvoiceStatus {
  return (INVOICE_STATUSES as readonly unknown[]).includes(value);
}

export const INVOICE_STATUS_LABELS: Record<InvoiceStatus, string> = {
  draft: "Draft",
  issued: "Issued",
  partially_paid: "Partially paid",
  paid: "Paid",
  cancelled: "Cancelled",
};

/**
 * The full V1 lifecycle. The SQL twin is
 * public.invoice_status_transition_allowed(). paid and cancelled are
 * terminal. Moves into partially_paid / paid are system transitions driven
 * by payments (INVOICE_PAYMENT_STATUSES); users only ever issue or cancel.
 */
export const INVOICE_TRANSITIONS: Record<InvoiceStatus, readonly InvoiceStatus[]> = {
  draft: ["issued", "cancelled"],
  issued: ["cancelled", "partially_paid", "paid"],
  partially_paid: ["paid"],
  paid: [],
  cancelled: [],
};

/** Statuses only the (future) Payment module may set. Never user-settable. */
export const INVOICE_PAYMENT_STATUSES = ["partially_paid", "paid"] as const;
export type InvoicePaymentStatus = (typeof INVOICE_PAYMENT_STATUSES)[number];

/** Statuses a user may move an invoice to via set_invoice_status(). */
export const INVOICE_USER_TARGET_STATUSES = ["issued", "cancelled"] as const;
export type InvoiceUserTargetStatus = (typeof INVOICE_USER_TARGET_STATUSES)[number];

export function isInvoicePaymentStatus(value: unknown): value is InvoicePaymentStatus {
  return (INVOICE_PAYMENT_STATUSES as readonly unknown[]).includes(value);
}

export function isInvoiceUserTargetStatus(value: unknown): value is InvoiceUserTargetStatus {
  return (INVOICE_USER_TARGET_STATUSES as readonly unknown[]).includes(value);
}

/** Any lifecycle transition, user or system. */
export function isInvoiceTransitionAllowed(from: InvoiceStatus, to: InvoiceStatus): boolean {
  return INVOICE_TRANSITIONS[from].includes(to);
}

/** A transition a user may request: issue or cancel, from an allowed status. */
export function isInvoiceUserTransitionAllowed(from: InvoiceStatus, to: InvoiceStatus): boolean {
  return isInvoiceUserTargetStatus(to) && isInvoiceTransitionAllowed(from, to);
}

export function isTerminalInvoiceStatus(status: InvoiceStatus): boolean {
  return INVOICE_TRANSITIONS[status].length === 0;
}

// -----------------------------------------------------------------------------
// Balance (reserved for the Payment module)
// -----------------------------------------------------------------------------

/**
 * The balance of a new invoice: nothing paid, everything due. The database
 * sets the same values (and invoices_no_payments_yet_check pins amount_paid
 * to 0 until payments exist); clients never send them.
 */
export function initialInvoiceBalance(grandTotal: string): { amountPaid: string; amountDue: string } {
  return { amountPaid: "0.00", amountDue: grandTotal };
}

// -----------------------------------------------------------------------------
// Limits
// -----------------------------------------------------------------------------

export const INVOICE_LIMITS = {
  notes: 2000,
  itemDescription: 2000,
  minItems: 1,
  maxItems: 100,
} as const;

// -----------------------------------------------------------------------------
// Input
// -----------------------------------------------------------------------------

export type InvoiceItemRawInput = QuotationItemRawInput & {
  /**
   * ID of an existing line of the draft invoice being edited: an
   * edit/reference token for this save only, not a durable ID (draft items
   * are deleted and re-inserted on every save). With the same product as
   * that line, the database keeps the line's product snapshot (and its price
   * and description as defaults), even if the product is now inactive.
   * Missing or empty = a new selection.
   */
  lineId?: string;
};

export type InvoiceRawInput = {
  customerId: string;
  invoiceDate: string;
  /** Empty = no due date. */
  dueDate: string;
  notes: string;
  items: InvoiceItemRawInput[];
};

export type InvoiceItemInput = QuotationItemInput & {
  /** Lowercase UUID of an existing line, or null for a new selection. */
  lineId: string | null;
};

export type InvoiceInput = {
  customerId: string;
  invoiceDate: string;
  dueDate: string | null;
  notes: string | null;
  items: InvoiceItemInput[];
};

export type InvoiceField = "customerId" | "invoiceDate" | "dueDate" | "notes" | "items";
export type InvoiceFieldErrors = Partial<Record<InvoiceField, string>>;
export type InvoiceItemErrors = QuotationItemErrors & { lineId?: string };

export type InvoiceValidationErrors = {
  fieldErrors: InvoiceFieldErrors;
  /** Same index as the input items; undefined for items without errors. */
  itemErrors: (InvoiceItemErrors | undefined)[];
};

export type InvoiceValidationResult =
  | { ok: true; value: InvoiceInput }
  | ({ ok: false } & InvoiceValidationErrors);

export const INVOICE_LINE_NOT_FOUND = "This line no longer exists. Reload the invoice and try again.";

/** Validates and normalizes one item (quotation line rules + optional line ID). */
export function validateInvoiceItem(
  raw: InvoiceItemRawInput,
): { ok: true; value: InvoiceItemInput } | { ok: false; errors: InvoiceItemErrors } {
  const result = validateQuotationItem(raw);
  const errors: InvoiceItemErrors = result.ok ? {} : { ...result.errors };

  const lineText = trimText(raw.lineId ?? "");
  const lineId = lineText === "" ? null : lineText.toLowerCase();
  if (lineId !== null && !isUuid(lineId)) errors.lineId = INVOICE_LINE_NOT_FOUND;

  if (!result.ok || Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, value: { ...result.value, lineId } };
}

/** Header date rules: invoice date required, due date on or after it. */
function validateDates(
  invoiceDateRaw: string,
  dueDateRaw: string,
  fieldErrors: Partial<Record<"invoiceDate" | "dueDate", string>>,
): { invoiceDate: string; dueDate: string | null } {
  const invoiceDate = trimText(invoiceDateRaw);
  if (!invoiceDate) fieldErrors.invoiceDate = "Invoice date is required.";
  else if (!isValidDate(invoiceDate)) fieldErrors.invoiceDate = "Enter a valid date.";

  const dueText = trimText(dueDateRaw);
  const dueDate = dueText === "" ? null : dueText;
  if (dueDate !== null) {
    if (!isValidDate(dueDate)) fieldErrors.dueDate = "Enter a valid date.";
    else if (!fieldErrors.invoiceDate && dueDate < invoiceDate)
      fieldErrors.dueDate = "The due date cannot be before the invoice date.";
  }
  return { invoiceDate, dueDate };
}

/** Validates and normalizes a whole invoice (header and items). */
export function validateInvoiceInput(raw: InvoiceRawInput): InvoiceValidationResult {
  const fieldErrors: InvoiceFieldErrors = {};

  const customerId = trimText(raw.customerId);
  if (!customerId) fieldErrors.customerId = "Choose a customer.";
  else if (!isUuid(customerId)) fieldErrors.customerId = "Choose a customer from the list.";

  const { invoiceDate, dueDate } = validateDates(raw.invoiceDate, raw.dueDate, fieldErrors);

  const notes = optionalText(raw.notes);
  if (notes && charLength(notes) > INVOICE_LIMITS.notes) fieldErrors.notes = tooLong(INVOICE_LIMITS.notes);

  const itemErrors: (InvoiceItemErrors | undefined)[] = [];
  const items: InvoiceItemInput[] = [];
  if (raw.items.length < INVOICE_LIMITS.minItems) fieldErrors.items = "Add at least one item.";
  else if (raw.items.length > INVOICE_LIMITS.maxItems)
    fieldErrors.items = `An invoice can have at most ${INVOICE_LIMITS.maxItems} items.`;
  else {
    const seenLines = new Set<string>();
    for (const rawItem of raw.items) {
      const result = validateInvoiceItem(rawItem);
      if (!result.ok) {
        itemErrors.push(result.errors);
        continue;
      }
      // Each existing line can be continued at most once (the database
      // rejects repeats too).
      const { lineId } = result.value;
      if (lineId !== null && seenLines.has(lineId)) {
        itemErrors.push({ lineId: INVOICE_LINE_NOT_FOUND });
        continue;
      }
      if (lineId !== null) seenLines.add(lineId);
      items.push(result.value);
      itemErrors.push(undefined);
    }
  }

  if (Object.keys(fieldErrors).length || itemErrors.some(Boolean))
    return { ok: false, fieldErrors, itemErrors };

  return {
    ok: true,
    value: { customerId: customerId.toLowerCase(), invoiceDate, dueDate, notes, items },
  };
}

// -----------------------------------------------------------------------------
// Sales order conversion
// -----------------------------------------------------------------------------

export type InvoiceConversionRawInput = {
  salesOrderId: string;
  invoiceDate: string;
  /** Empty = no due date. */
  dueDate: string;
};

export type InvoiceConversionInput = {
  salesOrderId: string;
  invoiceDate: string;
  dueDate: string | null;
};

export type InvoiceConversionField = "salesOrderId" | "invoiceDate" | "dueDate";

export type InvoiceConversionValidationResult =
  | { ok: true; value: InvoiceConversionInput }
  | { ok: false; fieldErrors: Partial<Record<InvoiceConversionField, string>> };

/**
 * Validates the input of a sales order conversion. Everything else
 * (customer, lines, prices, notes) is copied from the sales order by the
 * database.
 */
export function validateInvoiceConversionInput(
  raw: InvoiceConversionRawInput,
): InvoiceConversionValidationResult {
  const fieldErrors: Partial<Record<InvoiceConversionField, string>> = {};

  const salesOrderId = trimText(raw.salesOrderId);
  if (!isUuid(salesOrderId)) fieldErrors.salesOrderId = "Choose a sales order.";

  const { invoiceDate, dueDate } = validateDates(raw.invoiceDate, raw.dueDate, fieldErrors);

  if (Object.keys(fieldErrors).length) return { ok: false, fieldErrors };
  return { ok: true, value: { salesOrderId: salesOrderId.toLowerCase(), invoiceDate, dueDate } };
}

/**
 * Why a sales order cannot be invoiced, or null if it can. Only a confirmed
 * sales order without an invoice converts (one invoice per sales order ever
 * in V1, even if that invoice is cancelled). The database enforces both
 * rules; this is for early, friendly feedback.
 */
export function salesOrderInvoiceBlocker(
  salesOrderStatus: string,
  alreadyInvoiced: boolean,
): "not_confirmed" | "already_invoiced" | null {
  if (salesOrderStatus !== "confirmed") return "not_confirmed";
  if (alreadyInvoiced) return "already_invoiced";
  return null;
}

// -----------------------------------------------------------------------------
// RPC payloads
// -----------------------------------------------------------------------------

export type InvoiceRpcItem = {
  id?: string;
  product_id: string;
  quantity: string;
  unit_price?: string;
  discount_amount: string;
  tax_rate: string;
  description?: string | null;
};

export type InvoiceRpcArgs = {
  p_customer_id: string;
  p_invoice_date: string;
  p_due_date: string | null;
  p_notes: string | null;
  p_items: InvoiceRpcItem[];
};

/**
 * Arguments for create_invoice() / update_invoice_draft(). Only
 * user-controlled values are sent; snapshots, line amounts, totals, the
 * status and the balance (amount_paid, amount_due) are always derived by the
 * database. Optional keys are omitted (not sent as null) when the database
 * should use the default value.
 */
export function toInvoiceRpcArgs(input: InvoiceInput): InvoiceRpcArgs {
  return {
    p_customer_id: input.customerId,
    p_invoice_date: input.invoiceDate,
    p_due_date: input.dueDate,
    p_notes: input.notes,
    p_items: input.items.map((item) => ({
      ...(item.lineId !== null && { id: item.lineId }),
      product_id: item.productId,
      quantity: item.quantity,
      ...(item.unitPrice !== null && { unit_price: item.unitPrice }),
      discount_amount: item.discountAmount,
      tax_rate: item.taxRate,
      ...(item.description !== undefined && { description: item.description }),
    })),
  };
}

export function toInvoiceConversionRpcArgs(input: InvoiceConversionInput): {
  p_sales_order_id: string;
  p_invoice_date: string;
  p_due_date: string | null;
} {
  return {
    p_sales_order_id: input.salesOrderId,
    p_invoice_date: input.invoiceDate,
    p_due_date: input.dueDate,
  };
}
