import { createClient } from "@/lib/supabase/server";
import type { TenantContext } from "@/lib/tenancy/context";
import { isProductStatus, isProductType } from "@/lib/products/validation";
import { isUuid } from "@/lib/validation/fields";
import {
  CURRENT_STOCK_PAGE_SIZE,
  toListCurrentStockArgs,
  toProductStockArgs,
  type CurrentStockParams,
  type ListCurrentStockArgs,
} from "./list-params";
import { INVENTORY_MESSAGES } from "./messages";
import { canViewInventory } from "./permissions";
import { parseStockQuantity } from "./quantity";
import type { CurrentStockItem, InventoryPage } from "./types";

/**
 * Current stock reads (read-only; there is deliberately no write function in
 * this module). list_current_stock() is SECURITY INVOKER: RLS limits rows to
 * the caller's active organization, and the organization argument always
 * comes from the session tenant (requireTenant()).
 */

type Tenant = Pick<TenantContext, "organization" | "role">;

export type CurrentStockRow = {
  product_id: string;
  product_name: string;
  sku: string;
  unit: string;
  product_type: string;
  product_status: string;
  current_quantity: string;
  total_count: number | string;
};

/** Validates one database row; throws on anything unexpected (fail closed). */
export function toCurrentStockItem(row: CurrentStockRow): CurrentStockItem {
  if (!isUuid(String(row.product_id)) || !isProductType(row.product_type) || !isProductStatus(row.product_status)) {
    throw new Error("Invalid current stock row.");
  }
  return {
    productId: row.product_id,
    productName: row.product_name,
    sku: row.sku,
    unit: row.unit,
    productType: row.product_type,
    productStatus: row.product_status,
    quantity: parseStockQuantity(row.current_quantity),
    stockTracked: row.product_type === "inventory",
  };
}

async function readCurrentStock(args: ListCurrentStockArgs): Promise<CurrentStockRow[]> {
  const db = await createClient();
  const { data, error } = await db.rpc("list_current_stock", args);
  if (error) throw new Error(INVENTORY_MESSAGES.stockLoadFailed);
  return (data ?? []) as CurrentStockRow[];
}

function mapRows(rows: CurrentStockRow[]): CurrentStockItem[] {
  try {
    return rows.map(toCurrentStockItem);
  } catch {
    throw new Error(INVENTORY_MESSAGES.stockLoadFailed);
  }
}

/**
 * One page of stock-bearing products (current type inventory, plus any product
 * that has movements), including products with zero stock.
 */
export async function listCurrentStock(tenant: Tenant, params: CurrentStockParams): Promise<InventoryPage<CurrentStockItem>> {
  const empty = { items: [], total: 0, page: params.page, pageSize: CURRENT_STOCK_PAGE_SIZE };
  if (!canViewInventory(tenant.role)) return empty;
  const rows = await readCurrentStock(toListCurrentStockArgs(tenant.organization.id, params));
  return {
    items: mapRows(rows),
    // total_count is a bigint; PostgREST may send it as a string.
    total: rows.length ? Number(rows[0].total_count) : params.page === 1 ? 0 : null,
    page: params.page,
    pageSize: CURRENT_STOCK_PAGE_SIZE,
  };
}

/**
 * One product's current stock, or null when it is not stock-bearing (service
 * or non-inventory without movements), unknown, malformed or of another
 * organization (indistinguishable).
 */
export async function getProductStock(tenant: Tenant, productId: string): Promise<CurrentStockItem | null> {
  if (!canViewInventory(tenant.role) || !isUuid(productId)) return null;
  const rows = await readCurrentStock(toProductStockArgs(tenant.organization.id, productId));
  return mapRows(rows)[0] ?? null;
}
