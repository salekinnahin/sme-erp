"use client";

import Link from "next/link";
import { useActionState, useMemo, useRef, useState } from "react";
import { Alert, SubmitButton } from "@/app/auth/_components/ui";
import { formatMoney } from "@/lib/format";
import {
  applyProductToLine,
  customerOptionDetail,
  customerOptionLabel,
  emptyLine,
  previewQuotation,
  productOptionLabel,
  rememberOptions,
  serializeLines,
  type CustomerOption,
  type ProductOption,
  type QuotationFormLine,
  type QuotationFormValues,
} from "@/lib/quotations/form";
import type { QuotationFormState } from "@/lib/quotations/messages";
import { QUOTATION_LIMITS, type QuotationItemErrors } from "@/lib/quotations/validation";
import { searchQuotationCustomersAction, searchQuotationProductsAction } from "../actions";
import { OptionSearch } from "@/app/_components/option-search";

const INPUT =
  "mt-1 block w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-zinc-900 shadow-sm outline-none focus:border-zinc-900 focus:ring-1 focus:ring-zinc-900 aria-invalid:border-red-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:focus:border-zinc-300 dark:focus:ring-zinc-300";
const LABEL = "block text-sm font-medium text-zinc-700 dark:text-zinc-300";
const SMALL_BUTTON =
  "rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium text-zinc-900 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:hover:bg-zinc-800";

type DecimalLineField = "quantity" | "unitPrice" | "discountAmount" | "taxRate";

/**
 * Create / edit form for a quotation. All fields are controlled, so React's
 * form reset after an action never clears the lines.
 *
 * Customers and products are chosen with a server-side search (active
 * records only, a small page per search). The current customer and the
 * lines' current products are passed in by the page (fetched by ID, even if
 * inactive) and kept in `known*` state together with every record chosen
 * since, so a search never clears or swaps a selection.
 *
 * The browser sends only user-controlled values (see serializeLines()). The
 * preview uses the Part 1 calculation rules on exact decimal strings; the
 * Server Action validates everything again and the database computes the
 * amounts that are saved.
 */
export function QuotationForm({
  action,
  initialValues,
  currentCustomer,
  currentProducts,
  currency,
  submitLabel,
  pendingText,
  cancelHref,
}: {
  action: (state: QuotationFormState, formData: FormData) => Promise<QuotationFormState>;
  initialValues: QuotationFormValues;
  /** The quotation's current customer (any status), when editing. */
  currentCustomer: CustomerOption | null;
  /** The products the lines already use (any status), when editing. */
  currentProducts: ProductOption[];
  currency: string;
  submitLabel: string;
  pendingText: string;
  cancelHref: string;
}) {
  const [state, formAction] = useActionState<QuotationFormState, FormData>(action, {});
  const [values, setValues] = useState(initialValues);
  const nextKey = useRef(initialValues.lines.length);

  const [knownCustomers, setKnownCustomers] = useState<ReadonlyMap<string, CustomerOption>>(
    () => new Map(currentCustomer ? [[currentCustomer.id, currentCustomer]] : []),
  );
  const [productsById, setProductsById] = useState<ReadonlyMap<string, ProductOption>>(
    () => new Map(currentProducts.map((p) => [p.id, p])),
  );
  const preview = useMemo(
    () => previewQuotation(values.lines, productsById),
    [values.lines, productsById],
  );

  const fe = state.fieldErrors ?? {};
  const ie = state.itemErrors ?? {};
  const canAddLine = values.lines.length < QUOTATION_LIMITS.maxItems;

  function setHeader(field: Exclude<keyof QuotationFormValues, "lines">, value: string) {
    setValues((v) => ({ ...v, [field]: value }));
  }

  function updateLine(key: string, change: (line: QuotationFormLine) => QuotationFormLine) {
    setValues((v) => ({ ...v, lines: v.lines.map((l) => (l.key === key ? change(l) : l)) }));
  }

  function addLine() {
    if (!canAddLine) return;
    const key = `new-${nextKey.current++}`;
    setValues((v) => ({ ...v, lines: [...v.lines, emptyLine(key)] }));
  }

  function removeLine(key: string) {
    setValues((v) => (v.lines.length > 1 ? { ...v, lines: v.lines.filter((l) => l.key !== key) } : v));
  }

  const money = (amount: string) => formatMoney(amount, currency);

  return (
    <form action={formAction} noValidate className="space-y-8">
      {state.error && <Alert kind="error">{state.error}</Alert>}

      <input type="hidden" name="items" value={serializeLines(values.lines)} />

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="sm:col-span-2">
          <label htmlFor="customerId" className={LABEL}>
            Customer
          </label>
          <input type="hidden" name="customerId" value={values.customerId} />
          <OptionSearch
            id="customerId"
            selectedId={values.customerId}
            selected={knownCustomers.get(values.customerId)}
            optionLabel={customerOptionLabel}
            optionDetail={customerOptionDetail}
            placeholder="Search customers by name, company, phone or email"
            unknownLabel="Selected customer is not available"
            emptyText="No active customers found."
            search={searchQuotationCustomersAction}
            onSelect={(customer) => {
              setKnownCustomers((known) => rememberOptions(known, [customer]));
              setHeader("customerId", customer.id);
            }}
            invalid={Boolean(fe.customerId)}
            describedBy={fe.customerId ? "customerId-error" : undefined}
          />
          <FieldError id="customerId-error" error={fe.customerId} />
        </div>
        <div>
          <label htmlFor="quotationDate" className={LABEL}>
            Quotation date
          </label>
          <input
            id="quotationDate"
            name="quotationDate"
            type="date"
            value={values.quotationDate}
            onChange={(e) => setHeader("quotationDate", e.target.value)}
            aria-invalid={fe.quotationDate ? true : undefined}
            aria-describedby={fe.quotationDate ? "quotationDate-error" : undefined}
            className={INPUT}
          />
          <FieldError id="quotationDate-error" error={fe.quotationDate} />
        </div>
        <div>
          <label htmlFor="expiryDate" className={LABEL}>
            Expiry date <span className="font-normal text-zinc-500">(optional)</span>
          </label>
          <input
            id="expiryDate"
            name="expiryDate"
            type="date"
            min={values.quotationDate || undefined}
            value={values.expiryDate}
            onChange={(e) => setHeader("expiryDate", e.target.value)}
            aria-invalid={fe.expiryDate ? true : undefined}
            aria-describedby={fe.expiryDate ? "expiryDate-error" : undefined}
            className={INPUT}
          />
          <FieldError id="expiryDate-error" error={fe.expiryDate} />
        </div>
      </section>

      <section aria-labelledby="lines-heading" className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="lines-heading" className="text-lg font-semibold">
            Items
          </h2>
          <p className="text-sm text-zinc-500">
            {values.lines.length} of {QUOTATION_LIMITS.maxItems}
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
              product={productsById.get(line.productId)}
              lineTotal={preview.lines[index]?.lineTotal ?? null}
              money={money}
              currency={currency}
              canRemove={values.lines.length > 1}
              onChange={(change) => updateLine(line.key, change)}
              onSelectProduct={(product) => {
                setProductsById((known) => rememberOptions(known, [product]));
                updateLine(line.key, (l) => applyProductToLine(l, product));
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
  line: QuotationFormLine;
  errors: QuotationItemErrors;
  product: ProductOption | undefined;
  lineTotal: string | null;
  money: (amount: string) => string;
  currency: string;
  canRemove: boolean;
  onChange: (change: (line: QuotationFormLine) => QuotationFormLine) => void;
  onSelectProduct: (product: ProductOption) => void;
  onRemove: () => void;
}) {
  const id = (field: string) => `${line.key}-${field}`;
  const set = (field: Exclude<keyof QuotationFormLine, "key" | "productId">) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      const value = e.target.value;
      onChange((l) => ({ ...l, [field]: value }));
    };

  const decimal = (field: DecimalLineField, label: string, placeholder: string) => (
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
        aria-describedby={errors[field] ? id(`${field}-error`) : undefined}
        className={`${INPUT} text-right tabular-nums`}
      />
      <FieldError id={id(`${field}-error`)} error={errors[field]} />
    </div>
  );

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
            placeholder="Search products by name or SKU"
            unknownLabel="Selected product is not available"
            emptyText="No active products found."
            search={searchQuotationProductsAction}
            onSelect={onSelectProduct}
            invalid={Boolean(errors.productId)}
            describedBy={errors.productId ? id("productId-error") : undefined}
          />
          <FieldError id={id("productId-error")} error={errors.productId} />
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
        {decimal("unitPrice", `Unit price (${currency})`, product?.sellingPrice ?? "0.00")}
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
