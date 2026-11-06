import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ error: "" }));
vi.mock("react", async (importOriginal) => ({
  ...await importOriginal<typeof import("react")>(),
  useActionState: () => [{ error: state.error }, vi.fn(), false],
}));
vi.mock("@/app/purchase-orders/actions", () => ({ setPurchaseOrderStatusAction: vi.fn() }));
vi.mock("@/app/invoices/actions", () => ({ setInvoiceStatusAction: vi.fn() }));
vi.mock("@/app/sales-orders/actions", () => ({ setSalesOrderStatusAction: vi.fn() }));
import { PurchaseOrderStatusActions } from "@/app/purchase-orders/_components/status-actions";
import { InvoiceStatusActions } from "@/app/invoices/_components/status-actions";
vi.mock("@/app/quotations/actions", () => ({ setQuotationStatusAction: vi.fn() }));
import { QuotationStatusActions } from "@/app/quotations/_components/status-actions";
import { SalesOrderStatusActions } from "@/app/sales-orders/_components/status-actions";

const panels = [
  () => h(QuotationStatusActions, { quotationId: "fixture", quotationNumber: "QT-1", status: "cancelled", actions: [] }),
  () => h(PurchaseOrderStatusActions, { purchaseOrderId: "fixture", purchaseOrderNumber: "PO-1", status: "cancelled", actions: [] }),
  () => h(InvoiceStatusActions, { invoiceId: "fixture", invoiceNumber: "INV-1", status: "cancelled", actions: [] }),
  () => h(SalesOrderStatusActions, { salesOrderId: "fixture", salesOrderNumber: "SO-1", status: "cancelled", actions: [] }),
];

describe("status feedback after a stale action refresh", () => {
  it.each(panels)("keeps safe action errors visible when the new status has no available actions", (panel) => {
    state.error = "This document changed. Reload its latest status.";
    const output = renderToStaticMarkup(panel());
    expect(output).toContain('role="alert"');
    expect(output).toContain(state.error);
    expect(output).toContain('aria-label="Status actions"');
  });
  it.each(panels)("omits an empty action card when there is no error", (panel) => {
    state.error = "";
    expect(renderToStaticMarkup(panel())).toBe("");
  });
});
