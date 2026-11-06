import { QUOTATION_TONES } from "@/lib/ui/status";
import { Badge } from "@/app/_components/status-badge";
import { QUOTATION_STATUS_LABELS, type QuotationStatus } from "@/lib/quotations/validation";



export function QuotationStatusBadge({ status }: { status: QuotationStatus }) {
  return <Badge tone={QUOTATION_TONES[status]}>{QUOTATION_STATUS_LABELS[status]}</Badge>;
}
