import { lineAmountErrors } from "@/lib/quotations/validation";
import { createClient } from "@/lib/supabase/server";
import type { TenantContext } from "@/lib/tenancy/context";
import { isUuid } from "@/lib/validation/fields";
import { calculateLine, calculateTotals, type LineAmounts } from "./calculations";
import { purchaseOrderWriteFailure, type PurchaseOrderWriteFailure } from "./errors";
import { PURCHASE_ORDER_STATUS_ACTIONS, canPurchaseOrder } from "./permissions";
import {
  toPurchaseOrderRpcArgs,
  isPurchaseOrderReceivingStatus,
  type PurchaseOrderFieldErrors,
  type PurchaseOrderInput,
  type PurchaseOrderItemErrors,
  type PurchaseOrderStatus,
  type PurchaseOrderUserTargetStatus,
} from "./validation";

/**
 * Purchase order domain functions. Callers pass the tenant from requireTenant();
 * the organization is never taken from request input.
 *
 * A purchase order document is read in one statement (get_purchase_order(),
 * DECISIONS 020). Writes only go through the database functions
 * create_purchase_order(),
 * update_purchase_order_draft() and set_purchase_order_status(), which re-check
 * membership, role, status, references and every amount. The checks here
 * exist for early, friendly per-field errors.
 *
 * Money and quantities are decimal strings end to end.
 */

type Tenant = Pick<TenantContext, "organization" | "role">;
type Supabase = Awaited<ReturnType<typeof createClient>>;

export type PurchaseOrderItem = {
  id: string;
  productId: string;
  productName: string;
  sku: string;
  description: string | null;
  unit: string;
  quantity: string;
  unitPrice: string;
  discountAmount: string;
  taxRate: string;
  taxAmount: string;
  lineTotal: string;
  sortOrder: number;
};

export type PurchaseOrder = {
  id: string;
  purchaseOrderNumber: string;
  vendorId: string;
  vendorName: string;
  vendorCompanyName: string | null;
  vendorPhone: string | null;
  vendorEmail: string | null;
  vendorAddress: string | null;
  vendorTaxNumber: string | null;
  orderDate: string;
  expectedDeliveryDate: string | null;
  status: PurchaseOrderStatus;
  notes: string | null;
  subtotal: string;
  discountTotal: string;
  taxTotal: string;
  grandTotal: string;
  createdAt: string;
  updatedAt: string;
  items: PurchaseOrderItem[];
};

export type PurchaseOrderWriteResult =
  | { ok: true; purchaseOrderId: string }
  | {
      ok: false;
      reason: PurchaseOrderWriteFailure;
      fieldErrors?: PurchaseOrderFieldErrors;
      itemErrors?: (PurchaseOrderItemErrors | undefined)[];
    };

/** The JSON document returned by public.get_purchase_order(). */
type PurchaseOrderDocument = {
  id: string;
  purchase_order_number: string;
  vendor_id: string;
  vendor_name: string;
  vendor_company_name: string | null;
  vendor_phone: string | null;
  vendor_email: string | null;
  vendor_address: string | null;
  vendor_tax_number: string | null;
  order_date: string;
  expected_delivery_date: string | null;
  status: PurchaseOrderStatus;
  notes: string | null;
  subtotal: string;
  discount_total: string;
  tax_total: string;
  grand_total: string;
  created_at: string;
  updated_at: string;
  items: {
    id: string;
    product_id: string;
    product_name: string;
    sku: string;
    description: string | null;
    unit: string;
    quantity: string;
    unit_price: string;
    discount_amount: string;
    tax_rate: string;
    tax_amount: string;
    line_total: string;
    sort_order: number;
  }[];
};

function toPurchaseOrder(data: PurchaseOrderDocument): PurchaseOrder {
  return {
    id: data.id,
    purchaseOrderNumber: data.purchase_order_number,
    vendorId: data.vendor_id,
    vendorName: data.vendor_name,
    vendorCompanyName: data.vendor_company_name,
    vendorPhone: data.vendor_phone,
    vendorEmail: data.vendor_email,
    vendorAddress: data.vendor_address,
    vendorTaxNumber: data.vendor_tax_number,
    orderDate: data.order_date,
    expectedDeliveryDate: data.expected_delivery_date,
    status: data.status,
    notes: data.notes,
    subtotal: data.subtotal,
    discountTotal: data.discount_total,
    taxTotal: data.tax_total,
    grandTotal: data.grand_total,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
    items: data.items.map((row) => ({
      id: row.id,
      productId: row.product_id,
      productName: row.product_name,
      sku: row.sku,
      description: row.description,
      unit: row.unit,
      quantity: row.quantity,
      unitPrice: row.unit_price,
      discountAmount: row.discount_amount,
      taxRate: row.tax_rate,
      taxAmount: row.tax_amount,
      lineTotal: row.line_total,
      sortOrder: row.sort_order,
    })),
  };
}

async function readPurchaseOrder(
  supabase: Supabase,
  tenant: Tenant,
  purchaseOrderId: string,
): Promise<PurchaseOrder | null> {
  const { data: doc, error } = await supabase.rpc("get_purchase_order", {
    p_organization_id: tenant.organization.id,
    p_purchase_order_id: purchaseOrderId,
  });
  if (error) throw new Error("Failed to load purchase order.", { cause: error });
  return doc ? toPurchaseOrder(doc as PurchaseOrderDocument) : null;
}

/**
 * One purchase order of the tenant with its items, or null if it doesn't exist
 * or isn't theirs. One database statement (get_purchase_order(), RLS applies).
 */
export async function getPurchaseOrder(
  tenant: Tenant,
  purchaseOrderId: string,
): Promise<PurchaseOrder | null> {
  if (!isUuid(purchaseOrderId)) return null;
  return readPurchaseOrder(await createClient(), tenant, purchaseOrderId);
}

type Problems = Pick<PurchaseOrderWriteResult & { ok: false }, "fieldErrors" | "itemErrors">;

/**
 * Checks the vendor and products the same way the database will, for
 * per-field errors. With `current` (a draft being edited), an unchanged
 * vendor and kept lines (line ID + same product) are not re-checked
 * against master data, matching update_purchase_order_draft(). Returns null if
 * all is well.
 */
async function checkReferences(
  supabase: Supabase,
  tenant: Tenant,
  input: PurchaseOrderInput,
  current: PurchaseOrder | null,
): Promise<Problems | null> {
  const fieldErrors: PurchaseOrderFieldErrors = {};
  const itemErrors: (PurchaseOrderItemErrors | undefined)[] = input.items.map(() => undefined);

  if (!current || current.vendorId !== input.vendorId) {
    const { data: vendor, error } = await supabase
      .from("vendors")
      .select("status")
      .eq("id", input.vendorId)
      .eq("organization_id", tenant.organization.id)
      .maybeSingle<{ status: string }>();
    if (error) throw error;
    if (!vendor) fieldErrors.vendorId = "Choose a vendor from the list.";
    else if (vendor.status !== "active")
      fieldErrors.vendorId = "This vendor is inactive. Choose an active vendor.";
  }

  const currentLines = new Map((current?.items ?? []).map((item) => [item.id, item]));
  const keptLine = (item: PurchaseOrderInput["items"][number]) => {
    const line = item.lineId ? currentLines.get(item.lineId) : undefined;
    return line && line.productId === item.productId ? line : undefined;
  };

  const newProductIds = [
    ...new Set(input.items.filter((item) => !keptLine(item)).map((item) => item.productId)),
  ];
  const byId = new Map<string, { status: string; purchase_price: string | null }>();
  if (newProductIds.length) {
    const { data: products, error } = await supabase
      .from("products")
      .select("id, status, purchase_price::text")
      .eq("organization_id", tenant.organization.id)
      .in("id", newProductIds)
      .returns<{ id: string; status: string; purchase_price: string | null }[]>();
    if (error) throw error;
    for (const product of products ?? []) byId.set(product.id, product);
  }

  const lines: LineAmounts[] = [];
  input.items.forEach((item, index) => {
    if (item.lineId && !currentLines.has(item.lineId)) {
      itemErrors[index] = { lineId: "This line no longer exists. Reload the purchase order and try again." };
      return;
    }
    let defaultPrice: string | null;
    const kept = keptLine(item);
    if (kept) defaultPrice = kept.unitPrice;
    else {
      const product = byId.get(item.productId);
      if (!product) {
        itemErrors[index] = { productId: "Choose a product or service from the list." };
        return;
      }
      if (product.status !== "active") {
        itemErrors[index] = { productId: "This product is inactive. Choose an active one." };
        return;
      }
      defaultPrice = product.purchase_price;
    }
    const unitPrice = item.unitPrice ?? defaultPrice;
    if (unitPrice === null) {
      itemErrors[index] = { unitPrice: "Enter a unit price. This product has no purchase price." };
      return;
    }
    const line = calculateLine({ ...item, unitPrice });
    if (!line.ok) itemErrors[index] = lineAmountErrors(line.error);
    else lines.push(line.value);
  });

  if (lines.length === input.items.length && !calculateTotals(lines).ok)
    fieldErrors.items = "The purchase order total is too large.";

  if (Object.keys(fieldErrors).length || itemErrors.some(Boolean)) return { fieldErrors, itemErrors };
  return null;
}

/** Creates a draft purchase order atomically with purchase-price defaults. */
export async function createPurchaseOrder(
  tenant: Tenant,
  input: PurchaseOrderInput,
): Promise<PurchaseOrderWriteResult> {
  if (!canPurchaseOrder(tenant.role, "create")) return { ok: false, reason: "forbidden" };
  if (input.items.some((item) => item.lineId !== null)) return { ok: false, reason: "invalid" };

  try {
    const supabase = await createClient();
    const problems = await checkReferences(supabase, tenant, input, null);
    if (problems) return { ok: false, reason: "invalid", ...problems };

    const { data, error } = await supabase.rpc("create_purchase_order", toPurchaseOrderRpcArgs(input));
    if (error) return { ok: false, reason: purchaseOrderWriteFailure("createPurchaseOrder", error) };
    return { ok: true, purchaseOrderId: data as string };
  } catch (err) {
    console.error("createPurchaseOrder threw", err);
    return { ok: false, reason: "failed" };
  }
}

/**
 * Replaces a draft header and items. Only changed references are re-snapshotted.
 * Existing line IDs are temporary edit tokens and must be reloaded after save.
 */
export async function updatePurchaseOrderDraft(
  tenant: Tenant,
  purchaseOrderId: string,
  input: PurchaseOrderInput,
): Promise<PurchaseOrderWriteResult> {
  if (!canPurchaseOrder(tenant.role, "editDraft")) return { ok: false, reason: "forbidden" };
  if (!isUuid(purchaseOrderId)) return { ok: false, reason: "not_found" };

  try {
    const supabase = await createClient();
    const current = await readPurchaseOrder(supabase, tenant, purchaseOrderId);
    if (!current) return { ok: false, reason: "not_found" };
    if (current.status !== "draft") return { ok: false, reason: "not_draft" };

    const problems = await checkReferences(supabase, tenant, input, current);
    if (problems) return { ok: false, reason: "invalid", ...problems };

    const { error } = await supabase.rpc("update_purchase_order_draft", {
      p_purchase_order_id: purchaseOrderId,
      ...toPurchaseOrderRpcArgs(input),
    });
    if (error) return { ok: false, reason: purchaseOrderWriteFailure("updatePurchaseOrderDraft", error) };
    return { ok: true, purchaseOrderId };
  } catch (err) {
    console.error("updatePurchaseOrderDraft threw", err);
    return { ok: false, reason: "failed" };
  }
}

/**
 * Moves a purchase order to a new status. The database checks the role, the
 * tenant and the transition from the current (locked) status.
 */
export async function setPurchaseOrderStatus(
  tenant: Tenant,
  purchaseOrderId: string,
  status: PurchaseOrderUserTargetStatus,
): Promise<PurchaseOrderWriteResult> {
  if (isPurchaseOrderReceivingStatus(status)) return { ok: false, reason: "reserved_receiving_status" };
  if (!Object.hasOwn(PURCHASE_ORDER_STATUS_ACTIONS, status)) return { ok: false, reason: "invalid" };
  if (!canPurchaseOrder(tenant.role, PURCHASE_ORDER_STATUS_ACTIONS[status]))
    return { ok: false, reason: "forbidden" };
  if (!isUuid(purchaseOrderId)) return { ok: false, reason: "not_found" };

  try {
    const supabase = await createClient();
    const { error } = await supabase.rpc("set_purchase_order_status", {
      p_purchase_order_id: purchaseOrderId,
      p_status: status,
    });
    if (error) return { ok: false, reason: purchaseOrderWriteFailure("setPurchaseOrderStatus", error) };
    return { ok: true, purchaseOrderId };
  } catch (err) {
    console.error("setPurchaseOrderStatus threw", err);
    return { ok: false, reason: "failed" };
  }
}
