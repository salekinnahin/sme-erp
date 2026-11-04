import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { requireTenant } from "@/lib/tenancy/context";
import { getCustomer } from "@/lib/customers/customers";
import { canCustomer } from "@/lib/customers/permissions";
import { formatDateTime } from "@/lib/format";
import { StatusActions } from "../_components/status-actions";
import { StatusBadge } from "../_components/status-badge";
import { SECONDARY_LINK, TEXT_LINK } from "../_components/styles";

export const metadata: Metadata = { title: "Customer · SME ERP" };

export default function CustomerPage({ params }: PageProps<"/customers/[id]">) {
  return (
    <Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}>
      <CustomerDetail params={params} />
    </Suspense>
  );
}

async function CustomerDetail({
  params,
}: Pick<PageProps<"/customers/[id]">, "params">) {
  const { id } = await params;
  const tenant = await requireTenant();
  // Null for malformed IDs, unknown IDs and other organizations' customers.
  const customer = await getCustomer(tenant, id);
  if (!customer) notFound();

  const tz = tenant.organization.timezone;
  const canEdit = canCustomer(tenant.role, "edit");
  const canChangeStatus = canCustomer(tenant.role, "changeStatus");

  return (
    <div className="space-y-6">
      <Link href="/customers" className={TEXT_LINK}>
        ← Customers
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold break-all">{customer.name}</h1>
            <StatusBadge status={customer.status} />
          </div>
          {customer.companyName && (
            <p className="mt-1 text-zinc-600 dark:text-zinc-400">
              {customer.companyName}
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-start gap-2">
          {canEdit && (
            <Link href={`/customers/${customer.id}/edit`} className={SECONDARY_LINK}>
              Edit
            </Link>
          )}
          {canChangeStatus && (
            // key resets the confirmation step after the status changes
            <StatusActions
              key={customer.status}
              customerId={customer.id}
              customerName={customer.name}
              status={customer.status}
            />
          )}
        </div>
      </div>

      {customer.status === "inactive" && (
        <p className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300">
          This customer is inactive. Their details and history are kept.
        </p>
      )}

      <dl className="grid gap-x-6 gap-y-4 rounded-xl border border-zinc-200 bg-white p-6 sm:grid-cols-2 dark:border-zinc-800 dark:bg-zinc-950">
        <Item label="Customer name">{customer.name}</Item>
        <Item label="Company name">{customer.companyName}</Item>
        <Item label="Phone">{customer.phone}</Item>
        <Item label="Email">{customer.email}</Item>
        <Item label="Tax / VAT number">{customer.taxNumber}</Item>
        <Item label="Status">
          {customer.status === "active" ? "Active" : "Inactive"}
        </Item>
        <Item label="Address" wide>
          {customer.address}
        </Item>
        <Item label="Notes" wide>
          {customer.notes}
        </Item>
        <Item label="Created">{formatDateTime(customer.createdAt, tz)}</Item>
        <Item label="Last updated">{formatDateTime(customer.updatedAt, tz)}</Item>
      </dl>
    </div>
  );
}

function Item({
  label,
  wide,
  children,
}: {
  label: string;
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={wide ? "sm:col-span-2" : undefined}>
      <dt className="text-sm font-medium text-zinc-500 dark:text-zinc-400">{label}</dt>
      <dd className="mt-1 whitespace-pre-line break-words text-zinc-900 dark:text-zinc-50">
        {children || <span className="text-zinc-400">—</span>}
      </dd>
    </div>
  );
}
