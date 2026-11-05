import { beforeEach, describe, expect, it, vi } from "vitest";

// Edit and status-change behavior of the domain functions the pages use:
// only drafts are edited, malformed / unknown / other-tenant IDs are all
// "not found", and database errors map to safe reasons.

type Op = [method: string, ...args: unknown[]];
type Query = { table: string; ops: Op[] };
type Result = { data: unknown; error: unknown };

const queries: Query[] = [];
const tables: Record<string, (q: Query) => Result> = {};
const rpc = vi.fn();

function builder(query: Query): unknown {
  const proxy: object = new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === "then")
          return (resolve: (r: Result) => unknown, reject: (e: unknown) => unknown) =>
            Promise.resolve((tables[query.table] ?? (() => ({ data: null, error: null })))(query)).then(
              resolve,
              reject,
            );
        return (...args: unknown[]) => {
          query.ops.push([String(prop), ...args]);
          return proxy;
        };
      },
    },
  );
  return proxy;
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    rpc,
    from: (table: string) => {
      const query = { table, ops: [] };
      queries.push(query);
      return builder(query);
    },
  }),
}));

const { updateQuotationDraft, setQuotationStatus } = await import("./quotations");

const ORG = "aaaaaaaa-0000-4000-8000-000000000001";
const Q = "cccccccc-0000-4000-8000-000000000003";
const CUSTOMER = "dddddddd-0000-4000-8000-000000000004";
const PRODUCT = "bbbbbbbb-0000-4000-8000-000000000002";

const tenant = (role: "owner" | "manager" | "employee") => ({
  role,
  organization: { id: ORG, name: "Org", currency: "BDT", timezone: "Asia/Dhaka" },
});

const input = {
  customerId: CUSTOMER,
  quotationDate: "2026-11-04",
  expiryDate: null,
  notes: "Edited",
  items: [
    { productId: PRODUCT, description: "Desc", quantity: "2", unitPrice: "10.00", discountAmount: "0", taxRate: "5" },
  ],
};

function draftState(status: string | null) {
  tables.quotations = () => ({ data: status === null ? null : { status }, error: null });
}

beforeEach(() => {
  queries.length = 0;
  rpc.mockReset();
  for (const key of Object.keys(tables)) delete tables[key];
  tables.customers = () => ({ data: { status: "active" }, error: null });
  tables.products = () => ({ data: [{ id: PRODUCT, status: "active", selling_price: "10.00" }], error: null });
});

describe("updateQuotationDraft", () => {
  it("returns not_found for a malformed ID without any query", async () => {
    await expect(updateQuotationDraft(tenant("owner"), "../x", input)).resolves.toEqual({
      ok: false,
      reason: "not_found",
    });
    expect(queries).toHaveLength(0);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("returns not_found when the quotation is unknown or another tenant's", async () => {
    draftState(null);
    await expect(updateQuotationDraft(tenant("owner"), Q, input)).resolves.toEqual({
      ok: false,
      reason: "not_found",
    });
    const lookup = queries.find((q) => q.table === "quotations");
    expect(lookup?.ops).toContainEqual(["eq", "organization_id", ORG]);
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each(["sent", "accepted", "rejected", "expired", "cancelled"])(
    "refuses to edit a %s quotation",
    async (status) => {
      draftState(status);
      await expect(updateQuotationDraft(tenant("owner"), Q, input)).resolves.toEqual({
        ok: false,
        reason: "not_draft",
      });
      expect(rpc).not.toHaveBeenCalled();
    },
  );

  it("saves a draft through update_quotation_draft with user values only", async () => {
    draftState("draft");
    rpc.mockResolvedValue({ data: null, error: null });
    await expect(updateQuotationDraft(tenant("employee"), Q, input)).resolves.toEqual({
      ok: true,
      quotationId: Q,
    });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("update_quotation_draft", {
      p_quotation_id: Q,
      p_customer_id: CUSTOMER,
      p_quotation_date: "2026-11-04",
      p_expiry_date: null,
      p_notes: "Edited",
      p_items: [
        { product_id: PRODUCT, quantity: "2", unit_price: "10.00", discount_amount: "0", tax_rate: "5", description: "Desc" },
      ],
    });
  });

  it("keeps an inactive customer as a field error, not a silent change", async () => {
    draftState("draft");
    tables.customers = () => ({ data: { status: "inactive" }, error: null });
    const result = await updateQuotationDraft(tenant("owner"), Q, input);
    expect(result).toMatchObject({
      ok: false,
      reason: "invalid",
      fieldErrors: { customerId: "This customer is inactive. Choose an active customer." },
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("reports an inactive or other-tenant product on its line", async () => {
    draftState("draft");
    tables.products = () => ({ data: [], error: null });
    const result = await updateQuotationDraft(tenant("owner"), Q, input);
    expect(result).toMatchObject({
      ok: false,
      reason: "invalid",
      itemErrors: [{ productId: "Choose a product or service from the list." }],
    });
  });

  it.each([
    ["55000", "not_draft"], // sent by someone else in the meantime
    ["P0002", "not_found"],
    ["23503", "invalid_reference"],
    ["42501", "forbidden"],
    ["XX000", "failed"],
  ])("maps database error %s to %s", async (code, reason) => {
    draftState("draft");
    rpc.mockResolvedValue({ data: null, error: { code, message: "raw database text" } });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(updateQuotationDraft(tenant("owner"), Q, input)).resolves.toEqual({ ok: false, reason });
    spy.mockRestore();
  });
});

describe("setQuotationStatus", () => {
  it("refuses restricted changes for employees before calling the database", async () => {
    for (const status of ["accepted", "rejected", "expired", "cancelled"] as const)
      await expect(setQuotationStatus(tenant("employee"), Q, status)).resolves.toEqual({
        ok: false,
        reason: "forbidden",
      });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("lets employees mark sent through set_quotation_status", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    await expect(setQuotationStatus(tenant("employee"), Q, "sent")).resolves.toEqual({ ok: true, quotationId: Q });
    expect(rpc).toHaveBeenCalledWith("set_quotation_status", { p_quotation_id: Q, p_status: "sent" });
  });

  it("returns not_found for a malformed ID", async () => {
    await expect(setQuotationStatus(tenant("owner"), "nope", "sent")).resolves.toEqual({
      ok: false,
      reason: "not_found",
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each([
    ["55000", "invalid_transition"],
    ["P0002", "not_found"],
    ["42501", "forbidden"],
    ["22023", "invalid"],
  ])("maps database error %s to %s", async (code, reason) => {
    rpc.mockResolvedValue({ data: null, error: { code, message: "raw" } });
    await expect(setQuotationStatus(tenant("owner"), Q, "accepted")).resolves.toEqual({ ok: false, reason });
  });

  it("rejects 'draft' and unknown targets", async () => {
    // Only reachable with a forged value; the Server Action also rejects it.
    await expect(setQuotationStatus(tenant("owner"), Q, "draft" as never)).resolves.toEqual({
      ok: false,
      reason: "invalid",
    });
    expect(rpc).not.toHaveBeenCalled();
  });
});
