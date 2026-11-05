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
 * Sales order input validation. Runs on the server for friendly, per-field
 * and per-item errors. The database re-validates everything in
 * create_sales_order(), create_sales_order_from_quotation(),
 * update_sales_order_draft() and in CHECK constraints
 * (supabase/migrations/20261104130000_sales_orders.sql). Keep both in sync.
 *
 * Line rules (quantity, price, discount, tax rate, description) are the
 * quotation rules: this module reuses validateQuotationItem() and the
 * quotation calculation model (DECISIONS 018, 022) instead of copying them.
 */

// -----------------------------------------------------------------------------
// Status model
// -----------------------------------------------------------------------------

export const SALES_ORDER_STATUSES = ["draft", "confirmed", "completed", "cancelled"] as const;
export type SalesOrderStatus = (typeof SALES_ORDER_STATUSES)[number];

export function isSalesOrderStatus(value: unknown): value is SalesOrderStatus {
  return (SALES_ORDER_STATUSES as readonly unknown[]).includes(value);
}

export const SALES_ORDER_STATUS_LABELS: Record<SalesOrderStatus, string> = {
  draft: "Draft",
  confirmed: "Confirmed",
  completed: "Completed",
  cancelled: "Cancelled",
};

/**
 * Allowed V1 transitions. The SQL twin is
 * public.sales_order_status_transition_allowed(). completed and cancelled
 * are terminal.
 */
export const SALES_ORDER_TRANSITIONS: Record<SalesOrderStatus, readonly SalesOrderStatus[]> = {
  draft: ["confirmed", "cancelled"],
  confirmed: ["completed", "cancelled"],
  completed: [],
  cancelled: [],
};

/** Statuses a sales order can be moved to (never back to draft). */
export type SalesOrderTargetStatus = Exclude<SalesOrderStatus, "draft">;

export function isSalesOrderTransitionAllowed(
  from: SalesOrderStatus,
  to: SalesOrderStatus,
): boolean {
  return SALES_ORDER_TRANSITIONS[from].includes(to);
}

export function isTerminalSalesOrderStatus(status: SalesOrderStatus): boolean {
  return SALES_ORDER_TRANSITIONS[status].length === 0;
}

// -----------------------------------------------------------------------------
// Limits
// -----------------------------------------------------------------------------

export const SALES_ORDER_LIMITS = {
  notes: 2000,
  itemDescription: 2000,
  minItems: 1,
  maxItems: 100,
} as const;

// -----------------------------------------------------------------------------
// Input
// -----------------------------------------------------------------------------

export type SalesOrderItemRawInput = QuotationItemRawInput & {
  /**
   * ID of an existing line of the order being edited. With the same product
   * as that line, the database keeps the line's product snapshot (and its
   * price and description as defaults), even if the product is now inactive.
   * Missing or empty = a new selection.
   */
  lineId?: string;
};

export type SalesOrderRawInput = {
  customerId: string;
  orderDate: string;
  /** Empty = no expected delivery date. */
  expectedDeliveryDate: string;
  notes: string;
  items: SalesOrderItemRawInput[];
};

export type SalesOrderItemInput = QuotationItemInput & {
  /** Lowercase UUID of an existing line, or null for a new selection. */
  lineId: string | null;
};

export type SalesOrderInput = {
  customerId: string;
  orderDate: string;
  expectedDeliveryDate: string | null;
  notes: string | null;
  items: SalesOrderItemInput[];
};

export type SalesOrderField = "customerId" | "orderDate" | "expectedDeliveryDate" | "notes" | "items";
export type SalesOrderFieldErrors = Partial<Record<SalesOrderField, string>>;
export type SalesOrderItemErrors = QuotationItemErrors & { lineId?: string };

export type SalesOrderValidationErrors = {
  fieldErrors: SalesOrderFieldErrors;
  /** Same index as the input items; undefined for items without errors. */
  itemErrors: (SalesOrderItemErrors | undefined)[];
};

export type SalesOrderValidationResult =
  | { ok: true; value: SalesOrderInput }
  | ({ ok: false } & SalesOrderValidationErrors);

const LINE_NOT_FOUND = "This line no longer exists. Reload the sales order and try again.";

/** Validates and normalizes one item (quotation line rules + optional line ID). */
export function validateSalesOrderItem(
  raw: SalesOrderItemRawInput,
): { ok: true; value: SalesOrderItemInput } | { ok: false; errors: SalesOrderItemErrors } {
  const result = validateQuotationItem(raw);
  const errors: SalesOrderItemErrors = result.ok ? {} : { ...result.errors };

  const lineText = trimText(raw.lineId ?? "");
  const lineId = lineText === "" ? null : lineText.toLowerCase();
  if (lineId !== null && !isUuid(lineId)) errors.lineId = LINE_NOT_FOUND;

  if (!result.ok || Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, value: { ...result.value, lineId } };
}

/** Header date rules: order date required, expected delivery on or after it. */
function validateDates(
  orderDateRaw: string,
  expectedRaw: string,
  fieldErrors: SalesOrderFieldErrors,
): { orderDate: string; expectedDeliveryDate: string | null } {
  const orderDate = trimText(orderDateRaw);
  if (!orderDate) fieldErrors.orderDate = "Order date is required.";
  else if (!isValidDate(orderDate)) fieldErrors.orderDate = "Enter a valid date.";

  const expectedText = trimText(expectedRaw);
  const expectedDeliveryDate = expectedText === "" ? null : expectedText;
  if (expectedDeliveryDate !== null) {
    if (!isValidDate(expectedDeliveryDate)) fieldErrors.expectedDeliveryDate = "Enter a valid date.";
    else if (!fieldErrors.orderDate && expectedDeliveryDate < orderDate)
      fieldErrors.expectedDeliveryDate = "The expected delivery date cannot be before the order date.";
  }
  return { orderDate, expectedDeliveryDate };
}

/** Validates and normalizes a whole sales order (header and items). */
export function validateSalesOrderInput(raw: SalesOrderRawInput): SalesOrderValidationResult {
  const fieldErrors: SalesOrderFieldErrors = {};

  const customerId = trimText(raw.customerId);
  if (!customerId) fieldErrors.customerId = "Choose a customer.";
  else if (!isUuid(customerId)) fieldErrors.customerId = "Choose a customer from the list.";

  const { orderDate, expectedDeliveryDate } = validateDates(
    raw.orderDate,
    raw.expectedDeliveryDate,
    fieldErrors,
  );

  const notes = optionalText(raw.notes);
  if (notes && charLength(notes) > SALES_ORDER_LIMITS.notes)
    fieldErrors.notes = tooLong(SALES_ORDER_LIMITS.notes);

  const itemErrors: (SalesOrderItemErrors | undefined)[] = [];
  const items: SalesOrderItemInput[] = [];
  if (raw.items.length < SALES_ORDER_LIMITS.minItems) fieldErrors.items = "Add at least one item.";
  else if (raw.items.length > SALES_ORDER_LIMITS.maxItems)
    fieldErrors.items = `A sales order can have at most ${SALES_ORDER_LIMITS.maxItems} items.`;
  else {
    const seenLines = new Set<string>();
    for (const rawItem of raw.items) {
      const result = validateSalesOrderItem(rawItem);
      if (!result.ok) {
        itemErrors.push(result.errors);
        continue;
      }
      // Each existing line can be kept at most once (the database rejects
      // repeats too).
      const { lineId } = result.value;
      if (lineId !== null && seenLines.has(lineId)) {
        itemErrors.push({ lineId: LINE_NOT_FOUND });
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
    value: {
      customerId: customerId.toLowerCase(),
      orderDate,
      expectedDeliveryDate,
      notes,
      items,
    },
  };
}

// -----------------------------------------------------------------------------
// Quotation conversion
// -----------------------------------------------------------------------------

export type ConversionRawInput = {
  quotationId: string;
  orderDate: string;
  /** Empty = no expected delivery date. */
  expectedDeliveryDate: string;
};

export type ConversionInput = {
  quotationId: string;
  orderDate: string;
  expectedDeliveryDate: string | null;
};

export type ConversionField = "quotationId" | "orderDate" | "expectedDeliveryDate";

export type ConversionValidationResult =
  | { ok: true; value: ConversionInput }
  | { ok: false; fieldErrors: Partial<Record<ConversionField, string>> };

/**
 * Validates the input of a quotation conversion. Everything else (customer,
 * lines, prices, notes) is copied from the quotation by the database.
 */
export function validateConversionInput(raw: ConversionRawInput): ConversionValidationResult {
  const fieldErrors: Partial<Record<ConversionField, string>> = {};

  const quotationId = trimText(raw.quotationId);
  if (!isUuid(quotationId)) fieldErrors.quotationId = "Choose a quotation.";

  const { orderDate, expectedDeliveryDate } = validateDates(
    raw.orderDate,
    raw.expectedDeliveryDate,
    fieldErrors,
  );

  if (Object.keys(fieldErrors).length) return { ok: false, fieldErrors };
  return { ok: true, value: { quotationId: quotationId.toLowerCase(), orderDate, expectedDeliveryDate } };
}

/**
 * Why a quotation cannot be converted, or null if it can. Only an accepted
 * quotation that has no sales order yet converts (one order per quotation in
 * V1). The database enforces both rules; this is for early, friendly
 * feedback.
 */
export function quotationConversionBlocker(
  quotationStatus: string,
  alreadyConverted: boolean,
): "not_accepted" | "already_converted" | null {
  if (quotationStatus !== "accepted") return "not_accepted";
  if (alreadyConverted) return "already_converted";
  return null;
}

// -----------------------------------------------------------------------------
// RPC payloads
// -----------------------------------------------------------------------------

export type SalesOrderRpcItem = {
  id?: string;
  product_id: string;
  quantity: string;
  unit_price?: string;
  discount_amount: string;
  tax_rate: string;
  description?: string | null;
};

export type SalesOrderRpcArgs = {
  p_customer_id: string;
  p_order_date: string;
  p_expected_delivery_date: string | null;
  p_notes: string | null;
  p_items: SalesOrderRpcItem[];
};

/**
 * Arguments for create_sales_order() / update_sales_order_draft(). Only
 * user-controlled values are sent; snapshots, line amounts and totals are
 * always computed by the database. Optional keys are omitted (not sent as
 * null) when the database should use the default value.
 */
export function toSalesOrderRpcArgs(input: SalesOrderInput): SalesOrderRpcArgs {
  return {
    p_customer_id: input.customerId,
    p_order_date: input.orderDate,
    p_expected_delivery_date: input.expectedDeliveryDate,
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

export function toConversionRpcArgs(input: ConversionInput): {
  p_quotation_id: string;
  p_order_date: string;
  p_expected_delivery_date: string | null;
} {
  return {
    p_quotation_id: input.quotationId,
    p_order_date: input.orderDate,
    p_expected_delivery_date: input.expectedDeliveryDate,
  };
}
