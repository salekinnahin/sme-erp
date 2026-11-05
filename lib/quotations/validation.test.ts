import { describe, expect, it } from "vitest";
import {
  DISCOUNT_EXCEEDS_GROSS_MESSAGE,
  QUOTATION_LIMITS,
  QUOTATION_STATUSES,
  QUOTATION_TRANSITIONS,
  isQuotationStatus,
  isTaxRateInRange,
  isTerminalStatus,
  isTransitionAllowed,
  isValidDate,
  toQuotationRpcArgs,
  validateQuotationInput,
  validateQuotationItem,
  type QuotationItemRawInput,
  type QuotationRawInput,
} from "./validation";

// The shared helpers (trimText, charLength, parseDecimal) are covered in
// lib/validation/*.test.ts. These tests cover the quotation rules.

const CUSTOMER_ID = "aaaaaaaa-0000-4000-8000-000000000001";
const PRODUCT_ID = "bbbbbbbb-0000-4000-8000-000000000002";

const ITEM: QuotationItemRawInput = {
  productId: PRODUCT_ID,
  quantity: "1",
  unitPrice: "",
  discountAmount: "",
  taxRate: "",
};

const BASE: QuotationRawInput = {
  customerId: CUSTOMER_ID,
  quotationDate: "2026-11-04",
  expiryDate: "",
  notes: "",
  items: [ITEM],
};

function item(overrides: Partial<QuotationItemRawInput>) {
  return validateQuotationItem({ ...ITEM, ...overrides });
}

function itemError(overrides: Partial<QuotationItemRawInput>) {
  const result = item(overrides);
  return result.ok ? undefined : result.errors;
}

describe("status model", () => {
  it("has the V1 statuses and transitions", () => {
    expect(QUOTATION_STATUSES).toEqual(["draft", "sent", "accepted", "rejected", "expired", "cancelled"]);
    expect(isQuotationStatus("sent")).toBe(true);
    expect(isQuotationStatus("SENT")).toBe(false);
    expect(isQuotationStatus("void")).toBe(false);
  });

  it("allows exactly the documented transitions", () => {
    const allowed = QUOTATION_STATUSES.flatMap((from) =>
      QUOTATION_STATUSES.filter((to) => isTransitionAllowed(from, to)).map((to) => `${from}->${to}`),
    );
    expect(allowed).toEqual([
      "draft->sent",
      "draft->cancelled",
      "sent->accepted",
      "sent->rejected",
      "sent->expired",
      "sent->cancelled",
    ]);
  });

  it("treats accepted, rejected, expired and cancelled as terminal", () => {
    expect(QUOTATION_STATUSES.filter(isTerminalStatus)).toEqual([
      "accepted",
      "rejected",
      "expired",
      "cancelled",
    ]);
    expect(Object.values(QUOTATION_TRANSITIONS).flat()).not.toContain("draft");
  });
});

describe("isValidDate", () => {
  it("accepts real ISO calendar dates", () => {
    for (const d of ["2026-11-04", "2024-02-29", "2026-12-31", "2000-01-01"])
      expect(isValidDate(d)).toBe(true);
  });

  it("rejects impossible or non-ISO dates", () => {
    for (const d of ["2026-02-29", "2026-02-30", "2026-13-01", "2026-00-10", "2026-04-31",
      "2026-1-4", "04/11/2026", "2026-11-04T00:00", "", "infinity", "0000-01-01", "２０２６-11-04"])
      expect(isValidDate(d)).toBe(false);
  });
});

describe("validateQuotationInput: header", () => {
  it("normalizes a valid quotation", () => {
    const result = validateQuotationInput({
      ...BASE,
      customerId: ` ${CUSTOMER_ID.toUpperCase()} `,
      expiryDate: "2026-12-04",
      notes: "　 Thanks!  ",
    });
    expect(result).toEqual({
      ok: true,
      value: {
        customerId: CUSTOMER_ID,
        quotationDate: "2026-11-04",
        expiryDate: "2026-12-04",
        notes: "Thanks!",
        items: [
          {
            productId: PRODUCT_ID,
            description: undefined,
            quantity: "1",
            unitPrice: null,
            discountAmount: "0",
            taxRate: "0",
          },
        ],
      },
    });
  });

  it("requires a customer and a valid quotation date", () => {
    const result = validateQuotationInput({ ...BASE, customerId: "", quotationDate: "" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.fieldErrors.customerId).toBe("Choose a customer.");
    expect(result.fieldErrors.quotationDate).toBe("Quotation date is required.");

    const bad = validateQuotationInput({ ...BASE, customerId: "nope", quotationDate: "2026-02-30" });
    expect(bad.ok ? {} : bad.fieldErrors).toEqual({
      customerId: "Choose a customer from the list.",
      quotationDate: "Enter a valid date.",
    });
  });

  it("allows no expiry date, the same day, or later; not earlier", () => {
    expect(validateQuotationInput({ ...BASE, expiryDate: "  " }).ok).toBe(true);
    expect(validateQuotationInput({ ...BASE, expiryDate: "2026-11-04" }).ok).toBe(true);
    const early = validateQuotationInput({ ...BASE, expiryDate: "2026-11-03" });
    expect(early.ok ? undefined : early.fieldErrors.expiryDate).toBe(
      "The expiry date cannot be before the quotation date.",
    );
    const invalid = validateQuotationInput({ ...BASE, expiryDate: "2026-11-31" });
    expect(invalid.ok ? undefined : invalid.fieldErrors.expiryDate).toBe("Enter a valid date.");
  });

  it("limits notes to 2000 code points", () => {
    expect(validateQuotationInput({ ...BASE, notes: "😀".repeat(2000) }).ok).toBe(true);
    const long = validateQuotationInput({ ...BASE, notes: "😀".repeat(2001) });
    expect(long.ok ? undefined : long.fieldErrors.notes).toBe("Use at most 2000 characters.");
    const blank = validateQuotationInput({ ...BASE, notes: " \u0085" });
    expect(blank.ok && blank.value.notes).toBeNull();
  });

  it("requires 1 to 100 items", () => {
    const none = validateQuotationInput({ ...BASE, items: [] });
    expect(none.ok ? undefined : none.fieldErrors.items).toBe("Add at least one item.");

    const max = validateQuotationInput({ ...BASE, items: Array(QUOTATION_LIMITS.maxItems).fill(ITEM) });
    expect(max.ok && max.value.items).toHaveLength(100);

    const tooMany = validateQuotationInput({ ...BASE, items: Array(101).fill(ITEM) });
    expect(tooMany.ok ? undefined : tooMany.fieldErrors.items).toBe(
      "A quotation can have at most 100 items.",
    );
  });

  it("reports item errors by index", () => {
    const result = validateQuotationInput({
      ...BASE,
      items: [ITEM, { ...ITEM, quantity: "0" }, ITEM, { ...ITEM, productId: "" }],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.fieldErrors).toEqual({});
    expect(result.itemErrors).toEqual([
      undefined,
      { quantity: "Quantity must be more than 0." },
      undefined,
      { productId: "Choose a product or service." },
    ]);
  });
});

describe("validateQuotationItem", () => {
  it("accepts decimal quantities up to 3 places", () => {
    expect(item({ quantity: "0.001" })).toMatchObject({ ok: true, value: { quantity: "0.001" } });
    expect(item({ quantity: " 2.500 " })).toMatchObject({ ok: true, value: { quantity: "2.500" } });
    expect(item({ quantity: ".5" })).toMatchObject({ ok: true, value: { quantity: "0.5" } });
  });

  it("rejects zero, negative and malformed quantities", () => {
    expect(itemError({ quantity: "" })?.quantity).toBe("Quantity is required.");
    for (const q of ["0", "0.000", "00", "."])
      expect(itemError({ quantity: q })?.quantity).toMatch(/more than 0|digits/);
    for (const q of ["-1", "1e3", "abc", "1,5"])
      expect(itemError({ quantity: q })?.quantity).toMatch(/digits and a decimal point/);
    expect(itemError({ quantity: "1.0001" })?.quantity).toBe("Use at most 3 decimal places.");
    expect(itemError({ quantity: "1000000000000000" })?.quantity).toBe("This number is too large.");
  });

  it("validates price and discount as non-negative money with 2 decimals", () => {
    expect(item({ unitPrice: "0" })).toMatchObject({ ok: true, value: { unitPrice: "0" } });
    expect(item({ unitPrice: "1250.5" })).toMatchObject({ ok: true, value: { unitPrice: "1250.5" } });
    expect(itemError({ unitPrice: "-1" })?.unitPrice).toMatch(/0 or more/);
    expect(itemError({ unitPrice: "1.239" })?.unitPrice).toBe("Use at most 2 decimal places.");
    expect(itemError({ discountAmount: "-0.01" })?.discountAmount).toMatch(/0 or more/);
    expect(itemError({ discountAmount: "0.001" })?.discountAmount).toBe("Use at most 2 decimal places.");
  });

  it("validates the tax rate from 0 to 100", () => {
    for (const rate of ["0", "7.5", "15", "99.99", "100", "100.00"])
      expect(item({ taxRate: rate }).ok).toBe(true);
    for (const rate of ["100.01", "101", "-1", "1.125", "abc", "1000"])
      expect(itemError({ taxRate: rate })?.taxRate).toBe(
        "Enter a tax rate from 0 to 100 with at most 2 decimal places.",
      );
    expect(isTaxRateInRange("100")).toBe(true);
    expect(isTaxRateInRange("100.1")).toBe(false);
  });

  it("rejects a discount over quantity × unit price when the price is known", () => {
    expect(item({ quantity: "2", unitPrice: "5", discountAmount: "10" }).ok).toBe(true);
    expect(itemError({ quantity: "2", unitPrice: "5", discountAmount: "10.01" })?.discountAmount).toBe(
      DISCOUNT_EXCEEDS_GROSS_MESSAGE,
    );
    // Unknown price (product's selling price): checked later by the domain.
    expect(item({ discountAmount: "10.01" }).ok).toBe(true);
  });

  it("rejects line amounts that do not fit numeric(18,2)", () => {
    expect(
      itemError({ quantity: "999999999999999", unitPrice: "9999999999999999.99" })?.unitPrice,
    ).toBe("This line amount is too large.");
  });

  it("distinguishes 'use the product description' from 'no description'", () => {
    expect(item({})).toMatchObject({ ok: true, value: { description: undefined } });
    expect(item({ description: "  " })).toMatchObject({ ok: true, value: { description: null } });
    expect(item({ description: " Blue, 15\" " })).toMatchObject({
      ok: true,
      value: { description: 'Blue, 15"' },
    });
    expect(item({ description: "😀".repeat(2000) }).ok).toBe(true);
    expect(itemError({ description: "😀".repeat(2001) })?.description).toBe(
      "Use at most 2000 characters.",
    );
  });

  it("requires a product UUID and lowercases it", () => {
    expect(itemError({ productId: "123" })?.productId).toBe(
      "Choose a product or service from the list.",
    );
    expect(item({ productId: PRODUCT_ID.toUpperCase() })).toMatchObject({
      ok: true,
      value: { productId: PRODUCT_ID },
    });
  });
});

describe("toQuotationRpcArgs", () => {
  it("sends only user-controlled values, omitting keys the database fills in", () => {
    const result = validateQuotationInput({
      ...BASE,
      expiryDate: "2026-12-01",
      notes: "Hi",
      items: [
        { ...ITEM, quantity: "2.5", discountAmount: "1.50", taxRate: "15" },
        { ...ITEM, unitPrice: "33.33", description: "Custom" },
        { ...ITEM, description: "" },
      ],
    });
    if (!result.ok) throw new Error("expected valid input");
    expect(toQuotationRpcArgs(result.value)).toEqual({
      p_customer_id: CUSTOMER_ID,
      p_quotation_date: "2026-11-04",
      p_expiry_date: "2026-12-01",
      p_notes: "Hi",
      p_items: [
        { product_id: PRODUCT_ID, quantity: "2.5", discount_amount: "1.50", tax_rate: "15" },
        { product_id: PRODUCT_ID, quantity: "1", unit_price: "33.33", discount_amount: "0", tax_rate: "0", description: "Custom" },
        { product_id: PRODUCT_ID, quantity: "1", discount_amount: "0", tax_rate: "0", description: null },
      ],
    });
  });

  it("never sends snapshot fields, totals, organization or status", () => {
    const result = validateQuotationInput({
      ...BASE,
      // Extra properties a tampered form might add are not part of the input type
      // and never reach the payload.
      items: [{ ...ITEM, ...({ productName: "FORGED", lineTotal: "1" } as object) }],
      ...({ organizationId: "x", grandTotal: "1", status: "accepted" } as object),
    });
    if (!result.ok) throw new Error("expected valid input");
    const args = toQuotationRpcArgs(result.value);
    expect(Object.keys(args).sort()).toEqual(
      ["p_customer_id", "p_expiry_date", "p_items", "p_notes", "p_quotation_date"],
    );
    expect(Object.keys(args.p_items[0]).sort()).toEqual(
      ["discount_amount", "product_id", "quantity", "tax_rate"],
    );
  });
});
