import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpc, from } = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc, from }) }));

import { getProductStock, listCurrentStock, toCurrentStockItem, type CurrentStockRow } from "./stock";

const ORG = "aaaaaaaa-0000-4000-8000-000000000001";
const PRODUCT = "cccccccc-0000-4000-8000-000000000003";
const tenant = { organization: { id: ORG, name: "Org", currency: "BDT", timezone: "Asia/Dhaka" }, role: "employee" as const };
const row: CurrentStockRow = {
  product_id: PRODUCT, product_name: "Widget", sku: "W-1", unit: "box",
  product_type: "inventory", product_status: "active", current_quantity: "999999999999999.999", total_count: "3",
};

beforeEach(() => {
  vi.clearAllMocks();
  rpc.mockResolvedValue({ data: [row], error: null });
});

describe("current stock rows", () => {
  it("maps an inventory row with an exact quantity string", () => {
    expect(toCurrentStockItem(row)).toEqual({
      productId: PRODUCT, productName: "Widget", sku: "W-1", unit: "box", productType: "inventory",
      productStatus: "active", quantity: "999999999999999.999", stockTracked: true,
    });
  });

  it("keeps zero stock for inventory products without movements", () => {
    expect(toCurrentStockItem({ ...row, current_quantity: "0.000" }).quantity).toBe("0.000");
  });

  it("flags (but still shows) stock of a product whose type later changed", () => {
    const item = toCurrentStockItem({ ...row, product_type: "non_inventory", current_quantity: "3.000" });
    expect(item).toMatchObject({ productType: "non_inventory", stockTracked: false, quantity: "3.000" });
  });

  it.each([
    { product_type: "goods" }, { product_status: "deleted" }, { current_quantity: "1.5" },
    { current_quantity: 12 as unknown as string }, { product_id: "not-a-uuid" },
  ])("rejects malformed row %j", (patch) => {
    expect(() => toCurrentStockItem({ ...row, ...patch })).toThrow();
  });
});

describe("listCurrentStock", () => {
  it("reads one tenant-scoped page through the invoker RPC only", async () => {
    const page = await listCurrentStock(tenant, { search: "wid", page: 1 });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("list_current_stock", {
      p_organization_id: ORG, p_search: "wid", p_product_id: null, p_limit: 25, p_offset: 0,
    });
    expect(from).not.toHaveBeenCalled();
    expect(page).toEqual({ items: [toCurrentStockItem(row)], total: 3, page: 1, pageSize: 25 });
  });

  it("reports empty first pages as 0 and pages past the end as unknown", async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    expect((await listCurrentStock(tenant, { search: "", page: 1 })).total).toBe(0);
    expect((await listCurrentStock(tenant, { search: "", page: 4 })).total).toBeNull();
  });

  it("throws a safe message without database details", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "private details" } });
    await expect(listCurrentStock(tenant, { search: "", page: 1 })).rejects.toThrow(/^Could not load stock\.$/);
    rpc.mockResolvedValue({ data: [{ ...row, current_quantity: "1e3" }], error: null });
    await expect(listCurrentStock(tenant, { search: "", page: 1 })).rejects.toThrow(/^Could not load stock\.$/);
  });

  it("returns nothing for an unknown role without querying", async () => {
    expect(await listCurrentStock({ ...tenant, role: "guest" as never }, { search: "", page: 1 })).toEqual({ items: [], total: 0, page: 1, pageSize: 25 });
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("getProductStock", () => {
  it("reads one product by ID within the tenant", async () => {
    expect(await getProductStock(tenant, PRODUCT)).toEqual(toCurrentStockItem(row));
    expect(rpc).toHaveBeenCalledWith("list_current_stock", {
      p_organization_id: ORG, p_search: null, p_product_id: PRODUCT, p_limit: 1, p_offset: 0,
    });
  });

  it("returns null for non-stock, unknown or other-tenant products, and skips malformed IDs", async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    expect(await getProductStock(tenant, PRODUCT)).toBeNull();
    rpc.mockClear();
    expect(await getProductStock(tenant, "bad")).toBeNull();
    expect(rpc).not.toHaveBeenCalled();
  });
});
