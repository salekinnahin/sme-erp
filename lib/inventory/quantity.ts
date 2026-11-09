/**
 * Stock quantities stay exact decimal strings end to end (DECISIONS 016,
 * 033). The database returns numeric values as text with 3 decimals, e.g.
 * "10.000", "-2.500" or "1999999999999999.999" (a balance may exceed
 * numeric(18,3)); they are validated here and never converted to numbers.
 */
const STOCK_QUANTITY_RE = /^-?(?:0|[1-9]\d*)\.\d{3}$/;

/** The quantity as returned by the database, or throws (fail closed). */
export function parseStockQuantity(value: unknown): string {
  if (typeof value !== "string" || !STOCK_QUANTITY_RE.test(value) || value === "-0.000") {
    throw new Error("Invalid stock quantity.");
  }
  return value;
}

/** Direction of a signed movement quantity, decided on the string. */
export function stockQuantityDirection(quantityDelta: string): "in" | "out" {
  return parseStockQuantity(quantityDelta).startsWith("-") ? "out" : "in";
}
