"use server";

import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { requireTenant, type TenantContext } from "@/lib/tenancy/context";
import {
  removeOrganizationLogo,
  uploadOrganizationLogo,
  type BrandingWriteFailure,
} from "@/lib/organizations/branding";
import { LOGO_REJECTION_MESSAGES } from "@/lib/organizations/logo";
import { canBranding } from "@/lib/organizations/permissions";

export type LogoActionState = { error?: string; success?: string };

const GENERIC_ERROR = "Something went wrong. Please try again in a moment.";
const FORBIDDEN = "You don't have permission to change the logo. Only owners and managers can.";

const UPLOAD_MESSAGES: Record<BrandingWriteFailure, string> = {
  ...LOGO_REJECTION_MESSAGES,
  forbidden: FORBIDDEN,
  failed: "The logo could not be uploaded. Please try again in a moment.",
};

const REMOVE_MESSAGES: Record<BrandingWriteFailure, string> = {
  ...UPLOAD_MESSAGES,
  failed: "The logo could not be removed. Please try again in a moment.",
};

async function loadTenant(): Promise<TenantContext | null> {
  try {
    return await requireTenant();
  } catch (err) {
    unstable_rethrow(err); // let redirect() through
    console.error("Failed to load tenant in branding action", err);
    return null;
  }
}

/**
 * Only the "logo" file is read. The organization always comes from the
 * session; any organization field in the request is ignored.
 */
export async function uploadLogoAction(_prev: LogoActionState, formData: FormData): Promise<LogoActionState> {
  const tenant = await loadTenant();
  if (!tenant) return { error: GENERIC_ERROR };
  if (!canBranding(tenant.role, "manage")) return { error: FORBIDDEN };

  const file = formData.get("logo");
  if (!(file instanceof File) || file.size === 0) return { error: LOGO_REJECTION_MESSAGES.missing };

  const result = await uploadOrganizationLogo(tenant, file);
  if (!result.ok) return { error: UPLOAD_MESSAGES[result.reason] };

  revalidatePath("/settings/organization");
  return { success: "Logo updated. Your logo will appear on supported business documents." };
}

export async function removeLogoAction(): Promise<LogoActionState> {
  const tenant = await loadTenant();
  if (!tenant) return { error: GENERIC_ERROR };
  if (!canBranding(tenant.role, "manage")) return { error: FORBIDDEN };

  const result = await removeOrganizationLogo(tenant);
  if (!result.ok) return { error: REMOVE_MESSAGES[result.reason] };

  revalidatePath("/settings/organization");
  return { success: "Logo removed. Documents now print with the text-only header." };
}
