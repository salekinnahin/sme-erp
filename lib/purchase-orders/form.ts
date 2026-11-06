import { plainDecimal } from "@/lib/format";
import {
  customerOptionDetail,
  customerOptionLabel,
  emptyLine,
  parseFormItems,
  previewLinesWithDefaultPrice,
  type ProductOption,
  type QuotationFormLine,
  type QuotationPreview,
} from "@/lib/quotations/form";
import type { PurchaseOrder } from "./purchase-orders";
import type { PurchaseOrderItemRawInput } from "./validation";

/**
 * Pure helpers for the purchase order form. Safe to import from Client
 * Components (no server imports).
 *
 * Same structure as the invoice form helpers (lib/invoices/form.ts): the
 * quotation line fields, payload parser and exact-decimal preview engine,
 * plus the ID of each existing draft line. The one purchasing difference:
 * a new product selection defaults to the product's PURCHASE price, never
 * its selling price (create_purchase_order() / update_purchase_order_draft()
 * use the same default).
 *
 * Line-ID rules (update_purchase_order_draft(), DECISIONS 026):
 *   - a line loaded from the draft keeps its `lineId` for as long as it is in
 *     the form, also when its product is changed
 *   - a new line has no `lineId`
 *   - a removed line is simply not submitted, so its ID is absent
 * A `lineId` is an edit/reference token for the current save only. The
 * database replaces the draft's items on save, so IDs may change; the edit
 * form always reloads them from the saved draft.
 */

// -----------------------------------------------------------------------------
// Options
// -----------------------------------------------------------------------------

/** A vendor in the selector (same fields as a customer option). */
export type VendorOption = {
  id: string;
  name: string;
  companyName: string | null;
  phone: string | null;
  email: string | null;
  status: "active" | "inactive";
};

export const vendorOptionLabel = (v: VendorOption): string => customerOptionLabel(v);
export const vendorOptionDetail = (v: VendorOption): string => customerOptionDetail(v);

/** A product in the PO selector: the purchase price instead of the selling price. */
export type PurchaseProductOption = Omit<ProductOption, "sellingPrice"> & {
  /** Decimal string, or null if the product has no purchase price. */
  purchasePrice: string | null;
};

/**
 * The known products after the user picks `product` from a search: the
 * picked (fresh) record replaces any cached record with the same ID, so the
 * line's unit, default purchase price and required-price state follow what
 * the server just returned, not an older search. Returns the same map if the
 * same record is already cached.
 *
 * Kept lines are unaffected: lineProduct() shows their recorded snapshot and
 * takes only the status from this map.
 */
export function rememberSelectedProduct(
  known: ReadonlyMap<string, PurchaseProductOption>,
  product: PurchaseProductOption,
): ReadonlyMap<string, PurchaseProductOption> {
  if (known.get(product.id) === product) return known;
  const next = new Map(known);
  next.set(product.id, product);
  return next;
}

// -----------------------------------------------------------------------------
// Form values
// -----------------------------------------------------------------------------

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

export type PurchaseOrderFormLine = QuotationFormLine & {
  /** ID of the existing draft line, or "" for a new line. */
  lineId: string;
  /** The loaded line's snapshot, or null for a new line. */
  snapshot: LineSnapshot | null;
};

export type PurchaseOrderFormValues = {
  vendorId: string;
  orderDate: string;
  expectedDeliveryDate: string;
  notes: string;
  lines: PurchaseOrderFormLine[];
};

export function emptyPurchaseOrderLine(key: string): PurchaseOrderFormLine {
  return { ...emptyLine(key), lineId: "", snapshot: null };
}

/** A new purchase order: today's date (organization time zone), one line. */
export function newPurchaseOrderFormValues(today: string): PurchaseOrderFormValues {
  return {
    vendorId: "",
    orderDate: today,
    expectedDeliveryDate: "",
    notes: "",
    lines: [emptyPurchaseOrderLine("line-0")],
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
export function purchaseOrderToFormValues(po: PurchaseOrder): PurchaseOrderFormValues {
  return {
    vendorId: po.vendorId,
    orderDate: po.orderDate,
    expectedDeliveryDate: po.expectedDeliveryDate ?? "",
    notes: po.notes ?? "",
    lines: po.items.map((item, index) => ({
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
export function isKeptLine(line: PurchaseOrderFormLine): boolean {
  return line.lineId !== "" && line.snapshot !== null && line.snapshot.productId === line.productId;
}

/**
 * A saved line whose product was changed can return to its recorded product
 * with one click. This is the only way back to an inactive original product:
 * the product search offers active products only.
 */
export function canRestoreRecordedProduct(line: PurchaseOrderFormLine): boolean {
  return line.lineId !== "" && Boolean(line.snapshot?.productId)
    && line.snapshot?.productId !== line.productId;
}

/** Restore from the loaded snapshot; keep the reference token and the amounts entered. */
export function restoreRecordedProduct(line: PurchaseOrderFormLine): PurchaseOrderFormLine {
  if (!canRestoreRecordedProduct(line) || !line.snapshot) return line;
  const s = line.snapshot;
  return { ...line, productId: s.productId, description: s.description ?? "", unitPrice: s.unitPrice };
}

/**
 * The product to show for a line, and whose price is the default when the
 * unit price is blank: the recorded snapshot for a kept line (its recorded
 * PO price, with the product's current status if known), otherwise the
 * chosen product with its current purchase price.
 */
export function lineProduct(
  line: PurchaseOrderFormLine,
  products: ReadonlyMap<string, PurchaseProductOption>,
): PurchaseProductOption | undefined {
  if (isKeptLine(line) && line.snapshot) {
    const s = line.snapshot;
    return {
      id: s.productId,
      name: s.productName,
      sku: s.sku,
      unit: s.unit,
      description: s.description,
      purchasePrice: s.unitPrice,
      status: products.get(s.productId)?.status ?? "active",
    };
  }
  return products.get(line.productId);
}

/**
 * The line after choosing a product. The line keeps its ID either way.
 *
 *   - Re-selecting the product the loaded line recorded (A → B → A):
 *     description and unit price are restored from the line's recorded
 *     values, not the product's current master data or purchase price.
 *   - Any other product (or a new line): description and unit price are
 *     prefilled from the product's current data; the unit price from its
 *     purchase price, or blank (to be entered) if it has none.
 * Quantity, discount and tax rate are always kept.
 */
export function applyProductToPurchaseOrderLine(
  line: PurchaseOrderFormLine,
  product: PurchaseProductOption | undefined,
): PurchaseOrderFormLine {
  if (!product) return { ...line, productId: "" };
  const s = line.snapshot;
  if (line.lineId !== "" && s && s.productId === product.id) {
    return { ...line, productId: s.productId, description: s.description ?? "", unitPrice: s.unitPrice };
  }
  return {
    ...line,
    productId: product.id,
    description: product.description ?? "",
    unitPrice: product.purchasePrice ?? "",
  };
}

/**
 * True if the line has a product with no default price and no price
 * entered, so the user must type one (the server rejects it otherwise).
 */
export function needsUnitPrice(
  line: PurchaseOrderFormLine,
  product: PurchaseProductOption | undefined,
): boolean {
  return Boolean(product) && product?.purchasePrice === null && line.unitPrice.trim() === "";
}

/** Exact preview; blank prices use the recorded price (kept) or the purchase price (new). */
export function previewPurchaseOrder(
  lines: readonly PurchaseOrderFormLine[],
  products: ReadonlyMap<string, PurchaseProductOption>,
): QuotationPreview {
  return previewLinesWithDefaultPrice(lines, (line) => lineProduct(line, products)?.purchasePrice);
}

/**
 * The vendor to show as selected on the edit form: the snapshot recorded on
 * the order (an unchanged vendor is not re-snapshotted), with the vendor's
 * current status if it could be read.
 */
export function snapshotVendorOption(
  po: Pick<PurchaseOrder, "vendorId" | "vendorName" | "vendorCompanyName" | "vendorPhone" | "vendorEmail">,
  current: Pick<VendorOption, "status"> | null,
): VendorOption {
  return {
    id: po.vendorId,
    name: po.vendorName,
    companyName: po.vendorCompanyName,
    phone: po.vendorPhone,
    email: po.vendorEmail,
    status: current?.status ?? "active",
  };
}

// -----------------------------------------------------------------------------
// Payload (hidden "items" field)
// -----------------------------------------------------------------------------

/** Only the user-controlled fields and the line ID of each line are sent. */
export function serializePurchaseOrderLines(lines: readonly PurchaseOrderFormLine[]): string {
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

export type ParsedPurchaseOrderFormItems =
  | { ok: true; keys: string[]; items: PurchaseOrderItemRawInput[] }
  | { ok: false };

/**
 * Reads the untrusted "items" form field: the quotation parser (size cap,
 * arrays of objects, string fields only, other keys ignored) plus each
 * line's `lineId` string, validated later by validatePurchaseOrderInput().
 */
export function parsePurchaseOrderFormItems(raw: unknown): ParsedPurchaseOrderFormItems {
  const base = parseFormItems(raw);
  if (!base.ok) return base;
  // parseFormItems succeeded, so raw is a JSON array of objects.
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
