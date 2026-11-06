import { describe, expect, it } from "vitest";
import {
  LOGO_MAX_BYTES,
  LOGO_MIME_TYPES,
  organizationLogoPath,
  precheckLogoFile,
  readImageHeader,
  validateLogo,
} from "./logo";

// Minimal headers: enough for format and dimension detection.
function png(width = 300, height = 100): Uint8Array {
  const b = new Uint8Array(33);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const view = new DataView(b.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return b;
}

function jpeg(width = 300, height = 100): Uint8Array {
  return new Uint8Array([
    0xff, 0xd8,
    0xff, 0xe0, 0x00, 0x06, 0x4a, 0x46, 0x49, 0x46, // APP0 (length 6) skipped
    0xff, 0xff, // fill byte
    0xff, 0xc2, 0x00, 0x11, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff, 0x03,
    0, 0, 0, 0, 0, 0, 0, 0, 0,
  ]);
}

function riff(chunk: string, body: number[]): Uint8Array {
  const b = new Uint8Array(40);
  b.set([...Buffer.from("RIFF"), 32, 0, 0, 0, ...Buffer.from("WEBP"), ...Buffer.from(chunk), 20, 0, 0, 0]);
  b.set(body, 20);
  return b;
}
const le24 = (n: number) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff];
const webpExtended = (w = 300, h = 100) => riff("VP8X", [0, 0, 0, 0, ...le24(w - 1), ...le24(h - 1)]);
const webpLossy = (w: number, h: number) => riff("VP8 ", [0, 0, 0, 0x9d, 0x01, 0x2a, w & 0xff, w >> 8, h & 0xff, h >> 8]);
function webpLossless(w: number, h: number) {
  const bits = (w - 1) | ((h - 1) << 14);
  return riff("VP8L", [0x2f, bits & 0xff, (bits >> 8) & 0xff, (bits >> 16) & 0xff, (bits >>> 24) & 0xff]);
}

const file = (bytes: Uint8Array, type = "") => ({ size: bytes.length, type, bytes });

describe("logo path", () => {
  it("is one fixed, extension-free key per organization", () => {
    expect(organizationLogoPath("0e3b0c44-0000-4000-8000-000000000001")).toBe(
      "organizations/0e3b0c44-0000-4000-8000-000000000001/logo",
    );
  });
});

describe("readImageHeader", () => {
  it.each([
    ["PNG", png(640, 200), "image/png"],
    ["JPEG", jpeg(640, 200), "image/jpeg"],
    ["WebP VP8X", webpExtended(640, 200), "image/webp"],
    ["WebP VP8", webpLossy(640, 200), "image/webp"],
    ["WebP VP8L", webpLossless(640, 200), "image/webp"],
  ])("detects %s format and dimensions from the bytes", (_name, bytes, mimeType) => {
    expect(readImageHeader(bytes)).toEqual({ mimeType, width: 640, height: 200 });
  });

  it.each([
    ["SVG", new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="100"></svg>')],
    ["HTML", new TextEncoder().encode("<!doctype html><script>alert(1)</script>")],
    ["GIF", new TextEncoder().encode("GIF89a\x2c\x01\x64\x00")],
    ["PDF", new TextEncoder().encode("%PDF-1.7\n")],
    ["truncated PNG", png().subarray(0, 20)],
    ["JPEG without a frame header", new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0x00, 0x02, 0, 0])],
    ["RIFF that is not WebP", new TextEncoder().encode("RIFF\x20\x00\x00\x00WAVEfmt                    ")],
    ["empty", new Uint8Array()],
  ])("rejects %s", (_name, bytes) => {
    expect(readImageHeader(bytes)).toBeNull();
  });
});

describe("precheckLogoFile (browser metadata, early feedback only)", () => {
  it("accepts allowed types, and an empty type for the content check", () => {
    for (const type of [...LOGO_MIME_TYPES, ""]) expect(precheckLogoFile({ size: 10, type })).toBeNull();
  });

  it.each(["image/svg+xml", "image/gif", "text/html", "application/pdf", "image/PNG"])("rejects declared %s", (type) => {
    expect(precheckLogoFile({ size: 10, type })).toBe("unsupported_type");
  });

  it("enforces the size limit inclusively and rejects empty files", () => {
    expect(precheckLogoFile({ size: LOGO_MAX_BYTES, type: "image/png" })).toBeNull();
    expect(precheckLogoFile({ size: LOGO_MAX_BYTES + 1, type: "image/png" })).toBe("too_large");
    expect(precheckLogoFile({ size: 0, type: "image/png" })).toBe("missing");
  });
});

describe("validateLogo (server, actual bytes)", () => {
  it.each([
    ["png", png(), "image/png"],
    ["jpeg", jpeg(), "image/jpeg"],
    ["webp", webpExtended(), "image/webp"],
  ])("accepts %s and uses the detected type", (_name, bytes, mimeType) => {
    expect(validateLogo(file(bytes, "image/png"))).toEqual({ ok: true, image: { mimeType, width: 300, height: 100 } });
  });

  it("does not trust a renamed or relabelled non-image", () => {
    const html = new TextEncoder().encode("<html><script>steal()</script></html>");
    expect(validateLogo(file(html, "image/png"))).toEqual({ ok: false, reason: "unsupported_type" });
    expect(validateLogo(file(html, ""))).toEqual({ ok: false, reason: "unsupported_type" });
  });

  it("rejects a declared SVG even with valid image bytes", () => {
    expect(validateLogo(file(png(), "image/svg+xml"))).toEqual({ ok: false, reason: "unsupported_type" });
  });

  it("rejects oversize files before looking at content, and size/byte mismatches", () => {
    expect(validateLogo({ size: LOGO_MAX_BYTES + 1, type: "image/png", bytes: png() })).toEqual({ ok: false, reason: "too_large" });
    expect(validateLogo({ size: 999, type: "image/png", bytes: png() })).toEqual({ ok: false, reason: "unsupported_type" });
  });

  it.each([
    [15, 100], [100, 15], [4097, 100], [100, 4097], [0, 0],
  ])("rejects dimensions %ix%i", (w, h) => {
    expect(validateLogo(file(png(w, h)))).toEqual({ ok: false, reason: "invalid_dimensions" });
  });

  it("accepts the dimension bounds", () => {
    expect(validateLogo(file(png(16, 4096))).ok).toBe(true);
    expect(validateLogo(file(webpLossless(4096, 16))).ok).toBe(true);
  });
});
