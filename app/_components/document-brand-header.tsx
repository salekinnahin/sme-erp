import type { ReactNode } from "react";
import type { OrganizationBranding } from "@/lib/organizations/branding";
import { DocumentLogo } from "./document-logo";

export type DocumentMetaItem = { label: string; value: ReactNode; mono?: boolean };

/**
 * Shared letterhead for printed business documents (quotations and sales
 * orders today; invoices, purchase orders and goods receipts can reuse it).
 * The organization part is live branding (DECISIONS 029); the document part
 * comes from the document's own snapshot, passed in by the page. Without a
 * logo it renders the text-only letterhead.
 */
export function DocumentBrandHeader({
  branding,
  title,
  number,
  meta,
}: {
  branding: Pick<OrganizationBranding, "name" | "address" | "phone" | "email" | "taxNumber" | "logoUrl">;
  /** Document type, e.g. "Quotation". */
  title: string;
  number: string;
  /** Secondary rows after the number (dates, status, references). */
  meta: DocumentMetaItem[];
}) {
  const contact = [branding.phone, branding.email].filter(Boolean).join(" · ");
  return (
    <header className="flex flex-wrap items-start justify-between gap-6 border-b border-zinc-300 pb-6">
      <div className="flex max-w-md min-w-0 flex-wrap items-start gap-4">
        {branding.logoUrl && <DocumentLogo src={branding.logoUrl} organizationName={branding.name} />}
        <div className="min-w-0 space-y-0.5 break-words">
          <p className="text-lg font-semibold">{branding.name}</p>
          {branding.address && <p className="whitespace-pre-line">{branding.address}</p>}
          {contact && <p>{contact}</p>}
          {branding.taxNumber && <p>Tax number: {branding.taxNumber}</p>}
        </div>
      </div>
      <div className="text-right">
        <h1 className="text-2xl font-semibold tracking-wide uppercase">{title}</h1>
        <dl className="mt-2 grid grid-cols-[auto_auto] justify-end gap-x-4 gap-y-0.5">
          <dt className="text-zinc-600">Number</dt>
          <dd className="font-mono font-medium">{number}</dd>
          {meta.map((item) => (
            <MetaRow key={item.label} item={item} />
          ))}
        </dl>
      </div>
    </header>
  );
}

function MetaRow({ item }: { item: DocumentMetaItem }) {
  return (
    <>
      <dt className="text-zinc-600">{item.label}</dt>
      <dd className={item.mono ? "font-mono" : undefined}>{item.value}</dd>
    </>
  );
}
