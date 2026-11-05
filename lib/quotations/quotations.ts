import { createClient } from "@/lib/supabase/server";
import type { TenantContext } from "@/lib/tenancy/context";
import { isUuid } from "@/lib/validation/fields";
import { calculateLine, calculateTotals, type LineAmounts } from "./calculations";
import { quotationWriteFailure, type QuotationWriteFailure } from "./errors";
import { STATUS_ACTIONS, canQuotation } from "./permissions";
import {
  QUOTATION_PAGE_SIZE,
  lineAmountErrors,
  toQuotationRpcArgs,
  type QuotationListParams,
  type QuotationFieldErrors,
  type QuotationInput,
  type QuotationItemErrors,
  type QuotationStatus,
  type QuotationTargetStatus,
} from "./validation";

/**
 * Quotation domain functions. Callers pass the tenant from requireTenant();
 * the organization is never taken from request input.
 *
 * Reads are scoped twice (explicit organization_id filter and RLS) and throw
 * on database errors. A quotation document is read in one statement
 * (get_quotation()), never as separate header and item requests. Writes only go through the database functions
 * create_quotation(), update_quotation_draft() and set_quotation_status(),
 * which re-check membership, role, status, references and every amount.
 * The checks here exist for early, friendly per-field errors.
 *
 * Money and quantities are read as text (`::text`) and written as decimal
 * strings, so they never pass through JavaScript floating point.
 */

type Tenant = Pick<TenantContext, "organization" | "role">;
type Supabase = Awaited<ReturnType<typeof createClient>>;

export type QuotationItem = {
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

export type Quotation = {
  id: string;
  quotationNumber: string;
  customerId: string;
  customerName: string;
  customerCompanyName: string | null;
  customerPhone: string | null;
  customerEmail: string | null;
  customerAddress: string | null;
  customerTaxNumber: string | null;
  quotationDate: string;
  expiryDate: string | null;
  status: QuotationStatus;
  notes: string | null;
  subtotal: string;
  discountTotal: string;
  taxTotal: string;
  grandTotal: string;
  createdAt: string;
  updatedAt: string;
  items: QuotationItem[];
};

export type QuotationWriteResult =
  | { ok: true; quotationId: string }
  | {
      ok: false;
      reason: QuotationWriteFailure;
      fieldErrors?: QuotationFieldErrors;
      itemErrors?: (QuotationItemErrors | undefined)[];
    };

/** The JSON document returned by public.get_quotation(). */
type QuotationDocument = {
  id: string;
  quotation_number: string;
  customer_id: string;
  customer_name: string;
  customer_company_name: string | null;
  customer_phone: string | null;
  customer_email: string | null;
  customer_address: string | null;
  customer_tax_number: string | null;
  quotation_date: string;
  expiry_date: string | null;
  status: QuotationStatus;
  notes: string | null;
  /** Decimal strings (numeric::text in the database). */
  subtotal: string;
  discount_total: string;
  tax_total: string;
  grand_total: string;
  created_at: string;
  updated_at: string;
  /** Ordered by sort_order, then id. Amounts are decimal strings. */
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

/**
 * One quotation of the tenant with its items, or null if it doesn't exist or
 * isn't theirs.
 *
 * Header and items come from ONE database statement (get_quotation(),
 * SECURITY INVOKER, so RLS applies). Two separate requests could return a
 * mixed document if a draft were saved between them, so never split this
 * read into a header query and an items query.
 */
export async function getQuotation(
  tenant: Tenant,
  quotationId: string,
): Promise<Quotation | null> {
  if (!isUuid(quotationId)) return null;

  const supabase = await createClient();
  const { data: doc, error } = await supabase.rpc("get_quotation", {
    p_organization_id: tenant.organization.id,
    p_quotation_id: quotationId,
  });
  if (error) throw new Error("Failed to load quotation.", { cause: error });
  if (!doc) return null;

  const data = doc as QuotationDocument;
  return {
    id: data.id,
    quotationNumber: data.quotation_number,
    customerId: data.customer_id,
    customerName: data.customer_name,
    customerCompanyName: data.customer_company_name,
    customerPhone: data.customer_phone,
    customerEmail: data.customer_email,
    customerAddress: data.customer_address,
    customerTaxNumber: data.customer_tax_number,
    quotationDate: data.quotation_date,
    expiryDate: data.expiry_date,
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

export type QuotationListItem = {
  id: string;
  quotationNumber: string;
  customerId: string;
  /** Snapshot taken when the quotation was created or last saved as draft. */
  customerName: string;
  customerCompanyName: string | null;
  quotationDate: string;
  expiryDate: string | null;
  status: QuotationStatus;
  /** Decimal string. */
  grandTotal: string;
  createdAt: string;
};

export type QuotationList = {
  items: QuotationListItem[];
  /** Matching rows across all pages. Null if the page is past the end. */
  total: number | null;
  page: number;
  pageSize: number;
};

type QuotationListRow = {
  id: string;
  quotation_number: string;
  customer_id: string;
  customer_name: string;
  customer_company_name: string | null;
  quotation_date: string;
  expiry_date: string | null;
  status: QuotationStatus;
  grand_total: string;
  created_at: string;
  total_count: number | string;
};

/**
 * A page of the tenant's quotations, newest first. Search and filters run in
 * the database (list_quotations(), SECURITY INVOKER, so RLS applies); user
 * input never becomes a PostgREST filter string.
 */
export async function listQuotations(
  tenant: Tenant,
  params: QuotationListParams,
): Promise<QuotationList> {
  const pageSize = QUOTATION_PAGE_SIZE;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("list_quotations", {
    p_organization_id: tenant.organization.id,
    p_search: params.search || null,
    p_status: params.status === "all" ? null : params.status,
    p_customer_id: params.customer === "all" ? null : params.customer,
    p_limit: pageSize,
    p_offset: (params.page - 1) * pageSize,
  });

  if (error) throw new Error("Failed to load quotations.", { cause: error });

  const rows = (data ?? []) as QuotationListRow[];
  return {
    items: rows.map((row) => ({
      id: row.id,
      quotationNumber: row.quotation_number,
      customerId: row.customer_id,
      customerName: row.customer_name,
      customerCompanyName: row.customer_company_name,
      quotationDate: row.quotation_date,
      expiryDate: row.expiry_date,
      status: row.status,
      grandTotal: row.grand_total,
      createdAt: row.created_at,
    })),
    // total_count is a bigint; PostgREST may send it as a string.
    total: rows.length ? Number(rows[0].total_count) : params.page === 1 ? 0 : null,
    page: params.page,
    pageSize,
  };
}

/**
 * Checks the customer and products against the tenant's current master data
 * and the amounts against the resolved unit prices. Returns null if all is
 * well. The database repeats every check.
 */
async function checkReferences(
  supabase: Supabase,
  tenant: Tenant,
  input: QuotationInput,
): Promise<Pick<QuotationWriteResult & { ok: false }, "fieldErrors" | "itemErrors"> | null> {
  const fieldErrors: QuotationFieldErrors = {};
  const itemErrors: (QuotationItemErrors | undefined)[] = input.items.map(() => undefined);

  const { data: customer, error: customerError } = await supabase
    .from("customers")
    .select("status")
    .eq("id", input.customerId)
    .eq("organization_id", tenant.organization.id)
    .maybeSingle<{ status: string }>();
  if (customerError) throw customerError;
  if (!customer) fieldErrors.customerId = "Choose a customer from the list.";
  else if (customer.status !== "active")
    fieldErrors.customerId = "This customer is inactive. Choose an active customer.";

  const productIds = [...new Set(input.items.map((item) => item.productId))];
  const { data: products, error: productsError } = await supabase
    .from("products")
    .select("id, status, selling_price::text")
    .eq("organization_id", tenant.organization.id)
    .in("id", productIds)
    .returns<{ id: string; status: string; selling_price: string | null }[]>();
  if (productsError) throw productsError;
  const byId = new Map((products ?? []).map((product) => [product.id, product]));

  const lines: LineAmounts[] = [];
  input.items.forEach((item, index) => {
    const product = byId.get(item.productId);
    if (!product) {
      itemErrors[index] = { productId: "Choose a product or service from the list." };
      return;
    }
    if (product.status !== "active") {
      itemErrors[index] = { productId: "This product is inactive. Choose an active one." };
      return;
    }
    const unitPrice = item.unitPrice ?? product.selling_price;
    if (unitPrice === null) {
      itemErrors[index] = { unitPrice: "Enter a unit price. This product has no selling price." };
      return;
    }
    const line = calculateLine({ ...item, unitPrice });
    if (!line.ok) itemErrors[index] = lineAmountErrors(line.error);
    else lines.push(line.value);
  });

  if (lines.length === input.items.length && !calculateTotals(lines).ok)
    fieldErrors.items = "The quotation total is too large.";

  if (Object.keys(fieldErrors).length || itemErrors.some(Boolean))
    return { fieldErrors, itemErrors };
  return null;
}

/** Creates a draft quotation in the tenant's organization. */
export async function createQuotation(
  tenant: Tenant,
  input: QuotationInput,
): Promise<QuotationWriteResult> {
  if (!canQuotation(tenant.role, "create")) return { ok: false, reason: "forbidden" };

  try {
    const supabase = await createClient();
    const problems = await checkReferences(supabase, tenant, input);
    if (problems) return { ok: false, reason: "invalid", ...problems };

    // The database takes the organization from the customer (only if the
    // caller is an active member), numbers the quotation, snapshots the
    // customer and products, and computes all amounts.
    const { data, error } = await supabase.rpc("create_quotation", toQuotationRpcArgs(input));
    if (error) return { ok: false, reason: quotationWriteFailure("createQuotation", error) };
    return { ok: true, quotationId: data as string };
  } catch (err) {
    console.error("createQuotation threw", err);
    return { ok: false, reason: "failed" };
  }
}

/**
 * Replaces the header and items of a draft quotation. Customer and product
 * snapshots are taken again from the current master data.
 */
export async function updateQuotationDraft(
  tenant: Tenant,
  quotationId: string,
  input: QuotationInput,
): Promise<QuotationWriteResult> {
  if (!canQuotation(tenant.role, "editDraft")) return { ok: false, reason: "forbidden" };
  if (!isUuid(quotationId)) return { ok: false, reason: "not_found" };

  try {
    const supabase = await createClient();
    const { data: current, error: currentError } = await supabase
      .from("quotations")
      .select("status")
      .eq("id", quotationId)
      .eq("organization_id", tenant.organization.id)
      .maybeSingle<{ status: QuotationStatus }>();
    if (currentError)
      return { ok: false, reason: quotationWriteFailure("updateQuotationDraft", currentError) };
    if (!current) return { ok: false, reason: "not_found" };
    if (current.status !== "draft") return { ok: false, reason: "not_draft" };

    const problems = await checkReferences(supabase, tenant, input);
    if (problems) return { ok: false, reason: "invalid", ...problems };

    const { p_customer_id, p_quotation_date, p_expiry_date, p_notes, p_items } =
      toQuotationRpcArgs(input);
    const { error } = await supabase.rpc("update_quotation_draft", {
      p_quotation_id: quotationId,
      p_customer_id,
      p_quotation_date,
      p_expiry_date,
      p_notes,
      p_items,
    });
    if (error) return { ok: false, reason: quotationWriteFailure("updateQuotationDraft", error) };
    return { ok: true, quotationId };
  } catch (err) {
    console.error("updateQuotationDraft threw", err);
    return { ok: false, reason: "failed" };
  }
}

/**
 * Moves a quotation to a new status. The database checks the role, the
 * tenant and the transition from the current (locked) status.
 */
export async function setQuotationStatus(
  tenant: Tenant,
  quotationId: string,
  status: QuotationTargetStatus,
): Promise<QuotationWriteResult> {
  if (!(status in STATUS_ACTIONS)) return { ok: false, reason: "invalid" };
  if (!canQuotation(tenant.role, STATUS_ACTIONS[status]))
    return { ok: false, reason: "forbidden" };
  if (!isUuid(quotationId)) return { ok: false, reason: "not_found" };

  try {
    const supabase = await createClient();
    const { error } = await supabase.rpc("set_quotation_status", {
      p_quotation_id: quotationId,
      p_status: status,
    });
    if (error) return { ok: false, reason: quotationWriteFailure("setQuotationStatus", error) };
    return { ok: true, quotationId };
  } catch (err) {
    console.error("setQuotationStatus threw", err);
    return { ok: false, reason: "failed" };
  }
}
