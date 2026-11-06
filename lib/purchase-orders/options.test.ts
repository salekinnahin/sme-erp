import { beforeEach, describe, expect, it, vi } from "vitest";

// PO selector searches must be server-side, bounded, active-only and scoped
// to the tenant; products carry the PURCHASE price. Current references are
// read by ID within the tenant whatever their status. Matching, escaping,
// RLS and ordering are covered by the SQL suites.

type Op = [method: string, ...args: unknown[]];
type Query = { table: string; ops: Op[] };
type Rpc = { fn: string; args: Record<string, unknown> };
type Result = { data: unknown; error: unknown };

const queries: Query[] = [];
const rpcs: Rpc[] = [];
let respond: (q: Query) => Result = () => ({ data: [], error: null });
let respondRpc: (r: Rpc) => Result = () => ({ data: [], error: null });

function builder(query: Query): unknown {
  const proxy: object = new Proxy({}, {
    get(_t, prop) {
      if (prop === "then")
        return (resolve: (r: Result) => unknown, reject: (e: unknown) => unknown) =>
          Promise.resolve(respond(query)).then(resolve, reject);
      return (...args: unknown[]) => {
        query.ops.push([String(prop), ...args]);
        return proxy;
      };
    },
  });
  return proxy;
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (table: string) => {
      const query = { table, ops: [] };
      queries.push(query);
      return builder(query);
    },
    rpc: async (fn: string, args: Record<string, unknown>) => {
      const call = { fn, args };
      rpcs.push(call);
      return respondRpc(call);
    },
  }),
}));

const {
  getPurchaseProductOptions,
  getVendorOption,
  listVendorFilterOptions,
  searchPurchaseProductOptions,
  searchVendorOptions,
} = await import("./options");
const { listPurchaseOrders } = await import("./purchase-orders");

const ORG = "aaaaaaaa-0000-4000-8000-000000000001";
const tenant = { organization: { id: ORG, name: "Org", currency: "BDT", timezone: "Asia/Dhaka" }, role: "employee" as const };
const id = (prefix: string, n: number) => `${prefix}-0000-4000-8000-${String(n).padStart(12, "0")}`;
const has = (q: Query, method: string, ...args: unknown[]) =>
  q.ops.some(([m, ...a]) => m === method && JSON.stringify(a) === JSON.stringify(args));
const selected = (q: Query) => q.ops.find(([m]) => m === "select")?.[1] as string;

beforeEach(() => {
  queries.length = 0;
  rpcs.length = 0;
  respond = () => ({ data: [], error: null });
  respondRpc = () => ({ data: [], error: null });
});

describe("vendor selector search", () => {
  it("uses list_vendors for the session tenant: active only, 25 max, trimmed and capped search", async () => {
    respondRpc = () => ({
      data: [
        { id: id("dddddddd", 1), name: "Acme", company_name: "Acme Ltd", phone: null, email: "a@x.test", status: "active", total_count: "40" },
        { id: id("dddddddd", 2), name: "Old", company_name: null, phone: null, email: null, status: "inactive", total_count: "40" },
      ],
      error: null,
    });
    const result = await searchVendorOptions(tenant, `　${"x".repeat(150)}`);
    expect(rpcs[0]).toEqual({
      fn: "list_vendors",
      args: { p_organization_id: ORG, p_search: "x".repeat(99), p_status: "active", p_limit: 25, p_offset: 0 },
    });
    expect(result).toEqual({
      ok: true,
      more: true,
      options: [{ id: id("dddddddd", 1), name: "Acme", companyName: "Acme Ltd", phone: null, email: "a@x.test", status: "active" }],
    });
    await searchVendorOptions(tenant, 42);
    expect(rpcs[1].args.p_search).toBeNull();
  });

  it("throws (so the guarded action fails closed) on database errors", async () => {
    respondRpc = () => ({ data: null, error: { message: "boom" } });
    await expect(searchVendorOptions(tenant, "x")).rejects.toThrow("Failed to search vendors.");
  });
});

describe("product selector search", () => {
  it("reads purchase_price (never selling_price) for active matches, tenant-filtered, in RPC order", async () => {
    const [p1, p2] = [id("bbbbbbbb", 1), id("bbbbbbbb", 2)];
    respondRpc = () => ({ data: [{ id: p2, status: "active", total_count: 2 }, { id: p1, status: "active", total_count: 2 }], error: null });
    respond = () => ({
      data: [
        { id: p1, name: "A", sku: "A-1", unit: "pcs", description: null, purchase_price: null, status: "active" },
        { id: p2, name: "B", sku: "B-1", unit: "box", description: "d", purchase_price: "12.50", status: "active" },
      ],
      error: null,
    });
    const result = await searchPurchaseProductOptions(tenant, "sku");
    expect(rpcs[0]).toMatchObject({ fn: "list_products", args: { p_organization_id: ORG, p_status: "active", p_limit: 25, p_search: "sku" } });
    const q = queries[0];
    expect(selected(q)).toContain("purchase_price");
    expect(selected(q)).not.toContain("selling_price");
    expect(has(q, "eq", "organization_id", ORG)).toBe(true);
    expect(has(q, "eq", "status", "active")).toBe(true);
    expect(result).toEqual({
      ok: true,
      more: false,
      options: [
        { id: p2, name: "B", sku: "B-1", unit: "box", description: "d", purchasePrice: "12.50", status: "active" },
        { id: p1, name: "A", sku: "A-1", unit: "pcs", description: null, purchasePrice: null, status: "active" },
      ],
    });
  });

  it("does not query details when nothing active matched", async () => {
    respondRpc = () => ({ data: [{ id: id("bbbbbbbb", 1), status: "inactive", total_count: 1 }], error: null });
    expect(await searchPurchaseProductOptions(tenant, "")).toEqual({ ok: true, options: [], more: false });
    expect(queries).toHaveLength(0);
  });
});

describe("current references (edit form)", () => {
  it("reads the current vendor by ID within the tenant, without a status filter", async () => {
    const v = id("dddddddd", 7);
    respond = () => ({ data: [{ id: v, name: "Gone", company_name: null, phone: null, email: null, status: "inactive" }], error: null });
    expect(await getVendorOption(tenant, v.toUpperCase())).toMatchObject({ id: v, status: "inactive" });
    expect(has(queries[0], "eq", "organization_id", ORG)).toBe(true);
    expect(has(queries[0], "in", "id", [v])).toBe(true);
    expect(queries[0].ops.some(([m, col]) => m === "eq" && col === "status")).toBe(false);
    expect(await getVendorOption(tenant, "not-a-uuid")).toBeNull();
    expect(queries).toHaveLength(1);
  });

  it("reads all line products in one tenant query, any status, with purchase prices", async () => {
    const ids = [id("bbbbbbbb", 1), id("bbbbbbbb", 2)];
    await getPurchaseProductOptions(tenant, [...ids, ids[0], "bad", null]);
    expect(queries).toHaveLength(1);
    expect(has(queries[0], "in", "id", ids)).toBe(true);
    expect(selected(queries[0])).toContain("purchase_price");
    expect(queries[0].ops.some(([m, col]) => m === "eq" && col === "status")).toBe(false);
  });

  it("the list's vendor filter includes inactive vendors and the filtered one beyond the cap", async () => {
    const current = id("dddddddd", 999);
    respond = (q) => ({
      data: q.ops.some(([m]) => m === "in")
        ? [{ id: current, name: "Zed", company_name: null, phone: null, email: null, status: "inactive" }]
        : [{ id: id("dddddddd", 1), name: "Acme", company_name: null, phone: null, email: null, status: "active" }],
      error: null,
    });
    const list = await listVendorFilterOptions(tenant, { currentId: current });
    expect(list.options.map((v) => v.id)).toEqual([current, id("dddddddd", 1)]);
    expect(queries[0].ops.some(([m, col]) => m === "eq" && col === "status")).toBe(false);
  });
});

describe("purchase order list read", () => {
  it("calls list_purchase_orders with the session organization and maps exact strings", async () => {
    respondRpc = () => ({
      data: [{
        id: "po", purchase_order_number: "PO-000002", vendor_id: "v", vendor_name: "Acme", vendor_company_name: null,
        order_date: "2026-11-06", expected_delivery_date: null, status: "ordered", grand_total: "9999999999999999.99",
        created_at: "2026-11-06T00:00:00Z", total_count: "51",
      }],
      error: null,
    });
    const result = await listPurchaseOrders(tenant, { search: "100%", status: "ordered", vendor: "all", page: 3 });
    expect(rpcs[0]).toEqual({
      fn: "list_purchase_orders",
      args: { p_organization_id: ORG, p_search: "100%", p_status: "ordered", p_vendor_id: null, p_limit: 25, p_offset: 50 },
    });
    expect(result).toMatchObject({ total: 51, page: 3, pageSize: 25 });
    expect(result.items[0]).toMatchObject({ purchaseOrderNumber: "PO-000002", grandTotal: "9999999999999999.99", status: "ordered" });
  });

  it("an empty first page totals 0; an empty later page is past the end; errors throw", async () => {
    expect((await listPurchaseOrders(tenant, { search: "", status: "all", vendor: "all", page: 1 })).total).toBe(0);
    expect((await listPurchaseOrders(tenant, { search: "", status: "all", vendor: "all", page: 9 })).total).toBeNull();
    respondRpc = () => ({ data: null, error: { message: "secret" } });
    await expect(listPurchaseOrders(tenant, { search: "", status: "all", vendor: "all", page: 1 })).rejects.toThrow("Failed to load purchase orders.");
  });
});
