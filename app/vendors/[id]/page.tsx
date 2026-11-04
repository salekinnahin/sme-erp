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
    <Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}>
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

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold break-all">{vendor.name}</h1>
            <StatusBadge status={vendor.status} />
          </div>
          {vendor.companyName && (
            <p className="mt-1 text-zinc-600 dark:text-zinc-400">
              {vendor.companyName}
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-start gap-2">
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
        </div>
      </div>

      {vendor.status === "inactive" && (
        <p className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300">
          This vendor is inactive. Its details are kept.
        </p>
      )}

      <dl className="grid gap-x-6 gap-y-4 rounded-xl border border-zinc-200 bg-white p-6 sm:grid-cols-2 dark:border-zinc-800 dark:bg-zinc-950">
        <Item label="Vendor name">{vendor.name}</Item>
        <Item label="Company name">{vendor.companyName}</Item>
        <Item label="Phone">{vendor.phone}</Item>
        <Item label="Email">{vendor.email}</Item>
        <Item label="Tax / VAT number">{vendor.taxNumber}</Item>
        <Item label="Status">
          {vendor.status === "active" ? "Active" : "Inactive"}
        </Item>
        <Item label="Address" wide>
          {vendor.address}
        </Item>
        <Item label="Notes" wide>
          {vendor.notes}
        </Item>
        <Item label="Created">{formatDateTime(vendor.createdAt, tz)}</Item>
        <Item label="Last updated">{formatDateTime(vendor.updatedAt, tz)}</Item>
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
