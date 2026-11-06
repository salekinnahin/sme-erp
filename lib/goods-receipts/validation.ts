import { isValidDate, QUANTITY_FORMAT } from "@/lib/quotations/validation";
import { parseDecimal, toScaled } from "@/lib/validation/decimal";
import { isUuid, optionalText } from "@/lib/validation/fields";
import { charLength, trimText } from "@/lib/validation/text";
import type { GoodsReceiptFailure } from "./errors";

export type GoodsReceiptInput = {
  purchaseOrderId: string;
  receivedDate: string;
  notes: string | null;
  items: { purchaseOrderItemId: string; receivedQuantity: string }[];
};
const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Runtime input validation and allowlisting; quantities never pass through floats. */
export function validateGoodsReceipt(raw: unknown):
  | { ok: true; value: GoodsReceiptInput }
  | { ok: false; reason: GoodsReceiptFailure } {
  if (!object(raw)) return { ok: false, reason: "invalid" };
  if (typeof raw.purchaseOrderId !== "string" || !isUuid(raw.purchaseOrderId))
    return { ok: false, reason: "not_found" };
  if (typeof raw.receivedDate !== "string" || !isValidDate(raw.receivedDate))
    return { ok: false, reason: "invalid_date" };
  if (raw.notes != null && typeof raw.notes !== "string") return { ok: false, reason: "invalid" };
  const notes = optionalText(raw.notes ?? "");
  if (notes && charLength(notes) > 2000) return { ok: false, reason: "invalid" };
  if (!Array.isArray(raw.items) || raw.items.length < 1 || raw.items.length > 100)
    return { ok: false, reason: "invalid" };
  const used = new Set<string>();
  const items: GoodsReceiptInput["items"] = [];
  for (const item of raw.items) {
    if (!object(item) || typeof item.purchaseOrderItemId !== "string" || !isUuid(item.purchaseOrderItemId))
      return { ok: false, reason: "line_not_found" };
    const id = item.purchaseOrderItemId.toLowerCase();
    if (used.has(id)) return { ok: false, reason: "invalid" };
    used.add(id);
    if (typeof item.receivedQuantity !== "string") return { ok: false, reason: "invalid_quantity" };
    const quantity = parseDecimal(trimText(item.receivedQuantity), QUANTITY_FORMAT);
    if (!quantity.ok || toScaled(quantity.value, 3) <= BigInt(0))
      return { ok: false, reason: "invalid_quantity" };
    items.push({ purchaseOrderItemId: id, receivedQuantity: quantity.value });
  }
  return { ok: true, value: { purchaseOrderId: raw.purchaseOrderId.toLowerCase(), receivedDate: raw.receivedDate, notes, items } };
}
export function toGoodsReceiptRpcArgs(input: GoodsReceiptInput) {
  return {
    p_purchase_order_id: input.purchaseOrderId, p_received_date: input.receivedDate, p_notes: input.notes,
    p_items: input.items.map((item) => ({ purchase_order_item_id: item.purchaseOrderItemId, received_quantity: item.receivedQuantity })),
  };
}
