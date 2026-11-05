/**
 * Sales orders use the quotation calculation model unchanged (DECISIONS 018,
 * 022): the same SQL formula and CHECK constraint, and the same TypeScript
 * implementation. Import it from here in sales order code so the reuse is
 * explicit; never copy the formulas.
 */
export {
  calculateLine,
  calculateTotals,
  type LineAmounts,
  type LineError,
  type LineInput,
  type QuotationTotals as SalesOrderTotals,
} from "@/lib/quotations/calculations";
