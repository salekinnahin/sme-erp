import { beforeEach, describe, expect, it, vi } from "vitest";

// Selector searches must be server-side, bounded, active-only and scoped to
// the tenant from the session. Current references must be fetched by ID
// within the tenant, whatever their status, separately from the search.
// The database side (matching, escaping, RLS, ordering) is covered by
// supabase/tests/customers.sql, products.sql and quotations.sql.

type Op = [method: string, ...args: unknown[]];
type Query = { table: string; ops: Op[] };
type Rpc = { fn: string; args: Record<string, unknown> };
type Result = { data: unknown; error: unknown };

const queries: Query[] = [];
const rpcs: Rpc[] = [];
let respond: (q: Query) => Result = () => ({ data: [], error: null });
let respondRpc: (r: Rpc) => Result = () => ({ data: [], error: null });

/** A chainable stand-in for the Supabase query builder that records calls. */
function builder(query: Query): unknown {
  const target = {};
  const proxy: object = new Proxy(target, {
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
  getCustomerOption,
  getProductOptions,
  listCustomerOptions,
  normalizeOptionSearch,
  searchCustomerOptions,
  searchProductOptions,
  OPTION_LIMIT,
  OPTION_SEARCH_MAX_LENGTH,
  SEARCH_OPTION_LIMIT,
} = await import("./options");

const ORG = "aaaaaaaa-0000-4000-8000-000000000001";
const tenant = { organization: { id: ORG, name: "Org", currency: "BDT", timezone: "Asia/Dhaka" } };

const has = (q: Query, method: string, ...args: unknown[]) =>
  q.ops.some(([m, ...a]) => m === method && JSON.stringify(a) === JSON.stringify(args));
const inIds = (q: Query) => q.ops.find(([m]) => m === "in")?.[2] as string[] | undefined;
const filtersStatus = (q: Query) => q.ops.some(([m, col]) => m === "eq" && col === "status");

function customerRow(n: number, status = "active") {
  return {
    id: `dddddddd-0000-4000-8000-${String(n).padStart(12, "0")}`,
    name: `Customer ${n}`,
    company_name: null,
    phone: null,
    email: null,
    status,
  };
}

function productRow(n: number, status = "active") {
  return {
    id: `bbbbbbbb-0000-4000-8000-${String(n).padStart(12, "0")}`,
    name: `Product ${n}`,
    sku: `P-${n}`,
    unit: "pcs",
    description: `Description ${n}`,
    selling_price: "10.00",
    status,
  };
}

/** What list_customers() / list_products() return for a row. */
const counted = <T extends object>(row: T, total: number) => ({ ...row, total_count: String(total) });

beforeEach(() => {
  queries.length = 0;
  rpcs.length = 0;
  respond = () => ({ data: [], error: null });
  respondRpc = () => ({ data: [], error: null });
});

describe("normalizeOptionSearch", () => {
  it("trims with the shared whitespace set (Unicode, not JavaScript trim)", () => {
    expect(normalizeOptionSearch("  acme  ")).toBe("acme");
    expect(normalizeOptionSearch("　 acme ﻿")).toBe("acme");
    expect(normalizeOptionSearch("  　 ")).toBe("");
  });

  it("keeps inner spaces and wildcard characters as typed (the RPC escapes them)", () => {
    expect(normalizeOptionSearch(" 50% off_x ")).toBe("50% off_x");
    expect(normalizeOptionSearch("a\\b")).toBe("a\\b");
  });

  it("caps the term in code points without splitting a surrogate pair", () => {
    const long = "😀".repeat(OPTION_SEARCH_MAX_LENGTH + 5);
    expect(Array.from(normalizeOptionSearch(long))).toHaveLength(OPTION_SEARCH_MAX_LENGTH);
  });

  it("treats non-strings as no search", () => {
    expect(normalizeOptionSearch(undefined)).toBe("");
    expect(normalizeOptionSearch(null)).toBe("");
    expect(normalizeOptionSearch({ organization_id: "x" })).toBe("");
    expect(normalizeOptionSearch(42)).toBe("");
  });
});

describe("searchCustomerOptions", () => {
  it("searches active customers of the tenant on the server, bounded", async () => {
    const row = { ...customerRow(1), company_name: "Acme", phone: "+880", email: "a@acme.test" };
    respondRpc = () => ({ data: [counted(row, 1)], error: null });

    const result = await searchCustomerOptions(tenant, "  Acme ");

    expect(queries).toHaveLength(0); // no table read: nothing loaded client-side
    expect(rpcs).toEqual([
      {
        fn: "list_customers",
        args: { p_organization_id: ORG, p_search: "Acme", p_status: "active", p_limit: SEARCH_OPTION_LIMIT, p_offset: 0 },
      },
    ]);
    expect(SEARCH_OPTION_LIMIT).toBeGreaterThanOrEqual(20);
    expect(SEARCH_OPTION_LIMIT).toBeLessThanOrEqual(50);
    expect(result).toEqual({
      ok: true,
      options: [{ id: row.id, name: "Customer 1", companyName: "Acme", phone: "+880", email: "a@acme.test", status: "active" }],
      more: false,
    });
  });

  it("finds a customer the old first-500 list never reached", async () => {
    // The term goes to the database; there is no capped list to fall out of.
    const late = customerRow(OPTION_LIMIT + 250);
    respondRpc = (r) =>
      r.args.p_search === "Customer 750" ? { data: [counted(late, 1)], error: null } : { data: [], error: null };

    const result = await searchCustomerOptions(tenant, "Customer 750");
    expect(result.ok && result.options.map((o) => o.id)).toEqual([late.id]);
    expect(rpcs[0].args.p_offset).toBe(0);
  });

  it("sends an empty or whitespace-only search as no filter (newest active customers)", async () => {
    await searchCustomerOptions(tenant, "");
    await searchCustomerOptions(tenant, " 　  ");
    await searchCustomerOptions(tenant, undefined);
    expect(rpcs.map((r) => r.args.p_search)).toEqual([null, null, null]);
    expect(rpcs.every((r) => r.args.p_status === "active")).toBe(true);
  });

  it("passes % and _ through unchanged for the RPC to match literally", async () => {
    await searchCustomerOptions(tenant, "100%_");
    expect(rpcs[0].args.p_search).toBe("100%_");
  });

  it("never returns an inactive customer, even if one came back", async () => {
    respondRpc = () => ({
      data: [counted(customerRow(1), 2), counted(customerRow(2, "inactive"), 2)],
      error: null,
    });
    const result = await searchCustomerOptions(tenant, "Customer");
    expect(result.ok && result.options.map((o) => o.id)).toEqual([customerRow(1).id]);
  });

  it("uses the tenant's organization only; input cannot choose another one", async () => {
    await searchCustomerOptions(tenant, `{"p_organization_id":"bbbbbbbb-0000-4000-8000-000000000002"}`);
    expect(rpcs[0].args.p_organization_id).toBe(ORG);
  });

  it("reports when more customers match than are shown", async () => {
    respondRpc = () => ({
      data: Array.from({ length: SEARCH_OPTION_LIMIT }, (_, i) => counted(customerRow(i + 1), 80)),
      error: null,
    });
    const result = await searchCustomerOptions(tenant, "Customer");
    expect(result.ok && result.options).toHaveLength(SEARCH_OPTION_LIMIT);
    expect(result.ok && result.more).toBe(true);
  });

  it("throws on database errors", async () => {
    respondRpc = () => ({ data: null, error: { code: "XX000", message: "boom" } });
    await expect(searchCustomerOptions(tenant, "x")).rejects.toThrow("Failed to search customers.");
  });
});

describe("getCustomerOption (current reference)", () => {
  it("fetches the current customer by ID within the tenant, without a status filter", async () => {
    const current = customerRow(900, "inactive");
    respond = () => ({ data: [current], error: null });

    const result = await getCustomerOption(tenant, current.id.toUpperCase());

    expect(queries).toHaveLength(1);
    expect(has(queries[0], "eq", "organization_id", ORG)).toBe(true);
    expect(inIds(queries[0])).toEqual([current.id]);
    expect(filtersStatus(queries[0])).toBe(false); // an inactive current customer stays
    expect(result?.status).toBe("inactive");
    expect(rpcs).toHaveLength(0); // independent of the search
  });

  it("never queries for a missing or malformed ID", async () => {
    expect(await getCustomerOption(tenant, "1 or 1=1")).toBeNull();
    expect(await getCustomerOption(tenant, null)).toBeNull();
    expect(queries).toHaveLength(0);
  });

  it("returns null for another tenant's customer ID (not found within the tenant)", async () => {
    respond = () => ({ data: [], error: null });
    expect(await getCustomerOption(tenant, customerRow(777).id)).toBeNull();
    expect(has(queries[0], "eq", "organization_id", ORG)).toBe(true);
  });
});

describe("searchProductOptions", () => {
  it("searches active products of the tenant, then reads their details in the RPC's order", async () => {
    const [a, b] = [productRow(2), productRow(1)];
    respondRpc = () => ({ data: [counted(a, 2), counted(b, 2)], error: null });
    // The detail query returns rows in another order; the result keeps the RPC's.
    respond = () => ({ data: [b, a], error: null });

    const result = await searchProductOptions(tenant, " lap ");

    expect(rpcs).toEqual([
      {
        fn: "list_products",
        args: {
          p_organization_id: ORG,
          p_search: "lap",
          p_status: "active",
          p_product_type: null,
          p_category_id: null,
          p_limit: SEARCH_OPTION_LIMIT,
          p_offset: 0,
        },
      },
    ]);
    expect(queries).toHaveLength(1);
    const [detail] = queries;
    expect(detail.table).toBe("products");
    expect(has(detail, "eq", "organization_id", ORG)).toBe(true);
    expect(has(detail, "eq", "status", "active")).toBe(true);
    expect(inIds(detail)).toEqual([a.id, b.id]);
    expect(String(detail.ops.find(([m]) => m === "select")?.[1])).toContain("selling_price::text");
    expect(result).toEqual({
      ok: true,
      options: [
        { id: a.id, name: "Product 2", sku: "P-2", unit: "pcs", description: "Description 2", sellingPrice: "10.00", status: "active" },
        { id: b.id, name: "Product 1", sku: "P-1", unit: "pcs", description: "Description 1", sellingPrice: "10.00", status: "active" },
      ],
      more: false,
    });
  });

  it("finds a product the old first-500 list never reached, by name or SKU", async () => {
    const late = productRow(OPTION_LIMIT + 300);
    respondRpc = (r) =>
      r.args.p_search === late.name || r.args.p_search === late.sku
        ? { data: [counted(late, 1)], error: null }
        : { data: [], error: null };
    respond = () => ({ data: [late], error: null });

    for (const term of [late.name, late.sku]) {
      const result = await searchProductOptions(tenant, term);
      expect(result.ok && result.options.map((o) => o.id)).toEqual([late.id]);
    }
  });

  it("drops a product that became inactive between the two reads", async () => {
    const [a, b] = [productRow(1), productRow(2)];
    respondRpc = () => ({ data: [counted(a, 2), counted(b, 2)], error: null });
    respond = () => ({ data: [a], error: null }); // b no longer matches status = active
    const result = await searchProductOptions(tenant, "Product");
    expect(result.ok && result.options.map((o) => o.id)).toEqual([a.id]);
  });

  it("skips inactive rows and makes no detail query when nothing is left", async () => {
    respondRpc = () => ({ data: [counted(productRow(1, "inactive"), 1)], error: null });
    const result = await searchProductOptions(tenant, "Product");
    expect(result).toEqual({ ok: true, options: [], more: false });
    expect(queries).toHaveLength(0);
  });

  it("sends an empty or whitespace-only search as no filter, and % / _ unchanged", async () => {
    await searchProductOptions(tenant, "　 ");
    await searchProductOptions(tenant, "SKU_1%");
    expect(rpcs.map((r) => r.args.p_search)).toEqual([null, "SKU_1%"]);
  });

  it("uses the tenant's organization in both queries", async () => {
    respondRpc = () => ({ data: [counted(productRow(1), 1)], error: null });
    respond = () => ({ data: [productRow(1)], error: null });
    await searchProductOptions(tenant, "x");
    expect(rpcs[0].args.p_organization_id).toBe(ORG);
    expect(has(queries[0], "eq", "organization_id", ORG)).toBe(true);
  });

  it("throws on database errors in either query", async () => {
    respondRpc = () => ({ data: null, error: { code: "XX000", message: "boom" } });
    await expect(searchProductOptions(tenant, "x")).rejects.toThrow("Failed to search products.");

    respondRpc = () => ({ data: [counted(productRow(1), 1)], error: null });
    respond = () => ({ data: null, error: { code: "XX000", message: "boom" } });
    await expect(searchProductOptions(tenant, "x")).rejects.toThrow("Failed to search products.");
  });
});

describe("getProductOptions (current references)", () => {
  it("fetches every line's product once, within the tenant, any status", async () => {
    const inactive = productRow(901, "inactive");
    const late = productRow(902);
    respond = () => ({ data: [inactive, late], error: null });

    const result = await getProductOptions(tenant, [
      inactive.id,
      late.id.toUpperCase(),
      inactive.id, // the same product on two lines
      "not-a-uuid",
      null,
    ]);

    expect(queries).toHaveLength(1);
    expect(has(queries[0], "eq", "organization_id", ORG)).toBe(true);
    expect(filtersStatus(queries[0])).toBe(false);
    expect(inIds(queries[0])).toEqual([inactive.id, late.id]);
    expect(result.map((o) => [o.id, o.status])).toEqual([
      [inactive.id, "inactive"],
      [late.id, "active"],
    ]);
    expect(rpcs).toHaveLength(0);
  });

  it("makes no query without valid IDs", async () => {
    expect(await getProductOptions(tenant, [])).toEqual([]);
    expect(await getProductOptions(tenant, ["x", null])).toEqual([]);
    expect(queries).toHaveLength(0);
  });

  it("leaves out another tenant's product (not found within the tenant)", async () => {
    respond = () => ({ data: [], error: null });
    expect(await getProductOptions(tenant, [productRow(777).id])).toEqual([]);
    expect(has(queries[0], "eq", "organization_id", ORG)).toBe(true);
  });
});

describe("listCustomerOptions (quotation list filter, unchanged)", () => {
  it("lists the tenant's customers by name, capped, plus the filtered one beyond the cap", async () => {
    const current = customerRow(900, "inactive");
    respond = (q) => (inIds(q) ? { data: [current], error: null } : { data: [customerRow(1)], error: null });

    const result = await listCustomerOptions(tenant, { includeInactive: true, currentId: current.id });

    expect(queries).toHaveLength(2);
    expect(has(queries[0], "eq", "organization_id", ORG)).toBe(true);
    expect(filtersStatus(queries[0])).toBe(false);
    expect(has(queries[0], "limit", OPTION_LIMIT + 1)).toBe(true);
    expect(has(queries[1], "eq", "organization_id", ORG)).toBe(true);
    expect(result.options.map((o) => o.id)).toEqual([current.id, customerRow(1).id]);
    expect(result.truncated).toBe(false);
  });

  it("does not fetch the filtered customer again when it is already listed", async () => {
    respond = () => ({ data: [customerRow(1), customerRow(2)], error: null });
    await listCustomerOptions(tenant, { includeInactive: true, currentId: customerRow(2).id });
    expect(queries).toHaveLength(1);
  });

  it("reports a truncated list", async () => {
    respond = () => ({
      data: Array.from({ length: OPTION_LIMIT + 1 }, (_, i) => customerRow(i + 1)),
      error: null,
    });
    const result = await listCustomerOptions(tenant, { includeInactive: true });
    expect(result.truncated).toBe(true);
    expect(result.options).toHaveLength(OPTION_LIMIT);
  });
});
