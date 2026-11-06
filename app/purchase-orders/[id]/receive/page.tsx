import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { DocumentSummary, EmptyState, MetadataItem, MetadataList, PageHeader, PageSkeleton, SectionCard } from "@/app/_components/ui";
import { SECONDARY_LINK, TEXT_LINK } from "@/app/_components/styles";
import { requireTenant } from "@/lib/tenancy/context";
import { getPurchaseOrder } from "@/lib/purchase-orders/purchase-orders";
import { getPurchaseOrderReceivingSummary } from "@/lib/goods-receipts/goods-receipts";
import { canGoodsReceipt } from "@/lib/goods-receipts/permissions";
import { RECEIVING_AVAILABILITY_MESSAGES, receivingAvailability } from "@/lib/goods-receipts/receiving";
import { todayInTimeZone } from "@/lib/quotations/form";
import { formatCalendarDate } from "@/lib/format";
import { recordGoodsReceiptAction } from "@/app/goods-receipts/actions";
import { ReceiveGoodsForm } from "@/app/goods-receipts/_components/receive-goods-form";
import { PurchaseOrderStatusBadge } from "../../_components/purchase-order-status-badge";

export const metadata: Metadata = { title: "Receive goods · SME ERP" };

export default function ReceiveGoodsPage({ params }: PageProps<"/purchase-orders/[id]/receive">) {
  return (
    <Suspense fallback={<PageSkeleton label="Loading…" />}>
      <ReceiveGoods params={params} />
    </Suspense>
  );
}

async function ReceiveGoods({ params }: Pick<PageProps<"/purchase-orders/[id]/receive">, "params">) {
  const { id } = await params;
  const tenant = await requireTenant();
  if (!canGoodsReceipt(tenant.role, "create")) redirect(`/purchase-orders/${encodeURIComponent(id)}`);
  // Null for malformed, unknown and other organizations' IDs alike.
  const [po, lines] = await Promise.all([getPurchaseOrder(tenant, id), getPurchaseOrderReceivingSummary(tenant, id)]);
  if (!po) notFound();

  const availability = receivingAvailability(po.status, lines);
  const poHref = `/purchase-orders/${po.id}`;

  return (
    <div className="space-y-6">
      <Link href={poHref} className={TEXT_LINK}>← {po.purchaseOrderNumber}</Link>
      <PageHeader
        title="Receive goods"
        description={<><span className="font-mono">{po.purchaseOrderNumber}</span> · {po.vendorName}</>}
        badge={<PurchaseOrderStatusBadge status={po.status} />}
        actions={<Link href={poHref} className={SECONDARY_LINK}>View purchase order</Link>}
      />
      <div className="document-layout">
        <div className="document-main">
          {availability === "open" ? (
            <ReceiveGoodsForm
              action={recordGoodsReceiptAction.bind(null, po.id)}
              lines={lines}
              orderDate={po.orderDate}
              defaultReceivedDate={todayInTimeZone(tenant.organization.timezone)}
              cancelHref={poHref}
            />
          ) : (
            <SectionCard>
              <EmptyState title="Nothing to receive" description={RECEIVING_AVAILABILITY_MESSAGES[availability]}>
                <Link href={poHref} className={TEXT_LINK}>Back to purchase order</Link>
              </EmptyState>
            </SectionCard>
          )}
        </div>
        <DocumentSummary>
          <SectionCard title="Purchase order">
            <MetadataList>
              <MetadataItem label="PO number"><Link href={poHref} className="font-mono">{po.purchaseOrderNumber}</Link></MetadataItem>
              <MetadataItem label="Status"><PurchaseOrderStatusBadge status={po.status} /></MetadataItem>
              <MetadataItem label="Vendor" wide>
                <span className="block">{po.vendorName}</span>
                {po.vendorCompanyName && <span className="block text-muted">{po.vendorCompanyName}</span>}
              </MetadataItem>
              <MetadataItem label="Order date">{formatCalendarDate(po.orderDate)}</MetadataItem>
              <MetadataItem label="Expected delivery">{po.expectedDeliveryDate && formatCalendarDate(po.expectedDeliveryDate)}</MetadataItem>
            </MetadataList>
          </SectionCard>
        </DocumentSummary>
      </div>
    </div>
  );
}
