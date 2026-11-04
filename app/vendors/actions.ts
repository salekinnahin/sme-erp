"use server";

import { redirect, unstable_rethrow } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireTenant, type TenantContext } from "@/lib/tenancy/context";
import {
  createVendor,
  setVendorStatus,
  updateVendor,
  type VendorWriteFailure,
} from "@/lib/vendors/vendors";
import {
  VENDOR_FIELDS,
  isVendorStatus,
  validateVendorInput,
  type VendorFieldErrors,
  type VendorRawInput,
} from "@/lib/vendors/validation";

export type VendorFormState = {
  error?: string;
  fieldErrors?: VendorFieldErrors;
  values?: VendorRawInput;
};

export type VendorStatusState = { error?: string };

const GENERIC_ERROR = "Something went wrong. Please try again in a moment.";

const FAILURE_MESSAGES: Record<VendorWriteFailure, string> = {
  invalid: "Some details are not valid. Please check the form and try again.",
  forbidden: "You don't have permission to do that.",
  not_found: "This vendor could not be found.",
  failed: GENERIC_ERROR,
};

function readString(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function readVendorFields(formData: FormData): VendorRawInput {
  // Only these fields are read. organization_id, status, created_by and
  // created_at are never taken from the request.
  return Object.fromEntries(
    VENDOR_FIELDS.map((name) => [name, readString(formData, name)]),
  ) as VendorRawInput;
}

/**
 * The tenant for this request. Redirects if the user is signed out or has no
 * organization; returns null on a database error.
 */
async function loadTenant(): Promise<TenantContext | null> {
  try {
    return await requireTenant();
  } catch (err) {
    unstable_rethrow(err); // let redirect() through
    console.error("Failed to load tenant in vendor action", err);
    return null;
  }
}

export async function createVendorAction(
  _prev: VendorFormState,
  formData: FormData,
): Promise<VendorFormState> {
  const values = readVendorFields(formData);

  const tenant = await loadTenant();
  if (!tenant) return { error: GENERIC_ERROR, values };

  const parsed = validateVendorInput(values);
  if (!parsed.ok) return { fieldErrors: parsed.fieldErrors, values };

  const result = await createVendor(tenant, parsed.value);
  if (!result.ok) return { error: FAILURE_MESSAGES[result.reason], values };

  revalidatePath("/vendors");
  redirect(`/vendors/${result.vendorId}`);
}

/** Bound to the vendor ID by the edit page. The ID is re-checked here. */
export async function updateVendorAction(
  vendorId: string,
  _prev: VendorFormState,
  formData: FormData,
): Promise<VendorFormState> {
  const values = readVendorFields(formData);

  const tenant = await loadTenant();
  if (!tenant) return { error: GENERIC_ERROR, values };

  const parsed = validateVendorInput(values);
  if (!parsed.ok) return { fieldErrors: parsed.fieldErrors, values };

  const result = await updateVendor(tenant, vendorId, parsed.value);
  if (!result.ok) return { error: FAILURE_MESSAGES[result.reason], values };

  revalidatePath("/vendors");
  revalidatePath(`/vendors/${result.vendorId}`);
  redirect(`/vendors/${result.vendorId}`);
}

export async function setVendorStatusAction(
  _prev: VendorStatusState,
  formData: FormData,
): Promise<VendorStatusState> {
  const vendorId = readString(formData, "vendorId");
  const status = readString(formData, "status");
  if (!isVendorStatus(status)) return { error: FAILURE_MESSAGES.invalid };

  const tenant = await loadTenant();
  if (!tenant) return { error: GENERIC_ERROR };

  const result = await setVendorStatus(tenant, vendorId, status);
  if (!result.ok) return { error: FAILURE_MESSAGES[result.reason] };

  revalidatePath("/vendors");
  revalidatePath(`/vendors/${vendorId}`);
  return {};
}
