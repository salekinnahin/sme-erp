import type { ReactNode } from "react";
import { Icon } from "./icon";

export function PageContainer({ children, narrow = false }: { children: ReactNode; narrow?: boolean }) {
  return <div className={`page-container ${narrow ? "page-container-narrow" : ""}`}>{children}</div>;
}
export function PageActions({ children }: { children: ReactNode }) {
  return <div className="page-actions">{children}</div>;
}
export function PageHeader({ title, description, actions, badge }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; badge?: ReactNode }) {
  return <header className="page-header">
    <div className="min-w-0">
      <div className="flex flex-wrap items-center gap-3">
        <h1>{title}</h1>{badge}</div>{description && <p className="page-description">{description}</p>}</div>{actions && <PageActions>{actions}</PageActions>}</header>;
}
export function SectionCard({ title, description, children, className = "" }: { title?: string; description?: string; children: ReactNode; className?: string }) {
  return <section className={`section-card ${className}`}>{title && <div className="section-heading">
    <h2>{title}</h2>{description && <p>{description}</p>}</div>}{children}</section>;
}
export function FormSection({ title, children, className = "" }: { title: string; children: ReactNode; className?: string }) {
  return <section className={`form-section ${className}`}>
    <h2 className="section-label">{title}</h2>
    <div className="space-y-4">{children}</div>
  </section>;
}
export function MetadataItem({ label, wide, children }: { label: string; wide?: boolean; children: ReactNode }) {
  return <div className={wide ? "sm:col-span-2" : undefined}>
    <dt className="metadata-label">{label}</dt>
    <dd className="metadata-value">{children || <span className="text-zinc-400">—</span>}</dd>
  </div>;
}
export function MetadataList({ children }: { children: ReactNode }) {
  return <dl className="metadata-list">{children}</dl>;
}
/** Receives formatted authoritative values; never calculates money. Null = incomplete preview. */
export function MoneySummary({ rows, total, footer, title = "Summary" }: {
  rows: { label: string; value: string | null }[];
  total: string | null;
  footer?: ReactNode;
  title?: string;
}) {
  return <section className="money-summary">
    <h2 className="section-label">{title}</h2>
    <dl className="space-y-3">{rows.map((row) => <div key={row.label} className="money-row">
      <dt>{row.label}</dt>
      <dd>{row.value ?? "—"}</dd>
    </div>)}<div className="money-row money-total">
        <dt>Grand total</dt>
        <dd>{total ?? "—"}</dd>
      </div>
    </dl>{footer}</section>;
}
export function DocumentSummary({ children }: { children: ReactNode }) {
  return <aside aria-label="Document summary" className="document-summary">{children}</aside>;
}
export function DataTable({ children, label }: { children: ReactNode; label: string }) {
  return <div className="data-table" role="region" aria-label={label} tabIndex={0}>{children}</div>;
}
export function FilterToolbar({ children }: { children: ReactNode }) {
  return <div className="filter-toolbar">{children}</div>;
}
export function EmptyState({ title, description, children }: { title?: string; description?: string; children?: ReactNode }) {
  return <div className="empty-state">
    <span className="empty-state-icon">
      <Icon name="empty" />
    </span>{title && <h2>{title}</h2>}{description && <p>{description}</p>}{children}</div>;
}
export function PageSkeleton({ label = "Loading workspace…" }: { label?: string }) {
  return <div role="status" aria-label={label} className="page-skeleton">
    <span className="sr-only">{label}</span>
    <div className="skeleton h-7 w-48" />
    <div className="skeleton h-4 w-64 max-w-full" />
    <div className="skeleton mt-8 h-16" />
    <div className="section-card mt-4 space-y-5">{[0, 1, 2, 3, 4].map((n) => <div key={n} className="skeleton h-5" />)}</div>
  </div>;
}
