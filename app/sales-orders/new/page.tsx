import type { Metadata } from "next";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { requireTenant } from "@/lib/tenancy/context";
import { canSalesOrder } from "@/lib/sales-orders/permissions";
import { todayInTimeZone } from "@/lib/quotations/form";
import { newSalesOrderFormValues } from "@/lib/sales-orders/form";
import { createSalesOrderAction } from "../actions";
import { SalesOrderForm } from "../_components/sales-order-form";

export const metadata: Metadata = { title: "New sales order · SME ERP" };

export default function NewSalesOrderPage() {
  return (
    <div>
      <h1 className="text-2xl font-semibold">New sales order</h1>
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
        Saved as a draft. You can edit it until it is confirmed.
      </p>
      <div className="mt-6">
        <Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}>
          <NewSalesOrder />
        </Suspense>
      </div>
    </div>
  );
}

async function NewSalesOrder() {
  const tenant = await requireTenant();
  if (!canSalesOrder(tenant.role, "create")) redirect("/sales-orders");

  // Customers and products are searched on the server from the form (active
  // only; the database enforces the same rule). Nothing is preloaded.
  return (
    <SalesOrderForm
      action={createSalesOrderAction}
      initialValues={newSalesOrderFormValues(todayInTimeZone(tenant.organization.timezone))}
      currentCustomer={null}
      currentProducts={[]}
      currency={tenant.organization.currency}
      submitLabel="Create sales order"
      pendingText="Creating…"
      cancelHref="/sales-orders"
    />
  );
}
