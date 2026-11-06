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
 * Purchase order input validation. Runs on the server for friendly, per-field
 * and per-item errors. The database re-validates everything in
 * create_purchase_order(), update_purchase_order_draft() and in CHECK constraints
 * (supabase/migrations/20261104180000_purchase_orders.sql). Keep both in sync.
 *
 * Line rules (quantity, price, discount, tax rate, description) are the
 * quotation rules: this module reuses validateQuotationItem() and the
 * quotation calculation model (DECISIONS 018, 022) instead of copying them.
 */

// -----------------------------------------------------------------------------
// Status model
// -----------------------------------------------------------------------------

export const PURCHASE_ORDER_STATUSES = ["draft", "ordered", "partially_received", "received", "cancelled"] as const;
export type PurchaseOrderStatus = (typeof PURCHASE_ORDER_STATUSES)[number];

export function isPurchaseOrderStatus(value: unknown): value is PurchaseOrderStatus {
  return (PURCHASE_ORDER_STATUSES as readonly unknown[]).includes(value);
}

export const PURCHASE_ORDER_STATUS_LABELS: Record<PurchaseOrderStatus, string> = {
  draft: "Draft",
  ordered: "Ordered",
  partially_received: "Partially received",
  received: "Received",
  cancelled: "Cancelled",
};

/**
 * The full V1 lifecycle. The SQL twin is
 * public.purchase_order_status_transition_allowed(). received and cancelled are
 * terminal. Moves into partially_received / received are system transitions driven
 * by Goods Receiving (PURCHASE_ORDER_RECEIVING_STATUSES); users only ever order or cancel.
 */
export const PURCHASE_ORDER_TRANSITIONS: Record<PurchaseOrderStatus, readonly PurchaseOrderStatus[]> = {
  draft: ["ordered", "cancelled"],
  ordered: ["cancelled", "partially_received", "received"],
  partially_received: ["received"],
  received: [],
  cancelled: [],
};

/** Statuses only the (future) Receiving module may set. Never user-settable. */
export const PURCHASE_ORDER_RECEIVING_STATUSES = ["partially_received", "received"] as const;
export type PurchaseOrderReceivingStatus = (typeof PURCHASE_ORDER_RECEIVING_STATUSES)[number];

/** Statuses a user may move a purchase order to via set_purchase_order_status(). */
export const PURCHASE_ORDER_USER_TARGET_STATUSES = ["ordered", "cancelled"] as const;
export type PurchaseOrderUserTargetStatus = (typeof PURCHASE_ORDER_USER_TARGET_STATUSES)[number];

export function isPurchaseOrderReceivingStatus(value: unknown): value is PurchaseOrderReceivingStatus {
  return (PURCHASE_ORDER_RECEIVING_STATUSES as readonly unknown[]).includes(value);
}

export function isPurchaseOrderUserTargetStatus(value: unknown): value is PurchaseOrderUserTargetStatus {
  return (PURCHASE_ORDER_USER_TARGET_STATUSES as readonly unknown[]).includes(value);
}

/** Any lifecycle transition, user or system. */
export function isPurchaseOrderTransitionAllowed(from: PurchaseOrderStatus, to: PurchaseOrderStatus): boolean {
  return PURCHASE_ORDER_TRANSITIONS[from].includes(to);
}

/** A transition a user may request: order or cancel, from an allowed status. */
export function isPurchaseOrderUserTransitionAllowed(from: PurchaseOrderStatus, to: PurchaseOrderStatus): boolean {
  return isPurchaseOrderUserTargetStatus(to) && isPurchaseOrderTransitionAllowed(from, to);
}

export function isTerminalPurchaseOrderStatus(status: PurchaseOrderStatus): boolean {
  return PURCHASE_ORDER_TRANSITIONS[status].length === 0;
}

// -----------------------------------------------------------------------------
// Limits
// -----------------------------------------------------------------------------

export const PURCHASE_ORDER_LIMITS = {
  notes: 2000,
  itemDescription: 2000,
  minItems: 1,
  maxItems: 100,
} as const;

// -----------------------------------------------------------------------------
// Input
// -----------------------------------------------------------------------------

export type PurchaseOrderItemRawInput = QuotationItemRawInput & {
  /**
   * ID of an existing line of the order being edited. With the same product
   * as that line, the database keeps the line's product snapshot (and its
   * price and description as defaults), even if the product is now inactive.
   * Missing or empty = a new selection.
   */
  lineId?: string;
};

export type PurchaseOrderRawInput = {
  vendorId: string;
  orderDate: string;
  /** Empty = no expected delivery date. */
  expectedDeliveryDate: string;
  notes: string;
  items: PurchaseOrderItemRawInput[];
};

export type PurchaseOrderItemInput = QuotationItemInput & {
  /** Lowercase UUID of an existing line, or null for a new selection. */
  lineId: string | null;
};

export type PurchaseOrderInput = {
  vendorId: string;
  orderDate: string;
  expectedDeliveryDate: string | null;
  notes: string | null;
  items: PurchaseOrderItemInput[];
};

export type PurchaseOrderField = "vendorId" | "orderDate" | "expectedDeliveryDate" | "notes" | "items";
export type PurchaseOrderFieldErrors = Partial<Record<PurchaseOrderField, string>>;
export type PurchaseOrderItemErrors = QuotationItemErrors & { lineId?: string };

export type PurchaseOrderValidationErrors = {
  fieldErrors: PurchaseOrderFieldErrors;
  /** Same index as the input items; undefined for items without errors. */
  itemErrors: (PurchaseOrderItemErrors | undefined)[];
};

export type PurchaseOrderValidationResult =
  | { ok: true; value: PurchaseOrderInput }
  | ({ ok: false } & PurchaseOrderValidationErrors);

const LINE_NOT_FOUND = "This line no longer exists. Reload the purchase order and try again.";

/** Validates and normalizes one item (quotation line rules + optional line ID). */
export function validatePurchaseOrderItem(
  raw: PurchaseOrderItemRawInput,
): { ok: true; value: PurchaseOrderItemInput } | { ok: false; errors: PurchaseOrderItemErrors } {
  const result = validateQuotationItem(raw);
  const errors: PurchaseOrderItemErrors = result.ok ? {} : { ...result.errors };

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
  fieldErrors: PurchaseOrderFieldErrors,
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

/** Validates and normalizes a whole purchase order (header and items). */
export function validatePurchaseOrderInput(raw: PurchaseOrderRawInput): PurchaseOrderValidationResult {
  const fieldErrors: PurchaseOrderFieldErrors = {};

  const vendorId = trimText(raw.vendorId);
  if (!vendorId) fieldErrors.vendorId = "Choose a vendor.";
  else if (!isUuid(vendorId)) fieldErrors.vendorId = "Choose a vendor from the list.";

  const { orderDate, expectedDeliveryDate } = validateDates(
    raw.orderDate,
    raw.expectedDeliveryDate,
    fieldErrors,
  );

  const notes = optionalText(raw.notes);
  if (notes && charLength(notes) > PURCHASE_ORDER_LIMITS.notes)
    fieldErrors.notes = tooLong(PURCHASE_ORDER_LIMITS.notes);

  const itemErrors: (PurchaseOrderItemErrors | undefined)[] = [];
  const items: PurchaseOrderItemInput[] = [];
  if (raw.items.length < PURCHASE_ORDER_LIMITS.minItems) fieldErrors.items = "Add at least one item.";
  else if (raw.items.length > PURCHASE_ORDER_LIMITS.maxItems)
    fieldErrors.items = `A purchase order can have at most ${PURCHASE_ORDER_LIMITS.maxItems} items.`;
  else {
    const seenLines = new Set<string>();
    for (const rawItem of raw.items) {
      const result = validatePurchaseOrderItem(rawItem);
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
      vendorId: vendorId.toLowerCase(),
      orderDate,
      expectedDeliveryDate,
      notes,
      items,
    },
  };
}

// -----------------------------------------------------------------------------
// RPC payloads
// -----------------------------------------------------------------------------

export type PurchaseOrderRpcItem = {
  id?: string;
  product_id: string;
  quantity: string;
  unit_price?: string;
  discount_amount: string;
  tax_rate: string;
  description?: string | null;
};

export type PurchaseOrderRpcArgs = {
  p_vendor_id: string;
  p_order_date: string;
  p_expected_delivery_date: string | null;
  p_notes: string | null;
  p_items: PurchaseOrderRpcItem[];
};

/**
 * Arguments for create_purchase_order() / update_purchase_order_draft(). Only
 * user-controlled values are sent; snapshots, line amounts and totals are
 * always computed by the database. Optional keys are omitted (not sent as
 * null) when the database should use the default value.
 */
export function toPurchaseOrderRpcArgs(input: PurchaseOrderInput): PurchaseOrderRpcArgs {
  return {
    p_vendor_id: input.vendorId,
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

