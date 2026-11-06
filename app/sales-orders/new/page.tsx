import { PageHeader, PageSkeleton } from "@/app/_components/ui";
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
      <PageHeader title={<> New sales order </>} description={<> Saved as a draft. You can edit it until it is confirmed. </>} />
      <div className="mt-6">
        <Suspense fallback={<PageSkeleton label="Loading…" />}>
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
