import { Badge, type BadgeTone } from "@/app/_components/status-badge";
import { INVOICE_STATUS_LABELS, type InvoiceStatus } from "@/lib/invoices/validation";

const TONES: Record<InvoiceStatus, BadgeTone> = {
  draft: "zinc",
  issued: "blue",
  partially_paid: "amber",
  paid: "green",
  cancelled: "red",
};

export function InvoiceStatusBadge({ status }: { status: InvoiceStatus }) {
  return <Badge tone={TONES[status]}>{INVOICE_STATUS_LABELS[status]}</Badge>;
}
