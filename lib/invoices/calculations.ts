/**
 * Invoices use the quotation calculation model unchanged (DECISIONS 018,
 * 022, 023): the same SQL formula and CHECK constraint, and the same
 * TypeScript implementation. Import it from here in invoice code so the
 * reuse is explicit; never copy the formulas.
 */
export {
  calculateLine,
  calculateTotals,
  type LineAmounts,
  type LineError,
  type LineInput,
  type QuotationTotals as InvoiceTotals,
} from "@/lib/quotations/calculations";
