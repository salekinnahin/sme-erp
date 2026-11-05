import { beforeEach, describe, expect, it, vi } from "vitest";

// The selector search actions derive the tenant from the session and fail
// closed: no session, no active membership, or any error → { ok: false }.

const getTenant = vi.fn();
const searchCustomerOptions = vi.fn();
const searchProductOptions = vi.fn();

vi.mock("@/lib/tenancy/context", () => ({ getTenant: () => getTenant() }));
vi.mock("./options", () => ({
  searchCustomerOptions: (...args: unknown[]) => searchCustomerOptions(...args),
  searchProductOptions: (...args: unknown[]) => searchProductOptions(...args),
}));

const { searchQuotationCustomers, searchQuotationProducts } = await import("./option-search");

const ORG_A = { id: "aaaaaaaa-0000-4000-8000-000000000001", name: "A", currency: "BDT", timezone: "UTC" };
const member = (role: string) => ({ user: { id: "u" }, membershipId: "m", role, organization: ORG_A });
const OK = { ok: true, options: [], more: false };

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  searchCustomerOptions.mockResolvedValue(OK);
  searchProductOptions.mockResolvedValue(OK);
});

describe.each([
  ["customers", searchQuotationCustomers, searchCustomerOptions],
  ["products", searchQuotationProducts, searchProductOptions],
] as const)("selector search: %s", (_name, action, domain) => {
  it.each(["owner", "manager", "employee"])("searches the session's organization for an active %s", async (role) => {
    getTenant.mockResolvedValue(member(role));
    await expect(action(" term ")).resolves.toEqual(OK);
    expect(domain).toHaveBeenCalledTimes(1);
    expect(domain.mock.calls[0][0].organization).toBe(ORG_A);
    expect(domain.mock.calls[0][1]).toBe(" term ");
  });

  it("refuses without an active membership (signed out or disabled member)", async () => {
    getTenant.mockResolvedValue(null);
    await expect(action("term")).resolves.toEqual({ ok: false });
    expect(domain).not.toHaveBeenCalled();
  });

  it("refuses an unknown role", async () => {
    getTenant.mockResolvedValue(member("viewer"));
    await expect(action("term")).resolves.toEqual({ ok: false });
    expect(domain).not.toHaveBeenCalled();
  });

  it("never takes the organization from the input", async () => {
    getTenant.mockResolvedValue(member("employee"));
    await action({ organization: { id: "bbbbbbbb-0000-4000-8000-000000000002" } });
    expect(domain.mock.calls[0][0].organization).toBe(ORG_A);
  });

  it("returns { ok: false } without details when loading the tenant or searching fails", async () => {
    getTenant.mockRejectedValue(new Error("db down"));
    await expect(action("term")).resolves.toEqual({ ok: false });

    getTenant.mockResolvedValue(member("owner"));
    domain.mockRejectedValue(new Error("relation does not exist"));
    await expect(action("term")).resolves.toEqual({ ok: false });
  });
});
