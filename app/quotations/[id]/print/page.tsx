import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { requireTenant } from "@/lib/tenancy/context";
import { getQuotation } from "@/lib/quotations/quotations";
import { getOrganizationDetails } from "@/lib/organizations/details";
import { QUOTATION_STATUS_LABELS } from "@/lib/quotations/validation";
import { formatCalendarDate, formatMoney, formatQuantity, plainDecimal } from "@/lib/format";
import { TEXT_LINK } from "@/app/_components/styles";
import { PrintButton } from "@/app/_components/print-button";

export const metadata: Metadata = { title: "Print quotation · SME ERP" };

/**
 * Browser print view. App chrome (header, navigation) and the toolbar are
 * hidden when printing (print:hidden, globals.css @media print). The
 * document itself always uses dark-on-white "paper" colors, whatever the
 * screen color scheme. Values come from the quotation's snapshot only.
 * Browser Print → Save as PDF gives a PDF; there is no PDF library.
 */
export default function PrintQuotationPage({ params }: PageProps<"/quotations/[id]/print">) {
  return (
    <Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}>
      <PrintQuotation params={params} />
    </Suspense>
  );
}

async function PrintQuotation({ params }: Pick<PageProps<"/quotations/[id]/print">, "params">) {
  const { id } = await params;
  const tenant = await requireTenant();
  const quotation = await getQuotation(tenant, id);
  if (!quotation) notFound();
  const org = await getOrganizationDetails(tenant);

  const money = (amount: string) => formatMoney(amount, tenant.organization.currency);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link href={`/quotations/${quotation.id}`} className={TEXT_LINK}>
          ← Back to quotation
        </Link>
        <div className="flex items-center gap-3">
          {quotation.status === "draft" && (
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
            <h1 className="text-2xl font-semibold tracking-wide uppercase">Quotation</h1>
            <dl className="mt-2 grid grid-cols-[auto_auto] justify-end gap-x-4 gap-y-0.5">
              <dt className="text-zinc-600">Number</dt>
              <dd className="font-mono font-medium">{quotation.quotationNumber}</dd>
              <dt className="text-zinc-600">Date</dt>
              <dd>{formatCalendarDate(quotation.quotationDate)}</dd>
              <dt className="text-zinc-600">Valid until</dt>
              <dd>{quotation.expiryDate ? formatCalendarDate(quotation.expiryDate) : "—"}</dd>
              {quotation.status !== "sent" && (
                <>
                  <dt className="text-zinc-600">Status</dt>
                  <dd>{QUOTATION_STATUS_LABELS[quotation.status]}</dd>
                </>
              )}
            </dl>
          </div>
        </header>

        <section className="mt-6 break-words">
          <h2 className="text-xs font-semibold tracking-wide text-zinc-600 uppercase">Quotation for</h2>
          <div className="mt-1 space-y-0.5">
            <p className="font-medium">{quotation.customerName}</p>
            {quotation.customerCompanyName && <p>{quotation.customerCompanyName}</p>}
            {quotation.customerAddress && <p className="whitespace-pre-line">{quotation.customerAddress}</p>}
            {quotation.customerPhone && <p>{quotation.customerPhone}</p>}
            {quotation.customerEmail && <p>{quotation.customerEmail}</p>}
            {quotation.customerTaxNumber && <p>Tax number: {quotation.customerTaxNumber}</p>}
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
            {quotation.items.map((item, index) => (
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
            {quotation.notes && (
              <>
                <h2 className="text-xs font-semibold tracking-wide text-zinc-600 uppercase">Notes</h2>
                <p className="mt-1 whitespace-pre-line">{quotation.notes}</p>
              </>
            )}
          </section>
          <dl className="ml-auto w-full max-w-xs space-y-1">
            <Row label="Subtotal" value={money(quotation.subtotal)} />
            <Row label="Total discount" value={money(quotation.discountTotal)} />
            <Row label="Total tax" value={money(quotation.taxTotal)} />
            <div className="border-t-2 border-zinc-400 pt-1">
              <Row label="Grand total" value={money(quotation.grandTotal)} strong />
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
