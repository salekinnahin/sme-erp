import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { requireTenant } from "@/lib/tenancy/context";
import { getSalesOrder } from "@/lib/sales-orders/sales-orders";
import { canEditSalesOrder } from "@/lib/sales-orders/permissions";
import { salesOrderStatusActions } from "@/lib/sales-orders/status-actions";
import { formatCalendarDate, formatDateTime, formatMoney, formatQuantity, plainDecimal } from "@/lib/format";
import { SECONDARY_LINK, TEXT_LINK } from "@/app/_components/styles";
import { SalesOrderStatusBadge } from "../_components/sales-order-status-badge";
import { SalesOrderStatusActions } from "../_components/status-actions";
import { getInvoiceForSalesOrder } from "@/lib/invoices/invoices";
import { salesOrderConversionView } from "@/lib/invoices/conversion";
import { todayInTimeZone } from "@/lib/quotations/form";
import { ConvertSalesOrder } from "@/app/invoices/_components/convert-sales-order";
import { convertSalesOrderAction } from "@/app/invoices/actions";

export const metadata: Metadata = { title: "Sales order · SME ERP" };

export default function SalesOrderPage({ params }: PageProps<"/sales-orders/[id]">) {
  return (
    <Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}>
      <SalesOrderDetail params={params} />
    </Suspense>
  );
}

async function SalesOrderDetail({ params }: Pick<PageProps<"/sales-orders/[id]">, "params">) {
  const { id } = await params;
  const tenant = await requireTenant();
  // Null for malformed IDs, unknown IDs and other organizations' orders.
  const order = await getSalesOrder(tenant, id);
  if (!order) notFound();

  const tz = tenant.organization.timezone;
  const money = (amount: string) => formatMoney(amount, tenant.organization.currency);
  const canEdit = canEditSalesOrder(tenant.role, order.status);
  const invoice = await getInvoiceForSalesOrder(tenant, order.id);
  const conversion = salesOrderConversionView(tenant.role, order.status, invoice);
  const actions = salesOrderStatusActions(tenant.role, order.status, invoice !== null);

  return (
    <div className="space-y-6">
      <Link href="/sales-orders" className={TEXT_LINK}>
        ← Sales orders
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-mono text-2xl font-semibold">{order.salesOrderNumber}</h1>
            <SalesOrderStatusBadge status={order.status} />
          </div>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{order.customerName}</p>
        </div>
        <div className="flex flex-wrap items-start gap-2">
          {canEdit && (
            <Link href={`/sales-orders/${order.id}/edit`} className={SECONDARY_LINK}>
              Edit
            </Link>
          )}
          <Link href={`/sales-orders/${order.id}/print`} className={SECONDARY_LINK}>
            Print
          </Link>
        </div>
      </div>

      <SalesOrderStatusActions
        salesOrderId={order.id}
        salesOrderNumber={order.salesOrderNumber}
        status={order.status}
        actions={actions}
      />

      <ConvertSalesOrder
        action={convertSalesOrderAction.bind(null, order.id)}
        view={conversion}
        today={todayInTimeZone(tenant.organization.timezone)}
      />
      {invoice && order.status === "confirmed" && (
        <p className="text-sm text-zinc-500">
          This sales order has an invoice and cannot be cancelled. Owners and managers can still mark it completed.
        </p>
      )}

      {order.status !== "draft" && (
        <p className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300">
          This sales order is no longer a draft, so its content can&apos;t be changed.
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <dl className="grid gap-x-6 gap-y-4 rounded-xl border border-zinc-200 bg-white p-6 sm:grid-cols-2 dark:border-zinc-800 dark:bg-zinc-950">
          <Item label="Sales order number">{order.salesOrderNumber}</Item>
          <Item label="Status">
            <SalesOrderStatusBadge status={order.status} />
          </Item>
          <Item label="Order date">{formatCalendarDate(order.orderDate)}</Item>
          <Item label="Expected delivery">
            {order.expectedDeliveryDate && formatCalendarDate(order.expectedDeliveryDate)}
          </Item>
          <Item label="Source">
            {order.sourceQuotationId ? (
              <Link href={`/quotations/${order.sourceQuotationId}`} className={TEXT_LINK}>
                Quotation {order.sourceQuotationNumber ?? ""}
              </Link>
            ) : (
              "Created directly"
            )}
          </Item>
          <Item label="Created">{formatDateTime(order.createdAt, tz)}</Item>
          <Item label="Last updated">{formatDateTime(order.updatedAt, tz)}</Item>
        </dl>

        {/* Customer details as recorded on the order (snapshot). */}
        <section className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-950">
          <h2 className="text-sm font-medium text-zinc-500 dark:text-zinc-400">Customer</h2>
          <div className="mt-1 space-y-0.5 break-words">
            <p className="font-medium">{order.customerName}</p>
            {order.customerCompanyName && <p>{order.customerCompanyName}</p>}
            {order.customerAddress && <p className="whitespace-pre-line">{order.customerAddress}</p>}
            {order.customerPhone && <p>{order.customerPhone}</p>}
            {order.customerEmail && <p>{order.customerEmail}</p>}
            {order.customerTaxNumber && <p>Tax number: {order.customerTaxNumber}</p>}
          </div>
          <Link href={`/customers/${order.customerId}`} className={`mt-3 inline-block ${TEXT_LINK}`}>
            Open customer record
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
            {order.items.map((item, index) => (
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
            {order.notes || <span className="text-zinc-400">—</span>}
          </p>
        </section>
        <dl className="space-y-2 rounded-xl border border-zinc-200 bg-white p-6 text-sm dark:border-zinc-800 dark:bg-zinc-950">
          <TotalRow label="Subtotal" value={money(order.subtotal)} />
          <TotalRow label="Discount total" value={money(order.discountTotal)} />
          <TotalRow label="Tax total" value={money(order.taxTotal)} />
          <div className="border-t border-zinc-200 pt-2 dark:border-zinc-700">
            <TotalRow label="Grand total" value={money(order.grandTotal)} strong />
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
