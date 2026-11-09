import { createClient } from "@/lib/supabase/server";
import type { TenantContext } from "@/lib/tenancy/context";
import { isUuid } from "@/lib/validation/fields";
import { STOCK_MOVEMENT_PAGE_SIZE, toListStockMovementsArgs, type StockMovementParams } from "./list-params";
import { INVENTORY_MESSAGES } from "./messages";
import { canViewInventory } from "./permissions";
import { parseStockQuantity, stockQuantityDirection } from "./quantity";
import {
  isStockMovementType,
  isStockSourceType,
  type InventoryPage,
  type StockMovement,
  type StockMovementSource,
  type StockSourceType,
} from "./types";

/**
 * Stock movement history (read-only; movements are created only by the
 * database from source documents). list_stock_movements() is SECURITY
 * INVOKER with RLS; the organization comes from the session tenant.
 */

type Tenant = Pick<TenantContext, "organization" | "role">;

export type StockMovementRow = {
  movement_id: string;
  product_id: string;
  product_name_snapshot: string;
  sku_snapshot: string;
  unit_snapshot: string;
  movement_type: string;
  quantity_delta: string;
  source_type: string;
  source_id: string;
  source_line_id: string;
  source_document_number: string | null;
  occurred_on: string;
  created_at: string;
  total_count: number | string;
};

const SOURCE_HREFS: Record<StockSourceType, (id: string) => string> = {
  goods_receipt: (id) => `/goods-receipts/${id}`,
};

/** Maps a movement's source keys to its document reference and link. */
export function toStockMovementSource(
  type: StockSourceType,
  id: string,
  lineId: string,
  documentNumber: string | null,
): StockMovementSource {
  return { type, id, lineId, documentNumber, href: SOURCE_HREFS[type](id) };
}

/** Validates one database row; throws on anything unexpected (fail closed). */
export function toStockMovement(row: StockMovementRow): StockMovement {
  if (!isStockMovementType(row.movement_type) || !isStockSourceType(row.source_type)
    || ![row.movement_id, row.product_id, row.source_id, row.source_line_id].every((id) => isUuid(String(id)))) {
    throw new Error("Invalid stock movement row.");
  }
  const quantityDelta = parseStockQuantity(row.quantity_delta);
  return {
    id: row.movement_id,
    productId: row.product_id,
    productName: row.product_name_snapshot,
    sku: row.sku_snapshot,
    unit: row.unit_snapshot,
    type: row.movement_type,
    quantityDelta,
    direction: stockQuantityDirection(quantityDelta),
    source: toStockMovementSource(row.source_type, row.source_id, row.source_line_id, row.source_document_number),
    occurredOn: row.occurred_on,
    createdAt: row.created_at,
  };
}

/** One page of movements, newest first (business date, then creation). */
export async function listStockMovements(tenant: Tenant, params: StockMovementParams): Promise<InventoryPage<StockMovement>> {
  if (!canViewInventory(tenant.role)) return { items: [], total: 0, page: params.page, pageSize: STOCK_MOVEMENT_PAGE_SIZE };
  const db = await createClient();
  const { data, error } = await db.rpc("list_stock_movements", toListStockMovementsArgs(tenant.organization.id, params));
  if (error) throw new Error(INVENTORY_MESSAGES.movementsLoadFailed);
  const rows = (data ?? []) as StockMovementRow[];
  let items: StockMovement[];
  try {
    items = rows.map(toStockMovement);
  } catch {
    throw new Error(INVENTORY_MESSAGES.movementsLoadFailed);
  }
  return {
    items,
    total: rows.length ? Number(rows[0].total_count) : params.page === 1 ? 0 : null,
    page: params.page,
    pageSize: STOCK_MOVEMENT_PAGE_SIZE,
  };
}
