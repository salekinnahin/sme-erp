import { toListInvoicesArgs, type InvoiceListParams, INVOICE_PAGE_SIZE } from "./list-params";
import { lineAmountErrors } from "@/lib/quotations/validation";
import { createClient } from "@/lib/supabase/server";
import type { TenantContext } from "@/lib/tenancy/context";
import { isUuid } from "@/lib/validation/fields";
import { calculateLine, calculateTotals, type LineAmounts } from "./calculations";
import { invoiceWriteFailure, type InvoiceWriteFailure } from "./errors";
import { INVOICE_STATUS_ACTIONS, canInvoice } from "./permissions";
import {
  INVOICE_LINE_NOT_FOUND,
  isInvoiceUserTargetStatus,
  toInvoiceConversionRpcArgs,
  toInvoiceRpcArgs,
  type InvoiceConversionInput,
  type InvoiceFieldErrors,
  type InvoiceInput,
  type InvoiceItemErrors,
  type InvoiceStatus,
  type InvoiceUserTargetStatus,
} from "./validation";

/**
 * Invoice domain functions. Callers pass the tenant from requireTenant();
 * the organization is never taken from request input.
 *
 * An invoice document is read in one statement (get_invoice(), DECISIONS
 * 020). Writes only go through the database functions create_invoice(),
 * create_invoice_from_sales_order(), update_invoice_draft() and
 * set_invoice_status(), which re-check membership, role, status, references,
 * every amount and the balance. The checks here exist for early, friendly
 * per-field errors.
 *
 * Money and quantities are decimal strings end to end.
 */

type Tenant = Pick<TenantContext, "organization" | "role">;
type Supabase = Awaited<ReturnType<typeof createClient>>;

export type InvoiceItem = {
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

export type Invoice = {
  id: string;
  invoiceNumber: string;
  customerId: string;
  /** The confirmed sales order it was converted from, or null (direct). */
  sourceSalesOrderId: string | null;
  sourceSalesOrderNumber: string | null;
  customerName: string;
  customerCompanyName: string | null;
  customerPhone: string | null;
  customerEmail: string | null;
  customerAddress: string | null;
  customerTaxNumber: string | null;
  invoiceDate: string;
  dueDate: string | null;
  status: InvoiceStatus;
  notes: string | null;
  subtotal: string;
  discountTotal: string;
  taxTotal: string;
  grandTotal: string;
  /** Reserved for the Payment module; "0.00" until payments exist. */
  amountPaid: string;
  amountDue: string;
  createdAt: string;
  updatedAt: string;
  items: InvoiceItem[];
};

export type InvoiceWriteResult =
  | { ok: true; invoiceId: string }
  | {
      ok: false;
      reason: InvoiceWriteFailure;
      fieldErrors?: InvoiceFieldErrors;
      itemErrors?: (InvoiceItemErrors | undefined)[];
    };

/** The JSON document returned by public.get_invoice(). */
type InvoiceDocument = {
  id: string;
  invoice_number: string;
  customer_id: string;
  source_sales_order_id: string | null;
  source_sales_order_number: string | null;
  customer_name: string;
  customer_company_name: string | null;
  customer_phone: string | null;
  customer_email: string | null;
  customer_address: string | null;
  customer_tax_number: string | null;
  invoice_date: string;
  due_date: string | null;
  status: InvoiceStatus;
  notes: string | null;
  subtotal: string;
  discount_total: string;
  tax_total: string;
  grand_total: string;
  amount_paid: string;
  amount_due: string;
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

function toInvoice(data: InvoiceDocument): Invoice {
  return {
    id: data.id,
    invoiceNumber: data.invoice_number,
    customerId: data.customer_id,
    sourceSalesOrderId: data.source_sales_order_id,
    sourceSalesOrderNumber: data.source_sales_order_number,
    customerName: data.customer_name,
    customerCompanyName: data.customer_company_name,
    customerPhone: data.customer_phone,
    customerEmail: data.customer_email,
    customerAddress: data.customer_address,
    customerTaxNumber: data.customer_tax_number,
    invoiceDate: data.invoice_date,
    dueDate: data.due_date,
    status: data.status,
    notes: data.notes,
    subtotal: data.subtotal,
    discountTotal: data.discount_total,
    taxTotal: data.tax_total,
    grandTotal: data.grand_total,
    amountPaid: data.amount_paid,
    amountDue: data.amount_due,
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

async function readInvoice(supabase: Supabase, tenant: Tenant, invoiceId: string): Promise<Invoice | null> {
  const { data: doc, error } = await supabase.rpc("get_invoice", {
    p_organization_id: tenant.organization.id,
    p_invoice_id: invoiceId,
  });
  if (error) throw new Error("Failed to load invoice.", { cause: error });
  return doc ? toInvoice(doc as InvoiceDocument) : null;
}

/**
 * One invoice of the tenant with its items, or null if it doesn't exist or
 * isn't theirs. One database statement (get_invoice(), RLS applies).
 */
export async function getInvoice(tenant: Tenant, invoiceId: string): Promise<Invoice | null> {
  if (!isUuid(invoiceId)) return null;
  return readInvoice(await createClient(), tenant, invoiceId);
}

/**
 * The invoice converted from a sales order, or null. One indexed query
 * (unique (organization_id, source_sales_order_id)), tenant-filtered and
 * under RLS. Throws on database errors, so a failed lookup never looks like
 * "not invoiced".
 */
export async function getInvoiceForSalesOrder(
  tenant: Pick<TenantContext, "organization">,
  salesOrderId: string,
): Promise<{ id: string; invoiceNumber: string; status: InvoiceStatus } | null> {
  if (!isUuid(salesOrderId)) return null;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("invoices")
    .select("id, invoice_number, status")
    .eq("organization_id", tenant.organization.id)
    .eq("source_sales_order_id", salesOrderId.toLowerCase())
    .maybeSingle<{ id: string; invoice_number: string; status: InvoiceStatus }>();
  if (error) throw new Error("Failed to look up the invoice of a sales order.", { cause: error });
  return data ? { id: data.id, invoiceNumber: data.invoice_number, status: data.status } : null;
}

type Problems = Pick<InvoiceWriteResult & { ok: false }, "fieldErrors" | "itemErrors">;

/**
 * Checks the customer and products the same way the database will, for
 * per-field errors. With `current` (a draft being edited), an unchanged
 * customer and kept lines (line ID + same product) are not re-checked
 * against master data, matching update_invoice_draft(). Returns null if all
 * is well.
 */
async function checkReferences(
  supabase: Supabase,
  tenant: Tenant,
  input: InvoiceInput,
  current: Invoice | null,
): Promise<Problems | null> {
  const fieldErrors: InvoiceFieldErrors = {};
  const itemErrors: (InvoiceItemErrors | undefined)[] = input.items.map(() => undefined);

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
  const keptLine = (item: InvoiceInput["items"][number]) => {
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
      itemErrors[index] = { lineId: INVOICE_LINE_NOT_FOUND };
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
    fieldErrors.items = "The invoice total is too large.";

  if (Object.keys(fieldErrors).length || itemErrors.some(Boolean)) return { fieldErrors, itemErrors };
  return null;
}

/** Creates a draft invoice directly (without a sales order). */
export async function createInvoice(tenant: Tenant, input: InvoiceInput): Promise<InvoiceWriteResult> {
  if (!canInvoice(tenant.role, "create")) return { ok: false, reason: "forbidden" };
  if (input.items.some((item) => item.lineId !== null)) return { ok: false, reason: "invalid" };

  try {
    const supabase = await createClient();
    const problems = await checkReferences(supabase, tenant, input, null);
    if (problems) return { ok: false, reason: "invalid", ...problems };

    const { data, error } = await supabase.rpc("create_invoice", toInvoiceRpcArgs(input));
    if (error) return { ok: false, reason: invoiceWriteFailure("createInvoice", error) };
    return { ok: true, invoiceId: data as string };
  } catch (err) {
    console.error("createInvoice threw", err);
    return { ok: false, reason: "failed" };
  }
}

/**
 * Converts a confirmed sales order into a draft invoice. The database copies
 * the order's customer, snapshots, lines, amounts and notes, and allows at
 * most one invoice per sales order, ever.
 */
export async function createInvoiceFromSalesOrder(
  tenant: Tenant,
  input: InvoiceConversionInput,
): Promise<InvoiceWriteResult> {
  if (!canInvoice(tenant.role, "convertSalesOrder")) return { ok: false, reason: "forbidden" };
  if (!isUuid(input.salesOrderId)) return { ok: false, reason: "not_found" };

  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc(
      "create_invoice_from_sales_order",
      toInvoiceConversionRpcArgs(input),
    );
    if (error) return { ok: false, reason: invoiceWriteFailure("createInvoiceFromSalesOrder", error) };
    return { ok: true, invoiceId: data as string };
  } catch (err) {
    console.error("createInvoiceFromSalesOrder threw", err);
    return { ok: false, reason: "failed" };
  }
}

/**
 * Replaces the header and items of a draft invoice (direct or converted).
 * Only changed references are re-snapshotted: a new customer, and lines
 * without a kept line ID. The source sales order is never changed.
 */
export async function updateInvoiceDraft(
  tenant: Tenant,
  invoiceId: string,
  input: InvoiceInput,
): Promise<InvoiceWriteResult> {
  if (!canInvoice(tenant.role, "editDraft")) return { ok: false, reason: "forbidden" };
  if (!isUuid(invoiceId)) return { ok: false, reason: "not_found" };

  try {
    const supabase = await createClient();
    const current = await readInvoice(supabase, tenant, invoiceId);
    if (!current) return { ok: false, reason: "not_found" };
    if (current.status !== "draft") return { ok: false, reason: "not_draft" };

    const problems = await checkReferences(supabase, tenant, input, current);
    if (problems) return { ok: false, reason: "invalid", ...problems };

    const { error } = await supabase.rpc("update_invoice_draft", {
      p_invoice_id: invoiceId,
      ...toInvoiceRpcArgs(input),
    });
    if (error) return { ok: false, reason: invoiceWriteFailure("updateInvoiceDraft", error) };
    return { ok: true, invoiceId };
  } catch (err) {
    console.error("updateInvoiceDraft threw", err);
    return { ok: false, reason: "failed" };
  }
}

/**
 * Issues or cancels an invoice. The database checks the role, the tenant
 * and the transition from the current (locked) status. Payment statuses are
 * rejected here and by the database.
 */
export async function setInvoiceStatus(
  tenant: Tenant,
  invoiceId: string,
  status: InvoiceUserTargetStatus,
): Promise<InvoiceWriteResult> {
  if (!isInvoiceUserTargetStatus(status)) return { ok: false, reason: "invalid" };
  if (!canInvoice(tenant.role, INVOICE_STATUS_ACTIONS[status])) return { ok: false, reason: "forbidden" };
  if (!isUuid(invoiceId)) return { ok: false, reason: "not_found" };

  try {
    const supabase = await createClient();
    const { error } = await supabase.rpc("set_invoice_status", {
      p_invoice_id: invoiceId,
      p_status: status,
    });
    if (error) return { ok: false, reason: invoiceWriteFailure("setInvoiceStatus", error) };
    return { ok: true, invoiceId };
  } catch (err) {
    console.error("setInvoiceStatus threw", err);
    return { ok: false, reason: "failed" };
  }
}

export type InvoiceListItem = {
  id: string;
  invoiceNumber: string;
  customerId: string;
  /** Snapshot on the order (not the customer's current name). */
  customerName: string;
  customerCompanyName: string | null;
  invoiceDate: string;
  dueDate: string | null;
  status: InvoiceStatus;
  /** Decimal string. */
  grandTotal: string;
  amountPaid: string;
  amountDue: string;
  sourceSalesOrderId: string | null;
  sourceSalesOrderNumber: string | null;
  createdAt: string;
};

export type InvoiceList = {
  items: InvoiceListItem[];
  /** Matching rows across all pages. Null if the page is past the end. */
  total: number | null;
  page: number;
  pageSize: number;
};

type InvoiceListRow = {
  id: string;
  invoice_number: string;
  customer_id: string;
  customer_name: string;
  customer_company_name: string | null;
  invoice_date: string;
  due_date: string | null;
  status: InvoiceStatus;
  grand_total: string;
  amount_paid: string;
  amount_due: string;
  source_sales_order_id: string | null;
  source_sales_order_number: string | null;
  created_at: string;
  total_count: number | string;
};

/**
 * A page of the tenant's invoices, newest first. Search and filters run
 * in the database (list_invoices(), SECURITY INVOKER, so RLS applies);
 * user input never becomes a PostgREST filter string.
 */
export async function listInvoices(
  tenant: Tenant,
  params: InvoiceListParams,
): Promise<InvoiceList> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc(
    "list_invoices",
    toListInvoicesArgs(tenant.organization.id, params),
  );
  if (error) throw new Error("Failed to load invoices.", { cause: error });

  const rows = (data ?? []) as InvoiceListRow[];
  return {
    items: rows.map((row) => ({
      id: row.id,
      invoiceNumber: row.invoice_number,
      customerId: row.customer_id,
      customerName: row.customer_name,
      customerCompanyName: row.customer_company_name,
      invoiceDate: row.invoice_date,
      dueDate: row.due_date,
      status: row.status,
      grandTotal: row.grand_total,
      amountPaid: row.amount_paid,
      amountDue: row.amount_due,
      sourceSalesOrderId: row.source_sales_order_id,
      sourceSalesOrderNumber: row.source_sales_order_number,
      createdAt: row.created_at,
    })),
    // total_count is a bigint; PostgREST may send it as a string.
    total: rows.length ? Number(rows[0].total_count) : params.page === 1 ? 0 : null,
    page: params.page,
    pageSize: INVOICE_PAGE_SIZE,
  };
}

