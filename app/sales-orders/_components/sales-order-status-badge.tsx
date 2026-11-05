import { Badge, type BadgeTone } from "@/app/_components/status-badge";
import { SALES_ORDER_STATUS_LABELS, type SalesOrderStatus } from "@/lib/sales-orders/validation";

const TONES: Record<SalesOrderStatus, BadgeTone> = {
  draft: "zinc",
  confirmed: "blue",
  completed: "green",
  cancelled: "red",
};

export function SalesOrderStatusBadge({ status }: { status: SalesOrderStatus }) {
  return <Badge tone={TONES[status]}>{SALES_ORDER_STATUS_LABELS[status]}</Badge>;
}
