import { PURCHASE_ORDER_TONES } from "@/lib/ui/status";
import { Badge } from "@/app/_components/status-badge";
import { PURCHASE_ORDER_STATUS_LABELS, type PurchaseOrderStatus } from "@/lib/purchase-orders/validation";



export function PurchaseOrderStatusBadge({ status }: { status: PurchaseOrderStatus }) {
  return <Badge tone={PURCHASE_ORDER_TONES[status]}>{PURCHASE_ORDER_STATUS_LABELS[status]}</Badge>;
}
