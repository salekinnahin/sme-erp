import { createRequire } from "node:module";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { cache } from "react";

// Node's client React cache is a no-op. Exercise the installed server React
// implementation with a fresh request cache dispatcher, without a Next server
// or any network. Private internals are confined to this test harness.
type ServerReact = {
  cache: typeof cache;
  __SERVER_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE: {
    A: { getCacheForType: (factory: () => unknown) => unknown } | null;
  };
};
const mock = vi.hoisted(() => ({
  server: null as ServerReact | null,
  getUser: vi.fn(), from: vi.fn(), maybeSingle: vi.fn(), query: vi.fn(),
  details: vi.fn(), signedUrl: vi.fn(),
}));
vi.mock("react", async (original) => {
  const require = createRequire(import.meta.url);
  mock.server = require(path.join(path.dirname(require.resolve("react")), "react.react-server.js")) as ServerReact;
  return { ...await original<typeof import("react")>(), cache: mock.server.cache };
});
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: (href: string) => { throw new Error(`REDIRECT:${href}`); } }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getUser: mock.getUser }, from: mock.from,
  storage: { from: () => ({ createSignedUrl: mock.signedUrl }) },
}) }));
vi.mock("./details", () => ({ getOrganizationDetails: mock.details }));
import { requireTenant } from "@/lib/tenancy/context";
import { getOrganizationBranding } from "./branding";

const org = { id: "org-a", name: "Acme", currency: "BDT", timezone: "Asia/Dhaka" };
function beginRequest() {
  const resources = new Map<() => unknown, unknown>();
  mock.server!.__SERVER_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE.A = {
    getCacheForType(factory) {
      if (!resources.has(factory)) resources.set(factory, factory());
      return resources.get(factory);
    },
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  beginRequest();
  mock.getUser.mockResolvedValue({ data: { user: { id: "user-a" } } });
  const query = { select: mock.query, eq: mock.query, order: mock.query, limit: mock.query, maybeSingle: mock.maybeSingle };
  mock.from.mockReturnValue(query);
  mock.query.mockReturnValue(query);
  mock.maybeSingle.mockResolvedValue({ data: { id: "membership-a", role: "owner", organization: org }, error: null });
  mock.details.mockImplementation(async (tenant) => ({ name: "Acme", logoPath: `organizations/${tenant.organization.id}/logo`, logoUpdatedAt: null }));
  mock.signedUrl.mockResolvedValue({ data: { signedUrl: "signed-current-request" }, error: null });
});
afterEach(() => { mock.server!.__SERVER_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE.A = null; });

describe("request-scoped branding", () => {
  it("requireTenant returns the exact same authorized object and concurrent consumers share one read/sign", async () => {
    const [shellTenant, pageTenant, printTenant] = await Promise.all([requireTenant(), requireTenant(), requireTenant()]);
    expect(shellTenant).toBe(pageTenant);
    expect(pageTenant).toBe(printTenant);
    expect(mock.getUser).toHaveBeenCalledTimes(1);
    expect(mock.maybeSingle).toHaveBeenCalledTimes(1);
    const shell = getOrganizationBranding(shellTenant);
    expect(getOrganizationBranding(pageTenant)).toBe(shell);
    const result = await shell;
    expect(await getOrganizationBranding(printTenant)).toBe(result);
    expect(mock.details).toHaveBeenCalledExactlyOnceWith(shellTenant);
    expect(mock.signedUrl).toHaveBeenCalledTimes(1);
  });
  it("re-reads membership and signs a fresh URL in the next request", async () => {
    const firstTenant = await requireTenant();
    await getOrganizationBranding(firstTenant);
    beginRequest();
    mock.signedUrl.mockResolvedValue({ data: { signedUrl: "signed-next-request" }, error: null });
    const nextTenant = await requireTenant();
    expect(nextTenant).not.toBe(firstTenant);
    // Even the old reference cannot reuse a URL from the previous request.
    expect((await getOrganizationBranding(firstTenant)).logoUrl).toBe("signed-next-request");
    expect(mock.getUser).toHaveBeenCalledTimes(2);
    expect(mock.maybeSingle).toHaveBeenCalledTimes(2);
    expect(mock.details).toHaveBeenCalledTimes(2);
    expect(mock.signedUrl).toHaveBeenCalledTimes(2);
  });
  it("never shares branding between distinct user or organization contexts", async () => {
    const tenant = await requireTenant();
    const otherUser = { ...tenant, user: { ...tenant.user, id: "user-b" } };
    const otherOrg = { ...tenant, organization: { ...tenant.organization, id: "org-b" } };
    await Promise.all([getOrganizationBranding(tenant), getOrganizationBranding(otherUser), getOrganizationBranding(otherOrg)]);
    expect(mock.details).toHaveBeenCalledTimes(3);
    expect(mock.signedUrl).toHaveBeenCalledTimes(3);
    expect(mock.signedUrl).toHaveBeenCalledWith("organizations/org-b/logo", 3600);
  });
  it("does not read branding when session membership is missing", async () => {
    mock.maybeSingle.mockResolvedValue({ data: null, error: null });
    await expect(requireTenant().then(getOrganizationBranding)).rejects.toThrow("REDIRECT:/onboarding/organization");
    expect(mock.details).not.toHaveBeenCalled();
    expect(mock.signedUrl).not.toHaveBeenCalled();
  });
});
