import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { requireTenant } from "@/lib/tenancy/context";
import { getSalesOrder } from "@/lib/sales-orders/sales-orders";
import { getOrganizationDetails } from "@/lib/organizations/details";
import { SALES_ORDER_STATUS_LABELS } from "@/lib/sales-orders/validation";
import { formatCalendarDate, formatMoney, formatQuantity, plainDecimal } from "@/lib/format";
import { TEXT_LINK } from "@/app/_components/styles";
import { PrintButton } from "@/app/_components/print-button";

export const metadata: Metadata = { title: "Print sales order · SME ERP" };

/**
 * Browser print view (same layout rules as the quotation print view). App
 * chrome and the toolbar are hidden when printing. The document always uses
 * dark-on-white "paper" colors. Order values come from the order's snapshot
 * only; the letterhead is the organization's current details. Browser Print
 * → Save as PDF gives a PDF; there is no PDF library.
 */
export default function PrintSalesOrderPage({ params }: PageProps<"/sales-orders/[id]/print">) {
  return (
    <Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}>
      <PrintSalesOrder params={params} />
    </Suspense>
  );
}

async function PrintSalesOrder({ params }: Pick<PageProps<"/sales-orders/[id]/print">, "params">) {
  const { id } = await params;
  const tenant = await requireTenant();
  const order = await getSalesOrder(tenant, id);
  if (!order) notFound();
  const org = await getOrganizationDetails(tenant);

  const money = (amount: string) => formatMoney(amount, tenant.organization.currency);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link href={`/sales-orders/${order.id}`} className={TEXT_LINK}>
          ← Back to sales order
        </Link>
        <div className="flex items-center gap-3">
          {order.status === "draft" && (
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
            <h1 className="text-2xl font-semibold tracking-wide uppercase">Sales order</h1>
            <dl className="mt-2 grid grid-cols-[auto_auto] justify-end gap-x-4 gap-y-0.5">
              <dt className="text-zinc-600">Number</dt>
              <dd className="font-mono font-medium">{order.salesOrderNumber}</dd>
              <dt className="text-zinc-600">Order date</dt>
              <dd>{formatCalendarDate(order.orderDate)}</dd>
              <dt className="text-zinc-600">Expected delivery</dt>
              <dd>{order.expectedDeliveryDate ? formatCalendarDate(order.expectedDeliveryDate) : "—"}</dd>
              <dt className="text-zinc-600">Status</dt>
              <dd>{SALES_ORDER_STATUS_LABELS[order.status]}</dd>
              {order.sourceQuotationNumber && (
                <>
                  <dt className="text-zinc-600">Quotation</dt>
                  <dd className="font-mono">{order.sourceQuotationNumber}</dd>
                </>
              )}
            </dl>
          </div>
        </header>

        <section className="mt-6 break-words">
          <h2 className="text-xs font-semibold tracking-wide text-zinc-600 uppercase">Customer</h2>
          <div className="mt-1 space-y-0.5">
            <p className="font-medium">{order.customerName}</p>
            {order.customerCompanyName && <p>{order.customerCompanyName}</p>}
            {order.customerAddress && <p className="whitespace-pre-line">{order.customerAddress}</p>}
            {order.customerPhone && <p>{order.customerPhone}</p>}
            {order.customerEmail && <p>{order.customerEmail}</p>}
            {order.customerTaxNumber && <p>Tax number: {order.customerTaxNumber}</p>}
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
            {order.items.map((item, index) => (
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
            {order.notes && (
              <>
                <h2 className="text-xs font-semibold tracking-wide text-zinc-600 uppercase">Notes</h2>
                <p className="mt-1 whitespace-pre-line">{order.notes}</p>
              </>
            )}
          </section>
          <dl className="ml-auto w-full max-w-xs space-y-1">
            <Row label="Subtotal" value={money(order.subtotal)} />
            <Row label="Total discount" value={money(order.discountTotal)} />
            <Row label="Total tax" value={money(order.taxTotal)} />
            <div className="border-t-2 border-zinc-400 pt-1">
              <Row label="Grand total" value={money(order.grandTotal)} strong />
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
