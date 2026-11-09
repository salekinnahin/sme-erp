import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpc, from } = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc, from }) }));

import { STOCK_MOVEMENT_TYPE_LABELS, STOCK_SOURCE_TYPE_LABELS } from "./messages";
import { listStockMovements, toStockMovement, toStockMovementSource, type StockMovementRow } from "./movements";
import { STOCK_MOVEMENT_TYPES, STOCK_SOURCE_TYPES, isStockMovementType, isStockSourceType } from "./types";

const ORG = "aaaaaaaa-0000-4000-8000-000000000001";
const PRODUCT = "cccccccc-0000-4000-8000-000000000003";
const RECEIPT = "dddddddd-0000-4000-8000-000000000004";
const LINE = "eeeeeeee-0000-4000-8000-000000000005";
const MOVEMENT = "ffffffff-0000-4000-8000-000000000006";
const tenant = { organization: { id: ORG, name: "Org", currency: "BDT", timezone: "Asia/Dhaka" }, role: "manager" as const };
const row: StockMovementRow = {
  movement_id: MOVEMENT, product_id: PRODUCT, product_name_snapshot: "Widget (as received)", sku_snapshot: "W-1",
  unit_snapshot: "box", movement_type: "goods_receipt", quantity_delta: "30.000", source_type: "goods_receipt",
  source_id: RECEIPT, source_line_id: LINE, source_document_number: "GR-000001", occurred_on: "2026-12-01",
  created_at: "2026-11-10T08:00:00+00:00", total_count: 7,
};

beforeEach(() => {
  vi.clearAllMocks();
  rpc.mockResolvedValue({ data: [row], error: null });
});

describe("movement and source types", () => {
  it("match the database lists for this phase", () => {
    expect(STOCK_MOVEMENT_TYPES).toEqual(["goods_receipt"]);
    expect(STOCK_SOURCE_TYPES).toEqual(["goods_receipt"]);
    expect(isStockMovementType("goods_receipt")).toBe(true);
    for (const value of ["sale_dispatch", "stock_adjustment_in", "purchase_return", "", null]) {
      expect(isStockMovementType(value)).toBe(false);
      expect(isStockSourceType(value)).toBe(false);
    }
  });

  it("labels every movement and source type", () => {
    for (const type of STOCK_MOVEMENT_TYPES) expect(STOCK_MOVEMENT_TYPE_LABELS[type]).toBe("Goods receipt");
    for (const type of STOCK_SOURCE_TYPES) expect(STOCK_SOURCE_TYPE_LABELS[type]).toBe("Goods receipt");
  });

  it("maps a goods receipt source to its document", () => {
    expect(toStockMovementSource("goods_receipt", RECEIPT, LINE, "GR-000001")).toEqual({
      type: "goods_receipt", id: RECEIPT, lineId: LINE, documentNumber: "GR-000001", href: `/goods-receipts/${RECEIPT}`,
    });
  });
});

describe("movement rows", () => {
  it("maps snapshots, exact signed quantity, direction, source and dates", () => {
    expect(toStockMovement(row)).toEqual({
      id: MOVEMENT, productId: PRODUCT, productName: "Widget (as received)", sku: "W-1", unit: "box",
      type: "goods_receipt", quantityDelta: "30.000", direction: "in",
      source: { type: "goods_receipt", id: RECEIPT, lineId: LINE, documentNumber: "GR-000001", href: `/goods-receipts/${RECEIPT}` },
      occurredOn: "2026-12-01", createdAt: "2026-11-10T08:00:00+00:00",
    });
    expect(toStockMovement({ ...row, quantity_delta: "0.001" }).quantityDelta).toBe("0.001");
    expect(toStockMovement({ ...row, quantity_delta: "999999999999999.999" }).quantityDelta).toBe("999999999999999.999");
  });

  it("keeps a null document number when the source is not readable", () => {
    expect(toStockMovement({ ...row, source_document_number: null }).source.documentNumber).toBeNull();
  });

  it.each([
    { movement_type: "sale_dispatch" }, { source_type: "invoice" }, { quantity_delta: "30" },
    { quantity_delta: "NaN" }, { source_line_id: "x" }, { movement_id: "" },
  ])("rejects malformed row %j", (patch) => {
    expect(() => toStockMovement({ ...row, ...patch })).toThrow();
  });
});

describe("listStockMovements", () => {
  it("reads one tenant-scoped page through the invoker RPC only", async () => {
    const page = await listStockMovements(tenant, { productId: PRODUCT, page: 2 });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("list_stock_movements", {
      p_organization_id: ORG, p_product_id: PRODUCT, p_source_type: null, p_limit: 25, p_offset: 25,
    });
    expect(from).not.toHaveBeenCalled();
    expect(page).toEqual({ items: [toStockMovement(row)], total: 7, page: 2, pageSize: 25 });
  });

  it("throws a safe message without database details", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "XX000", message: "private details" } });
    await expect(listStockMovements(tenant, { productId: null, page: 1 })).rejects.toThrow(/^Could not load stock movements\.$/);
    rpc.mockResolvedValue({ data: [{ ...row, movement_type: "unknown" }], error: null });
    await expect(listStockMovements(tenant, { productId: null, page: 1 })).rejects.toThrow(/^Could not load stock movements\.$/);
  });

  it("returns an empty first page as 0", async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    expect(await listStockMovements(tenant, { productId: null, page: 1 })).toEqual({ items: [], total: 0, page: 1, pageSize: 25 });
  });
});
