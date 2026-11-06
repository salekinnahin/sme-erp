import { PageHeader, PageSkeleton } from "@/app/_components/ui";
import type { Metadata } from "next";
import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { requireTenant } from "@/lib/tenancy/context";
import { getCustomer } from "@/lib/customers/customers";
import { canCustomer } from "@/lib/customers/permissions";
import { updateCustomerAction } from "../../actions";
import { CustomerForm } from "../../_components/customer-form";

export const metadata: Metadata = { title: "Edit customer · SME ERP" };

export default function EditCustomerPage({
  params,
}: PageProps<"/customers/[id]/edit">) {
  return (
    <div className="mx-auto max-w-3xl">
      <Suspense fallback={<PageSkeleton label="Loading…" />}>
        <EditCustomer params={params} />
      </Suspense>
    </div>
  );
}

async function EditCustomer({
  params,
}: Pick<PageProps<"/customers/[id]/edit">, "params">) {
  const { id } = await params;
  const tenant = await requireTenant();
  const customer = await getCustomer(tenant, id);
  if (!customer) notFound();
  if (!canCustomer(tenant.role, "edit")) redirect(`/customers/${customer.id}`);

  return (
    <>
      <PageHeader title={<> Edit customer </>} description="Keep contact and company details up to date." /><div className="mt-6">
        <CustomerForm
          action={updateCustomerAction.bind(null, customer.id)}
          initialValues={{
            name: customer.name,
            companyName: customer.companyName ?? "",
            phone: customer.phone ?? "",
            email: customer.email ?? "",
            address: customer.address ?? "",
            taxNumber: customer.taxNumber ?? "",
            notes: customer.notes ?? "",
          }}
          submitLabel="Save changes"
          pendingText="Saving…"
          cancelHref={`/customers/${customer.id}`}
        />
      </div>
    </>
  );
}
