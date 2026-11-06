"use client";

import Link from "next/link";
import { useActionState, useMemo, useRef, useState } from "react";
import { Alert, SubmitButton } from "@/app/auth/_components/ui";
import { OptionSearch } from "@/app/_components/option-search";
import { formatMoney } from "@/lib/format";
import { productOptionLabel, rememberOptions } from "@/lib/quotations/form";
import {
  applyProductToPurchaseOrderLine,
  canRestoreRecordedProduct,
  emptyPurchaseOrderLine,
  lineProduct,
  needsUnitPrice,
  previewPurchaseOrder,
  rememberSelectedProduct,
  restoreRecordedProduct,
  serializePurchaseOrderLines,
  vendorOptionDetail,
  vendorOptionLabel,
  type PurchaseOrderFormLine,
  type PurchaseOrderFormValues,
  type PurchaseProductOption,
  type VendorOption,
} from "@/lib/purchase-orders/form";
import type { PurchaseOrderFormState } from "@/lib/purchase-orders/messages";
import { PURCHASE_ORDER_LIMITS, type PurchaseOrderItemErrors } from "@/lib/purchase-orders/validation";
import { searchPurchaseOrderProductsAction, searchPurchaseOrderVendorsAction } from "../actions";

const INPUT =
  "mt-1 block w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-zinc-900 shadow-sm outline-none focus:border-zinc-900 focus:ring-1 focus:ring-zinc-900 aria-invalid:border-red-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:focus:border-zinc-300 dark:focus:ring-zinc-300";
const LABEL = "block text-sm font-medium text-zinc-700 dark:text-zinc-300";
const SMALL_BUTTON =
  "rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium text-zinc-900 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:hover:bg-zinc-800";

type DecimalLineField = "quantity" | "unitPrice" | "discountAmount" | "taxRate";

/**
 * Create / edit form for a purchase order. Same structure and selectors as
 * the invoice form (lib/purchase-orders/form.ts for the line-ID rules): an
 * existing line keeps its ID, also when its product changes; a new line has
 * none; a removed line is not sent. Kept lines show the product details
 * recorded on the order. New selections default to the product's purchase
 * price.
 *
 * The browser sends only user-controlled values and line IDs. The preview
 * uses the Part 1 calculation rules on exact decimal strings; the Server
 * Action validates everything again and the database computes what is saved.
 */
export function PurchaseOrderForm({
  action,
  initialValues,
  currentVendor,
  currentProducts,
  currency,
  submitLabel,
  pendingText,
  cancelHref,
}: {
  action: (state: PurchaseOrderFormState, formData: FormData) => Promise<PurchaseOrderFormState>;
  initialValues: PurchaseOrderFormValues;
  /** The order's vendor as recorded (snapshot), when editing. */
  currentVendor: VendorOption | null;
  /** Current records of the products the lines use (any status), when editing. */
  currentProducts: PurchaseProductOption[];
  currency: string;
  submitLabel: string;
  pendingText: string;
  cancelHref: string;
}) {
  const [state, formAction] = useActionState<PurchaseOrderFormState, FormData>(action, {});
  const [values, setValues] = useState(initialValues);
  const nextKey = useRef(initialValues.lines.length);

  const [knownVendors, setKnownVendors] = useState<ReadonlyMap<string, VendorOption>>(
    () => new Map(currentVendor ? [[currentVendor.id, currentVendor]] : []),
  );
  const [productsById, setProductsById] = useState<ReadonlyMap<string, PurchaseProductOption>>(
    () => new Map(currentProducts.map((p) => [p.id, p])),
  );
  const preview = useMemo(
    () => previewPurchaseOrder(values.lines, productsById),
    [values.lines, productsById],
  );

  const fe = state.fieldErrors ?? {};
  const ie = state.itemErrors ?? {};
  const canAddLine = values.lines.length < PURCHASE_ORDER_LIMITS.maxItems;

  function setHeader(field: Exclude<keyof PurchaseOrderFormValues, "lines">, value: string) {
    setValues((v) => ({ ...v, [field]: value }));
  }

  function updateLine(key: string, change: (line: PurchaseOrderFormLine) => PurchaseOrderFormLine) {
    setValues((v) => ({ ...v, lines: v.lines.map((l) => (l.key === key ? change(l) : l)) }));
  }

  function addLine() {
    if (!canAddLine) return;
    const key = `new-${nextKey.current++}`;
    setValues((v) => ({ ...v, lines: [...v.lines, emptyPurchaseOrderLine(key)] }));
  }

  function removeLine(key: string) {
    setValues((v) => (v.lines.length > 1 ? { ...v, lines: v.lines.filter((l) => l.key !== key) } : v));
  }

  const money = (amount: string) => formatMoney(amount, currency);

  return (
    <form action={formAction} noValidate className="space-y-8">
      {state.error && <Alert kind="error">{state.error}</Alert>}

      <input type="hidden" name="items" value={serializePurchaseOrderLines(values.lines)} />

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="sm:col-span-2">
          <label htmlFor="vendorId" className={LABEL}>
            Vendor
          </label>
          <input type="hidden" name="vendorId" value={values.vendorId} />
          <OptionSearch
            id="vendorId"
            selectedId={values.vendorId}
            selected={currentVendor?.id === values.vendorId ? currentVendor : knownVendors.get(values.vendorId)}
            optionLabel={vendorOptionLabel}
            optionDetail={vendorOptionDetail}
            placeholder="Search vendors by name, company, phone or email"
            unknownLabel="Selected vendor is not available"
            emptyText="No active vendors found."
            search={searchPurchaseOrderVendorsAction}
            onSelect={(vendor) => {
              setKnownVendors((known) => rememberOptions(known, [vendor]));
              setHeader("vendorId", vendor.id);
            }}
            invalid={Boolean(fe.vendorId)}
            describedBy={fe.vendorId ? "vendorId-error" : undefined}
          />
          <FieldError id="vendorId-error" error={fe.vendorId} />
        </div>
        <div>
          <label htmlFor="orderDate" className={LABEL}>
            Order date
          </label>
          <input
            id="orderDate"
            name="orderDate"
            type="date"
            value={values.orderDate}
            onChange={(e) => setHeader("orderDate", e.target.value)}
            aria-invalid={fe.orderDate ? true : undefined}
            aria-describedby={fe.orderDate ? "orderDate-error" : undefined}
            className={INPUT}
          />
          <FieldError id="orderDate-error" error={fe.orderDate} />
        </div>
        <div>
          <label htmlFor="expectedDeliveryDate" className={LABEL}>
            Expected delivery <span className="font-normal text-zinc-500">(optional)</span>
          </label>
          <input
            id="expectedDeliveryDate"
            name="expectedDeliveryDate"
            type="date"
            min={values.orderDate || undefined}
            value={values.expectedDeliveryDate}
            onChange={(e) => setHeader("expectedDeliveryDate", e.target.value)}
            aria-invalid={fe.expectedDeliveryDate ? true : undefined}
            aria-describedby={fe.expectedDeliveryDate ? "expectedDeliveryDate-error" : undefined}
            className={INPUT}
          />
          <FieldError id="expectedDeliveryDate-error" error={fe.expectedDeliveryDate} />
        </div>
      </section>

      <section aria-labelledby="lines-heading" className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="lines-heading" className="text-lg font-semibold">
            Items
          </h2>
          <p className="text-sm text-zinc-500">
            {values.lines.length} of {PURCHASE_ORDER_LIMITS.maxItems}
          </p>
        </div>
        {fe.items && <Alert kind="error">{fe.items}</Alert>}

        <ol className="space-y-4">
          {values.lines.map((line, index) => (
            <LineEditor
              key={line.key}
              index={index}
              line={line}
              errors={ie[line.key] ?? {}}
              product={lineProduct(line, productsById)}
              lineTotal={preview.lines[index]?.lineTotal ?? null}
              money={money}
              currency={currency}
              canRemove={values.lines.length > 1}
              onChange={(change) => updateLine(line.key, change)}
              onSelectProduct={(product) => {
                setProductsById((known) => rememberSelectedProduct(known, product));
                updateLine(line.key, (l) => applyProductToPurchaseOrderLine(l, product));
              }}
              onRemove={() => removeLine(line.key)}
            />
          ))}
        </ol>

        <button type="button" onClick={addLine} disabled={!canAddLine} className={SMALL_BUTTON}>
          + Add line
        </button>
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <div>
          <label htmlFor="notes" className={LABEL}>
            Notes <span className="font-normal text-zinc-500">(optional)</span>
          </label>
          <textarea
            id="notes"
            name="notes"
            rows={4}
            value={values.notes}
            onChange={(e) => setHeader("notes", e.target.value)}
            aria-invalid={fe.notes ? true : undefined}
            aria-describedby={fe.notes ? "notes-error" : undefined}
            className={INPUT}
          />
          <FieldError id="notes-error" error={fe.notes} />
        </div>
        <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4 text-sm dark:border-zinc-800 dark:bg-zinc-900">
          <dl className="space-y-2" aria-live="polite">
            <TotalRow label="Subtotal" value={preview.totals && money(preview.totals.subtotal)} />
            <TotalRow label="Discount total" value={preview.totals && money(preview.totals.discountTotal)} />
            <TotalRow label="Tax total" value={preview.totals && money(preview.totals.taxTotal)} />
            <div className="border-t border-zinc-200 pt-2 dark:border-zinc-700">
              <TotalRow label="Grand total" strong value={preview.totals && money(preview.totals.grandTotal)} />
            </div>
          </dl>
          {preview.incomplete > 0 && (
            <p className="mt-3 text-xs text-amber-700 dark:text-amber-300">
              {preview.incomplete === 1
                ? "1 line is incomplete or invalid and is not included yet."
                : `${preview.incomplete} lines are incomplete or invalid and are not included yet.`}
            </p>
          )}
          <p className="mt-3 text-xs text-zinc-500">
            Preview. The saved amounts are calculated by the server.
          </p>
        </div>
      </section>

      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-end">
        <Link
          href={cancelHref}
          className="text-center text-sm text-zinc-600 underline hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50"
        >
          Cancel
        </Link>
        <div className="sm:w-48">
          <SubmitButton pendingText={pendingText}>{submitLabel}</SubmitButton>
        </div>
      </div>
    </form>
  );
}

function LineEditor({
  index,
  line,
  errors,
  product,
  lineTotal,
  money,
  currency,
  canRemove,
  onChange,
  onSelectProduct,
  onRemove,
}: {
  index: number;
  line: PurchaseOrderFormLine;
  errors: PurchaseOrderItemErrors;
  product: PurchaseProductOption | undefined;
  lineTotal: string | null;
  money: (amount: string) => string;
  currency: string;
  canRemove: boolean;
  onChange: (change: (line: PurchaseOrderFormLine) => PurchaseOrderFormLine) => void;
  onSelectProduct: (product: PurchaseProductOption) => void;
  onRemove: () => void;
}) {
  const id = (field: string) => `${line.key}-${field}`;
  const set = (field: "description" | DecimalLineField) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      const value = e.target.value;
      onChange((l) => ({ ...l, [field]: value }));
    };
  const priceRequired = needsUnitPrice(line, product);

  const decimal = (field: DecimalLineField, label: string, placeholder: string, hint?: string) => {
    const describedBy = [errors[field] && id(`${field}-error`), hint && id(`${field}-hint`)]
      .filter(Boolean)
      .join(" ");
    return (
      <div>
        <label htmlFor={id(field)} className={LABEL}>
          {label}
        </label>
        <input
          id={id(field)}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          placeholder={placeholder}
          value={line[field]}
          onChange={set(field)}
          aria-invalid={errors[field] ? true : undefined}
          aria-describedby={describedBy || undefined}
          className={`${INPUT} text-right tabular-nums`}
        />
        {hint && !errors[field] && (
          <p id={id(`${field}-hint`)} className="mt-1 text-xs text-amber-700 dark:text-amber-300">
            {hint}
          </p>
        )}
        <FieldError id={id(`${field}-error`)} error={errors[field]} />
      </div>
    );
  };

  return (
    <li className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="text-sm font-medium text-zinc-500">Line {index + 1}</p>
        <button
          type="button"
          onClick={onRemove}
          disabled={!canRemove}
          className="text-sm text-red-600 underline hover:text-red-800 disabled:cursor-not-allowed disabled:no-underline disabled:opacity-40"
          aria-label={`Remove line ${index + 1}`}
        >
          Remove
        </button>
      </div>
      <FieldError id={id("lineId-error")} error={errors.lineId} />

      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          <label htmlFor={id("productId")} className={LABEL}>
            Product / service
          </label>
          <OptionSearch
            id={id("productId")}
            selectedId={line.productId}
            selected={product}
            optionLabel={productOptionLabel}
            placeholder="Search products by name, SKU or category"
            unknownLabel="Selected product is not available"
            emptyText="No active products found."
            search={searchPurchaseOrderProductsAction}
            onSelect={onSelectProduct}
            invalid={Boolean(errors.productId)}
            describedBy={errors.productId ? id("productId-error") : undefined}
          />
          <FieldError id={id("productId-error")} error={errors.productId} />
          {canRestoreRecordedProduct(line) && (
            <button
              type="button"
              onClick={() => onChange(restoreRecordedProduct)}
              className={`${SMALL_BUTTON} mt-2`}
            >
              Restore recorded product
            </button>
          )}
        </div>
        <div>
          <label htmlFor={id("description")} className={LABEL}>
            Description <span className="font-normal text-zinc-500">(optional)</span>
          </label>
          <textarea
            id={id("description")}
            rows={2}
            value={line.description}
            onChange={set("description")}
            aria-invalid={errors.description ? true : undefined}
            aria-describedby={errors.description ? id("description-error") : undefined}
            className={INPUT}
          />
          <FieldError id={id("description-error")} error={errors.description} />
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        {decimal("quantity", "Quantity", "1")}
        <div>
          <p className={LABEL}>Unit</p>
          <p className="mt-1 py-2 text-zinc-700 dark:text-zinc-300">{product?.unit ?? "—"}</p>
        </div>
        {decimal(
          "unitPrice",
          `Unit price (${currency})`,
          product ? (product.purchasePrice ?? "Required") : "0.00",
          priceRequired ? "No purchase price on this product. Enter a unit price." : undefined,
        )}
        {decimal("discountAmount", "Discount", "0.00")}
        {decimal("taxRate", "Tax rate (%)", "0")}
        <div>
          <p className={LABEL}>Line total</p>
          <p className="mt-1 py-2 text-right font-medium tabular-nums">
            {lineTotal !== null ? money(lineTotal) : "—"}
          </p>
        </div>
      </div>
    </li>
  );
}

function TotalRow({ label, value, strong }: { label: string; value: string | null; strong?: boolean }) {
  return (
    <div className={`flex justify-between gap-4 ${strong ? "text-base font-semibold" : ""}`}>
      <dt className={strong ? undefined : "text-zinc-600 dark:text-zinc-400"}>{label}</dt>
      <dd className="tabular-nums">{value ?? "—"}</dd>
    </div>
  );
}

function FieldError({ id, error }: { id: string; error?: string }) {
  if (!error) return null;
  return (
    <p id={id} className="mt-1 text-sm text-red-600">
      {error}
    </p>
  );
}
