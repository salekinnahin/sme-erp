/**
 * Exact decimal handling on strings (docs/DECISIONS.md 016, 018).
 *
 * Money and quantities never pass through JavaScript numbers. Inputs are
 * parsed into canonical decimal strings that PostgreSQL reads exactly, and
 * arithmetic uses BigInt on values scaled to a fixed number of decimals.
 */

export type DecimalFormat = { integerDigits: number; scale: number };

// Plain ASCII digits with an optional decimal point: "12", "12.5", ".5", "12.".
// No sign, exponent, thousands separator or other numerals.
const DECIMAL_RE = /^(?:(\d+)(?:\.(\d*))?|\.(\d+))$/;

export type DecimalResult =
  | { ok: true; value: string }
  | { ok: false; error: "format" | "scale" | "too_large" };

/**
 * Parses a non-negative decimal without converting it to a number. Returns a
 * canonical string ("007.50" -> "7.50", ".5" -> "0.5", "5." -> "5") that
 * PostgreSQL reads exactly. Rejects more decimals than `scale` instead of
 * rounding them.
 */
export function parseDecimal(raw: string, format: DecimalFormat): DecimalResult {
  const match = DECIMAL_RE.exec(raw);
  if (!match) return { ok: false, error: "format" };
  const intPart = (match[1] ?? "").replace(/^0+(?=\d)/, "") || "0";
  const fracPart = match[2] ?? match[3] ?? "";
  if (fracPart.length > format.scale) return { ok: false, error: "scale" };
  if (intPart.length > format.integerDigits) return { ok: false, error: "too_large" };
  return { ok: true, value: fracPart ? `${intPart}.${fracPart}` : intPart };
}

// -----------------------------------------------------------------------------
// Scaled BigInt arithmetic (non-negative values only)
// -----------------------------------------------------------------------------

// BigInt() calls instead of 0n-style literals: tsconfig targets ES2017.
const ZERO = BigInt(0);
const ONE = BigInt(1);
const TWO = BigInt(2);
const TEN = BigInt(10);

const UNSIGNED_DECIMAL_RE = /^(\d+)(?:\.(\d+))?$/;

/**
 * A canonical non-negative decimal string as an integer count of
 * 10^-scale units: toScaled("12.5", 2) is 1250. Throws if the string is
 * not a plain decimal or has more than `scale` decimals, so a programming
 * error never rounds silently.
 */
export function toScaled(value: string, scale: number): bigint {
  const match = UNSIGNED_DECIMAL_RE.exec(value);
  if (!match) throw new Error(`Not a decimal: ${value}`);
  const frac = match[2] ?? "";
  if (frac.length > scale) throw new Error(`More than ${scale} decimals: ${value}`);
  return BigInt(match[1] + frac.padEnd(scale, "0"));
}

/** A scaled integer as a decimal string with exactly `scale` decimals. */
export function fromScaled(value: bigint, scale: number): string {
  if (value < ZERO) throw new Error("Negative values are not supported.");
  const digits = value.toString().padStart(scale + 1, "0");
  if (scale === 0) return digits;
  return `${digits.slice(0, -scale)}.${digits.slice(-scale)}`;
}

/**
 * Re-scales a non-negative integer from `fromScale` to `toScale` decimals,
 * rounding half up. For non-negative values this matches PostgreSQL
 * round(numeric, n), which rounds half away from zero.
 */
export function rescaleHalfUp(value: bigint, fromScale: number, toScale: number): bigint {
  if (value < ZERO) throw new Error("Negative values are not supported.");
  if (toScale >= fromScale) return value * TEN ** BigInt(toScale - fromScale);
  const divisor = TEN ** BigInt(fromScale - toScale);
  const quotient = value / divisor;
  return (value % divisor) * TWO >= divisor ? quotient + ONE : quotient;
}
