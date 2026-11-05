import { beforeEach, describe, expect, it, vi } from "vitest";

// getQuotation() must read the header and the items in ONE database
// statement (public.get_quotation()). Two requests could return a mixed
// document if a draft is saved in between. These tests fail if the read is
// split into separate header/item queries again.

const rpc = vi.fn();
const from = vi.fn(() => {
  throw new Error("getQuotation must not query tables directly");
});

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ rpc, from }),
}));

const { getQuotation, listQuotations } = await import("./quotations");

const ORG_ID = "aaaaaaaa-0000-4000-8000-000000000001";
const QUOTATION_ID = "cccccccc-0000-4000-8000-000000000003";

const tenant = {
  role: "employee" as const,
  organization: { id: ORG_ID, name: "Org", currency: "BDT", timezone: "Asia/Dhaka" },
};

const DOC = {
  id: QUOTATION_ID,
  quotation_number: "QT-000001",
  customer_id: "dddddddd-0000-4000-8000-000000000004",
  customer_name: "Acme Buyer",
  customer_company_name: "Acme Ltd",
  customer_phone: null,
  customer_email: "buyer@acme.test",
  customer_address: null,
  customer_tax_number: null,
  quotation_date: "2026-11-04",
  expiry_date: null,
  status: "draft",
  notes: null,
  subtotal: "9999999999999999.99",
  discount_total: "0.00",
  tax_total: "0.00",
  grand_total: "9999999999999999.99",
  created_at: "2026-11-04T10:00:00+00:00",
  updated_at: "2026-11-04T10:00:00+00:00",
  items: [
    {
      id: "eeeeeeee-0000-4000-8000-000000000005",
      product_id: "bbbbbbbb-0000-4000-8000-000000000002",
      product_name: "Laptop",
      sku: "LAP-1",
      description: null,
      unit: "pcs",
      quantity: "1.000",
      unit_price: "9999999999999999.99",
      discount_amount: "0.00",
      tax_rate: "0.00",
      tax_amount: "0.00",
      line_total: "9999999999999999.99",
      sort_order: 1,
    },
  ],
};

beforeEach(() => {
  rpc.mockReset();
  from.mockClear();
});

describe("getQuotation", () => {
  it("reads header and items with a single get_quotation call", async () => {
    rpc.mockResolvedValue({ data: DOC, error: null });

    const quotation = await getQuotation(tenant, QUOTATION_ID);

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("get_quotation", {
      p_organization_id: ORG_ID,
      p_quotation_id: QUOTATION_ID,
    });
    expect(from).not.toHaveBeenCalled();

    expect(quotation).toMatchObject({
      id: QUOTATION_ID,
      quotationNumber: "QT-000001",
      customerName: "Acme Buyer",
      status: "draft",
      // Exact decimal strings, untouched by floating point.
      grandTotal: "9999999999999999.99",
      items: [
        {
          productName: "Laptop",
          quantity: "1.000",
          unitPrice: "9999999999999999.99",
          lineTotal: "9999999999999999.99",
          sortOrder: 1,
        },
      ],
    });
  });

  it("returns null when the database returns no document (unknown or other tenant)", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    await expect(getQuotation(tenant, QUOTATION_ID)).resolves.toBeNull();
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("returns null for a malformed ID without querying", async () => {
    await expect(getQuotation(tenant, "not-a-uuid")).resolves.toBeNull();
    expect(rpc).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
  });

  it("throws on database errors", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "XX000", message: "boom" } });
    await expect(getQuotation(tenant, QUOTATION_ID)).rejects.toThrow("Failed to load quotation.");
  });
});

describe("listQuotations", () => {
  const ROW = {
    id: QUOTATION_ID,
    quotation_number: "QT-000001",
    customer_id: "dddddddd-0000-4000-8000-000000000004",
    customer_name: "Acme Buyer",
    customer_company_name: null,
    quotation_date: "2026-11-04",
    expiry_date: null,
    status: "sent",
    grand_total: "9999999999999999.99",
    created_at: "2026-11-04T10:00:00+00:00",
    total_count: "26",
  };

  it("searches and filters in the database through one list_quotations call", async () => {
    rpc.mockResolvedValue({ data: [ROW], error: null });

    const list = await listQuotations(tenant, {
      search: "acme",
      status: "sent",
      customer: "dddddddd-0000-4000-8000-000000000004",
      page: 2,
    });

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("list_quotations", {
      p_organization_id: ORG_ID,
      p_search: "acme",
      p_status: "sent",
      p_customer_id: "dddddddd-0000-4000-8000-000000000004",
      p_limit: 25,
      p_offset: 25,
    });
    expect(from).not.toHaveBeenCalled();
    expect(list).toEqual({
      items: [
        {
          id: QUOTATION_ID,
          quotationNumber: "QT-000001",
          customerId: "dddddddd-0000-4000-8000-000000000004",
          customerName: "Acme Buyer",
          customerCompanyName: null,
          quotationDate: "2026-11-04",
          expiryDate: null,
          status: "sent",
          // Exact decimal string.
          grandTotal: "9999999999999999.99",
          createdAt: "2026-11-04T10:00:00+00:00",
        },
      ],
      total: 26,
      page: 2,
      pageSize: 25,
    });
  });

  it("sends NULL for empty search and 'all' filters", async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    const list = await listQuotations(tenant, { search: "", status: "all", customer: "all", page: 1 });
    expect(rpc).toHaveBeenCalledWith("list_quotations", {
      p_organization_id: ORG_ID,
      p_search: null,
      p_status: null,
      p_customer_id: null,
      p_limit: 25,
      p_offset: 0,
    });
    expect(list.total).toBe(0);
  });

  it("reports a page past the end as total null", async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    const list = await listQuotations(tenant, { search: "", status: "all", customer: "all", page: 9 });
    expect(list.total).toBeNull();
  });

  it("throws on database errors", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "XX000", message: "boom" } });
    await expect(
      listQuotations(tenant, { search: "", status: "all", customer: "all", page: 1 }),
    ).rejects.toThrow("Failed to load quotations.");
  });
});
