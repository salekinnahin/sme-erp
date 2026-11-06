import { PageHeader, PageSkeleton } from "@/app/_components/ui";
import type { Metadata } from "next";
import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { requireTenant } from "@/lib/tenancy/context";
import { getInvoice } from "@/lib/invoices/invoices";
import { canEditInvoice } from "@/lib/invoices/permissions";
import { getCustomerOption, getProductOptions } from "@/lib/quotations/options";
import { invoiceToFormValues, snapshotCustomerOption } from "@/lib/invoices/form";
import { updateInvoiceAction } from "../../actions";
import { InvoiceForm } from "../../_components/invoice-form";

export const metadata: Metadata = { title: "Edit invoice · SME ERP" };

export default function EditInvoicePage({ params }: PageProps<"/invoices/[id]/edit">) {
  return (
    <Suspense fallback={<PageSkeleton label="Loading…" />}>
      <EditInvoice params={params} />
    </Suspense>
  );
}

async function EditInvoice({ params }: Pick<PageProps<"/invoices/[id]/edit">, "params">) {
  const { id } = await params;
  const tenant = await requireTenant();
  // The whole document (header + items with their IDs) in one statement.
  // Null for malformed IDs, unknown IDs and other organizations' orders.
  const invoice = await getInvoice(tenant, id);
  if (!invoice) notFound();
  // Only drafts are editable (the database enforces this too).
  if (!canEditInvoice(tenant.role, invoice.status)) redirect(`/invoices/${invoice.id}`);

  // Current status of the customer and products this draft uses, by ID within
  // the tenant whatever their status; only for "(inactive)" labels. What the
  // form shows as selected is the invoice's own snapshot.
  const [customer, products] = await Promise.all([
    getCustomerOption(tenant, invoice.customerId),
    getProductOptions(tenant, invoice.items.map((item) => item.productId)),
  ]);

  const inactiveCustomer = customer?.status === "inactive";
  const inactiveProducts = products.some((p) => p.status === "inactive");

  return (
    <div>
      <PageHeader title={<> Edit invoice <span className="font-mono">{invoice.invoiceNumber}</span> </>} description={<> Unchanged customer and lines keep the details recorded on this invoice. A newly chosen
        customer or product takes its current details. </>} />
      {(inactiveCustomer || inactiveProducts) && (
        <p className="mt-4 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300">
          This draft uses an inactive{" "}
          {inactiveCustomer && inactiveProducts ? "customer and product" : inactiveCustomer ? "customer" : "product"}.
          You can keep it; only new choices must be active.
        </p>
      )}
      <div className="mt-6">
        <InvoiceForm
          action={updateInvoiceAction.bind(null, invoice.id)}
          initialValues={invoiceToFormValues(invoice)}
          currentCustomer={snapshotCustomerOption(invoice, customer)}
          currentProducts={products}
          currency={tenant.organization.currency}
          submitLabel="Save changes"
          pendingText="Saving…"
          cancelHref={`/invoices/${invoice.id}`}
        />
      </div>
    </div>
  );
}
