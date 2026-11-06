import { PageHeader, SectionCard, MetadataList, MetadataItem, MoneySummary, DocumentSummary, PageSkeleton } from "@/app/_components/ui";
import { DocumentItems } from "@/app/_components/document-items";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { requireTenant } from "@/lib/tenancy/context";
import { getQuotation } from "@/lib/quotations/quotations";
import { canEditQuotation } from "@/lib/quotations/permissions";
import { quotationStatusActions } from "@/lib/quotations/status-actions";
import { formatCalendarDate, formatDateTime, formatMoney } from "@/lib/format";
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
    <Suspense fallback={<PageSkeleton label="Loading…" />}>
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

      <PageHeader title={<span className="font-mono">{quotation.quotationNumber}</span>} description={quotation.customerName} badge={<QuotationStatusBadge status={quotation.status} />} actions={<>
        {canEdit && (
          <Link href={`/quotations/${quotation.id}/edit`} className={SECONDARY_LINK}>
            Edit
          </Link>
        )}
        <QuotationStatusActions
          quotationId={quotation.id}
          quotationNumber={quotation.quotationNumber}
          status={quotation.status}
          actions={actions}
        />
        <Link href={`/quotations/${quotation.id}/print`} className={SECONDARY_LINK}>
          Print
        </Link>
      </>} />
      <div className="document-layout">
        <div className="document-main">

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

          <SectionCard title="Customer">
            <div className="grid gap-4 text-sm sm:grid-cols-2">
              <div className="space-y-1 break-words">
                <p className="font-semibold">{quotation.customerName}</p>
                {quotation.customerCompanyName && <p className="text-muted">{quotation.customerCompanyName}</p>}
                {quotation.customerAddress && <p className="whitespace-pre-line text-muted">{quotation.customerAddress}</p>}
              </div>
              <div className="space-y-1 break-words text-muted">
                {quotation.customerPhone && <p>{quotation.customerPhone}</p>}
                {quotation.customerEmail && <p>{quotation.customerEmail}</p>}
                {quotation.customerTaxNumber && <p>Tax number: {quotation.customerTaxNumber}</p>}
              </div>
            </div>
            <Link href={`/customers/${quotation.customerId}`} className={`mt-3 inline-block ${TEXT_LINK}`}>
              Open customer record
            </Link>
          </SectionCard>
          <DocumentItems items={quotation.items} currency={tenant.organization.currency} />
          <SectionCard title="Notes">
            <p className="mt-1 whitespace-pre-line break-words">
              {quotation.notes || <span className="text-zinc-400">—</span>}
            </p>
          </SectionCard>
        </div>
        <DocumentSummary>
          <MoneySummary rows={[{ label: "Subtotal", value: money(quotation.subtotal) }, { label: "Discount", value: money(quotation.discountTotal) }, { label: "Tax", value: money(quotation.taxTotal) }]} total={money(quotation.grandTotal)} title="Quotation summary" />

          <SectionCard title="Document information"><MetadataList>
            <MetadataItem label="Quotation number">{quotation.quotationNumber}</MetadataItem>
            <MetadataItem label="Status">
              <QuotationStatusBadge status={quotation.status} />
            </MetadataItem>
            <MetadataItem label="Quotation date">{formatCalendarDate(quotation.quotationDate)}</MetadataItem>
            <MetadataItem label="Expiry date">
              {quotation.expiryDate && formatCalendarDate(quotation.expiryDate)}
            </MetadataItem>
            <MetadataItem label="Created">{formatDateTime(quotation.createdAt, tenant.organization.timezone)}</MetadataItem>
            <MetadataItem label="Last updated">{formatDateTime(quotation.updatedAt, tenant.organization.timezone)}</MetadataItem>
          </MetadataList></SectionCard>

        </DocumentSummary>
      </div>
    </div>
  );
}
