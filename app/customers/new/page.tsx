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
    <div className="mx-auto max-w-2xl">
      <h1 className="text-2xl font-semibold">New customer</h1>
      <div className="mt-6 rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-950">
        <Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}>
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
