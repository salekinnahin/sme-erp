import { lineAmountErrors } from "@/lib/quotations/validation";
import { createClient } from "@/lib/supabase/server";
import type { TenantContext } from "@/lib/tenancy/context";
import { isUuid } from "@/lib/validation/fields";
import { calculateLine, calculateTotals, type LineAmounts } from "./calculations";
import { salesOrderWriteFailure, type SalesOrderWriteFailure } from "./errors";
import { toListSalesOrdersArgs, type SalesOrderListParams, SALES_ORDER_PAGE_SIZE } from "./list-params";
import { SALES_ORDER_STATUS_ACTIONS, canSalesOrder } from "./permissions";
import {
  toConversionRpcArgs,
  toSalesOrderRpcArgs,
  type ConversionInput,
  type SalesOrderFieldErrors,
  type SalesOrderInput,
  type SalesOrderItemErrors,
  type SalesOrderStatus,
  type SalesOrderTargetStatus,
} from "./validation";

/**
 * Sales order domain functions. Callers pass the tenant from requireTenant();
 * the organization is never taken from request input.
 *
 * A sales order document is read in one statement (get_sales_order(),
 * DECISIONS 020). Writes only go through the database functions
 * create_sales_order(), create_sales_order_from_quotation(),
 * update_sales_order_draft() and set_sales_order_status(), which re-check
 * membership, role, status, references and every amount. The checks here
 * exist for early, friendly per-field errors.
 *
 * Money and quantities are decimal strings end to end.
 */

type Tenant = Pick<TenantContext, "organization" | "role">;
type Supabase = Awaited<ReturnType<typeof createClient>>;

export type SalesOrderItem = {
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

export type SalesOrder = {
  id: string;
  salesOrderNumber: string;
  customerId: string;
  /** The accepted quotation it was converted from, or null (direct). */
  sourceQuotationId: string | null;
  sourceQuotationNumber: string | null;
  customerName: string;
  customerCompanyName: string | null;
  customerPhone: string | null;
  customerEmail: string | null;
  customerAddress: string | null;
  customerTaxNumber: string | null;
  orderDate: string;
  expectedDeliveryDate: string | null;
  status: SalesOrderStatus;
  notes: string | null;
  subtotal: string;
  discountTotal: string;
  taxTotal: string;
  grandTotal: string;
  createdAt: string;
  updatedAt: string;
  items: SalesOrderItem[];
};

export type SalesOrderWriteResult =
  | { ok: true; salesOrderId: string }
  | {
      ok: false;
      reason: SalesOrderWriteFailure;
      fieldErrors?: SalesOrderFieldErrors;
      itemErrors?: (SalesOrderItemErrors | undefined)[];
    };

/** The JSON document returned by public.get_sales_order(). */
type SalesOrderDocument = {
  id: string;
  sales_order_number: string;
  customer_id: string;
  source_quotation_id: string | null;
  source_quotation_number: string | null;
  customer_name: string;
  customer_company_name: string | null;
  customer_phone: string | null;
  customer_email: string | null;
  customer_address: string | null;
  customer_tax_number: string | null;
  order_date: string;
  expected_delivery_date: string | null;
  status: SalesOrderStatus;
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

function toSalesOrder(data: SalesOrderDocument): SalesOrder {
  return {
    id: data.id,
    salesOrderNumber: data.sales_order_number,
    customerId: data.customer_id,
    sourceQuotationId: data.source_quotation_id,
    sourceQuotationNumber: data.source_quotation_number,
    customerName: data.customer_name,
    customerCompanyName: data.customer_company_name,
    customerPhone: data.customer_phone,
    customerEmail: data.customer_email,
    customerAddress: data.customer_address,
    customerTaxNumber: data.customer_tax_number,
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

async function readSalesOrder(
  supabase: Supabase,
  tenant: Tenant,
  salesOrderId: string,
): Promise<SalesOrder | null> {
  const { data: doc, error } = await supabase.rpc("get_sales_order", {
    p_organization_id: tenant.organization.id,
    p_sales_order_id: salesOrderId,
  });
  if (error) throw new Error("Failed to load sales order.", { cause: error });
  return doc ? toSalesOrder(doc as SalesOrderDocument) : null;
}

/**
 * One sales order of the tenant with its items, or null if it doesn't exist
 * or isn't theirs. One database statement (get_sales_order(), RLS applies).
 */
export async function getSalesOrder(
  tenant: Tenant,
  salesOrderId: string,
): Promise<SalesOrder | null> {
  if (!isUuid(salesOrderId)) return null;
  return readSalesOrder(await createClient(), tenant, salesOrderId);
}

export type SalesOrderListItem = {
  id: string;
  salesOrderNumber: string;
  customerId: string;
  /** Snapshot on the order (not the customer's current name). */
  customerName: string;
  customerCompanyName: string | null;
  orderDate: string;
  expectedDeliveryDate: string | null;
  status: SalesOrderStatus;
  /** Decimal string. */
  grandTotal: string;
  sourceQuotationId: string | null;
  sourceQuotationNumber: string | null;
  createdAt: string;
};

export type SalesOrderList = {
  items: SalesOrderListItem[];
  /** Matching rows across all pages. Null if the page is past the end. */
  total: number | null;
  page: number;
  pageSize: number;
};

type SalesOrderListRow = {
  id: string;
  sales_order_number: string;
  customer_id: string;
  customer_name: string;
  customer_company_name: string | null;
  order_date: string;
  expected_delivery_date: string | null;
  status: SalesOrderStatus;
  grand_total: string;
  source_quotation_id: string | null;
  source_quotation_number: string | null;
  created_at: string;
  total_count: number | string;
};

/**
 * A page of the tenant's sales orders, newest first. Search and filters run
 * in the database (list_sales_orders(), SECURITY INVOKER, so RLS applies);
 * user input never becomes a PostgREST filter string.
 */
export async function listSalesOrders(
  tenant: Tenant,
  params: SalesOrderListParams,
): Promise<SalesOrderList> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc(
    "list_sales_orders",
    toListSalesOrdersArgs(tenant.organization.id, params),
  );
  if (error) throw new Error("Failed to load sales orders.", { cause: error });

  const rows = (data ?? []) as SalesOrderListRow[];
  return {
    items: rows.map((row) => ({
      id: row.id,
      salesOrderNumber: row.sales_order_number,
      customerId: row.customer_id,
      customerName: row.customer_name,
      customerCompanyName: row.customer_company_name,
      orderDate: row.order_date,
      expectedDeliveryDate: row.expected_delivery_date,
      status: row.status,
      grandTotal: row.grand_total,
      sourceQuotationId: row.source_quotation_id,
      sourceQuotationNumber: row.source_quotation_number,
      createdAt: row.created_at,
    })),
    // total_count is a bigint; PostgREST may send it as a string.
    total: rows.length ? Number(rows[0].total_count) : params.page === 1 ? 0 : null,
    page: params.page,
    pageSize: SALES_ORDER_PAGE_SIZE,
  };
}

/**
 * The sales order converted from a quotation, or null. One indexed query
 * (unique (organization_id, source_quotation_id)), tenant-filtered and under
 * RLS, for the quotation detail page. Throws on database errors, so a failed
 * lookup never looks like "not converted".
 */
export async function getSalesOrderForQuotation(
  tenant: Pick<TenantContext, "organization">,
  quotationId: string,
): Promise<{ id: string; salesOrderNumber: string } | null> {
  if (!isUuid(quotationId)) return null;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("sales_orders")
    .select("id, sales_order_number")
    .eq("organization_id", tenant.organization.id)
    .eq("source_quotation_id", quotationId.toLowerCase())
    .maybeSingle<{ id: string; sales_order_number: string }>();
  if (error) throw new Error("Failed to look up the sales order of a quotation.", { cause: error });
  return data ? { id: data.id, salesOrderNumber: data.sales_order_number } : null;
}

type Problems = Pick<SalesOrderWriteResult & { ok: false }, "fieldErrors" | "itemErrors">;

/**
 * Checks the customer and products the same way the database will, for
 * per-field errors. With `current` (a draft being edited), an unchanged
 * customer and kept lines (line ID + same product) are not re-checked
 * against master data, matching update_sales_order_draft(). Returns null if
 * all is well.
 */
async function checkReferences(
  supabase: Supabase,
  tenant: Tenant,
  input: SalesOrderInput,
  current: SalesOrder | null,
): Promise<Problems | null> {
  const fieldErrors: SalesOrderFieldErrors = {};
  const itemErrors: (SalesOrderItemErrors | undefined)[] = input.items.map(() => undefined);

  if (!current || current.customerId !== input.customerId) {
    const { data: customer, error } = await supabase
      .from("customers")
      .select("status")
      .eq("id", input.customerId)
      .eq("organization_id", tenant.organization.id)
      .maybeSingle<{ status: string }>();
    if (error) throw error;
    if (!customer) fieldErrors.customerId = "Choose a customer from the list.";
    else if (customer.status !== "active")
      fieldErrors.customerId = "This customer is inactive. Choose an active customer.";
  }

  const currentLines = new Map((current?.items ?? []).map((item) => [item.id, item]));
  const keptLine = (item: SalesOrderInput["items"][number]) => {
    const line = item.lineId ? currentLines.get(item.lineId) : undefined;
    return line && line.productId === item.productId ? line : undefined;
  };

  const newProductIds = [
    ...new Set(input.items.filter((item) => !keptLine(item)).map((item) => item.productId)),
  ];
  const byId = new Map<string, { status: string; selling_price: string | null }>();
  if (newProductIds.length) {
    const { data: products, error } = await supabase
      .from("products")
      .select("id, status, selling_price::text")
      .eq("organization_id", tenant.organization.id)
      .in("id", newProductIds)
      .returns<{ id: string; status: string; selling_price: string | null }[]>();
    if (error) throw error;
    for (const product of products ?? []) byId.set(product.id, product);
  }

  const lines: LineAmounts[] = [];
  input.items.forEach((item, index) => {
    if (item.lineId && !currentLines.has(item.lineId)) {
      itemErrors[index] = { lineId: "This line no longer exists. Reload the sales order and try again." };
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
      defaultPrice = product.selling_price;
    }
    const unitPrice = item.unitPrice ?? defaultPrice;
    if (unitPrice === null) {
      itemErrors[index] = { unitPrice: "Enter a unit price. This product has no selling price." };
      return;
    }
    const line = calculateLine({ ...item, unitPrice });
    if (!line.ok) itemErrors[index] = lineAmountErrors(line.error);
    else lines.push(line.value);
  });

  if (lines.length === input.items.length && !calculateTotals(lines).ok)
    fieldErrors.items = "The sales order total is too large.";

  if (Object.keys(fieldErrors).length || itemErrors.some(Boolean)) return { fieldErrors, itemErrors };
  return null;
}

/** Creates a draft sales order directly (without a quotation). */
export async function createSalesOrder(
  tenant: Tenant,
  input: SalesOrderInput,
): Promise<SalesOrderWriteResult> {
  if (!canSalesOrder(tenant.role, "create")) return { ok: false, reason: "forbidden" };
  if (input.items.some((item) => item.lineId !== null)) return { ok: false, reason: "invalid" };

  try {
    const supabase = await createClient();
    const problems = await checkReferences(supabase, tenant, input, null);
    if (problems) return { ok: false, reason: "invalid", ...problems };

    const { data, error } = await supabase.rpc("create_sales_order", toSalesOrderRpcArgs(input));
    if (error) return { ok: false, reason: salesOrderWriteFailure("createSalesOrder", error) };
    return { ok: true, salesOrderId: data as string };
  } catch (err) {
    console.error("createSalesOrder threw", err);
    return { ok: false, reason: "failed" };
  }
}

/**
 * Converts an accepted quotation into a draft sales order. The database
 * copies the quotation's customer, snapshots, lines, amounts and notes, and
 * allows at most one sales order per quotation.
 */
export async function createSalesOrderFromQuotation(
  tenant: Tenant,
  input: ConversionInput,
): Promise<SalesOrderWriteResult> {
  if (!canSalesOrder(tenant.role, "convertQuotation")) return { ok: false, reason: "forbidden" };
  if (!isUuid(input.quotationId)) return { ok: false, reason: "not_found" };

  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc(
      "create_sales_order_from_quotation",
      toConversionRpcArgs(input),
    );
    if (error)
      return { ok: false, reason: salesOrderWriteFailure("createSalesOrderFromQuotation", error) };
    return { ok: true, salesOrderId: data as string };
  } catch (err) {
    console.error("createSalesOrderFromQuotation threw", err);
    return { ok: false, reason: "failed" };
  }
}

/**
 * Replaces the header and items of a draft sales order (direct or
 * converted). Only changed references are re-snapshotted: a new customer,
 * and lines without a kept line ID. The source quotation is never changed.
 */
export async function updateSalesOrderDraft(
  tenant: Tenant,
  salesOrderId: string,
  input: SalesOrderInput,
): Promise<SalesOrderWriteResult> {
  if (!canSalesOrder(tenant.role, "editDraft")) return { ok: false, reason: "forbidden" };
  if (!isUuid(salesOrderId)) return { ok: false, reason: "not_found" };

  try {
    const supabase = await createClient();
    const current = await readSalesOrder(supabase, tenant, salesOrderId);
    if (!current) return { ok: false, reason: "not_found" };
    if (current.status !== "draft") return { ok: false, reason: "not_draft" };

    const problems = await checkReferences(supabase, tenant, input, current);
    if (problems) return { ok: false, reason: "invalid", ...problems };

    const { error } = await supabase.rpc("update_sales_order_draft", {
      p_sales_order_id: salesOrderId,
      ...toSalesOrderRpcArgs(input),
    });
    if (error) return { ok: false, reason: salesOrderWriteFailure("updateSalesOrderDraft", error) };
    return { ok: true, salesOrderId };
  } catch (err) {
    console.error("updateSalesOrderDraft threw", err);
    return { ok: false, reason: "failed" };
  }
}

/**
 * Moves a sales order to a new status. The database checks the role, the
 * tenant and the transition from the current (locked) status.
 */
export async function setSalesOrderStatus(
  tenant: Tenant,
  salesOrderId: string,
  status: SalesOrderTargetStatus,
): Promise<SalesOrderWriteResult> {
  if (!Object.hasOwn(SALES_ORDER_STATUS_ACTIONS, status)) return { ok: false, reason: "invalid" };
  if (!canSalesOrder(tenant.role, SALES_ORDER_STATUS_ACTIONS[status]))
    return { ok: false, reason: "forbidden" };
  if (!isUuid(salesOrderId)) return { ok: false, reason: "not_found" };

  try {
    const supabase = await createClient();
    const { error } = await supabase.rpc("set_sales_order_status", {
      p_sales_order_id: salesOrderId,
      p_status: status,
    });
    if (error) return { ok: false, reason: salesOrderWriteFailure("setSalesOrderStatus", error) };
    return { ok: true, salesOrderId };
  } catch (err) {
    console.error("setSalesOrderStatus threw", err);
    return { ok: false, reason: "failed" };
  }
}
