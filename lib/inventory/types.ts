import type { ProductStatus, ProductType } from "@/lib/products/validation";

/**
 * Stock ledger types (docs/DECISIONS.md 033). The database is authoritative:
 * these lists mirror the stock_movements CHECK constraints and are only used
 * to validate what the read RPCs return. Adding a movement type needs a new
 * migration first.
 */
export const STOCK_MOVEMENT_TYPES = ["goods_receipt"] as const;
export type StockMovementType = (typeof STOCK_MOVEMENT_TYPES)[number];

export const STOCK_SOURCE_TYPES = ["goods_receipt"] as const;
export type StockSourceType = (typeof STOCK_SOURCE_TYPES)[number];

export function isStockMovementType(value: unknown): value is StockMovementType {
  return (STOCK_MOVEMENT_TYPES as readonly unknown[]).includes(value);
}

export function isStockSourceType(value: unknown): value is StockSourceType {
  return (STOCK_SOURCE_TYPES as readonly unknown[]).includes(value);
}

/** One stock-bearing product with its current balance. */
export type CurrentStockItem = {
  productId: string;
  /** Current product master data (not a snapshot). */
  productName: string;
  sku: string;
  unit: string;
  productType: ProductType;
  productStatus: ProductStatus;
  /** SUM of all movements: exact decimal string with 3 decimals, never a JS number. */
  quantity: string;
  /**
   * False when the product's current type is no longer `inventory` but it
   * still has recorded movements (its stock is shown, never hidden).
   */
  stockTracked: boolean;
};

/** The document that produced a movement. */
export type StockMovementSource = {
  type: StockSourceType;
  id: string;
  lineId: string;
  /** e.g. the GR number; null if the caller cannot read the source document. */
  documentNumber: string | null;
  href: string;
};

/** One immutable ledger entry. Product display values are snapshots. */
export type StockMovement = {
  id: string;
  productId: string;
  productName: string;
  sku: string;
  unit: string;
  type: StockMovementType;
  /** Signed exact decimal string: positive = stock in, negative = stock out. */
  quantityDelta: string;
  direction: "in" | "out";
  source: StockMovementSource;
  /** Business date (YYYY-MM-DD), e.g. the goods receipt's received date. */
  occurredOn: string;
  /** Database insertion time. */
  createdAt: string;
};

export type InventoryPage<T> = {
  items: T[];
  /** Matching rows across all pages. Null if the page is past the end. */
  total: number | null;
  page: number;
  pageSize: number;
};
