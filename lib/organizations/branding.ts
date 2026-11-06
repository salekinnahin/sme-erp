import "server-only";

import { cache } from "react";

import { createClient } from "@/lib/supabase/server";
import type { TenantContext } from "@/lib/tenancy/context";
import { getOrganizationDetails, type OrganizationDetails } from "./details";
import {
  LOGO_BUCKET,
  LOGO_SIGNED_URL_SECONDS,
  organizationLogoPath,
  precheckLogoFile,
  validateLogo,
  type LogoRejection,
} from "./logo";
import { canBranding } from "./permissions";

/**
 * Organization branding (DECISIONS 029). Callers pass the tenant from
 * requireTenant(); the organization is never taken from request input.
 *
 * Branding is live organization data: documents always show the current
 * logo and details, not a snapshot. The logo is a private Storage object;
 * pages get a short-lived signed URL created at render time. No URL is
 * stored and the service-role key is never used: Storage policies check the
 * signed-in user's own session.
 */

type Tenant = Pick<TenantContext, "organization" | "role">;

export type OrganizationBranding = Omit<OrganizationDetails, "logoPath"> & {
  /** Signed URL valid for LOGO_SIGNED_URL_SECONDS, or null (text-only header). */
  logoUrl: string | null;
};

export type BrandingWriteFailure = LogoRejection | "forbidden" | "failed";
export type BrandingWriteResult = { ok: true } | { ok: false; reason: BrandingWriteFailure };

type StorageErrorLike = { message?: string; status?: number; statusCode?: string | number };

/**
 * Current branding of the tenant's own organization. A missing, foreign or
 * unreadable logo never fails the page: it falls back to logoUrl = null.
 * Database errors reading the organization still throw (as the details
 * helper does) so the route's error boundary handles them.
 */
// requireTenant() returns getTenant()'s request-cached object unchanged. All
// render callers pass that exact object, so React's reference keys deduplicate
// both the organization read and signing. No signed URL survives the request.
export const getOrganizationBranding = cache(async (tenant: Tenant): Promise<OrganizationBranding> => {
  const { logoPath, ...details } = await getOrganizationDetails(tenant);
  return { ...details, logoUrl: await signLogo(tenant, logoPath) };
});

async function signLogo(tenant: Tenant, logoPath: string | null): Promise<string | null> {
  // The database CHECK allows only the organization's own key; this keeps
  // the page safe even if that ever changed.
  if (!logoPath || logoPath !== organizationLogoPath(tenant.organization.id)) return null;
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.storage
      .from(LOGO_BUCKET)
      .createSignedUrl(logoPath, LOGO_SIGNED_URL_SECONDS);
    if (error || !data?.signedUrl) {
      logStorageError("Sign organization logo", error);
      return null;
    }
    return data.signedUrl;
  } catch (err) {
    logStorageError("Sign organization logo", err as StorageErrorLike);
    return null;
  }
}

/**
 * Validates the file's actual bytes, uploads it to the organization's single
 * logo key (replacing any previous logo) and records it. Owners/managers only.
 */
export async function uploadOrganizationLogo(tenant: Tenant, file: File): Promise<BrandingWriteResult> {
  if (!canBranding(tenant.role, "manage")) return { ok: false, reason: "forbidden" };

  // Reject on size/declared type before reading the body into memory.
  const early = precheckLogoFile(file);
  if (early) return { ok: false, reason: early };
  const bytes = new Uint8Array(await file.arrayBuffer());
  const checked = validateLogo({ size: file.size, type: file.type, bytes });
  if (!checked.ok) return checked;

  const path = organizationLogoPath(tenant.organization.id);
  try {
    const supabase = await createClient();
    const { error: uploadError } = await supabase.storage.from(LOGO_BUCKET).upload(path, bytes, {
      // The detected format, never the browser-reported type.
      contentType: checked.image.mimeType,
      upsert: true,
      cacheControl: "60",
    });
    if (uploadError) return storageFailure("Upload organization logo", uploadError);

    const { error } = await supabase.rpc("set_organization_logo", {
      p_organization_id: tenant.organization.id,
    });
    if (error) return rpcFailure("Record organization logo", error);
    return { ok: true };
  } catch (err) {
    return storageFailure("Upload organization logo", err as StorageErrorLike);
  }
}

/**
 * Clears the organization's logo, then removes the object. Documents fall
 * back to the text-only header. If removing the object fails after the logo
 * was cleared, the result is still success: nothing shows it any more, and
 * the next upload overwrites the same key.
 */
export async function removeOrganizationLogo(tenant: Tenant): Promise<BrandingWriteResult> {
  if (!canBranding(tenant.role, "manage")) return { ok: false, reason: "forbidden" };

  try {
    const supabase = await createClient();
    const { error } = await supabase.rpc("clear_organization_logo", {
      p_organization_id: tenant.organization.id,
    });
    if (error) return rpcFailure("Clear organization logo", error);

    const { error: removeError } = await supabase.storage
      .from(LOGO_BUCKET)
      .remove([organizationLogoPath(tenant.organization.id)]);
    if (removeError) logStorageError("Remove organization logo object", removeError);
    return { ok: true };
  } catch (err) {
    return storageFailure("Remove organization logo", err as StorageErrorLike);
  }
}

function rpcFailure(operation: string, error: { code?: string; message?: string }): BrandingWriteResult {
  if (error.code === "42501") return { ok: false, reason: "forbidden" };
  console.error(`${operation} failed`, { code: error.code, message: error.message });
  return { ok: false, reason: "failed" };
}

function storageFailure(operation: string, error: StorageErrorLike | null | undefined): BrandingWriteResult {
  const status = Number(error?.statusCode ?? error?.status);
  if (status === 401 || status === 403) return { ok: false, reason: "forbidden" };
  if (status === 413) return { ok: false, reason: "too_large" };
  if (status === 415) return { ok: false, reason: "unsupported_type" };
  logStorageError(operation, error);
  return { ok: false, reason: "failed" };
}

function logStorageError(operation: string, error: StorageErrorLike | null | undefined) {
  // Server log only. Never send storage details to the browser.
  console.error(`${operation} failed`, {
    status: error?.statusCode ?? error?.status,
    message: error?.message,
  });
}
