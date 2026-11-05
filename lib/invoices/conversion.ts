import type { Role } from "@/lib/tenancy/context";
import { canInvoice } from "./permissions";
import { salesOrderInvoiceBlocker } from "./validation";

/** Show an existing invoice in any status, or offer conversion of a confirmed order.
 * The database re-checks membership, status and the one-invoice-ever rule.
 */
export type ConversionView =
  | { kind: "hidden" }
  | { kind: "create" }
  | { kind: "view"; invoiceId: string; invoiceNumber: string };

export function salesOrderConversionView(
  role: Role,
  salesOrderStatus: string,
  existing: { id: string; invoiceNumber: string } | null,
): ConversionView {
  if (existing && canInvoice(role, "view"))
    return { kind: "view", invoiceId: existing.id, invoiceNumber: existing.invoiceNumber };
  if (existing) return { kind: "hidden" };
  if (salesOrderInvoiceBlocker(salesOrderStatus, false) !== null) return { kind: "hidden" };
  return canInvoice(role, "convertSalesOrder") ? { kind: "create" } : { kind: "hidden" };
}
