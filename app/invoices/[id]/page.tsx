import { PageHeader, SectionCard, MetadataList, MetadataItem, MoneySummary, DocumentSummary, PageSkeleton } from "@/app/_components/ui";
import { DocumentItems } from "@/app/_components/document-items";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { requireTenant } from "@/lib/tenancy/context";
import { getInvoice } from "@/lib/invoices/invoices";
import { canEditInvoice } from "@/lib/invoices/permissions";
import { invoiceStatusActions } from "@/lib/invoices/status-actions";
import { formatCalendarDate, formatDateTime, formatMoney } from "@/lib/format";
import { SECONDARY_LINK, TEXT_LINK } from "@/app/_components/styles";
import { InvoiceStatusBadge } from "../_components/invoice-status-badge";
import { InvoiceStatusActions } from "../_components/status-actions";

export const metadata: Metadata = { title: "Invoice · SME ERP" };

export default function InvoicePage({ params }: PageProps<"/invoices/[id]">) {
  return (
    <Suspense fallback={<PageSkeleton label="Loading…" />}>
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

      <PageHeader title={<span className="font-mono">{invoice.invoiceNumber}</span>} description={invoice.customerName} badge={<InvoiceStatusBadge status={invoice.status} />} actions={<>
        {canEdit && (
          <Link href={`/invoices/${invoice.id}/edit`} className={SECONDARY_LINK}>
            Edit
          </Link>
        )}
        <InvoiceStatusActions
          invoiceId={invoice.id}
          invoiceNumber={invoice.invoiceNumber}
          status={invoice.status}
          actions={actions}
        />
        <Link href={`/invoices/${invoice.id}/print`} className={SECONDARY_LINK}>
          Print
        </Link>
      </>} />
      <div className="document-layout">
        <div className="document-main">

          {invoice.status !== "draft" && (
            <p className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300">
              This invoice is no longer a draft, so its content can&apos;t be changed.
            </p>
          )}

          <SectionCard title="Customer">
            <div className="grid gap-4 text-sm sm:grid-cols-2">
              <div className="space-y-1 break-words">
                <p className="font-semibold">{invoice.customerName}</p>
                {invoice.customerCompanyName && <p className="text-muted">{invoice.customerCompanyName}</p>}
                {invoice.customerAddress && <p className="whitespace-pre-line text-muted">{invoice.customerAddress}</p>}
              </div>
              <div className="space-y-1 break-words text-muted">
                {invoice.customerPhone && <p>{invoice.customerPhone}</p>}
                {invoice.customerEmail && <p>{invoice.customerEmail}</p>}
                {invoice.customerTaxNumber && <p>Tax number: {invoice.customerTaxNumber}</p>}
              </div>
            </div>
            <Link href={`/customers/${invoice.customerId}`} className={`mt-3 inline-block ${TEXT_LINK}`}>
              Open customer record
            </Link>
          </SectionCard>
          <DocumentItems items={invoice.items} currency={tenant.organization.currency} />
          <SectionCard title="Notes">
            <p className="mt-1 whitespace-pre-line break-words">
              {invoice.notes || <span className="text-zinc-400">—</span>}
            </p>
          </SectionCard>
        </div>
        <DocumentSummary>
          <MoneySummary rows={[{ label: "Subtotal", value: money(invoice.subtotal) }, { label: "Discount", value: money(invoice.discountTotal) }, { label: "Tax", value: money(invoice.taxTotal) }]} total={money(invoice.grandTotal)} title="Invoice summary" />
          <SectionCard title="Balance"><dl className="space-y-3"><div className="money-row"><dt>Amount paid</dt><dd>{money(invoice.amountPaid)}</dd></div><div className="money-row font-semibold"><dt>Outstanding</dt><dd>{money(invoice.amountDue)}</dd></div></dl></SectionCard>

          <SectionCard title="Document information"><MetadataList>
            <MetadataItem label="Invoice number">{invoice.invoiceNumber}</MetadataItem>
            <MetadataItem label="Status">
              <InvoiceStatusBadge status={invoice.status} />
            </MetadataItem>
            <MetadataItem label="Invoice date">{formatCalendarDate(invoice.invoiceDate)}</MetadataItem>
            <MetadataItem label="Due date">
              {invoice.dueDate && formatCalendarDate(invoice.dueDate)}
            </MetadataItem>
            <MetadataItem label="Source">
              {invoice.sourceSalesOrderId ? (
                <Link href={`/sales-orders/${invoice.sourceSalesOrderId}`} className={TEXT_LINK}>
                  Sales order {invoice.sourceSalesOrderNumber ?? ""}
                </Link>
              ) : (
                "Created directly"
              )}
            </MetadataItem>
            <MetadataItem label="Created">{formatDateTime(invoice.createdAt, tz)}</MetadataItem>
            <MetadataItem label="Last updated">{formatDateTime(invoice.updatedAt, tz)}</MetadataItem>
          </MetadataList></SectionCard>

        </DocumentSummary>
      </div>
    </div>
  );
}
