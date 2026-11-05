import { createClient } from "@/lib/supabase/server";
import type { TenantContext } from "@/lib/tenancy/context";

export type OrganizationDetails = {
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  taxNumber: string | null;
};

/**
 * Contact details of the tenant's own organization (e.g. for a printed
 * document's letterhead). The ID comes from requireTenant(), and RLS only
 * lets active members read their organization. Throws on database errors.
 */
export async function getOrganizationDetails(
  tenant: Pick<TenantContext, "organization">,
): Promise<OrganizationDetails> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("organizations")
    .select("name, email, phone, address, tax_number")
    .eq("id", tenant.organization.id)
    .maybeSingle<{
      name: string;
      email: string | null;
      phone: string | null;
      address: string | null;
      tax_number: string | null;
    }>();
  if (error) throw new Error("Failed to load organization.", { cause: error });
  if (!data) throw new Error("Organization not readable for an active member.");
  return {
    name: data.name,
    email: data.email,
    phone: data.phone,
    address: data.address,
    taxNumber: data.tax_number,
  };
}
