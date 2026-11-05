import { describe, expect, it } from "vitest";
import type { ProductOption } from "@/lib/quotations/form";
import {
  applyProductToSalesOrderLine,
  emptySalesOrderLine,
  isKeptLine,
  lineProduct,
  newSalesOrderFormValues,
  parseSalesOrderFormItems,
  previewSalesOrder,
  salesOrderToFormValues,
  serializeSalesOrderLines,
  snapshotCustomerOption,
  type SalesOrderFormValues,
} from "./form";
import type { SalesOrder } from "./sales-orders";
import { toSalesOrderRpcArgs, validateSalesOrderInput } from "./validation";

const CUSTOMER = "dddddddd-0000-4000-8000-000000000004";
const OTHER_CUSTOMER = "dddddddd-0000-4000-8000-000000000005";
const OLD_PRODUCT = "bbbbbbbb-0000-4000-8000-000000000009";
const PRODUCT = "bbbbbbbb-0000-4000-8000-000000000002";
const NEW_PRODUCT = "bbbbbbbb-0000-4000-8000-000000000003";
const LINE_1 = "eeeeeeee-0000-4000-8000-000000000001";
const LINE_2 = "eeeeeeee-0000-4000-8000-000000000002";

const item = (id: string, productId: string, overrides: Partial<SalesOrder["items"][number]> = {}) => ({
  id,
  productId,
  productName: "Old Gadget",
  sku: "OG-1",
  description: "Recorded desc",
  unit: "box",
  quantity: "3.000",
  unitPrice: "12.50",
  discountAmount: "0.00",
  taxRate: "7.50",
  taxAmount: "2.81",
  lineTotal: "40.31",
  sortOrder: 1,
  ...overrides,
});

const ORDER: SalesOrder = {
  id: "cccccccc-0000-4000-8000-000000000003",
  salesOrderNumber: "SO-000001",
  customerId: CUSTOMER,
  sourceQuotationId: null,
  sourceQuotationNumber: null,
  customerName: "Recorded Buyer",
  customerCompanyName: "Recorded Co",
  customerPhone: "+880 1711 000000",
  customerEmail: "rec@buyer.test",
  customerAddress: null,
  customerTaxNumber: null,
  orderDate: "2026-11-05",
  expectedDeliveryDate: null,
  status: "draft",
  notes: "Old notes",
  subtotal: "77.50",
  discountTotal: "5.00",
  taxTotal: "2.81",
  grandTotal: "75.31",
  createdAt: "2026-11-05T10:00:00Z",
  updatedAt: "2026-11-05T10:00:00Z",
  items: [
    // Line 1 uses a product that is inactive now.
    item(LINE_1, OLD_PRODUCT),
    item(LINE_2, PRODUCT, {
      productName: "Laptop",
      sku: "LAP-1",
      unit: "pcs",
      description: null,
      quantity: "1.000",
      unitPrice: "40.00",
      discountAmount: "5.00",
      taxRate: "0.00",
      taxAmount: "0.00",
      lineTotal: "35.00",
      sortOrder: 2,
    }),
  ],
};

const product = (id: string, overrides: Partial<ProductOption> = {}): ProductOption => ({
  id,
  name: "Current name",
  sku: "CUR-1",
  unit: "kg",
  description: "Current desc",
  sellingPrice: "99.00",
  status: "active",
  ...overrides,
});

/** The browser → Server Action → RPC pipeline, without the network. */
function submit(values: SalesOrderFormValues) {
  const parsed = parseSalesOrderFormItems(serializeSalesOrderLines(values.lines));
  if (!parsed.ok) throw new Error("unreadable");
  const result = validateSalesOrderInput({
    customerId: values.customerId,
    orderDate: values.orderDate,
    expectedDeliveryDate: values.expectedDeliveryDate,
    notes: values.notes,
    items: parsed.items,
  });
  if (!result.ok) throw new Error(JSON.stringify(result));
  return toSalesOrderRpcArgs(result.value);
}

describe("new sales order form", () => {
  it("defaults to today, no delivery date, one empty new line", () => {
    const values = newSalesOrderFormValues("2026-11-04");
    expect(values).toMatchObject({ customerId: "", orderDate: "2026-11-04", expectedDeliveryDate: "", notes: "" });
    expect(values.lines).toEqual([emptySalesOrderLine("line-0")]);
    expect(values.lines[0]).toMatchObject({ lineId: "", snapshot: null, quantity: "1" });
  });

  it("normalizes a direct create: trimmed values, no line IDs, no snapshots or amounts sent", () => {
    const values = newSalesOrderFormValues("2026-11-04");
    values.customerId = ` ${CUSTOMER.toUpperCase()} `;
    values.expectedDeliveryDate = "2026-11-10";
    values.notes = "  Deliver to gate 2　";
    values.lines = [
      applyProductToSalesOrderLine(emptySalesOrderLine("line-0"), product(PRODUCT)),
      { ...emptySalesOrderLine("new-1"), productId: NEW_PRODUCT, quantity: "2.5", unitPrice: "10", taxRate: "15" },
    ];
    const args = submit(values);
    expect(args).toEqual({
      p_customer_id: CUSTOMER,
      p_order_date: "2026-11-04",
      p_expected_delivery_date: "2026-11-10",
      p_notes: "Deliver to gate 2",
      p_items: [
        { product_id: PRODUCT, quantity: "1", unit_price: "99.00", discount_amount: "0", tax_rate: "0", description: "Current desc" },
        { product_id: NEW_PRODUCT, quantity: "2.5", unit_price: "10", discount_amount: "0", tax_rate: "15", description: null },
      ],
    });
    for (const line of args.p_items) expect(line).not.toHaveProperty("id");
  });

  it("rejects an expected delivery date before the order date", () => {
    const result = validateSalesOrderInput({
      customerId: CUSTOMER,
      orderDate: "2026-11-05",
      expectedDeliveryDate: "2026-11-04",
      notes: "",
      items: [{ productId: PRODUCT, quantity: "1", unitPrice: "", discountAmount: "", taxRate: "" }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.fieldErrors.expectedDeliveryDate).toMatch(/cannot be before/);
  });
});

describe("edit form: line IDs", () => {
  it("loads every line with its ID, snapshot and recorded values", () => {
    const values = salesOrderToFormValues(ORDER);
    expect(values).toMatchObject({ customerId: CUSTOMER, orderDate: "2026-11-05", expectedDeliveryDate: "", notes: "Old notes" });
    expect(values.lines.map((l) => l.lineId)).toEqual([LINE_1, LINE_2]);
    expect(values.lines[0]).toMatchObject({
      productId: OLD_PRODUCT,
      description: "Recorded desc",
      quantity: "3",
      unitPrice: "12.50",
      discountAmount: "",
      taxRate: "7.5",
      snapshot: { productId: OLD_PRODUCT, productName: "Old Gadget", sku: "OG-1", unit: "box", unitPrice: "12.50" },
    });
    expect(values.lines[1]).toMatchObject({ description: "", discountAmount: "5", taxRate: "" });
    expect(values.lines.every(isKeptLine)).toBe(true);
  });

  it("REGRESSION: editing only the notes of a draft with an inactive product keeps every line ID", () => {
    const values = salesOrderToFormValues(ORDER);
    const edited = { ...values, notes: "Only the notes changed" };
    const args = submit(edited);
    expect(args.p_notes).toBe("Only the notes changed");
    expect(args.p_customer_id).toBe(CUSTOMER);
    expect(args.p_items).toEqual([
      { id: LINE_1, product_id: OLD_PRODUCT, quantity: "3", unit_price: "12.50", discount_amount: "0", tax_rate: "7.5", description: "Recorded desc" },
      { id: LINE_2, product_id: PRODUCT, quantity: "1", unit_price: "40.00", discount_amount: "5", tax_rate: "0", description: null },
    ]);
  });

  it("omits the ID of a removed line and sends a new line without one", () => {
    const values = salesOrderToFormValues(ORDER);
    values.lines = [
      values.lines[1],
      { ...emptySalesOrderLine("new-2"), productId: NEW_PRODUCT, quantity: "1", unitPrice: "5" },
    ];
    const items = submit(values).p_items;
    expect(items.map((i) => i.id)).toEqual([LINE_2, undefined]);
    expect(items[1]).not.toHaveProperty("id");
    expect(JSON.stringify(items)).not.toContain(LINE_1);
  });

  it("keeps the existing line ID when the product changes, with the new product ID", () => {
    const values = salesOrderToFormValues(ORDER);
    const changed = applyProductToSalesOrderLine(values.lines[0], product(NEW_PRODUCT, { sellingPrice: "7.25", description: null }));
    expect(changed).toMatchObject({ key: "line-0", lineId: LINE_1, productId: NEW_PRODUCT, unitPrice: "7.25", description: "" });
    expect(changed.quantity).toBe("3");
    expect(isKeptLine(changed)).toBe(false);
    values.lines[0] = changed;
    expect(submit(values).p_items[0]).toMatchObject({ id: LINE_1, product_id: NEW_PRODUCT, unit_price: "7.25" });
  });

  it("the server parser reads line IDs and ignores forged snapshot and amount fields", () => {
    const raw = JSON.stringify([
      { key: "a", lineId: LINE_1, productId: OLD_PRODUCT, quantity: "1", unitPrice: "", discountAmount: "", taxRate: "",
        description: "x", product_name: "FORGED", line_total: "0", organization_id: "x" },
      { key: "b", lineId: 5, productId: PRODUCT, quantity: "1", unitPrice: "", discountAmount: "", taxRate: "" },
      { key: "c", productId: PRODUCT, quantity: "1", unitPrice: "", discountAmount: "", taxRate: "" },
    ]);
    const parsed = parseSalesOrderFormItems(raw);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.items.map((i) => i.lineId)).toEqual([LINE_1, "", ""]);
    expect(parsed.items[0]).not.toHaveProperty("product_name");
    expect(parseSalesOrderFormItems("{}")).toEqual({ ok: false });
    expect(parseSalesOrderFormItems("not json")).toEqual({ ok: false });
    expect(parseSalesOrderFormItems(undefined)).toEqual({ ok: false });
  });

  it("rejects a malformed or repeated line ID with a line error", () => {
    const base = { productId: PRODUCT, quantity: "1", unitPrice: "", discountAmount: "", taxRate: "" };
    const result = validateSalesOrderInput({
      customerId: CUSTOMER,
      orderDate: "2026-11-05",
      expectedDeliveryDate: "",
      notes: "",
      items: [{ ...base, lineId: LINE_1 }, { ...base, lineId: LINE_1 }, { ...base, lineId: "nope" }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.itemErrors[0]).toBeUndefined();
      expect(result.itemErrors[1]?.lineId).toBeDefined();
      expect(result.itemErrors[2]?.lineId).toBeDefined();
    }
  });
});

describe("edit form: current references", () => {
  it("shows a kept line's recorded snapshot, not the product's current master data", () => {
    const [line] = salesOrderToFormValues(ORDER).lines;
    const products = new Map([[OLD_PRODUCT, product(OLD_PRODUCT, { status: "inactive" })]]);
    expect(lineProduct(line, products)).toEqual({
      id: OLD_PRODUCT,
      name: "Old Gadget",
      sku: "OG-1",
      unit: "box",
      description: "Recorded desc",
      sellingPrice: "12.50",
      status: "inactive",
    });
    // Even if the current record could not be read.
    expect(lineProduct(line, new Map())?.name).toBe("Old Gadget");
  });

  it("shows the chosen product once the product changes", () => {
    const [line] = salesOrderToFormValues(ORDER).lines;
    const next = product(NEW_PRODUCT);
    const changed = applyProductToSalesOrderLine(line, next);
    expect(lineProduct(changed, new Map([[NEW_PRODUCT, next]]))).toBe(next);
  });

  it("selects the customer as recorded on the order, with its current status", () => {
    expect(snapshotCustomerOption(ORDER, { status: "inactive" })).toEqual({
      id: CUSTOMER,
      name: "Recorded Buyer",
      companyName: "Recorded Co",
      phone: "+880 1711 000000",
      email: "rec@buyer.test",
      status: "inactive",
    });
    expect(snapshotCustomerOption(ORDER, null).status).toBe("active");
  });

  it("an unchanged customer is submitted as-is; a changed one is the new ID", () => {
    const values = salesOrderToFormValues(ORDER);
    expect(submit(values).p_customer_id).toBe(CUSTOMER);
    expect(submit({ ...values, customerId: OTHER_CUSTOMER }).p_customer_id).toBe(OTHER_CUSTOMER);
  });
});

describe("calculation preview", () => {
  it("matches the stored amounts of a loaded draft", () => {
    const preview = previewSalesOrder(salesOrderToFormValues(ORDER).lines, new Map());
    expect(preview.lines.map((l) => l?.lineTotal)).toEqual(["40.31", "35.00"]);
    expect(preview.totals).toEqual({ subtotal: "77.50", discountTotal: "5.00", taxTotal: "2.81", grandTotal: "75.31" });
    expect(preview.incomplete).toBe(0);
  });

  it("a blank price on a kept line uses the recorded price; on a new selection the product's price", () => {
    const values = salesOrderToFormValues(ORDER);
    const kept = { ...values.lines[0], unitPrice: "", taxRate: "" };
    const changed = { ...applyProductToSalesOrderLine(values.lines[0], product(NEW_PRODUCT)), unitPrice: "", taxRate: "" };
    const products = new Map([[NEW_PRODUCT, product(NEW_PRODUCT)]]);
    const preview = previewSalesOrder([kept, changed], products);
    expect(preview.lines.map((l) => l?.lineTotal)).toEqual(["37.50", "297.00"]);
  });

  it("uses exact decimals (no floating point drift) and leaves out incomplete lines", () => {
    const products = new Map([[PRODUCT, product(PRODUCT)]]);
    const lines = [
      { ...emptySalesOrderLine("a"), productId: PRODUCT, quantity: "3", unitPrice: "0.10", taxRate: "0.05" },
      { ...emptySalesOrderLine("b"), productId: PRODUCT, quantity: "1.005", unitPrice: "1.00" },
      { ...emptySalesOrderLine("c"), productId: PRODUCT, quantity: "abc" },
      emptySalesOrderLine("d"),
    ];
    const preview = previewSalesOrder(lines, products);
    expect(preview.lines.map((l) => l?.lineTotal ?? null)).toEqual(["0.30", "1.01", null, null]);
    expect(preview.totals?.grandTotal).toBe("1.31");
    expect(preview.incomplete).toBe(2);
  });
});

describe("dates", () => {
  it("defaults the order date to today in the organization's time zone", async () => {
    const { todayInTimeZone } = await import("@/lib/quotations/form");
    // 2026-11-04 20:30 UTC is already 5 Nov in Dhaka (UTC+6) but 4 Nov in New York.
    const now = new Date("2026-11-04T20:30:00Z");
    expect(newSalesOrderFormValues(todayInTimeZone("Asia/Dhaka", now)).orderDate).toBe("2026-11-05");
    expect(newSalesOrderFormValues(todayInTimeZone("America/New_York", now)).orderDate).toBe("2026-11-04");
  });

  it("shows order and delivery dates as stored calendar dates (no time-zone shift)", async () => {
    const { formatCalendarDate } = await import("@/lib/format");
    expect(formatCalendarDate(ORDER.orderDate)).toBe("5 Nov 2026");
    expect(formatCalendarDate("2026-12-31")).toBe("31 Dec 2026");
  });
});
