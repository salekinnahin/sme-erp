import { Badge, type BadgeTone } from "@/app/_components/status-badge";
import { QUOTATION_STATUS_LABELS, type QuotationStatus } from "@/lib/quotations/validation";

const TONES: Record<QuotationStatus, BadgeTone> = {
  draft: "zinc",
  sent: "blue",
  accepted: "green",
  rejected: "red",
  expired: "amber",
  cancelled: "zinc",
};

export function QuotationStatusBadge({ status }: { status: QuotationStatus }) {
  return <Badge tone={TONES[status]}>{QUOTATION_STATUS_LABELS[status]}</Badge>;
}
