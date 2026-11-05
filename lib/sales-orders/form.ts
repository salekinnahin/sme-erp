import { plainDecimal } from "@/lib/format";
import {
  applyProductToLine,
  emptyLine,
  parseFormItems,
  previewLines,
  type CustomerOption,
  type ProductOption,
  type QuotationFormLine,
  type QuotationPreview,
} from "@/lib/quotations/form";
import type { SalesOrder } from "./sales-orders";
import type { SalesOrderItemRawInput } from "./validation";

/**
 * Pure helpers for the sales order form. Safe to import from Client
 * Components (no server imports).
 *
 * They build on the quotation form helpers (same line fields, payload
 * parsing, preview engine and calculation model) and add what Part 1 of
 * sales orders needs on top: the ID of each existing draft line.
 *
 * Line-ID rules (update_sales_order_draft(), DECISIONS 022):
 *   - a line loaded from the draft keeps its `lineId` for as long as it is in
 *     the form, also when its product is changed
 *   - a new line has no `lineId`
 *   - a removed line is simply not submitted, so its ID is absent
 * With the same product as before, the database keeps that line's product
 * snapshot (name, SKU, unit), even if the product is now inactive. With a
 * different product, the line is a new selection (active product, fresh
 * snapshot). The browser only ever sends IDs and user-entered values.
 *
 * A `lineId` is an edit/reference token for the current save only: it lets
 * the database identify the previously recorded line. update_sales_order_draft()
 * replaces the draft's items (delete + insert), so a line's row ID may change
 * after every draft save. The edit form always reloads IDs from the saved
 * draft. Nothing should reference a draft line by ID; once the order is
 * confirmed its items are immutable and their IDs are stable.
 */

/** What a loaded draft line recorded for its product. Display only. */
export type LineSnapshot = {
  productId: string;
  productName: string;
  sku: string;
  unit: string;
  description: string | null;
  /** The line's saved unit price: the database's default for a kept line. */
  unitPrice: string;
};

export type SalesOrderFormLine = QuotationFormLine & {
  /** ID of the existing draft line, or "" for a new line. */
  lineId: string;
  /** The loaded line's snapshot, or null for a new line. */
  snapshot: LineSnapshot | null;
};

export type SalesOrderFormValues = {
  customerId: string;
  orderDate: string;
  expectedDeliveryDate: string;
  notes: string;
  lines: SalesOrderFormLine[];
};

export function emptySalesOrderLine(key: string): SalesOrderFormLine {
  return { ...emptyLine(key), lineId: "", snapshot: null };
}

/** A new sales order: today's date (organization time zone), one line. */
export function newSalesOrderFormValues(today: string): SalesOrderFormValues {
  return {
    customerId: "",
    orderDate: today,
    expectedDeliveryDate: "",
    notes: "",
    lines: [emptySalesOrderLine("line-0")],
  };
}

/** Zero amounts are shown as blank fields (blank means 0). */
function blankIfZero(value: string): string {
  const plain = plainDecimal(value);
  return /^0*$/.test(plain.replace(".", "")) ? "" : plain;
}

/**
 * Edit form values from a saved draft. Every line keeps its ID and the
 * values recorded on the order (price, description, quantity, discount,
 * tax), not the product's current master data.
 */
export function salesOrderToFormValues(order: SalesOrder): SalesOrderFormValues {
  return {
    customerId: order.customerId,
    orderDate: order.orderDate,
    expectedDeliveryDate: order.expectedDeliveryDate ?? "",
    notes: order.notes ?? "",
    lines: order.items.map((item, index) => ({
      key: `line-${index}`,
      lineId: item.id,
      snapshot: {
        productId: item.productId,
        productName: item.productName,
        sku: item.sku,
        unit: item.unit,
        description: item.description,
        unitPrice: item.unitPrice,
      },
      productId: item.productId,
      description: item.description ?? "",
      quantity: plainDecimal(item.quantity),
      unitPrice: item.unitPrice,
      discountAmount: blankIfZero(item.discountAmount),
      taxRate: blankIfZero(item.taxRate),
    })),
  };
}

/** True if the database will keep this line's product snapshot. */
export function isKeptLine(line: SalesOrderFormLine): boolean {
  return line.lineId !== "" && line.snapshot !== null && line.snapshot.productId === line.productId;
}

/**
 * The product to show for a line, and whose price is the default when the
 * unit price is blank: the recorded snapshot for a kept line (with the
 * product's current status, if known), otherwise the chosen product.
 */
export function lineProduct(
  line: SalesOrderFormLine,
  products: ReadonlyMap<string, ProductOption>,
): ProductOption | undefined {
  if (isKeptLine(line) && line.snapshot) {
    const s = line.snapshot;
    return {
      id: s.productId,
      name: s.productName,
      sku: s.sku,
      unit: s.unit,
      description: s.description,
      sellingPrice: s.unitPrice,
      status: products.get(s.productId)?.status ?? "active",
    };
  }
  return products.get(line.productId);
}

/**
 * The line after choosing a product. The line keeps its ID either way, so
 * the database sees "existing line" and applies its rules.
 *
 *   - Re-selecting the product the loaded line recorded (for example A → B →
 *     A): description and unit price are restored from the line's recorded
 *     values, not the product's current master data. Name, SKU and unit come
 *     from the snapshot too (lineProduct()), so the line is kept as recorded.
 *   - Any other product (or a new line): description and unit price are
 *     prefilled from the product's current data (quotation behavior).
 *
 * Display and prefill only: the server and the database stay authoritative.
 */
export function applyProductToSalesOrderLine(
  line: SalesOrderFormLine,
  product: ProductOption | undefined,
): SalesOrderFormLine {
  const s = line.snapshot;
  if (product && line.lineId !== "" && s && s.productId === product.id) {
    return { ...line, productId: s.productId, description: s.description ?? "", unitPrice: s.unitPrice };
  }
  return { ...line, ...applyProductToLine(line, product) };
}

/** Preview with the Part 1 rules; a kept line defaults to its saved price. */
export function previewSalesOrder(
  lines: readonly SalesOrderFormLine[],
  products: ReadonlyMap<string, ProductOption>,
): QuotationPreview {
  return previewLines(lines, (line) => lineProduct(line, products));
}

/**
 * The customer to show as selected on the edit form: the snapshot recorded
 * on the order (unchanged customers are not re-snapshotted), with the
 * customer's current status if it could be read.
 */
export function snapshotCustomerOption(
  order: Pick<
    SalesOrder,
    "customerId" | "customerName" | "customerCompanyName" | "customerPhone" | "customerEmail"
  >,
  current: Pick<CustomerOption, "status"> | null,
): CustomerOption {
  return {
    id: order.customerId,
    name: order.customerName,
    companyName: order.customerCompanyName,
    phone: order.customerPhone,
    email: order.customerEmail,
    status: current?.status ?? "active",
  };
}

// -----------------------------------------------------------------------------
// Payload (hidden "items" field)
// -----------------------------------------------------------------------------

/** Only the user-controlled fields and the line ID of each line are sent. */
export function serializeSalesOrderLines(lines: readonly SalesOrderFormLine[]): string {
  return JSON.stringify(
    lines.map((l) => ({
      key: l.key,
      lineId: l.lineId,
      productId: l.productId,
      description: l.description,
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      discountAmount: l.discountAmount,
      taxRate: l.taxRate,
    })),
  );
}

export type ParsedSalesOrderFormItems =
  | { ok: true; keys: string[]; items: SalesOrderItemRawInput[] }
  | { ok: false };

/**
 * Reads the untrusted "items" form field: the quotation parser
 * (parseFormItems: size cap, arrays of objects, string fields only, other
 * keys ignored) plus each line's `lineId` string. The line ID is validated
 * by validateSalesOrderInput() and checked against the draft by the server
 * and the database.
 */
export function parseSalesOrderFormItems(raw: unknown): ParsedSalesOrderFormItems {
  const base = parseFormItems(raw);
  if (!base.ok) return base;
  // parseFormItems succeeded, so raw is a JSON array of objects, read in order.
  const data = JSON.parse(raw as string) as Record<string, unknown>[];
  return {
    ok: true,
    keys: base.keys,
    items: base.items.map((item, index) => {
      const lineId = data[index]?.lineId;
      return { ...item, lineId: typeof lineId === "string" ? lineId : "" };
    }),
  };
}
