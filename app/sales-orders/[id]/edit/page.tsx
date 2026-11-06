import { PageHeader, PageSkeleton } from "@/app/_components/ui";
import type { Metadata } from "next";
import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { requireTenant } from "@/lib/tenancy/context";
import { getSalesOrder } from "@/lib/sales-orders/sales-orders";
import { canEditSalesOrder } from "@/lib/sales-orders/permissions";
import { getCustomerOption, getProductOptions } from "@/lib/quotations/options";
import { salesOrderToFormValues, snapshotCustomerOption } from "@/lib/sales-orders/form";
import { updateSalesOrderAction } from "../../actions";
import { SalesOrderForm } from "../../_components/sales-order-form";

export const metadata: Metadata = { title: "Edit sales order · SME ERP" };

export default function EditSalesOrderPage({ params }: PageProps<"/sales-orders/[id]/edit">) {
  return (
    <Suspense fallback={<PageSkeleton label="Loading…" />}>
      <EditSalesOrder params={params} />
    </Suspense>
  );
}

async function EditSalesOrder({ params }: Pick<PageProps<"/sales-orders/[id]/edit">, "params">) {
  const { id } = await params;
  const tenant = await requireTenant();
  // The whole document (header + items with their IDs) in one statement.
  // Null for malformed IDs, unknown IDs and other organizations' orders.
  const order = await getSalesOrder(tenant, id);
  if (!order) notFound();
  // Only drafts are editable (the database enforces this too).
  if (!canEditSalesOrder(tenant.role, order.status)) redirect(`/sales-orders/${order.id}`);

  // Current status of the customer and products this draft uses, by ID within
  // the tenant whatever their status; only for "(inactive)" labels. What the
  // form shows as selected is the order's own snapshot.
  const [customer, products] = await Promise.all([
    getCustomerOption(tenant, order.customerId),
    getProductOptions(tenant, order.items.map((item) => item.productId)),
  ]);

  const inactiveCustomer = customer?.status === "inactive";
  const inactiveProducts = products.some((p) => p.status === "inactive");

  return (
    <div>
      <PageHeader title={<> Edit sales order <span className="font-mono">{order.salesOrderNumber}</span> </>} description={<> Unchanged customer and lines keep the details recorded on this order. A newly chosen
        customer or product takes its current details. </>} />
      {(inactiveCustomer || inactiveProducts) && (
        <p className="mt-4 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300">
          This draft uses an inactive{" "}
          {inactiveCustomer && inactiveProducts ? "customer and product" : inactiveCustomer ? "customer" : "product"}.
          You can keep it; only new choices must be active.
        </p>
      )}
      <div className="mt-6">
        <SalesOrderForm
          action={updateSalesOrderAction.bind(null, order.id)}
          initialValues={salesOrderToFormValues(order)}
          currentCustomer={snapshotCustomerOption(order, customer)}
          currentProducts={products}
          currency={tenant.organization.currency}
          submitLabel="Save changes"
          pendingText="Saving…"
          cancelHref={`/sales-orders/${order.id}`}
        />
      </div>
    </div>
  );
}
