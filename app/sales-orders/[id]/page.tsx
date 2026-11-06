import { PageHeader, SectionCard, MetadataList, MetadataItem, MoneySummary, DocumentSummary, PageSkeleton } from "@/app/_components/ui";
import { DocumentItems } from "@/app/_components/document-items";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { requireTenant } from "@/lib/tenancy/context";
import { getSalesOrder } from "@/lib/sales-orders/sales-orders";
import { canEditSalesOrder } from "@/lib/sales-orders/permissions";
import { salesOrderStatusActions } from "@/lib/sales-orders/status-actions";
import { formatCalendarDate, formatDateTime, formatMoney } from "@/lib/format";
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
    <Suspense fallback={<PageSkeleton label="Loading…" />}>
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

      <PageHeader title={<span className="font-mono">{order.salesOrderNumber}</span>} description={order.customerName} badge={<SalesOrderStatusBadge status={order.status} />} actions={<>
        {canEdit && (
          <Link href={`/sales-orders/${order.id}/edit`} className={SECONDARY_LINK}>
            Edit
          </Link>
        )}
        <ConvertSalesOrder
          compact
          action={convertSalesOrderAction.bind(null, order.id)}
          view={conversion}
          today={todayInTimeZone(tenant.organization.timezone)}
        />
        <SalesOrderStatusActions
          salesOrderId={order.id}
          salesOrderNumber={order.salesOrderNumber}
          status={order.status}
          actions={actions}
        />
        <Link href={`/sales-orders/${order.id}/print`} className={SECONDARY_LINK}>
          Print
        </Link>
      </>} />
      <div className="document-layout">
        <div className="document-main">

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

          <SectionCard title="Customer">
            <div className="grid gap-4 text-sm sm:grid-cols-2">
              <div className="space-y-1 break-words">
                <p className="font-semibold">{order.customerName}</p>
                {order.customerCompanyName && <p className="text-muted">{order.customerCompanyName}</p>}
                {order.customerAddress && <p className="whitespace-pre-line text-muted">{order.customerAddress}</p>}
              </div>
              <div className="space-y-1 break-words text-muted">
                {order.customerPhone && <p>{order.customerPhone}</p>}
                {order.customerEmail && <p>{order.customerEmail}</p>}
                {order.customerTaxNumber && <p>Tax number: {order.customerTaxNumber}</p>}
              </div>
            </div>
            <Link href={`/customers/${order.customerId}`} className={`mt-3 inline-block ${TEXT_LINK}`}>
              Open customer record
            </Link>
          </SectionCard>
          <DocumentItems items={order.items} currency={tenant.organization.currency} />
          <SectionCard title="Notes">
            <p className="mt-1 whitespace-pre-line break-words">
              {order.notes || <span className="text-zinc-400">—</span>}
            </p>
          </SectionCard>
        </div>
        <DocumentSummary>
          <MoneySummary rows={[{ label: "Subtotal", value: money(order.subtotal) }, { label: "Discount", value: money(order.discountTotal) }, { label: "Tax", value: money(order.taxTotal) }]} total={money(order.grandTotal)} title="Sales order summary" />

          <SectionCard title="Document information"><MetadataList>
            <MetadataItem label="Sales order number">{order.salesOrderNumber}</MetadataItem>
            <MetadataItem label="Status">
              <SalesOrderStatusBadge status={order.status} />
            </MetadataItem>
            <MetadataItem label="Order date">{formatCalendarDate(order.orderDate)}</MetadataItem>
            <MetadataItem label="Expected delivery">
              {order.expectedDeliveryDate && formatCalendarDate(order.expectedDeliveryDate)}
            </MetadataItem>
            <MetadataItem label="Source">
              {order.sourceQuotationId ? (
                <Link href={`/quotations/${order.sourceQuotationId}`} className={TEXT_LINK}>
                  Quotation {order.sourceQuotationNumber ?? ""}
                </Link>
              ) : (
                "Created directly"
              )}
            </MetadataItem>
            <MetadataItem label="Created">{formatDateTime(order.createdAt, tz)}</MetadataItem>
            <MetadataItem label="Last updated">{formatDateTime(order.updatedAt, tz)}</MetadataItem>
          </MetadataList></SectionCard>

        </DocumentSummary>
      </div>
    </div>
  );
}
