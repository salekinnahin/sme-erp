import { createClient } from "@/lib/supabase/server";
import type { TenantContext } from "@/lib/tenancy/context";
import { isUuid } from "@/lib/validation/fields";
import { canVendor } from "./permissions";
import {
  VENDOR_PAGE_SIZE,
  type VendorInput,
  type VendorListParams,
  type VendorStatus,
} from "./validation";

/**
 * Vendor domain functions (same shape as lib/customers/customers.ts).
 * Callers pass the tenant from requireTenant(); the organization is never
 * taken from request input.
 *
 * Every query is scoped twice: an explicit organization_id filter, and RLS
 * (only organizations where the user is an active member). Reads throw on
 * database errors so the route's error boundary handles them. Writes return
 * a result with a reason that the Server Action maps to a safe message.
 */

type Tenant = Pick<TenantContext, "organization" | "role">;

export type Vendor = {
  id: string;
  name: string;
  companyName: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  taxNumber: string | null;
  notes: string | null;
  status: VendorStatus;
  createdAt: string;
  updatedAt: string;
};

export type VendorListItem = Pick<
  Vendor,
  "id" | "name" | "companyName" | "phone" | "email" | "status" | "createdAt"
>;

export type VendorList = {
  items: VendorListItem[];
  /** Matching rows across all pages. Null if the page is past the end. */
  total: number | null;
  page: number;
  pageSize: number;
};

export type VendorWriteFailure = "invalid" | "forbidden" | "not_found" | "failed";

export type VendorWriteResult =
  | { ok: true; vendorId: string }
  | { ok: false; reason: VendorWriteFailure };

type VendorRow = {
  id: string;
  name: string;
  company_name: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  tax_number: string | null;
  notes: string | null;
  status: VendorStatus;
  created_at: string;
  updated_at: string;
};

type VendorListRow = Pick<
  VendorRow,
  "id" | "name" | "company_name" | "phone" | "email" | "status" | "created_at"
> & { total_count: number | string };

const VENDOR_COLUMNS =
  "id, name, company_name, phone, email, address, tax_number, notes, status, created_at, updated_at";

function toVendor(row: VendorRow): Vendor {
  return {
    id: row.id,
    name: row.name,
    companyName: row.company_name,
    phone: row.phone,
    email: row.email,
    address: row.address,
    taxNumber: row.tax_number,
    notes: row.notes,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Writable columns only. organization_id is added on insert. */
function toRow(input: VendorInput) {
  return {
    name: input.name,
    company_name: input.companyName,
    phone: input.phone,
    email: input.email,
    address: input.address,
    tax_number: input.taxNumber,
    notes: input.notes,
  };
}

function failure(
  operation: string,
  error: { code?: string; message?: string },
): VendorWriteResult {
  switch (error.code) {
    case "23514": // check_violation
    case "23502": // not_null_violation
    case "22001": // string_data_right_truncation
    case "22023": // invalid_parameter_value
      return { ok: false, reason: "invalid" };
    case "42501": // insufficient_privilege, including RLS violations
      return { ok: false, reason: "forbidden" };
    case "P0002": // no_data_found
    case "22P02": // invalid_text_representation (bad UUID)
      return { ok: false, reason: "not_found" };
    default:
      // Server log only. Never send database details to the browser.
      console.error(`${operation} failed`, {
        code: error.code,
        message: error.message,
      });
      return { ok: false, reason: "failed" };
  }
}

/** One vendor of the tenant, or null if it doesn't exist or isn't theirs. */
export async function getVendor(
  tenant: Tenant,
  vendorId: string,
): Promise<Vendor | null> {
  if (!isUuid(vendorId)) return null;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("vendors")
    .select(VENDOR_COLUMNS)
    .eq("id", vendorId)
    .eq("organization_id", tenant.organization.id)
    .maybeSingle<VendorRow>();

  if (error) throw new Error("Failed to load vendor.", { cause: error });
  return data ? toVendor(data) : null;
}

/** A page of the tenant's vendors, newest first. */
export async function listVendors(
  tenant: Tenant,
  params: VendorListParams,
): Promise<VendorList> {
  const pageSize = VENDOR_PAGE_SIZE;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("list_vendors", {
    p_organization_id: tenant.organization.id,
    p_search: params.search || null,
    p_status: params.status === "all" ? null : params.status,
    p_limit: pageSize,
    p_offset: (params.page - 1) * pageSize,
  });

  if (error) throw new Error("Failed to load vendors.", { cause: error });

  const rows = (data ?? []) as VendorListRow[];
  return {
    items: rows.map((row) => ({
      id: row.id,
      name: row.name,
      companyName: row.company_name,
      phone: row.phone,
      email: row.email,
      status: row.status,
      createdAt: row.created_at,
    })),
    // total_count is a bigint; PostgREST may send it as a string.
    total: rows.length
      ? Number(rows[0].total_count)
      : params.page === 1
        ? 0
        : null,
    page: params.page,
    pageSize,
  };
}

/** Creates an active vendor in the tenant's organization. */
export async function createVendor(
  tenant: Tenant,
  input: VendorInput,
): Promise<VendorWriteResult> {
  if (!canVendor(tenant.role, "create")) return { ok: false, reason: "forbidden" };

  try {
    const supabase = await createClient();
    // status defaults to 'active' and created_by to auth.uid() in the
    // database. Clients have no privilege to set either.
    const { data, error } = await supabase
      .from("vendors")
      .insert({ organization_id: tenant.organization.id, ...toRow(input) })
      .select("id")
      .single<{ id: string }>();

    if (error) return failure("createVendor", error);
    return { ok: true, vendorId: data.id };
  } catch (err) {
    console.error("createVendor threw", err);
    return { ok: false, reason: "failed" };
  }
}

/** Updates the editable fields of one of the tenant's vendors. */
export async function updateVendor(
  tenant: Tenant,
  vendorId: string,
  input: VendorInput,
): Promise<VendorWriteResult> {
  if (!canVendor(tenant.role, "edit")) return { ok: false, reason: "forbidden" };
  if (!isUuid(vendorId)) return { ok: false, reason: "not_found" };

  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("vendors")
      .update(toRow(input))
      .eq("id", vendorId)
      .eq("organization_id", tenant.organization.id)
      .select("id")
      .maybeSingle<{ id: string }>();

    if (error) return failure("updateVendor", error);
    // No row: it doesn't exist, or RLS hides it (another tenant).
    if (!data) return { ok: false, reason: "not_found" };
    return { ok: true, vendorId: data.id };
  } catch (err) {
    console.error("updateVendor threw", err);
    return { ok: false, reason: "failed" };
  }
}

/** Deactivates or reactivates a vendor (owner and manager only). */
export async function setVendorStatus(
  tenant: Tenant,
  vendorId: string,
  status: VendorStatus,
): Promise<VendorWriteResult> {
  if (!canVendor(tenant.role, "changeStatus"))
    return { ok: false, reason: "forbidden" };
  if (!isUuid(vendorId)) return { ok: false, reason: "not_found" };

  try {
    const supabase = await createClient();
    // The function re-checks membership and role in the database.
    const { error } = await supabase.rpc("set_vendor_status", {
      p_vendor_id: vendorId,
      p_status: status,
    });

    if (error) return failure("setVendorStatus", error);
    return { ok: true, vendorId };
  } catch (err) {
    console.error("setVendorStatus threw", err);
    return { ok: false, reason: "failed" };
  }
}
