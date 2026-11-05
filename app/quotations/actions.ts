"use server";

import { redirect, unstable_rethrow } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireTenant, type TenantContext } from "@/lib/tenancy/context";
import {
  itemErrorsByKey,
  parseFormItems,
  type CustomerOption,
  type OptionSearchResult,
  type ProductOption,
} from "@/lib/quotations/form";
import { searchQuotationCustomers, searchQuotationProducts } from "@/lib/quotations/option-search";
import {
  FIX_FIELDS_ERROR,
  GENERIC_ERROR,
  QUOTATION_FAILURE_MESSAGES,
  UNREADABLE_ITEMS_ERROR,
  quotationFailureState,
  type QuotationFormState,
} from "@/lib/quotations/messages";
import {
  createQuotation,
  setQuotationStatus,
  updateQuotationDraft,
} from "@/lib/quotations/quotations";
import {
  isQuotationStatus,
  validateQuotationInput,
  type QuotationInput,
} from "@/lib/quotations/validation";

/**
 * Quotation Server Actions. Each one resolves the tenant on the server,
 * validates the input, calls the domain function and maps its reason to a
 * safe message (lib/quotations/messages.ts).
 *
 * Only these fields are read from the form: customerId, quotationDate,
 * expiryDate, notes and the "items" JSON (per line: product, description,
 * quantity, unit price, discount, tax rate). organization_id, number,
 * status, created_by, snapshots and amounts are never taken from the
 * request; the database derives them.
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
    console.error("Failed to load tenant in quotation action", err);
    return null;
  }
}

type ValidForm = { ok: true; tenant: TenantContext; input: QuotationInput; keys: string[] };

async function readValidForm(
  formData: FormData,
): Promise<ValidForm | { ok: false; state: QuotationFormState }> {
  const items = parseFormItems(formData.get("items"));
  if (!items.ok) return { ok: false, state: { error: UNREADABLE_ITEMS_ERROR } };

  const tenant = await loadTenant();
  if (!tenant) return { ok: false, state: { error: GENERIC_ERROR } };

  const parsed = validateQuotationInput({
    customerId: readString(formData, "customerId"),
    quotationDate: readString(formData, "quotationDate"),
    expiryDate: readString(formData, "expiryDate"),
    notes: readString(formData, "notes"),
    items: items.items,
  });
  if (!parsed.ok)
    return {
      ok: false,
      state: {
        error: FIX_FIELDS_ERROR,
        fieldErrors: parsed.fieldErrors,
        itemErrors: itemErrorsByKey(items.keys, parsed.itemErrors),
      },
    };
  return { ok: true, tenant, input: parsed.value, keys: items.keys };
}

export async function createQuotationAction(
  _prev: QuotationFormState,
  formData: FormData,
): Promise<QuotationFormState> {
  const form = await readValidForm(formData);
  if (!form.ok) return form.state;

  const result = await createQuotation(form.tenant, form.input);
  if (!result.ok) return quotationFailureState(result, form.keys);

  revalidatePath("/quotations");
  redirect(`/quotations/${result.quotationId}`);
}

/** Bound to the quotation ID by the edit page. The ID is re-checked here. */
export async function updateQuotationAction(
  quotationId: string,
  _prev: QuotationFormState,
  formData: FormData,
): Promise<QuotationFormState> {
  const form = await readValidForm(formData);
  if (!form.ok) return form.state;

  const result = await updateQuotationDraft(form.tenant, quotationId, form.input);
  if (!result.ok) return quotationFailureState(result, form.keys);

  revalidatePath("/quotations");
  revalidatePath(`/quotations/${result.quotationId}`);
  redirect(`/quotations/${result.quotationId}`);
}

export async function setQuotationStatusAction(
  _prev: StatusState,
  formData: FormData,
): Promise<StatusState> {
  const quotationId = readString(formData, "quotationId");
  const status = readString(formData, "status");
  if (!isQuotationStatus(status) || status === "draft")
    return { error: QUOTATION_FAILURE_MESSAGES.invalid };

  const tenant = await loadTenant();
  if (!tenant) return { error: GENERIC_ERROR };

  const result = await setQuotationStatus(tenant, quotationId, status);
  if (!result.ok) return { error: QUOTATION_FAILURE_MESSAGES[result.reason] };

  revalidatePath("/quotations");
  revalidatePath(`/quotations/${quotationId}`);
  return {};
}

// -----------------------------------------------------------------------------
// Selector search for the create / edit form (lib/quotations/option-search.ts:
// tenant from the session, active members only, fails closed)
// -----------------------------------------------------------------------------

/** Active customers of the caller's organization matching `search`. */
export async function searchQuotationCustomersAction(
  search: unknown,
): Promise<OptionSearchResult<CustomerOption>> {
  return searchQuotationCustomers(search);
}

/** Active products of the caller's organization matching `search`. */
export async function searchQuotationProductsAction(
  search: unknown,
): Promise<OptionSearchResult<ProductOption>> {
  return searchQuotationProducts(search);
}
