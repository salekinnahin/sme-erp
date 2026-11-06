import { beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({
  requireTenant: vi.fn(), upload: vi.fn(), remove: vi.fn(), revalidate: vi.fn(),
}));
vi.mock("@/lib/tenancy/context", () => ({ requireTenant: mock.requireTenant }));
vi.mock("@/lib/organizations/branding", () => ({
  uploadOrganizationLogo: mock.upload, removeOrganizationLogo: mock.remove,
}));
vi.mock("next/cache", () => ({ revalidatePath: mock.revalidate }));
vi.mock("next/navigation", () => ({ unstable_rethrow: () => {} }));
import { removeLogoAction, uploadLogoAction } from "@/app/settings/organization/actions";

const owner = { organization: { id: "session-org" }, role: "owner" };
function form(file?: File) {
  const data = new FormData();
  if (file) data.set("logo", file);
  data.set("organization_id", "forged-org");
  data.set("path", "organizations/forged-org/logo");
  return data;
}
const logo = () => new File([new Uint8Array([1, 2, 3])], "logo.png", { type: "image/png" });

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  mock.requireTenant.mockResolvedValue(owner);
  mock.upload.mockResolvedValue({ ok: true });
  mock.remove.mockResolvedValue({ ok: true });
});

describe("uploadLogoAction", () => {
  it("uses only the session tenant and the logo file, ignoring forged fields", async () => {
    const file = logo();
    expect(await uploadLogoAction({}, form(file))).toEqual({ success: expect.stringContaining("Logo updated") });
    expect(mock.upload).toHaveBeenCalledExactlyOnceWith(owner, expect.any(File));
    expect((mock.upload.mock.calls[0][1] as File).name).toBe("logo.png");
    expect(mock.revalidate).toHaveBeenCalledWith("/settings/organization");
  });

  it("refuses employees before handling the file", async () => {
    mock.requireTenant.mockResolvedValue({ ...owner, role: "employee" });
    expect(await uploadLogoAction({}, form(logo()))).toEqual({ error: expect.stringContaining("permission") });
    expect(mock.upload).not.toHaveBeenCalled();
  });

  it("asks for a file when none (or an empty one, or a text field) was sent", async () => {
    expect(await uploadLogoAction({}, form())).toEqual({ error: "Choose an image file to upload." });
    expect(await uploadLogoAction({}, form(new File([], "empty.png")))).toEqual({ error: "Choose an image file to upload." });
    const text = form(); text.set("logo", "not a file");
    expect(await uploadLogoAction({}, text)).toEqual({ error: "Choose an image file to upload." });
    expect(mock.upload).not.toHaveBeenCalled();
  });

  it.each([
    ["too_large", "too large"],
    ["unsupported_type", "not supported"],
    ["invalid_dimensions", "pixels"],
    ["forbidden", "permission"],
    ["failed", "could not be uploaded"],
  ])("shows a friendly message for %s", async (reason, text) => {
    mock.upload.mockResolvedValue({ ok: false, reason });
    const result = await uploadLogoAction({}, form(logo()));
    expect(result.error).toContain(text);
    expect(mock.revalidate).not.toHaveBeenCalled();
  });

  it("returns a generic message when the tenant cannot be loaded", async () => {
    mock.requireTenant.mockRejectedValue(new Error("db down"));
    expect(await uploadLogoAction({}, form(logo()))).toEqual({ error: expect.stringContaining("Something went wrong") });
    expect(mock.upload).not.toHaveBeenCalled();
  });
});

describe("removeLogoAction", () => {
  it.each(["owner", "manager"])("%s removes using the session tenant", async (role) => {
    const tenant = { ...owner, role };
    mock.requireTenant.mockResolvedValue(tenant);
    expect(await removeLogoAction()).toEqual({ success: expect.stringContaining("text-only") });
    expect(mock.remove).toHaveBeenCalledExactlyOnceWith(tenant);
  });

  it("refuses employees", async () => {
    mock.requireTenant.mockResolvedValue({ ...owner, role: "employee" });
    expect(await removeLogoAction()).toEqual({ error: expect.stringContaining("permission") });
    expect(mock.remove).not.toHaveBeenCalled();
  });

  it("shows a friendly failure", async () => {
    mock.remove.mockResolvedValue({ ok: false, reason: "failed" });
    expect(await removeLogoAction()).toEqual({ error: expect.stringContaining("could not be removed") });
  });
});
