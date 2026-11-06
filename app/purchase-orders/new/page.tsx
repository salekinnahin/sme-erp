import type { Metadata } from "next";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { requireTenant } from "@/lib/tenancy/context";
import { canPurchaseOrder } from "@/lib/purchase-orders/permissions";
import { todayInTimeZone } from "@/lib/quotations/form";
import { newPurchaseOrderFormValues } from "@/lib/purchase-orders/form";
import { createPurchaseOrderAction } from "../actions";
import { PurchaseOrderForm } from "../_components/purchase-order-form";

export const metadata: Metadata = { title: "New purchase order · SME ERP" };

export default function NewPurchaseOrderPage() {
  return (
    <div>
      <h1 className="text-2xl font-semibold">New purchase order</h1>
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
        Saved as a draft. You can edit it until it is ordered. A purchase order does not change
        stock; goods receiving will.
      </p>
      <div className="mt-6">
        <Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}>
          <NewPurchaseOrder />
        </Suspense>
      </div>
    </div>
  );
}

async function NewPurchaseOrder() {
  const tenant = await requireTenant();
  if (!canPurchaseOrder(tenant.role, "create")) redirect("/purchase-orders");

  // Vendors and products are searched on the server from the form (active
  // only; the database enforces the same rule). Nothing is preloaded.
  return (
    <PurchaseOrderForm
      action={createPurchaseOrderAction}
      initialValues={newPurchaseOrderFormValues(todayInTimeZone(tenant.organization.timezone))}
      currentVendor={null}
      currentProducts={[]}
      currency={tenant.organization.currency}
      submitLabel="Create purchase order"
      pendingText="Creating…"
      cancelHref="/purchase-orders"
    />
  );
}
