import { describe, expect, it } from "vitest";
import { parseStockQuantity, stockQuantityDirection } from "./quantity";

describe("stock quantity strings", () => {
  it("keeps exact database text, including values beyond JS number precision", () => {
    for (const value of ["0.000", "0.001", "10.000", "-2.500", "999999999999999.999", "1999999999999999.999", "-999999999999999.999"]) {
      expect(parseStockQuantity(value)).toBe(value);
    }
    // A float conversion would have corrupted these.
    expect(Number("999999999999999.999").toFixed(3)).not.toBe("999999999999999.999");
    expect(parseStockQuantity("999999999999999.999")).toBe("999999999999999.999");
  });

  it.each([
    [1], [0.001], [null], [undefined], [""], ["10"], ["10.5"], ["10.0000"], ["1e3"], ["+1.000"],
    ["01.000"], [" 1.000"], ["NaN"], ["Infinity"], ["-0.000"], ["1,000.000"], ["١.٠٠٠"],
  ])("rejects %j (fail closed)", (value) => {
    expect(() => parseStockQuantity(value)).toThrow("Invalid stock quantity.");
  });

  it("derives direction from the sign, without arithmetic", () => {
    expect(stockQuantityDirection("30.000")).toBe("in");
    expect(stockQuantityDirection("0.001")).toBe("in");
    expect(stockQuantityDirection("-10.000")).toBe("out");
    expect(() => stockQuantityDirection("abc")).toThrow();
  });
});
