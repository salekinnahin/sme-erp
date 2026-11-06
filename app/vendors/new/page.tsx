import { PageHeader, PageSkeleton } from "@/app/_components/ui";
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
    <div className="mx-auto max-w-3xl">
      <PageHeader title={<> New vendor </>} description="Keep contact and company details up to date." /><div className="mt-6">
        <Suspense fallback={<PageSkeleton label="Loading…" />}>
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
