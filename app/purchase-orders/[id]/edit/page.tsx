import type { Metadata } from "next";
import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { requireTenant } from "@/lib/tenancy/context";
import { getPurchaseOrder } from "@/lib/purchase-orders/purchase-orders";
import { canEditPurchaseOrder } from "@/lib/purchase-orders/permissions";
import { getPurchaseProductOptions, getVendorOption } from "@/lib/purchase-orders/options";
import { purchaseOrderToFormValues, snapshotVendorOption } from "@/lib/purchase-orders/form";
import { updatePurchaseOrderAction } from "../../actions";
import { PurchaseOrderForm } from "../../_components/purchase-order-form";

export const metadata: Metadata = { title: "Edit purchase order · SME ERP" };

export default function EditPurchaseOrderPage({ params }: PageProps<"/purchase-orders/[id]/edit">) {
  return (
    <Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}>
      <EditPurchaseOrder params={params} />
    </Suspense>
  );
}

async function EditPurchaseOrder({ params }: Pick<PageProps<"/purchase-orders/[id]/edit">, "params">) {
  const { id } = await params;
  const tenant = await requireTenant();
  // The whole document (header + items with their IDs) in one statement.
  // Null for malformed IDs, unknown IDs and other organizations' orders.
  const po = await getPurchaseOrder(tenant, id);
  if (!po) notFound();
  // Only drafts are editable (the database enforces this too).
  if (!canEditPurchaseOrder(tenant.role, po.status)) redirect(`/purchase-orders/${po.id}`);

  // Current status of the vendor and products this draft uses, by ID within
  // the tenant whatever their status; only for "(inactive)" labels. What the
  // form shows as selected is the order's own snapshot.
  const [vendor, products] = await Promise.all([
    getVendorOption(tenant, po.vendorId),
    getPurchaseProductOptions(tenant, po.items.map((item) => item.productId)),
  ]);

  const inactiveVendor = vendor?.status === "inactive";
  const inactiveProducts = products.some((p) => p.status === "inactive");

  return (
    <div>
      <h1 className="text-2xl font-semibold">
        Edit purchase order <span className="font-mono">{po.purchaseOrderNumber}</span>
      </h1>
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
        Unchanged vendor and lines keep the details recorded on this purchase order. A newly chosen
        vendor or product takes its current details and purchase price.
      </p>
      {(inactiveVendor || inactiveProducts) && (
        <p className="mt-4 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300">
          This draft uses an inactive{" "}
          {inactiveVendor && inactiveProducts ? "vendor and product" : inactiveVendor ? "vendor" : "product"}.
          You can keep it; only new choices must be active.
        </p>
      )}
      <div className="mt-6">
        <PurchaseOrderForm
          action={updatePurchaseOrderAction.bind(null, po.id)}
          initialValues={purchaseOrderToFormValues(po)}
          currentVendor={snapshotVendorOption(po, vendor)}
          currentProducts={products}
          currency={tenant.organization.currency}
          submitLabel="Save changes"
          pendingText="Saving…"
          cancelHref={`/purchase-orders/${po.id}`}
        />
      </div>
    </div>
  );
}
