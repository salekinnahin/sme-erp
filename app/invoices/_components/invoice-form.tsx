"use client";

import { FormSection, MoneySummary } from "@/app/_components/ui";
import Link from "next/link";
import { useActionState, useMemo, useRef, useState } from "react";
import { Alert, SubmitButton } from "@/app/auth/_components/ui";
import { OptionSearch } from "@/app/_components/option-search";
import { formatMoney } from "@/lib/format";
import {
  customerOptionDetail,
  customerOptionLabel,
  productOptionLabel,
  rememberOptions,
  type CustomerOption,
  type ProductOption,
} from "@/lib/quotations/form";
import {
  applyProductToInvoiceLine,
  canRestoreRecordedProduct,
  emptyInvoiceLine,
  lineProduct,
  previewInvoice,
  restoreRecordedProduct,
  serializeInvoiceLines,
  type InvoiceFormLine,
  type InvoiceFormValues,
} from "@/lib/invoices/form";
import type { InvoiceFormState } from "@/lib/invoices/messages";
import { INVOICE_LIMITS, type InvoiceItemErrors } from "@/lib/invoices/validation";
import { searchInvoiceCustomersAction, searchInvoiceProductsAction } from "../actions";

const INPUT = "ui-input mt-1";
const LABEL = "ui-label";
const SMALL_BUTTON = "ui-button ui-button-secondary";

type DecimalLineField = "quantity" | "unitPrice" | "discountAmount" | "taxRate";

/**
 * Create / edit form for an invoice. Same structure and selector as the
 * quotation form; differences are the header dates and the line IDs of an
 * edited draft (lib/invoices/form.ts): an existing line keeps its ID,
 * also when its product changes; a new line has none; a removed line is not
 * sent. Kept lines show the product details recorded on the invoice.
 *
 * The browser sends only user-controlled values and line IDs. The preview
 * uses the Part 1 calculation rules on exact decimal strings; the Server
 * Action validates everything again and the database computes what is saved.
 */
export function InvoiceForm({
  action,
  initialValues,
  currentCustomer,
  currentProducts,
  currency,
  submitLabel,
  pendingText,
  cancelHref,
}: {
  action: (state: InvoiceFormState, formData: FormData) => Promise<InvoiceFormState>;
  initialValues: InvoiceFormValues;
  /** The invoice's customer as recorded (snapshot), when editing. */
  currentCustomer: CustomerOption | null;
  /** Current records of the products the lines use (any status), when editing. */
  currentProducts: ProductOption[];
  currency: string;
  submitLabel: string;
  pendingText: string;
  cancelHref: string;
}) {
  const [state, formAction] = useActionState<InvoiceFormState, FormData>(action, {});
  const [values, setValues] = useState(initialValues);
  const nextKey = useRef(initialValues.lines.length);

  const [knownCustomers, setKnownCustomers] = useState<ReadonlyMap<string, CustomerOption>>(
    () => new Map(currentCustomer ? [[currentCustomer.id, currentCustomer]] : []),
  );
  const [productsById, setProductsById] = useState<ReadonlyMap<string, ProductOption>>(
    () => new Map(currentProducts.map((p) => [p.id, p])),
  );
  const preview = useMemo(
    () => previewInvoice(values.lines, productsById),
    [values.lines, productsById],
  );

  const fe = state.fieldErrors ?? {};
  const ie = state.itemErrors ?? {};
  const canAddLine = values.lines.length < INVOICE_LIMITS.maxItems;

  function setHeader(field: Exclude<keyof InvoiceFormValues, "lines">, value: string) {
    setValues((v) => ({ ...v, [field]: value }));
  }

  function updateLine(key: string, change: (line: InvoiceFormLine) => InvoiceFormLine) {
    setValues((v) => ({ ...v, lines: v.lines.map((l) => (l.key === key ? change(l) : l)) }));
  }

  function addLine() {
    if (!canAddLine) return;
    const key = `new-${nextKey.current++}`;
    setValues((v) => ({ ...v, lines: [...v.lines, emptyInvoiceLine(key)] }));
  }

  function removeLine(key: string) {
    setValues((v) => (v.lines.length > 1 ? { ...v, lines: v.lines.filter((l) => l.key !== key) } : v));
  }

  const money = (amount: string) => formatMoney(amount, currency);

  return (
    <form action={formAction} noValidate className="document-form space-y-5">
      {state.error && <Alert kind="error">{state.error}</Alert>}

      <input type="hidden" name="items" value={serializeInvoiceLines(values.lines)} />

      <div className="form-main space-y-5">
      <FormSection title="Basic information" className="form-header"><div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label htmlFor="customerId" className={LABEL}>
            Customer
          </label>
          <input type="hidden" name="customerId" value={values.customerId} />
          <OptionSearch
            id="customerId"
            selectedId={values.customerId}
            selected={currentCustomer?.id === values.customerId ? currentCustomer : knownCustomers.get(values.customerId)}
            optionLabel={customerOptionLabel}
            optionDetail={customerOptionDetail}
            placeholder="Search customers by name, company, phone or email"
            unknownLabel="Selected customer is not available"
            emptyText="No active customers found."
            search={searchInvoiceCustomersAction}
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
          <label htmlFor="invoiceDate" className={LABEL}>
            Invoice date
          </label>
          <input
            id="invoiceDate"
            name="invoiceDate"
            type="date"
            value={values.invoiceDate}
            onChange={(e) => setHeader("invoiceDate", e.target.value)}
            aria-invalid={fe.invoiceDate ? true : undefined}
            aria-describedby={fe.invoiceDate ? "invoiceDate-error" : undefined}
            className={INPUT}
          />
          <FieldError id="invoiceDate-error" error={fe.invoiceDate} />
        </div>
        <div>
          <label htmlFor="dueDate" className={LABEL}>
            Due date <span className="font-normal text-zinc-500">(optional)</span>
          </label>
          <input
            id="dueDate"
            name="dueDate"
            type="date"
            min={values.invoiceDate || undefined}
            value={values.dueDate}
            onChange={(e) => setHeader("dueDate", e.target.value)}
            aria-invalid={fe.dueDate ? true : undefined}
            aria-describedby={fe.dueDate ? "dueDate-error" : undefined}
            className={INPUT}
          />
          <FieldError id="dueDate-error" error={fe.dueDate} />
        </div>
      </div></FormSection>

      <section aria-labelledby="lines-heading" className="form-lines space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="lines-heading" className="text-lg font-semibold">
            Items
          </h2>
          <p className="text-sm text-zinc-500">
            {values.lines.length} of {INVOICE_LIMITS.maxItems}
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
                setProductsById((known) => rememberOptions(known, [product]));
                updateLine(line.key, (l) => applyProductToInvoiceLine(l, product));
              }}
              onRemove={() => removeLine(line.key)}
            />
          ))}
        </ol>

        <button type="button" onClick={addLine} disabled={!canAddLine} className={SMALL_BUTTON + " add-line"}>
          + Add line
        </button>
      </section>

      </div>
      <aside className="form-summary space-y-5" aria-label="Document preview and notes"><div aria-live="polite"><MoneySummary title="Draft summary" rows={[
          { label: "Subtotal", value: preview.totals && money(preview.totals.subtotal) },
          { label: "Discount", value: preview.totals && money(preview.totals.discountTotal) },
          { label: "Tax", value: preview.totals && money(preview.totals.taxTotal) },
        ]} total={preview.totals && money(preview.totals.grandTotal)} footer={<><dl className="mt-4 space-y-3 border-t border-border pt-4"><div className="money-row"><dt>Amount paid</dt><dd>{money("0.00")}</dd></div><div className="money-row"><dt>Amount due</dt><dd>{preview.totals ? money(preview.totals.grandTotal) : "—"}</dd></div></dl>{preview.incomplete > 0 && (
            <p className="mt-3 text-xs text-amber-700 dark:text-amber-300">
              {preview.incomplete === 1
                ? "1 line is incomplete or invalid and is not included yet."
                : `${preview.incomplete} lines are incomplete or invalid and are not included yet.`}
            </p>
          )}
          <p className="mt-3 text-xs text-zinc-500">
            Preview. The saved amounts are calculated by the server.
          </p>
        </>} /></div><FormSection title="Notes">
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
        </FormSection></aside>

      <div className="form-actions">
        <Link
          href={cancelHref}
          className="ui-button ui-button-secondary"
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
  line: InvoiceFormLine;
  errors: InvoiceItemErrors;
  product: ProductOption | undefined;
  lineTotal: string | null;
  money: (amount: string) => string;
  currency: string;
  canRemove: boolean;
  onChange: (change: (line: InvoiceFormLine) => InvoiceFormLine) => void;
  onSelectProduct: (product: ProductOption) => void;
  onRemove: () => void;
}) {
  const id = (field: string) => `${line.key}-${field}`;
  const set = (field: "description" | DecimalLineField) =>
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
    <li className="line-editor">
      <div className="line-editor-head">
        <p className="text-sm font-medium text-zinc-500">Line {index + 1}</p>
        <button
          type="button"
          onClick={onRemove}
          disabled={!canRemove}
          className="ui-button text-red-700 hover:bg-red-50 disabled:opacity-40"
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
            placeholder="Search products by name or SKU"
            unknownLabel="Selected product is not available"
            emptyText="No active products found."
            search={searchInvoiceProductsAction}
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

function FieldError({ id, error }: { id: string; error?: string }) {
  if (!error) return null;
  return (
    <p id={id} className="mt-1 text-sm text-red-600">
      {error}
    </p>
  );
}
