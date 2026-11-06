import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { PurchaseOrderForm } from "@/app/purchase-orders/_components/purchase-order-form";
import {
  applyProductToPurchaseOrderLine,
  canRestoreRecordedProduct,
  emptyPurchaseOrderLine,
  isKeptLine,
  lineProduct,
  needsUnitPrice,
  newPurchaseOrderFormValues,
  parsePurchaseOrderFormItems,
  previewPurchaseOrder,
  purchaseOrderToFormValues,
  rememberSelectedProduct,
  restoreRecordedProduct,
  serializePurchaseOrderLines,
  snapshotVendorOption,
  vendorOptionLabel,
  type PurchaseOrderFormValues,
  type PurchaseProductOption,
} from "./form";
import type { PurchaseOrder } from "./purchase-orders";
import { toPurchaseOrderRpcArgs, validatePurchaseOrderInput } from "./validation";

vi.mock("@/app/purchase-orders/actions", () => ({
  searchPurchaseOrderVendorsAction: vi.fn(),
  searchPurchaseOrderProductsAction: vi.fn(),
}));

const VENDOR = "dddddddd-0000-4000-8000-000000000004";
const OTHER_VENDOR = "dddddddd-0000-4000-8000-000000000005";
const OLD_PRODUCT = "bbbbbbbb-0000-4000-8000-000000000009";
const PRODUCT = "bbbbbbbb-0000-4000-8000-000000000002";
const NEW_PRODUCT = "bbbbbbbb-0000-4000-8000-000000000003";
const LINE_1 = "eeeeeeee-0000-4000-8000-000000000001";
const LINE_2 = "eeeeeeee-0000-4000-8000-000000000002";

const item = (id: string, productId: string, overrides: Partial<PurchaseOrder["items"][number]> = {}) => ({
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

const ORDER: PurchaseOrder = {
  id: "cccccccc-0000-4000-8000-000000000003",
  purchaseOrderNumber: "PO-000001",
  vendorId: VENDOR,
  vendorName: "Recorded Supplier",
  vendorCompanyName: "Recorded Supply Co",
  vendorPhone: "+880 1711 000000",
  vendorEmail: "rec@supplier.test",
  vendorAddress: null,
  vendorTaxNumber: null,
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

const product = (id: string, overrides: Partial<PurchaseProductOption> = {}): PurchaseProductOption => ({
  id,
  name: "Current name",
  sku: "CUR-1",
  unit: "kg",
  description: "Current desc",
  purchasePrice: "60.00",
  status: "active",
  ...overrides,
});

/** The browser → Server Action → RPC pipeline, without the network. */
function submit(values: PurchaseOrderFormValues) {
  const parsed = parsePurchaseOrderFormItems(serializePurchaseOrderLines(values.lines));
  if (!parsed.ok) throw new Error("unreadable");
  const result = validatePurchaseOrderInput({
    vendorId: values.vendorId,
    orderDate: values.orderDate,
    expectedDeliveryDate: values.expectedDeliveryDate,
    notes: values.notes,
    items: parsed.items,
  });
  if (!result.ok) throw new Error(JSON.stringify(result));
  return toPurchaseOrderRpcArgs(result.value);
}

function render(values: PurchaseOrderFormValues, products: PurchaseProductOption[] = [], vendor = null as ReturnType<typeof snapshotVendorOption> | null) {
  return renderToStaticMarkup(createElement(PurchaseOrderForm, {
    action: async () => ({}), initialValues: values, currentVendor: vendor,
    currentProducts: products, currency: "BDT", submitLabel: "Save",
    pendingText: "Saving…", cancelHref: "/purchase-orders",
  }));
}

describe("new purchase order form", () => {
  it("defaults to today, no expected delivery, one empty new line", () => {
    const values = newPurchaseOrderFormValues("2026-11-06");
    expect(values).toMatchObject({ vendorId: "", orderDate: "2026-11-06", expectedDeliveryDate: "", notes: "" });
    expect(values.lines).toEqual([emptyPurchaseOrderLine("line-0")]);
    expect(values.lines[0]).toMatchObject({ lineId: "", snapshot: null, quantity: "1" });
  });

  it("normalizes a direct create: trimmed values, no line IDs, no snapshots, status or amounts sent", () => {
    const values = newPurchaseOrderFormValues("2026-11-06");
    values.vendorId = ` ${VENDOR.toUpperCase()} `;
    values.expectedDeliveryDate = "2026-11-20";
    values.notes = "  Deliver to warehouse gate 2　";
    values.lines = [
      applyProductToPurchaseOrderLine(emptyPurchaseOrderLine("line-0"), product(PRODUCT)),
      { ...emptyPurchaseOrderLine("new-1"), productId: NEW_PRODUCT, quantity: "2.5", unitPrice: "10", taxRate: "15" },
    ];
    const args = submit(values);
    expect(args).toEqual({
      p_vendor_id: VENDOR,
      p_order_date: "2026-11-06",
      p_expected_delivery_date: "2026-11-20",
      p_notes: "Deliver to warehouse gate 2",
      p_items: [
        { product_id: PRODUCT, quantity: "1", unit_price: "60.00", discount_amount: "0", tax_rate: "0", description: "Current desc" },
        { product_id: NEW_PRODUCT, quantity: "2.5", unit_price: "10", discount_amount: "0", tax_rate: "15", description: null },
      ],
    });
    for (const line of args.p_items) expect(line).not.toHaveProperty("id");
    expect(JSON.stringify(args)).not.toMatch(/status|organization|grand_total|vendor_name|product_name/);
  });

  it("an empty expected delivery is sent as null; before the order date is rejected", () => {
    const values = newPurchaseOrderFormValues("2026-11-06");
    values.vendorId = VENDOR;
    values.lines = [{ ...emptyPurchaseOrderLine("a"), productId: PRODUCT }];
    expect(submit(values).p_expected_delivery_date).toBeNull();
    const result = validatePurchaseOrderInput({
      vendorId: VENDOR, orderDate: "2026-11-06", expectedDeliveryDate: "2026-11-05", notes: "",
      items: [{ productId: PRODUCT, quantity: "1", unitPrice: "", discountAmount: "", taxRate: "" }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.fieldErrors.expectedDeliveryDate).toMatch(/cannot be before/);
    const bad = validatePurchaseOrderInput({
      vendorId: VENDOR, orderDate: "2026-02-30", expectedDeliveryDate: "", notes: "",
      items: [{ productId: PRODUCT, quantity: "1", unitPrice: "", discountAmount: "", taxRate: "" }],
    });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.fieldErrors.orderDate).toBe("Enter a valid date.");
  });
});

describe("purchase price defaults", () => {
  it("a new selection defaults to the purchase price; the option type has no selling price", () => {
    const chosen = product(PRODUCT, { purchasePrice: "12.34" });
    const line = applyProductToPurchaseOrderLine(emptyPurchaseOrderLine("a"), chosen);
    expect(line).toMatchObject({ productId: PRODUCT, unitPrice: "12.34", description: "Current desc" });
    expect(chosen).not.toHaveProperty("sellingPrice");
    // Even if a selling price leaked into the option, it would be ignored.
    const leaked = { ...chosen, sellingPrice: "999.00" } as PurchaseProductOption;
    expect(applyProductToPurchaseOrderLine(emptyPurchaseOrderLine("b"), leaked).unitPrice).toBe("12.34");
  });

  it("a blank unit price previews with the purchase price (as the database defaults)", () => {
    const products = new Map([[PRODUCT, product(PRODUCT, { purchasePrice: "60.00" })]]);
    const preview = previewPurchaseOrder([{ ...emptyPurchaseOrderLine("a"), productId: PRODUCT, quantity: "2" }], products);
    expect(preview.lines[0]?.lineTotal).toBe("120.00");
  });

  it("without a purchase price the price stays blank, is required, and the line is incomplete", () => {
    const noPrice = product(PRODUCT, { purchasePrice: null });
    const line = applyProductToPurchaseOrderLine(emptyPurchaseOrderLine("a"), noPrice);
    expect(line.unitPrice).toBe("");
    expect(needsUnitPrice(line, noPrice)).toBe(true);
    expect(needsUnitPrice({ ...line, unitPrice: "5" }, noPrice)).toBe(false);
    expect(needsUnitPrice(emptyPurchaseOrderLine("b"), undefined)).toBe(false);
    expect(needsUnitPrice(line, product(PRODUCT))).toBe(false);
    const preview = previewPurchaseOrder([line], new Map([[PRODUCT, noPrice]]));
    expect(preview.lines[0]).toBeNull();
    expect(preview.incomplete).toBe(1);
    expect(previewPurchaseOrder([{ ...line, unitPrice: "5.00" }], new Map([[PRODUCT, noPrice]])).totals?.grandTotal).toBe("5.00");
  });

  it("renders the missing purchase price hint and a 'Required' placeholder", () => {
    const values = newPurchaseOrderFormValues("2026-11-06");
    const noPrice = product(PRODUCT, { purchasePrice: null });
    values.lines = [applyProductToPurchaseOrderLine(emptyPurchaseOrderLine("line-0"), noPrice)];
    const html = render(values, [noPrice]);
    expect(html).toContain("No purchase price on this product. Enter a unit price.");
    expect(html).toContain('placeholder="Required"');
    values.lines[0] = { ...values.lines[0], unitPrice: "3" };
    expect(render(values, [noPrice])).not.toContain("No purchase price");
  });
});

describe("edit form: line IDs", () => {
  it("loads every line with its ID, snapshot and recorded values", () => {
    const values = purchaseOrderToFormValues(ORDER);
    expect(values).toMatchObject({ vendorId: VENDOR, orderDate: "2026-11-05", expectedDeliveryDate: "", notes: "Old notes" });
    expect(values.lines.map((l) => l.lineId)).toEqual([LINE_1, LINE_2]);
    expect(values.lines[0]).toMatchObject({
      productId: OLD_PRODUCT, description: "Recorded desc", quantity: "3", unitPrice: "12.50",
      discountAmount: "", taxRate: "7.5",
      snapshot: { productId: OLD_PRODUCT, productName: "Old Gadget", sku: "OG-1", unit: "box", unitPrice: "12.50" },
    });
    expect(values.lines.every(isKeptLine)).toBe(true);
  });

  it("REGRESSION: editing only the notes of a draft with an inactive product/vendor keeps every line ID", () => {
    const args = submit({ ...purchaseOrderToFormValues(ORDER), notes: "Only the notes changed" });
    expect(args.p_vendor_id).toBe(VENDOR);
    expect(args.p_items).toEqual([
      { id: LINE_1, product_id: OLD_PRODUCT, quantity: "3", unit_price: "12.50", discount_amount: "0", tax_rate: "7.5", description: "Recorded desc" },
      { id: LINE_2, product_id: PRODUCT, quantity: "1", unit_price: "40.00", discount_amount: "5", tax_rate: "0", description: null },
    ]);
  });

  it("omits the ID of a removed line and sends a new line without one", () => {
    const values = purchaseOrderToFormValues(ORDER);
    values.lines = [values.lines[1], { ...emptyPurchaseOrderLine("new-2"), productId: NEW_PRODUCT, quantity: "1", unitPrice: "5" }];
    const items = submit(values).p_items;
    expect(items.map((i) => i.id)).toEqual([LINE_2, undefined]);
    expect(items[1]).not.toHaveProperty("id");
    expect(JSON.stringify(items)).not.toContain(LINE_1);
  });

  it("keeps the line ID when the product changes, with the new product's purchase price", () => {
    const values = purchaseOrderToFormValues(ORDER);
    const changed = applyProductToPurchaseOrderLine(values.lines[0], product(NEW_PRODUCT, { purchasePrice: "7.25", description: null }));
    expect(changed).toMatchObject({ key: "line-0", lineId: LINE_1, productId: NEW_PRODUCT, unitPrice: "7.25", description: "", quantity: "3" });
    expect(isKeptLine(changed)).toBe(false);
    values.lines[0] = changed;
    expect(submit(values).p_items[0]).toMatchObject({ id: LINE_1, product_id: NEW_PRODUCT, unit_price: "7.25" });
  });

  it("the server parser reads line IDs and ignores forged snapshot and amount fields", () => {
    const raw = JSON.stringify([
      { key: "a", lineId: LINE_1, productId: OLD_PRODUCT, quantity: "1", unitPrice: "", discountAmount: "", taxRate: "",
        product_name: "FORGED", line_total: "0", organization_id: "x", unit_price_override: "1" },
      { key: "b", lineId: 5, productId: PRODUCT, quantity: "1", unitPrice: "", discountAmount: "", taxRate: "" },
      { key: "c", productId: PRODUCT, quantity: "1", unitPrice: "", discountAmount: "", taxRate: "" },
    ]);
    const parsed = parsePurchaseOrderFormItems(raw);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.items.map((i) => i.lineId)).toEqual([LINE_1, "", ""]);
    expect(parsed.items[0]).not.toHaveProperty("product_name");
    for (const bad of ["{}", "not json", undefined, 5, "[1]"]) expect(parsePurchaseOrderFormItems(bad)).toEqual({ ok: false });
  });

  it("rejects a malformed or repeated line ID with a line error", () => {
    const base = { productId: PRODUCT, quantity: "1", unitPrice: "", discountAmount: "", taxRate: "" };
    const result = validatePurchaseOrderInput({
      vendorId: VENDOR, orderDate: "2026-11-05", expectedDeliveryDate: "", notes: "",
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

describe("edit form: A → B → A restoration", () => {
  // The product's current master data has moved on since the order was saved.
  const currentA = product(PRODUCT, { name: "Laptop v2", sku: "LAP-2", unit: "set", purchasePrice: "150.00", description: "Current laptop desc" });
  const other = product(NEW_PRODUCT, { purchasePrice: "7.25", description: "Other desc" });
  const recorded = (): PurchaseOrderFormValues =>
    purchaseOrderToFormValues({
      ...ORDER,
      items: [ORDER.items[0], { ...ORDER.items[1], unitPrice: "100.00", description: "Recorded laptop desc", discountAmount: "0.00", lineTotal: "100.00" }],
    });

  it("REGRESSION: re-selecting active A restores the recorded PO price (100, not 150) and description", () => {
    const values = recorded();
    const toB = applyProductToPurchaseOrderLine(values.lines[1], other);
    expect(toB).toMatchObject({ productId: NEW_PRODUCT, unitPrice: "7.25", description: "Other desc", lineId: LINE_2 });
    const backToA = applyProductToPurchaseOrderLine(toB, currentA);
    expect(backToA).toMatchObject({ lineId: LINE_2, productId: PRODUCT, unitPrice: "100.00", description: "Recorded laptop desc", quantity: "1" });
    expect(isKeptLine(backToA)).toBe(true);
    // Name, SKU, unit come from the snapshot, not master data.
    expect(lineProduct(backToA, new Map([[PRODUCT, currentA]]))).toMatchObject({
      name: "Laptop", sku: "LAP-1", unit: "pcs", purchasePrice: "100.00", description: "Recorded laptop desc",
    });
    values.lines[1] = backToA;
    expect(submit(values).p_items[1]).toMatchObject({ id: LINE_2, product_id: PRODUCT, unit_price: "100.00", description: "Recorded laptop desc" });
  });

  it("restores inactive A via the per-line control, keeping quantity, discount, tax and token", () => {
    const values = purchaseOrderToFormValues(ORDER);
    const original = { ...values.lines[0], quantity: "4.5", discountAmount: "2.25", taxRate: "15" };
    const products = new Map([[OLD_PRODUCT, product(OLD_PRODUCT, { status: "inactive", purchasePrice: "999.00" })], [NEW_PRODUCT, other]]);
    const changed = applyProductToPurchaseOrderLine(original, other);
    expect(canRestoreRecordedProduct(changed)).toBe(true);
    const restored = restoreRecordedProduct(changed);
    expect(restored).toEqual(original);
    expect(lineProduct(restored, products)).toEqual({
      id: OLD_PRODUCT, name: "Old Gadget", sku: "OG-1", unit: "box",
      description: "Recorded desc", purchasePrice: "12.50", status: "inactive",
    });
    expect(canRestoreRecordedProduct(restored)).toBe(false);
    expect(lineProduct(restored, new Map())?.name).toBe("Old Gadget");
    values.lines[0] = restored;
    expect(submit(values).p_items[0]).toEqual({
      id: LINE_1, product_id: OLD_PRODUCT, quantity: "4.5", unit_price: "12.50",
      discount_amount: "2.25", tax_rate: "15", description: "Recorded desc",
    });
  });

  it("restores a recorded empty description, not the product's current one", () => {
    const line = purchaseOrderToFormValues(ORDER).lines[1];
    expect(restoreRecordedProduct(applyProductToPurchaseOrderLine(line, other))).toEqual(line);
    expect(applyProductToPurchaseOrderLine(applyProductToPurchaseOrderLine(line, other), currentA))
      .toMatchObject({ unitPrice: "40.00", description: "" });
  });

  it("offers no restore for new, unchanged or snapshot-less lines", () => {
    const [unchanged] = purchaseOrderToFormValues(ORDER).lines;
    for (const line of [
      emptyPurchaseOrderLine("new"),
      applyProductToPurchaseOrderLine(emptyPurchaseOrderLine("new"), other),
      unchanged,
      { ...unchanged, snapshot: null, productId: NEW_PRODUCT },
      { ...unchanged, lineId: "", productId: NEW_PRODUCT },
    ]) {
      expect(canRestoreRecordedProduct(line)).toBe(false);
      expect(restoreRecordedProduct(line)).toBe(line);
    }
  });

  it("a new line choosing A uses A's current purchase price", () => {
    expect(applyProductToPurchaseOrderLine(emptyPurchaseOrderLine("new-1"), currentA))
      .toMatchObject({ lineId: "", productId: PRODUCT, unitPrice: "150.00", description: "Current laptop desc" });
  });

  it("renders the restore control only for changed saved lines, then the inactive recorded label", () => {
    const values = purchaseOrderToFormValues(ORDER);
    const products = [product(OLD_PRODUCT, { status: "inactive" }), other];
    expect(render(values, products)).not.toContain("Restore recorded product");
    expect(render(values, products)).toContain("Old Gadget (OG-1) (inactive)");
    values.lines.push(applyProductToPurchaseOrderLine(emptyPurchaseOrderLine("new"), other));
    expect(render(values, products)).not.toContain("Restore recorded product");
    values.lines[0] = applyProductToPurchaseOrderLine(values.lines[0], other);
    expect(render(values, products).match(/Restore recorded product/g)).toHaveLength(1);
    values.lines[0] = restoreRecordedProduct(values.lines[0]);
    const restored = render(values, products);
    expect(restored).not.toContain("Restore recorded product");
    expect(restored).toContain("Old Gadget (OG-1) (inactive)");
  });
});

describe("edit form: current vendor and products", () => {
  it("selects the vendor as recorded, with its current (inactive) status", () => {
    const vendor = snapshotVendorOption(ORDER, { status: "inactive" });
    expect(vendor).toEqual({
      id: VENDOR, name: "Recorded Supplier", companyName: "Recorded Supply Co",
      phone: "+880 1711 000000", email: "rec@supplier.test", status: "inactive",
    });
    expect(vendorOptionLabel(vendor)).toBe("Recorded Supplier — Recorded Supply Co (inactive)");
    expect(snapshotVendorOption(ORDER, null).status).toBe("active");
    expect(render(purchaseOrderToFormValues(ORDER), [], vendor)).toContain("Recorded Supplier — Recorded Supply Co (inactive)");
  });

  it("an unchanged vendor is submitted as-is; a changed one is the new ID", () => {
    const values = purchaseOrderToFormValues(ORDER);
    expect(submit(values).p_vendor_id).toBe(VENDOR);
    expect(submit({ ...values, vendorId: OTHER_VENDOR }).p_vendor_id).toBe(OTHER_VENDOR);
  });

  it("a kept line shows the recorded snapshot, a changed line the chosen product", () => {
    const [line] = purchaseOrderToFormValues(ORDER).lines;
    expect(lineProduct(line, new Map([[OLD_PRODUCT, product(OLD_PRODUCT, { status: "inactive" })]])))
      .toMatchObject({ name: "Old Gadget", status: "inactive", purchasePrice: "12.50" });
    const next = product(NEW_PRODUCT);
    expect(lineProduct(applyProductToPurchaseOrderLine(line, next), new Map([[NEW_PRODUCT, next]]))).toBe(next);
  });
});

describe("calculation preview", () => {
  it("matches the stored amounts of a loaded draft (exact decimals)", () => {
    const preview = previewPurchaseOrder(purchaseOrderToFormValues(ORDER).lines, new Map());
    expect(preview.lines.map((l) => l?.lineTotal)).toEqual(["40.31", "35.00"]);
    expect(preview.totals).toEqual({ subtotal: "77.50", discountTotal: "5.00", taxTotal: "2.81", grandTotal: "75.31" });
  });

  it("a blank price on a kept line uses the recorded price, on a new selection the purchase price", () => {
    const values = purchaseOrderToFormValues(ORDER);
    const kept = { ...values.lines[0], unitPrice: "", taxRate: "" };
    const changed = { ...applyProductToPurchaseOrderLine(values.lines[0], product(NEW_PRODUCT)), unitPrice: "", taxRate: "" };
    const preview = previewPurchaseOrder([kept, changed], new Map([[NEW_PRODUCT, product(NEW_PRODUCT)]]));
    expect(preview.lines.map((l) => l?.lineTotal)).toEqual(["37.50", "180.00"]);
  });

  it("uses exact half-up decimals with no float drift; leaves out invalid lines", () => {
    const products = new Map([[PRODUCT, product(PRODUCT)]]);
    const preview = previewPurchaseOrder([
      { ...emptyPurchaseOrderLine("a"), productId: PRODUCT, quantity: "3", unitPrice: "0.10", taxRate: "0.05" },
      { ...emptyPurchaseOrderLine("b"), productId: PRODUCT, quantity: "1.005", unitPrice: "1.00" },
      { ...emptyPurchaseOrderLine("c"), productId: PRODUCT, quantity: "abc" },
      emptyPurchaseOrderLine("d"),
    ], products);
    expect(preview.lines.map((l) => l?.lineTotal ?? null)).toEqual(["0.30", "1.01", null, null]);
    expect(preview.totals?.grandTotal).toBe("1.31");
    expect(preview.incomplete).toBe(2);
  });
});

describe("dates", () => {
  it("defaults the order date to today in the organization's time zone", async () => {
    const { todayInTimeZone } = await import("@/lib/quotations/form");
    const now = new Date("2026-11-04T20:30:00Z");
    expect(newPurchaseOrderFormValues(todayInTimeZone("Asia/Dhaka", now)).orderDate).toBe("2026-11-05");
    expect(newPurchaseOrderFormValues(todayInTimeZone("America/New_York", now)).orderDate).toBe("2026-11-04");
  });

  it("shows order and expected delivery dates as stored calendar dates (no time-zone shift)", async () => {
    const { formatCalendarDate } = await import("@/lib/format");
    expect(formatCalendarDate(ORDER.orderDate)).toBe("5 Nov 2026");
    expect(formatCalendarDate("2026-12-31")).toBe("31 Dec 2026");
  });
});

describe("product cache: a fresh search result replaces the cached record", () => {
  const HINT = "No purchase price on this product. Enter a unit price.";
  const cached = product(PRODUCT, { purchasePrice: "60.00", unit: "ton", description: "Old desc" });

  /** What the form's onSelectProduct does: cache the picked record, then apply it to the line. */
  function select(
    known: ReadonlyMap<string, PurchaseProductOption>,
    line: PurchaseOrderFormValues["lines"][number],
    picked: PurchaseProductOption,
  ) {
    return { products: rememberSelectedProduct(known, picked), line: applyProductToPurchaseOrderLine(line, picked) };
  }

  const priced = (line: PurchaseOrderFormValues["lines"][number]) => ({ ...line, quantity: "2" });

  it("REGRESSION: cached 60.00 → fresh null: blank price, required hint, no stale 60.00 in the preview", () => {
    const fresh = product(PRODUCT, { purchasePrice: null, unit: "drum", description: "New desc" });
    // Product A was picked earlier on another line, so the 60.00 record is cached.
    const known = rememberSelectedProduct(new Map(), cached);
    const { products, line } = select(known, emptyPurchaseOrderLine("new-1"), fresh);

    expect(products.get(PRODUCT)).toBe(fresh);
    expect(line).toMatchObject({ productId: PRODUCT, unitPrice: "", description: "New desc" });
    const shown = lineProduct(line, products);
    expect(shown).toMatchObject({ purchasePrice: null, unit: "drum" });
    expect(needsUnitPrice(line, shown)).toBe(true);

    const preview = previewPurchaseOrder([priced(line)], products);
    expect(preview.lines[0]).toBeNull();
    expect(preview.incomplete).toBe(1);
    expect(preview.totals?.grandTotal ?? "0.00").not.toBe("120.00");

    const values = { ...newPurchaseOrderFormValues("2026-11-06"), lines: [priced(line)] };
    const html = render(values, [...products.values()]);
    expect(html).toContain(HINT);
    expect(html).toContain('placeholder="Required"');
    expect(html).toContain("drum");
    expect(html).not.toContain("60.00");
    expect(html).not.toContain(">ton<");
  });

  it("cached 60.00 → fresh 75.00 uses 75.00", () => {
    const fresh = product(PRODUCT, { purchasePrice: "75.00" });
    const { products, line } = select(new Map([[PRODUCT, cached]]), emptyPurchaseOrderLine("new-1"), fresh);
    expect(line.unitPrice).toBe("75.00");
    expect(lineProduct(line, products)?.purchasePrice).toBe("75.00");
    expect(previewPurchaseOrder([{ ...priced(line), unitPrice: "" }], products).lines[0]?.lineTotal).toBe("150.00");
  });

  it("cached null → fresh 80.00 uses 80.00 and drops the required hint", () => {
    const stale = product(PRODUCT, { purchasePrice: null });
    const fresh = product(PRODUCT, { purchasePrice: "80.00" });
    const { products, line } = select(new Map([[PRODUCT, stale]]), emptyPurchaseOrderLine("new-1"), fresh);
    expect(line.unitPrice).toBe("80.00");
    expect(needsUnitPrice({ ...line, unitPrice: "" }, lineProduct(line, products))).toBe(false);
    expect(previewPurchaseOrder([{ ...priced(line), unitPrice: "" }], products).lines[0]?.lineTotal).toBe("160.00");
  });

  it("fresh unit, name and description replace the stale cached ones on every line using that product", () => {
    const fresh = product(PRODUCT, { name: "Renamed", unit: "drum", description: "New desc" });
    const other = { ...emptyPurchaseOrderLine("new-2"), productId: PRODUCT };
    const { products, line } = select(new Map([[PRODUCT, cached]]), emptyPurchaseOrderLine("new-1"), fresh);
    expect(line.description).toBe("New desc");
    for (const l of [line, other]) {
      expect(lineProduct(l, products)).toMatchObject({ name: "Renamed", unit: "drum" });
    }
  });

  it("returns the same map when the same record is selected again", () => {
    const known = new Map([[PRODUCT, cached]]);
    expect(rememberSelectedProduct(known, cached)).toBe(known);
    expect(known.get(PRODUCT)).toBe(cached);
  });

  it("a saved line that keeps its product still shows its recorded values after a fresh pick elsewhere", () => {
    const values = purchaseOrderToFormValues(ORDER);
    const fresh = product(PRODUCT, { name: "Laptop v3", unit: "drum", purchasePrice: null });
    // A new line picks the fresh record of the product saved line 2 uses.
    const { products } = select(new Map([[PRODUCT, cached]]), emptyPurchaseOrderLine("new-1"), fresh);
    const kept = values.lines[1];
    expect(isKeptLine(kept)).toBe(true);
    expect(lineProduct(kept, products)).toMatchObject({ name: "Laptop", sku: "LAP-1", unit: "pcs", purchasePrice: "40.00" });
    expect(needsUnitPrice({ ...kept, unitPrice: "" }, lineProduct(kept, products))).toBe(false);
    expect(previewPurchaseOrder([{ ...kept, unitPrice: "" }], products).lines[0]?.lineTotal).toBe("35.00");
    expect(submit(values).p_items[1]).toMatchObject({ id: LINE_2, product_id: PRODUCT, unit_price: "40.00" });
  });

  it("A → B → A with fresh records still restores the recorded PO values", () => {
    const values = purchaseOrderToFormValues(ORDER);
    const freshA = product(PRODUCT, { name: "Laptop v3", unit: "drum", purchasePrice: null, description: "Fresh desc" });
    const freshB = product(NEW_PRODUCT, { purchasePrice: "7.25" });
    let products: ReadonlyMap<string, PurchaseProductOption> = new Map([[PRODUCT, cached]]);
    let line = values.lines[1];
    ({ products, line } = select(products, line, freshB));
    expect(line).toMatchObject({ productId: NEW_PRODUCT, unitPrice: "7.25" });
    ({ products, line } = select(products, line, freshA));
    expect(products.get(PRODUCT)).toBe(freshA);
    expect(line).toMatchObject({ lineId: LINE_2, productId: PRODUCT, unitPrice: "40.00", description: "" });
    expect(lineProduct(line, products)).toMatchObject({ name: "Laptop", unit: "pcs", purchasePrice: "40.00" });
    expect(needsUnitPrice(line, lineProduct(line, products))).toBe(false);

    // The per-line restore control is unchanged too.
    const changed = select(products, values.lines[0], freshB).line;
    expect(restoreRecordedProduct(changed)).toEqual(values.lines[0]);
  });
});
