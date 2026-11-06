import { PageHeader, PageSkeleton } from "@/app/_components/ui";
import type { Metadata } from "next";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { requireTenant } from "@/lib/tenancy/context";
import { canQuotation } from "@/lib/quotations/permissions";
import { newQuotationFormValues, todayInTimeZone } from "@/lib/quotations/form";
import { createQuotationAction } from "../actions";
import { QuotationForm } from "../_components/quotation-form";

export const metadata: Metadata = { title: "New quotation · SME ERP" };

export default function NewQuotationPage() {
  return (
    <div>
      <PageHeader title={<> New quotation </>} description={<> Saved as a draft. You can edit it until it is marked as sent. </>} />
      <div className="mt-6">
        <Suspense fallback={<PageSkeleton label="Loading…" />}>
          <NewQuotation />
        </Suspense>
      </div>
    </div>
  );
}

async function NewQuotation() {
  const tenant = await requireTenant();
  if (!canQuotation(tenant.role, "create")) redirect("/quotations");

  // Customers and products are searched on the server from the form
  // (active only: a new quotation cannot use inactive master data, and the
  // database enforces the same rule). Nothing is preloaded here.
  return (
    <QuotationForm
      action={createQuotationAction}
      initialValues={newQuotationFormValues(todayInTimeZone(tenant.organization.timezone))}
      currentCustomer={null}
      currentProducts={[]}
      currency={tenant.organization.currency}
      submitLabel="Create quotation"
      pendingText="Creating…"
      cancelHref="/quotations"
    />
  );
}
