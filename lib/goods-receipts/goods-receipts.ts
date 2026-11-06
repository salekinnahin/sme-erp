import { createClient } from "@/lib/supabase/server";
import type { TenantContext } from "@/lib/tenancy/context";
import { isUuid } from "@/lib/validation/fields";
import { isReceivableStatus, receivingLineFailure, type ReceivingLine } from "./calculations";
import { goodsReceiptFailure, type GoodsReceiptFailure } from "./errors";
import { canGoodsReceipt } from "./permissions";
import {
  GOODS_RECEIPT_PAGE_SIZE,
  RECEIPT_HISTORY_LIMIT,
  toListGoodsReceiptsArgs,
  toReceiptHistoryArgs,
  type GoodsReceiptListParams,
} from "./list-params";
import { toGoodsReceiptRpcArgs, validateGoodsReceipt } from "./validation";

type Tenant = Pick<TenantContext, "organization" | "role">;
export type GoodsReceipt = {
  id: string; organization_id: string; goods_receipt_number: string;
  purchase_order_id: string; purchase_order_number: string; received_date: string;
  notes: string | null; created_by: string;
  /** Recorder name snapshot taken by the database at creation; null if no trusted name existed. */
  received_by_name: string | null; created_at: string; updated_at: string;
  items: {
    id: string; purchase_order_item_id: string; product_id: string; product_name: string;
    sku: string; description: string | null; unit: string; product_type: "inventory" | "non_inventory";
    ordered_quantity_snapshot: string; received_quantity: string; sort_order: number; created_at: string;
  }[];
};
export type GoodsReceiptResult = { ok: true; goodsReceiptId: string } | { ok: false; reason: GoodsReceiptFailure };

/** Caller supplies the authenticated tenant from requireTenant(), never browser organization input. */
export async function createGoodsReceipt(tenant: Tenant, raw: unknown): Promise<GoodsReceiptResult> {
  if (!canGoodsReceipt(tenant.role, "create")) return { ok: false, reason: "forbidden" };
  const validated = validateGoodsReceipt(raw);
  if (!validated.ok) return validated;
  const input = validated.value;
  try {
    const db = await createClient();
    // Explicit tenant pre-check prevents accidentally receiving another organization
    // for a user who belongs to multiple organizations. RPC independently authorizes.
    const { data: po, error: poError } = await db.from("purchase_orders").select("status, order_date")
      .eq("organization_id", tenant.organization.id).eq("id", input.purchaseOrderId).maybeSingle<{ status: string; order_date: string }>();
    if (poError) return { ok: false, reason: "failed" };
    if (!po) return { ok: false, reason: "not_found" };
    if (!isReceivableStatus(po.status)) return { ok: false, reason: "not_receivable" };
    // Same rule as the GR007 check; ISO dates compare correctly as text.
    if (input.receivedDate < po.order_date) return { ok: false, reason: "invalid_date" };
    const { data, error: summaryError } = await db.rpc("get_purchase_order_receiving_summary", {
      p_organization_id: tenant.organization.id, p_purchase_order_id: input.purchaseOrderId,
    });
    if (summaryError) return { ok: false, reason: "failed" };
    const lines = (data ?? []) as ReceivingLine[];
    if (lines.some((line) => line.product_type === null)) return { ok: false, reason: "unknown_product_type" };
    for (const item of input.items) {
      const reason = receivingLineFailure(lines.find((line) => line.purchase_order_item_id === item.purchaseOrderItemId), item.receivedQuantity);
      if (reason) return { ok: false, reason };
    }
    const { data: id, error } = await db.rpc("create_goods_receipt", toGoodsReceiptRpcArgs(input));
    if (error) return { ok: false, reason: goodsReceiptFailure(error) };
    return { ok: true, goodsReceiptId: id as string };
  } catch {
    return { ok: false, reason: "failed" };
  }
}

export async function getGoodsReceipt(tenant: Tenant, id: string): Promise<GoodsReceipt | null> {
  if (!canGoodsReceipt(tenant.role, "view") || !isUuid(id)) return null;
  const db = await createClient();
  const { data, error } = await db.rpc("get_goods_receipt", { p_organization_id: tenant.organization.id, p_goods_receipt_id: id });
  if (error) throw new Error("Could not load goods receipt.");
  return data as GoodsReceipt | null;
}
export async function getPurchaseOrderReceivingSummary(tenant: Tenant, id: string): Promise<ReceivingLine[]> {
  if (!canGoodsReceipt(tenant.role, "view") || !isUuid(id)) return [];
  const db = await createClient();
  const { data, error } = await db.rpc("get_purchase_order_receiving_summary", { p_organization_id: tenant.organization.id, p_purchase_order_id: id });
  if (error) throw new Error("Could not load receiving summary.");
  return (data ?? []) as ReceivingLine[];
}

// -----------------------------------------------------------------------------
// Part 2 reads (UI). All tenant-scoped: organization from requireTenant(),
// RLS in the database. Quantities stay decimal strings.
// -----------------------------------------------------------------------------

/** A receipt with its source purchase order's vendor snapshot (for detail and print). */
export type GoodsReceiptDocument = GoodsReceipt & {
  vendor: {
    name: string; companyName: string | null; phone: string | null; email: string | null;
    address: string | null; taxNumber: string | null;
  };
};

/**
 * One sealed receipt of the tenant plus its PO vendor snapshot, or null for
 * malformed, unknown or other organizations' IDs (indistinguishable). Two
 * reads (receipt, then the PO header by the ID the database returned).
 */
export async function getGoodsReceiptDocument(tenant: Tenant, id: string): Promise<GoodsReceiptDocument | null> {
  const receipt = await getGoodsReceipt(tenant, id);
  if (!receipt) return null;
  const db = await createClient();
  const { data: po, error } = await db.from("purchase_orders")
    .select("vendor_name, vendor_company_name, vendor_phone, vendor_email, vendor_address, vendor_tax_number")
    .eq("organization_id", tenant.organization.id).eq("id", receipt.purchase_order_id)
    .maybeSingle<{ vendor_name: string; vendor_company_name: string | null; vendor_phone: string | null;
      vendor_email: string | null; vendor_address: string | null; vendor_tax_number: string | null }>();
  if (error || !po) throw new Error("Could not load goods receipt.");
  return {
    ...receipt,
    vendor: {
      name: po.vendor_name, companyName: po.vendor_company_name, phone: po.vendor_phone,
      email: po.vendor_email, address: po.vendor_address, taxNumber: po.vendor_tax_number,
    },
  };
}

export type GoodsReceiptListItem = {
  id: string;
  goodsReceiptNumber: string;
  purchaseOrderId: string;
  purchaseOrderNumber: string;
  vendorName: string;
  vendorCompanyName: string | null;
  receivedDate: string;
  /** Number of receipt lines (never a quantity sum across units). */
  itemCount: number;
  receivedByName: string | null;
  createdAt: string;
};

export type GoodsReceiptList = {
  items: GoodsReceiptListItem[];
  /** Matching rows across all pages. Null if the page is past the end. */
  total: number | null;
  page: number;
  pageSize: number;
};

type GoodsReceiptListRow = {
  id: string; goods_receipt_number: string; purchase_order_id: string; purchase_order_number: string;
  vendor_name: string; vendor_company_name: string | null; received_date: string;
  item_count: number; received_by_name: string | null; created_at: string;
  total_count: number | string;
};

function toListItem(row: GoodsReceiptListRow): GoodsReceiptListItem {
  return {
    id: row.id,
    goodsReceiptNumber: row.goods_receipt_number,
    purchaseOrderId: row.purchase_order_id,
    purchaseOrderNumber: row.purchase_order_number,
    vendorName: row.vendor_name,
    vendorCompanyName: row.vendor_company_name,
    receivedDate: row.received_date,
    itemCount: Number(row.item_count),
    receivedByName: row.received_by_name,
    createdAt: row.created_at,
  };
}

/** One page of receipts (list_goods_receipts(): invoker, RLS, explicit organization filter). */
export async function listGoodsReceipts(tenant: Tenant, params: GoodsReceiptListParams): Promise<GoodsReceiptList> {
  if (!canGoodsReceipt(tenant.role, "view")) return { items: [], total: 0, page: params.page, pageSize: GOODS_RECEIPT_PAGE_SIZE };
  const db = await createClient();
  const { data, error } = await db.rpc("list_goods_receipts", toListGoodsReceiptsArgs(tenant.organization.id, params));
  if (error) throw new Error("Could not load goods receipts.");
  const rows = (data ?? []) as GoodsReceiptListRow[];
  return {
    items: rows.map(toListItem),
    // total_count is a bigint; PostgREST may send it as a string.
    total: rows.length ? Number(rows[0].total_count) : params.page === 1 ? 0 : null,
    page: params.page,
    pageSize: GOODS_RECEIPT_PAGE_SIZE,
  };
}

/** A purchase order's receipt history (newest first) and total, in one query. */
export async function listPurchaseOrderGoodsReceipts(tenant: Tenant, purchaseOrderId: string):
  Promise<{ items: GoodsReceiptListItem[]; total: number; limit: number }> {
  if (!canGoodsReceipt(tenant.role, "view") || !isUuid(purchaseOrderId)) return { items: [], total: 0, limit: RECEIPT_HISTORY_LIMIT };
  const db = await createClient();
  const { data, error } = await db.rpc("list_goods_receipts", toReceiptHistoryArgs(tenant.organization.id, purchaseOrderId));
  if (error) throw new Error("Could not load goods receipts.");
  const rows = (data ?? []) as GoodsReceiptListRow[];
  return { items: rows.map(toListItem), total: rows.length ? Number(rows[0].total_count) : 0, limit: RECEIPT_HISTORY_LIMIT };
}
