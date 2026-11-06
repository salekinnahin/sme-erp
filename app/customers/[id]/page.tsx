import { PageHeader, SectionCard, MetadataList, MetadataItem, PageSkeleton } from "@/app/_components/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { requireTenant } from "@/lib/tenancy/context";
import { getCustomer } from "@/lib/customers/customers";
import { canCustomer } from "@/lib/customers/permissions";
import { formatDateTime } from "@/lib/format";
import { StatusActions } from "../_components/status-actions";
import { StatusBadge } from "@/app/_components/status-badge";
import { SECONDARY_LINK, TEXT_LINK } from "@/app/_components/styles";

export const metadata: Metadata = { title: "Customer · SME ERP" };

export default function CustomerPage({ params }: PageProps<"/customers/[id]">) {
  return (
    <Suspense fallback={<PageSkeleton label="Loading…" />}>
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

      <PageHeader title={customer.name} description={customer.companyName} badge={<StatusBadge status={customer.status} />} actions={<>
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
      </>} />

      {customer.status === "inactive" && (
        <p className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300">
          This customer is inactive. Their details and history are kept.
        </p>
      )}

      <SectionCard title="Contact and business details"><MetadataList>
        <MetadataItem label="Customer name">{customer.name}</MetadataItem>
        <MetadataItem label="Company name">{customer.companyName}</MetadataItem>
        <MetadataItem label="Phone">{customer.phone}</MetadataItem>
        <MetadataItem label="Email">{customer.email}</MetadataItem>
        <MetadataItem label="Tax / VAT number">{customer.taxNumber}</MetadataItem>
        <MetadataItem label="Status">
          {customer.status === "active" ? "Active" : "Inactive"}
        </MetadataItem>
        <MetadataItem label="Address" wide>
          {customer.address}
        </MetadataItem>
        <MetadataItem label="Notes" wide>
          {customer.notes}
        </MetadataItem>
        <MetadataItem label="Created">{formatDateTime(customer.createdAt, tz)}</MetadataItem>
        <MetadataItem label="Last updated">{formatDateTime(customer.updatedAt, tz)}</MetadataItem>
      </MetadataList></SectionCard>
    </div>
  );
}
