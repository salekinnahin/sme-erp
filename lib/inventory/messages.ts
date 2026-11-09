import type { StockMovementType, StockSourceType } from "./types";

export const STOCK_MOVEMENT_TYPE_LABELS: Record<StockMovementType, string> = {
  goods_receipt: "Goods receipt",
};

export const STOCK_SOURCE_TYPE_LABELS: Record<StockSourceType, string> = {
  goods_receipt: "Goods receipt",
};

/** Safe read failures; database details are never passed on. */
export const INVENTORY_MESSAGES = {
  stockLoadFailed: "Could not load stock.",
  movementsLoadFailed: "Could not load stock movements.",
} as const;
