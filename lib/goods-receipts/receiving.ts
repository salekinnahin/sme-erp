import { formatCalendarDate } from "@/lib/format";
import { isValidDate, QUANTITY_FORMAT } from "@/lib/quotations/validation";
import type { Role } from "@/lib/tenancy/context";
import { parseDecimal, toScaled } from "@/lib/validation/decimal";
import { isUuid } from "@/lib/validation/fields";
import { charLength, trimText } from "@/lib/validation/text";
import { isReceivableStatus, type ReceivingLine } from "./calculations";
import { canGoodsReceipt } from "./permissions";

/**
 * Pure receiving presentation and form rules (Goods Receiving Part 2 UI).
 * Safe for client components: no database access. Every rule here is a
 * friendly preview; create_goods_receipt() re-checks all of them under the
 * purchase order lock, so the database stays authoritative when another
 * user receives at the same time. Quantities are exact decimal strings.
 */

export const RECEIPT_NOTES_MAX_LENGTH = 2000;
export const RECEIPT_MAX_LINES = 100;

/** open: can receive now; complete: remaining 0; service: never received; unknown: legacy type. */
export type ReceivingLineState = "open" | "complete" | "service" | "unknown";

export function receivingLineState(line: Pick<ReceivingLine, "product_type" | "remaining_quantity">): ReceivingLineState {
  if (line.product_type === null) return "unknown";
  if (line.product_type === "service") return "service";
  return toScaled(line.remaining_quantity, 3) > BigInt(0) ? "open" : "complete";
}

/**
 * Whether the receive form can be used for a purchase order.
 *   open                 ordered / partially received with something left to receive
 *   complete             every receivable line fully received (or PO received)
 *   not_receivable       draft or cancelled
 *   needs_reconciliation legacy lines with unknown product type (Part 1 blocks them)
 *   nothing_receivable   service-only order: nothing physical to receive
 */
export type ReceivingAvailability = "open" | "complete" | "not_receivable" | "needs_reconciliation" | "nothing_receivable";

export function receivingAvailability(status: string, lines: readonly ReceivingLine[]): ReceivingAvailability {
  if (status === "received") return "complete";
  if (!isReceivableStatus(status)) return "not_receivable";
  const states = lines.map(receivingLineState);
  if (states.includes("unknown")) return "needs_reconciliation";
  if (!states.some((s) => s === "open" || s === "complete")) return "nothing_receivable";
  return states.includes("open") ? "open" : "complete";
}

export const RECEIVING_AVAILABILITY_MESSAGES: Record<Exclude<ReceivingAvailability, "open">, string> = {
  complete: "All receivable goods have already been received.",
  not_receivable: "Goods can only be received for ordered or partially received purchase orders.",
  needs_reconciliation: "This historical order needs its product types reconciled before goods can be received.",
  nothing_receivable: "This purchase order has only service lines, so there are no goods to receive.",
};

/** Shown in the purchase order PageHeader only when something can be received now. */
export function receiveGoodsAction(role: Role, status: string, lines: readonly ReceivingLine[]): { label: string } | null {
  if (!canGoodsReceipt(role, "create") || receivingAvailability(status, lines) !== "open") return null;
  return { label: status === "partially_received" ? "Receive remaining goods" : "Receive goods" };
}

/** The receiving summary is shown once a PO has been ordered (not for drafts or cancelled orders). */
export function showsReceivingSummary(status: string): boolean {
  return status === "ordered" || status === "partially_received" || status === "received";
}

/**
 * Any goods receipt prevents cancellation (Part 1 rule, enforced by the
 * database). Drops the cancel action from the PO header once history exists.
 */
export function withoutCancelAfterReceipt<T extends { status: string }>(actions: readonly T[], receiptCount: number): T[] {
  return receiptCount > 0 ? actions.filter((a) => a.status !== "cancelled") : [...actions];
}

// -----------------------------------------------------------------------------
// Form rules
// -----------------------------------------------------------------------------

export type ReceivingEntry = { purchaseOrderItemId: string; receivedQuantity: string };
export type ReceivingItem = { purchaseOrderItemId: string; receivedQuantity: string };
export type ReceivingFieldErrors = { receivedDate?: string; notes?: string; items?: string };
export type ReceivingLineErrors = Record<string, string>;

export const QUANTITY_FORMAT_ERROR = "Enter a quantity with at most 3 decimal places.";
export const NO_QUANTITY_ERROR = "Enter a quantity to receive for at least one line.";
export const NOT_RECEIVABLE_LINE_ERROR = "This line can't be received.";
export const maxQuantityError = (remaining: string) => `You can receive a maximum of ${remaining}.`;

/**
 * Blank and zero quantities are omitted (the line is simply not part of this
 * receipt). Anything else must be a positive decimal with at most 3
 * decimals. Never converts through floating point.
 */
export function normalizeReceivingEntries(entries: readonly ReceivingEntry[]):
  { items: ReceivingItem[]; lineErrors: ReceivingLineErrors } {
  const items: ReceivingItem[] = [];
  const lineErrors: ReceivingLineErrors = {};
  for (const entry of entries) {
    const raw = trimText(entry.receivedQuantity);
    if (raw === "") continue;
    const parsed = parseDecimal(raw, QUANTITY_FORMAT);
    if (!parsed.ok) {
      lineErrors[entry.purchaseOrderItemId] = QUANTITY_FORMAT_ERROR;
      continue;
    }
    if (toScaled(parsed.value, 3) === BigInt(0)) continue;
    items.push({ purchaseOrderItemId: entry.purchaseOrderItemId, receivedQuantity: parsed.value });
  }
  return { items, lineErrors };
}

/** Received date: required, a real calendar date, not before the PO order date. No future limit. */
export function receivedDateError(receivedDate: string, orderDate: string | null): string | undefined {
  if (trimText(receivedDate) === "") return "Enter the received date.";
  if (!isValidDate(receivedDate)) return "Enter a valid received date.";
  if (orderDate && receivedDate < orderDate)
    return `The received date can't be before the order date (${formatCalendarDate(orderDate)}).`;
  return undefined;
}

export type ReceivingFormInput = {
  receivedDate: string;
  notes: string;
  /** Raw "Receive now" values keyed by purchase order line ID. */
  quantities: Readonly<Record<string, string>>;
};

export type ReceivingFormResult =
  | { ok: true; items: ReceivingItem[]; notes: string | null }
  | { ok: false; fieldErrors: ReceivingFieldErrors; lineErrors: ReceivingLineErrors };

/**
 * Full preview validation against the receiving summary the page loaded:
 * quantity only for selected lines, > 0, <= remaining, max 3 decimals; only
 * open lines are accepted. The payload contains only lines with a positive
 * quantity.
 */
export function validateReceivingForm(input: ReceivingFormInput, lines: readonly ReceivingLine[], orderDate: string): ReceivingFormResult {
  const fieldErrors: ReceivingFieldErrors = {};
  const dateError = receivedDateError(input.receivedDate, orderDate);
  if (dateError) fieldErrors.receivedDate = dateError;
  const notes = trimText(input.notes);
  if (charLength(notes) > RECEIPT_NOTES_MAX_LENGTH) fieldErrors.notes = `Notes can be at most ${RECEIPT_NOTES_MAX_LENGTH} characters.`;

  const byId = new Map(lines.map((line) => [line.purchase_order_item_id, line]));
  const entries = Object.entries(input.quantities).map(([purchaseOrderItemId, receivedQuantity]) => ({ purchaseOrderItemId, receivedQuantity }));
  const { items: candidates, lineErrors } = normalizeReceivingEntries(entries);
  const items: ReceivingItem[] = [];
  for (const item of candidates) {
    const line = byId.get(item.purchaseOrderItemId);
    if (!line || receivingLineState(line) !== "open") {
      lineErrors[item.purchaseOrderItemId] = NOT_RECEIVABLE_LINE_ERROR;
    } else if (toScaled(item.receivedQuantity, 3) > toScaled(line.remaining_quantity, 3)) {
      lineErrors[item.purchaseOrderItemId] = maxQuantityError(line.remaining_quantity);
    } else items.push(item);
  }
  if (items.length === 0 && Object.keys(lineErrors).length === 0) fieldErrors.items = NO_QUANTITY_ERROR;

  if (Object.keys(fieldErrors).length || Object.keys(lineErrors).length) return { ok: false, fieldErrors, lineErrors };
  // Payload follows the purchase order line order, not input key order.
  const order = new Map(lines.map((line, index) => [line.purchase_order_item_id, index]));
  items.sort((a, b) => (order.get(a.purchaseOrderItemId) ?? 0) - (order.get(b.purchaseOrderItemId) ?? 0));
  return { ok: true, items, notes: notes || null };
}

/**
 * Reads the hidden "items" JSON the receive form posts: an array of
 * { purchaseOrderItemId, receivedQuantity } strings. Only those two fields
 * are kept; product IDs, snapshots, organization and anything else the
 * browser might add are ignored. Null if unreadable.
 */
export function parseReceivingItemsField(raw: FormDataEntryValue | null): ReceivingEntry[] | null {
  if (typeof raw !== "string" || raw.length > 20_000) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(value) || value.length > RECEIPT_MAX_LINES) return null;
  const entries: ReceivingEntry[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) return null;
    const { purchaseOrderItemId, receivedQuantity } = item as Record<string, unknown>;
    if (typeof purchaseOrderItemId !== "string" || !isUuid(purchaseOrderItemId) || typeof receivedQuantity !== "string") return null;
    const id = purchaseOrderItemId.toLowerCase();
    if (seen.has(id)) return null;
    seen.add(id);
    entries.push({ purchaseOrderItemId: id, receivedQuantity });
  }
  return entries;
}

export const RECEIVED_BY_UNKNOWN = "Name not recorded";

/**
 * The recorder name stored on the receipt (snapshot, DECISIONS 032). Never
 * read from live profiles. Receipts recorded by a user without a profile
 * name, or before the snapshot existed, show a neutral placeholder.
 */
export function receivedByDisplay(receivedByName: string | null | undefined): string {
  return receivedByName?.trim() ? receivedByName : RECEIVED_BY_UNKNOWN;
}

/** An exact quantity string with thousands grouping and all its decimals: "1234.500" -> "1,234.500". */
export function exactQuantity(quantity: string): string {
  const [intPart, fracPart] = quantity.split(".");
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return fracPart === undefined ? grouped : `${grouped}.${fracPart}`;
}
