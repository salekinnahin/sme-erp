import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { requireTenant } from "@/lib/tenancy/context";
import { getQuotation } from "@/lib/quotations/quotations";
import { canEditQuotation } from "@/lib/quotations/permissions";
import { quotationStatusActions } from "@/lib/quotations/status-actions";
import { formatCalendarDate, formatDateTime, formatMoney, formatQuantity, plainDecimal } from "@/lib/format";
import { SECONDARY_LINK, TEXT_LINK } from "@/app/_components/styles";
import { QuotationStatusBadge } from "../_components/quotation-status-badge";
import { QuotationStatusActions } from "../_components/status-actions";
import { getSalesOrderForQuotation } from "@/lib/sales-orders/sales-orders";
import { quotationConversionView } from "@/lib/sales-orders/conversion";
import { todayInTimeZone } from "@/lib/quotations/form";
import { ConvertQuotation } from "@/app/sales-orders/_components/convert-quotation";
import { convertQuotationAction } from "@/app/sales-orders/actions";

export const metadata: Metadata = { title: "Quotation · SME ERP" };

export default function QuotationPage({ params }: PageProps<"/quotations/[id]">) {
  return (
    <Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}>
      <QuotationDetail params={params} />
    </Suspense>
  );
}

async function QuotationDetail({ params }: Pick<PageProps<"/quotations/[id]">, "params">) {
  const { id } = await params;
  const tenant = await requireTenant();
  // Null for malformed IDs, unknown IDs and other organizations' quotations.
  const quotation = await getQuotation(tenant, id);
  if (!quotation) notFound();

  const currency = tenant.organization.currency;
  const money = (amount: string) => formatMoney(amount, currency);
  const canEdit = canEditQuotation(tenant.role, quotation.status);
  const actions = quotationStatusActions(tenant.role, quotation.status);
  // Only an accepted quotation can have (or get) a sales order: one indexed,
  // tenant-filtered lookup, and only on this page.
  const salesOrder =
    quotation.status === "accepted" ? await getSalesOrderForQuotation(tenant, quotation.id) : null;
  const conversion = quotationConversionView(tenant.role, quotation.status, salesOrder);

  return (
    <div className="space-y-6">
      <Link href="/quotations" className={TEXT_LINK}>
        ← Quotations
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-mono text-2xl font-semibold">{quotation.quotationNumber}</h1>
            <QuotationStatusBadge status={quotation.status} />
          </div>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{quotation.customerName}</p>
        </div>
        <div className="flex flex-wrap items-start gap-2">
          {canEdit && (
            <Link href={`/quotations/${quotation.id}/edit`} className={SECONDARY_LINK}>
              Edit
            </Link>
          )}
          <Link href={`/quotations/${quotation.id}/print`} className={SECONDARY_LINK}>
            Print
          </Link>
        </div>
      </div>

      {/* key resets the confirmation step after the status changes */}
      <QuotationStatusActions
        key={quotation.status}
        quotationId={quotation.id}
        quotationNumber={quotation.quotationNumber}
        actions={actions}
      />

      <ConvertQuotation
        action={convertQuotationAction.bind(null, quotation.id)}
        view={conversion}
        today={todayInTimeZone(tenant.organization.timezone)}
      />

      {quotation.status !== "draft" && (
        <p className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300">
          This quotation is no longer a draft, so its content can&apos;t be changed.
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <dl className="grid gap-x-6 gap-y-4 rounded-xl border border-zinc-200 bg-white p-6 sm:grid-cols-2 dark:border-zinc-800 dark:bg-zinc-950">
          <Item label="Quotation number">{quotation.quotationNumber}</Item>
          <Item label="Status">
            <QuotationStatusBadge status={quotation.status} />
          </Item>
          <Item label="Quotation date">{formatCalendarDate(quotation.quotationDate)}</Item>
          <Item label="Expiry date">
            {quotation.expiryDate && formatCalendarDate(quotation.expiryDate)}
          </Item>
          <Item label="Created">{formatDateTime(quotation.createdAt, tenant.organization.timezone)}</Item>
          <Item label="Last updated">{formatDateTime(quotation.updatedAt, tenant.organization.timezone)}</Item>
        </dl>

        {/* Customer details as recorded on the quotation (snapshot). */}
        <section className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-950">
          <h2 className="text-sm font-medium text-zinc-500 dark:text-zinc-400">Customer</h2>
          <div className="mt-1 space-y-0.5 break-words">
            <p className="font-medium">{quotation.customerName}</p>
            {quotation.customerCompanyName && <p>{quotation.customerCompanyName}</p>}
            {quotation.customerAddress && <p className="whitespace-pre-line">{quotation.customerAddress}</p>}
            {quotation.customerPhone && <p>{quotation.customerPhone}</p>}
            {quotation.customerEmail && <p>{quotation.customerEmail}</p>}
            {quotation.customerTaxNumber && <p>Tax number: {quotation.customerTaxNumber}</p>}
          </div>
          <Link href={`/customers/${quotation.customerId}`} className={`mt-3 inline-block ${TEXT_LINK}`}>
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
            {quotation.items.map((item, index) => (
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
            {quotation.notes || <span className="text-zinc-400">—</span>}
          </p>
        </section>
        <dl className="space-y-2 rounded-xl border border-zinc-200 bg-white p-6 text-sm dark:border-zinc-800 dark:bg-zinc-950">
          <TotalRow label="Subtotal" value={money(quotation.subtotal)} />
          <TotalRow label="Discount total" value={money(quotation.discountTotal)} />
          <TotalRow label="Tax total" value={money(quotation.taxTotal)} />
          <div className="border-t border-zinc-200 pt-2 dark:border-zinc-700">
            <TotalRow label="Grand total" value={money(quotation.grandTotal)} strong />
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
