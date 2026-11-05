import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { requireTenant } from "@/lib/tenancy/context";
import { getInvoice } from "@/lib/invoices/invoices";
import { canEditInvoice } from "@/lib/invoices/permissions";
import { invoiceStatusActions } from "@/lib/invoices/status-actions";
import { formatCalendarDate, formatDateTime, formatMoney, formatQuantity, plainDecimal } from "@/lib/format";
import { SECONDARY_LINK, TEXT_LINK } from "@/app/_components/styles";
import { InvoiceStatusBadge } from "../_components/invoice-status-badge";
import { InvoiceStatusActions } from "../_components/status-actions";

export const metadata: Metadata = { title: "Invoice · SME ERP" };

export default function InvoicePage({ params }: PageProps<"/invoices/[id]">) {
  return (
    <Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}>
      <InvoiceDetail params={params} />
    </Suspense>
  );
}

async function InvoiceDetail({ params }: Pick<PageProps<"/invoices/[id]">, "params">) {
  const { id } = await params;
  const tenant = await requireTenant();
  // Null for malformed IDs, unknown IDs and other organizations' orders.
  const invoice = await getInvoice(tenant, id);
  if (!invoice) notFound();

  const tz = tenant.organization.timezone;
  const money = (amount: string) => formatMoney(amount, tenant.organization.currency);
  const canEdit = canEditInvoice(tenant.role, invoice.status);
  const actions = invoiceStatusActions(tenant.role, invoice.status);

  return (
    <div className="space-y-6">
      <Link href="/invoices" className={TEXT_LINK}>
        ← Invoices
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-mono text-2xl font-semibold">{invoice.invoiceNumber}</h1>
            <InvoiceStatusBadge status={invoice.status} />
          </div>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{invoice.customerName}</p>
        </div>
        <div className="flex flex-wrap items-start gap-2">
          {canEdit && (
            <Link href={`/invoices/${invoice.id}/edit`} className={SECONDARY_LINK}>
              Edit
            </Link>
          )}
          <Link href={`/invoices/${invoice.id}/print`} className={SECONDARY_LINK}>
            Print
          </Link>
        </div>
      </div>

      <InvoiceStatusActions
        invoiceId={invoice.id}
        invoiceNumber={invoice.invoiceNumber}
        status={invoice.status}
        actions={actions}
      />

      {invoice.status !== "draft" && (
        <p className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300">
          This invoice is no longer a draft, so its content can&apos;t be changed.
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <dl className="grid gap-x-6 gap-y-4 rounded-xl border border-zinc-200 bg-white p-6 sm:grid-cols-2 dark:border-zinc-800 dark:bg-zinc-950">
          <Item label="Invoice number">{invoice.invoiceNumber}</Item>
          <Item label="Status">
            <InvoiceStatusBadge status={invoice.status} />
          </Item>
          <Item label="Invoice date">{formatCalendarDate(invoice.invoiceDate)}</Item>
          <Item label="Due date">
            {invoice.dueDate && formatCalendarDate(invoice.dueDate)}
          </Item>
          <Item label="Source">
            {invoice.sourceSalesOrderId ? (
              <Link href={`/sales-orders/${invoice.sourceSalesOrderId}`} className={TEXT_LINK}>
                Sales order {invoice.sourceSalesOrderNumber ?? ""}
              </Link>
            ) : (
              "Created directly"
            )}
          </Item>
          <Item label="Created">{formatDateTime(invoice.createdAt, tz)}</Item>
          <Item label="Last updated">{formatDateTime(invoice.updatedAt, tz)}</Item>
        </dl>

        {/* Customer details as recorded on the invoice (snapshot). */}
        <section className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-950">
          <h2 className="text-sm font-medium text-zinc-500 dark:text-zinc-400">Customer</h2>
          <div className="mt-1 space-y-0.5 break-words">
            <p className="font-medium">{invoice.customerName}</p>
            {invoice.customerCompanyName && <p>{invoice.customerCompanyName}</p>}
            {invoice.customerAddress && <p className="whitespace-pre-line">{invoice.customerAddress}</p>}
            {invoice.customerPhone && <p>{invoice.customerPhone}</p>}
            {invoice.customerEmail && <p>{invoice.customerEmail}</p>}
            {invoice.customerTaxNumber && <p>Tax number: {invoice.customerTaxNumber}</p>}
          </div>
          <Link href={`/customers/${invoice.customerId}`} className={`mt-3 inline-block ${TEXT_LINK}`}>
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
            {invoice.items.map((item, index) => (
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
            {invoice.notes || <span className="text-zinc-400">—</span>}
          </p>
        </section>
        <dl className="space-y-2 rounded-xl border border-zinc-200 bg-white p-6 text-sm dark:border-zinc-800 dark:bg-zinc-950">
          <TotalRow label="Subtotal" value={money(invoice.subtotal)} />
          <TotalRow label="Discount total" value={money(invoice.discountTotal)} />
          <TotalRow label="Tax total" value={money(invoice.taxTotal)} />
          <div className="border-t border-zinc-200 pt-2 dark:border-zinc-700">
            <TotalRow label="Grand total" value={money(invoice.grandTotal)} strong />
          </div>
          <TotalRow label="Amount paid" value={money(invoice.amountPaid)} />
          <TotalRow label="Amount due" value={money(invoice.amountDue)} />
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
