import { PageHeader, PageSkeleton } from "@/app/_components/ui";
import type { Metadata } from "next";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { requireTenant } from "@/lib/tenancy/context";
import { canInvoice } from "@/lib/invoices/permissions";
import { todayInTimeZone } from "@/lib/quotations/form";
import { newInvoiceFormValues } from "@/lib/invoices/form";
import { createInvoiceAction } from "../actions";
import { InvoiceForm } from "../_components/invoice-form";

export const metadata: Metadata = { title: "New invoice · SME ERP" };

export default function NewInvoicePage() {
  return (
    <div>
      <PageHeader title={<> New invoice </>} description={<> Saved as a draft. You can edit it until it is issued. </>} />
      <div className="mt-6">
        <Suspense fallback={<PageSkeleton label="Loading…" />}>
          <NewInvoice />
        </Suspense>
      </div>
    </div>
  );
}

async function NewInvoice() {
  const tenant = await requireTenant();
  if (!canInvoice(tenant.role, "create")) redirect("/invoices");

  // Customers and products are searched on the server from the form (active
  // only; the database enforces the same rule). Nothing is preloaded.
  return (
    <InvoiceForm
      action={createInvoiceAction}
      initialValues={newInvoiceFormValues(todayInTimeZone(tenant.organization.timezone))}
      currentCustomer={null}
      currentProducts={[]}
      currency={tenant.organization.currency}
      submitLabel="Create invoice"
      pendingText="Creating…"
      cancelHref="/invoices"
    />
  );
}
