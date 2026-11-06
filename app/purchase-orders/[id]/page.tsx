import { PageHeader, SectionCard, MetadataList, MetadataItem, MoneySummary, DocumentSummary, PageSkeleton } from "@/app/_components/ui";
import { DocumentItems } from "@/app/_components/document-items";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { requireTenant } from "@/lib/tenancy/context";
import { getPurchaseOrder } from "@/lib/purchase-orders/purchase-orders";
import { canEditPurchaseOrder } from "@/lib/purchase-orders/permissions";
import { purchaseOrderStatusActions } from "@/lib/purchase-orders/status-actions";
import { formatCalendarDate, formatDateTime, formatMoney } from "@/lib/format";
import { PRIMARY_LINK, SECONDARY_LINK, TEXT_LINK } from "@/app/_components/styles";
import { getPurchaseOrderReceivingSummary, listPurchaseOrderGoodsReceipts } from "@/lib/goods-receipts/goods-receipts";
import { receiveGoodsAction, showsReceivingSummary, withoutCancelAfterReceipt } from "@/lib/goods-receipts/receiving";
import { ReceiptHistory, ReceivingSummary } from "@/app/goods-receipts/_components/receiving-sections";
import { PurchaseOrderStatusBadge } from "../_components/purchase-order-status-badge";
import { PurchaseOrderStatusActions } from "../_components/status-actions";

export const metadata: Metadata = { title: "Purchase order · SME ERP" };

export default function PurchaseOrderPage({ params }: PageProps<"/purchase-orders/[id]">) {
  return (
    <Suspense fallback={<PageSkeleton label="Loading…" />}>
      <PurchaseOrderDetail params={params} />
    </Suspense>
  );
}

async function PurchaseOrderDetail({ params }: Pick<PageProps<"/purchase-orders/[id]">, "params">) {
  const { id } = await params;
  const tenant = await requireTenant();
  // Null for malformed IDs, unknown IDs and other organizations' orders.
  // Receiving reads are tenant-filtered too and run in parallel (no N+1).
  const [po, lines, receipts] = await Promise.all([
    getPurchaseOrder(tenant, id),
    getPurchaseOrderReceivingSummary(tenant, id),
    listPurchaseOrderGoodsReceipts(tenant, id),
  ]);
  if (!po) notFound();

  const tz = tenant.organization.timezone;
  const money = (amount: string) => formatMoney(amount, tenant.organization.currency);
  const canEdit = canEditPurchaseOrder(tenant.role, po.status);
  // Order / cancel only; receiving statuses are never user actions. Any
  // goods receipt prevents cancellation (the database enforces it too).
  const actions = withoutCancelAfterReceipt(purchaseOrderStatusActions(tenant.role, po.status), receipts.total);
  const receive = receiveGoodsAction(tenant.role, po.status, lines);

  return (
    <div className="space-y-6">
      <Link href="/purchase-orders" className={TEXT_LINK}>
        ← Purchase orders
      </Link>

      <PageHeader title={<span className="font-mono">{po.purchaseOrderNumber}</span>} description={po.vendorName} badge={<PurchaseOrderStatusBadge status={po.status} />} actions={<>
        {receive && (
          <Link href={`/purchase-orders/${po.id}/receive`} className={PRIMARY_LINK}>
            {receive.label}
          </Link>
        )}
        {canEdit && (
          <Link href={`/purchase-orders/${po.id}/edit`} className={SECONDARY_LINK}>
            Edit
          </Link>
        )}
        <PurchaseOrderStatusActions
          purchaseOrderId={po.id}
          purchaseOrderNumber={po.purchaseOrderNumber}
          status={po.status}
          actions={actions}
        />
        <Link href={`/purchase-orders/${po.id}/print`} className={SECONDARY_LINK}>
          Print
        </Link>
      </>} />
      <div className="document-layout">
        <div className="document-main">

          {po.status !== "draft" && (
            <p className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300">
              This purchase order is no longer a draft, so its content can&apos;t be changed.
            </p>
          )}

          <SectionCard title="Vendor">
            <div className="grid gap-4 text-sm sm:grid-cols-2">
              <div className="space-y-1 break-words">
                <p className="font-semibold">{po.vendorName}</p>
                {po.vendorCompanyName && <p className="text-muted">{po.vendorCompanyName}</p>}
                {po.vendorAddress && <p className="whitespace-pre-line text-muted">{po.vendorAddress}</p>}
              </div>
              <div className="space-y-1 break-words text-muted">
                {po.vendorPhone && <p>{po.vendorPhone}</p>}
                {po.vendorEmail && <p>{po.vendorEmail}</p>}
                {po.vendorTaxNumber && <p>Tax number: {po.vendorTaxNumber}</p>}
              </div>
            </div>
            <Link href={`/vendors/${po.vendorId}`} className={`mt-3 inline-block ${TEXT_LINK}`}>
              Open vendor record
            </Link>
          </SectionCard>
          {showsReceivingSummary(po.status) && (
            <>
              <ReceivingSummary lines={lines} />
              <ReceiptHistory items={receipts.items} total={receipts.total} purchaseOrderNumber={po.purchaseOrderNumber} />
            </>
          )}
          <DocumentItems items={po.items} currency={tenant.organization.currency} />
          <SectionCard title="Notes">
            <p className="mt-1 whitespace-pre-line break-words">
              {po.notes || <span className="text-zinc-400">—</span>}
            </p>
          </SectionCard>
        </div>
        <DocumentSummary>
          <MoneySummary rows={[{ label: "Subtotal", value: money(po.subtotal) }, { label: "Discount", value: money(po.discountTotal) }, { label: "Tax", value: money(po.taxTotal) }]} total={money(po.grandTotal)} title="Purchase order summary" />

          <SectionCard title="Document information"><MetadataList>
            <MetadataItem label="PO number">{po.purchaseOrderNumber}</MetadataItem>
            <MetadataItem label="Status">
              <PurchaseOrderStatusBadge status={po.status} />
            </MetadataItem>
            <MetadataItem label="Order date">{formatCalendarDate(po.orderDate)}</MetadataItem>
            <MetadataItem label="Expected delivery">
              {po.expectedDeliveryDate && formatCalendarDate(po.expectedDeliveryDate)}
            </MetadataItem>
            <MetadataItem label="Created">{formatDateTime(po.createdAt, tz)}</MetadataItem>
            <MetadataItem label="Last updated">{formatDateTime(po.updatedAt, tz)}</MetadataItem>
          </MetadataList></SectionCard>

        </DocumentSummary>
      </div>
    </div>
  );
}
