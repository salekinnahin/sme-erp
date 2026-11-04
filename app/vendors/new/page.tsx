import type { Metadata } from "next";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { requireTenant } from "@/lib/tenancy/context";
import { canVendor } from "@/lib/vendors/permissions";
import { createVendorAction } from "../actions";
import { VendorForm } from "../_components/vendor-form";

export const metadata: Metadata = { title: "New vendor · SME ERP" };

export default function NewVendorPage() {
  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-2xl font-semibold">New vendor</h1>
      <div className="mt-6 rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-950">
        <Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}>
          <NewVendor />
        </Suspense>
      </div>
    </div>
  );
}

async function NewVendor() {
  const { role } = await requireTenant();
  if (!canVendor(role, "create")) redirect("/vendors");

  return (
    <VendorForm
      action={createVendorAction}
      submitLabel="Create vendor"
      pendingText="Creating…"
      cancelHref="/vendors"
    />
  );
}
