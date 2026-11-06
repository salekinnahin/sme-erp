import { renderToStaticMarkup } from "react-dom/server";
import { createElement as h, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveServerTree } from "./testing/render";
import * as fixture from "./testing/fixtures";
import type { ReceivingLine } from "@/lib/goods-receipts/calculations";
import { todayInTimeZone } from "@/lib/quotations/form";

const PO_ID = fixture.FIXTURE_ID;
const GR_ID = fixture.FIXTURE_GOODS_RECEIPT_ROW.id;
const OTHER_USER = "a1000000-0000-4000-8000-0000000000ff";
function line(id: string, name: string, ordered: string, received: string, remaining: string, product_type: ReceivingLine["product_type"] = "inventory"): ReceivingLine {
  return { purchase_order_item_id: id, product_id: id, product_name: name, sku: `SKU-${name.slice(0, 3)}`, description: null, unit: "drum",
    product_type, receivable: product_type !== "service" && product_type !== null, ordered_quantity: ordered, received_quantity: received, remaining_quantity: remaining, sort_order: 1 };
}
const LINES = {
  bitumen: line("a1000000-0000-4000-8000-0000000000b1", "Bitumen 80/100", "100.000", "40.000", "60.000"),
  drums: line("a1000000-0000-4000-8000-0000000000b2", "Drums", "50.000", "50.000", "0.000", "non_inventory"),
  transport: line("a1000000-0000-4000-8000-0000000000b3", "Transport Service", "1.000", "0.000", "1.000", "service"),
};
const RECEIPT = {
  id: GR_ID, organization_id: fixture.FIXTURE_ID, goods_receipt_number: "GR-000042", purchase_order_id: PO_ID, purchase_order_number: "PO-000128",
  received_date: "2026-11-07", notes: "Delivered by supplier truck", created_by: OTHER_USER, received_by_name: "Karim Ahmed", created_at: "2026-11-07T06:00:00Z", updated_at: "2026-11-07T06:00:00Z",
  items: [{ id: "i1", purchase_order_item_id: LINES.bitumen.purchase_order_item_id, product_id: "p", product_name: "Bitumen 80/100", sku: "BIT-80", description: null,
    unit: "drum", product_type: "inventory", ordered_quantity_snapshot: "100.000", received_quantity: "30.250", sort_order: 1, created_at: "2026-11-07T06:00:00Z" }],
  vendor: { name: "ABC Supplier", companyName: "ABC Holdings", phone: null, email: null, address: "Dhaka", taxNumber: null },
};

const mocks = vi.hoisted(() => ({
  role: "owner", status: "ordered", missing: false, lines: [] as unknown[],
  history: { items: [] as unknown[], total: 0, limit: 25 }, receipt: null as unknown,
}));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NOT_FOUND"); }, redirect: (href: string) => { throw new Error(`REDIRECT:${href}`); } }));
vi.mock("next/form", () => ({ default: ({ children, ...props }: { children?: ReactNode }) => h("form", props, children) }));
vi.mock("@/app/_components/app-layout", () => ({ AppLayout: ({ children }: { children: ReactNode }) => children }));
vi.mock("@/lib/tenancy/context", () => ({ requireTenant: async () => ({ ...fixture.FIXTURE_TENANT, role: mocks.role }) }));
vi.mock("@/lib/organizations/branding", () => ({ getOrganizationBranding: async () => fixture.FIXTURE_BRANDING }));
vi.mock("@/lib/purchase-orders/purchase-orders", () => ({
  getPurchaseOrder: async () => mocks.missing ? null : ({ ...fixture.FIXTURE_PURCHASE_ORDER, vendorName: "ABC Supplier", status: mocks.status }),
}));
vi.mock("@/lib/goods-receipts/goods-receipts", () => ({
  getPurchaseOrderReceivingSummary: async () => mocks.lines,
  listPurchaseOrderGoodsReceipts: async () => mocks.history,
  getGoodsReceiptDocument: async () => mocks.receipt,
  listGoodsReceipts: async () => ({ items: [fixture.FIXTURE_GOODS_RECEIPT_ROW], total: 1, page: 1, pageSize: 25 }),
}));
vi.mock("@/app/purchase-orders/actions", () => ({ setPurchaseOrderStatusAction: async () => ({}) }));
vi.mock("@/app/goods-receipts/actions", () => ({ recordGoodsReceiptAction: async () => ({}) }));
import PurchaseOrderDetailPage from "@/app/purchase-orders/[id]/page";
import ReceiveGoodsPage from "@/app/purchase-orders/[id]/receive/page";
import GoodsReceiptListPage from "@/app/goods-receipts/page";
import GoodsReceiptDetailPage from "@/app/goods-receipts/[id]/page";
import GoodsReceiptPrintPage from "@/app/goods-receipts/[id]/print/page";

async function html(tree: ReactNode) { return renderToStaticMarkup(await resolveServerTree(tree)); }
const props = (id: string, searchParams: Record<string, string> = {}) => ({ params: Promise.resolve({ id }), searchParams: Promise.resolve(searchParams) });
const header = (output: string) => output.match(/<header class="page-header">([\s\S]*?)<\/header>/)![1];
const STOCK_WORDING = /stock increased|inventory updated|available stock/i;
beforeEach(() => {
  mocks.role = "owner"; mocks.status = "ordered"; mocks.missing = false;
  mocks.lines = [LINES.bitumen, LINES.drums, LINES.transport];
  mocks.history = { items: [], total: 0, limit: 25 };
  mocks.receipt = RECEIPT;
});

describe("purchase order detail: receiving integration", () => {
  it.each(["owner", "manager", "employee"])("offers Receive goods to %s for an ordered PO", async (role) => {
    mocks.role = role;
    const head = header(await html(PurchaseOrderDetailPage(props(PO_ID))));
    expect(head).toContain(`href="/purchase-orders/${PO_ID}/receive"`);
    expect(head).toContain(">Receive goods<");
  });
  it("labels partially received POs Receive remaining goods", async () => {
    mocks.status = "partially_received";
    expect(header(await html(PurchaseOrderDetailPage(props(PO_ID))))).toContain(">Receive remaining goods<");
  });
  it.each(["draft", "received", "cancelled"])("hides receiving for %s", async (status) => {
    mocks.status = status;
    expect(await html(PurchaseOrderDetailPage(props(PO_ID)))).not.toContain("/receive\"");
  });
  it("hides receiving when nothing receivable remains (fully received + service lines)", async () => {
    mocks.status = "partially_received";
    mocks.lines = [LINES.drums, LINES.transport];
    expect(await html(PurchaseOrderDetailPage(props(PO_ID)))).not.toContain("/receive\"");
  });
  it("shows the per-line backend summary: ordered / received / remaining, services not received", async () => {
    const output = await html(PurchaseOrderDetailPage(props(PO_ID)));
    expect(output).toContain("Receiving");
    const summary = output.match(/aria-label="Receiving summary"[\s\S]*?<\/table>/)![0];
    expect(summary).toMatch(/Bitumen 80\/100[\s\S]*>100<[\s\S]*>40<[\s\S]*>60</);
    expect(summary).toMatch(/Drums[\s\S]*>50<[\s\S]*>50<[\s\S]*Received/);
    expect(summary).toMatch(/Transport Service[\s\S]*Service, not received[\s\S]*>—<[\s\S]*>—</);
  });
  it("omits the receiving section for drafts", async () => {
    mocks.status = "draft";
    expect(await html(PurchaseOrderDetailPage(props(PO_ID)))).not.toContain("Receiving summary");
  });
  it("shows a compact empty history, then linked receipts without per-row queries", async () => {
    expect(await html(PurchaseOrderDetailPage(props(PO_ID)))).toContain("No goods received yet");
    mocks.history = { items: [fixture.FIXTURE_GOODS_RECEIPT_ROW], total: 30, limit: 25 };
    const output = await html(PurchaseOrderDetailPage(props(PO_ID)));
    expect(output).toContain(`href="/goods-receipts/${GR_ID}"`);
    expect(output).toContain("GR-000042");
    expect(output).toContain("7 Nov 2026");
    expect(output).toContain("View all 30 goods receipts");
    const history = output.match(/aria-label="Goods receipt history"[\s\S]*?<\/table>/)![0];
    expect([...history.matchAll(/<th[^>]*>([^<]*)<\/th>/g)].map((m) => m[1])).toEqual(["GR number", "Received date", "Items", "Received by"]);
    expect(history).toMatch(/GR-000042[\s\S]*>3<[\s\S]*>Rahim Uddin</);
    expect(history).not.toMatch(/Total quantity|50\.5/);
    expect(output).toContain('href="/goods-receipts?q=PO-000128"');
  });
  it("hides Cancel once a receipt exists, keeps it otherwise", async () => {
    mocks.role = "manager";
    expect(header(await html(PurchaseOrderDetailPage(props(PO_ID))))).toMatch(/>Cancel purchase order<\/button>/);
    mocks.history = { items: [fixture.FIXTURE_GOODS_RECEIPT_ROW], total: 1, limit: 25 };
    expect(header(await html(PurchaseOrderDetailPage(props(PO_ID))))).not.toContain("Cancel purchase order");
  });
});

describe("receive page", () => {
  it("shows the PO context and a receiving table with inputs only for open lines", async () => {
    const output = await html(ReceiveGoodsPage(props(PO_ID)));
    expect(header(output)).toContain("Receive goods");
    expect(header(output)).toMatch(/PO-000128<\/span> · ABC Supplier/);
    expect(output).toContain("Expected delivery");
    expect(output.match(/aria-label="Receive now: [^"]*"/g)).toEqual(['aria-label="Receive now: Bitumen 80/100"']);
    expect(output).toContain("Fully received");
    expect(output).toContain("Not applicable for goods receiving");
    expect(output).toMatch(/Bitumen 80\/100[\s\S]*100\.000[\s\S]*40\.000[\s\S]*60\.000/);
    expect(output).toContain(">Record goods receipt<");
    expect(output).toContain('name="items" value="[]"');
    expect(output).not.toMatch(STOCK_WORDING);
  });
  it("defaults the received date to today in the organization time zone and enforces the order date", async () => {
    const output = await html(ReceiveGoodsPage(props(PO_ID)));
    expect(output).toContain(`value="${todayInTimeZone(fixture.FIXTURE_TENANT.organization.timezone)}"`);
    expect(output).toMatch(/type="date"[^>]*min="2026-11-06"/);
  });
  it("renders stacked mobile cards from the same single table (labelled cells, one input per line)", async () => {
    const output = await html(ReceiveGoodsPage(props(PO_ID)));
    expect(output).toContain('class="receiving-table');
    for (const label of ["Product", "Ordered", "Already received", "Remaining", "Receive now"]) expect(output).toContain(`data-label="${label}"`);
    expect(output.match(/inputMode="decimal"|inputmode="decimal"/gi)).toHaveLength(1);
  });
  it.each([
    ["received", [LINES.drums], "All receivable goods have already been received."],
    ["partially_received", [LINES.drums, LINES.transport], "All receivable goods have already been received."],
    ["draft", [LINES.bitumen], "Goods can only be received for ordered or partially received purchase orders."],
    ["cancelled", [LINES.bitumen], "Goods can only be received for ordered or partially received purchase orders."],
    ["ordered", [LINES.transport], "only service lines"],
  ])("shows no form for %s", async (status, lines, message) => {
    mocks.status = status;
    mocks.lines = lines;
    const output = await html(ReceiveGoodsPage(props(PO_ID)));
    expect(output).toContain(message);
    expect(output).not.toContain("Record goods receipt");
    expect(output).toContain(`href="/purchase-orders/${PO_ID}"`);
  });
  it("is not found for unknown or other tenants' POs", async () => {
    mocks.missing = true;
    await expect(html(ReceiveGoodsPage(props(PO_ID)))).rejects.toThrow("NOT_FOUND");
  });
});

describe("goods receipt list", () => {
  it("lists receipts with PO link, vendor, items and received by, without a New button", async () => {
    const output = await html(GoodsReceiptListPage({ params: Promise.resolve({}), searchParams: Promise.resolve({}) }));
    for (const column of ["GR number", "Purchase order", "Vendor", "Received date", "Items", "Received by", "Created"]) expect(output).toContain(`>${column}<`);
    expect(output).toContain(`href="/goods-receipts/${GR_ID}"`);
    expect(output).toContain(`href="/purchase-orders/${PO_ID}"`);
    expect(output).toContain(">Rahim Uddin<");
    expect(output).not.toMatch(/Another team member|>You<|Total quantity/);
    expect(output).not.toMatch(/goods-receipts\/new/);
  });
});

describe("goods receipt detail", () => {
  it("is read-only: header actions are exactly View purchase order and Print", async () => {
    for (const role of ["owner", "manager", "employee"]) {
      mocks.role = role;
      const head = header(await html(GoodsReceiptDetailPage(props(GR_ID))));
      const actions = [...head.matchAll(/<(a|button)[^>]*>([^<]*)<\/\1>/g)].map((m) => m[2]);
      expect(actions).toEqual(["View purchase order", "Print"]);
      expect(head).toContain(`href="/purchase-orders/${PO_ID}"`);
      expect(head).toContain(`href="/goods-receipts/${GR_ID}/print"`);
    }
  });
  it("shows receipt facts, exact quantities and no edit/delete/cancel", async () => {
    const output = await html(GoodsReceiptDetailPage(props(GR_ID)));
    for (const text of ["GR-000042", "PO-000128", "ABC Supplier", "Delivered by supplier truck", "100.000", "30.250", "BIT-80", "drum", "Received by", ">Karim Ahmed<"]) expect(output).toContain(text);
    expect(output).not.toMatch(/>(Edit|Delete|Cancel)[^<]*</);
    expect(output).not.toContain("Goods receipt recorded successfully.");
    expect(output).not.toMatch(STOCK_WORDING);
  });
  it("confirms a new receipt without stock wording", async () => {
    const output = await html(GoodsReceiptDetailPage(props(GR_ID, { recorded: "1" })));
    expect(output).toContain("Goods receipt recorded successfully.");
    expect(output).not.toMatch(STOCK_WORDING);
  });
  it("uses only the stored snapshot (no viewer-relative labels) and a placeholder when no name was recorded", async () => {
    const output = await html(GoodsReceiptDetailPage(props(GR_ID)));
    expect(output).not.toMatch(/Another team member|>You</);
    mocks.receipt = { ...RECEIPT, created_by: fixture.FIXTURE_ID, received_by_name: null };
    const unnamed = await html(GoodsReceiptDetailPage(props(GR_ID)));
    expect(unnamed).toContain("Name not recorded");
    expect(unnamed).not.toMatch(/>You<|owner@northstar\.example/);
  });
  it.each(["detail", "print"])("%s is not found for unknown, malformed or cross-tenant receipts", async (page) => {
    mocks.receipt = null;
    await expect(html((page === "detail" ? GoodsReceiptDetailPage : GoodsReceiptPrintPage)(props("not-a-uuid")))).rejects.toThrow("NOT_FOUND");
  });
});

describe("goods received note print", () => {
  it("uses the organization letterhead and lists receipt facts with signature placeholders", async () => {
    const output = await html(GoodsReceiptPrintPage(props(GR_ID)));
    expect(output).toContain("Northstar Trading");
    expect(output).toContain("18 Business Avenue");
    expect(output).toMatch(/<h1[^>]*>Goods Received Note<\/h1>/);
    expect(output).toMatch(/class="[^"]*uppercase[^"]*">Goods Received Note/);
    for (const text of ["GR-000042", "PO-000128", "ABC Supplier", "7 Nov 2026", "Ordered qty", "Received qty", "100.000", "30.250", "BIT-80", "Delivered by supplier truck", "Checked By", "Signature and date"]) expect(output).toContain(text);
    expect(output).toMatch(/Received By:<\/span> Karim Ahmed/);
    expect(output).toMatch(/Received by<\/dt><dd>Karim Ahmed</);
    expect(output).not.toMatch(/Another team member|>You</);
    expect(output).not.toContain("app-shell");
    expect(output).not.toContain("sidebar-nav");
    expect(output).not.toMatch(STOCK_WORDING);
  });
});
