import type { Role } from "@/lib/tenancy/context";
import { canSalesOrder } from "./permissions";
import { quotationConversionBlocker } from "./validation";

/**
 * What the quotation detail page shows for converting to a sales order:
 *
 *   "view"    the quotation already has a sales order (link to it). Shown
 *             to every role that can view sales orders.
 *   "create"  accepted, not converted yet, and the role may convert.
 *   "hidden"  anything else (not accepted, or no permission).
 *
 * The page never converts on its own: create_sales_order_from_quotation()
 * re-checks status, tenant, membership and "once per quotation".
 */
export type ConversionView =
  | { kind: "hidden" }
  | { kind: "create" }
  | { kind: "view"; salesOrderId: string; salesOrderNumber: string };

export function quotationConversionView(
  role: Role,
  quotationStatus: string,
  existing: { id: string; salesOrderNumber: string } | null,
): ConversionView {
  if (existing && canSalesOrder(role, "view"))
    return { kind: "view", salesOrderId: existing.id, salesOrderNumber: existing.salesOrderNumber };
  if (existing) return { kind: "hidden" };
  if (quotationConversionBlocker(quotationStatus, false) !== null) return { kind: "hidden" };
  return canSalesOrder(role, "convertQuotation") ? { kind: "create" } : { kind: "hidden" };
}
