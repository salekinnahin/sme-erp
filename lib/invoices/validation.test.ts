import { describe, expect, it } from "vitest";
import { validateQuotationItem } from "@/lib/quotations/validation";
import {
  INVOICE_LINE_NOT_FOUND,
  INVOICE_PAYMENT_STATUSES,
  INVOICE_STATUSES,
  INVOICE_TRANSITIONS,
  INVOICE_USER_TARGET_STATUSES,
  initialInvoiceBalance,
  isInvoicePaymentStatus,
  isInvoiceStatus,
  isInvoiceTransitionAllowed,
  isInvoiceUserTransitionAllowed,
  isTerminalInvoiceStatus,
  salesOrderInvoiceBlocker,
  toInvoiceConversionRpcArgs,
  toInvoiceRpcArgs,
  validateInvoiceConversionInput,
  validateInvoiceInput,
  validateInvoiceItem,
  type InvoiceItemRawInput,
  type InvoiceRawInput,
} from "./validation";

const CUSTOMER_ID = "aaaaaaaa-0000-4000-8000-000000000001";
const PRODUCT_ID = "bbbbbbbb-0000-4000-8000-000000000002";
const LINE_ID = "cccccccc-0000-4000-8000-000000000003";
const SALES_ORDER_ID = "dddddddd-0000-4000-8000-000000000004";

const ITEM: InvoiceItemRawInput = {
  productId: PRODUCT_ID,
  quantity: "1",
  unitPrice: "",
  discountAmount: "",
  taxRate: "",
};

const INVOICE: InvoiceRawInput = {
  customerId: CUSTOMER_ID,
  invoiceDate: "2026-11-04",
  dueDate: "",
  notes: "",
  items: [ITEM],
};

describe("status model", () => {
  it("has the five V1 statuses", () => {
    expect(INVOICE_STATUSES).toEqual(["draft", "issued", "partially_paid", "paid", "cancelled"]);
    expect(isInvoiceStatus("issued")).toBe(true);
    expect(isInvoiceStatus("confirmed")).toBe(false);
    expect(isInvoiceStatus("PAID")).toBe(false);
  });

  it("has exactly the lifecycle transitions of the SQL function", () => {
    const allowed = INVOICE_STATUSES.flatMap((from) =>
      INVOICE_STATUSES.filter((to) => isInvoiceTransitionAllowed(from, to)).map((to) => `${from}->${to}`),
    ).sort();
    // Same list as the transition-table check in supabase/tests/invoices.sql.
    expect(allowed).toEqual([
      "draft->cancelled",
      "draft->issued",
      "issued->cancelled",
      "issued->paid",
      "issued->partially_paid",
      "partially_paid->paid",
    ]);
  });

  it("lets users only issue and cancel; payment statuses are system-only", () => {
    expect(INVOICE_USER_TARGET_STATUSES).toEqual(["issued", "cancelled"]);
    expect(INVOICE_PAYMENT_STATUSES).toEqual(["partially_paid", "paid"]);
    expect(isInvoicePaymentStatus("paid")).toBe(true);
    expect(isInvoicePaymentStatus("issued")).toBe(false);
    const userAllowed = INVOICE_STATUSES.flatMap((from) =>
      INVOICE_STATUSES.filter((to) => isInvoiceUserTransitionAllowed(from, to)).map((to) => `${from}->${to}`),
    ).sort();
    expect(userAllowed).toEqual(["draft->cancelled", "draft->issued", "issued->cancelled"]);
  });

  it("treats paid and cancelled as terminal; never back to draft; no cancel once paid", () => {
    expect(INVOICE_STATUSES.filter(isTerminalInvoiceStatus)).toEqual(["paid", "cancelled"]);
    for (const from of INVOICE_STATUSES) expect(INVOICE_TRANSITIONS[from]).not.toContain("draft");
    expect(isInvoiceTransitionAllowed("partially_paid", "cancelled")).toBe(false);
    expect(isInvoiceTransitionAllowed("issued", "issued")).toBe(false);
    expect(isInvoiceTransitionAllowed("draft", "paid")).toBe(false);
  });
});

describe("initialInvoiceBalance", () => {
  it("starts with nothing paid and the grand total due", () => {
    expect(initialInvoiceBalance("287.56")).toEqual({ amountPaid: "0.00", amountDue: "287.56" });
    expect(initialInvoiceBalance("0.00")).toEqual({ amountPaid: "0.00", amountDue: "0.00" });
  });
});

describe("validateInvoiceItem", () => {
  it("applies the quotation line rules unchanged", () => {
    const cases: InvoiceItemRawInput[] = [
      { ...ITEM, quantity: "0" },
      { ...ITEM, quantity: "1.0001" },
      { ...ITEM, quantity: "1e3" },
      { ...ITEM, quantity: "NaN" },
      { ...ITEM, unitPrice: "1.001" },
      { ...ITEM, unitPrice: "-1" },
      { ...ITEM, taxRate: "100.01" },
      { ...ITEM, taxRate: "1.125" },
      { ...ITEM, unitPrice: "5", quantity: "2", discountAmount: "10.01" },
      { ...ITEM, productId: "nope" },
      { ...ITEM, quantity: "2.5", unitPrice: "90.00", discountAmount: "10", taxRate: "15" },
    ];
    for (const raw of cases) {
      const quotation = validateQuotationItem(raw);
      const invoice = validateInvoiceItem(raw);
      expect(invoice.ok).toBe(quotation.ok);
      if (!invoice.ok && !quotation.ok) expect(invoice.errors).toEqual(quotation.errors);
    }
  });

  it("normalizes a line ID to lowercase and treats empty as a new selection", () => {
    const kept = validateInvoiceItem({ ...ITEM, lineId: ` ${LINE_ID.toUpperCase()} ` });
    expect(kept.ok && kept.value.lineId).toBe(LINE_ID);
    const fresh = validateInvoiceItem({ ...ITEM, lineId: "" });
    expect(fresh.ok && fresh.value.lineId).toBeNull();
    const none = validateInvoiceItem(ITEM);
    expect(none.ok && none.value.lineId).toBeNull();
  });

  it("rejects a malformed line ID", () => {
    expect(validateInvoiceItem({ ...ITEM, lineId: "line-1" })).toEqual({
      ok: false,
      errors: { lineId: INVOICE_LINE_NOT_FOUND },
    });
  });
});

describe("validateInvoiceInput", () => {
  it("normalizes a valid invoice", () => {
    const result = validateInvoiceInput({
      ...INVOICE,
      customerId: ` ${CUSTOMER_ID.toUpperCase()} `,
      dueDate: "2026-12-04",
      notes: "  Thanks!　",
    });
    expect(result).toEqual({
      ok: true,
      value: {
        customerId: CUSTOMER_ID,
        invoiceDate: "2026-11-04",
        dueDate: "2026-12-04",
        notes: "Thanks!",
        items: [
          {
            productId: PRODUCT_ID,
            description: undefined,
            quantity: "1",
            unitPrice: null,
            discountAmount: "0",
            taxRate: "0",
            lineId: null,
          },
        ],
      },
    });
  });

  it("requires an invoice date; the due date is optional but not before it", () => {
    expect(validateInvoiceInput({ ...INVOICE, invoiceDate: "" })).toMatchObject({
      ok: false,
      fieldErrors: { invoiceDate: "Invoice date is required." },
    });
    expect(validateInvoiceInput({ ...INVOICE, invoiceDate: "2026-02-30" })).toMatchObject({
      ok: false,
      fieldErrors: { invoiceDate: "Enter a valid date." },
    });
    expect(validateInvoiceInput({ ...INVOICE, dueDate: "2026-11-03" })).toMatchObject({
      ok: false,
      fieldErrors: { dueDate: "The due date cannot be before the invoice date." },
    });
    expect(validateInvoiceInput({ ...INVOICE, dueDate: "11/04/2026" })).toMatchObject({
      ok: false,
      fieldErrors: { dueDate: "Enter a valid date." },
    });
    expect(validateInvoiceInput({ ...INVOICE, dueDate: "2026-11-04" }).ok).toBe(true);
    expect(validateInvoiceInput({ ...INVOICE, dueDate: "  " }).ok).toBe(true);
  });

  it("checks the customer, notes length and item count", () => {
    expect(validateInvoiceInput({ ...INVOICE, customerId: "" })).toMatchObject({
      fieldErrors: { customerId: "Choose a customer." },
    });
    expect(validateInvoiceInput({ ...INVOICE, customerId: "x" })).toMatchObject({
      fieldErrors: { customerId: "Choose a customer from the list." },
    });
    expect(validateInvoiceInput({ ...INVOICE, notes: "😀".repeat(2000) }).ok).toBe(true);
    expect(validateInvoiceInput({ ...INVOICE, notes: "😀".repeat(2001) }).ok).toBe(false);
    expect(validateInvoiceInput({ ...INVOICE, items: [] })).toMatchObject({
      fieldErrors: { items: "Add at least one item." },
    });
    expect(validateInvoiceInput({ ...INVOICE, items: Array(100).fill(ITEM) }).ok).toBe(true);
    expect(validateInvoiceInput({ ...INVOICE, items: Array(101).fill(ITEM) })).toMatchObject({
      fieldErrors: { items: "An invoice can have at most 100 items." },
    });
  });

  it("rejects a repeated line ID, keeping per-item errors aligned", () => {
    const result = validateInvoiceInput({
      ...INVOICE,
      items: [{ ...ITEM, lineId: LINE_ID }, { ...ITEM, quantity: "0" }, { ...ITEM, lineId: LINE_ID }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.itemErrors[0]).toBeUndefined();
      expect(result.itemErrors[1]?.quantity).toBeDefined();
      expect(result.itemErrors[2]).toEqual({ lineId: INVOICE_LINE_NOT_FOUND });
    }
  });
});

describe("toInvoiceRpcArgs", () => {
  it("sends only user-controlled values, never snapshots, amounts, status or balance", () => {
    const result = validateInvoiceInput({
      ...INVOICE,
      items: [
        { ...ITEM, lineId: LINE_ID, unitPrice: "12.50", taxRate: "7.5", description: "" },
        { ...ITEM, quantity: "2.5" },
      ],
    });
    if (!result.ok) throw new Error("invalid");
    const args = toInvoiceRpcArgs(result.value);
    expect(args).toEqual({
      p_customer_id: CUSTOMER_ID,
      p_invoice_date: "2026-11-04",
      p_due_date: null,
      p_notes: null,
      p_items: [
        { id: LINE_ID, product_id: PRODUCT_ID, quantity: "1", unit_price: "12.50", discount_amount: "0", tax_rate: "7.5", description: null },
        { product_id: PRODUCT_ID, quantity: "2.5", discount_amount: "0", tax_rate: "0" },
      ],
    });
    const keys = JSON.stringify(args);
    for (const forbidden of ["amount_paid", "amount_due", "status", "grand_total", "line_total", "tax_amount", "organization_id", "invoice_number", "product_name"])
      expect(keys).not.toContain(`"${forbidden}"`);
  });
});

describe("sales order conversion", () => {
  it("validates the sales order ID and dates only", () => {
    expect(
      validateInvoiceConversionInput({ salesOrderId: SALES_ORDER_ID.toUpperCase(), invoiceDate: "2026-11-05", dueDate: "" }),
    ).toEqual({ ok: true, value: { salesOrderId: SALES_ORDER_ID, invoiceDate: "2026-11-05", dueDate: null } });
    expect(
      validateInvoiceConversionInput({ salesOrderId: "nope", invoiceDate: "", dueDate: "2026-11-01" }),
    ).toEqual({
      ok: false,
      fieldErrors: { salesOrderId: "Choose a sales order.", invoiceDate: "Invoice date is required." },
    });
    expect(
      validateInvoiceConversionInput({ salesOrderId: SALES_ORDER_ID, invoiceDate: "2026-11-05", dueDate: "2026-11-04" }),
    ).toMatchObject({ ok: false, fieldErrors: { dueDate: expect.any(String) } });
  });

  it("builds the conversion RPC arguments", () => {
    expect(
      toInvoiceConversionRpcArgs({ salesOrderId: SALES_ORDER_ID, invoiceDate: "2026-11-05", dueDate: "2026-12-05" }),
    ).toEqual({ p_sales_order_id: SALES_ORDER_ID, p_invoice_date: "2026-11-05", p_due_date: "2026-12-05" });
  });

  it("only a confirmed, not yet invoiced sales order converts", () => {
    expect(salesOrderInvoiceBlocker("confirmed", false)).toBeNull();
    expect(salesOrderInvoiceBlocker("confirmed", true)).toBe("already_invoiced");
    for (const status of ["draft", "completed", "cancelled", "bogus"])
      expect(salesOrderInvoiceBlocker(status, false)).toBe("not_confirmed");
  });
});
