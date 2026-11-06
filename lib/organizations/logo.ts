/**
 * Organization logo rules (DECISIONS 029). Pure and client-safe: the settings
 * form uses the same limits for early feedback, and the Server Action
 * re-validates the actual bytes. The Storage bucket enforces the size and
 * MIME allowlist a third time.
 *
 * SVG is deliberately not supported: the app has no SVG sanitizing policy.
 */

export const LOGO_BUCKET = "organization-branding";
export const LOGO_MAX_BYTES = 2 * 1024 * 1024;
export const LOGO_MIN_DIMENSION = 16;
export const LOGO_MAX_DIMENSION = 4096;
/** Lifetime of a signed read URL created for one page render. */
export const LOGO_SIGNED_URL_SECONDS = 60 * 60;

export const LOGO_MIME_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
export type LogoMimeType = (typeof LOGO_MIME_TYPES)[number];

/** For the file input `accept` attribute (a hint only, never a control). */
export const LOGO_ACCEPT = ".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp";
export const LOGO_RULES_TEXT = "PNG, JPEG or WebP, up to 2 MB.";

export type LogoRejection = "missing" | "too_large" | "unsupported_type" | "invalid_dimensions";

export const LOGO_REJECTION_MESSAGES: Record<LogoRejection, string> = {
  missing: "Choose an image file to upload.",
  too_large: "The file is too large. The maximum size is 2 MB.",
  unsupported_type: "This file type is not supported. Use a PNG, JPEG or WebP image.",
  invalid_dimensions: `The image must be between ${LOGO_MIN_DIMENSION} and ${LOGO_MAX_DIMENSION} pixels wide and high.`,
};

/**
 * The single Storage object key of an organization's logo. Must match
 * public.organization_logo_path() and the organizations CHECK constraint.
 * There is no extension: the content type is stored with the object, and a
 * replacement overwrites the same key.
 */
export function organizationLogoPath(organizationId: string): string {
  return `organizations/${organizationId}/logo`;
}

export function isLogoMimeType(value: unknown): value is LogoMimeType {
  return typeof value === "string" && (LOGO_MIME_TYPES as readonly string[]).includes(value);
}

/**
 * Cheap checks on browser-reported metadata, for early feedback only. An
 * empty type (some browsers) is left to the content check.
 */
export function precheckLogoFile(file: { size: number; type: string }): LogoRejection | null {
  if (file.size <= 0) return "missing";
  if (file.size > LOGO_MAX_BYTES) return "too_large";
  if (file.type !== "" && !isLogoMimeType(file.type)) return "unsupported_type";
  return null;
}

export type LogoImage = { mimeType: LogoMimeType; width: number; height: number };

export type LogoValidation =
  | { ok: true; image: LogoImage }
  | { ok: false; reason: LogoRejection };

/**
 * Server-side validation of the uploaded bytes. The format comes from the
 * file's signature, not from its name or the browser-reported type, and the
 * dimensions from its header. A declared type outside the allowlist (for
 * example image/svg+xml) is rejected even if the content looks valid.
 */
export function validateLogo(file: { size: number; type: string; bytes: Uint8Array }): LogoValidation {
  const early = precheckLogoFile(file);
  if (early) return { ok: false, reason: early };
  if (file.bytes.length !== file.size) return { ok: false, reason: "unsupported_type" };

  const image = readImageHeader(file.bytes);
  if (!image) return { ok: false, reason: "unsupported_type" };
  if (
    image.width < LOGO_MIN_DIMENSION || image.height < LOGO_MIN_DIMENSION ||
    image.width > LOGO_MAX_DIMENSION || image.height > LOGO_MAX_DIMENSION
  ) {
    return { ok: false, reason: "invalid_dimensions" };
  }
  return { ok: true, image };
}

/** Format and pixel dimensions from a PNG, JPEG or WebP header, else null. */
export function readImageHeader(bytes: Uint8Array): LogoImage | null {
  return readPng(bytes) ?? readJpeg(bytes) ?? readWebp(bytes);
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

function readPng(b: Uint8Array): LogoImage | null {
  if (b.length < 24 || !PNG_SIGNATURE.every((v, i) => b[i] === v) || ascii(b, 12, 4) !== "IHDR") return null;
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  return { mimeType: "image/png", width: view.getUint32(16), height: view.getUint32(20) };
}

// Start-of-frame markers carry the dimensions (not DHT C4, JPG C8, DAC CC).
const JPEG_SOF = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

function readJpeg(b: Uint8Array): LogoImage | null {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8 || b[2] !== 0xff) return null;
  let i = 2;
  while (i + 3 < b.length) {
    if (b[i] !== 0xff) return null;
    const marker = b[i + 1];
    if (marker === 0xff) { i += 1; continue; } // fill byte
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) { i += 2; continue; } // no length
    if (marker === 0xd9 || marker === 0xda) return null; // end / scan before any frame header
    const length = (b[i + 2] << 8) | b[i + 3];
    if (length < 2) return null;
    if (JPEG_SOF.has(marker)) {
      if (i + 8 >= b.length) return null;
      return { mimeType: "image/jpeg", height: (b[i + 5] << 8) | b[i + 6], width: (b[i + 7] << 8) | b[i + 8] };
    }
    i += 2 + length;
  }
  return null;
}

function readWebp(b: Uint8Array): LogoImage | null {
  if (b.length < 30 || ascii(b, 0, 4) !== "RIFF" || ascii(b, 8, 4) !== "WEBP") return null;
  const chunk = ascii(b, 12, 4);
  const le16 = (o: number) => b[o] | (b[o + 1] << 8);
  const le24 = (o: number) => b[o] | (b[o + 1] << 8) | (b[o + 2] << 16);
  if (chunk === "VP8 ") {
    if (b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) return null;
    return { mimeType: "image/webp", width: le16(26) & 0x3fff, height: le16(28) & 0x3fff };
  }
  if (chunk === "VP8L") {
    if (b[20] !== 0x2f) return null;
    const width = 1 + (((b[22] & 0x3f) << 8) | b[21]);
    const height = 1 + (((b[24] & 0x0f) << 10) | (b[23] << 2) | ((b[22] & 0xc0) >> 6));
    return { mimeType: "image/webp", width, height };
  }
  if (chunk === "VP8X") {
    return { mimeType: "image/webp", width: 1 + le24(24), height: 1 + le24(27) };
  }
  return null;
}
