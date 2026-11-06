import { expect, it } from "vitest";
import { GOODS_RECEIPT_MESSAGES, goodsReceiptFailure } from "./errors";
it.each([
  ["P0002", "not_found"], ["55000", "not_receivable"], ["GR001", "line_not_found"],
  ["GR002", "service"], ["GR003", "over_receiving"], ["GR004", "fully_received"],
  ["GR006", "unknown_product_type"], ["GR007", "invalid_date"], ["GR008", "invalid_quantity"],
  ["40001", "conflict"], ["40P01", "conflict"], ["55P03", "conflict"], ["42501", "forbidden"],
  ["22008", "invalid_date"], ["22023", "invalid"], ["23514", "invalid"], ["unknown", "failed"],
])("maps %s to %s with an allowlisted message", (code, reason) => {
  const failure = goodsReceiptFailure({ code });
  expect(failure).toBe(reason);
  expect(GOODS_RECEIPT_MESSAGES[failure]).toBeTruthy();
  expect(GOODS_RECEIPT_MESSAGES[failure]).not.toContain(code);
});
