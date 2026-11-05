import { beforeEach, describe, expect, it, vi } from "vitest";

// The invoice selector searches reuse the quotation search and derive
// the tenant from the session; they fail closed.

const getTenant = vi.fn();
const searchCustomerOptions = vi.fn();
const searchProductOptions = vi.fn();

vi.mock("@/lib/tenancy/context", () => ({ getTenant: () => getTenant() }));
vi.mock("@/lib/quotations/options", () => ({
  searchCustomerOptions: (...args: unknown[]) => searchCustomerOptions(...args),
  searchProductOptions: (...args: unknown[]) => searchProductOptions(...args),
}));

const { searchInvoiceCustomers, searchInvoiceProducts } = await import("./option-search");

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
  ["customers", searchInvoiceCustomers, searchCustomerOptions],
  ["products", searchInvoiceProducts, searchProductOptions],
] as const)("invoice selector search: %s", (_name, action, domain) => {
  it.each(["owner", "manager", "employee"])("searches the session's organization for an active %s", async (role) => {
    getTenant.mockResolvedValue(member(role));
    await expect(action(" term ")).resolves.toEqual(OK);
    expect(domain.mock.calls[0][0].organization).toBe(ORG_A);
    expect(domain.mock.calls[0][1]).toBe(" term ");
  });

  it("fails closed without a session / active membership, or on errors", async () => {
    getTenant.mockResolvedValue(null);
    await expect(action("x")).resolves.toEqual({ ok: false });
    getTenant.mockRejectedValue(new Error("db down"));
    await expect(action("x")).resolves.toEqual({ ok: false });
    getTenant.mockResolvedValue(member("owner"));
    domain.mockRejectedValue(new Error("rpc failed"));
    await expect(action("x")).resolves.toEqual({ ok: false });
  });

  it("refuses roles that can neither create nor edit", async () => {
    getTenant.mockResolvedValue(member("viewer"));
    await expect(action("x")).resolves.toEqual({ ok: false });
    expect(domain).not.toHaveBeenCalled();
  });
});
