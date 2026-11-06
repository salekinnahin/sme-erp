import { PageHeader, SectionCard, MetadataList, MetadataItem, PageSkeleton } from "@/app/_components/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { requireTenant } from "@/lib/tenancy/context";
import { getVendor } from "@/lib/vendors/vendors";
import { canVendor } from "@/lib/vendors/permissions";
import { formatDateTime } from "@/lib/format";
import { StatusActions } from "../_components/status-actions";
import { StatusBadge } from "@/app/_components/status-badge";
import { SECONDARY_LINK, TEXT_LINK } from "@/app/_components/styles";

export const metadata: Metadata = { title: "Vendor · SME ERP" };

export default function VendorPage({ params }: PageProps<"/vendors/[id]">) {
  return (
    <Suspense fallback={<PageSkeleton label="Loading…" />}>
      <VendorDetail params={params} />
    </Suspense>
  );
}

async function VendorDetail({
  params,
}: Pick<PageProps<"/vendors/[id]">, "params">) {
  const { id } = await params;
  const tenant = await requireTenant();
  // Null for malformed IDs, unknown IDs and other organizations' vendors.
  const vendor = await getVendor(tenant, id);
  if (!vendor) notFound();

  const tz = tenant.organization.timezone;
  const canEdit = canVendor(tenant.role, "edit");
  const canChangeStatus = canVendor(tenant.role, "changeStatus");

  return (
    <div className="space-y-6">
      <Link href="/vendors" className={TEXT_LINK}>
        ← Vendors
      </Link>

      <PageHeader title={vendor.name} description={vendor.companyName} badge={<StatusBadge status={vendor.status} />} actions={<>
        {canEdit && (
          <Link href={`/vendors/${vendor.id}/edit`} className={SECONDARY_LINK}>
            Edit
          </Link>
        )}
        {canChangeStatus && (
          // key resets the confirmation step after the status changes
          <StatusActions
            key={vendor.status}
            vendorId={vendor.id}
            vendorName={vendor.name}
            status={vendor.status}
          />
        )}
      </>} />

      {vendor.status === "inactive" && (
        <p className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300">
          This vendor is inactive. Its details are kept.
        </p>
      )}

      <SectionCard title="Contact and business details"><MetadataList>
        <MetadataItem label="Vendor name">{vendor.name}</MetadataItem>
        <MetadataItem label="Company name">{vendor.companyName}</MetadataItem>
        <MetadataItem label="Phone">{vendor.phone}</MetadataItem>
        <MetadataItem label="Email">{vendor.email}</MetadataItem>
        <MetadataItem label="Tax / VAT number">{vendor.taxNumber}</MetadataItem>
        <MetadataItem label="Status">
          {vendor.status === "active" ? "Active" : "Inactive"}
        </MetadataItem>
        <MetadataItem label="Address" wide>
          {vendor.address}
        </MetadataItem>
        <MetadataItem label="Notes" wide>
          {vendor.notes}
        </MetadataItem>
        <MetadataItem label="Created">{formatDateTime(vendor.createdAt, tz)}</MetadataItem>
        <MetadataItem label="Last updated">{formatDateTime(vendor.updatedAt, tz)}</MetadataItem>
      </MetadataList></SectionCard>
    </div>
  );
}
