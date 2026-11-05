import type { Metadata } from "next";
import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { requireTenant } from "@/lib/tenancy/context";
import { getQuotation } from "@/lib/quotations/quotations";
import { canEditQuotation } from "@/lib/quotations/permissions";
import { getCustomerOption, getProductOptions } from "@/lib/quotations/options";
import { quotationToFormValues } from "@/lib/quotations/form";
import { updateQuotationAction } from "../../actions";
import { QuotationForm } from "../../_components/quotation-form";

export const metadata: Metadata = { title: "Edit quotation · SME ERP" };

export default function EditQuotationPage({ params }: PageProps<"/quotations/[id]/edit">) {
  return (
    <Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}>
      <EditQuotation params={params} />
    </Suspense>
  );
}

async function EditQuotation({ params }: Pick<PageProps<"/quotations/[id]/edit">, "params">) {
  const { id } = await params;
  const tenant = await requireTenant();
  // Null for malformed IDs, unknown IDs and other organizations' quotations.
  const quotation = await getQuotation(tenant, id);
  if (!quotation) notFound();
  // Only drafts are editable. Sent and later quotations are immutable (the
  // database enforces this too); the detail page explains the status.
  if (!canEditQuotation(tenant.role, quotation.status)) redirect(`/quotations/${quotation.id}`);

  // The customer and products this draft already uses, fetched by ID within
  // the tenant whatever their status, so an unrelated edit never clears or
  // swaps a reference. New choices are searched from the form (active only).
  const [currentCustomer, currentProducts] = await Promise.all([
    getCustomerOption(tenant, quotation.customerId),
    getProductOptions(tenant, quotation.items.map((item) => item.productId)),
  ]);

  const inactiveCustomer = currentCustomer?.status === "inactive";
  const inactiveProducts = currentProducts.some((p) => p.status === "inactive");

  return (
    <div>
      <h1 className="text-2xl font-semibold">
        Edit quotation <span className="font-mono">{quotation.quotationNumber}</span>
      </h1>
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
        Saving takes the current customer and product details again.
      </p>
      {(inactiveCustomer || inactiveProducts) && (
        <p className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
          This draft uses an inactive {inactiveCustomer && inactiveProducts ? "customer and product" : inactiveCustomer ? "customer" : "product"}.
          Choose an active one, or reactivate it, before saving.
        </p>
      )}
      <div className="mt-6">
        <QuotationForm
          action={updateQuotationAction.bind(null, quotation.id)}
          initialValues={quotationToFormValues(quotation)}
          currentCustomer={currentCustomer}
          currentProducts={currentProducts}
          currency={tenant.organization.currency}
          submitLabel="Save changes"
          pendingText="Saving…"
          cancelHref={`/quotations/${quotation.id}`}
        />
      </div>
    </div>
  );
}
