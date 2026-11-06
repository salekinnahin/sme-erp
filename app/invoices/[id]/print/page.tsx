import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { requireTenant } from "@/lib/tenancy/context";
import { getInvoice } from "@/lib/invoices/invoices";
import { getOrganizationBranding } from "@/lib/organizations/branding";
import { INVOICE_STATUS_LABELS } from "@/lib/invoices/validation";
import { formatCalendarDate, formatMoney, formatQuantity, plainDecimal } from "@/lib/format";
import { TEXT_LINK } from "@/app/_components/styles";
import { PrintButton } from "@/app/_components/print-button";
import { DocumentBrandHeader } from "@/app/_components/document-brand-header";

export const metadata: Metadata = { title: "Print invoice · SME ERP" };

/**
 * Browser print view (same layout rules as the quotation print view). App
 * chrome and the toolbar are hidden when printing. The document always uses
 * dark-on-white "paper" colors. Invoice values come from the invoice's
 * snapshot only; the letterhead is the organization's live branding (logo and
 * details, DECISIONS 029). Browser Print → Save as PDF gives a PDF; there is
 * no PDF library.
 */
export default function PrintInvoicePage({ params }: PageProps<"/invoices/[id]/print">) {
  return (
    <Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}>
      <PrintInvoice params={params} />
    </Suspense>
  );
}

async function PrintInvoice({ params }: Pick<PageProps<"/invoices/[id]/print">, "params">) {
  const { id } = await params;
  const tenant = await requireTenant();
  const invoice = await getInvoice(tenant, id);
  if (!invoice) notFound();
  const branding = await getOrganizationBranding(tenant);

  const money = (amount: string) => formatMoney(amount, tenant.organization.currency);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link href={`/invoices/${invoice.id}`} className={TEXT_LINK}>
          ← Back to invoice
        </Link>
        <div className="flex items-center gap-3">
          {invoice.status === "draft" && (
            <span className="text-sm text-amber-700 dark:text-amber-300">
              Draft: the content may still change.
            </span>
          )}
          <PrintButton />
        </div>
      </div>

      <article className="mx-auto max-w-4xl bg-white p-8 text-sm text-zinc-900 shadow-sm ring-1 ring-zinc-200 sm:p-12 print:max-w-none print:p-0 print:shadow-none print:ring-0">
        <DocumentBrandHeader
          branding={branding}
          title="Invoice"
          number={invoice.invoiceNumber}
          meta={[
            { label: "Invoice date", value: formatCalendarDate(invoice.invoiceDate) },
            { label: "Due date", value: invoice.dueDate ? formatCalendarDate(invoice.dueDate) : "—" },
            { label: "Status", value: INVOICE_STATUS_LABELS[invoice.status] },
            ...(invoice.sourceSalesOrderNumber
              ? [{ label: "Sales order", value: invoice.sourceSalesOrderNumber, mono: true }]
              : []),
          ]}
        />

        <section className="mt-6 break-words">
          <h2 className="text-xs font-semibold tracking-wide text-zinc-600 uppercase">Customer</h2>
          <div className="mt-1 space-y-0.5">
            <p className="font-medium">{invoice.customerName}</p>
            {invoice.customerCompanyName && <p>{invoice.customerCompanyName}</p>}
            {invoice.customerAddress && <p className="whitespace-pre-line">{invoice.customerAddress}</p>}
            {invoice.customerPhone && <p>{invoice.customerPhone}</p>}
            {invoice.customerEmail && <p>{invoice.customerEmail}</p>}
            {invoice.customerTaxNumber && <p>Tax number: {invoice.customerTaxNumber}</p>}
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
            {invoice.items.map((item, index) => (
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
            {invoice.notes && (
              <>
                <h2 className="text-xs font-semibold tracking-wide text-zinc-600 uppercase">Notes</h2>
                <p className="mt-1 whitespace-pre-line">{invoice.notes}</p>
              </>
            )}
          </section>
          <dl className="ml-auto w-full max-w-xs space-y-1">
            <Row label="Subtotal" value={money(invoice.subtotal)} />
            <Row label="Total discount" value={money(invoice.discountTotal)} />
            <Row label="Total tax" value={money(invoice.taxTotal)} />
            <div className="border-t-2 border-zinc-400 pt-1">
              <Row label="Grand total" value={money(invoice.grandTotal)} strong />
            </div>
            <Row label="Amount paid" value={money(invoice.amountPaid)} />
            <Row label="Amount due" value={money(invoice.amountDue)} />
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
