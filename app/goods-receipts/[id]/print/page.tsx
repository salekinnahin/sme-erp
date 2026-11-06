import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { requireTenant } from "@/lib/tenancy/context";
import { getGoodsReceiptDocument } from "@/lib/goods-receipts/goods-receipts";
import { getOrganizationBranding } from "@/lib/organizations/branding";
import { exactQuantity, receivedByDisplay } from "@/lib/goods-receipts/receiving";
import { formatCalendarDate } from "@/lib/format";
import { TEXT_LINK } from "@/app/_components/styles";
import { PrintButton } from "@/app/_components/print-button";
import { DocumentBrandHeader } from "@/app/_components/document-brand-header";

export const metadata: Metadata = { title: "Print goods received note · SME ERP" };

/**
 * Goods Received Note (GRN): browser print view, same rules as the other
 * document prints. Receipt values come from the receipt's own snapshot and
 * its PO vendor snapshot; the letterhead is the organization's live
 * branding (DECISIONS 029). No PDF library: Print → Save as PDF.
 * "Received By" is the name snapshot stored on the receipt (DECISIONS 032),
 * never the live profile; signature lines stay for the paper copy.
 */
export default function PrintGoodsReceiptPage({ params }: PageProps<"/goods-receipts/[id]/print">) {
  return (
    <Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}>
      <PrintGoodsReceipt params={params} />
    </Suspense>
  );
}

async function PrintGoodsReceipt({ params }: Pick<PageProps<"/goods-receipts/[id]/print">, "params">) {
  const { id } = await params;
  const tenant = await requireTenant();
  const receipt = await getGoodsReceiptDocument(tenant, id);
  if (!receipt) notFound();
  const branding = await getOrganizationBranding(tenant);
  const vendor = receipt.vendor;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link href={`/goods-receipts/${receipt.id}`} className={TEXT_LINK}>← Back to goods receipt</Link>
        <PrintButton />
      </div>

      <article className="mx-auto max-w-4xl bg-white p-8 text-sm text-zinc-900 shadow-sm ring-1 ring-zinc-200 sm:p-12 print:max-w-none print:p-0 print:shadow-none print:ring-0">
        <DocumentBrandHeader
          branding={branding}
          title="Goods Received Note"
          number={receipt.goods_receipt_number}
          meta={[
            { label: "Received date", value: formatCalendarDate(receipt.received_date) },
            { label: "Purchase order", value: receipt.purchase_order_number, mono: true },
            { label: "Received by", value: receivedByDisplay(receipt.received_by_name) },
          ]}
        />

        <section className="mt-6 break-words">
          <h2 className="text-xs font-semibold tracking-wide text-zinc-600 uppercase">Vendor</h2>
          <div className="mt-1 space-y-0.5">
            <p className="font-medium">{vendor.name}</p>
            {vendor.companyName && <p>{vendor.companyName}</p>}
            {vendor.address && <p className="whitespace-pre-line">{vendor.address}</p>}
            {vendor.phone && <p>{vendor.phone}</p>}
            {vendor.email && <p>{vendor.email}</p>}
          </div>
        </section>

        <table className="mt-8 w-full border-collapse text-left">
          <thead>
            <tr className="border-b-2 border-zinc-400 text-xs tracking-wide text-zinc-600 uppercase">
              <th scope="col" className="py-2 pr-2 font-semibold">#</th>
              <th scope="col" className="py-2 pr-2 font-semibold">Product</th>
              <th scope="col" className="py-2 px-2 font-semibold">SKU</th>
              <th scope="col" className="py-2 px-2 font-semibold">Unit</th>
              <th scope="col" className="py-2 px-2 text-right font-semibold">Ordered qty</th>
              <th scope="col" className="py-2 pl-2 text-right font-semibold">Received qty</th>
            </tr>
          </thead>
          <tbody>
            {receipt.items.map((item, index) => (
              <tr key={item.id} className="break-inside-avoid border-b border-zinc-200 align-top">
                <td className="py-2 pr-2 text-zinc-600">{index + 1}</td>
                <td className="py-2 pr-2">
                  <p className="font-medium">{item.product_name}</p>
                  {item.description && <p className="mt-0.5 whitespace-pre-line break-words text-zinc-700">{item.description}</p>}
                </td>
                <td className="py-2 px-2 font-mono text-xs">{item.sku}</td>
                <td className="py-2 px-2">{item.unit}</td>
                <td className="py-2 px-2 text-right tabular-nums">{exactQuantity(item.ordered_quantity_snapshot)}</td>
                <td className="py-2 pl-2 text-right font-medium tabular-nums">{exactQuantity(item.received_quantity)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {receipt.notes && (
          <section className="mt-6 max-w-xl break-inside-avoid break-words">
            <h2 className="text-xs font-semibold tracking-wide text-zinc-600 uppercase">Notes</h2>
            <p className="mt-1 whitespace-pre-line">{receipt.notes}</p>
          </section>
        )}

        <section aria-label="Signatures" className="mt-16 grid break-inside-avoid gap-10 sm:grid-cols-2 print:grid-cols-2">
          <Signature label="Received By" name={receivedByDisplay(receipt.received_by_name)} />
          <Signature label="Checked By" />
        </section>
      </article>
    </div>
  );
}

function Signature({ label, name }: { label: string; name?: string }) {
  return (
    <div>
      <p>
        <span className="font-semibold">{label}:</span>{" "}
        {name ?? <span className="inline-block w-48 border-b border-zinc-500 align-bottom">&nbsp;</span>}
      </p>
      <div className="mt-6 h-6 border-b border-zinc-500" />
      <p className="mt-1 text-xs text-zinc-600">Signature and date</p>
    </div>
  );
}
