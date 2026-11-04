import { describe, expect, it } from "vitest";
import { canCategory, canProduct } from "./permissions";
import {
  CATEGORY_NAME_MAX_LENGTH,
  PRICE_FORMAT,
  PRODUCT_LIMITS,
  PRODUCT_PAGE_SIZE,
  PRODUCT_TYPES,
  PRODUCT_UNITS,
  REORDER_LEVEL_FORMAT,
  type ProductRawInput,
  hasReorderLevel,
  isProductStatus,
  normalizeSku,
  parseDecimal,
  parseProductListParams,
  validateCategoryName,
  validateProductInput,
} from "./validation";

// The shared helpers themselves (trimText, charLength, …) are covered in
// lib/validation/*.test.ts. These tests cover the product rules.

const CATEGORY_ID = "aaaaaaaa-0000-4000-8000-000000000001";

const BASE: ProductRawInput = {
  name: "Laptop",
  sku: "SKU-001",
  productType: "inventory",
  categoryId: "",
  unit: "pcs",
  description: "",
  purchasePrice: "",
  sellingPrice: "",
  reorderLevel: "",
};

function validate(overrides: Partial<ProductRawInput>) {
  return validateProductInput({ ...BASE, ...overrides });
}

function errorsOf(overrides: Partial<ProductRawInput>) {
  const result = validate(overrides);
  return result.ok ? {} : result.fieldErrors;
}

function valueOf(overrides: Partial<ProductRawInput>) {
  const result = validate(overrides);
  if (!result.ok) throw new Error(JSON.stringify(result.fieldErrors));
  return result.value;
}

describe("validateProductInput", () => {
  it("accepts the required fields and fills defaults", () => {
    expect(valueOf({})).toEqual({
      name: "Laptop",
      sku: "SKU-001",
      productType: "inventory",
      categoryId: null,
      unit: "pcs",
      description: null,
      purchasePrice: null,
      sellingPrice: null,
      reorderLevel: "0",
    });
  });

  it("normalizes every field with the shared whitespace set", () => {
    expect(
      valueOf({
        name: "  Laptop　",
        sku: "﻿ SKU-001 \u0085",
        productType: " service ",
        categoryId: ` ${CATEGORY_ID}\t`,
        unit: " hour",
        description: "\n Fast \n",
        purchasePrice: " 1000.50 ",
        sellingPrice: " 1200",
      }),
    ).toEqual({
      name: "Laptop",
      sku: "SKU-001",
      productType: "service",
      categoryId: CATEGORY_ID,
      unit: "hour",
      description: "Fast",
      purchasePrice: "1000.50",
      sellingPrice: "1200",
      reorderLevel: "0",
    });
  });

  it.each([
    ["empty", ""],
    ["NBSP only", "  "],
    ["U+0085 only", "\u0085"],
    ["U+FEFF only", "﻿"],
  ])("requires a name and SKU (%s)", (_, blank) => {
    const errors = errorsOf({ name: blank, sku: blank });
    expect(errors.name).toBe("Product name is required.");
    expect(errors.sku).toBe("SKU is required.");
  });

  it.each([
    ["name", PRODUCT_LIMITS.name],
    ["sku", PRODUCT_LIMITS.sku],
    ["description", PRODUCT_LIMITS.description],
  ] as const)("limits %s to %i code points", (field, limit) => {
    expect(validate({ [field]: "😀".repeat(limit) }).ok).toBe(true);
    expect(errorsOf({ [field]: "😀".repeat(limit + 1) })[field]).toBe(
      `Use at most ${limit} characters.`,
    );
  });

  it("uses the requested limits", () => {
    expect(PRODUCT_LIMITS).toEqual({ name: 200, sku: 100, description: 2000 });
    expect(CATEGORY_NAME_MAX_LENGTH).toBe(100);
  });

  it("rejects unknown product types and units", () => {
    expect(errorsOf({ productType: "goods" }).productType).toBe("Choose a product type.");
    expect(errorsOf({ productType: "" }).productType).toBe("Choose a product type.");
    expect(errorsOf({ unit: "dozen" }).unit).toBe("Choose a unit.");
    expect(errorsOf({ unit: "PCS" }).unit).toBe("Choose a unit.");
  });

  it("matches the database lists of types and units", () => {
    expect(PRODUCT_TYPES).toEqual(["inventory", "non_inventory", "service"]);
    expect(PRODUCT_UNITS).toEqual([
      "pcs", "unit", "kg", "g", "litre", "ml", "box", "pack", "set", "hour", "day", "service",
    ]);
  });

  it("accepts only a UUID as the category", () => {
    expect(valueOf({ categoryId: CATEGORY_ID }).categoryId).toBe(CATEGORY_ID);
    expect(errorsOf({ categoryId: "electronics" }).categoryId).toBe(
      "Choose a category from the list.",
    );
  });
});

describe("SKU normalization", () => {
  it("trims with the shared set and keeps case and inner spaces", () => {
    expect(normalizeSku(" sku-001 ")).toBe("sku-001");
    expect(normalizeSku("Sku 42")).toBe("Sku 42");
  });

  it("does not treat a zero-width space as whitespace", () => {
    expect(normalizeSku("​")).toBe("​");
  });
});

describe("prices", () => {
  it.each([
    ["0", "0"],
    ["12", "12"],
    ["1250.5", "1250.5"],
    ["1250.50", "1250.50"],
    ["007.10", "7.10"],
    [".5", "0.5"],
    ["5.", "5"],
    ["9999999999999999.99", "9999999999999999.99"],
  ])("accepts %s as %s", (raw, expected) => {
    expect(valueOf({ sellingPrice: raw }).sellingPrice).toBe(expected);
    expect(valueOf({ purchasePrice: raw }).purchasePrice).toBe(expected);
  });

  it("keeps large prices exact (never parsed as a float)", () => {
    // 9007199254740993 cannot be represented as a JavaScript number.
    expect(valueOf({ sellingPrice: "9007199254740993.01" }).sellingPrice).toBe(
      "9007199254740993.01",
    );
  });

  it.each([
    ["negative", "-1"],
    ["sign", "+1"],
    ["letters", "abc"],
    ["thousands separator", "1,250.50"],
    ["exponent", "1e3"],
    ["NaN", "NaN"],
    ["Infinity", "Infinity"],
    ["two points", "1.2.3"],
    ["lone point", "."],
    ["inner space", "12 50"],
    ["Bengali digits", "১২৩"],
  ])("rejects %s", (_, raw) => {
    expect(errorsOf({ sellingPrice: raw }).sellingPrice).toMatch(/^Enter a price of 0 or more/);
  });

  it("rejects more than 2 decimals instead of rounding", () => {
    expect(errorsOf({ purchasePrice: "1.239" }).purchasePrice).toBe(
      "Use at most 2 decimal places.",
    );
  });

  it("rejects values over numeric(18,2)", () => {
    expect(errorsOf({ sellingPrice: "10000000000000000" }).sellingPrice).toBe(
      "This number is too large.",
    );
    // Leading zeros don't count.
    expect(valueOf({ sellingPrice: "00000000000000000001" }).sellingPrice).toBe("1");
  });

  it("treats blank prices as not set", () => {
    const value = valueOf({ purchasePrice: " ", sellingPrice: " " });
    expect(value.purchasePrice).toBeNull();
    expect(value.sellingPrice).toBeNull();
  });
});

describe("reorder level", () => {
  it("defaults to 0 and accepts up to 3 decimals for inventory", () => {
    expect(valueOf({ reorderLevel: "" }).reorderLevel).toBe("0");
    expect(valueOf({ reorderLevel: "5" }).reorderLevel).toBe("5");
    expect(valueOf({ unit: "kg", reorderLevel: "2.125" }).reorderLevel).toBe("2.125");
  });

  it("rejects negative, malformed, too precise and too large values", () => {
    expect(errorsOf({ reorderLevel: "-1" }).reorderLevel).toMatch(/^Enter a reorder level/);
    expect(errorsOf({ reorderLevel: "x" }).reorderLevel).toMatch(/^Enter a reorder level/);
    expect(errorsOf({ reorderLevel: "1.2345" }).reorderLevel).toBe(
      "Use at most 3 decimal places.",
    );
    expect(errorsOf({ reorderLevel: "1".repeat(16) }).reorderLevel).toBe(
      "This number is too large.",
    );
  });

  it.each(["non_inventory", "service"])(
    "is always 0 for %s, whatever was submitted",
    (productType) => {
      expect(valueOf({ productType, reorderLevel: "10" }).reorderLevel).toBe("0");
      // Even invalid input is ignored: the field doesn't apply.
      expect(valueOf({ productType, reorderLevel: "-1" }).reorderLevel).toBe("0");
    },
  );

  it("applies only to inventory products", () => {
    expect(hasReorderLevel("inventory")).toBe(true);
    expect(hasReorderLevel("non_inventory")).toBe(false);
    expect(hasReorderLevel("service")).toBe(false);
  });
});

describe("parseDecimal", () => {
  it("uses the column formats", () => {
    expect(PRICE_FORMAT).toEqual({ integerDigits: 16, scale: 2 });
    expect(REORDER_LEVEL_FORMAT).toEqual({ integerDigits: 15, scale: 3 });
  });

  it("canonicalizes leading zeros", () => {
    expect(parseDecimal("000", PRICE_FORMAT)).toEqual({ ok: true, value: "0" });
    expect(parseDecimal("0.00", PRICE_FORMAT)).toEqual({ ok: true, value: "0.00" });
  });
});

describe("validateCategoryName", () => {
  it("trims with the shared set", () => {
    expect(validateCategoryName(" Electronics\u0085")).toEqual({
      ok: true,
      value: "Electronics",
    });
  });

  it("requires a name", () => {
    for (const blank of ["", " ", " ", "﻿"])
      expect(validateCategoryName(blank)).toEqual({
        ok: false,
        error: "Category name is required.",
      });
  });

  it("limits the name to 100 code points", () => {
    expect(validateCategoryName("😀".repeat(100)).ok).toBe(true);
    expect(validateCategoryName("😀".repeat(101))).toEqual({
      ok: false,
      error: "Use at most 100 characters.",
    });
  });
});

describe("parseProductListParams", () => {
  it("trims the search with the shared set and caps it at 100 code points", () => {
    expect(parseProductListParams({ q: "  sku-001 　" }).search).toBe("sku-001");
    expect(parseProductListParams({ q: "😀".repeat(150) }).search).toBe("😀".repeat(100));
  });

  it("falls back to safe defaults", () => {
    expect(parseProductListParams({})).toEqual({
      search: "",
      status: "all",
      type: "all",
      category: "all",
      page: 1,
    });
    expect(
      parseProductListParams({
        status: "deleted",
        type: "goods",
        category: "not-a-uuid",
        page: "abc",
      }),
    ).toEqual({ search: "", status: "all", type: "all", category: "all", page: 1 });
  });

  it("accepts valid filters", () => {
    expect(
      parseProductListParams({
        status: ["inactive", "active"],
        type: "service",
        category: CATEGORY_ID.toUpperCase(),
        page: "3",
      }),
    ).toEqual({
      search: "",
      status: "inactive",
      type: "service",
      category: CATEGORY_ID,
      page: 3,
    });
    expect(parseProductListParams({ page: "0" }).page).toBe(1);
    expect(parseProductListParams({ page: "99999999" }).page).toBe(10_000);
  });

  it("uses 25 rows per page", () => {
    expect(PRODUCT_PAGE_SIZE).toBe(25);
  });

  it("accepts only active and inactive as statuses", () => {
    expect(isProductStatus("active")).toBe(true);
    expect(isProductStatus("inactive")).toBe(true);
    expect(isProductStatus("archived")).toBe(false);
  });
});

describe("permissions", () => {
  it.each(["owner", "manager", "employee"] as const)(
    "lets %s view, create and edit products and view categories",
    (role) => {
      for (const action of ["view", "create", "edit"] as const)
        expect(canProduct(role, action)).toBe(true);
      expect(canCategory(role, "view")).toBe(true);
    },
  );

  it("lets only owners and managers change product status", () => {
    expect(canProduct("owner", "changeStatus")).toBe(true);
    expect(canProduct("manager", "changeStatus")).toBe(true);
    expect(canProduct("employee", "changeStatus")).toBe(false);
  });

  it.each(["create", "rename", "changeStatus"] as const)(
    "lets only owners and managers %s categories",
    (action) => {
      expect(canCategory("owner", action)).toBe(true);
      expect(canCategory("manager", action)).toBe(true);
      expect(canCategory("employee", action)).toBe(false);
    },
  );
});
