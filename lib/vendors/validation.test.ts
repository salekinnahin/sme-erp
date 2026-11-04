import { describe, expect, it } from "vitest";
import {
  CUSTOMER_LIMITS,
  validateCustomerInput,
} from "@/lib/customers/validation";
import { canVendor } from "./permissions";
import {
  VENDOR_LIMITS,
  VENDOR_PAGE_SIZE,
  type VendorRawInput,
  isVendorStatus,
  parseVendorListParams,
  validateVendorInput,
} from "./validation";

// The shared helpers themselves (trimText, charLength, isValidEmail, …) are
// covered in lib/validation/*.test.ts. These tests cover the vendor rules and
// that vendors apply the shared rules the same way as customers.

const EMPTY: VendorRawInput = {
  name: "",
  companyName: "",
  phone: "",
  email: "",
  address: "",
  taxNumber: "",
  notes: "",
};

function validate(overrides: Partial<VendorRawInput>) {
  return validateVendorInput({ ...EMPTY, ...overrides });
}

function errorsOf(overrides: Partial<VendorRawInput>) {
  const result = validate(overrides);
  return result.ok ? {} : result.fieldErrors;
}

describe("validateVendorInput", () => {
  it("accepts a name only and turns blank optional fields into null", () => {
    expect(validate({ name: "Dhaka Paper Mills", notes: "  " })).toEqual({
      ok: true,
      value: {
        name: "Dhaka Paper Mills",
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
    expect(
      validate({
        name: " Supplier ",
        companyName: " Paper Co﻿",
        phone: " +880 1711-000000 ",
        email: " Sales@Paper.COM ",
        address: "\tRoad 2\n",
        taxNumber: " BIN-9 ",
        notes: "\u0085 note ",
      }),
    ).toEqual({
      ok: true,
      value: {
        name: "Supplier",
        companyName: "Paper Co",
        phone: "+880 1711-000000",
        email: "sales@paper.com",
        address: "Road 2",
        taxNumber: "BIN-9",
        notes: "note",
      },
    });
  });

  it.each([
    ["empty", ""],
    ["NBSP only", "  "],
    ["U+0085 only", "\u0085"],
    ["U+3000 only", "　"],
  ])("requires a name (%s)", (_, name) => {
    expect(errorsOf({ name }).name).toBe("Vendor name is required.");
  });

  it("keeps a zero-width space (not whitespace), so the name is not blank", () => {
    expect(validate({ name: "​" }).ok).toBe(true);
  });

  it.each([
    ["name", VENDOR_LIMITS.name],
    ["companyName", VENDOR_LIMITS.companyName],
    ["address", VENDOR_LIMITS.address],
    ["taxNumber", VENDOR_LIMITS.taxNumber],
    ["notes", VENDOR_LIMITS.notes],
  ] as const)("limits %s to %i code points", (field, limit) => {
    const base = field === "name" ? {} : { name: "x" };
    expect(validate({ ...base, [field]: "😀".repeat(limit) }).ok).toBe(true);
    expect(errorsOf({ ...base, [field]: "😀".repeat(limit + 1) })[field]).toBe(
      `Use at most ${limit} characters.`,
    );
  });

  it("uses the requested limits", () => {
    expect(VENDOR_LIMITS).toEqual({
      name: 200,
      companyName: 200,
      phone: 50,
      email: 320,
      address: 500,
      taxNumber: 100,
      notes: 2000,
    });
  });

  it("rejects an invalid email, including inner Unicode whitespace", () => {
    for (const email of ["not-an-email", "a b@paper.com", "a b@paper.com"]) {
      expect(errorsOf({ name: "x", email }).email).toBe(
        "Please enter a valid email address.",
      );
    }
    expect(errorsOf({ name: "x", email: `${"a".repeat(315)}@x.com` }).email).toBeDefined();
  });

  it("rejects an invalid phone", () => {
    for (const phone of ["call me", "12-34", `+${"1".repeat(50)}`]) {
      expect(errorsOf({ name: "x", phone }).phone).toBe(
        "Please enter a valid phone number.",
      );
    }
  });
});

describe("vendor and customer validation stay consistent", () => {
  it("has the same field limits as customers", () => {
    expect(VENDOR_LIMITS).toEqual(CUSTOMER_LIMITS);
  });

  it.each([
    { name: " Acme ", email: " A@B.CO ", phone: " (02) 555-1234 " },
    { name: "😀".repeat(201) },
    { name: "x", email: "a\u0085b@c.de", phone: "abc" },
    { name: " ", notes: " " },
    { name: "x", address: "ব".repeat(501), taxNumber: " T " },
  ])("normalizes and rejects %o the same way", (input) => {
    const raw = { ...EMPTY, ...input };
    const vendor = validateVendorInput(raw);
    const customer = validateCustomerInput(raw);
    expect(vendor.ok).toBe(customer.ok);
    if (vendor.ok && customer.ok) expect(vendor.value).toEqual(customer.value);
    if (!vendor.ok && !customer.ok)
      expect(Object.keys(vendor.fieldErrors)).toEqual(
        Object.keys(customer.fieldErrors),
      );
  });
});

describe("parseVendorListParams", () => {
  it("trims the search with the shared set and caps it at 100 code points", () => {
    expect(parseVendorListParams({ q: "  paper 　" }).search).toBe("paper");
    expect(parseVendorListParams({ q: "😀".repeat(150) }).search).toBe("😀".repeat(100));
  });

  it("falls back to safe defaults for bad status and page", () => {
    expect(parseVendorListParams({})).toEqual({ search: "", status: "all", page: 1 });
    expect(parseVendorListParams({ status: "deleted", page: "abc" })).toEqual({
      search: "",
      status: "all",
      page: 1,
    });
    expect(parseVendorListParams({ status: ["active", "inactive"], page: "0" })).toEqual({
      search: "",
      status: "active",
      page: 1,
    });
    expect(parseVendorListParams({ status: "inactive", page: "3" }).page).toBe(3);
    expect(parseVendorListParams({ page: "99999999" }).page).toBe(10_000);
  });

  it("uses 25 rows per page", () => {
    expect(VENDOR_PAGE_SIZE).toBe(25);
  });

  it("accepts only active and inactive as statuses", () => {
    expect(isVendorStatus("active")).toBe(true);
    expect(isVendorStatus("inactive")).toBe(true);
    expect(isVendorStatus("archived")).toBe(false);
    expect(isVendorStatus(undefined)).toBe(false);
  });
});

describe("canVendor", () => {
  it.each(["owner", "manager", "employee"] as const)(
    "lets %s view, create and edit",
    (role) => {
      expect(canVendor(role, "view")).toBe(true);
      expect(canVendor(role, "create")).toBe(true);
      expect(canVendor(role, "edit")).toBe(true);
    },
  );

  it("lets only owners and managers change status", () => {
    expect(canVendor("owner", "changeStatus")).toBe(true);
    expect(canVendor("manager", "changeStatus")).toBe(true);
    expect(canVendor("employee", "changeStatus")).toBe(false);
  });
});
