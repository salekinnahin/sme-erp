import { describe, expect, it } from "vitest";
import { validateQuotationItem } from "@/lib/quotations/validation";
import {
  SALES_ORDER_STATUSES,
  SALES_ORDER_TRANSITIONS,
  isSalesOrderStatus,
  isSalesOrderTransitionAllowed,
  isTerminalSalesOrderStatus,
  quotationConversionBlocker,
  toConversionRpcArgs,
  toSalesOrderRpcArgs,
  validateConversionInput,
  validateSalesOrderInput,
  validateSalesOrderItem,
  type SalesOrderItemRawInput,
  type SalesOrderRawInput,
} from "./validation";

const CUSTOMER_ID = "aaaaaaaa-0000-4000-8000-000000000001";
const PRODUCT_ID = "bbbbbbbb-0000-4000-8000-000000000002";
const LINE_ID = "cccccccc-0000-4000-8000-000000000003";
const QUOTATION_ID = "dddddddd-0000-4000-8000-000000000004";

const ITEM: SalesOrderItemRawInput = {
  productId: PRODUCT_ID,
  quantity: "1",
  unitPrice: "",
  discountAmount: "",
  taxRate: "",
};

const ORDER: SalesOrderRawInput = {
  customerId: CUSTOMER_ID,
  orderDate: "2026-11-04",
  expectedDeliveryDate: "",
  notes: "",
  items: [ITEM],
};

describe("status model", () => {
  it("has the four V1 statuses", () => {
    expect(SALES_ORDER_STATUSES).toEqual(["draft", "confirmed", "completed", "cancelled"]);
    expect(isSalesOrderStatus("confirmed")).toBe(true);
    expect(isSalesOrderStatus("sent")).toBe(false);
    expect(isSalesOrderStatus("CONFIRMED")).toBe(false);
  });

  it("allows exactly the V1 transitions (same table as the SQL function)", () => {
    const allowed = SALES_ORDER_STATUSES.flatMap((from) =>
      SALES_ORDER_STATUSES.filter((to) => isSalesOrderTransitionAllowed(from, to)).map(
        (to) => `${from}->${to}`,
      ),
    );
    expect(allowed).toEqual([
      "draft->confirmed",
      "draft->cancelled",
      "confirmed->completed",
      "confirmed->cancelled",
    ]);
  });

  it("treats completed and cancelled as terminal; never back to draft", () => {
    expect(SALES_ORDER_STATUSES.filter(isTerminalSalesOrderStatus)).toEqual(["completed", "cancelled"]);
    for (const from of SALES_ORDER_STATUSES) expect(SALES_ORDER_TRANSITIONS[from]).not.toContain("draft");
    expect(isSalesOrderTransitionAllowed("confirmed", "confirmed")).toBe(false);
    expect(isSalesOrderTransitionAllowed("draft", "completed")).toBe(false);
  });
});

describe("validateSalesOrderItem", () => {
  it("applies the quotation line rules unchanged", () => {
    const cases: SalesOrderItemRawInput[] = [
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
      const so = validateSalesOrderItem(raw);
      const qt = validateQuotationItem(raw);
      expect(so.ok).toBe(false);
      expect(qt.ok).toBe(false);
      if (!so.ok && !qt.ok) expect(so.errors).toEqual(qt.errors);
    }
  });

  it("normalizes like a quotation line and adds the line ID", () => {
    const result = validateSalesOrderItem({
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
    const missing = validateSalesOrderItem(ITEM);
    expect(missing.ok && missing.value.lineId).toBeNull();
    const empty = validateSalesOrderItem({ ...ITEM, lineId: "  " });
    expect(empty.ok && empty.value.lineId).toBeNull();
    const bad = validateSalesOrderItem({ ...ITEM, lineId: "line-1" });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors.lineId).toBeDefined();
  });
});

describe("validateSalesOrderInput", () => {
  it("accepts a minimal order and normalizes the header", () => {
    const result = validateSalesOrderInput({
      ...ORDER,
      customerId: ` ${CUSTOMER_ID.toUpperCase()} `,
      notes: "\u2028  Thanks \u3000",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.customerId).toBe(CUSTOMER_ID);
      expect(result.value.expectedDeliveryDate).toBeNull();
      expect(result.value.notes).toBe("Thanks");
    }
  });

  it("requires a customer and a valid order date", () => {
    const result = validateSalesOrderInput({ ...ORDER, customerId: "", orderDate: "" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.fieldErrors.customerId).toBeDefined();
      expect(result.fieldErrors.orderDate).toBe("Order date is required.");
    }
    const impossible = validateSalesOrderInput({ ...ORDER, orderDate: "2026-02-30" });
    expect(!impossible.ok && impossible.fieldErrors.orderDate).toBe("Enter a valid date.");
  });

  it("allows an expected delivery date on or after the order date only", () => {
    expect(validateSalesOrderInput({ ...ORDER, expectedDeliveryDate: "2026-11-04" }).ok).toBe(true);
    expect(validateSalesOrderInput({ ...ORDER, expectedDeliveryDate: "2026-12-01" }).ok).toBe(true);
    const before = validateSalesOrderInput({ ...ORDER, expectedDeliveryDate: "2026-11-03" });
    expect(!before.ok && before.fieldErrors.expectedDeliveryDate).toBe(
      "The expected delivery date cannot be before the order date.",
    );
    const invalid = validateSalesOrderInput({ ...ORDER, expectedDeliveryDate: "2026-13-01" });
    expect(!invalid.ok && invalid.fieldErrors.expectedDeliveryDate).toBe("Enter a valid date.");
  });

  it("limits notes to 2000 code points", () => {
    expect(validateSalesOrderInput({ ...ORDER, notes: "😀".repeat(2000) }).ok).toBe(true);
    const long = validateSalesOrderInput({ ...ORDER, notes: "😀".repeat(2001) });
    expect(!long.ok && long.fieldErrors.notes).toBeDefined();
  });

  it("requires 1 to 100 items", () => {
    const none = validateSalesOrderInput({ ...ORDER, items: [] });
    expect(!none.ok && none.fieldErrors.items).toBe("Add at least one item.");
    expect(validateSalesOrderInput({ ...ORDER, items: Array(100).fill(ITEM) }).ok).toBe(true);
    const many = validateSalesOrderInput({ ...ORDER, items: Array(101).fill(ITEM) });
    expect(!many.ok && many.fieldErrors.items).toBe("A sales order can have at most 100 items.");
  });

  it("reports per-item errors at the right index", () => {
    const result = validateSalesOrderInput({ ...ORDER, items: [ITEM, { ...ITEM, quantity: "0" }] });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.itemErrors[0]).toBeUndefined();
      expect(result.itemErrors[1]?.quantity).toBe("Quantity must be more than 0.");
    }
  });

  it("keeps each existing line at most once", () => {
    const result = validateSalesOrderInput({
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

describe("toSalesOrderRpcArgs", () => {
  it("sends only user-controlled values and omits defaults", () => {
    const result = validateSalesOrderInput({
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
    expect(toSalesOrderRpcArgs(result.value)).toEqual({
      p_customer_id: CUSTOMER_ID,
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

describe("quotation conversion", () => {
  it("validates the quotation ID and dates only", () => {
    const ok = validateConversionInput({
      quotationId: QUOTATION_ID.toUpperCase(),
      orderDate: "2026-11-05",
      expectedDeliveryDate: "",
    });
    expect(ok).toEqual({
      ok: true,
      value: { quotationId: QUOTATION_ID, orderDate: "2026-11-05", expectedDeliveryDate: null },
    });
    if (ok.ok)
      expect(toConversionRpcArgs(ok.value)).toEqual({
        p_quotation_id: QUOTATION_ID,
        p_order_date: "2026-11-05",
        p_expected_delivery_date: null,
      });

    const bad = validateConversionInput({ quotationId: "x", orderDate: "", expectedDeliveryDate: "2026-11-01" });
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(Object.keys(bad.fieldErrors).sort()).toEqual(["orderDate", "quotationId"]);
    }
    const early = validateConversionInput({
      quotationId: QUOTATION_ID,
      orderDate: "2026-11-05",
      expectedDeliveryDate: "2026-11-04",
    });
    expect(!early.ok && early.fieldErrors.expectedDeliveryDate).toBeDefined();
  });

  it("converts only accepted quotations, once", () => {
    expect(quotationConversionBlocker("accepted", false)).toBeNull();
    expect(quotationConversionBlocker("accepted", true)).toBe("already_converted");
    for (const status of ["draft", "sent", "rejected", "expired", "cancelled"])
      expect(quotationConversionBlocker(status, false)).toBe("not_accepted");
  });
});
