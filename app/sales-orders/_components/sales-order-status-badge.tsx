import { SALES_ORDER_TONES } from "@/lib/ui/status";
import { Badge } from "@/app/_components/status-badge";
import { SALES_ORDER_STATUS_LABELS, type SalesOrderStatus } from "@/lib/sales-orders/validation";



export function SalesOrderStatusBadge({ status }: { status: SalesOrderStatus }) {
  return <Badge tone={SALES_ORDER_TONES[status]}>{SALES_ORDER_STATUS_LABELS[status]}</Badge>;
}
