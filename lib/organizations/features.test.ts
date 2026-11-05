import { beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import { isOrganizationFeatureKey, ORGANIZATION_FEATURE_KEYS, type OrganizationFeatureKey } from "./feature-keys";

vi.mock("server-only", () => ({}));
const { getTenant, createClient, rpc } = vi.hoisted(() => ({
  getTenant: vi.fn(), createClient: vi.fn(), rpc: vi.fn(),
}));
vi.mock("@/lib/tenancy/context", () => ({ getTenant }));
vi.mock("@/lib/supabase/server", () => ({ createClient }));
import { hasOrganizationFeature } from "./features";

beforeEach(() => {
  vi.resetAllMocks();
  getTenant.mockResolvedValue({ organization: { id: "session-org" }, role: "employee" });
  createClient.mockResolvedValue({ rpc });
});

describe("organization feature keys", () => {
  it("accepts only approved keys, without coercion", () => {
    expectTypeOf<OrganizationFeatureKey>().toEqualTypeOf<"rentals">();
    expect(ORGANIZATION_FEATURE_KEYS).toEqual(["rentals"]);
    expect(isOrganizationFeatureKey("rentals")).toBe(true);
    for (const value of ["RENTALS", " rentals", "payroll", "", null, undefined, {}, 1]) {
      expect(isOrganizationFeatureKey(value)).toBe(false);
    }
  });
});

describe("hasOrganizationFeature", () => {
  it("uses only the session organization, with no tenant argument", async () => {
    expectTypeOf(hasOrganizationFeature).parameters.toEqualTypeOf<[OrganizationFeatureKey]>();
    rpc.mockResolvedValue({ data: true, error: null });
    expect(await hasOrganizationFeature("rentals")).toBe(true);
    expect(getTenant).toHaveBeenCalledOnce();
    expect(rpc).toHaveBeenCalledExactlyOnceWith("has_org_feature", {
      p_organization_id: "session-org", p_feature_key: "rentals",
    });
  });

  it.each([false, null, undefined, "true", 1, {}])("denies missing, disabled or malformed results: %s", async (data) => {
    rpc.mockResolvedValue({ data, error: null });
    expect(await hasOrganizationFeature("rentals")).toBe(false);
  });

  it("denies a missing session or active membership without querying features", async () => {
    getTenant.mockResolvedValue(null);
    expect(await hasOrganizationFeature("rentals")).toBe(false);
    expect(createClient).not.toHaveBeenCalled();
  });

  it("denies unknown keys at runtime before reading the session", async () => {
    expect(await hasOrganizationFeature("payroll" as OrganizationFeatureKey)).toBe(false);
    expect(getTenant).not.toHaveBeenCalled();
  });

  it("denies RPC errors even if data is true", async () => {
    rpc.mockResolvedValue({ data: true, error: { code: "42501" } });
    expect(await hasOrganizationFeature("rentals")).toBe(false);
  });

  it.each(["tenant", "client", "rpc"])("denies thrown %s failures", async (stage) => {
    ({ tenant: getTenant, client: createClient, rpc }[stage]!).mockRejectedValue(new Error("unavailable"));
    expect(await hasOrganizationFeature("rentals")).toBe(false);
  });

  it("checks current entitlement and tenant again on subsequent calls", async () => {
    rpc.mockResolvedValueOnce({ data: true, error: null }).mockResolvedValueOnce({ data: false, error: null });
    expect(await hasOrganizationFeature("rentals")).toBe(true);
    getTenant.mockResolvedValue({ organization: { id: "other-session-org" } });
    expect(await hasOrganizationFeature("rentals")).toBe(false);
    expect(rpc).toHaveBeenLastCalledWith("has_org_feature", {
      p_organization_id: "other-session-org", p_feature_key: "rentals",
    });
  });
});
