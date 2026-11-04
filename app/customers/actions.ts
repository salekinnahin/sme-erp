"use server";

import { redirect, unstable_rethrow } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireTenant, type TenantContext } from "@/lib/tenancy/context";
import {
  createCustomer,
  setCustomerStatus,
  updateCustomer,
  type CustomerWriteFailure,
} from "@/lib/customers/customers";
import {
  CUSTOMER_FIELDS,
  isCustomerStatus,
  validateCustomerInput,
  type CustomerFieldErrors,
  type CustomerRawInput,
} from "@/lib/customers/validation";

export type CustomerFormState = {
  error?: string;
  fieldErrors?: CustomerFieldErrors;
  values?: CustomerRawInput;
};

export type CustomerStatusState = { error?: string };

const GENERIC_ERROR = "Something went wrong. Please try again in a moment.";

const FAILURE_MESSAGES: Record<CustomerWriteFailure, string> = {
  invalid: "Some details are not valid. Please check the form and try again.",
  forbidden: "You don't have permission to do that.",
  not_found: "This customer could not be found.",
  failed: GENERIC_ERROR,
};

function readString(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function readCustomerFields(formData: FormData): CustomerRawInput {
  // Only these fields are read. organization_id, status, created_by and
  // created_at are never taken from the request.
  return Object.fromEntries(
    CUSTOMER_FIELDS.map((name) => [name, readString(formData, name)]),
  ) as CustomerRawInput;
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
    console.error("Failed to load tenant in customer action", err);
    return null;
  }
}

export async function createCustomerAction(
  _prev: CustomerFormState,
  formData: FormData,
): Promise<CustomerFormState> {
  const values = readCustomerFields(formData);

  const tenant = await loadTenant();
  if (!tenant) return { error: GENERIC_ERROR, values };

  const parsed = validateCustomerInput(values);
  if (!parsed.ok) return { fieldErrors: parsed.fieldErrors, values };

  const result = await createCustomer(tenant, parsed.value);
  if (!result.ok) return { error: FAILURE_MESSAGES[result.reason], values };

  revalidatePath("/customers");
  redirect(`/customers/${result.customerId}`);
}

/** Bound to the customer ID by the edit page. The ID is re-checked here. */
export async function updateCustomerAction(
  customerId: string,
  _prev: CustomerFormState,
  formData: FormData,
): Promise<CustomerFormState> {
  const values = readCustomerFields(formData);

  const tenant = await loadTenant();
  if (!tenant) return { error: GENERIC_ERROR, values };

  const parsed = validateCustomerInput(values);
  if (!parsed.ok) return { fieldErrors: parsed.fieldErrors, values };

  const result = await updateCustomer(tenant, customerId, parsed.value);
  if (!result.ok) return { error: FAILURE_MESSAGES[result.reason], values };

  revalidatePath("/customers");
  revalidatePath(`/customers/${result.customerId}`);
  redirect(`/customers/${result.customerId}`);
}

export async function setCustomerStatusAction(
  _prev: CustomerStatusState,
  formData: FormData,
): Promise<CustomerStatusState> {
  const customerId = readString(formData, "customerId");
  const status = readString(formData, "status");
  if (!isCustomerStatus(status)) return { error: FAILURE_MESSAGES.invalid };

  const tenant = await loadTenant();
  if (!tenant) return { error: GENERIC_ERROR };

  const result = await setCustomerStatus(tenant, customerId, status);
  if (!result.ok) return { error: FAILURE_MESSAGES[result.reason] };

  revalidatePath("/customers");
  revalidatePath(`/customers/${customerId}`);
  return {};
}
