import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { requireTenant } from "@/lib/tenancy/context";
import { getPurchaseOrder } from "@/lib/purchase-orders/purchase-orders";
import { canEditPurchaseOrder } from "@/lib/purchase-orders/permissions";
import { purchaseOrderStatusActions } from "@/lib/purchase-orders/status-actions";
import { formatCalendarDate, formatDateTime, formatMoney, formatQuantity, plainDecimal } from "@/lib/format";
import { SECONDARY_LINK, TEXT_LINK } from "@/app/_components/styles";
import { PurchaseOrderStatusBadge } from "../_components/purchase-order-status-badge";
import { PurchaseOrderStatusActions } from "../_components/status-actions";

export const metadata: Metadata = { title: "Purchase order · SME ERP" };

export default function PurchaseOrderPage({ params }: PageProps<"/purchase-orders/[id]">) {
  return (
    <Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}>
      <PurchaseOrderDetail params={params} />
    </Suspense>
  );
}

async function PurchaseOrderDetail({ params }: Pick<PageProps<"/purchase-orders/[id]">, "params">) {
  const { id } = await params;
  const tenant = await requireTenant();
  // Null for malformed IDs, unknown IDs and other organizations' orders.
  const po = await getPurchaseOrder(tenant, id);
  if (!po) notFound();

  const tz = tenant.organization.timezone;
  const money = (amount: string) => formatMoney(amount, tenant.organization.currency);
  const canEdit = canEditPurchaseOrder(tenant.role, po.status);
  // Order / cancel only; receiving statuses are never user actions.
  const actions = purchaseOrderStatusActions(tenant.role, po.status);

  return (
    <div className="space-y-6">
      <Link href="/purchase-orders" className={TEXT_LINK}>
        ← Purchase orders
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-mono text-2xl font-semibold">{po.purchaseOrderNumber}</h1>
            <PurchaseOrderStatusBadge status={po.status} />
          </div>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{po.vendorName}</p>
        </div>
        <div className="flex flex-wrap items-start gap-2">
          {canEdit && (
            <Link href={`/purchase-orders/${po.id}/edit`} className={SECONDARY_LINK}>
              Edit
            </Link>
          )}
          <Link href={`/purchase-orders/${po.id}/print`} className={SECONDARY_LINK}>
            Print
          </Link>
        </div>
      </div>

      <PurchaseOrderStatusActions
        purchaseOrderId={po.id}
        purchaseOrderNumber={po.purchaseOrderNumber}
        status={po.status}
        actions={actions}
      />

      {po.status !== "draft" && (
        <p className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300">
          This purchase order is no longer a draft, so its content can&apos;t be changed.
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <dl className="grid gap-x-6 gap-y-4 rounded-xl border border-zinc-200 bg-white p-6 sm:grid-cols-2 dark:border-zinc-800 dark:bg-zinc-950">
          <Item label="PO number">{po.purchaseOrderNumber}</Item>
          <Item label="Status">
            <PurchaseOrderStatusBadge status={po.status} />
          </Item>
          <Item label="Order date">{formatCalendarDate(po.orderDate)}</Item>
          <Item label="Expected delivery">
            {po.expectedDeliveryDate && formatCalendarDate(po.expectedDeliveryDate)}
          </Item>
          <Item label="Created">{formatDateTime(po.createdAt, tz)}</Item>
          <Item label="Last updated">{formatDateTime(po.updatedAt, tz)}</Item>
        </dl>

        {/* Vendor details as recorded on the purchase order (snapshot). */}
        <section className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-950">
          <h2 className="text-sm font-medium text-zinc-500 dark:text-zinc-400">Vendor</h2>
          <div className="mt-1 space-y-0.5 break-words">
            <p className="font-medium">{po.vendorName}</p>
            {po.vendorCompanyName && <p>{po.vendorCompanyName}</p>}
            {po.vendorAddress && <p className="whitespace-pre-line">{po.vendorAddress}</p>}
            {po.vendorPhone && <p>{po.vendorPhone}</p>}
            {po.vendorEmail && <p>{po.vendorEmail}</p>}
            {po.vendorTaxNumber && <p>Tax number: {po.vendorTaxNumber}</p>}
          </div>
          <Link href={`/vendors/${po.vendorId}`} className={`mt-3 inline-block ${TEXT_LINK}`}>
            Open vendor record
          </Link>
        </section>
      </div>

      <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
        <table className="min-w-full divide-y divide-zinc-200 text-sm dark:divide-zinc-800">
          <thead className="bg-zinc-50 text-left text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
            <tr>
              <th scope="col" className="px-4 py-3 font-medium">#</th>
              <th scope="col" className="px-4 py-3 font-medium">Item</th>
              <th scope="col" className="px-4 py-3 text-right font-medium">Quantity</th>
              <th scope="col" className="px-4 py-3 font-medium">Unit</th>
              <th scope="col" className="px-4 py-3 text-right font-medium whitespace-nowrap">Unit price</th>
              <th scope="col" className="px-4 py-3 text-right font-medium">Discount</th>
              <th scope="col" className="px-4 py-3 text-right font-medium">Tax</th>
              <th scope="col" className="px-4 py-3 text-right font-medium whitespace-nowrap">Line total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {po.items.map((item, index) => (
              <tr key={item.id} className="align-top">
                <td className="px-4 py-3 text-zinc-500">{index + 1}</td>
                <td className="px-4 py-3">
                  <p className="font-medium">{item.productName}</p>
                  <p className="font-mono text-xs text-zinc-500">{item.sku}</p>
                  {item.description && (
                    <p className="mt-1 whitespace-pre-line break-words text-zinc-600 dark:text-zinc-400">
                      {item.description}
                    </p>
                  )}
                </td>
                <td className="px-4 py-3 text-right tabular-nums">{formatQuantity(item.quantity)}</td>
                <td className="px-4 py-3">{item.unit}</td>
                <td className="px-4 py-3 text-right whitespace-nowrap tabular-nums">{money(item.unitPrice)}</td>
                <td className="px-4 py-3 text-right whitespace-nowrap tabular-nums">{money(item.discountAmount)}</td>
                <td className="px-4 py-3 text-right whitespace-nowrap tabular-nums">
                  {money(item.taxAmount)}
                  <span className="block text-xs text-zinc-500">{plainDecimal(item.taxRate)}%</span>
                </td>
                <td className="px-4 py-3 text-right font-medium whitespace-nowrap tabular-nums">
                  {money(item.lineTotal)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-950">
          <h2 className="text-sm font-medium text-zinc-500 dark:text-zinc-400">Notes</h2>
          <p className="mt-1 whitespace-pre-line break-words">
            {po.notes || <span className="text-zinc-400">—</span>}
          </p>
        </section>
        <dl className="space-y-2 rounded-xl border border-zinc-200 bg-white p-6 text-sm dark:border-zinc-800 dark:bg-zinc-950">
          <TotalRow label="Subtotal" value={money(po.subtotal)} />
          <TotalRow label="Discount total" value={money(po.discountTotal)} />
          <TotalRow label="Tax total" value={money(po.taxTotal)} />
          <div className="border-t border-zinc-200 pt-2 dark:border-zinc-700">
            <TotalRow label="Grand total" value={money(po.grandTotal)} strong />
          </div>
        </dl>
      </div>
    </div>
  );
}

function Item({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-sm font-medium text-zinc-500 dark:text-zinc-400">{label}</dt>
      <dd className="mt-1 break-words text-zinc-900 dark:text-zinc-50">
        {children || <span className="text-zinc-400">—</span>}
      </dd>
    </div>
  );
}

function TotalRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`flex justify-between gap-4 ${strong ? "text-base font-semibold" : ""}`}>
      <dt className={strong ? undefined : "text-zinc-600 dark:text-zinc-400"}>{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}
