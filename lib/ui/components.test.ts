import { createElement as h } from "react";
import { renderToStaticMarkup as render } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AppFrame } from "@/app/_components/app-frame";
import { AppSidebar } from "@/app/_components/app-sidebar";
import { OrganizationAvatar } from "@/app/_components/organization-avatar";
import { AppTopbar } from "@/app/_components/app-topbar";
import { ConfirmDialog } from "@/app/_components/confirm-dialog";
import { MoneySummary, DataTable, EmptyState } from "@/app/_components/ui";
import { QuotationStatusBadge } from "@/app/quotations/_components/quotation-status-badge";
import { SalesOrderStatusBadge } from "@/app/sales-orders/_components/sales-order-status-badge";
import { InvoiceStatusBadge } from "@/app/invoices/_components/invoice-status-badge";
import { PurchaseOrderStatusBadge } from "@/app/purchase-orders/_components/purchase-order-status-badge";
import { QUOTATION_STATUS_LABELS } from "@/lib/quotations/validation";
import { SALES_ORDER_STATUS_LABELS } from "@/lib/sales-orders/validation";
import { INVOICE_STATUS_LABELS } from "@/lib/invoices/validation";
import { PURCHASE_ORDER_STATUS_LABELS } from "@/lib/purchase-orders/validation";
import { QUOTATION_TONES, SALES_ORDER_TONES, INVOICE_TONES, PURCHASE_ORDER_TONES } from "./status";

const route = vi.hoisted(() => ({ pathname: "/purchase-orders" }));
vi.mock("next/navigation", () => ({ usePathname: () => route.pathname }));
const identity = { organizationName: "Northstar Trading", logoUrl: null, email: "operator@example.test", role: "employee" };

describe("workspace rendering", () => {
  it("renders one active module in a sidebar, including detail routes", () => {
    const html = render(h(AppSidebar, { pathname: "/purchase-orders/abc/edit", identity, signOutControl: null }));
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
    expect(html).toMatch(/<a(?=[^>]*href="\/purchase-orders")(?=[^>]*aria-current="page")[^>]*>/);
    expect(html).toContain("Northstar Trading");
    expect(html).toContain("employee");
    expect(html).not.toContain("/rentals");
  });
  it("provides a labelled native mobile dialog and content skip target", () => {
    route.pathname = "/invoices";
    const html = render(h(AppFrame, { identity, signOutControl: null, children: h("p", null, "Content") }));
    expect(html).toContain('<dialog id="mobile-navigation" aria-label="Workspace navigation"');
    expect(html).toContain('aria-controls="mobile-navigation"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('aria-label="Close navigation"');
    expect(html).toContain('href="#main-content"');
    expect(html).toContain('id="main-content"');
    // Goods receipts is a real route now (Part 2); still no dead Rental links.
    expect(html).toContain('href="/goods-receipts"');
    expect(html).not.toContain("/rentals");
  });
  it("exposes the expanded menu state on its trigger", () => {
    const html = render(h(AppTopbar, { identity, section: "Invoices", menuOpen: true, onOpenMenu: () => {} }));
    expect(html).toContain('aria-expanded="true"');
  });
  it.each(["quotations", "sales-orders", "invoices", "purchase-orders", "goods-receipts"])("renders %s print children with no sidebar, topbar, drawer or page padding", (module) => {
    route.pathname = `/${module}/abc/print`;
    expect(render(h(AppFrame, { identity, signOutControl: h("button", null, "Log out"), children: h("article", null, "Business document") }))).toBe('<div class="document-print-frame"><article>Business document</article></div>');
  });
  it("uses initials for missing logos and a bounded decorative image for signed URLs", () => {
    expect(render(h(OrganizationAvatar, { name: identity.organizationName, logoUrl: null }))).toContain("NT");
    const html = render(h(OrganizationAvatar, { name: identity.organizationName, logoUrl: "https://storage.example.test/signed-logo" }));
    expect(html).toContain('class="organization-avatar"');
    expect(html).toContain('alt=""');
    expect(html).toContain('src="https://storage.example.test/signed-logo"');
  });
});

describe("shared presentation", () => {
  it("renders authoritative formatted values without recalculating them", () => {
    const html = render(h(MoneySummary, { rows: [{ label: "Subtotal", value: "BDT 10.00" }, { label: "Tax", value: "BDT 2.00" }], total: "BDT 99.99" }));
    expect(html).toContain("BDT 99.99");
    expect(html).not.toContain("BDT 12.00");
    expect(render(h(MoneySummary, { rows: [{ label: "Subtotal", value: null }], total: null }))).toContain("—");
  });
  it("labels keyboard-focusable overflowing table regions", () => {
    const html = render(h(DataTable, { label: "Purchase orders", children: h("table") }));
    expect(html).toContain('role="region" aria-label="Purchase orders" tabindex="0"');
  });
  it("keeps empty states compact and actionable", () => {
    const html = render(h(EmptyState, { title: "No orders yet", description: "Create a draft to start.", children: h("a", { href: "/purchase-orders/new" }, "New purchase order") }));
    expect(html).toContain("No orders yet");
    expect(html).toContain("Create a draft to start.");
    expect(html).toContain('href="/purchase-orders/new"');
  });
  it("associates confirmation title and description with a native alert dialog", () => {
    const html = render(h(ConfirmDialog, { title: "Cancel order", onClose: () => {}, description: h("p", { id: "confirmation-message" }, "Keep its history."), children: [h("div", { key: "error", role: "alert" }, "Safe error"), h("button", { key: "button" }, "Confirm")] }));
    expect(html).toMatch(/<dialog role="alertdialog" aria-labelledby="[^"]+" aria-describedby="[^"]+"/);
    expect(html).toContain("Cancel order");
    const id = html.match(/aria-describedby="([^"]+)"/)![1];
    const description = html.match(new RegExp(`<div id="${id}"[^>]*>([\\s\\S]*?)</div>`))![1];
    expect(description).toContain("Keep its history.");
    expect(description).not.toContain("button");
    expect(description).not.toContain("Safe error");
    expect(html).toContain('role="alert"');
  });
});

describe("status language", () => {
  it.each([
    [QuotationStatusBadge, QUOTATION_STATUS_LABELS, QUOTATION_TONES],
    [SalesOrderStatusBadge, SALES_ORDER_STATUS_LABELS, SALES_ORDER_TONES],
    [InvoiceStatusBadge, INVOICE_STATUS_LABELS, INVOICE_TONES],
    [PurchaseOrderStatusBadge, PURCHASE_ORDER_STATUS_LABELS, PURCHASE_ORDER_TONES],
  ] as const)("renders every module status with its label and visual tone", (Component, labels, tones) => {
    for (const [status, label] of Object.entries(labels)) {
      // The four renderers have different status unions; this table exercises their complete runtime allowlists.
      const html = render(h(Component as React.ComponentType<{ status: string }>, { status }));
      expect(html).toContain(`status-${(tones as Record<string, string>)[status]}`);
      expect(html).toContain(label);
    }
  });
  it("separates warning, success, information and neutral states", () => {
    expect(PURCHASE_ORDER_TONES).toEqual({ draft: "zinc", ordered: "blue", partially_received: "amber", received: "green", cancelled: "red" });
    expect(INVOICE_TONES.partially_paid).toBe("amber");
    expect(INVOICE_TONES.paid).toBe("green");
    expect(QUOTATION_TONES.expired).toBe("zinc");
  });
});
