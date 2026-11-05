import { parseDecimal, type DecimalResult } from "@/lib/validation/decimal";
import { isUuid, optionalText, tooLongMessage as tooLong } from "@/lib/validation/fields";
import { charLength, trimText, truncateChars } from "@/lib/validation/text";

/**
 * Product and category input validation. Runs on the server for friendly,
 * per-field errors. The `products` and `product_categories` CHECK
 * constraints enforce the same rules for every write path
 * (supabase/migrations/20261104070000_products.sql). Keep both in sync.
 *
 * Trimming and lengths use lib/validation/text.ts (shared whitespace set,
 * code points). Prices and quantities stay decimal strings end to end: they
 * are never parsed into JavaScript numbers (DECISIONS 016).
 */

// -----------------------------------------------------------------------------
// Fixed lists
// -----------------------------------------------------------------------------

export const PRODUCT_STATUSES = ["active", "inactive"] as const;
export type ProductStatus = (typeof PRODUCT_STATUSES)[number];

export function isProductStatus(value: unknown): value is ProductStatus {
  return (PRODUCT_STATUSES as readonly unknown[]).includes(value);
}

export const PRODUCT_TYPES = ["inventory", "non_inventory", "service"] as const;
export type ProductType = (typeof PRODUCT_TYPES)[number];

export function isProductType(value: unknown): value is ProductType {
  return (PRODUCT_TYPES as readonly unknown[]).includes(value);
}

export const PRODUCT_TYPE_LABELS: Record<ProductType, string> = {
  inventory: "Inventory",
  non_inventory: "Non-inventory",
  service: "Service",
};

/** Predefined units. The products_unit_check constraint has the same list. */
export const PRODUCT_UNITS = [
  "pcs",
  "unit",
  "kg",
  "g",
  "litre",
  "ml",
  "box",
  "pack",
  "set",
  "hour",
  "day",
  "service",
] as const;
export type ProductUnit = (typeof PRODUCT_UNITS)[number];

export function isProductUnit(value: unknown): value is ProductUnit {
  return (PRODUCT_UNITS as readonly unknown[]).includes(value);
}

export const PRODUCT_UNIT_LABELS: Record<ProductUnit, string> = {
  pcs: "Pieces (pcs)",
  unit: "Unit",
  kg: "Kilogram (kg)",
  g: "Gram (g)",
  litre: "Litre",
  ml: "Millilitre (ml)",
  box: "Box",
  pack: "Pack",
  set: "Set",
  hour: "Hour",
  day: "Day",
  service: "Service",
};

export const PRODUCT_LIMITS = {
  name: 200,
  sku: 100,
  description: 2000,
} as const;

export const CATEGORY_NAME_MAX_LENGTH = 100;

/** numeric(18,2): 16 integer digits, 2 decimals. */
export const PRICE_FORMAT = { integerDigits: 16, scale: 2 } as const;
/** numeric(18,3): 15 integer digits, 3 decimals. */
export const REORDER_LEVEL_FORMAT = { integerDigits: 15, scale: 3 } as const;

// -----------------------------------------------------------------------------
// Decimals (shared parser in lib/validation/decimal.ts, re-exported for
// existing imports)
// -----------------------------------------------------------------------------

export { parseDecimal, type DecimalResult };

function decimalMessage(
  error: "format" | "scale" | "too_large",
  what: string,
  scale: number,
): string {
  switch (error) {
    case "format":
      return `Enter ${what} of 0 or more, using digits and a decimal point (e.g. 1250.50).`;
    case "scale":
      return `Use at most ${scale} decimal places.`;
    case "too_large":
      return "This number is too large.";
  }
}

// -----------------------------------------------------------------------------
// Product input
// -----------------------------------------------------------------------------

export type ProductInput = {
  name: string;
  sku: string;
  productType: ProductType;
  categoryId: string | null;
  unit: ProductUnit;
  description: string | null;
  /** Canonical decimal string, or null when not set. */
  purchasePrice: string | null;
  sellingPrice: string | null;
  /** Canonical decimal string. Always "0" unless the type is inventory. */
  reorderLevel: string;
};

export type ProductField = keyof ProductInput;
export type ProductRawInput = Record<ProductField, string>;
export type ProductFieldErrors = Partial<Record<ProductField, string>>;

export const PRODUCT_FIELDS: readonly ProductField[] = [
  "name",
  "sku",
  "productType",
  "categoryId",
  "unit",
  "description",
  "purchasePrice",
  "sellingPrice",
  "reorderLevel",
];

/** Trims a SKU with the shared whitespace set. Case is kept as typed. */
export function normalizeSku(raw: string): string {
  return trimText(raw);
}

/** Only inventory products track stock, so only they have a reorder level. */
export function hasReorderLevel(type: ProductType): boolean {
  return type === "inventory";
}

export function validateProductInput(
  raw: ProductRawInput,
):
  | { ok: true; value: ProductInput }
  | { ok: false; fieldErrors: ProductFieldErrors } {
  const errors: ProductFieldErrors = {};
  const L = PRODUCT_LIMITS;

  const name = trimText(raw.name);
  if (!name) errors.name = "Product name is required.";
  else if (charLength(name) > L.name) errors.name = tooLong(L.name);

  const sku = normalizeSku(raw.sku);
  if (!sku) errors.sku = "SKU is required.";
  else if (charLength(sku) > L.sku) errors.sku = tooLong(L.sku);

  const typeRaw = trimText(raw.productType);
  const productType = isProductType(typeRaw) ? typeRaw : null;
  if (!productType) errors.productType = "Choose a product type.";

  const unitRaw = trimText(raw.unit);
  const unit = isProductUnit(unitRaw) ? unitRaw : null;
  if (!unit) errors.unit = "Choose a unit.";

  const categoryRaw = trimText(raw.categoryId);
  const categoryId = categoryRaw === "" ? null : categoryRaw;
  if (categoryId !== null && !isUuid(categoryId))
    errors.categoryId = "Choose a category from the list.";

  const description = optionalText(raw.description);
  if (description && charLength(description) > L.description)
    errors.description = tooLong(L.description);

  const prices: Record<"purchasePrice" | "sellingPrice", string | null> = {
    purchasePrice: null,
    sellingPrice: null,
  };
  for (const field of ["purchasePrice", "sellingPrice"] as const) {
    const text = trimText(raw[field]);
    if (text === "") continue;
    const parsed = parseDecimal(text, PRICE_FORMAT);
    if (parsed.ok) prices[field] = parsed.value;
    else errors[field] = decimalMessage(parsed.error, "a price", PRICE_FORMAT.scale);
  }

  // Non-inventory types never keep a reorder level, whatever was submitted
  // (the form hides the field for them).
  let reorderLevel = "0";
  if (productType && hasReorderLevel(productType)) {
    const text = trimText(raw.reorderLevel);
    if (text !== "") {
      const parsed = parseDecimal(text, REORDER_LEVEL_FORMAT);
      if (parsed.ok) reorderLevel = parsed.value;
      else
        errors.reorderLevel = decimalMessage(
          parsed.error,
          "a reorder level",
          REORDER_LEVEL_FORMAT.scale,
        );
    }
  }

  if (Object.keys(errors).length || !productType || !unit)
    return { ok: false, fieldErrors: errors };

  return {
    ok: true,
    value: {
      name,
      sku,
      productType,
      categoryId,
      unit,
      description,
      purchasePrice: prices.purchasePrice,
      sellingPrice: prices.sellingPrice,
      reorderLevel,
    },
  };
}

// -----------------------------------------------------------------------------
// Category input
// -----------------------------------------------------------------------------

export function validateCategoryName(
  raw: string,
): { ok: true; value: string } | { ok: false; error: string } {
  const name = trimText(raw);
  if (!name) return { ok: false, error: "Category name is required." };
  if (charLength(name) > CATEGORY_NAME_MAX_LENGTH)
    return { ok: false, error: tooLong(CATEGORY_NAME_MAX_LENGTH) };
  return { ok: true, value: name };
}

// -----------------------------------------------------------------------------
// List parameters (from the URL query string)
// -----------------------------------------------------------------------------

export const PRODUCT_PAGE_SIZE = 25;
export const PRODUCT_SEARCH_MAX_LENGTH = 100;
const MAX_PAGE = 10_000;

export type ProductStatusFilter = ProductStatus | "all";
export type ProductTypeFilter = ProductType | "all";

export type ProductListParams = {
  search: string;
  status: ProductStatusFilter;
  type: ProductTypeFilter;
  /** A category ID, or "all". */
  category: string;
  page: number;
};

type SearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

/** Parses untrusted query-string values into safe list parameters. */
export function parseProductListParams(params: SearchParams): ProductListParams {
  const search = truncateChars(
    trimText(first(params.q)),
    PRODUCT_SEARCH_MAX_LENGTH,
  );
  const statusRaw = first(params.status);
  const typeRaw = first(params.type);
  const categoryRaw = first(params.category);
  const pageNum = Number.parseInt(first(params.page), 10);
  return {
    search,
    status: isProductStatus(statusRaw) ? statusRaw : "all",
    type: isProductType(typeRaw) ? typeRaw : "all",
    category: isUuid(categoryRaw) ? categoryRaw.toLowerCase() : "all",
    page:
      Number.isFinite(pageNum) && pageNum >= 1 ? Math.min(pageNum, MAX_PAGE) : 1,
  };
}
