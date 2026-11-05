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
  createSalesOrder,
  createSalesOrderFromQuotation,
  getSalesOrder,
  setSalesOrderStatus,
  updateSalesOrderDraft,
} = await import("./sales-orders");

const ORG_ID = "aaaaaaaa-0000-4000-8000-000000000001";
const CUSTOMER_ID = "dddddddd-0000-4000-8000-000000000004";
const OTHER_CUSTOMER_ID = "dddddddd-0000-4000-8000-000000000005";
const PRODUCT_ID = "bbbbbbbb-0000-4000-8000-000000000002";
const INACTIVE_PRODUCT_ID = "bbbbbbbb-0000-4000-8000-000000000009";
const SO_ID = "cccccccc-0000-4000-8000-000000000003";
const LINE_ID = "eeeeeeee-0000-4000-8000-000000000005";
const QUOTATION_ID = "ffffffff-0000-4000-8000-000000000006";

const tenant = (role: "owner" | "manager" | "employee") => ({
  role,
  organization: { id: ORG_ID, name: "Org", currency: "BDT", timezone: "Asia/Dhaka" },
});

const DOC = {
  id: SO_ID,
  sales_order_number: "SO-000001",
  customer_id: CUSTOMER_ID,
  source_quotation_id: QUOTATION_ID,
  source_quotation_number: "QT-000001",
  customer_name: "Later Buyer",
  customer_company_name: null,
  customer_phone: null,
  customer_email: null,
  customer_address: null,
  customer_tax_number: null,
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

const input = (items = [line()], customerId = CUSTOMER_ID) => ({
  customerId,
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

describe("getSalesOrder", () => {
  it("reads header and items with a single get_sales_order call", async () => {
    rpc.mockResolvedValue({ data: DOC, error: null });
    const order = await getSalesOrder(tenant("employee"), SO_ID);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("get_sales_order", { p_organization_id: ORG_ID, p_sales_order_id: SO_ID });
    expect(queries).toHaveLength(0);
    expect(order?.salesOrderNumber).toBe("SO-000001");
    expect(order?.sourceQuotationNumber).toBe("QT-000001");
    expect(order?.items[0].unitPrice).toBe("12.50");
    expect(order?.grandTotal).toBe("40.31");
  });

  it("returns null for malformed IDs without a database call, and for invisible orders", async () => {
    expect(await getSalesOrder(tenant("owner"), "not-a-uuid")).toBeNull();
    expect(rpc).not.toHaveBeenCalled();
    rpc.mockResolvedValue({ data: null, error: null });
    expect(await getSalesOrder(tenant("owner"), SO_ID)).toBeNull();
  });
});

describe("createSalesOrder", () => {
  it("pre-checks customer and products, then sends only user-controlled values", async () => {
    tableResults.set("customers", { data: { status: "active" }, error: null });
    tableResults.set("products", {
      data: [{ id: PRODUCT_ID, status: "active", selling_price: "12.50" }],
      error: null,
    });
    rpc.mockResolvedValue({ data: SO_ID, error: null });

    const result = await createSalesOrder(tenant("employee"), input());

    expect(result).toEqual({ ok: true, salesOrderId: SO_ID });
    expect(rpc).toHaveBeenCalledWith("create_sales_order", {
      p_customer_id: CUSTOMER_ID,
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
    tableResults.set("customers", { data: { status: "active" }, error: null });
    tableResults.set("products", {
      data: [{ id: PRODUCT_ID, status: "inactive", selling_price: "1.00" }],
      error: null,
    });
    const result = await createSalesOrder(tenant("owner"), input());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("invalid");
      expect(result.itemErrors?.[0]?.productId).toMatch(/inactive/);
    }
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects line IDs on a new order", async () => {
    const result = await createSalesOrder(tenant("owner"), input([line({ lineId: LINE_ID })]));
    expect(result).toEqual({ ok: false, reason: "invalid" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("maps database errors", async () => {
    tableResults.set("customers", { data: { status: "active" }, error: null });
    tableResults.set("products", {
      data: [{ id: PRODUCT_ID, status: "active", selling_price: "1.00" }],
      error: null,
    });
    rpc.mockResolvedValue({ data: null, error: { code: "23503", message: "customer is inactive" } });
    expect(await createSalesOrder(tenant("owner"), input())).toEqual({
      ok: false,
      reason: "invalid_reference",
    });
  });
});

describe("createSalesOrderFromQuotation", () => {
  const conversion = { quotationId: QUOTATION_ID, orderDate: "2026-11-05", expectedDeliveryDate: null };

  it("calls the conversion RPC with the quotation and dates only", async () => {
    rpc.mockResolvedValue({ data: SO_ID, error: null });
    expect(await createSalesOrderFromQuotation(tenant("employee"), conversion)).toEqual({
      ok: true,
      salesOrderId: SO_ID,
    });
    expect(rpc).toHaveBeenCalledWith("create_sales_order_from_quotation", {
      p_quotation_id: QUOTATION_ID,
      p_order_date: "2026-11-05",
      p_expected_delivery_date: null,
    });
    expect(queries).toHaveLength(0);
  });

  it("maps not accepted, already converted and not found", async () => {
    for (const [code, reason] of [
      ["55000", "quotation_not_accepted"],
      ["23505", "already_converted"],
      ["P0002", "not_found"],
    ]) {
      rpc.mockResolvedValueOnce({ data: null, error: { code } });
      expect(await createSalesOrderFromQuotation(tenant("owner"), conversion)).toEqual({ ok: false, reason });
    }
  });

  it("returns not_found for a malformed quotation ID without a database call", async () => {
    expect(
      await createSalesOrderFromQuotation(tenant("owner"), { ...conversion, quotationId: "nope" }),
    ).toEqual({ ok: false, reason: "not_found" });
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("updateSalesOrderDraft", () => {
  it("keeps a line of an inactive product and the unchanged customer without re-checking them", async () => {
    rpc.mockResolvedValueOnce({ data: DOC, error: null }).mockResolvedValueOnce({ data: null, error: null });

    const result = await updateSalesOrderDraft(
      tenant("employee"),
      SO_ID,
      input([line({ lineId: LINE_ID, productId: INACTIVE_PRODUCT_ID })]),
    );

    expect(result).toEqual({ ok: true, salesOrderId: SO_ID });
    expect(queries).toHaveLength(0); // neither customers nor products were read
    expect(rpc).toHaveBeenLastCalledWith("update_sales_order_draft", {
      p_sales_order_id: SO_ID,
      p_customer_id: CUSTOMER_ID,
      p_order_date: "2026-11-05",
      p_expected_delivery_date: null,
      p_notes: null,
      p_items: [
        { id: LINE_ID, product_id: INACTIVE_PRODUCT_ID, quantity: "3", discount_amount: "0", tax_rate: "7.5" },
      ],
    });
  });

  it("checks a changed customer and new product selections", async () => {
    rpc.mockResolvedValueOnce({ data: DOC, error: null });
    tableResults.set("customers", { data: { status: "inactive" }, error: null });
    tableResults.set("products", {
      data: [{ id: INACTIVE_PRODUCT_ID, status: "inactive", selling_price: "12.50" }],
      error: null,
    });

    // Same product as the kept line, but without its line ID: a new selection.
    const result = await updateSalesOrderDraft(
      tenant("owner"),
      SO_ID,
      input([line({ productId: INACTIVE_PRODUCT_ID })], OTHER_CUSTOMER_ID),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.fieldErrors?.customerId).toMatch(/inactive/);
      expect(result.itemErrors?.[0]?.productId).toMatch(/inactive/);
    }
    expect(rpc).toHaveBeenCalledTimes(1); // only the read
  });

  it("refuses non-drafts and unknown line IDs before writing", async () => {
    rpc.mockResolvedValueOnce({ data: { ...DOC, status: "confirmed" }, error: null });
    expect(await updateSalesOrderDraft(tenant("owner"), SO_ID, input())).toEqual({
      ok: false,
      reason: "not_draft",
    });

    rpc.mockResolvedValueOnce({ data: DOC, error: null });
    const result = await updateSalesOrderDraft(
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
    expect(await updateSalesOrderDraft(tenant("owner"), SO_ID, input())).toEqual({
      ok: false,
      reason: "not_found",
    });
  });
});

describe("setSalesOrderStatus", () => {
  it("refuses complete and cancel for employees without a database call", async () => {
    for (const status of ["completed", "cancelled"] as const)
      expect(await setSalesOrderStatus(tenant("employee"), SO_ID, status)).toEqual({
        ok: false,
        reason: "forbidden",
      });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("lets every role confirm, and managers complete and cancel", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    expect((await setSalesOrderStatus(tenant("employee"), SO_ID, "confirmed")).ok).toBe(true);
    expect((await setSalesOrderStatus(tenant("manager"), SO_ID, "completed")).ok).toBe(true);
    expect((await setSalesOrderStatus(tenant("owner"), SO_ID, "cancelled")).ok).toBe(true);
    expect(rpc).toHaveBeenCalledWith("set_sales_order_status", { p_sales_order_id: SO_ID, p_status: "confirmed" });
  });

  it("rejects unknown target statuses and maps invalid transitions", async () => {
    expect(
      await setSalesOrderStatus(tenant("owner"), SO_ID, "draft" as unknown as "confirmed"),
    ).toEqual({ ok: false, reason: "invalid" });
    rpc.mockResolvedValue({ data: null, error: { code: "55000" } });
    expect(await setSalesOrderStatus(tenant("owner"), SO_ID, "completed")).toEqual({
      ok: false,
      reason: "invalid_transition",
    });
  });
});

// -----------------------------------------------------------------------------
// Part 2: list, quotation lookup, and the edit-form regression end to end
// -----------------------------------------------------------------------------

const { listSalesOrders, getSalesOrderForQuotation } = await import("./sales-orders");
const { salesOrderToFormValues, serializeSalesOrderLines, parseSalesOrderFormItems } = await import("./form");
const { validateSalesOrderInput } = await import("./validation");

describe("listSalesOrders", () => {
  it("calls list_sales_orders with the tenant organization and maps rows (money as text)", async () => {
    rpc.mockResolvedValue({
      data: [
        {
          id: SO_ID, sales_order_number: "SO-000002", customer_id: CUSTOMER_ID, customer_name: "Buyer",
          customer_company_name: null, order_date: "2026-11-05", expected_delivery_date: null, status: "confirmed",
          grand_total: "12345678901234.56", source_quotation_id: QUOTATION_ID, source_quotation_number: "QT-000003",
          created_at: "2026-11-05T10:00:00Z", total_count: "26",
        },
      ],
      error: null,
    });
    const list = await listSalesOrders(tenant("employee"), { search: "so", status: "confirmed", customer: "all", page: 2 });
    expect(rpc).toHaveBeenCalledWith("list_sales_orders", {
      p_organization_id: ORG_ID, p_search: "so", p_status: "confirmed", p_customer_id: null, p_limit: 25, p_offset: 25,
    });
    expect(list).toMatchObject({ total: 26, page: 2, pageSize: 25 });
    expect(list.items[0]).toMatchObject({ grandTotal: "12345678901234.56", sourceQuotationNumber: "QT-000003" });
  });

  it("reports an empty first page as 0 and a page past the end as null; throws on errors", async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    expect((await listSalesOrders(tenant("owner"), { search: "", status: "all", customer: "all", page: 1 })).total).toBe(0);
    expect((await listSalesOrders(tenant("owner"), { search: "", status: "all", customer: "all", page: 9 })).total).toBeNull();
    rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "denied" } });
    await expect(listSalesOrders(tenant("owner"), { search: "", status: "all", customer: "all", page: 1 })).rejects.toThrow();
  });
});

describe("getSalesOrderForQuotation", () => {
  it("looks up by tenant and source quotation in one query", async () => {
    tableResults.set("sales_orders", { data: { id: SO_ID, sales_order_number: "SO-000007" }, error: null });
    expect(await getSalesOrderForQuotation(tenant("employee"), QUOTATION_ID.toUpperCase())).toEqual({
      id: SO_ID,
      salesOrderNumber: "SO-000007",
    });
    expect(queries).toHaveLength(1);
    expect(queries[0].calls).toContainEqual(["eq", ["organization_id", ORG_ID]]);
    expect(queries[0].calls).toContainEqual(["eq", ["source_quotation_id", QUOTATION_ID]]);
  });

  it("returns null when not converted or malformed; throws on errors (never 'not converted')", async () => {
    expect(await getSalesOrderForQuotation(tenant("owner"), QUOTATION_ID)).toBeNull();
    expect(await getSalesOrderForQuotation(tenant("owner"), "nope")).toBeNull();
    expect(queries).toHaveLength(1);
    tableResults.set("sales_orders", { data: null, error: { code: "XX000" } });
    await expect(getSalesOrderForQuotation(tenant("owner"), QUOTATION_ID)).rejects.toThrow();
  });
});

describe("edit form → updateSalesOrderDraft (regression)", () => {
  it("a notes-only edit of a draft with an inactive product sends the existing line ID and never re-checks the product", async () => {
    rpc.mockImplementation(async (name: string) =>
      name === "get_sales_order" ? { data: DOC, error: null } : { data: null, error: null },
    );
    const order = await getSalesOrder(tenant("employee"), SO_ID);
    if (!order) throw new Error("no order");
    const values = { ...salesOrderToFormValues(order), notes: "Notes only" };

    const parsed = parseSalesOrderFormItems(serializeSalesOrderLines(values.lines));
    if (!parsed.ok) throw new Error("unreadable");
    const valid = validateSalesOrderInput({ ...values, items: parsed.items });
    if (!valid.ok) throw new Error("invalid");

    queries.length = 0;
    rpc.mockClear();
    const result = await updateSalesOrderDraft(tenant("employee"), SO_ID, valid.value);
    expect(result).toEqual({ ok: true, salesOrderId: SO_ID });
    // Neither the unchanged customer nor the kept inactive product is read.
    expect(queries.map((q) => q.table)).toEqual([]);
    const update = rpc.mock.calls.find(([name]) => name === "update_sales_order_draft");
    expect(update?.[1]).toMatchObject({
      p_sales_order_id: SO_ID,
      p_customer_id: CUSTOMER_ID,
      p_notes: "Notes only",
      p_items: [{ id: LINE_ID, product_id: INACTIVE_PRODUCT_ID, quantity: "3", unit_price: "12.50" }],
    });
  });
});
