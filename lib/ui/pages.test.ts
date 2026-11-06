import { createElement as h, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveServerTree } from "./testing/render";
import { quotationStatusActions } from "@/lib/quotations/status-actions";
import { salesOrderStatusActions } from "@/lib/sales-orders/status-actions";
import { invoiceStatusActions } from "@/lib/invoices/status-actions";
import { purchaseOrderStatusActions } from "@/lib/purchase-orders/status-actions";
import { QUOTATION_STATUS_LABELS, type QuotationStatus } from "@/lib/quotations/validation";
import { SALES_ORDER_STATUS_LABELS, type SalesOrderStatus } from "@/lib/sales-orders/validation";
import { INVOICE_STATUS_LABELS, type InvoiceStatus } from "@/lib/invoices/validation";
import { PURCHASE_ORDER_STATUS_LABELS, type PurchaseOrderStatus } from "@/lib/purchase-orders/validation";
import type { Role } from "@/lib/tenancy/context";
import * as fixture from "./testing/fixtures";

const mocks = vi.hoisted(() => ({ role: "owner", empty: false, list: vi.fn(), status: "draft", missing: false, hasInvoice: false }));
vi.mock("next/form", () => ({ default: ({ children, ...props }: { children?: ReactNode }) => h("form", props, children) }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NOT_FOUND"); }, redirect: (href: string) => { throw new Error(`REDIRECT:${href}`); } }));
vi.mock("@/app/_components/app-layout", () => ({ AppLayout: ({ children }: { children: ReactNode }) => children }));
vi.mock("@/lib/tenancy/context", () => ({ requireTenant: async () => ({ ...fixture.FIXTURE_TENANT, role: mocks.role }) }));
vi.mock("@/lib/organizations/branding", () => ({ getOrganizationBranding: async () => fixture.FIXTURE_BRANDING }));
vi.mock("@/app/settings/organization/actions", () => ({ uploadLogoAction: async () => ({}), removeLogoAction: async () => ({}) }));
vi.mock("@/lib/customers/customers", () => ({
  listCustomers: async (tenant: unknown, params: { page: number }) => { mocks.list(tenant, params); return { items: mocks.empty ? [] : [fixture.FIXTURE_CONTACT], total: mocks.empty ? 0 : 60, page: params.page, pageSize: 25 }; },
  getCustomer: async () => mocks.missing ? null : ({ ...fixture.FIXTURE_CONTACT, status: mocks.status }),
}));
vi.mock("@/app/customers/actions", () => ({ createCustomerAction: async () => ({}), updateCustomerAction: async () => ({}), setCustomerStatusAction: async () => ({}) }));
vi.mock("@/lib/vendors/vendors", () => ({
  listVendors: async (tenant: unknown, params: { page: number }) => { mocks.list(tenant, params); return { items: mocks.empty ? [] : [fixture.FIXTURE_CONTACT], total: mocks.empty ? 0 : 60, page: params.page, pageSize: 25 }; },
  getVendor: async () => mocks.missing ? null : ({ ...fixture.FIXTURE_CONTACT, status: mocks.status }),
}));
vi.mock("@/app/vendors/actions", () => ({ createVendorAction: async () => ({}), updateVendorAction: async () => ({}), setVendorStatusAction: async () => ({}) }));
vi.mock("@/lib/products/products", () => ({
  listProducts: async (tenant: unknown, params: { page: number }) => { mocks.list(tenant, params); return { items: mocks.empty ? [] : [fixture.FIXTURE_PRODUCT], total: mocks.empty ? 0 : 60, page: params.page, pageSize: 25 }; },
  getProduct: async () => mocks.missing ? null : ({ ...fixture.FIXTURE_PRODUCT, status: mocks.status }),
}));
vi.mock("@/app/products/actions", () => ({ createProductAction: async () => ({}), updateProductAction: async () => ({}), setProductStatusAction: async () => ({}) }));
vi.mock("@/lib/quotations/quotations", () => ({
  listQuotations: async (tenant: unknown, params: { page: number }) => { mocks.list(tenant, params); return { items: mocks.empty ? [] : [fixture.FIXTURE_QUOTATION], total: mocks.empty ? 0 : 60, page: params.page, pageSize: 25 }; },
  getQuotation: async () => mocks.missing ? null : ({ ...fixture.FIXTURE_QUOTATION, status: mocks.status }),
}));
vi.mock("@/app/quotations/actions", () => ({ createQuotationAction: async () => ({}), updateQuotationAction: async () => ({}), setQuotationStatusAction: async () => ({}), searchQuotationCustomersAction: async () => ({}), searchQuotationProductsAction: async () => ({}) }));
vi.mock("@/lib/sales-orders/sales-orders", () => ({
  listSalesOrders: async (tenant: unknown, params: { page: number }) => { mocks.list(tenant, params); return { items: mocks.empty ? [] : [fixture.FIXTURE_SALES_ORDER], total: mocks.empty ? 0 : 60, page: params.page, pageSize: 25 }; },
  getSalesOrder: async () => mocks.missing ? null : ({ ...fixture.FIXTURE_SALES_ORDER, status: mocks.status }), getSalesOrderForQuotation: async () => null,
}));
vi.mock("@/app/sales-orders/actions", () => ({ createSalesOrderAction: async () => ({}), updateSalesOrderAction: async () => ({}), setSalesOrderStatusAction: async () => ({}), searchSalesOrderCustomersAction: async () => ({}), searchSalesOrderProductsAction: async () => ({}), convertQuotationAction: async () => ({}) }));
vi.mock("@/lib/invoices/invoices", () => ({
  listInvoices: async (tenant: unknown, params: { page: number }) => { mocks.list(tenant, params); return { items: mocks.empty ? [] : [fixture.FIXTURE_INVOICE], total: mocks.empty ? 0 : 60, page: params.page, pageSize: 25 }; },
  getInvoice: async () => mocks.missing ? null : ({ ...fixture.FIXTURE_INVOICE, status: mocks.status }), getInvoiceForSalesOrder: async () => mocks.hasInvoice ? fixture.FIXTURE_INVOICE : null,
}));
vi.mock("@/app/invoices/actions", () => ({ createInvoiceAction: async () => ({}), updateInvoiceAction: async () => ({}), setInvoiceStatusAction: async () => ({}), searchInvoiceCustomersAction: async () => ({}), searchInvoiceProductsAction: async () => ({}), convertSalesOrderAction: async () => ({}) }));
vi.mock("@/lib/purchase-orders/purchase-orders", () => ({
  listPurchaseOrders: async (tenant: unknown, params: { page: number }) => { mocks.list(tenant, params); return { items: mocks.empty ? [] : [fixture.FIXTURE_PURCHASE_ORDER], total: mocks.empty ? 0 : 60, page: params.page, pageSize: 25 }; },
  getPurchaseOrder: async () => mocks.missing ? null : ({ ...fixture.FIXTURE_PURCHASE_ORDER, status: mocks.status }),
}));
vi.mock("@/lib/goods-receipts/goods-receipts", () => ({
  listGoodsReceipts: async (tenant: unknown, params: { page: number }) => { mocks.list(tenant, params); return { items: mocks.empty ? [] : [fixture.FIXTURE_GOODS_RECEIPT_ROW], total: mocks.empty ? 0 : 60, page: params.page, pageSize: 25 }; },
  getPurchaseOrderReceivingSummary: async () => [],
  listPurchaseOrderGoodsReceipts: async () => ({ items: [], total: 0, limit: 25 }),
}));
vi.mock("@/app/purchase-orders/actions", () => ({ createPurchaseOrderAction: async () => ({}), updatePurchaseOrderAction: async () => ({}), setPurchaseOrderStatusAction: async () => ({}), searchPurchaseOrderVendorsAction: async () => ({}), searchPurchaseOrderProductsAction: async () => ({}) }));
vi.mock("@/lib/quotations/options", () => ({ listCustomerOptions: async () => ({ options: [fixture.FIXTURE_CONTACT], truncated: false }), getCustomerOption: async () => fixture.FIXTURE_CONTACT, getProductOptions: async () => [fixture.FIXTURE_PRODUCT] }));
vi.mock("@/lib/purchase-orders/options", () => ({ listVendorFilterOptions: async () => ({ options: [fixture.FIXTURE_CONTACT], more: false }), getVendorOption: async () => fixture.FIXTURE_CONTACT, getPurchaseProductOptions: async () => [fixture.FIXTURE_PRODUCT] }));
vi.mock("@/lib/products/categories", () => ({ listCategories: async () => [], listCategoryOptions: async () => [] }));
import CustomerListPage from "@/app/customers/page";
import VendorListPage from "@/app/vendors/page";
import ProductListPage from "@/app/products/page";
import QuotationListPage from "@/app/quotations/page";
import QuotationDetailPage from "@/app/quotations/[id]/page";
import QuotationNewPage from "@/app/quotations/new/page";
import QuotationEditPage from "@/app/quotations/[id]/edit/page";
import QuotationPrintPage from "@/app/quotations/[id]/print/page";
import SalesOrderListPage from "@/app/sales-orders/page";
import SalesOrderDetailPage from "@/app/sales-orders/[id]/page";
import SalesOrderNewPage from "@/app/sales-orders/new/page";
import SalesOrderEditPage from "@/app/sales-orders/[id]/edit/page";
import SalesOrderPrintPage from "@/app/sales-orders/[id]/print/page";
import InvoiceListPage from "@/app/invoices/page";
import InvoiceDetailPage from "@/app/invoices/[id]/page";
import InvoiceNewPage from "@/app/invoices/new/page";
import InvoiceEditPage from "@/app/invoices/[id]/edit/page";
import InvoicePrintPage from "@/app/invoices/[id]/print/page";
import PurchaseOrderListPage from "@/app/purchase-orders/page";
import GoodsReceiptListPage from "@/app/goods-receipts/page";
import PurchaseOrderDetailPage from "@/app/purchase-orders/[id]/page";
import PurchaseOrderNewPage from "@/app/purchase-orders/new/page";
import PurchaseOrderEditPage from "@/app/purchase-orders/[id]/edit/page";
import PurchaseOrderPrintPage from "@/app/purchase-orders/[id]/print/page";
import OrganizationSettingsPage from "@/app/settings/organization/page";
async function html(tree: ReactNode) { return renderToStaticMarkup(await resolveServerTree(tree)); }
const params = () => ({ params: Promise.resolve({ id: fixture.FIXTURE_ID }), searchParams: Promise.resolve({}) });
beforeEach(() => { mocks.role = "owner"; mocks.empty = false; mocks.status = "draft"; mocks.missing = false; mocks.hasInvoice = false; mocks.list.mockClear(); });

const lists = [
  ["customers", CustomerListPage],
  ["vendors", VendorListPage],
  ["products", ProductListPage],
  ["quotations", QuotationListPage],
  ["sales-orders", SalesOrderListPage],
  ["invoices", InvoiceListPage],
  ["purchase-orders", PurchaseOrderListPage],
  ["goods-receipts", GoodsReceiptListPage],
 ] as const;
describe("migrated list pages", () => {
  it.each(lists)("%s preserves GET search parameters, active filters and pagination", async (module, Page) => {
    const output = await html(Page({ params: Promise.resolve({}), searchParams: Promise.resolve({ q: "Desk", status: "draft", page: "2", vendor: fixture.FIXTURE_ID, customer: fixture.FIXTURE_ID }) }));
    expect(output).toContain('class="page-header"');
    expect(output).toContain('class="filter-toolbar"');
    expect(output).toContain(`action="/${module}"`);
    expect(output).toContain('name="q"');
    expect(output).toContain('value="Desk"');
    expect(output).toContain('class="data-table"');
    expect(output).toContain('aria-label="Pagination"');
    expect(output).toContain('page=3');
    expect(output).toContain('q=Desk');
    expect(mocks.list.mock.calls[0][0]).toMatchObject({ organization: { id: fixture.FIXTURE_ID } });
    expect(mocks.list.mock.calls[0][1]).toMatchObject({ search: "Desk", page: 2 });
    if (module === "purchase-orders") expect(mocks.list.mock.calls[0][1]).toMatchObject({ status: "draft", vendor: fixture.FIXTURE_ID });
  });
  it.each(lists)("%s preserves filtered empty-state recovery", async (module, Page) => {
    mocks.empty = true;
    const output = await html(Page({ params: Promise.resolve({}), searchParams: Promise.resolve({ q: "nothing" }) }));
    expect(output).toContain('class="empty-state"');
    expect(output).toContain("Clear search and filters");
    expect(output).toContain(`href="/${module}"`);
  });
});
const documents = [
  ["quotations", QuotationDetailPage, QuotationNewPage, QuotationEditPage, QuotationPrintPage],
  ["sales-orders", SalesOrderDetailPage, SalesOrderNewPage, SalesOrderEditPage, SalesOrderPrintPage],
  ["invoices", InvoiceDetailPage, InvoiceNewPage, InvoiceEditPage, InvoicePrintPage],
  ["purchase-orders", PurchaseOrderDetailPage, PurchaseOrderNewPage, PurchaseOrderEditPage, PurchaseOrderPrintPage],
 ] as const;
describe("migrated document routes", () => {
  it.each(documents)("%s uses shared summaries, items and stored snapshots", async (_module, Page) => {
    const output = await html(Page(params()));
    expect(output).toContain('class="document-layout"');
    expect(output).toContain('aria-label="Document summary"');
    expect(output).toContain("Eastern Supply Co.");
    expect(output).toContain("Oak finish, 120 cm");
    expect(output).toContain("36,750");
    expect(output).toContain("Grand total");
    expect(output).toContain("Document information");
  });
  it.each(documents)("%s create and edit retain line input and preview controls", async (_module, _Detail, New, Edit) => {
    const newOutput = await html(New());
    const editOutput = await html(Edit(params()));
    for (const output of [newOutput, editOutput]) {
      expect(output).toContain('name="items"');
      expect(output).toContain('class="document-form space-y-5"');
      expect(output).toContain("Basic information");
      expect(output).toContain("Draft summary");
      expect(output).toContain('role="combobox"');
      expect(output).toContain('aria-label="Remove line 1"');
      expect(output).toContain("+ Add line");
    }
    expect(editOutput).toContain("Office desk");
    expect(editOutput).toContain("36,750");
  });
  it.each(documents)("%s print keeps document letterhead without workspace components", async (_module, _Detail, _New, _Edit, Print) => {
    const output = await html(Print(params()));
    expect(output).toContain("Northstar Trading");
    expect(output).toContain("36,750");
    expect(output).not.toContain("app-shell");
    expect(output).not.toContain("sidebar-nav");
    expect(output).not.toContain("app-topbar");
  });
  it.each(documents)("%s preserves missing/foreign document handling", async (_module, Page) => {
    mocks.missing = true;
    await expect(html(Page(params()))).rejects.toThrow("NOT_FOUND");
  });
  const matrices = [
    { module: "quotations", Page: QuotationDetailPage, statuses: Object.keys(QUOTATION_STATUS_LABELS), actions: (role: Role, status: string) => quotationStatusActions(role, status as QuotationStatus) },
    { module: "sales-orders", Page: SalesOrderDetailPage, statuses: Object.keys(SALES_ORDER_STATUS_LABELS), actions: (role: Role, status: string) => salesOrderStatusActions(role, status as SalesOrderStatus) },
    { module: "invoices", Page: InvoiceDetailPage, statuses: Object.keys(INVOICE_STATUS_LABELS), actions: (role: Role, status: string) => invoiceStatusActions(role, status as InvoiceStatus) },
    { module: "purchase-orders", Page: PurchaseOrderDetailPage, statuses: Object.keys(PURCHASE_ORDER_STATUS_LABELS), actions: (role: Role, status: string) => purchaseOrderStatusActions(role, status as PurchaseOrderStatus) },
  ];
  for (const { module, Page, statuses, actions } of matrices) {
    it.each(statuses.flatMap((status) => (["owner", "manager", "employee"] as const).map((role) => ({ status, role }))))(`${module} $role/$status keeps exactly the allowed actions in PageHeader`, async ({ role, status }) => {
      mocks.role = role;
      mocks.status = status;
      const output = await html(Page(params()));
      const header = output.match(/<header class="page-header">([\s\S]*?)<\/header>/)![1];
      const summary = output.match(/<aside aria-label="Document summary"[\s\S]*?<\/aside>/)![0];
      const group = header.match(/<div role="group" aria-label="Status actions"[\s\S]*?<\/div>/)?.[0] ?? "";
      const expected = actions(role, status);
      const buttons = [...group.matchAll(/<button[^>]*>([^<]*)<\/button>/g)].map((match) => match[1]);
      expect(buttons).toEqual(expected.map((action) => action.label));
      for (const action of expected) {
        expect(group).toContain(`ui-button-${action.tone === "danger" ? "danger" : action.tone}`);
      }
      expect(header.includes('/edit"')).toBe(status === "draft");
      expect(header).toContain(`/${module}/${fixture.FIXTURE_ID}/print`);
      expect(summary).not.toContain("document-status-actions");
      expect(summary).not.toContain("<button");
    });
  }
  it.each(["owner", "manager", "employee"])("keeps invoice conversion/view in the %s sales order header", async (role) => {
    mocks.role = role;
    mocks.status = "confirmed";
    const header = (await html(SalesOrderDetailPage(params()))).match(/<header class="page-header">([\s\S]*?)<\/header>/)![1];
    expect(header).toContain("Create invoice");
    mocks.hasInvoice = true;
    const converted = (await html(SalesOrderDetailPage(params()))).match(/<header class="page-header">([\s\S]*?)<\/header>/)![1];
    expect(converted).toContain("View invoice");
    expect(converted).not.toContain("Create invoice");
    expect(converted).not.toContain("Cancel sales order");
    expect(converted.includes("Mark completed")).toBe(role !== "employee");
  });
  it("keeps employee status actions role sensitive", async () => {
    mocks.role = "employee";
    for (const Page of [PurchaseOrderDetailPage, InvoiceDetailPage, SalesOrderDetailPage, QuotationDetailPage]) {
      const output = await html(Page(params()));
      expect(output).not.toMatch(/>Cancel(?: purchase order| invoice| sales order| quotation)?<\/button>/);
    }
    expect(await html(PurchaseOrderDetailPage(params()))).toContain("Mark ordered");
    expect(await html(InvoiceDetailPage(params()))).toContain("Issue");
    mocks.role = "manager";
    expect(await html(PurchaseOrderDetailPage(params()))).toMatch(/>Cancel purchase order<\/button>/);
  });
  it("redirects non-draft edits while preserving non-editable details", async () => {
    mocks.status = "ordered";
    await expect(html(PurchaseOrderEditPage(params()))).rejects.toThrow("REDIRECT:/purchase-orders/");
    const output = await html(PurchaseOrderDetailPage(params()));
    expect(output).not.toContain('/edit"');
    expect(output).toContain("no longer a draft");
  });
});
describe("organization settings", () => {
  it.each(["employee", "manager", "owner"])("preserves logo permissions for %s", async (role) => {
    mocks.role = role;
    const output = await html(OrganizationSettingsPage());
    expect(output).toContain("Organization settings");
    expect(output).toContain("Northstar Trading");
    if (role === "employee") {
      expect(output).toContain("Only owners and managers");
      expect(output).not.toContain('type="file"');
    } else expect(output).toContain('name="logo"');
  });
});
