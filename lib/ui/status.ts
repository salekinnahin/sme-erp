import type { QuotationStatus } from "@/lib/quotations/validation";
import type { SalesOrderStatus } from "@/lib/sales-orders/validation";
import type { InvoiceStatus } from "@/lib/invoices/validation";
import type { PurchaseOrderStatus } from "@/lib/purchase-orders/validation";

export type BadgeTone = "green" | "zinc" | "blue" | "amber" | "red";
export const RECORD_TONES = { active: "green", inactive: "zinc" } satisfies Record<string, BadgeTone>;
export const QUOTATION_TONES = { draft: "zinc", sent: "blue", accepted: "green", rejected: "red", expired: "zinc", cancelled: "zinc" } satisfies Record<QuotationStatus, BadgeTone>;
export const SALES_ORDER_TONES = { draft: "zinc", confirmed: "blue", completed: "green", cancelled: "red" } satisfies Record<SalesOrderStatus, BadgeTone>;
export const INVOICE_TONES = { draft: "zinc", issued: "blue", partially_paid: "amber", paid: "green", cancelled: "red" } satisfies Record<InvoiceStatus, BadgeTone>;
export const PURCHASE_ORDER_TONES = { draft: "zinc", ordered: "blue", partially_received: "amber", received: "green", cancelled: "red" } satisfies Record<PurchaseOrderStatus, BadgeTone>;
