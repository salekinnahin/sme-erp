import { Badge, type BadgeTone } from "@/app/_components/status-badge";
import { PURCHASE_ORDER_STATUS_LABELS, type PurchaseOrderStatus } from "@/lib/purchase-orders/validation";

const TONES: Record<PurchaseOrderStatus, BadgeTone> = {
  draft: "zinc",
  ordered: "blue",
  partially_received: "amber",
  received: "green",
  cancelled: "red",
};

export function PurchaseOrderStatusBadge({ status }: { status: PurchaseOrderStatus }) {
  return <Badge tone={TONES[status]}>{PURCHASE_ORDER_STATUS_LABELS[status]}</Badge>;
}
