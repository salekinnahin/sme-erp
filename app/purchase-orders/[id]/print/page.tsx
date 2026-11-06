import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { requireTenant } from "@/lib/tenancy/context";
import { getPurchaseOrder } from "@/lib/purchase-orders/purchase-orders";
import { getOrganizationDetails } from "@/lib/organizations/details";
import { PURCHASE_ORDER_STATUS_LABELS } from "@/lib/purchase-orders/validation";
import { formatCalendarDate, formatMoney, formatQuantity, plainDecimal } from "@/lib/format";
import { TEXT_LINK } from "@/app/_components/styles";
import { PrintButton } from "@/app/_components/print-button";

export const metadata: Metadata = { title: "Print purchase order · SME ERP" };

/**
 * Browser print view (same layout rules as the invoice print view). App
 * chrome and the toolbar are hidden when printing. The document always uses
 * dark-on-white "paper" colors. Order values come from the purchase order's
 * snapshot only; the letterhead is the organization's current details.
 * Browser Print → Save as PDF gives a PDF; there is no PDF library.
 */
export default function PrintPurchaseOrderPage({ params }: PageProps<"/purchase-orders/[id]/print">) {
  return (
    <Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}>
      <PrintPurchaseOrder params={params} />
    </Suspense>
  );
}

async function PrintPurchaseOrder({ params }: Pick<PageProps<"/purchase-orders/[id]/print">, "params">) {
  const { id } = await params;
  const tenant = await requireTenant();
  const po = await getPurchaseOrder(tenant, id);
  if (!po) notFound();
  const org = await getOrganizationDetails(tenant);

  const money = (amount: string) => formatMoney(amount, tenant.organization.currency);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link href={`/purchase-orders/${po.id}`} className={TEXT_LINK}>
          ← Back to purchase order
        </Link>
        <div className="flex items-center gap-3">
          {po.status === "draft" && (
            <span className="text-sm text-amber-700 dark:text-amber-300">
              Draft: the content may still change.
            </span>
          )}
          <PrintButton />
        </div>
      </div>

      <article className="mx-auto max-w-4xl bg-white p-8 text-sm text-zinc-900 shadow-sm ring-1 ring-zinc-200 sm:p-12 print:max-w-none print:p-0 print:shadow-none print:ring-0">
        <header className="flex flex-wrap items-start justify-between gap-6 border-b border-zinc-300 pb-6">
          <div className="max-w-sm space-y-0.5 break-words">
            <p className="text-lg font-semibold">{org.name}</p>
            {org.address && <p className="whitespace-pre-line">{org.address}</p>}
            {org.phone && <p>{org.phone}</p>}
            {org.email && <p>{org.email}</p>}
            {org.taxNumber && <p>Tax number: {org.taxNumber}</p>}
          </div>
          <div className="text-right">
            <h1 className="text-2xl font-semibold tracking-wide uppercase">Purchase order</h1>
            <dl className="mt-2 grid grid-cols-[auto_auto] justify-end gap-x-4 gap-y-0.5">
              <dt className="text-zinc-600">Number</dt>
              <dd className="font-mono font-medium">{po.purchaseOrderNumber}</dd>
              <dt className="text-zinc-600">Order date</dt>
              <dd>{formatCalendarDate(po.orderDate)}</dd>
              <dt className="text-zinc-600">Expected delivery</dt>
              <dd>{po.expectedDeliveryDate ? formatCalendarDate(po.expectedDeliveryDate) : "—"}</dd>
              <dt className="text-zinc-600">Status</dt>
              <dd>{PURCHASE_ORDER_STATUS_LABELS[po.status]}</dd>
            </dl>
          </div>
        </header>

        <section className="mt-6 break-words">
          <h2 className="text-xs font-semibold tracking-wide text-zinc-600 uppercase">Vendor</h2>
          <div className="mt-1 space-y-0.5">
            <p className="font-medium">{po.vendorName}</p>
            {po.vendorCompanyName && <p>{po.vendorCompanyName}</p>}
            {po.vendorAddress && <p className="whitespace-pre-line">{po.vendorAddress}</p>}
            {po.vendorPhone && <p>{po.vendorPhone}</p>}
            {po.vendorEmail && <p>{po.vendorEmail}</p>}
            {po.vendorTaxNumber && <p>Tax number: {po.vendorTaxNumber}</p>}
          </div>
        </section>

        <table className="mt-8 w-full border-collapse text-left">
          <thead>
            <tr className="border-b-2 border-zinc-400 text-xs tracking-wide text-zinc-600 uppercase">
              <th scope="col" className="py-2 pr-2 font-semibold">#</th>
              <th scope="col" className="py-2 pr-2 font-semibold">Item</th>
              <th scope="col" className="py-2 px-2 text-right font-semibold">Qty</th>
              <th scope="col" className="py-2 px-2 font-semibold">Unit</th>
              <th scope="col" className="py-2 px-2 text-right font-semibold">Unit price</th>
              <th scope="col" className="py-2 px-2 text-right font-semibold">Discount</th>
              <th scope="col" className="py-2 px-2 text-right font-semibold">Tax</th>
              <th scope="col" className="py-2 pl-2 text-right font-semibold">Line total</th>
            </tr>
          </thead>
          <tbody>
            {po.items.map((item, index) => (
              <tr key={item.id} className="break-inside-avoid border-b border-zinc-200 align-top">
                <td className="py-2 pr-2 text-zinc-600">{index + 1}</td>
                <td className="py-2 pr-2">
                  <p className="font-medium">{item.productName}</p>
                  <p className="font-mono text-xs text-zinc-600">{item.sku}</p>
                  {item.description && (
                    <p className="mt-0.5 whitespace-pre-line break-words text-zinc-700">{item.description}</p>
                  )}
                </td>
                <td className="py-2 px-2 text-right tabular-nums">{formatQuantity(item.quantity)}</td>
                <td className="py-2 px-2">{item.unit}</td>
                <td className="py-2 px-2 text-right whitespace-nowrap tabular-nums">{money(item.unitPrice)}</td>
                <td className="py-2 px-2 text-right whitespace-nowrap tabular-nums">{money(item.discountAmount)}</td>
                <td className="py-2 px-2 text-right whitespace-nowrap tabular-nums">
                  {money(item.taxAmount)}
                  <span className="block text-xs text-zinc-600">{plainDecimal(item.taxRate)}%</span>
                </td>
                <td className="py-2 pl-2 text-right font-medium whitespace-nowrap tabular-nums">
                  {money(item.lineTotal)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="mt-6 flex break-inside-avoid flex-wrap justify-between gap-8">
          <section className="max-w-md min-w-0 flex-1 break-words">
            {po.notes && (
              <>
                <h2 className="text-xs font-semibold tracking-wide text-zinc-600 uppercase">Notes</h2>
                <p className="mt-1 whitespace-pre-line">{po.notes}</p>
              </>
            )}
          </section>
          <dl className="ml-auto w-full max-w-xs space-y-1">
            <Row label="Subtotal" value={money(po.subtotal)} />
            <Row label="Total discount" value={money(po.discountTotal)} />
            <Row label="Total tax" value={money(po.taxTotal)} />
            <div className="border-t-2 border-zinc-400 pt-1">
              <Row label="Grand total" value={money(po.grandTotal)} strong />
            </div>
          </dl>
        </div>
      </article>
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`flex justify-between gap-4 ${strong ? "text-base font-semibold" : ""}`}>
      <dt className={strong ? undefined : "text-zinc-600"}>{label}</dt>
      <dd className="tabular-nums whitespace-nowrap">{value}</dd>
    </div>
  );
}
