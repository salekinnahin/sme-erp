"use server";

import { redirect, unstable_rethrow } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireTenant, type TenantContext } from "@/lib/tenancy/context";
import { itemErrorsByKey, type OptionSearchResult } from "@/lib/quotations/form";
import {
  parsePurchaseOrderFormItems,
  type PurchaseProductOption,
  type VendorOption,
} from "@/lib/purchase-orders/form";
import {
  FIX_FIELDS_ERROR,
  GENERIC_ERROR,
  PURCHASE_ORDER_FAILURE_MESSAGES,
  UNREADABLE_ITEMS_ERROR,
  isStaleFailure,
  purchaseOrderStatusFailureMessage,
  purchaseOrderFailureState,
  type PurchaseOrderFormState,
} from "@/lib/purchase-orders/messages";
import {
  searchPurchaseOrderProducts,
  searchPurchaseOrderVendors,
} from "@/lib/purchase-orders/option-search";
import {
  createPurchaseOrder,
  setPurchaseOrderStatus,
  updatePurchaseOrderDraft,
} from "@/lib/purchase-orders/purchase-orders";
import {
  isPurchaseOrderUserTargetStatus,
  validatePurchaseOrderInput,
  type PurchaseOrderInput,
  type PurchaseOrderItemErrors,
} from "@/lib/purchase-orders/validation";

/**
 * Purchase order Server Actions. Each one resolves the tenant on the server,
 * validates the input, calls the domain function and maps its reason to a
 * safe message (lib/purchase-orders/messages.ts).
 *
 * Only these fields are read from the form: vendorId, orderDate,
 * expectedDeliveryDate, notes and the "items" JSON (per line: line ID,
 * product, description, quantity, unit price, discount, tax rate).
 * organization_id, number, status, created_by, snapshots and amounts are
 * never taken from the request; the database derives them. Nothing here
 * touches stock: a purchase order is only an order to a vendor.
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
    console.error("Failed to load tenant in purchase order action", err);
    return null;
  }
}

type ValidForm = { ok: true; tenant: TenantContext; input: PurchaseOrderInput; keys: string[] };

async function readValidForm(
  formData: FormData,
): Promise<ValidForm | { ok: false; state: PurchaseOrderFormState }> {
  const items = parsePurchaseOrderFormItems(formData.get("items"));
  if (!items.ok) return { ok: false, state: { error: UNREADABLE_ITEMS_ERROR } };

  const tenant = await loadTenant();
  if (!tenant) return { ok: false, state: { error: GENERIC_ERROR } };

  const parsed = validatePurchaseOrderInput({
    vendorId: readString(formData, "vendorId"),
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
        itemErrors: itemErrorsByKey<PurchaseOrderItemErrors>(items.keys, parsed.itemErrors),
      },
    };
  return { ok: true, tenant, input: parsed.value, keys: items.keys };
}

export async function createPurchaseOrderAction(
  _prev: PurchaseOrderFormState,
  formData: FormData,
): Promise<PurchaseOrderFormState> {
  const form = await readValidForm(formData);
  if (!form.ok) return form.state;

  const result = await createPurchaseOrder(form.tenant, form.input);
  if (!result.ok) return purchaseOrderFailureState(result, form.keys);

  revalidatePath("/purchase-orders");
  redirect(`/purchase-orders/${result.purchaseOrderId}`);
}

/** Bound to the purchase order ID by the edit page. The ID is re-checked here. */
export async function updatePurchaseOrderAction(
  purchaseOrderId: string,
  _prev: PurchaseOrderFormState,
  formData: FormData,
): Promise<PurchaseOrderFormState> {
  const form = await readValidForm(formData);
  if (!form.ok) return form.state;

  const result = await updatePurchaseOrderDraft(form.tenant, purchaseOrderId, form.input);
  if (!result.ok) {
    // Ordered/cancelled elsewhere, or no longer visible: refresh the detail page.
    if (isStaleFailure(result.reason)) revalidatePath(`/purchase-orders/${purchaseOrderId}`);
    return purchaseOrderFailureState(result, form.keys);
  }

  revalidatePath("/purchase-orders");
  revalidatePath(`/purchase-orders/${result.purchaseOrderId}`);
  redirect(`/purchase-orders/${result.purchaseOrderId}`);
}

/** Order or cancel. Receiving statuses are never accepted from the browser. */
export async function setPurchaseOrderStatusAction(
  _prev: StatusState,
  formData: FormData,
): Promise<StatusState> {
  const purchaseOrderId = readString(formData, "purchaseOrderId");
  const status = readString(formData, "status");
  if (!isPurchaseOrderUserTargetStatus(status))
    return { error: PURCHASE_ORDER_FAILURE_MESSAGES.invalid };

  const tenant = await loadTenant();
  if (!tenant) return { error: GENERIC_ERROR };

  const result = await setPurchaseOrderStatus(tenant, purchaseOrderId, status);
  if (!result.ok) {
    // Someone else changed the order: re-render the page with its latest
    // status (and buttons) next to the message.
    if (isStaleFailure(result.reason)) {
      revalidatePath("/purchase-orders");
      revalidatePath(`/purchase-orders/${purchaseOrderId}`);
    }
    return { error: purchaseOrderStatusFailureMessage(result.reason, result.affectedLines) };
  }

  revalidatePath("/purchase-orders");
  revalidatePath(`/purchase-orders/${purchaseOrderId}`);
  return {};
}

// -----------------------------------------------------------------------------
// Selector search for the create / edit form (lib/purchase-orders/option-search.ts:
// tenant from the session, active members only, active records only, fails closed)
// -----------------------------------------------------------------------------

export async function searchPurchaseOrderVendorsAction(
  search: unknown,
): Promise<OptionSearchResult<VendorOption>> {
  return searchPurchaseOrderVendors(search);
}

export async function searchPurchaseOrderProductsAction(
  search: unknown,
): Promise<OptionSearchResult<PurchaseProductOption>> {
  return searchPurchaseOrderProducts(search);
}
