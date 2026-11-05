import { fromScaled, rescaleHalfUp, toScaled } from "@/lib/validation/decimal";

/**
 * Quotation line and total calculations on exact decimal strings (BigInt
 * internally, never JavaScript numbers). The database is authoritative: it
 * recomputes every amount in public.quotation_replace_items() and checks
 * each stored line with the quotation_items_amounts_check constraint. These
 * functions implement the same model so the app can show previews and
 * friendly errors; the two must stay in sync
 * (supabase/migrations/20261104090000_quotations.sql, DECISIONS 018).
 *
 *   gross      = round(quantity × unit_price, 2)
 *   taxable    = gross − discount_amount            (0 <= discount <= gross)
 *   tax_amount = round(taxable × tax_rate / 100, 2)
 *   line_total = taxable + tax_amount
 *
 *   subtotal       = Σ gross
 *   discount_total = Σ discount_amount
 *   tax_total      = Σ tax_amount
 *   grand_total    = subtotal − discount_total + tax_total
 *
 * Rounding is half up (all values are non-negative), like PostgreSQL
 * round(numeric).
 */

const QTY = 3;
const MONEY = 2;
const RATE = 2;

/** Values must fit numeric(18,2): at most 9999999999999999.99. */
const MONEY_LIMIT = BigInt("1000000000000000000"); // 10^18 units of 0.01
const ZERO = BigInt(0);

export type LineInput = {
  /** Canonical decimal strings: quantity ≤ 3 decimals, money and rate ≤ 2. */
  quantity: string;
  unitPrice: string;
  discountAmount: string;
  taxRate: string;
};

export type LineAmounts = {
  /** quantity × unit price, rounded. Not stored; part of the subtotal. */
  gross: string;
  discountAmount: string;
  taxableAmount: string;
  taxAmount: string;
  lineTotal: string;
};

export type LineError = "discount_exceeds_gross" | "too_large";

export function calculateLine(
  line: LineInput,
): { ok: true; value: LineAmounts } | { ok: false; error: LineError } {
  const quantity = toScaled(line.quantity, QTY);
  const unitPrice = toScaled(line.unitPrice, MONEY);
  const discount = toScaled(line.discountAmount, MONEY);
  const rate = toScaled(line.taxRate, RATE);

  // quantity (scale 3) × price (scale 2) has scale 5.
  const gross = rescaleHalfUp(quantity * unitPrice, QTY + MONEY, MONEY);
  if (gross >= MONEY_LIMIT) return { ok: false, error: "too_large" };
  if (discount > gross) return { ok: false, error: "discount_exceeds_gross" };

  const taxable = gross - discount;
  // taxable (scale 2) × rate (scale 2) / 100 has scale 2 + 2 + 2 = 6.
  const tax = rescaleHalfUp(taxable * rate, MONEY + RATE + 2, MONEY);
  const total = taxable + tax;
  if (total >= MONEY_LIMIT) return { ok: false, error: "too_large" };

  return {
    ok: true,
    value: {
      gross: fromScaled(gross, MONEY),
      discountAmount: fromScaled(discount, MONEY),
      taxableAmount: fromScaled(taxable, MONEY),
      taxAmount: fromScaled(tax, MONEY),
      lineTotal: fromScaled(total, MONEY),
    },
  };
}

export type QuotationTotals = {
  subtotal: string;
  discountTotal: string;
  taxTotal: string;
  grandTotal: string;
};

export function calculateTotals(
  lines: readonly Pick<LineAmounts, "gross" | "discountAmount" | "taxAmount">[],
): { ok: true; value: QuotationTotals } | { ok: false; error: "too_large" } {
  let subtotal = ZERO;
  let discountTotal = ZERO;
  let taxTotal = ZERO;
  for (const line of lines) {
    subtotal += toScaled(line.gross, MONEY);
    discountTotal += toScaled(line.discountAmount, MONEY);
    taxTotal += toScaled(line.taxAmount, MONEY);
  }
  const grandTotal = subtotal - discountTotal + taxTotal;
  if (subtotal >= MONEY_LIMIT || taxTotal >= MONEY_LIMIT || grandTotal >= MONEY_LIMIT)
    return { ok: false, error: "too_large" };

  return {
    ok: true,
    value: {
      subtotal: fromScaled(subtotal, MONEY),
      discountTotal: fromScaled(discountTotal, MONEY),
      taxTotal: fromScaled(taxTotal, MONEY),
      grandTotal: fromScaled(grandTotal, MONEY),
    },
  };
}
