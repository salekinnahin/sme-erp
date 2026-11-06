import { describe, expect, it } from "vitest";
import { isReceivableStatus, receivingLineFailure, remainingQuantity, type ReceivingLine } from "./calculations";
import { canGoodsReceipt } from "./permissions";
const line: ReceivingLine = { purchase_order_item_id: "id", product_id: "p", product_name: "Item", sku: "SKU", description: null, unit: "pcs", product_type: "inventory", receivable: true, ordered_quantity: "100.000", received_quantity: "40.000", remaining_quantity: "60.000", sort_order: 1 };
describe("receiving rules", () => {
  it("tracks 40/30/30 receipts without floating point errors", () => {
    expect(remainingQuantity("100", ["40"])).toBe("60.000");
    expect(remainingQuantity("100", ["40", "30"])).toBe("30.000");
    expect(remainingQuantity("100", ["40", "30", "30"])).toBe("0.000");
    expect(remainingQuantity("999999999999999.999", ["999999999999999.998"])).toBe("0.001");
    expect(remainingQuantity("0.3", ["0.1", "0.2"])).toBe("0.000");
    expect(() => remainingQuantity("1", ["1.001"])).toThrow();
  });
  it.each(["ordered", "partially_received"])("receives %s", (status) => expect(isReceivableStatus(status)).toBe(true));
  it.each(["draft", "received", "cancelled", "unknown"])("rejects %s", (status) => expect(isReceivableStatus(status)).toBe(false));
  it("rejects missing, services, unknown types, full and excess lines", () => {
    expect(receivingLineFailure(undefined, "1")).toBe("line_not_found");
    expect(receivingLineFailure({ ...line, product_type: "service" }, "1")).toBe("service");
    expect(receivingLineFailure({ ...line, product_type: null }, "1")).toBe("unknown_product_type");
    expect(receivingLineFailure({ ...line, remaining_quantity: "0.000" }, "1")).toBe("fully_received");
    expect(receivingLineFailure(line, "60.001")).toBe("over_receiving");
    expect(receivingLineFailure(line, "60")).toBeNull();
    expect(receivingLineFailure({ ...line, product_type: "non_inventory" }, "60")).toBeNull();
  });
  it.each(["owner", "manager", "employee"])("allows %s to view/create only", (role) => {
    expect(canGoodsReceipt(role, "view")).toBe(true);
    expect(canGoodsReceipt(role, "create")).toBe(true);
    expect(canGoodsReceipt(role, "edit")).toBe(false);
    expect(canGoodsReceipt(role, "delete")).toBe(false);
  });
  it("fails closed for unknown roles", () => expect(canGoodsReceipt("admin", "create")).toBe(false));
});
