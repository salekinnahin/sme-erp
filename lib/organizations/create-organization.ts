import { createClient } from "@/lib/supabase/server";
import type { OrganizationInput } from "./validation";

export type CreateOrganizationResult =
  | { ok: true; organizationId: string }
  | {
      ok: false;
      reason: "unauthenticated" | "already_member" | "invalid" | "failed";
    };

/**
 * Creates an organization with the current user as its active owner, in a
 * single database transaction (`public.create_organization`).
 *
 * The user, role and organization ID come from the database (auth.uid()),
 * never from the caller.
 */
export async function createOrganization(
  input: OrganizationInput,
): Promise<CreateOrganizationResult> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("create_organization", {
      p_name: input.name,
      p_currency: input.currency,
      p_timezone: input.timezone,
      p_email: input.email,
      p_phone: input.phone,
      p_address: input.address,
      p_tax_number: input.taxNumber,
    });

    if (error) {
      switch (error.code) {
        case "42501":
          return { ok: false, reason: "unauthenticated" };
        case "23505":
          return { ok: false, reason: "already_member" };
        case "22023":
        case "23514":
        case "22001":
          return { ok: false, reason: "invalid" };
        default:
          // Server log only. Never send database details to the browser.
          console.error("create_organization failed", {
            code: error.code,
            message: error.message,
          });
          return { ok: false, reason: "failed" };
      }
    }

    if (typeof data !== "string") {
      console.error("create_organization returned no organization id");
      return { ok: false, reason: "failed" };
    }

    return { ok: true, organizationId: data };
  } catch (err) {
    console.error("create_organization threw", err);
    return { ok: false, reason: "failed" };
  }
}
