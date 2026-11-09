import { beforeEach, describe, expect, it, vi } from "vitest";

// Domain functions: permission checks before any database call, one-statement
// document reads, pre-checks that mirror the database's "re-snapshot only what
// changes" rule, and the RPC payloads (never snapshots, amounts or totals).

type QueryResult = { data: unknown; error: unknown };

const rpc = vi.fn();
const tableResults = new Map<string, QueryResult>();
const queries: { table: string; calls: [string, unknown[]][] }[] = [];

/** A chainable stand-in for supabase.from(table): records calls, resolves to tableResults. */
function from(table: string) {
  const record = { table, calls: [] as [string, unknown[]][] };
  queries.push(record);
  const result = () => tableResults.get(table) ?? { data: null, error: null };
  const builder: Record<string, unknown> = {
    then: (resolve: (value: QueryResult) => unknown) => resolve(result()),
  };
  for (const method of ["select", "eq", "in", "returns"])
    builder[method] = (...args: unknown[]) => {
      record.calls.push([method, args]);
      return builder;
    };
  builder.maybeSingle = (...args: unknown[]) => {
    record.calls.push(["maybeSingle", args]);
    return Promise.resolve(result());
  };
  return builder;
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ rpc, from }),
}));

const {
  createPurchaseOrder,
  getPurchaseOrder,
  updatePurchaseOrderDraft,
} = await import("./purchase-orders");

const ORG_ID = "aaaaaaaa-0000-4000-8000-000000000001";
const VENDOR_ID = "dddddddd-0000-4000-8000-000000000004";
const OTHER_VENDOR_ID = "dddddddd-0000-4000-8000-000000000005";
const PRODUCT_ID = "bbbbbbbb-0000-4000-8000-000000000002";
const INACTIVE_PRODUCT_ID = "bbbbbbbb-0000-4000-8000-000000000009";
const SO_ID = "cccccccc-0000-4000-8000-000000000003";
const LINE_ID = "eeeeeeee-0000-4000-8000-000000000005";

const tenant = (role: "owner" | "manager" | "employee") => ({
  role,
  organization: { id: ORG_ID, name: "Org", currency: "BDT", timezone: "Asia/Dhaka" },
});

const DOC = {
  id: SO_ID,
  purchase_order_number: "PO-000001",
  vendor_id: VENDOR_ID,
  vendor_name: "Later Buyer",
  vendor_company_name: null,
  vendor_phone: null,
  vendor_email: null,
  vendor_address: null,
  vendor_tax_number: null,
  order_date: "2026-11-05",
  expected_delivery_date: null,
  status: "draft",
  notes: "Agreed terms",
  subtotal: "37.50",
  discount_total: "0.00",
  tax_total: "2.81",
  grand_total: "40.31",
  created_at: "2026-11-05T10:00:00+00:00",
  updated_at: "2026-11-05T10:00:00+00:00",
  items: [
    {
      id: LINE_ID,
      product_id: INACTIVE_PRODUCT_ID,
      product_name: "Later Gadget",
      sku: "LG-1",
      description: "Custom later",
      unit: "pcs",
      quantity: "3.000",
      unit_price: "12.50",
      discount_amount: "0.00",
      tax_rate: "7.50",
      tax_amount: "2.81",
      line_total: "40.31",
      sort_order: 1,
    },
  ],
};

const line = (overrides: Partial<{ lineId: string | null; productId: string; unitPrice: string | null }> = {}) => ({
  productId: PRODUCT_ID,
  description: undefined,
  quantity: "3",
  unitPrice: null,
  discountAmount: "0",
  taxRate: "7.5",
  lineId: null,
  ...overrides,
});

const input = (items = [line()], vendorId = VENDOR_ID) => ({
  vendorId,
  orderDate: "2026-11-05",
  expectedDeliveryDate: null,
  notes: null,
  items,
});

beforeEach(() => {
  rpc.mockReset();
  tableResults.clear();
  queries.length = 0;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("getPurchaseOrder", () => {
  it("reads header and items with a single get_purchase_order call", async () => {
    rpc.mockResolvedValue({ data: DOC, error: null });
    const order = await getPurchaseOrder(tenant("employee"), SO_ID);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("get_purchase_order", { p_organization_id: ORG_ID, p_purchase_order_id: SO_ID });
    expect(queries).toHaveLength(0);
    expect(order?.purchaseOrderNumber).toBe("PO-000001");
    expect(order?.items[0].unitPrice).toBe("12.50");
    expect(order?.grandTotal).toBe("40.31");
  });

  it("returns null for malformed IDs without a database call, and for invisible orders", async () => {
    expect(await getPurchaseOrder(tenant("owner"), "not-a-uuid")).toBeNull();
    expect(rpc).not.toHaveBeenCalled();
    rpc.mockResolvedValue({ data: null, error: null });
    expect(await getPurchaseOrder(tenant("owner"), SO_ID)).toBeNull();
  });
});

describe("createPurchaseOrder", () => {
  it("pre-checks vendor and products, then sends only user-controlled values", async () => {
    tableResults.set("vendors", { data: { status: "active" }, error: null });
    tableResults.set("products", {
      data: [{ id: PRODUCT_ID, status: "active", purchase_price: "12.50" }],
      error: null,
    });
    rpc.mockResolvedValue({ data: SO_ID, error: null });

    const result = await createPurchaseOrder(tenant("employee"), input());

    expect(result).toEqual({ ok: true, purchaseOrderId: SO_ID });
    expect(rpc).toHaveBeenCalledWith("create_purchase_order", {
      p_vendor_id: VENDOR_ID,
      p_order_date: "2026-11-05",
      p_expected_delivery_date: null,
      p_notes: null,
      p_items: [{ product_id: PRODUCT_ID, quantity: "3", discount_amount: "0", tax_rate: "7.5" }],
    });
    // Every master-data read is scoped to the tenant.
    for (const query of queries)
      expect(query.calls).toContainEqual(["eq", ["organization_id", ORG_ID]]);
  });

  it("rejects an inactive product with a field error and never calls the RPC", async () => {
    tableResults.set("vendors", { data: { status: "active" }, error: null });
    tableResults.set("products", {
      data: [{ id: PRODUCT_ID, status: "inactive", purchase_price: "1.00" }],
      error: null,
    });
    const result = await createPurchaseOrder(tenant("owner"), input());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("invalid");
      expect(result.itemErrors?.[0]?.productId).toMatch(/inactive/);
    }
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects line IDs on a new order", async () => {
    const result = await createPurchaseOrder(tenant("owner"), input([line({ lineId: LINE_ID })]));
    expect(result).toEqual({ ok: false, reason: "invalid" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("maps database errors", async () => {
    tableResults.set("vendors", { data: { status: "active" }, error: null });
    tableResults.set("products", {
      data: [{ id: PRODUCT_ID, status: "active", purchase_price: "1.00" }],
      error: null,
    });
    rpc.mockResolvedValue({ data: null, error: { code: "23503", message: "vendor is inactive" } });
    expect(await createPurchaseOrder(tenant("owner"), input())).toEqual({
      ok: false,
      reason: "invalid_reference",
    });
  });
});

describe("updatePurchaseOrderDraft", () => {
  it("keeps a line of an inactive product and the unchanged vendor without re-checking them", async () => {
    rpc.mockResolvedValueOnce({ data: DOC, error: null }).mockResolvedValueOnce({ data: null, error: null });

    const result = await updatePurchaseOrderDraft(
      tenant("employee"),
      SO_ID,
      input([line({ lineId: LINE_ID, productId: INACTIVE_PRODUCT_ID })]),
    );

    expect(result).toEqual({ ok: true, purchaseOrderId: SO_ID });
    expect(queries).toHaveLength(0); // neither vendors nor products were read
    expect(rpc).toHaveBeenLastCalledWith("update_purchase_order_draft", {
      p_purchase_order_id: SO_ID,
      p_vendor_id: VENDOR_ID,
      p_order_date: "2026-11-05",
      p_expected_delivery_date: null,
      p_notes: null,
      p_items: [
        { id: LINE_ID, product_id: INACTIVE_PRODUCT_ID, quantity: "3", discount_amount: "0", tax_rate: "7.5" },
      ],
    });
  });

  it("checks a changed vendor and new product selections", async () => {
    rpc.mockResolvedValueOnce({ data: DOC, error: null });
    tableResults.set("vendors", { data: { status: "inactive" }, error: null });
    tableResults.set("products", {
      data: [{ id: INACTIVE_PRODUCT_ID, status: "inactive", purchase_price: "12.50" }],
      error: null,
    });

    // Same product as the kept line, but without its line ID: a new selection.
    const result = await updatePurchaseOrderDraft(
      tenant("owner"),
      SO_ID,
      input([line({ productId: INACTIVE_PRODUCT_ID })], OTHER_VENDOR_ID),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.fieldErrors?.vendorId).toMatch(/inactive/);
      expect(result.itemErrors?.[0]?.productId).toMatch(/inactive/);
    }
    expect(rpc).toHaveBeenCalledTimes(1); // only the read
  });

  it("refuses non-drafts and unknown line IDs before writing", async () => {
    rpc.mockResolvedValueOnce({ data: { ...DOC, status: "ordered" }, error: null });
    expect(await updatePurchaseOrderDraft(tenant("owner"), SO_ID, input())).toEqual({
      ok: false,
      reason: "not_draft",
    });

    rpc.mockResolvedValueOnce({ data: DOC, error: null });
    const result = await updatePurchaseOrderDraft(
      tenant("owner"),
      SO_ID,
      input([line({ lineId: "eeeeeeee-0000-4000-8000-0000000000ff" })]),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.itemErrors?.[0]?.lineId).toBeDefined();
    expect(rpc).toHaveBeenCalledTimes(2); // two reads, no write
  });

  it("returns not_found for missing or other-tenant orders", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: null });
    expect(await updatePurchaseOrderDraft(tenant("owner"), SO_ID, input())).toEqual({
      ok: false,
      reason: "not_found",
    });
  });
});


describe("purchase price and status RPC safeguards", () => {
  it("uses purchase_price, even when selling_price differs", async () => {
    tableResults.set("vendors", { data: { status: "active" }, error: null });
    tableResults.set("products", { data: [{ id: PRODUCT_ID, status: "active", purchase_price: "2.00", selling_price: "999.00" }], error: null });
    rpc.mockResolvedValue({ data: SO_ID, error: null });
    expect(await createPurchaseOrder(tenant("employee"), input())).toEqual({ ok: true, purchaseOrderId: SO_ID });
    expect(queries.find(q => q.table === "products")?.calls).toContainEqual(["select", ["id, status, purchase_price::text"]]);
    expect(rpc.mock.calls[0][1].p_items[0]).not.toHaveProperty("unit_price");
  });
  it("requires an explicit price when there is no purchase price", async () => {
    tableResults.set("vendors", { data: { status: "active" }, error: null });
    tableResults.set("products", { data: [{ id: PRODUCT_ID, status: "active", purchase_price: null, selling_price: "999.00" }], error: null });
    const result = await createPurchaseOrder(tenant("owner"), input());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.itemErrors?.[0]?.unitPrice).toContain("purchase price");
    expect(rpc).not.toHaveBeenCalled();
  });
  it("submits A → B → inactive A with the original token and recorded defaults", async () => {
    const saved = {
      ...DOC,
      items: [{ ...DOC.items[0], discount_amount: "1.25" }],
    };
    rpc.mockResolvedValueOnce({ data: saved, error: null });
    const original = (await getPurchaseOrder(tenant("owner"), SO_ID))!.items[0];
    expect(original).toMatchObject({
      id: LINE_ID, productId: INACTIVE_PRODUCT_ID,
      productName: "Later Gadget", sku: "LG-1", description: "Custom later",
      unit: "pcs", unitPrice: "12.50",
    });

    // B is an unsaved selection in the same edit. Saving would consume the
    // reference token. Name/SKU/unit are database snapshots, never write inputs.
    const productB = {
      id: PRODUCT_ID, name: "Product B", sku: "B-2",
      description: "B description", unit: "box", purchasePrice: "99.00",
    };
    const changed = {
      lineId: original.id, productId: productB.id,
      description: productB.description, unitPrice: productB.purchasePrice,
      quantity: original.quantity, discountAmount: original.discountAmount,
      taxRate: original.taxRate,
    };
    expect(changed).toMatchObject({
      lineId: LINE_ID, productId: PRODUCT_ID,
      description: "B description", unitPrice: "99.00",
    });
    expect(productB.unit).not.toBe(original.unit);

    // Existing-line semantics restore A's recorded description and PO price
    // by omitting overrides, rather than submitting B's values or master data.
    const restored = {
      ...changed, productId: original.productId,
      description: undefined, unitPrice: null,
    };
    tableResults.set("products", {
      data: [{ id: INACTIVE_PRODUCT_ID, status: "inactive", purchase_price: "500.00" }],
      error: null,
    });
    rpc.mockResolvedValueOnce({ data: saved, error: null }).mockResolvedValueOnce({ data: null, error: null });
    expect(await updatePurchaseOrderDraft(tenant("owner"), SO_ID, input([restored])))
      .toEqual({ ok: true, purchaseOrderId: SO_ID });
    expect(queries).toEqual([]); // Inactive A needs no current-product lookup.
    expect(rpc).toHaveBeenCalledTimes(3); // load A, re-read before update, write
    expect(rpc).toHaveBeenLastCalledWith("update_purchase_order_draft", {
      p_purchase_order_id: SO_ID, p_vendor_id: VENDOR_ID,
      p_order_date: "2026-11-05", p_expected_delivery_date: null, p_notes: null,
      p_items: [{
        id: LINE_ID, product_id: INACTIVE_PRODUCT_ID,
        quantity: "3.000", discount_amount: "1.25", tax_rate: "7.50",
      }],
    });
    // Actual snapshot restoration is also asserted against PostgreSQL in
    // supabase/tests/purchase_orders.sql, without mocking the write RPC.
  });
  it("rejects receiving targets and employee cancellation before database calls", async () => {
    const { setPurchaseOrderStatus } = await import("./purchase-orders");
    for (const status of ["partially_received", "received"] as const) {
      // Simulate runtime input bypassing the static user-target type.
      expect(await setPurchaseOrderStatus(tenant("owner"), SO_ID, status as "ordered")).toEqual({ ok: false, reason: "reserved_receiving_status" });
    }
    expect(await setPurchaseOrderStatus(tenant("employee"), SO_ID, "cancelled")).toEqual({ ok: false, reason: "forbidden" });
    expect(rpc).not.toHaveBeenCalled();
    rpc.mockResolvedValue({ data: null, error: null });
    expect((await setPurchaseOrderStatus(tenant("employee"), SO_ID, "ordered")).ok).toBe(true);
    expect(rpc).toHaveBeenCalledWith("set_purchase_order_status", { p_purchase_order_id: SO_ID, p_status: "ordered" });
  });
  it("returns the ordering-check reason with only the parsed line numbers", async () => {
    const { setPurchaseOrderStatus } = await import("./purchase-orders");
    rpc.mockResolvedValueOnce({ data: null, error: { code: "ST006", message: "private", details: "lines: 2,4" } });
    expect(await setPurchaseOrderStatus(tenant("employee"), SO_ID, "ordered"))
      .toEqual({ ok: false, reason: "product_type_changed", affectedLines: [2, 4] });
    rpc.mockResolvedValueOnce({ data: null, error: { code: "ST006", message: "private", details: "unexpected" } });
    expect(await setPurchaseOrderStatus(tenant("employee"), SO_ID, "ordered")).toEqual({ ok: false, reason: "product_type_changed" });
  });
});
