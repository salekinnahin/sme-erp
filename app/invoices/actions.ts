"use server";

import { redirect, unstable_rethrow } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireTenant, type TenantContext } from "@/lib/tenancy/context";
import { itemErrorsByKey, type CustomerOption, type OptionSearchResult, type ProductOption } from "@/lib/quotations/form";
import { parseInvoiceFormItems } from "@/lib/invoices/form";
import {
  CONVERSION_FAILURE_MESSAGES,
  FIX_FIELDS_ERROR,
  GENERIC_ERROR,
  INVOICE_FAILURE_MESSAGES,
  UNREADABLE_ITEMS_ERROR,
  isStaleFailure,
  invoiceFailureState,
  type ConversionFormState,
  type InvoiceFormState,
} from "@/lib/invoices/messages";
import { searchInvoiceCustomers, searchInvoiceProducts } from "@/lib/invoices/option-search";
import {
  createInvoice,
  createInvoiceFromSalesOrder,
  setInvoiceStatus,
  updateInvoiceDraft,
} from "@/lib/invoices/invoices";
import {
  isInvoiceUserTargetStatus,
  validateInvoiceConversionInput,
  validateInvoiceInput,
  type InvoiceInput,
  type InvoiceItemErrors,
} from "@/lib/invoices/validation";

/**
 * Invoice Server Actions. Each one resolves the tenant on the server,
 * validates the input, calls the domain function and maps its reason to a
 * safe message (lib/invoices/messages.ts).
 *
 * Only these fields are read from the form: customerId, invoiceDate,
 * dueDate, notes and the "items" JSON (per line: line ID,
 * product, description, quantity, unit price, discount, tax rate); for a
 * conversion only invoiceDate and dueDate. organization_id,
 * number, status, created_by, source sales order, snapshots and amounts are
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
    console.error("Failed to load tenant in invoice action", err);
    return null;
  }
}

type ValidForm = { ok: true; tenant: TenantContext; input: InvoiceInput; keys: string[] };

async function readValidForm(
  formData: FormData,
): Promise<ValidForm | { ok: false; state: InvoiceFormState }> {
  const items = parseInvoiceFormItems(formData.get("items"));
  if (!items.ok) return { ok: false, state: { error: UNREADABLE_ITEMS_ERROR } };

  const tenant = await loadTenant();
  if (!tenant) return { ok: false, state: { error: GENERIC_ERROR } };

  const parsed = validateInvoiceInput({
    customerId: readString(formData, "customerId"),
    invoiceDate: readString(formData, "invoiceDate"),
    dueDate: readString(formData, "dueDate"),
    notes: readString(formData, "notes"),
    items: items.items,
  });
  if (!parsed.ok)
    return {
      ok: false,
      state: {
        error: FIX_FIELDS_ERROR,
        fieldErrors: parsed.fieldErrors,
        itemErrors: itemErrorsByKey<InvoiceItemErrors>(items.keys, parsed.itemErrors),
      },
    };
  return { ok: true, tenant, input: parsed.value, keys: items.keys };
}

export async function createInvoiceAction(
  _prev: InvoiceFormState,
  formData: FormData,
): Promise<InvoiceFormState> {
  const form = await readValidForm(formData);
  if (!form.ok) return form.state;

  const result = await createInvoice(form.tenant, form.input);
  if (!result.ok) return invoiceFailureState(result, form.keys);

  revalidatePath("/invoices");
  redirect(`/invoices/${result.invoiceId}`);
}

/** Bound to the invoice ID by the edit page. The ID is re-checked here. */
export async function updateInvoiceAction(
  invoiceId: string,
  _prev: InvoiceFormState,
  formData: FormData,
): Promise<InvoiceFormState> {
  const form = await readValidForm(formData);
  if (!form.ok) return form.state;

  const result = await updateInvoiceDraft(form.tenant, invoiceId, form.input);
  if (!result.ok) {
    if (isStaleFailure(result.reason)) revalidatePath(`/invoices/${invoiceId}`);
    return invoiceFailureState(result, form.keys);
  }

  revalidatePath("/invoices");
  revalidatePath(`/invoices/${result.invoiceId}`);
  redirect(`/invoices/${result.invoiceId}`);
}

export async function setInvoiceStatusAction(
  _prev: StatusState,
  formData: FormData,
): Promise<StatusState> {
  const invoiceId = readString(formData, "invoiceId");
  const status = readString(formData, "status");
  if (!isInvoiceUserTargetStatus(status))
    return { error: INVOICE_FAILURE_MESSAGES.invalid };

  const tenant = await loadTenant();
  if (!tenant) return { error: GENERIC_ERROR };

  const result = await setInvoiceStatus(tenant, invoiceId, status);
  if (!result.ok) {
    // Someone else changed the order: re-render the page with its latest
    // status (and buttons) next to the message.
    if (isStaleFailure(result.reason)) {
      revalidatePath("/invoices");
      revalidatePath(`/invoices/${invoiceId}`);
    }
    return { error: INVOICE_FAILURE_MESSAGES[result.reason] };
  }

  revalidatePath("/invoices");
  revalidatePath(`/invoices/${invoiceId}`);
  return {};
}

/**
 * Converts a confirmed sales order. Bound to its ID by the sales order
 * detail page; the database copies its snapshots and amounts.
 */
export async function convertSalesOrderAction(
  salesOrderId: string,
  _prev: ConversionFormState,
  formData: FormData,
): Promise<ConversionFormState> {
  const parsed = validateInvoiceConversionInput({
    salesOrderId,
    invoiceDate: readString(formData, "invoiceDate"),
    dueDate: readString(formData, "dueDate"),
  });
  if (!parsed.ok) {
    if (parsed.fieldErrors.salesOrderId) return { error: CONVERSION_FAILURE_MESSAGES.not_found };
    return { error: FIX_FIELDS_ERROR, fieldErrors: parsed.fieldErrors };
  }

  const tenant = await loadTenant();
  if (!tenant) return { error: GENERIC_ERROR };

  const result = await createInvoiceFromSalesOrder(tenant, parsed.value);
  if (!result.ok) {
    // Converted by someone else, status changed, or no longer visible: the
    // sales order page re-renders with its current state and invoice link.
    if (isStaleFailure(result.reason)) revalidatePath(`/sales-orders/${parsed.value.salesOrderId}`);
    return { error: CONVERSION_FAILURE_MESSAGES[result.reason] };
  }

  revalidatePath("/invoices");
  revalidatePath(`/sales-orders/${parsed.value.salesOrderId}`);
  redirect(`/invoices/${result.invoiceId}`);
}

// -----------------------------------------------------------------------------
// Selector search for the create / edit form (lib/invoices/option-search.ts:
// tenant from the session, active members only, fails closed)
// -----------------------------------------------------------------------------

export async function searchInvoiceCustomersAction(
  search: unknown,
): Promise<OptionSearchResult<CustomerOption>> {
  return searchInvoiceCustomers(search);
}

export async function searchInvoiceProductsAction(
  search: unknown,
): Promise<OptionSearchResult<ProductOption>> {
  return searchInvoiceProducts(search);
}
