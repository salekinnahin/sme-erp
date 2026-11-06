"use server";

import { redirect, unstable_rethrow } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireTenant, type TenantContext } from "@/lib/tenancy/context";
import { isUuid } from "@/lib/validation/fields";
import { createGoodsReceipt } from "@/lib/goods-receipts/goods-receipts";
import {
  NO_QUANTITY_ERROR,
  normalizeReceivingEntries,
  parseReceivingItemsField,
  receivedDateError,
  type ReceivingFieldErrors,
} from "@/lib/goods-receipts/receiving";
import {
  RECEIVING_FIX_FIELDS_MESSAGE,
  RECEIVING_GENERIC_MESSAGE,
  RECEIVING_UNREADABLE_MESSAGE,
  receivingFailureState,
  type ReceiveGoodsFormState,
} from "@/lib/goods-receipts/messages";

/**
 * Records one goods receipt for a purchase order. Bound to the purchase
 * order ID by the receive page; the ID is re-checked for the session tenant
 * by createGoodsReceipt() and again by create_goods_receipt().
 *
 * Only these fields are read: receivedDate, notes and the "items" JSON
 * (per line: purchase order line ID and quantity). Organization, product
 * IDs, snapshots, numbers, status and creator are never taken from the
 * browser; the database derives them from the purchase order. Blank/zero
 * lines are omitted. Nothing here changes stock.
 */
export async function recordGoodsReceiptAction(
  purchaseOrderId: string,
  _prev: ReceiveGoodsFormState,
  formData: FormData,
): Promise<ReceiveGoodsFormState> {
  if (!isUuid(purchaseOrderId)) return receivingFailureState("not_found");
  const entries = parseReceivingItemsField(formData.get("items"));
  if (!entries) return { error: RECEIVING_UNREADABLE_MESSAGE };

  const receivedDate = readString(formData, "receivedDate");
  const notes = readString(formData, "notes");
  const { items, lineErrors } = normalizeReceivingEntries(entries);
  const fieldErrors: ReceivingFieldErrors = {};
  // Order-date comparison happens in createGoodsReceipt() with the PO read.
  const dateError = receivedDateError(receivedDate, null);
  if (dateError) fieldErrors.receivedDate = dateError;
  if (items.length === 0 && Object.keys(lineErrors).length === 0) fieldErrors.items = NO_QUANTITY_ERROR;
  if (Object.keys(fieldErrors).length || Object.keys(lineErrors).length)
    return { error: RECEIVING_FIX_FIELDS_MESSAGE, fieldErrors, lineErrors };

  const tenant = await loadTenant();
  if (!tenant) return { error: RECEIVING_GENERIC_MESSAGE };

  const result = await createGoodsReceipt(tenant, { purchaseOrderId, receivedDate, notes, items });
  if (!result.ok) {
    const state = receivingFailureState(result.reason);
    // Someone else received, completed or changed the order: re-render the
    // page with the latest remaining quantities next to the message.
    if (state.stale) revalidatePurchaseOrder(purchaseOrderId.toLowerCase());
    return state;
  }

  revalidatePath("/goods-receipts");
  revalidatePurchaseOrder(purchaseOrderId.toLowerCase());
  redirect(`/goods-receipts/${result.goodsReceiptId}?recorded=1`);
}

function readString(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function revalidatePurchaseOrder(purchaseOrderId: string) {
  revalidatePath("/purchase-orders");
  revalidatePath(`/purchase-orders/${purchaseOrderId}`);
  revalidatePath(`/purchase-orders/${purchaseOrderId}/receive`);
}

async function loadTenant(): Promise<TenantContext | null> {
  try {
    return await requireTenant();
  } catch (err) {
    unstable_rethrow(err); // let redirect() through
    console.error("Failed to load tenant in goods receipt action", err);
    return null;
  }
}
