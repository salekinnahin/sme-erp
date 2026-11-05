import { beforeEach, describe, expect, it, vi } from "vitest";

// Domain functions: permission checks before any database call, one-statement
// document reads, pre-checks that mirror the database's "re-snapshot only what
// changes" rule, and the RPC payloads (never snapshots, amounts, totals,
// status or balance).

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
  createInvoice,
  createInvoiceFromSalesOrder,
  getInvoice,
  listInvoices,
  getInvoiceForSalesOrder,
  setInvoiceStatus,
  updateInvoiceDraft,
} = await import("./invoices");

const ORG_ID = "aaaaaaaa-0000-4000-8000-000000000001";
const CUSTOMER_ID = "dddddddd-0000-4000-8000-000000000004";
const OTHER_CUSTOMER_ID = "dddddddd-0000-4000-8000-000000000005";
const PRODUCT_ID = "bbbbbbbb-0000-4000-8000-000000000002";
const INACTIVE_PRODUCT_ID = "bbbbbbbb-0000-4000-8000-000000000009";
const INVOICE_ID = "cccccccc-0000-4000-8000-000000000003";
const LINE_ID = "eeeeeeee-0000-4000-8000-000000000005";
const SALES_ORDER_ID = "ffffffff-0000-4000-8000-000000000006";

const tenant = (role: "owner" | "manager" | "employee") => ({
  role,
  organization: { id: ORG_ID, name: "Org", currency: "BDT", timezone: "Asia/Dhaka" },
});

const DOC = {
  id: INVOICE_ID,
  invoice_number: "INV-000001",
  customer_id: CUSTOMER_ID,
  source_sales_order_id: SALES_ORDER_ID,
  source_sales_order_number: "SO-000001",
  customer_name: "Later Buyer",
  customer_company_name: null,
  customer_phone: null,
  customer_email: null,
  customer_address: null,
  customer_tax_number: null,
  invoice_date: "2026-11-05",
  due_date: "2026-12-05",
  status: "draft",
  notes: "Agreed terms",
  subtotal: "37.50",
  discount_total: "0.00",
  tax_total: "2.81",
  grand_total: "40.31",
  amount_paid: "0.00",
  amount_due: "40.31",
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
  invoiceDate: "2026-11-05",
  dueDate: null,
  notes: null,
  items,
});

beforeEach(() => {
  rpc.mockReset();
  tableResults.clear();
  queries.length = 0;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("getInvoice", () => {
  it("reads header, items and balance with a single get_invoice call", async () => {
    rpc.mockResolvedValue({ data: DOC, error: null });
    const invoice = await getInvoice(tenant("employee"), INVOICE_ID);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("get_invoice", { p_organization_id: ORG_ID, p_invoice_id: INVOICE_ID });
    expect(queries).toHaveLength(0);
    expect(invoice).toMatchObject({
      invoiceNumber: "INV-000001",
      sourceSalesOrderNumber: "SO-000001",
      dueDate: "2026-12-05",
      grandTotal: "40.31",
      amountPaid: "0.00",
      amountDue: "40.31",
    });
    expect(invoice?.items[0].unitPrice).toBe("12.50");
  });

  it("returns null for malformed IDs without a database call, and for invisible invoices", async () => {
    expect(await getInvoice(tenant("owner"), "not-a-uuid")).toBeNull();
    expect(rpc).not.toHaveBeenCalled();
    rpc.mockResolvedValue({ data: null, error: null });
    expect(await getInvoice(tenant("owner"), INVOICE_ID)).toBeNull();
  });

  it("throws on database errors (never 'not found')", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "XX000" } });
    await expect(getInvoice(tenant("owner"), INVOICE_ID)).rejects.toThrow();
  });
});

describe("createInvoice", () => {
  it("pre-checks customer and products, then sends only user-controlled values", async () => {
    tableResults.set("customers", { data: { status: "active" }, error: null });
    tableResults.set("products", {
      data: [{ id: PRODUCT_ID, status: "active", selling_price: "12.50" }],
      error: null,
    });
    rpc.mockResolvedValue({ data: INVOICE_ID, error: null });

    const result = await createInvoice(tenant("employee"), input());

    expect(result).toEqual({ ok: true, invoiceId: INVOICE_ID });
    expect(rpc).toHaveBeenCalledWith("create_invoice", {
      p_customer_id: CUSTOMER_ID,
      p_invoice_date: "2026-11-05",
      p_due_date: null,
      p_notes: null,
      p_items: [{ product_id: PRODUCT_ID, quantity: "3", discount_amount: "0", tax_rate: "7.5" }],
    });
    // Every master-data read is scoped to the tenant.
    for (const query of queries) expect(query.calls).toContainEqual(["eq", ["organization_id", ORG_ID]]);
  });

  it("rejects an inactive product or customer with field errors and never calls the RPC", async () => {
    tableResults.set("customers", { data: { status: "inactive" }, error: null });
    tableResults.set("products", {
      data: [{ id: PRODUCT_ID, status: "inactive", selling_price: "1.00" }],
      error: null,
    });
    const result = await createInvoice(tenant("owner"), input());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("invalid");
      expect(result.fieldErrors?.customerId).toMatch(/inactive/);
      expect(result.itemErrors?.[0]?.productId).toMatch(/inactive/);
    }
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects an unknown (or other-tenant) product and a product without a price", async () => {
    tableResults.set("customers", { data: { status: "active" }, error: null });
    tableResults.set("products", { data: [{ id: PRODUCT_ID, status: "active", selling_price: null }], error: null });
    const result = await createInvoice(
      tenant("owner"),
      input([line(), line({ productId: INACTIVE_PRODUCT_ID })]),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.itemErrors?.[0]?.unitPrice).toMatch(/unit price/);
      expect(result.itemErrors?.[1]?.productId).toMatch(/from the list/);
    }
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects line IDs on a new invoice", async () => {
    const result = await createInvoice(tenant("owner"), input([line({ lineId: LINE_ID })]));
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
    expect(await createInvoice(tenant("owner"), input())).toEqual({ ok: false, reason: "invalid_reference" });
  });
});

describe("createInvoiceFromSalesOrder", () => {
  const conversion = { salesOrderId: SALES_ORDER_ID, invoiceDate: "2026-11-05", dueDate: null };

  it("calls the conversion RPC with the sales order and dates only", async () => {
    rpc.mockResolvedValue({ data: INVOICE_ID, error: null });
    expect(await createInvoiceFromSalesOrder(tenant("employee"), conversion)).toEqual({
      ok: true,
      invoiceId: INVOICE_ID,
    });
    expect(rpc).toHaveBeenCalledWith("create_invoice_from_sales_order", {
      p_sales_order_id: SALES_ORDER_ID,
      p_invoice_date: "2026-11-05",
      p_due_date: null,
    });
    expect(queries).toHaveLength(0);
  });

  it("maps not confirmed, already invoiced and not found", async () => {
    for (const [code, reason] of [
      ["55000", "sales_order_not_confirmed"],
      ["23505", "already_invoiced"],
      ["P0002", "not_found"],
    ]) {
      rpc.mockResolvedValueOnce({ data: null, error: { code } });
      expect(await createInvoiceFromSalesOrder(tenant("owner"), conversion)).toEqual({ ok: false, reason });
    }
  });

  it("returns not_found for a malformed sales order ID without a database call", async () => {
    expect(
      await createInvoiceFromSalesOrder(tenant("owner"), { ...conversion, salesOrderId: "nope" }),
    ).toEqual({ ok: false, reason: "not_found" });
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("updateInvoiceDraft", () => {
  it("keeps a line of an inactive product and the unchanged customer without re-checking them", async () => {
    rpc.mockResolvedValueOnce({ data: DOC, error: null }).mockResolvedValueOnce({ data: null, error: null });

    const result = await updateInvoiceDraft(
      tenant("employee"),
      INVOICE_ID,
      input([line({ lineId: LINE_ID, productId: INACTIVE_PRODUCT_ID })]),
    );

    expect(result).toEqual({ ok: true, invoiceId: INVOICE_ID });
    expect(queries).toHaveLength(0); // neither customers nor products were read
    expect(rpc).toHaveBeenLastCalledWith("update_invoice_draft", {
      p_invoice_id: INVOICE_ID,
      p_customer_id: CUSTOMER_ID,
      p_invoice_date: "2026-11-05",
      p_due_date: null,
      p_notes: null,
      p_items: [
        { id: LINE_ID, product_id: INACTIVE_PRODUCT_ID, quantity: "3", discount_amount: "0", tax_rate: "7.5" },
      ],
    });
  });

  it("checks a changed customer and new product selections (also a line ID with a changed product)", async () => {
    rpc.mockResolvedValueOnce({ data: DOC, error: null });
    tableResults.set("customers", { data: { status: "inactive" }, error: null });
    tableResults.set("products", {
      data: [
        { id: INACTIVE_PRODUCT_ID, status: "inactive", selling_price: "12.50" },
        { id: PRODUCT_ID, status: "inactive", selling_price: "1.00" },
      ],
      error: null,
    });

    const result = await updateInvoiceDraft(
      tenant("owner"),
      INVOICE_ID,
      input(
        [
          // Same product as the kept line, but without its line ID: a new selection.
          line({ productId: INACTIVE_PRODUCT_ID }),
          // The kept line's ID with a different product: also a new selection.
          line({ lineId: LINE_ID, productId: PRODUCT_ID }),
        ],
        OTHER_CUSTOMER_ID,
      ),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.fieldErrors?.customerId).toMatch(/inactive/);
      expect(result.itemErrors?.[0]?.productId).toMatch(/inactive/);
      expect(result.itemErrors?.[1]?.productId).toMatch(/inactive/);
    }
    expect(rpc).toHaveBeenCalledTimes(1); // only the read
  });

  it("refuses non-drafts and unknown line IDs before writing", async () => {
    for (const status of ["issued", "cancelled", "paid"]) {
      rpc.mockResolvedValueOnce({ data: { ...DOC, status }, error: null });
      expect(await updateInvoiceDraft(tenant("owner"), INVOICE_ID, input())).toEqual({
        ok: false,
        reason: "not_draft",
      });
    }

    rpc.mockReset();
    rpc.mockResolvedValueOnce({ data: DOC, error: null });
    const result = await updateInvoiceDraft(
      tenant("owner"),
      INVOICE_ID,
      input([line({ lineId: "eeeeeeee-0000-4000-8000-0000000000ff" })]),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.itemErrors?.[0]?.lineId).toBeDefined();
    expect(rpc).toHaveBeenCalledTimes(1); // the read, no write
  });

  it("returns not_found for missing or other-tenant invoices", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: null });
    expect(await updateInvoiceDraft(tenant("owner"), INVOICE_ID, input())).toEqual({
      ok: false,
      reason: "not_found",
    });
    expect(await updateInvoiceDraft(tenant("owner"), "nope", input())).toEqual({ ok: false, reason: "not_found" });
  });
});

describe("setInvoiceStatus", () => {
  it("refuses cancel for employees without a database call", async () => {
    expect(await setInvoiceStatus(tenant("employee"), INVOICE_ID, "cancelled")).toEqual({
      ok: false,
      reason: "forbidden",
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses payment statuses for every role without a database call", async () => {
    for (const role of ["owner", "manager", "employee"] as const)
      for (const status of ["paid", "partially_paid", "draft", "bogus"])
        expect(
          await setInvoiceStatus(tenant(role), INVOICE_ID, status as unknown as "issued"),
        ).toEqual({ ok: false, reason: "invalid" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("lets every role issue, and owners and managers cancel", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    expect((await setInvoiceStatus(tenant("employee"), INVOICE_ID, "issued")).ok).toBe(true);
    expect((await setInvoiceStatus(tenant("manager"), INVOICE_ID, "cancelled")).ok).toBe(true);
    expect((await setInvoiceStatus(tenant("owner"), INVOICE_ID, "cancelled")).ok).toBe(true);
    expect(rpc).toHaveBeenCalledWith("set_invoice_status", { p_invoice_id: INVOICE_ID, p_status: "issued" });
  });

  it("maps invalid transitions and database permission errors", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: "55000" } });
    expect(await setInvoiceStatus(tenant("owner"), INVOICE_ID, "cancelled")).toEqual({
      ok: false,
      reason: "invalid_transition",
    });
    rpc.mockResolvedValueOnce({ data: null, error: { code: "42501" } });
    expect(await setInvoiceStatus(tenant("owner"), INVOICE_ID, "cancelled")).toEqual({
      ok: false,
      reason: "forbidden",
    });
  });
});

describe("getInvoiceForSalesOrder", () => {
  it("looks up by tenant and source sales order in one query", async () => {
    tableResults.set("invoices", {
      data: { id: INVOICE_ID, invoice_number: "INV-000007", status: "cancelled" },
      error: null,
    });
    expect(await getInvoiceForSalesOrder(tenant("employee"), SALES_ORDER_ID.toUpperCase())).toEqual({
      id: INVOICE_ID,
      invoiceNumber: "INV-000007",
      status: "cancelled",
    });
    expect(queries).toHaveLength(1);
    expect(queries[0].calls).toContainEqual(["eq", ["organization_id", ORG_ID]]);
    expect(queries[0].calls).toContainEqual(["eq", ["source_sales_order_id", SALES_ORDER_ID]]);
  });

  it("returns null when not invoiced or malformed; throws on errors (never 'not invoiced')", async () => {
    expect(await getInvoiceForSalesOrder(tenant("owner"), SALES_ORDER_ID)).toBeNull();
    expect(await getInvoiceForSalesOrder(tenant("owner"), "nope")).toBeNull();
    expect(queries).toHaveLength(1);
    tableResults.set("invoices", { data: null, error: { code: "XX000" } });
    await expect(getInvoiceForSalesOrder(tenant("owner"), SALES_ORDER_ID)).rejects.toThrow();
  });
});


describe("invoice list read", () => {
  it("uses the tenant-filtered RPC and preserves exact money/balance strings", async () => {
    rpc.mockResolvedValue({ data: [{ ...DOC, total_count: "31" }], error: null });
    const result = await listInvoices(tenant("employee"), { search: "100%", status: "issued", customer: "all", page: 2 });
    expect(rpc).toHaveBeenCalledWith("list_invoices", {
      p_organization_id: ORG_ID, p_search: "100%", p_status: "issued", p_customer_id: null, p_limit: 25, p_offset: 25,
    });
    expect(result).toMatchObject({ total: 31, page: 2, pageSize: 25, items: [{ grandTotal: "40.31", amountPaid: "0.00", amountDue: "40.31", sourceSalesOrderNumber: "SO-000001" }] });
  });
  it("distinguishes no matches from a page past the end and throws on DB failure", async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    const params = { search: "", status: "all" as const, customer: "all", page: 1 };
    expect((await listInvoices(tenant("owner"), params)).total).toBe(0);
    expect((await listInvoices(tenant("owner"), { ...params, page: 5 })).total).toBeNull();
    rpc.mockResolvedValue({ data: null, error: { message: "private" } });
    await expect(listInvoices(tenant("owner"), params)).rejects.toThrow("Failed to load invoices.");
  });
});
