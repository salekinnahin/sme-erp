import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const mock = vi.hoisted(() => ({
  createClient: vi.fn(), getOrganizationDetails: vi.fn(), rpc: vi.fn(), from: vi.fn(),
  upload: vi.fn(), remove: vi.fn(), createSignedUrl: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: mock.createClient }));
vi.mock("./details", () => ({ getOrganizationDetails: mock.getOrganizationDetails }));
import { getOrganizationBranding, removeOrganizationLogo, uploadOrganizationLogo } from "./branding";

const ORG = "11111111-0000-4000-8000-000000000001";
const OTHER = "22222222-0000-4000-8000-000000000002";
const PATH = `organizations/${ORG}/logo`;
const tenant = (role: "owner" | "manager" | "employee") => ({ organization: { id: ORG }, role }) as never;

function pngBytes(width = 300, height = 100) {
  const b = new Uint8Array(33);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(b.buffer).setUint32(16, width);
  new DataView(b.buffer).setUint32(20, height);
  return b;
}
const pngFile = (type = "image/png") => new File([pngBytes()], "logo.png", { type });

const details = {
  name: "Acme Ltd", email: "hello@acme.test", phone: "+880 1700", address: "Dhaka", taxNumber: "TIN-1",
  logoPath: PATH, logoUpdatedAt: "2026-11-06T10:00:00Z",
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  mock.createClient.mockResolvedValue({ rpc: mock.rpc, storage: { from: mock.from } });
  mock.from.mockReturnValue({ upload: mock.upload, remove: mock.remove, createSignedUrl: mock.createSignedUrl });
  mock.upload.mockResolvedValue({ data: { path: PATH }, error: null });
  mock.remove.mockResolvedValue({ data: [], error: null });
  mock.rpc.mockResolvedValue({ data: null, error: null });
  mock.createSignedUrl.mockResolvedValue({ data: { signedUrl: "https://storage.test/signed?token=t" }, error: null });
  mock.getOrganizationDetails.mockResolvedValue(details);
});

describe("getOrganizationBranding", () => {
  it("returns current details and a short-lived signed URL for the current logo", async () => {
    const branding = await getOrganizationBranding(tenant("employee"));
    expect(branding).toEqual({
      name: "Acme Ltd", email: "hello@acme.test", phone: "+880 1700", address: "Dhaka", taxNumber: "TIN-1",
      logoUpdatedAt: "2026-11-06T10:00:00Z", logoUrl: "https://storage.test/signed?token=t",
    });
    expect(branding).not.toHaveProperty("logoPath");
    expect(mock.from).toHaveBeenCalledWith("organization-branding");
    expect(mock.createSignedUrl).toHaveBeenCalledWith(PATH, 3600);
  });

  it("falls back to text-only without touching Storage when there is no logo", async () => {
    mock.getOrganizationDetails.mockResolvedValue({ ...details, logoPath: null, logoUpdatedAt: null });
    expect((await getOrganizationBranding(tenant("owner"))).logoUrl).toBeNull();
    expect(mock.createClient).not.toHaveBeenCalled();
  });

  it("never signs another organization's key", async () => {
    mock.getOrganizationDetails.mockResolvedValue({ ...details, logoPath: `organizations/${OTHER}/logo` });
    expect((await getOrganizationBranding(tenant("owner"))).logoUrl).toBeNull();
    expect(mock.createSignedUrl).not.toHaveBeenCalled();
  });

  it("falls back to text-only when signing fails or throws, without exposing the error", async () => {
    mock.createSignedUrl.mockResolvedValueOnce({ data: null, error: { statusCode: "404", message: "Object not found" } });
    expect((await getOrganizationBranding(tenant("owner"))).logoUrl).toBeNull();
    mock.createSignedUrl.mockRejectedValueOnce(new Error("network"));
    expect((await getOrganizationBranding(tenant("owner"))).logoUrl).toBeNull();
  });

  it("propagates organization read failures to the error boundary", async () => {
    mock.getOrganizationDetails.mockRejectedValue(new Error("db down"));
    await expect(getOrganizationBranding(tenant("owner"))).rejects.toThrow("db down");
  });
});

describe("uploadOrganizationLogo", () => {
  it.each(["owner", "manager"] as const)("%s uploads to the session organization's fixed key, then records it", async (role) => {
    expect(await uploadOrganizationLogo(tenant(role), pngFile())).toEqual({ ok: true });
    expect(mock.upload).toHaveBeenCalledWith(PATH, expect.any(Uint8Array), {
      contentType: "image/png", upsert: true, cacheControl: "60",
    });
    expect(mock.rpc).toHaveBeenCalledExactlyOnceWith("set_organization_logo", { p_organization_id: ORG });
    expect(mock.upload.mock.invocationCallOrder[0]).toBeLessThan(mock.rpc.mock.invocationCallOrder[0]);
  });

  it("denies employees without reading the file or calling Storage", async () => {
    const file = pngFile();
    const read = vi.spyOn(file, "arrayBuffer");
    expect(await uploadOrganizationLogo(tenant("employee"), file)).toEqual({ ok: false, reason: "forbidden" });
    expect(read).not.toHaveBeenCalled();
    expect(mock.createClient).not.toHaveBeenCalled();
  });

  it("stores the detected type, not the browser-reported one", async () => {
    const jpegBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0, 100, 1, 44, 3, 0, 0, 0, 0]);
    await uploadOrganizationLogo(tenant("owner"), new File([jpegBytes], "logo.png", { type: "image/png" }));
    expect(mock.upload.mock.calls[0][2].contentType).toBe("image/jpeg");
  });

  it.each([
    ["an SVG", new File(['<svg xmlns="http://www.w3.org/2000/svg"/>'], "logo.svg", { type: "image/svg+xml" }), "unsupported_type"],
    ["HTML renamed to .png", new File(["<html><script></script></html>"], "logo.png", { type: "image/png" }), "unsupported_type"],
    ["an oversize file", new File([new Uint8Array(2 * 1024 * 1024 + 1)], "big.png", { type: "image/png" }), "too_large"],
    ["a tiny image", new File([pngBytes(8, 8)], "tiny.png", { type: "image/png" }), "invalid_dimensions"],
  ])("rejects %s before any Storage call", async (_name, file, reason) => {
    expect(await uploadOrganizationLogo(tenant("owner"), file)).toEqual({ ok: false, reason });
    expect(mock.createClient).not.toHaveBeenCalled();
  });

  it.each([
    [{ statusCode: "403", message: "new row violates row-level security policy" }, "forbidden"],
    [{ status: 401, message: "Unauthorized" }, "forbidden"],
    [{ statusCode: "413", message: "Payload too large" }, "too_large"],
    [{ statusCode: "415", message: "mime type not supported" }, "unsupported_type"],
    [{ statusCode: "500", message: "internal: bucket xyz" }, "failed"],
  ])("maps Storage error %j to a safe reason and does not record the logo", async (error, reason) => {
    mock.upload.mockResolvedValue({ data: null, error });
    expect(await uploadOrganizationLogo(tenant("manager"), pngFile())).toEqual({ ok: false, reason });
    expect(mock.rpc).not.toHaveBeenCalled();
  });

  it("maps record failures: role revoked meanwhile → forbidden, others → failed", async () => {
    mock.rpc.mockResolvedValueOnce({ data: null, error: { code: "42501", message: "x" } });
    expect(await uploadOrganizationLogo(tenant("manager"), pngFile())).toEqual({ ok: false, reason: "forbidden" });
    mock.rpc.mockResolvedValueOnce({ data: null, error: { code: "P0002", message: "x" } });
    expect(await uploadOrganizationLogo(tenant("manager"), pngFile())).toEqual({ ok: false, reason: "failed" });
  });

  it("turns thrown transport errors into a failed result", async () => {
    mock.upload.mockRejectedValue(new Error("socket hang up"));
    expect(await uploadOrganizationLogo(tenant("owner"), pngFile())).toEqual({ ok: false, reason: "failed" });
  });
});

describe("removeOrganizationLogo", () => {
  it.each(["owner", "manager"] as const)("%s clears the logo, then removes the session organization's object", async (role) => {
    expect(await removeOrganizationLogo(tenant(role))).toEqual({ ok: true });
    expect(mock.rpc).toHaveBeenCalledExactlyOnceWith("clear_organization_logo", { p_organization_id: ORG });
    expect(mock.remove).toHaveBeenCalledExactlyOnceWith([PATH]);
    expect(mock.rpc.mock.invocationCallOrder[0]).toBeLessThan(mock.remove.mock.invocationCallOrder[0]);
  });

  it("denies employees without any call", async () => {
    expect(await removeOrganizationLogo(tenant("employee"))).toEqual({ ok: false, reason: "forbidden" });
    expect(mock.createClient).not.toHaveBeenCalled();
  });

  it("keeps the object if clearing fails", async () => {
    mock.rpc.mockResolvedValue({ data: null, error: { code: "42501" } });
    expect(await removeOrganizationLogo(tenant("manager"))).toEqual({ ok: false, reason: "forbidden" });
    expect(mock.remove).not.toHaveBeenCalled();
  });

  it("still succeeds when only the object removal fails (logo is already cleared)", async () => {
    mock.remove.mockResolvedValue({ data: null, error: { statusCode: "500", message: "x" } });
    expect(await removeOrganizationLogo(tenant("owner"))).toEqual({ ok: true });
  });
});
