import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { InvoiceForm } from "@/app/invoices/_components/invoice-form";
import type { ProductOption } from "@/lib/quotations/form";
import {
  applyProductToInvoiceLine,
  canRestoreRecordedProduct,
  emptyInvoiceLine,
  isKeptLine,
  lineProduct,
  newInvoiceFormValues,
  parseInvoiceFormItems,
  previewInvoice,
  restoreRecordedProduct,
  invoiceToFormValues,
  serializeInvoiceLines,
  snapshotCustomerOption,
  type InvoiceFormValues,
} from "./form";
import type { Invoice } from "./invoices";
import { toInvoiceRpcArgs, validateInvoiceInput } from "./validation";

vi.mock("@/app/invoices/actions", () => ({
  searchInvoiceCustomersAction: vi.fn(),
  searchInvoiceProductsAction: vi.fn(),
}));

const CUSTOMER = "dddddddd-0000-4000-8000-000000000004";
const OTHER_CUSTOMER = "dddddddd-0000-4000-8000-000000000005";
const OLD_PRODUCT = "bbbbbbbb-0000-4000-8000-000000000009";
const PRODUCT = "bbbbbbbb-0000-4000-8000-000000000002";
const NEW_PRODUCT = "bbbbbbbb-0000-4000-8000-000000000003";
const LINE_1 = "eeeeeeee-0000-4000-8000-000000000001";
const LINE_2 = "eeeeeeee-0000-4000-8000-000000000002";

const item = (id: string, productId: string, overrides: Partial<Invoice["items"][number]> = {}) => ({
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

const ORDER: Invoice = {
  id: "cccccccc-0000-4000-8000-000000000003",
  invoiceNumber: "SO-000001",
  customerId: CUSTOMER,
  sourceSalesOrderId: null,
  sourceSalesOrderNumber: null,
  customerName: "Recorded Buyer",
  customerCompanyName: "Recorded Co",
  customerPhone: "+880 1711 000000",
  customerEmail: "rec@buyer.test",
  customerAddress: null,
  customerTaxNumber: null,
  invoiceDate: "2026-11-05",
  dueDate: null,
  status: "draft",
  notes: "Old notes",
  subtotal: "77.50",
  discountTotal: "5.00",
  taxTotal: "2.81",
  grandTotal: "75.31",
  amountPaid: "0.00",
  amountDue: "75.31",
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
function submit(values: InvoiceFormValues) {
  const parsed = parseInvoiceFormItems(serializeInvoiceLines(values.lines));
  if (!parsed.ok) throw new Error("unreadable");
  const result = validateInvoiceInput({
    customerId: values.customerId,
    invoiceDate: values.invoiceDate,
    dueDate: values.dueDate,
    notes: values.notes,
    items: parsed.items,
  });
  if (!result.ok) throw new Error(JSON.stringify(result));
  return toInvoiceRpcArgs(result.value);
}

describe("new invoice form", () => {
  it("defaults to today, no due date, one empty new line", () => {
    const values = newInvoiceFormValues("2026-11-04");
    expect(values).toMatchObject({ customerId: "", invoiceDate: "2026-11-04", dueDate: "", notes: "" });
    expect(values.lines).toEqual([emptyInvoiceLine("line-0")]);
    expect(values.lines[0]).toMatchObject({ lineId: "", snapshot: null, quantity: "1" });
  });

  it("normalizes a direct create: trimmed values, no line IDs, no snapshots or amounts sent", () => {
    const values = newInvoiceFormValues("2026-11-04");
    values.customerId = ` ${CUSTOMER.toUpperCase()} `;
    values.dueDate = "2026-11-10";
    values.notes = "  Deliver to gate 2　";
    values.lines = [
      applyProductToInvoiceLine(emptyInvoiceLine("line-0"), product(PRODUCT)),
      { ...emptyInvoiceLine("new-1"), productId: NEW_PRODUCT, quantity: "2.5", unitPrice: "10", taxRate: "15" },
    ];
    const args = submit(values);
    expect(args).toEqual({
      p_customer_id: CUSTOMER,
      p_invoice_date: "2026-11-04",
      p_due_date: "2026-11-10",
      p_notes: "Deliver to gate 2",
      p_items: [
        { product_id: PRODUCT, quantity: "1", unit_price: "99.00", discount_amount: "0", tax_rate: "0", description: "Current desc" },
        { product_id: NEW_PRODUCT, quantity: "2.5", unit_price: "10", discount_amount: "0", tax_rate: "15", description: null },
      ],
    });
    for (const line of args.p_items) expect(line).not.toHaveProperty("id");
  });

  it("rejects an expected due date before the order date", () => {
    const result = validateInvoiceInput({
      customerId: CUSTOMER,
      invoiceDate: "2026-11-05",
      dueDate: "2026-11-04",
      notes: "",
      items: [{ productId: PRODUCT, quantity: "1", unitPrice: "", discountAmount: "", taxRate: "" }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.fieldErrors.dueDate).toMatch(/cannot be before/);
  });
});

describe("edit form: line IDs", () => {
  it("loads every line with its ID, snapshot and recorded values", () => {
    const values = invoiceToFormValues(ORDER);
    expect(values).toMatchObject({ customerId: CUSTOMER, invoiceDate: "2026-11-05", dueDate: "", notes: "Old notes" });
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
    const values = invoiceToFormValues(ORDER);
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
    const values = invoiceToFormValues(ORDER);
    values.lines = [
      values.lines[1],
      { ...emptyInvoiceLine("new-2"), productId: NEW_PRODUCT, quantity: "1", unitPrice: "5" },
    ];
    const items = submit(values).p_items;
    expect(items.map((i) => i.id)).toEqual([LINE_2, undefined]);
    expect(items[1]).not.toHaveProperty("id");
    expect(JSON.stringify(items)).not.toContain(LINE_1);
  });

  it("keeps the existing line ID when the product changes, with the new product ID", () => {
    const values = invoiceToFormValues(ORDER);
    const changed = applyProductToInvoiceLine(values.lines[0], product(NEW_PRODUCT, { sellingPrice: "7.25", description: null }));
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
    const parsed = parseInvoiceFormItems(raw);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.items.map((i) => i.lineId)).toEqual([LINE_1, "", ""]);
    expect(parsed.items[0]).not.toHaveProperty("product_name");
    expect(parseInvoiceFormItems("{}")).toEqual({ ok: false });
    expect(parseInvoiceFormItems("not json")).toEqual({ ok: false });
    expect(parseInvoiceFormItems(undefined)).toEqual({ ok: false });
  });

  it("rejects a malformed or repeated line ID with a line error", () => {
    const base = { productId: PRODUCT, quantity: "1", unitPrice: "", discountAmount: "", taxRate: "" };
    const result = validateInvoiceInput({
      customerId: CUSTOMER,
      invoiceDate: "2026-11-05",
      dueDate: "",
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

describe("edit form: re-selecting the line's original product", () => {
  // Line 2 recorded PRODUCT at 40.00 with no description; give it a recorded
  // price of 100 and a description for these cases.
  const recorded = (): InvoiceFormValues =>
    invoiceToFormValues({
      ...ORDER,
      items: [
        ORDER.items[0],
        { ...ORDER.items[1], unitPrice: "100.00", description: "Recorded laptop desc", discountAmount: "0.00", lineTotal: "100.00" },
      ],
    });
  // The product's current master data has moved on since the order was saved.
  const current = product(PRODUCT, { name: "Laptop v2", sku: "LAP-2", unit: "set", sellingPrice: "150.00", description: "Current laptop desc" });
  const other = product(NEW_PRODUCT, { sellingPrice: "7.25", description: "Other desc" });

  it("restores inactive A after selecting active B using only the saved snapshot and token", () => {
    const values = invoiceToFormValues(ORDER);
    const original = { ...values.lines[0], quantity: "4.5", discountAmount: "2.25", taxRate: "15" };
    const products = new Map([
      [OLD_PRODUCT, product(OLD_PRODUCT, { status: "inactive", sellingPrice: "999.00" })],
      [NEW_PRODUCT, other],
    ]);
    const changed = applyProductToInvoiceLine(original, other);
    expect(canRestoreRecordedProduct(changed)).toBe(true);
    const restored = restoreRecordedProduct(changed);
    expect(restored).toEqual(original);
    expect(lineProduct(restored, products)).toEqual({
      id: OLD_PRODUCT, name: "Old Gadget", sku: "OG-1", unit: "box",
      description: "Recorded desc", sellingPrice: "12.50", status: "inactive",
    });
    expect(canRestoreRecordedProduct(restored)).toBe(false);
    // Restoration also works without a current master record in the option cache.
    expect(lineProduct(restoreRecordedProduct(changed), new Map())?.name).toBe("Old Gadget");
    values.lines[0] = restored;
    expect(submit(values).p_items[0]).toEqual({
      id: LINE_1, product_id: OLD_PRODUCT, quantity: "4.5", unit_price: "12.50",
      discount_amount: "2.25", tax_rate: "15", description: "Recorded desc",
    });
  });

  it("offers no restore for new, unchanged or snapshot-less lines", () => {
    const [unchanged] = invoiceToFormValues(ORDER).lines;
    for (const line of [
      emptyInvoiceLine("new"),
      applyProductToInvoiceLine(emptyInvoiceLine("new"), other),
      unchanged,
      { ...unchanged, snapshot: null, productId: NEW_PRODUCT },
      { ...unchanged, lineId: "", productId: NEW_PRODUCT },
    ]) {
      expect(canRestoreRecordedProduct(line)).toBe(false);
      expect(restoreRecordedProduct(line)).toBe(line);
    }
  });

  it("the restore control clears a description that was originally empty", () => {
    const line = invoiceToFormValues(ORDER).lines[1];
    expect(restoreRecordedProduct(applyProductToInvoiceLine(line, other))).toEqual(line);
  });

  it("renders the restore control only for changed saved lines, then shows the inactive recorded label", () => {
    const values = invoiceToFormValues(ORDER);
    const products = [product(OLD_PRODUCT, { status: "inactive" }), other];
    const render = () => renderToStaticMarkup(createElement(InvoiceForm, {
      action: async () => ({}), initialValues: values, currentCustomer: null,
      currentProducts: products, currency: "BDT", submitLabel: "Save",
      pendingText: "Saving…", cancelHref: "/invoices",
    }));
    expect(render()).not.toContain("Restore recorded product");
    values.lines.push(applyProductToInvoiceLine(emptyInvoiceLine("new"), other));
    expect(render()).not.toContain("Restore recorded product");
    values.lines[0] = applyProductToInvoiceLine(values.lines[0], other);
    expect(render().match(/Restore recorded product/g)).toHaveLength(1);
    values.lines[0] = restoreRecordedProduct(values.lines[0]);
    const restored = render();
    expect(restored).not.toContain("Restore recorded product");
    expect(restored).toContain("Old Gadget (OG-1) (inactive)");
  });

  it("REGRESSION: A → B → A restores the recorded price (100, not 150) and description", () => {
    const values = recorded();
    const toB = applyProductToInvoiceLine(values.lines[1], other);
    expect(toB).toMatchObject({ productId: NEW_PRODUCT, unitPrice: "7.25", description: "Other desc" });
    const backToA = applyProductToInvoiceLine(toB, current);
    expect(backToA).toMatchObject({
      lineId: LINE_2,
      productId: PRODUCT,
      unitPrice: "100.00",
      description: "Recorded laptop desc",
      quantity: "1",
    });
    expect(isKeptLine(backToA)).toBe(true);
    // Name, SKU and unit come from the recorded snapshot, not master data.
    expect(lineProduct(backToA, new Map([[PRODUCT, current]]))).toMatchObject({
      name: "Laptop",
      sku: "LAP-1",
      unit: "pcs",
      sellingPrice: "100.00",
      description: "Recorded laptop desc",
    });
    values.lines[1] = backToA;
    expect(submit(values).p_items[1]).toMatchObject({
      id: LINE_2,
      product_id: PRODUCT,
      unit_price: "100.00",
      description: "Recorded laptop desc",
    });
  });

  it("restores a recorded empty description, not the product's current one", () => {
    const values = invoiceToFormValues(ORDER); // line 2 recorded no description
    const back = applyProductToInvoiceLine(applyProductToInvoiceLine(values.lines[1], other), current);
    expect(back).toMatchObject({ unitPrice: "40.00", description: "" });
  });

  it("a genuinely different product still uses its current values", () => {
    const changed = applyProductToInvoiceLine(recorded().lines[1], other);
    expect(changed).toMatchObject({ lineId: LINE_2, productId: NEW_PRODUCT, unitPrice: "7.25", description: "Other desc" });
    expect(isKeptLine(changed)).toBe(false);
  });

  it("a new line choosing the same product uses its current values", () => {
    const line = applyProductToInvoiceLine(emptyInvoiceLine("new-1"), current);
    expect(line).toMatchObject({ lineId: "", productId: PRODUCT, unitPrice: "150.00", description: "Current laptop desc" });
  });

  it("unrelated edits keep the recorded values", () => {
    const values = recorded();
    values.lines[1] = { ...values.lines[1], quantity: "4", taxRate: "5" };
    values.notes = "Changed";
    expect(submit(values).p_items[1]).toMatchObject({
      id: LINE_2,
      product_id: PRODUCT,
      quantity: "4",
      unit_price: "100.00",
      tax_rate: "5",
      description: "Recorded laptop desc",
    });
  });

  it("the line ID is still sent unchanged through every product change", () => {
    const values = recorded();
    const viaB = applyProductToInvoiceLine(applyProductToInvoiceLine(values.lines[1], other), current);
    values.lines[1] = viaB;
    expect(submit(values).p_items.map((i) => i.id)).toEqual([LINE_1, LINE_2]);
  });
});

describe("edit form: current references", () => {
  it("shows a kept line's recorded snapshot, not the product's current master data", () => {
    const [line] = invoiceToFormValues(ORDER).lines;
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
    const [line] = invoiceToFormValues(ORDER).lines;
    const next = product(NEW_PRODUCT);
    const changed = applyProductToInvoiceLine(line, next);
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
    const values = invoiceToFormValues(ORDER);
    expect(submit(values).p_customer_id).toBe(CUSTOMER);
    expect(submit({ ...values, customerId: OTHER_CUSTOMER }).p_customer_id).toBe(OTHER_CUSTOMER);
  });
});

describe("calculation preview", () => {
  it("matches the stored amounts of a loaded draft", () => {
    const preview = previewInvoice(invoiceToFormValues(ORDER).lines, new Map());
    expect(preview.lines.map((l) => l?.lineTotal)).toEqual(["40.31", "35.00"]);
    expect(preview.totals).toEqual({ subtotal: "77.50", discountTotal: "5.00", taxTotal: "2.81", grandTotal: "75.31" });
    expect(preview.incomplete).toBe(0);
  });

  it("a blank price on a kept line uses the recorded price; on a new selection the product's price", () => {
    const values = invoiceToFormValues(ORDER);
    const kept = { ...values.lines[0], unitPrice: "", taxRate: "" };
    const changed = { ...applyProductToInvoiceLine(values.lines[0], product(NEW_PRODUCT)), unitPrice: "", taxRate: "" };
    const products = new Map([[NEW_PRODUCT, product(NEW_PRODUCT)]]);
    const preview = previewInvoice([kept, changed], products);
    expect(preview.lines.map((l) => l?.lineTotal)).toEqual(["37.50", "297.00"]);
  });

  it("uses exact decimals (no floating point drift) and leaves out incomplete lines", () => {
    const products = new Map([[PRODUCT, product(PRODUCT)]]);
    const lines = [
      { ...emptyInvoiceLine("a"), productId: PRODUCT, quantity: "3", unitPrice: "0.10", taxRate: "0.05" },
      { ...emptyInvoiceLine("b"), productId: PRODUCT, quantity: "1.005", unitPrice: "1.00" },
      { ...emptyInvoiceLine("c"), productId: PRODUCT, quantity: "abc" },
      emptyInvoiceLine("d"),
    ];
    const preview = previewInvoice(lines, products);
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
    expect(newInvoiceFormValues(todayInTimeZone("Asia/Dhaka", now)).invoiceDate).toBe("2026-11-05");
    expect(newInvoiceFormValues(todayInTimeZone("America/New_York", now)).invoiceDate).toBe("2026-11-04");
  });

  it("shows order and due dates as stored calendar dates (no time-zone shift)", async () => {
    const { formatCalendarDate } = await import("@/lib/format");
    expect(formatCalendarDate(ORDER.invoiceDate)).toBe("5 Nov 2026");
    expect(formatCalendarDate("2026-12-31")).toBe("31 Dec 2026");
  });
});
