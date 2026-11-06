import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  initialSelectorState,
  selectableOption,
  selectorKey,
  selectorReducer,
  type SelectorAction,
  type SelectorState,
} from "@/lib/quotations/selector-state";
import type { PurchaseProductOption, VendorOption } from "./form";

// The PO selector searches derive the tenant from the session and fail
// closed; the shared selector state machine keeps stale responses out.

const getTenant = vi.fn();
const searchVendorOptions = vi.fn();
const searchPurchaseProductOptions = vi.fn();

vi.mock("@/lib/tenancy/context", () => ({ getTenant: () => getTenant() }));
vi.mock("./options", () => ({
  searchVendorOptions: (...args: unknown[]) => searchVendorOptions(...args),
  searchPurchaseProductOptions: (...args: unknown[]) => searchPurchaseProductOptions(...args),
}));

const { searchPurchaseOrderVendors, searchPurchaseOrderProducts } = await import("./option-search");

const ORG_A = { id: "aaaaaaaa-0000-4000-8000-000000000001", name: "A", currency: "BDT", timezone: "UTC" };
const member = (role: string) => ({ user: { id: "u" }, membershipId: "m", role, organization: ORG_A });
const OK = { ok: true, options: [], more: false };

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  searchVendorOptions.mockResolvedValue(OK);
  searchPurchaseProductOptions.mockResolvedValue(OK);
});

describe.each([
  ["vendors", searchPurchaseOrderVendors, searchVendorOptions],
  ["products", searchPurchaseOrderProducts, searchPurchaseProductOptions],
] as const)("purchase order selector search: %s", (_name, action, domain) => {
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

describe("selector stale-response safety with PO options", () => {
  const vendor = (id: string, name: string): VendorOption => ({ id, name, companyName: null, phone: null, email: null, status: "active" });
  const prod = (id: string): PurchaseProductOption => ({ id, name: id, sku: id, unit: "pcs", description: null, purchasePrice: "1.00", status: "active" });

  function run<T>(actions: SelectorAction<T>[]): SelectorState<T> {
    return actions.reduce((s, a) => selectorReducer(s, a), initialSelectorState<T>());
  }

  it("a slow vendor response for an older query can never be highlighted or chosen", () => {
    const old = { ok: true as const, options: [vendor("v-old", "Old Co")], more: false };
    const state = run<VendorOption>([
      { type: "open", generation: 1 },
      { type: "query", generation: 2, query: "acme" },
      { type: "response", generation: 1, result: old }, // stale
    ]);
    expect(state.results).toEqual([]);
    expect(selectableOption(state, 0)).toBeUndefined();
    const enter = selectorKey(state, "Enter");
    expect(enter).toEqual({ preventDefault: true }); // never submits, never chooses
  });

  it("out-of-order product responses: only the newest query's results are selectable", () => {
    const newer = { ok: true as const, options: [prod("p-new")], more: false };
    const older = { ok: true as const, options: [prod("p-old")], more: false };
    let state = run<PurchaseProductOption>([
      { type: "open", generation: 1 },
      { type: "query", generation: 2, query: "a" },
      { type: "query", generation: 3, query: "ab" },
      { type: "response", generation: 3, result: newer },
      { type: "response", generation: 2, result: older },
    ]);
    expect(state.results.map((p) => p.id)).toEqual(["p-new"]);
    state = selectorReducer(state, { type: "move", delta: 1 });
    expect(selectorKey(state, "Enter").choose?.id).toBe("p-new");
  });
});
