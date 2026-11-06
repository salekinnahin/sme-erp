import { PageHeader, PageSkeleton } from "@/app/_components/ui";
import type { Metadata } from "next";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { requireTenant } from "@/lib/tenancy/context";
import { canCustomer } from "@/lib/customers/permissions";
import { createCustomerAction } from "../actions";
import { CustomerForm } from "../_components/customer-form";

export const metadata: Metadata = { title: "New customer · SME ERP" };

export default function NewCustomerPage() {
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title={<> New customer </>} description="Keep contact and company details up to date." /><div className="mt-6">
        <Suspense fallback={<PageSkeleton label="Loading…" />}>
          <NewCustomer />
        </Suspense>
      </div>
    </div>
  );
}

async function NewCustomer() {
  const { role } = await requireTenant();
  if (!canCustomer(role, "create")) redirect("/customers");

  return (
    <CustomerForm
      action={createCustomerAction}
      submitLabel="Create customer"
      pendingText="Creating…"
      cancelHref="/customers"
    />
  );
}
