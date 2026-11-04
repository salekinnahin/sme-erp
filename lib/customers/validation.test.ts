import { describe, expect, it } from "vitest";
import {
  CUSTOMER_LIMITS,
  type CustomerRawInput,
  parseCustomerListParams,
  validateCustomerInput,
} from "./validation";

const EMPTY: CustomerRawInput = {
  name: "",
  companyName: "",
  phone: "",
  email: "",
  address: "",
  taxNumber: "",
  notes: "",
};

function validate(overrides: Partial<CustomerRawInput>) {
  return validateCustomerInput({ ...EMPTY, ...overrides });
}

function errorsOf(overrides: Partial<CustomerRawInput>) {
  const result = validate(overrides);
  return result.ok ? {} : result.fieldErrors;
}

describe("validateCustomerInput", () => {
  it("accepts a name only and turns blank optional fields into null", () => {
    expect(validate({ name: "Rahim Traders", address: "   " })).toEqual({
      ok: true,
      value: {
        name: "Rahim Traders",
        companyName: null,
        phone: null,
        email: null,
        address: null,
        taxNumber: null,
        notes: null,
      },
    });
  });

  it("normalizes every field with the shared rules", () => {
    const result = validate({
      name: "\u0085 Rahim  ",
      companyName: " Acme﻿",
      phone: " +880 1711-000000 ",
      email: " Rahim@Example.COM ",
      address: "\tRoad 1\n",
      taxNumber: " TIN-1 ",
      notes: " note ",
    });
    expect(result).toEqual({
      ok: true,
      value: {
        name: "Rahim",
        companyName: "Acme",
        phone: "+880 1711-000000",
        email: "rahim@example.com",
        address: "Road 1",
        taxNumber: "TIN-1",
        notes: "note",
      },
    });
  });

  it.each([
    ["empty", ""],
    ["NBSP only", "  "],
    ["U+0085 only", "\u0085"],
    ["U+2003 only", " "],
    ["U+FEFF only", "﻿"],
  ])("requires a name (%s)", (_, name) => {
    expect(errorsOf({ name }).name).toBe("Customer name is required.");
  });

  it("counts code points: 200 emoji accepted, 201 rejected", () => {
    expect(validate({ name: "😀".repeat(200) }).ok).toBe(true);
    expect(errorsOf({ name: "😀".repeat(201) }).name).toBe(
      "Use at most 200 characters.",
    );
    expect(validate({ name: "x", companyName: "😀".repeat(200) }).ok).toBe(true);
    expect(errorsOf({ name: "x", companyName: "😀".repeat(201) }).companyName).toBeDefined();
  });

  it("counts code points for notes: 2000 emoji accepted, 2001 rejected", () => {
    expect(validate({ name: "x", notes: "😀".repeat(2000) }).ok).toBe(true);
    expect(errorsOf({ name: "x", notes: "😀".repeat(2001) }).notes).toBe(
      "Use at most 2000 characters.",
    );
  });

  it("applies the address and tax number limits in code points", () => {
    const L = CUSTOMER_LIMITS;
    expect(validate({ name: "x", address: "ব".repeat(L.address) }).ok).toBe(true);
    expect(errorsOf({ name: "x", address: "ব".repeat(L.address + 1) }).address).toBeDefined();
    expect(validate({ name: "x", taxNumber: "😀".repeat(L.taxNumber) }).ok).toBe(true);
    expect(errorsOf({ name: "x", taxNumber: "😀".repeat(L.taxNumber + 1) }).taxNumber).toBeDefined();
  });

  it("rejects an email with inner Unicode whitespace", () => {
    expect(errorsOf({ name: "x", email: "a b@example.com" }).email).toBe(
      "Please enter a valid email address.",
    );
    expect(errorsOf({ name: "x", email: "a b@example.com" }).email).toBeDefined();
  });

  it("rejects a malformed phone", () => {
    expect(errorsOf({ name: "x", phone: "call me" }).phone).toBe(
      "Please enter a valid phone number.",
    );
  });
});

describe("parseCustomerListParams", () => {
  it("trims the search with the shared set and caps it at 100 code points", () => {
    expect(parseCustomerListParams({ q: "  rahim  " }).search).toBe("rahim");
    expect(parseCustomerListParams({ q: "😀".repeat(150) }).search).toBe("😀".repeat(100));
  });

  it("falls back to safe defaults for bad status and page", () => {
    expect(parseCustomerListParams({ status: "deleted", page: "-3" })).toEqual({
      search: "",
      status: "all",
      page: 1,
    });
    expect(parseCustomerListParams({ status: "inactive", page: ["2", "9"] })).toEqual({
      search: "",
      status: "inactive",
      page: 2,
    });
    expect(parseCustomerListParams({ page: "99999999" }).page).toBe(10_000);
  });
});
