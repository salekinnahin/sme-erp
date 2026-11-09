import { renderToStaticMarkup } from "react-dom/server";
import { createElement as h, type ReactNode } from "react";
import { existsSync, readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveServerTree } from "./testing/render";
import * as fixture from "./testing/fixtures";
import { toStockMovementSource } from "@/lib/inventory/movements";
import type { CurrentStockItem, InventoryPage as ReadPage, StockMovement } from "@/lib/inventory/types";

const BITUMEN = "a1000000-0000-4000-8000-0000000000c1";
const PAINT = "a1000000-0000-4000-8000-0000000000c2";
const SERVICE = "a1000000-0000-4000-8000-0000000000c3";
const GR_A = "a1000000-0000-4000-8000-0000000000d1";
const GR_B = "a1000000-0000-4000-8000-0000000000d2";

function stockItem(productId: string, productName: string, quantity: string, extra: Partial<CurrentStockItem> = {}): CurrentStockItem {
  return { productId, productName, sku: `SKU-${productName.slice(0, 3).toUpperCase()}`, unit: "drum", productType: "inventory",
    productStatus: "active", quantity, stockTracked: true, ...extra };
}
const ITEMS = {
  bitumen: stockItem(BITUMEN, "Bitumen 80/100", "999999999999999.999", { sku: "BIT-001" }),
  paint: stockItem(PAINT, "Road Marking Paint", "0.000", { unit: "litre", productStatus: "inactive" }),
  legacy: stockItem(SERVICE, "Legacy Crane Hire", "4.500", { unit: "pcs", productType: "service", stockTracked: false }),
};
function movement(id: string, delta: string, grId: string, grNumber: string | null, occurredOn: string): StockMovement {
  return {
    id, productId: BITUMEN, productName: "Bitumen 60/70 (old name)", sku: "BIT-OLD", unit: "barrel",
    type: "goods_receipt", quantityDelta: delta, direction: delta.startsWith("-") ? "out" : "in",
    source: toStockMovementSource("goods_receipt", grId, "a1000000-0000-4000-8000-0000000000e1", grNumber),
    occurredOn, createdAt: `${occurredOn}T06:00:00Z`,
  };
}
const MOVEMENTS = [
  movement("a1000000-0000-4000-8000-0000000000f1", "30.000", GR_A, "GR-000021", "2026-11-10"),
  movement("a1000000-0000-4000-8000-0000000000f2", "0.001", GR_B, "GR-000018", "2026-11-08"),
];

const mocks = vi.hoisted(() => ({
  role: "owner" as string,
  list: null as unknown as ReadPage<CurrentStockItem>,
  stock: null as CurrentStockItem | null,
  movements: null as unknown as ReadPage<StockMovement>,
  movementsFail: false,
  listCalls: [] as unknown[][],
  stockCalls: [] as unknown[][],
  movementCalls: [] as unknown[][],
}));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NOT_FOUND"); }, redirect: (href: string) => { throw new Error(`REDIRECT:${href}`); } }));
vi.mock("next/form", () => ({ default: ({ children, ...props }: { children?: ReactNode }) => h("form", props, children) }));
vi.mock("@/app/_components/app-layout", () => ({ AppLayout: ({ children }: { children: ReactNode }) => children }));
vi.mock("@/lib/tenancy/context", () => ({ requireTenant: async () => ({ ...fixture.FIXTURE_TENANT, role: mocks.role }) }));
vi.mock("@/lib/inventory/stock", () => ({
  listCurrentStock: async (...args: unknown[]) => { mocks.listCalls.push(args); return mocks.list; },
  getProductStock: async (...args: unknown[]) => { mocks.stockCalls.push(args); return mocks.stock; },
}));
vi.mock("@/lib/inventory/movements", async (original) => ({
  ...(await original<typeof import("@/lib/inventory/movements")>()),
  listStockMovements: async (...args: unknown[]) => {
    mocks.movementCalls.push(args);
    if (mocks.movementsFail) throw new Error("Could not load stock movements.");
    return mocks.movements;
  },
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => { throw new Error("no database in UI tests"); } }));
import InventoryPage from "@/app/inventory/page";
import ProductStockPage from "@/app/inventory/[productId]/page";
import ProductStockNotFound from "@/app/inventory/[productId]/not-found";
import InventoryError from "@/app/inventory/error";

async function html(tree: ReactNode) { return renderToStaticMarkup(await resolveServerTree(tree)); }
const listProps = (searchParams: Record<string, string> = {}) => ({ params: Promise.resolve({}), searchParams: Promise.resolve(searchParams) });
const detailProps = (productId: string, searchParams: Record<string, string> = {}) => ({ params: Promise.resolve({ productId }), searchParams: Promise.resolve(searchParams) });
const header = (output: string) => output.match(/<header class="page-header">([\s\S]*?)<\/header>/)![1];
const rowOf = (output: string, name: string) => output.match(new RegExp(`<tr>(?:(?!<tr>)[\\s\\S])*?${name}[\\s\\S]*?</tr>`))![0];
// Any link/button offering a stock write, any non-search input, or adjustment wording anywhere.
const WRITE_CONTROLS = /<(a|button)\b[^>]*>\s*(Stock in|Stock out|Edit|Edit quantity|Edit balance|New stock|Receive stock|Record movement|Delete)\s*<|Adjust stock|<input(?![^>]*type="search")/i;
const OUT_OF_SCOPE = /warehouse|valuation|stock value|average cost|FIFO|LIFO|COGS|Total units|Total quantity|Total stock/i;

beforeEach(() => {
  mocks.role = "owner";
  mocks.list = { items: [ITEMS.bitumen, ITEMS.paint, ITEMS.legacy], total: 3, page: 1, pageSize: 25 };
  mocks.stock = ITEMS.bitumen;
  mocks.movements = { items: MOVEMENTS, total: 2, page: 1, pageSize: 25 };
  mocks.movementsFail = false;
  mocks.listCalls = []; mocks.stockCalls = []; mocks.movementCalls = [];
});

describe("inventory route and navigation", () => {
  it("has list, detail, not-found, error and shell layout files", () => {
    for (const file of ["page.tsx", "layout.tsx", "error.tsx", "[productId]/page.tsx", "[productId]/not-found.tsx"]) {
      expect(existsSync(`app/inventory/${file}`), file).toBe(true);
    }
    expect(readFileSync("app/inventory/layout.tsx", "utf8")).toContain("AppLayout");
  });
  it("protects /inventory for signed-in users only", () => {
    expect(readFileSync("proxy.ts", "utf8")).toMatch(/"\/inventory",/);
  });
});

describe("current stock list", () => {
  it.each(["owner", "manager", "employee"])("renders a read-only, labelled current stock table for %s", async (role) => {
    mocks.role = role;
    const output = await html(InventoryPage(listProps()));
    expect(header(output)).toContain("<h1>Inventory</h1>");
    expect(header(output)).toContain("View current stock balances and movement history.");
    expect(output).toContain('role="region" aria-label="Current stock"');
    const table = output.match(/aria-label="Current stock"[\s\S]*?<\/table>/)![0];
    expect([...table.matchAll(/<th[^>]*>([^<]*)<\/th>/g)].map((m) => m[1])).toEqual(["Product", "SKU", "Unit", "Type", "Status", "Current stock"]);
    expect(output).not.toMatch(WRITE_CONTROLS);
    expect(output).not.toMatch(OUT_OF_SCOPE);
  });

  it("shows current product metadata and the exact balance (no float rounding)", async () => {
    const row = rowOf(await html(InventoryPage(listProps())), "Bitumen 80/100");
    expect(row).toContain(`href="/inventory/${BITUMEN}"`);
    expect(row).toContain("BIT-001");
    expect(row).toContain(">drum<");
    expect(row).toContain(">Inventory");
    expect(row).toContain(">Active<");
    expect(row).toContain(">999,999,999,999,999.999<");
    expect(row).not.toContain("1,000,000,000,000,000");
  });

  it("keeps zero-stock and inactive products visible with their status", async () => {
    const row = rowOf(await html(InventoryPage(listProps())), "Road Marking Paint");
    expect(row).toContain(">0.000<");
    expect(row).toContain(">Inactive<");
    expect(row).toContain(">litre<");
  });

  it("keeps a non-inventory product with stock history visible and flags it with text", async () => {
    const output = await html(InventoryPage(listProps()));
    const row = rowOf(output, "Legacy Crane Hire");
    expect(row).toContain(">4.500<");
    expect(row).toContain("Service");
    expect(row).toContain("Stock history exists");
    expect(row).toContain("This product has inventory history but is currently classified as a non-inventory type.");
    expect(output).toContain("no longer classified as inventory");
    // Only the mismatched row is flagged.
    expect(rowOf(output, "Bitumen 80/100")).not.toContain("Stock history exists");
  });

  it("omits the mismatch note when every row is tracked inventory", async () => {
    mocks.list = { items: [ITEMS.bitumen], total: 1, page: 1, pageSize: 25 };
    expect(await html(InventoryPage(listProps()))).not.toMatch(/Stock history exists|no longer classified/);
  });

  it("never sums quantities across products (mixed units)", async () => {
    const output = await html(InventoryPage(listProps()));
    // Each balance appears once, in its own row; no aggregate cell.
    expect(output.match(/class="num emphasis remaining"/g)).toHaveLength(3);
    expect(output).not.toMatch(/Total|Sum/);
  });

  it("reads search and page from the URL only, with the session tenant", async () => {
    const output = await html(InventoryPage(listProps({ q: "  bitumen ", page: "2", organization_id: "b0000000-0000-4000-8000-000000000999", org: "x" })));
    const [tenant, params] = mocks.listCalls[0] as [typeof fixture.FIXTURE_TENANT, Record<string, unknown>];
    expect(tenant.organization.id).toBe(fixture.FIXTURE_TENANT.organization.id);
    expect(params).toEqual({ search: "bitumen", page: 2 });
    expect(output).toContain('value="bitumen"');
    expect(output).toContain('name="q"');
    expect(output).toContain('href="/inventory">Reset search');
  });

  it("paginates 25 per page and keeps the search in page links", async () => {
    mocks.list = { items: [ITEMS.bitumen], total: 60, page: 2, pageSize: 25 };
    const output = await html(InventoryPage(listProps({ q: "bit", page: "2" })));
    expect(output).toContain("Showing 26–26 of 60");
    expect(output).toContain('href="/inventory?q=bit"');
    expect(output).toContain('href="/inventory?q=bit&amp;page=3"');
  });

  it("shows friendly empty states (none yet, no match, past the end)", async () => {
    mocks.list = { items: [], total: 0, page: 1, pageSize: 25 };
    const empty = await html(InventoryPage(listProps()));
    expect(empty).toContain("No inventory products yet");
    expect(empty).not.toMatch(WRITE_CONTROLS);
    expect(await html(InventoryPage(listProps({ q: "zzz" })))).toContain("No products match your search");
    mocks.list = { items: [], total: null, page: 9, pageSize: 25 };
    const past = await html(InventoryPage(listProps({ q: "b", page: "9" })));
    expect(past).toContain("No products on this page");
    expect(past).toContain('href="/inventory?q=b"');
  });

  it("shows a safe error boundary without database details", () => {
    const output = renderToStaticMarkup(h(InventoryError, { error: new Error("relation stock_movements SQLSTATE 42501"), retry: () => {} }));
    expect(output).toContain("Something went wrong while loading inventory.");
    expect(output).not.toMatch(/SQLSTATE|relation|stock_movements/);
  });
});

describe("product stock detail", () => {
  it("shows the current balance with unit, current product metadata and a product link", async () => {
    const output = await html(ProductStockPage(detailProps(BITUMEN)));
    const head = header(output);
    expect(head).toContain("<h1>Bitumen 80/100</h1>");
    expect(head).toMatch(/BIT-001<\/span> · Inventory/);
    expect(head).toContain(">Active<");
    expect(head).toContain(`href="/products/${BITUMEN}"`);
    expect(head).toContain(">View product<");
    expect(output).toMatch(/Current stock<\/p>[\s\S]*?999,999,999,999,999\.999 <span[^>]*>drum<\/span>/);
    expect(output).toContain('href="/inventory"');
    expect(output).not.toMatch(WRITE_CONTROLS);
    expect(output).not.toMatch(OUT_OF_SCOPE);
  });

  it("uses the route's product ID and the session tenant; ignores organization/product query parameters", async () => {
    await html(ProductStockPage(detailProps(BITUMEN, { page: "2", product: PAINT, organization_id: "b0000000-0000-4000-8000-000000000999" })));
    const [stockTenant, stockId] = mocks.stockCalls[0] as [typeof fixture.FIXTURE_TENANT, string];
    expect(stockTenant.organization.id).toBe(fixture.FIXTURE_TENANT.organization.id);
    expect(stockId).toBe(BITUMEN);
    expect(mocks.movementCalls[0][1]).toEqual({ productId: BITUMEN, page: 2 });
  });

  it.each(["not-a-uuid", "1; drop table products", ""])("returns not-found for malformed ID %j without reading", async (id) => {
    await expect(html(ProductStockPage(detailProps(id)))).rejects.toThrow("NOT_FOUND");
    expect(mocks.stockCalls).toEqual([]);
    expect(mocks.movementCalls).toEqual([]);
  });

  it("returns not-found for unknown, other-tenant or non-stock products (domain returns null)", async () => {
    mocks.stock = null;
    await expect(html(ProductStockPage(detailProps(BITUMEN)))).rejects.toThrow("NOT_FOUND");
    const notFound = renderToStaticMarkup(h(ProductStockNotFound));
    expect(notFound).toContain("Product stock not found");
    expect(notFound).toContain('href="/inventory"');
  });

  it("shows zero stock and the empty movement state without a stock-writing CTA", async () => {
    mocks.stock = { ...ITEMS.paint };
    mocks.movements = { items: [], total: 0, page: 1, pageSize: 25 };
    const output = await html(ProductStockPage(detailProps(PAINT)));
    expect(output).toMatch(/0\.000 <span[^>]*>litre<\/span>/);
    expect(output).toContain("No stock movements yet");
    expect(output).toContain("Stock movements will appear here when inventory transactions are recorded.");
    expect(header(output)).toContain(">Inactive<");
    expect(output).not.toMatch(WRITE_CONTROLS);
  });

  it("warns about a type mismatch near the summary but still shows the balance", async () => {
    mocks.stock = ITEMS.legacy;
    const output = await html(ProductStockPage(detailProps(SERVICE)));
    expect(output).toContain("Inventory history mismatch");
    expect(output).toContain("This product has stock movements but its current type is Service.");
    expect(output).toMatch(/4\.500 <span[^>]*>pcs<\/span>/);
    expect(output).not.toMatch(/>Fix|Repair|Change type/);
    mocks.stock = ITEMS.bitumen;
    expect(await html(ProductStockPage(detailProps(BITUMEN)))).not.toContain("Inventory history mismatch");
  });
});

describe("movement history", () => {
  it("renders signed exact quantities, mapped labels, GR links and recorded snapshots", async () => {
    const output = await html(ProductStockPage(detailProps(BITUMEN)));
    const table = output.match(/aria-label="Stock movement history"[\s\S]*?<\/table>/)![0];
    expect([...table.matchAll(/<th[^>]*>([^<]*)<\/th>/g)].map((m) => m[1])).toEqual(["Date", "Movement", "Quantity", "Source", "Reference", "Recorded product"]);
    const first = rowOf(table, "GR-000021");
    expect(first).toContain("10 Nov 2026");
    expect(first).toContain(">Goods receipt<");
    expect(first).not.toContain("goods_receipt");
    expect(first).toMatch(/\+30\.000<span[^>]*>barrel<\/span>/);
    expect(first).toContain("(stock in)");
    expect(first).toContain(`href="/goods-receipts/${GR_A}"`);
    // Snapshots, not the current product name/SKU.
    expect(first).toContain("Bitumen 60/70 (old name)");
    expect(first).toContain("BIT-OLD");
    expect(table).not.toContain("BIT-001");
    expect(rowOf(table, "GR-000018")).toContain("+0.001");
    // Newest first, as returned.
    expect(table.indexOf("GR-000021")).toBeLessThan(table.indexOf("GR-000018"));
    expect(table).not.toMatch(/<button|Edit|Delete/);
  });

  it("formats a future negative movement with a minus sign", async () => {
    mocks.movements = { items: [movement("a1000000-0000-4000-8000-0000000000f3", "-10.000", GR_A, "GR-000030", "2026-11-11")], total: 1, page: 1, pageSize: 25 };
    const output = await html(ProductStockPage(detailProps(BITUMEN)));
    expect(output).toMatch(/>-10\.000<span/);
    expect(output).toContain("(stock out)");
    expect(output).not.toContain("+-10.000");
  });

  it("links the source even when the document number is unavailable", async () => {
    mocks.movements = { items: [movement("a1000000-0000-4000-8000-0000000000f4", "1.000", GR_B, null, "2026-11-09")], total: 1, page: 1, pageSize: 25 };
    const output = await html(ProductStockPage(detailProps(BITUMEN)));
    expect(output).toContain(`href="/goods-receipts/${GR_B}"`);
    expect(output).toContain(">View source<");
  });

  it("paginates movements for the fixed product only", async () => {
    mocks.movements = { items: MOVEMENTS, total: 60, page: 2, pageSize: 25 };
    const output = await html(ProductStockPage(detailProps(BITUMEN, { page: "2" })));
    expect(output).toContain("Showing 26–27 of 60");
    expect(output).toContain(`href="/inventory/${BITUMEN}"`);
    expect(output).toContain(`href="/inventory/${BITUMEN}?page=3"`);
    mocks.movements = { items: [], total: null, page: 9, pageSize: 25 };
    expect(await html(ProductStockPage(detailProps(BITUMEN, { page: "9" })))).toContain("No movements on this page");
  });

  it("shows a safe inline error when movements fail to load, keeping the stock summary", async () => {
    mocks.movementsFail = true;
    const output = await html(ProductStockPage(detailProps(BITUMEN)));
    expect(output).toContain("Could not load stock movements.");
    expect(output).toContain("999,999,999,999,999.999");
    expect(output).not.toMatch(/SQLSTATE|PostgreSQL|Supabase|stack/i);
  });
});

describe("inventory UI source regressions", () => {
  const sources = ["app/inventory/page.tsx", "app/inventory/[productId]/page.tsx"].map((file) => [file, readFileSync(file, "utf8")] as const);
  it.each(sources)("%s has no float conversion, client fetching, server actions or writes", (_file, text) => {
    expect(text).not.toMatch(/parseFloat|Number\(|toFixed|toLocaleString|Intl\.NumberFormat/);
    expect(text).not.toMatch(/"use client"|"use server"|useEffect|fetch\(|\.rpc\(|createClient/);
    expect(text).not.toMatch(/organization_id|searchParams\.(org|organization)/);
  });
});
