import { createClient } from "@/lib/supabase/server";
import type { TenantContext } from "@/lib/tenancy/context";
import { isUuid } from "@/lib/validation/fields";
import { isReceivableStatus, receivingLineFailure, type ReceivingLine } from "./calculations";
import { goodsReceiptFailure, type GoodsReceiptFailure } from "./errors";
import { canGoodsReceipt } from "./permissions";
import { toGoodsReceiptRpcArgs, validateGoodsReceipt } from "./validation";

type Tenant = Pick<TenantContext, "organization" | "role">;
export type GoodsReceipt = {
  id: string; organization_id: string; goods_receipt_number: string;
  purchase_order_id: string; purchase_order_number: string; received_date: string;
  notes: string | null; created_by: string; created_at: string; updated_at: string;
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
    const { data: po, error: poError } = await db.from("purchase_orders").select("status")
      .eq("organization_id", tenant.organization.id).eq("id", input.purchaseOrderId).maybeSingle<{ status: string }>();
    if (poError) return { ok: false, reason: "failed" };
    if (!po) return { ok: false, reason: "not_found" };
    if (!isReceivableStatus(po.status)) return { ok: false, reason: "not_receivable" };
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
