import { describe, expect, it } from "vitest";
import {
  applyProductToLine,
  customerOptionDetail,
  customerOptionLabel,
  emptyLine,
  itemErrorsByKey,
  newQuotationFormValues,
  parseFormItems,
  previewQuotation,
  productOptionLabel,
  quotationToFormValues,
  rememberOptions,
  serializeLines,
  todayInTimeZone,
  withCurrentOptions,
  type ProductOption,
  type QuotationFormLine,
} from "./form";
import type { Quotation } from "./quotations";
import { toQuotationRpcArgs, validateQuotationInput } from "./validation";

const P1 = "bbbbbbbb-0000-4000-8000-000000000001";
const P2 = "bbbbbbbb-0000-4000-8000-000000000002";
const P_NO_PRICE = "bbbbbbbb-0000-4000-8000-000000000003";
const CUSTOMER = "dddddddd-0000-4000-8000-000000000004";

const laptop: ProductOption = {
  id: P1,
  name: "Laptop",
  sku: "LAP-1",
  unit: "pcs",
  description: "Laptop desc",
  sellingPrice: "100.00",
  status: "active",
};
const setup: ProductOption = {
  id: P2,
  name: "Setup",
  sku: "SRV-1",
  unit: "hour",
  description: null,
  sellingPrice: "33.33",
  status: "active",
};
const noPrice: ProductOption = { ...setup, id: P_NO_PRICE, name: "Custom", sku: "C-1", sellingPrice: null };
const products = new Map([laptop, setup, noPrice].map((p) => [p.id, p]));

function line(overrides: Partial<QuotationFormLine>): QuotationFormLine {
  return { ...emptyLine("k"), ...overrides };
}

describe("withCurrentOptions", () => {
  const a = { id: "a", name: "A" };
  const b = { id: "b", name: "B" };

  it("adds current records that are not in the capped list, first", () => {
    expect(withCurrentOptions([a], [b])).toEqual([b, a]);
  });

  it("never duplicates a current record that is already listed", () => {
    expect(withCurrentOptions([a, b], [b, b])).toEqual([a, b]);
  });

  it("keeps the list unchanged without current records", () => {
    expect(withCurrentOptions([a, b], [])).toEqual([a, b]);
  });
});

describe("option labels", () => {
  it("marks inactive historical references", () => {
    expect(customerOptionLabel({ id: "c", name: "Old", companyName: null, phone: null, email: null, status: "inactive" })).toBe(
      "Old (inactive)",
    );
    expect(productOptionLabel({ ...laptop, status: "inactive" })).toBe("Laptop (LAP-1) (inactive)");
  });

  it("shows the company for customers", () => {
    expect(customerOptionLabel({ id: "c", name: "Buyer", companyName: "Acme", phone: null, email: null, status: "active" })).toBe(
      "Buyer — Acme",
    );
  });
});

describe("customerOptionDetail", () => {
  const base = { id: "c", name: "Buyer", companyName: null, status: "active" as const };
  it("shows phone and email to tell same-named customers apart", () => {
    expect(customerOptionDetail({ ...base, phone: "+880 1711", email: "a@b.test" })).toBe("+880 1711 · a@b.test");
    expect(customerOptionDetail({ ...base, phone: null, email: "a@b.test" })).toBe("a@b.test");
    expect(customerOptionDetail({ ...base, phone: null, email: null })).toBe("");
  });
});

describe("rememberOptions", () => {
  const current = { id: "p-current", name: "Old", status: "inactive" };
  const found = { id: "p-found", name: "New", status: "active" };

  it("adds newly chosen options and keeps every known one", () => {
    const known = new Map([[current.id, current]]);
    const next = rememberOptions(known, [found]);
    expect([...next.keys()]).toEqual([current.id, found.id]);
    // The inactive current reference survives any later search result.
    expect(rememberOptions(next, []).get(current.id)).toBe(current);
  });

  it("returns the same map when nothing is new (no state change)", () => {
    const known = new Map([[current.id, current]]);
    expect(rememberOptions(known, [{ ...current, name: "Changed" }])).toBe(known);
    expect(rememberOptions(known, [])).toBe(known);
  });

  it("does not mutate the known map", () => {
    const known = new Map([[current.id, current]]);
    rememberOptions(known, [found]);
    expect(known.size).toBe(1);
  });
});

describe("newQuotationFormValues", () => {
  it("defaults the date to today and starts with one line of quantity 1", () => {
    const v = newQuotationFormValues("2026-11-04");
    expect(v.quotationDate).toBe("2026-11-04");
    expect(v.expiryDate).toBe("");
    expect(v.lines).toHaveLength(1);
    expect(v.lines[0].quantity).toBe("1");
  });
});

describe("applyProductToLine", () => {
  it("prefills description and selling price, keeps quantity, discount and tax", () => {
    const before = line({ quantity: "3", discountAmount: "5", taxRate: "15", description: "old" });
    expect(applyProductToLine(before, laptop)).toEqual({
      ...before,
      productId: P1,
      description: "Laptop desc",
      unitPrice: "100.00",
    });
  });

  it("leaves the price blank (product price, if any) when the product has none", () => {
    expect(applyProductToLine(line({ unitPrice: "9" }), noPrice)).toMatchObject({
      productId: P_NO_PRICE,
      unitPrice: "",
      description: "",
    });
  });

  it("clears only the product when no product is chosen", () => {
    const before = line({ productId: P1, quantity: "2" });
    expect(applyProductToLine(before, undefined)).toEqual({ ...before, productId: "" });
  });
});

describe("quotationToFormValues (edit)", () => {
  const quotation: Quotation = {
    id: "q",
    quotationNumber: "QT-000001",
    customerId: CUSTOMER,
    customerName: "Acme Buyer",
    customerCompanyName: null,
    customerPhone: null,
    customerEmail: null,
    customerAddress: null,
    customerTaxNumber: null,
    quotationDate: "2026-11-04",
    expiryDate: null,
    status: "draft",
    notes: null,
    subtotal: "349.99",
    discountTotal: "10.00",
    taxTotal: "43.50",
    grandTotal: "383.49",
    createdAt: "2026-11-04T10:00:00+00:00",
    updatedAt: "2026-11-04T10:00:00+00:00",
    items: [
      {
        id: "i1",
        productId: P1,
        productName: "Laptop",
        sku: "LAP-1",
        description: "Laptop desc",
        unit: "pcs",
        quantity: "2.500",
        unitPrice: "100.00",
        discountAmount: "10.00",
        taxRate: "15.00",
        taxAmount: "36.00",
        lineTotal: "276.00",
        sortOrder: 1,
      },
      {
        id: "i2",
        productId: P2,
        productName: "Setup",
        sku: "SRV-1",
        description: null,
        unit: "hour",
        quantity: "3.000",
        unitPrice: "33.33",
        discountAmount: "0.00",
        taxRate: "0.00",
        taxAmount: "0.00",
        lineTotal: "99.99",
        sortOrder: 2,
      },
    ],
  };

  it("keeps the current customer and every line's product", () => {
    const v = quotationToFormValues(quotation);
    expect(v.customerId).toBe(CUSTOMER);
    expect(v.lines.map((l) => l.productId)).toEqual([P1, P2]);
  });

  it("keeps the draft's own prices and shows plain decimals", () => {
    const v = quotationToFormValues(quotation);
    expect(v.lines[0]).toMatchObject({ quantity: "2.5", unitPrice: "100.00", discountAmount: "10", taxRate: "15" });
    // Zero discount and tax are blank fields (blank = 0); no description = "".
    expect(v.lines[1]).toMatchObject({ quantity: "3", discountAmount: "", taxRate: "", description: "" });
    expect(v.expiryDate).toBe("");
    expect(v.notes).toBe("");
  });

  it("round-trips through the payload to the same RPC values", () => {
    const v = quotationToFormValues(quotation);
    const parsed = parseFormItems(serializeLines(v.lines));
    if (!parsed.ok) throw new Error("payload not parsed");
    const result = validateQuotationInput({
      customerId: v.customerId,
      quotationDate: v.quotationDate,
      expiryDate: v.expiryDate,
      notes: v.notes,
      items: parsed.items,
    });
    if (!result.ok) throw new Error("not valid");
    expect(toQuotationRpcArgs(result.value).p_items).toEqual([
      { product_id: P1, quantity: "2.5", unit_price: "100.00", discount_amount: "10", tax_rate: "15", description: "Laptop desc" },
      { product_id: P2, quantity: "3", unit_price: "33.33", discount_amount: "0", tax_rate: "0", description: null },
    ]);
  });
});

describe("serializeLines / parseFormItems", () => {
  it("sends only user-controlled fields", () => {
    const sent = JSON.parse(serializeLines([line({ productId: P1, unitPrice: "1" })]));
    expect(Object.keys(sent[0]).sort()).toEqual(
      ["description", "discountAmount", "key", "productId", "quantity", "taxRate", "unitPrice"].sort(),
    );
  });

  it("ignores forged snapshot, amount and organization keys", () => {
    const raw = JSON.stringify([
      {
        key: "a",
        productId: P1,
        quantity: "1",
        unitPrice: "",
        discountAmount: "",
        taxRate: "",
        description: "x",
        product_name: "FORGED",
        line_total: "1",
        organization_id: "other",
      },
    ]);
    const parsed = parseFormItems(raw);
    expect(parsed).toEqual({
      ok: true,
      keys: ["a"],
      items: [{ productId: P1, description: "x", quantity: "1", unitPrice: "", discountAmount: "", taxRate: "" }],
    });
  });

  it("treats non-string fields as empty and a missing description as the product's", () => {
    const parsed = parseFormItems(JSON.stringify([{ key: "a", productId: 5, quantity: 2, taxRate: null }]));
    expect(parsed).toEqual({
      ok: true,
      keys: ["a"],
      items: [{ productId: "", description: undefined, quantity: "", unitPrice: "", discountAmount: "", taxRate: "" }],
    });
  });

  it.each([
    ["not JSON", "{"],
    ["an object", "{}"],
    ["a string", '"x"'],
    ["null entries", "[null]"],
    ["array entries", "[[]]"],
    ["number entries", "[1]"],
  ])("rejects %s", (_label, raw) => {
    expect(parseFormItems(raw)).toEqual({ ok: false });
  });

  it("rejects missing and oversized payloads", () => {
    expect(parseFormItems(null)).toEqual({ ok: false });
    expect(parseFormItems(new File([], "x"))).toEqual({ ok: false });
    expect(parseFormItems("[" + " ".repeat(1_000_001) + "]")).toEqual({ ok: false });
  });

  it("reads at most 101 lines, so validation still reports the 100-line limit", () => {
    const many = Array.from({ length: 500 }, (_, i) => ({ key: `k${i}`, productId: P1, quantity: "1" }));
    const parsed = parseFormItems(JSON.stringify(many));
    if (!parsed.ok) throw new Error("not parsed");
    expect(parsed.items).toHaveLength(101);
    const result = validateQuotationInput({
      customerId: CUSTOMER,
      quotationDate: "2026-11-04",
      expiryDate: "",
      notes: "",
      items: parsed.items,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.fieldErrors.items).toMatch(/at most 100/);
  });

  it("replaces missing, duplicate and over-long keys with unique ones", () => {
    const parsed = parseFormItems(
      JSON.stringify([{ key: "a" }, { key: "a" }, {}, { key: "x".repeat(65) }]),
    );
    if (!parsed.ok) throw new Error("not parsed");
    expect(new Set(parsed.keys).size).toBe(4);
    expect(parsed.keys[0]).toBe("a");
  });
});

describe("itemErrorsByKey", () => {
  it("maps per-index errors to line keys, skipping lines without errors", () => {
    expect(itemErrorsByKey(["a", "b", "c"], [undefined, { quantity: "bad" }, undefined])).toEqual({
      b: { quantity: "bad" },
    });
    expect(itemErrorsByKey(["a"], undefined)).toEqual({});
  });
});

describe("previewQuotation", () => {
  it("matches the Part 1 SQL example (create_quotation test in quotations.sql)", () => {
    // 2.5 × 100.00 − 10.00 + 15% = 276.00; 3 × 33.33 + 7.5% = 107.49
    const preview = previewQuotation(
      [
        line({ productId: P1, quantity: "2.5", unitPrice: "", discountAmount: "10.00", taxRate: "15" }),
        line({ productId: P2, quantity: "3", unitPrice: "33.33", taxRate: "7.5" }),
      ],
      products,
    );
    expect(preview.lines.map((l) => l?.lineTotal)).toEqual(["276.00", "107.49"]);
    expect(preview.totals).toEqual({
      subtotal: "349.99",
      discountTotal: "10.00",
      taxTotal: "43.50",
      grandTotal: "383.49",
    });
    expect(preview.incomplete).toBe(0);
  });

  it("rounds half up exactly, without floating point", () => {
    // 1.005 × 1.00 = 1.01 (floating point gives 1.00); 10.00 × 0.05% = 0.01
    const preview = previewQuotation(
      [
        line({ productId: P1, quantity: "1.005", unitPrice: "1.00" }),
        line({ productId: P1, quantity: "1", unitPrice: "10.00", taxRate: "0.05" }),
      ],
      products,
    );
    expect(preview.lines.map((l) => l?.lineTotal)).toEqual(["1.01", "10.01"]);
  });

  it("keeps the largest amounts exact", () => {
    const preview = previewQuotation(
      [line({ productId: P1, quantity: "1", unitPrice: "9999999999999999.99" })],
      products,
    );
    expect(preview.totals?.grandTotal).toBe("9999999999999999.99");
  });

  it("leaves incomplete or invalid lines out of the totals", () => {
    const preview = previewQuotation(
      [
        line({ productId: P1, quantity: "1" }), // product price 100.00
        line({ productId: "", quantity: "1" }), // no product
        line({ productId: P_NO_PRICE, quantity: "1" }), // no price anywhere
        line({ productId: P1, quantity: "0" }),
        line({ productId: P1, quantity: "1", taxRate: "101" }),
        line({ productId: P1, quantity: "1", discountAmount: "100.01" }),
        line({ productId: P1, quantity: "abc" }),
        line({ productId: "eeeeeeee-0000-4000-8000-000000000009", quantity: "1", unitPrice: "1" }), // unknown
      ],
      products,
    );
    expect(preview.lines[0]?.lineTotal).toBe("100.00");
    expect(preview.lines.slice(1)).toEqual([null, null, null, null, null, null, null]);
    expect(preview.incomplete).toBe(7);
    expect(preview.totals?.grandTotal).toBe("100.00");
  });

  it("reports no totals when they overflow numeric(18,2)", () => {
    const big = line({ productId: P1, quantity: "1", unitPrice: "9999999999999999.99" });
    expect(previewQuotation([big, { ...big, key: "k2" }], products).totals).toBeNull();
  });
});

describe("todayInTimeZone", () => {
  it("uses the organization's time zone, not the server's", () => {
    // 2026-11-04 20:30 UTC is already 5 November in Dhaka (UTC+6).
    const now = new Date("2026-11-04T20:30:00Z");
    expect(todayInTimeZone("Asia/Dhaka", now)).toBe("2026-11-05");
    expect(todayInTimeZone("UTC", now)).toBe("2026-11-04");
    expect(todayInTimeZone("America/New_York", new Date("2026-11-05T03:00:00Z"))).toBe("2026-11-04");
  });
});
