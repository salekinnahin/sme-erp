"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getTenant, getUser } from "@/lib/tenancy/context";
import { createOrganization } from "@/lib/organizations/create-organization";
import {
  validateOrganizationInput,
  type OrganizationFieldErrors,
  type OrganizationRawInput,
} from "@/lib/organizations/validation";

export type OnboardingFormState = {
  error?: string;
  fieldErrors?: OrganizationFieldErrors;
  values?: OrganizationRawInput;
};

const GENERIC_ERROR =
  "We couldn't create your organization. Please try again in a moment.";

function field(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

export async function createOrganizationAction(
  _prev: OnboardingFormState,
  formData: FormData,
): Promise<OnboardingFormState> {
  // Only the form fields below are read. user_id, organization_id and role
  // are never taken from the request.
  const values: OrganizationRawInput = {
    name: field(formData, "name"),
    email: field(formData, "email"),
    phone: field(formData, "phone"),
    address: field(formData, "address"),
    currency: field(formData, "currency"),
    timezone: field(formData, "timezone"),
    taxNumber: field(formData, "taxNumber"),
  };

  const user = await getUser();
  if (!user) redirect("/auth/login");

  let alreadyMember: boolean;
  try {
    alreadyMember = Boolean(await getTenant());
  } catch {
    return { error: GENERIC_ERROR, values };
  }
  // Repeat submission, or the user already has an organization.
  if (alreadyMember) redirect("/dashboard");

  const parsed = validateOrganizationInput(values);
  if (!parsed.ok) return { fieldErrors: parsed.fieldErrors, values };

  const result = await createOrganization(parsed.value);

  if (!result.ok) {
    switch (result.reason) {
      case "unauthenticated":
        redirect("/auth/login");
      case "already_member":
        redirect("/dashboard");
      case "invalid":
        return {
          error: "Some details are not valid. Please check the form and try again.",
          values,
        };
      default:
        return { error: GENERIC_ERROR, values };
    }
  }

  revalidatePath("/", "layout");
  redirect("/dashboard");
}
