import { describe, expect, it } from "vitest";
import { validateQuotationItem } from "@/lib/quotations/validation";
import {
  toPurchaseOrderRpcArgs,
  validatePurchaseOrderInput,
  validatePurchaseOrderItem,
  type PurchaseOrderItemRawInput,
  type PurchaseOrderRawInput,
} from "./validation";

const VENDOR_ID = "aaaaaaaa-0000-4000-8000-000000000001";
const PRODUCT_ID = "bbbbbbbb-0000-4000-8000-000000000002";
const LINE_ID = "cccccccc-0000-4000-8000-000000000003";

const ITEM: PurchaseOrderItemRawInput = {
  productId: PRODUCT_ID,
  quantity: "1",
  unitPrice: "",
  discountAmount: "",
  taxRate: "",
};

const ORDER: PurchaseOrderRawInput = {
  vendorId: VENDOR_ID,
  orderDate: "2026-11-04",
  expectedDeliveryDate: "",
  notes: "",
  items: [ITEM],
};

describe("validatePurchaseOrderItem", () => {
  it("applies the quotation line rules unchanged", () => {
    const cases: PurchaseOrderItemRawInput[] = [
      { ...ITEM, quantity: "0" },
      { ...ITEM, quantity: "1.0001" },
      { ...ITEM, quantity: "1e3" },
      { ...ITEM, unitPrice: "1.001" },
      { ...ITEM, unitPrice: "-1" },
      { ...ITEM, taxRate: "100.01" },
      { ...ITEM, unitPrice: "5", quantity: "2", discountAmount: "10.01" },
      { ...ITEM, productId: "nope" },
      { ...ITEM, description: "😀".repeat(2001) },
    ];
    for (const raw of cases) {
      const so = validatePurchaseOrderItem(raw);
      const qt = validateQuotationItem(raw);
      expect(so.ok).toBe(false);
      expect(qt.ok).toBe(false);
      if (!so.ok && !qt.ok) expect(so.errors).toEqual(qt.errors);
    }
  });

  it("normalizes like a quotation line and adds the line ID", () => {
    const result = validatePurchaseOrderItem({
      ...ITEM,
      productId: PRODUCT_ID.toUpperCase(),
      quantity: " 2.50 ",
      unitPrice: "10",
      lineId: ` ${LINE_ID.toUpperCase()} `,
    });
    expect(result).toEqual({
      ok: true,
      value: {
        productId: PRODUCT_ID,
        description: undefined,
        quantity: "2.50",
        unitPrice: "10",
        discountAmount: "0",
        taxRate: "0",
        lineId: LINE_ID,
      },
    });
  });

  it("treats a missing or empty line ID as a new selection and rejects malformed ones", () => {
    const missing = validatePurchaseOrderItem(ITEM);
    expect(missing.ok && missing.value.lineId).toBeNull();
    const empty = validatePurchaseOrderItem({ ...ITEM, lineId: "  " });
    expect(empty.ok && empty.value.lineId).toBeNull();
    const bad = validatePurchaseOrderItem({ ...ITEM, lineId: "line-1" });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors.lineId).toBeDefined();
  });
});

describe("validatePurchaseOrderInput", () => {
  it("accepts a minimal order and normalizes the header", () => {
    const result = validatePurchaseOrderInput({
      ...ORDER,
      vendorId: ` ${VENDOR_ID.toUpperCase()} `,
      notes: "\u2028  Thanks \u3000",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.vendorId).toBe(VENDOR_ID);
      expect(result.value.expectedDeliveryDate).toBeNull();
      expect(result.value.notes).toBe("Thanks");
    }
  });

  it("requires a vendor and a valid order date", () => {
    const result = validatePurchaseOrderInput({ ...ORDER, vendorId: "", orderDate: "" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.fieldErrors.vendorId).toBeDefined();
      expect(result.fieldErrors.orderDate).toBe("Order date is required.");
    }
    const impossible = validatePurchaseOrderInput({ ...ORDER, orderDate: "2026-02-30" });
    expect(!impossible.ok && impossible.fieldErrors.orderDate).toBe("Enter a valid date.");
  });

  it("allows an expected delivery date on or after the order date only", () => {
    expect(validatePurchaseOrderInput({ ...ORDER, expectedDeliveryDate: "2026-11-04" }).ok).toBe(true);
    expect(validatePurchaseOrderInput({ ...ORDER, expectedDeliveryDate: "2026-12-01" }).ok).toBe(true);
    const before = validatePurchaseOrderInput({ ...ORDER, expectedDeliveryDate: "2026-11-03" });
    expect(!before.ok && before.fieldErrors.expectedDeliveryDate).toBe(
      "The expected delivery date cannot be before the order date.",
    );
    const invalid = validatePurchaseOrderInput({ ...ORDER, expectedDeliveryDate: "2026-13-01" });
    expect(!invalid.ok && invalid.fieldErrors.expectedDeliveryDate).toBe("Enter a valid date.");
  });

  it("limits notes to 2000 code points", () => {
    expect(validatePurchaseOrderInput({ ...ORDER, notes: "😀".repeat(2000) }).ok).toBe(true);
    const long = validatePurchaseOrderInput({ ...ORDER, notes: "😀".repeat(2001) });
    expect(!long.ok && long.fieldErrors.notes).toBeDefined();
  });

  it("requires 1 to 100 items", () => {
    const none = validatePurchaseOrderInput({ ...ORDER, items: [] });
    expect(!none.ok && none.fieldErrors.items).toBe("Add at least one item.");
    expect(validatePurchaseOrderInput({ ...ORDER, items: Array(100).fill(ITEM) }).ok).toBe(true);
    const many = validatePurchaseOrderInput({ ...ORDER, items: Array(101).fill(ITEM) });
    expect(!many.ok && many.fieldErrors.items).toBe("A purchase order can have at most 100 items.");
  });

  it("reports per-item errors at the right index", () => {
    const result = validatePurchaseOrderInput({ ...ORDER, items: [ITEM, { ...ITEM, quantity: "0" }] });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.itemErrors[0]).toBeUndefined();
      expect(result.itemErrors[1]?.quantity).toBe("Quantity must be more than 0.");
    }
  });

  it("keeps each existing line at most once", () => {
    const result = validatePurchaseOrderInput({
      ...ORDER,
      items: [{ ...ITEM, lineId: LINE_ID }, { ...ITEM, lineId: LINE_ID.toUpperCase() }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.itemErrors[0]).toBeUndefined();
      expect(result.itemErrors[1]?.lineId).toBeDefined();
    }
  });
});

describe("toPurchaseOrderRpcArgs", () => {
  it("sends only user-controlled values and omits defaults", () => {
    const result = validatePurchaseOrderInput({
      ...ORDER,
      expectedDeliveryDate: "2026-11-30",
      notes: "Hi",
      items: [
        { ...ITEM, lineId: LINE_ID, unitPrice: "90.00", discountAmount: "10", taxRate: "15" },
        { ...ITEM, description: "" },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(toPurchaseOrderRpcArgs(result.value)).toEqual({
      p_vendor_id: VENDOR_ID,
      p_order_date: "2026-11-04",
      p_expected_delivery_date: "2026-11-30",
      p_notes: "Hi",
      p_items: [
        {
          id: LINE_ID,
          product_id: PRODUCT_ID,
          quantity: "1",
          unit_price: "90.00",
          discount_amount: "10",
          tax_rate: "15",
        },
        { product_id: PRODUCT_ID, quantity: "1", discount_amount: "0", tax_rate: "0", description: null },
      ],
    });
  });
});

