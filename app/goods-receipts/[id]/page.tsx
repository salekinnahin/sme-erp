import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { DataTable, DocumentSummary, MetadataItem, MetadataList, PageHeader, PageSkeleton, SectionCard } from "@/app/_components/ui";
import { SECONDARY_LINK, TEXT_LINK } from "@/app/_components/styles";
import { Alert } from "@/app/auth/_components/ui";
import { requireTenant } from "@/lib/tenancy/context";
import { getGoodsReceiptDocument } from "@/lib/goods-receipts/goods-receipts";
import { GOODS_RECEIPT_RECORDED_MESSAGE } from "@/lib/goods-receipts/messages";
import { exactQuantity, receivedByDisplay } from "@/lib/goods-receipts/receiving";
import { formatCalendarDate, formatDateTime } from "@/lib/format";

export const metadata: Metadata = { title: "Goods receipt · SME ERP" };

/**
 * Read-only goods receipt. Receipts are immutable physical events: no edit,
 * delete or cancel exists for any role (Part 1 rule), so the only actions
 * are viewing the source purchase order and printing.
 */
export default function GoodsReceiptPage({ params, searchParams }: PageProps<"/goods-receipts/[id]">) {
  return (
    <Suspense fallback={<PageSkeleton label="Loading…" />}>
      <GoodsReceiptDetail params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function GoodsReceiptDetail({ params, searchParams }: Pick<PageProps<"/goods-receipts/[id]">, "params" | "searchParams">) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const tenant = await requireTenant();
  // Null for malformed, unknown and other organizations' IDs alike.
  const receipt = await getGoodsReceiptDocument(tenant, id);
  if (!receipt) notFound();

  const poHref = `/purchase-orders/${receipt.purchase_order_id}`;
  const recorded = query.recorded === "1";

  return (
    <div className="space-y-6">
      <Link href="/goods-receipts" className={TEXT_LINK}>← Goods receipts</Link>
      {recorded && <Alert kind="success">{GOODS_RECEIPT_RECORDED_MESSAGE}</Alert>}
      <PageHeader
        title={<span className="font-mono">{receipt.goods_receipt_number}</span>}
        description={<>Received {formatCalendarDate(receipt.received_date)} · {receipt.vendor.name}</>}
        actions={<>
          <Link href={poHref} className={SECONDARY_LINK}>View purchase order</Link>
          <Link href={`/goods-receipts/${receipt.id}/print`} className={SECONDARY_LINK}>Print</Link>
        </>}
      />
      <div className="document-layout">
        <div className="document-main">
          <p className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-700">
            Goods receipts are permanent records and can&apos;t be edited or deleted.
          </p>
          <SectionCard title="Vendor">
            <div className="space-y-1 break-words text-sm">
              <p className="font-semibold">{receipt.vendor.name}</p>
              {receipt.vendor.companyName && <p className="text-muted">{receipt.vendor.companyName}</p>}
              {receipt.vendor.address && <p className="whitespace-pre-line text-muted">{receipt.vendor.address}</p>}
              {receipt.vendor.phone && <p className="text-muted">{receipt.vendor.phone}</p>}
              {receipt.vendor.email && <p className="text-muted">{receipt.vendor.email}</p>}
            </div>
          </SectionCard>
          <section className="min-w-0">
            <h2 className="mb-3 text-sm font-semibold">
              Received items <span className="ml-1 text-xs font-normal text-muted">({receipt.items.length})</span>
            </h2>
            <DataTable label="Received items">
              <table className="receiving-table w-full text-left">
                <thead>
                  <tr>
                    <th scope="col">Product</th>
                    <th scope="col">SKU</th>
                    <th scope="col">Unit</th>
                    <th scope="col" className="num">Ordered</th>
                    <th scope="col" className="num emphasis">Quantity received</th>
                  </tr>
                </thead>
                <tbody>
                  {receipt.items.map((item) => (
                    <tr key={item.id}>
                      <td data-label="Product">
                        <p className="font-medium">{item.product_name}</p>
                        {item.description && <p className="mt-1 max-w-md whitespace-pre-line break-words text-xs text-muted">{item.description}</p>}
                      </td>
                      <td data-label="SKU" className="font-mono text-xs">{item.sku}</td>
                      <td data-label="Unit" className="text-muted">{item.unit}</td>
                      <td data-label="Ordered" className="num">{exactQuantity(item.ordered_quantity_snapshot)}</td>
                      <td data-label="Quantity received" className="num emphasis remaining">{exactQuantity(item.received_quantity)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </DataTable>
          </section>
          <SectionCard title="Notes">
            <p className="whitespace-pre-line break-words text-sm">{receipt.notes || <span className="text-zinc-400">—</span>}</p>
          </SectionCard>
        </div>
        <DocumentSummary>
          <SectionCard title="Receipt information">
            <MetadataList>
              <MetadataItem label="GR number"><span className="font-mono">{receipt.goods_receipt_number}</span></MetadataItem>
              <MetadataItem label="Received date">{formatCalendarDate(receipt.received_date)}</MetadataItem>
              <MetadataItem label="Purchase order"><Link href={poHref} className="font-mono">{receipt.purchase_order_number}</Link></MetadataItem>
              <MetadataItem label="Received by">{receivedByDisplay(receipt.received_by_name)}</MetadataItem>
              <MetadataItem label="Created" wide>{formatDateTime(receipt.created_at, tenant.organization.timezone)}</MetadataItem>
            </MetadataList>
          </SectionCard>
        </DocumentSummary>
      </div>
    </div>
  );
}
