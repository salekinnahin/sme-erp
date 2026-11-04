import type { Metadata } from "next";
import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { requireTenant } from "@/lib/tenancy/context";
import { getVendor } from "@/lib/vendors/vendors";
import { canVendor } from "@/lib/vendors/permissions";
import { updateVendorAction } from "../../actions";
import { VendorForm } from "../../_components/vendor-form";

export const metadata: Metadata = { title: "Edit vendor · SME ERP" };

export default function EditVendorPage({
  params,
}: PageProps<"/vendors/[id]/edit">) {
  return (
    <div className="mx-auto max-w-2xl">
      <Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}>
        <EditVendor params={params} />
      </Suspense>
    </div>
  );
}

async function EditVendor({
  params,
}: Pick<PageProps<"/vendors/[id]/edit">, "params">) {
  const { id } = await params;
  const tenant = await requireTenant();
  const vendor = await getVendor(tenant, id);
  if (!vendor) notFound();
  if (!canVendor(tenant.role, "edit")) redirect(`/vendors/${vendor.id}`);

  return (
    <>
      <h1 className="text-2xl font-semibold">Edit vendor</h1>
      <div className="mt-6 rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-950">
        <VendorForm
          action={updateVendorAction.bind(null, vendor.id)}
          initialValues={{
            name: vendor.name,
            companyName: vendor.companyName ?? "",
            phone: vendor.phone ?? "",
            email: vendor.email ?? "",
            address: vendor.address ?? "",
            taxNumber: vendor.taxNumber ?? "",
            notes: vendor.notes ?? "",
          }}
          submitLabel="Save changes"
          pendingText="Saving…"
          cancelHref={`/vendors/${vendor.id}`}
        />
      </div>
    </>
  );
}
