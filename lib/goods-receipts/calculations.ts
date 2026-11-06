import { fromScaled, toScaled } from "@/lib/validation/decimal";
import type { GoodsReceiptFailure } from "./errors";

export type ReceivingLine = {
  purchase_order_item_id: string;
  product_id: string;
  product_name: string;
  sku: string;
  description: string | null;
  unit: string;
  product_type: "inventory" | "non_inventory" | "service" | null;
  receivable: boolean;
  ordered_quantity: string;
  received_quantity: string;
  remaining_quantity: string;
  sort_order: number;
};
export function isReceivableStatus(status: string): boolean {
  return status === "ordered" || status === "partially_received";
}
/** For previews; the database always recalculates under the PO lock. */
export function remainingQuantity(ordered: string, received: readonly string[]): string {
  const remaining = toScaled(ordered, 3) - received.reduce((sum, q) => sum + toScaled(q, 3), BigInt(0));
  if (remaining < BigInt(0)) throw new Error("Received quantity exceeds ordered quantity.");
  return fromScaled(remaining, 3);
}
export function receivingLineFailure(line: ReceivingLine | undefined, quantity: string): GoodsReceiptFailure | null {
  if (!line) return "line_not_found";
  if (line.product_type === null) return "unknown_product_type";
  if (line.product_type === "service") return "service";
  const remaining = toScaled(line.remaining_quantity, 3);
  if (remaining === BigInt(0)) return "fully_received";
  return toScaled(quantity, 3) > remaining ? "over_receiving" : null;
}
