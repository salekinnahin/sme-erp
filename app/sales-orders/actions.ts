"use server";

import { redirect, unstable_rethrow } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireTenant, type TenantContext } from "@/lib/tenancy/context";
import { itemErrorsByKey, type CustomerOption, type OptionSearchResult, type ProductOption } from "@/lib/quotations/form";
import { parseSalesOrderFormItems } from "@/lib/sales-orders/form";
import {
  CONVERSION_FAILURE_MESSAGES,
  FIX_FIELDS_ERROR,
  GENERIC_ERROR,
  SALES_ORDER_FAILURE_MESSAGES,
  UNREADABLE_ITEMS_ERROR,
  isStaleFailure,
  salesOrderFailureState,
  type ConversionFormState,
  type SalesOrderFormState,
} from "@/lib/sales-orders/messages";
import { searchSalesOrderCustomers, searchSalesOrderProducts } from "@/lib/sales-orders/option-search";
import {
  createSalesOrder,
  createSalesOrderFromQuotation,
  setSalesOrderStatus,
  updateSalesOrderDraft,
} from "@/lib/sales-orders/sales-orders";
import {
  isSalesOrderStatus,
  validateConversionInput,
  validateSalesOrderInput,
  type SalesOrderInput,
  type SalesOrderItemErrors,
} from "@/lib/sales-orders/validation";

/**
 * Sales order Server Actions. Each one resolves the tenant on the server,
 * validates the input, calls the domain function and maps its reason to a
 * safe message (lib/sales-orders/messages.ts).
 *
 * Only these fields are read from the form: customerId, orderDate,
 * expectedDeliveryDate, notes and the "items" JSON (per line: line ID,
 * product, description, quantity, unit price, discount, tax rate); for a
 * conversion only orderDate and expectedDeliveryDate. organization_id,
 * number, status, created_by, source quotation, snapshots and amounts are
 * never taken from the request; the database derives them.
 */

export type StatusState = { error?: string };

function readString(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

async function loadTenant(): Promise<TenantContext | null> {
  try {
    return await requireTenant();
  } catch (err) {
    unstable_rethrow(err); // let redirect() through
    console.error("Failed to load tenant in sales order action", err);
    return null;
  }
}

type ValidForm = { ok: true; tenant: TenantContext; input: SalesOrderInput; keys: string[] };

async function readValidForm(
  formData: FormData,
): Promise<ValidForm | { ok: false; state: SalesOrderFormState }> {
  const items = parseSalesOrderFormItems(formData.get("items"));
  if (!items.ok) return { ok: false, state: { error: UNREADABLE_ITEMS_ERROR } };

  const tenant = await loadTenant();
  if (!tenant) return { ok: false, state: { error: GENERIC_ERROR } };

  const parsed = validateSalesOrderInput({
    customerId: readString(formData, "customerId"),
    orderDate: readString(formData, "orderDate"),
    expectedDeliveryDate: readString(formData, "expectedDeliveryDate"),
    notes: readString(formData, "notes"),
    items: items.items,
  });
  if (!parsed.ok)
    return {
      ok: false,
      state: {
        error: FIX_FIELDS_ERROR,
        fieldErrors: parsed.fieldErrors,
        itemErrors: itemErrorsByKey<SalesOrderItemErrors>(items.keys, parsed.itemErrors),
      },
    };
  return { ok: true, tenant, input: parsed.value, keys: items.keys };
}

export async function createSalesOrderAction(
  _prev: SalesOrderFormState,
  formData: FormData,
): Promise<SalesOrderFormState> {
  const form = await readValidForm(formData);
  if (!form.ok) return form.state;

  const result = await createSalesOrder(form.tenant, form.input);
  if (!result.ok) return salesOrderFailureState(result, form.keys);

  revalidatePath("/sales-orders");
  redirect(`/sales-orders/${result.salesOrderId}`);
}

/** Bound to the sales order ID by the edit page. The ID is re-checked here. */
export async function updateSalesOrderAction(
  salesOrderId: string,
  _prev: SalesOrderFormState,
  formData: FormData,
): Promise<SalesOrderFormState> {
  const form = await readValidForm(formData);
  if (!form.ok) return form.state;

  const result = await updateSalesOrderDraft(form.tenant, salesOrderId, form.input);
  if (!result.ok) {
    if (isStaleFailure(result.reason)) revalidatePath(`/sales-orders/${salesOrderId}`);
    return salesOrderFailureState(result, form.keys);
  }

  revalidatePath("/sales-orders");
  revalidatePath(`/sales-orders/${result.salesOrderId}`);
  redirect(`/sales-orders/${result.salesOrderId}`);
}

export async function setSalesOrderStatusAction(
  _prev: StatusState,
  formData: FormData,
): Promise<StatusState> {
  const salesOrderId = readString(formData, "salesOrderId");
  const status = readString(formData, "status");
  if (!isSalesOrderStatus(status) || status === "draft")
    return { error: SALES_ORDER_FAILURE_MESSAGES.invalid };

  const tenant = await loadTenant();
  if (!tenant) return { error: GENERIC_ERROR };

  const result = await setSalesOrderStatus(tenant, salesOrderId, status);
  if (!result.ok) {
    // Someone else changed the order: re-render the page with its latest
    // status (and buttons) next to the message.
    if (isStaleFailure(result.reason)) {
      revalidatePath("/sales-orders");
      revalidatePath(`/sales-orders/${salesOrderId}`);
    }
    return { error: SALES_ORDER_FAILURE_MESSAGES[result.reason] };
  }

  revalidatePath("/sales-orders");
  revalidatePath(`/sales-orders/${salesOrderId}`);
  return {};
}

/**
 * Converts an accepted quotation. Bound to the quotation ID by the quotation
 * detail page; the database copies everything else from the quotation.
 */
export async function convertQuotationAction(
  quotationId: string,
  _prev: ConversionFormState,
  formData: FormData,
): Promise<ConversionFormState> {
  const parsed = validateConversionInput({
    quotationId,
    orderDate: readString(formData, "orderDate"),
    expectedDeliveryDate: readString(formData, "expectedDeliveryDate"),
  });
  if (!parsed.ok) {
    if (parsed.fieldErrors.quotationId) return { error: CONVERSION_FAILURE_MESSAGES.not_found };
    return { error: FIX_FIELDS_ERROR, fieldErrors: parsed.fieldErrors };
  }

  const tenant = await loadTenant();
  if (!tenant) return { error: GENERIC_ERROR };

  const result = await createSalesOrderFromQuotation(tenant, parsed.value);
  if (!result.ok) {
    // Converted by someone else, status changed, or no longer visible: the
    // quotation page re-renders with its current state (e.g. "View sales
    // order") next to the message.
    if (isStaleFailure(result.reason)) revalidatePath(`/quotations/${parsed.value.quotationId}`);
    return { error: CONVERSION_FAILURE_MESSAGES[result.reason] };
  }

  revalidatePath("/sales-orders");
  revalidatePath(`/quotations/${parsed.value.quotationId}`);
  redirect(`/sales-orders/${result.salesOrderId}`);
}

// -----------------------------------------------------------------------------
// Selector search for the create / edit form (lib/sales-orders/option-search.ts:
// tenant from the session, active members only, fails closed)
// -----------------------------------------------------------------------------

export async function searchSalesOrderCustomersAction(
  search: unknown,
): Promise<OptionSearchResult<CustomerOption>> {
  return searchSalesOrderCustomers(search);
}

export async function searchSalesOrderProductsAction(
  search: unknown,
): Promise<OptionSearchResult<ProductOption>> {
  return searchSalesOrderProducts(search);
}
