export type GoodsReceiptFailure =
  | "not_found" | "not_receivable" | "line_not_found" | "service"
  | "over_receiving" | "fully_received" | "conflict" | "invalid_date"
  | "invalid_quantity" | "forbidden" | "invalid" | "unknown_product_type"
  | "product_not_inventory" | "failed";

/** Allowlisted SQLSTATEs; never send database details to a future UI. */
export function goodsReceiptFailure(error: { code?: string }): GoodsReceiptFailure {
  switch (error.code) {
    case "P0002": return "not_found";
    case "55000": return "not_receivable";
    case "GR001": return "line_not_found"; // Missing/foreign-PO/foreign-tenant look identical.
    case "GR002": return "service";
    case "GR003": return "over_receiving";
    case "GR004": return "fully_received";
    case "GR006": return "unknown_product_type";
    case "GR007": case "22007": case "22008": return "invalid_date";
    case "GR008": return "invalid_quantity";
    case "ST004": return "product_not_inventory"; // Stock posting: product retyped away from inventory.
    case "40001": case "40P01": case "55P03": return "conflict";
    case "42501": return "forbidden";
    case "22023": case "22003": case "22P02": case "23514": case "23502": return "invalid";
    default: return "failed";
  }
}
export const GOODS_RECEIPT_MESSAGES: Record<GoodsReceiptFailure, string> = {
  not_found: "Purchase order not found.",
  not_receivable: "This purchase order can no longer receive goods. Reload it to check its status.",
  line_not_found: "A selected line was not found on this purchase order. Reload and select its lines again.",
  service: "Service lines cannot be physically received.",
  over_receiving: "The quantity exceeds what remains to be received. Reload the receiving summary.",
  fully_received: "This line has already been fully received.",
  conflict: "Another receiving operation changed this order. Reload the summary and try again.",
  invalid_date: "Enter a valid received date.",
  invalid_quantity: "Enter a positive quantity with at most 3 decimal places.",
  forbidden: "You do not have permission to receive goods in this organization.",
  invalid: "Check the receipt details and select 1 to 100 different purchase order lines.",
  unknown_product_type: "This historical order needs its product types reconciled before receiving.",
  product_not_inventory: "This product is no longer classified as inventory. Restore its type before receiving inventory goods.",
  failed: "Could not record the goods receipt. Please try again.",
};
