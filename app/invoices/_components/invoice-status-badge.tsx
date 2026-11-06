import { INVOICE_TONES } from "@/lib/ui/status";
import { Badge } from "@/app/_components/status-badge";
import { INVOICE_STATUS_LABELS, type InvoiceStatus } from "@/lib/invoices/validation";



export function InvoiceStatusBadge({ status }: { status: InvoiceStatus }) {
  return <Badge tone={INVOICE_TONES[status]}>{INVOICE_STATUS_LABELS[status]}</Badge>;
}
