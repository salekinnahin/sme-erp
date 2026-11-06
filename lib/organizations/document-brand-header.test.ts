import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DocumentBrandHeader } from "@/app/_components/document-brand-header";
import type { OrganizationBranding } from "./branding";

type Branding = Pick<OrganizationBranding, "name" | "address" | "phone" | "email" | "taxNumber" | "logoUrl">;
const branding: Branding = {
  name: "Acme <Ltd>", address: "House 1\nDhaka", phone: "+880 1700", email: "hello@acme.test",
  taxNumber: "TIN-1", logoUrl: "https://storage.test/object/sign/organization-branding/x?token=a&b=c",
};

function render(overrides: Partial<Branding> = {}, meta = [{ label: "Date", value: "6 Nov 2026" }]) {
  return renderToStaticMarkup(
    createElement(DocumentBrandHeader, { branding: { ...branding, ...overrides }, title: "Quotation", number: "QT-000001", meta }),
  );
}

describe("DocumentBrandHeader", () => {
  it("shows the logo in a bounded, aspect-preserving box next to the organization details", () => {
    const html = render();
    expect(html).toContain('src="https://storage.test/object/sign/organization-branding/x?token=a&amp;b=c"');
    expect(html).toContain('alt="Acme &lt;Ltd&gt; logo"');
    expect(html).toMatch(/class="flex h-16 w-40 shrink-0[^"]*"/);
    expect(html).toContain("max-h-full max-w-full object-contain");
    expect(html.indexOf("<img")).toBeLessThan(html.indexOf("Acme &lt;Ltd&gt;</p>"));
  });

  it("falls back to the text-only letterhead without a logo", () => {
    const html = render({ logoUrl: null });
    expect(html).not.toContain("<img");
    expect(html).not.toContain("document-logo");
    expect(html).toContain("Acme &lt;Ltd&gt;");
    expect(html).toContain("Tax number: TIN-1");
  });

  it("renders the document type, number and metadata, and omits empty contact fields", () => {
    const html = render(
      { phone: null, email: "hello@acme.test", address: null, taxNumber: null },
      [{ label: "Status", value: "Draft" }, { label: "Quotation", value: "QT-000009", mono: true } as never],
    );
    expect(html).toContain("<h1");
    expect(html).toContain(">Quotation</h1>");
    expect(html).toContain("QT-000001");
    expect(html).toContain("<dt class=\"text-zinc-600\">Status</dt><dd>Draft</dd>");
    expect(html).toContain('<dd class="font-mono">QT-000009</dd>');
    expect(html).toContain("<p>hello@acme.test</p>");
    expect(html).not.toContain("Tax number");
    expect(html).not.toContain(" · ");
  });

  it("joins phone and email on one line", () => {
    expect(render()).toContain("<p>+880 1700 · hello@acme.test</p>");
  });
});

// Print pages are async Server Components (no render harness here), so these
// check their wiring: live branding goes only to the shared header, and every
// document value still comes from the document's own snapshot.
const PRINT_VIEWS = [
  {
    file: "app/quotations/[id]/print/page.tsx",
    loader: "getQuotation(tenant, id)",
    snapshot: ["quotation.quotationNumber", "quotation.customerName", "quotation.customerTaxNumber", "quotation.items.map", "quotation.grandTotal", "quotation.notes"],
  },
  {
    file: "app/sales-orders/[id]/print/page.tsx",
    loader: "getSalesOrder(tenant, id)",
    snapshot: ["order.salesOrderNumber", "order.customerName", "order.sourceQuotationNumber", "order.items.map", "order.grandTotal", "order.notes"],
  },
  {
    file: "app/invoices/[id]/print/page.tsx",
    loader: "getInvoice(tenant, id)",
    snapshot: [
      "invoice.invoiceNumber", "invoice.customerName", "invoice.customerTaxNumber", "invoice.sourceSalesOrderNumber",
      "invoice.items.map", "invoice.subtotal", "invoice.grandTotal", "invoice.amountPaid", "invoice.amountDue", "invoice.notes",
    ],
  },
  {
    file: "app/purchase-orders/[id]/print/page.tsx",
    loader: "getPurchaseOrder(tenant, id)",
    snapshot: [
      "po.purchaseOrderNumber", "po.vendorName", "po.vendorTaxNumber", "po.orderDate", "po.expectedDeliveryDate",
      "po.items.map", "po.subtotal", "po.grandTotal", "po.notes",
    ],
  },
];

describe("print views", () => {
  it.each(PRINT_VIEWS)("$file passes current organization branding to the shared header", ({ file }) => {
    const source = readFileSync(file, "utf8");
    expect(source).toContain("const branding = await getOrganizationBranding(tenant);");
    expect(source.match(/<DocumentBrandHeader/g)).toHaveLength(1);
    expect(source).toContain("branding={branding}");
    // No second, inline letterhead implementation.
    expect(source).not.toContain("getOrganizationDetails");
    expect(source).not.toMatch(/<header[\s>]/);
    expect(source).not.toMatch(/\borg\./);
  });

  it.each(PRINT_VIEWS)("$file keeps document values on the snapshot, not live master data", ({ file, loader, snapshot }) => {
    const source = readFileSync(file, "utf8");
    expect(source).toContain(loader);
    for (const field of snapshot) expect(source).toContain(field);
    expect(source).not.toMatch(/from "@\/lib\/(customers|vendors|products)\//);
    // Branding is used only as the header prop.
    expect(source.match(/\{branding\}/g)).toHaveLength(1);
    expect(source).not.toMatch(/\bbranding\.\w/);
  });
});
