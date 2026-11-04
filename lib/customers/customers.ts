import { createClient } from "@/lib/supabase/server";
import type { TenantContext } from "@/lib/tenancy/context";
import { isUuid } from "@/lib/validation/fields";
import { canCustomer } from "./permissions";
import {
  CUSTOMER_PAGE_SIZE,
  type CustomerInput,
  type CustomerListParams,
  type CustomerStatus,
} from "./validation";

/**
 * Customer domain functions. Callers pass the tenant from requireTenant();
 * the organization is never taken from request input.
 *
 * Every query is scoped twice: an explicit organization_id filter, and RLS
 * (only organizations where the user is an active member). Reads throw on
 * database errors so the route's error boundary handles them. Writes return
 * a result with a reason that the Server Action maps to a safe message.
 */

type Tenant = Pick<TenantContext, "organization" | "role">;

export type Customer = {
  id: string;
  name: string;
  companyName: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  taxNumber: string | null;
  notes: string | null;
  status: CustomerStatus;
  createdAt: string;
  updatedAt: string;
};

export type CustomerListItem = Pick<
  Customer,
  "id" | "name" | "companyName" | "phone" | "email" | "status" | "createdAt"
>;

export type CustomerList = {
  items: CustomerListItem[];
  /** Matching rows across all pages. Null if the page is past the end. */
  total: number | null;
  page: number;
  pageSize: number;
};

export type CustomerWriteFailure =
  | "invalid"
  | "forbidden"
  | "not_found"
  | "failed";

export type CustomerWriteResult =
  | { ok: true; customerId: string }
  | { ok: false; reason: CustomerWriteFailure };

type CustomerRow = {
  id: string;
  name: string;
  company_name: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  tax_number: string | null;
  notes: string | null;
  status: CustomerStatus;
  created_at: string;
  updated_at: string;
};

type CustomerListRow = Pick<
  CustomerRow,
  "id" | "name" | "company_name" | "phone" | "email" | "status" | "created_at"
> & { total_count: number | string };

const CUSTOMER_COLUMNS =
  "id, name, company_name, phone, email, address, tax_number, notes, status, created_at, updated_at";

function toCustomer(row: CustomerRow): Customer {
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
function toRow(input: CustomerInput) {
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
): CustomerWriteResult {
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

/** One customer of the tenant, or null if it doesn't exist or isn't theirs. */
export async function getCustomer(
  tenant: Tenant,
  customerId: string,
): Promise<Customer | null> {
  if (!isUuid(customerId)) return null;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("customers")
    .select(CUSTOMER_COLUMNS)
    .eq("id", customerId)
    .eq("organization_id", tenant.organization.id)
    .maybeSingle<CustomerRow>();

  if (error) throw new Error("Failed to load customer.", { cause: error });
  return data ? toCustomer(data) : null;
}

/** A page of the tenant's customers, newest first. */
export async function listCustomers(
  tenant: Tenant,
  params: CustomerListParams,
): Promise<CustomerList> {
  const pageSize = CUSTOMER_PAGE_SIZE;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("list_customers", {
    p_organization_id: tenant.organization.id,
    p_search: params.search || null,
    p_status: params.status === "all" ? null : params.status,
    p_limit: pageSize,
    p_offset: (params.page - 1) * pageSize,
  });

  if (error) throw new Error("Failed to load customers.", { cause: error });

  const rows = (data ?? []) as CustomerListRow[];
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

/** Creates an active customer in the tenant's organization. */
export async function createCustomer(
  tenant: Tenant,
  input: CustomerInput,
): Promise<CustomerWriteResult> {
  if (!canCustomer(tenant.role, "create")) return { ok: false, reason: "forbidden" };

  try {
    const supabase = await createClient();
    // status defaults to 'active' and created_by to auth.uid() in the
    // database. Clients have no privilege to set either.
    const { data, error } = await supabase
      .from("customers")
      .insert({ organization_id: tenant.organization.id, ...toRow(input) })
      .select("id")
      .single<{ id: string }>();

    if (error) return failure("createCustomer", error);
    return { ok: true, customerId: data.id };
  } catch (err) {
    console.error("createCustomer threw", err);
    return { ok: false, reason: "failed" };
  }
}

/** Updates the editable fields of one of the tenant's customers. */
export async function updateCustomer(
  tenant: Tenant,
  customerId: string,
  input: CustomerInput,
): Promise<CustomerWriteResult> {
  if (!canCustomer(tenant.role, "edit")) return { ok: false, reason: "forbidden" };
  if (!isUuid(customerId)) return { ok: false, reason: "not_found" };

  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("customers")
      .update(toRow(input))
      .eq("id", customerId)
      .eq("organization_id", tenant.organization.id)
      .select("id")
      .maybeSingle<{ id: string }>();

    if (error) return failure("updateCustomer", error);
    // No row: it doesn't exist, or RLS hides it (another tenant).
    if (!data) return { ok: false, reason: "not_found" };
    return { ok: true, customerId: data.id };
  } catch (err) {
    console.error("updateCustomer threw", err);
    return { ok: false, reason: "failed" };
  }
}

/** Deactivates or reactivates a customer (owner and manager only). */
export async function setCustomerStatus(
  tenant: Tenant,
  customerId: string,
  status: CustomerStatus,
): Promise<CustomerWriteResult> {
  if (!canCustomer(tenant.role, "changeStatus"))
    return { ok: false, reason: "forbidden" };
  if (!isUuid(customerId)) return { ok: false, reason: "not_found" };

  try {
    const supabase = await createClient();
    // The function re-checks membership and role in the database.
    const { error } = await supabase.rpc("set_customer_status", {
      p_customer_id: customerId,
      p_status: status,
    });

    if (error) return failure("setCustomerStatus", error);
    return { ok: true, customerId };
  } catch (err) {
    console.error("setCustomerStatus threw", err);
    return { ok: false, reason: "failed" };
  }
}
