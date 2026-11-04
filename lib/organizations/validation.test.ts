import { describe, expect, it } from "vitest";
import { validateCustomerInput } from "@/lib/customers/validation";
import {
  LIMITS,
  type OrganizationRawInput,
  SUPPORTED_CURRENCIES,
  validateOrganizationInput,
} from "./validation";

const BASE: OrganizationRawInput = {
  name: "Org A",
  email: "",
  phone: "",
  address: "",
  currency: "BDT",
  timezone: "Asia/Dhaka",
  taxNumber: "",
};

function validate(overrides: Partial<OrganizationRawInput>) {
  return validateOrganizationInput({ ...BASE, ...overrides });
}

function errorsOf(overrides: Partial<OrganizationRawInput>) {
  const result = validate(overrides);
  return result.ok ? {} : result.fieldErrors;
}

describe("validateOrganizationInput", () => {
  it("accepts the minimum and turns blank optional fields into null", () => {
    expect(validate({ email: " ", taxNumber: " " })).toEqual({
      ok: true,
      value: {
        name: "Org A",
        email: null,
        phone: null,
        address: null,
        currency: "BDT",
        timezone: "Asia/Dhaka",
        taxNumber: null,
      },
    });
  });

  it("trims every field with the shared Unicode whitespace set", () => {
    expect(
      validate({
        name: "\u0085   Org A   ﻿",
        email: "  A@Example.com \u0085",
        phone: "  +880 1711-000000 ﻿",
        address: "\u0085 Road 1  ",
        currency: "\tbdt ",
        timezone: " Asia/Dhaka ",
        taxNumber: "﻿ TIN-1  ",
      }),
    ).toEqual({
      ok: true,
      value: {
        name: "Org A",
        email: "a@example.com",
        phone: "+880 1711-000000",
        address: "Road 1",
        currency: "BDT",
        timezone: "Asia/Dhaka",
        taxNumber: "TIN-1",
      },
    });
  });

  it.each([
    ["empty", ""],
    ["NBSP only", "  "],
    ["U+0085 only", "\u0085"],
    ["U+2003 only", "  "],
    ["U+FEFF only", "﻿"],
  ])("requires a name (%s)", (_, name) => {
    expect(errorsOf({ name }).name).toBe("Organization name is required.");
  });

  it("counts code points: 200 emoji accepted, 201 rejected", () => {
    expect(validate({ name: "😀".repeat(200) }).ok).toBe(true);
    expect(errorsOf({ name: "😀".repeat(201) }).name).toBe(
      "Use at most 200 characters.",
    );
  });

  it("counts Bengali and combining characters as code points", () => {
    expect(validate({ name: "ব".repeat(200) }).ok).toBe(true);
    expect(errorsOf({ name: "ব".repeat(201) }).name).toBeDefined();
    // e + U+0301 is two code points; 100 of them are exactly 200.
    expect(validate({ name: "é".repeat(100) }).ok).toBe(true);
    expect(errorsOf({ name: "é".repeat(100) + "x" }).name).toBeDefined();
  });

  it("applies the address (500) and tax number (100) limits in code points", () => {
    expect(validate({ address: "😀".repeat(LIMITS.address) }).ok).toBe(true);
    expect(errorsOf({ address: "😀".repeat(LIMITS.address + 1) }).address).toBe(
      "Use at most 500 characters.",
    );
    expect(validate({ taxNumber: "😀".repeat(LIMITS.taxNumber) }).ok).toBe(true);
    expect(errorsOf({ taxNumber: "😀".repeat(LIMITS.taxNumber + 1) }).taxNumber).toBe(
      "Use at most 100 characters.",
    );
  });

  it.each([
    ["malformed", "not-an-email"],
    ["inner space", "a b@example.com"],
    ["inner NBSP", "a b@example.com"],
    ["inner U+0085", "a\u0085b@example.com"],
    ["inner U+2003", "a b@example.com"],
    ["too long", "a".repeat(LIMITS.email) + "@example.com"],
  ])("rejects an email: %s", (_, email) => {
    expect(errorsOf({ email }).email).toBe("Please enter a valid email address.");
  });

  it.each([
    ["letters", "call me"],
    ["no digits", "+()-"],
    ["too long", "1".repeat(LIMITS.phone + 1)],
    ["inner NBSP", "+880 1711000000"],
  ])("rejects a phone: %s", (_, phone) => {
    expect(errorsOf({ phone }).phone).toBe("Please enter a valid phone number.");
  });

  it("accepts exactly the supported currencies, case-insensitively", () => {
    for (const c of SUPPORTED_CURRENCIES) {
      expect(validate({ currency: c.toLowerCase() }).ok).toBe(true);
    }
    expect(errorsOf({ currency: "ZZZ" }).currency).toBe("Please choose a currency.");
    expect(errorsOf({ currency: "BD" }).currency).toBeDefined();
    expect(errorsOf({ currency: "" }).currency).toBeDefined();
  });

  it("rejects unknown time zones and accepts UTC", () => {
    expect(validate({ timezone: "UTC" }).ok).toBe(true);
    expect(errorsOf({ timezone: "Not/AZone" }).timezone).toBe(
      "Please choose a time zone.",
    );
  });
});

describe("organization and customer rules agree on shared fields", () => {
  const EDGE_VALUES: Array<[string, string]> = [
    ["NBSP-only", " "],
    ["U+0085-only", "\u0085"],
    ["U+2003 edges", " Name "],
    ["U+FEFF edges", "﻿Name﻿"],
    ["200 emoji", "😀".repeat(200)],
    ["201 emoji", "😀".repeat(201)],
    ["Bengali", "ঢাকা ট্রেডার্স"],
    ["combining", "Café"],
  ];

  function customer(field: "name" | "email" | "phone" | "address" | "taxNumber", value: string) {
    return validateCustomerInput({
      name: "x", companyName: "", phone: "", email: "", address: "", taxNumber: "", notes: "",
      [field]: value,
    });
  }

  function organization(field: "name" | "email" | "phone" | "address" | "taxNumber", value: string) {
    return validateOrganizationInput({ ...BASE, [field]: value });
  }

  function outcome(r: ReturnType<typeof customer> | ReturnType<typeof organization>, field: string) {
    return r.ok
      ? { ok: true, value: (r.value as Record<string, unknown>)[field] }
      : { ok: false, hasError: field in r.fieldErrors };
  }

  it.each(EDGE_VALUES)("name: %s", (_, value) => {
    expect(outcome(organization("name", value), "name")).toEqual(
      outcome(customer("name", value), "name"),
    );
  });

  const EMAILS = [
    " A@Example.com\u0085",
    "a b@example.com",
    "a b@example.com",
    "a@b@example.com",
    "a".repeat(308) + "@example.com",
    "a".repeat(309) + "@example.com",
  ];
  it.each(EMAILS)("email: %j", (value) => {
    expect(outcome(organization("email", value), "email")).toEqual(
      outcome(customer("email", value), "email"),
    );
  });

  const PHONES = [" +880 1711-000000﻿", "+880 1711000000", "12345", "1".repeat(50), "1".repeat(51)];
  it.each(PHONES)("phone: %j", (value) => {
    expect(outcome(organization("phone", value), "phone")).toEqual(
      outcome(customer("phone", value), "phone"),
    );
  });

  const ADDRESSES = ["\u0085 Road  ", "😀".repeat(500), "😀".repeat(501)];
  it.each(ADDRESSES.map((v) => [v.slice(0, 12), v]))("address: %j…", (_, value) => {
    expect(outcome(organization("address", value), "address")).toEqual(
      outcome(customer("address", value), "address"),
    );
  });

  const TAX = [" TIN ", "😀".repeat(100), "😀".repeat(101)];
  it.each(TAX.map((v) => [v.slice(0, 12), v]))("tax number: %j…", (_, value) => {
    expect(outcome(organization("taxNumber", value), "taxNumber")).toEqual(
      outcome(customer("taxNumber", value), "taxNumber"),
    );
  });
});
