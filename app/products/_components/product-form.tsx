"use client";

import { FormSection } from "@/app/_components/ui";
import Link from "next/link";
import { useActionState, useState } from "react";
import { Alert, Field, SubmitButton, TextArea } from "@/app/auth/_components/ui";
import {
  PRODUCT_TYPES,
  PRODUCT_TYPE_LABELS,
  PRODUCT_UNITS,
  PRODUCT_UNIT_LABELS,
  hasReorderLevel,
  isProductType,
  type ProductRawInput,
} from "@/lib/products/validation";
import type { ProductCategory } from "@/lib/products/categories";
import type { ProductFormState } from "../actions";

const EMPTY: ProductRawInput = {
  name: "",
  sku: "",
  productType: "inventory",
  categoryId: "",
  unit: "pcs",
  description: "",
  purchasePrice: "",
  sellingPrice: "",
  reorderLevel: "",
};

const INPUT = "ui-input mt-1";
const LABEL = "ui-label";

/**
 * Create / edit form. The Server Action validates everything again; this
 * component only collects input. The submit button is disabled while the
 * action runs, which also blocks implicit (Enter key) resubmission.
 *
 * Text fields have no HTML maxLength (browsers count UTF-16 code units, the
 * server counts code points). The reorder level is only shown, and only
 * kept, for inventory products.
 */
export function ProductForm({
  action,
  initialValues,
  categories,
  currency,
  canManageCategories,
  submitLabel,
  pendingText,
  cancelHref,
}: {
  action: (state: ProductFormState, formData: FormData) => Promise<ProductFormState>;
  initialValues?: ProductRawInput;
  /** Categories that may be chosen: active ones, plus the current one. */
  categories: ProductCategory[];
  currency: string;
  /** Owners and managers may add categories; others only view them. */
  canManageCategories: boolean;
  submitLabel: string;
  pendingText: string;
  cancelHref: string;
}) {
  const [state, formAction] = useActionState<ProductFormState, FormData>(
    action,
    {},
  );
  const fe = state.fieldErrors ?? {};
  // After a failed submit, React resets the form to these defaults, so echo
  // the submitted values back.
  const v = state.values ?? initialValues ?? EMPTY;
  const [productType, setProductType] = useState(v.productType);

  return (
    <form action={formAction} noValidate className="space-y-4">
      {state.error && <Alert kind="error">{state.error}</Alert>}
      <FormSection title="Product information">
      <Field label="Product name" name="name" defaultValue={v.name} error={fe.name} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="SKU"
          name="sku"
          autoComplete="off"
          defaultValue={v.sku}
          error={fe.sku}
        />
        <SelectField
          label="Product type"
          name="productType"
          value={productType}
          onChange={(value) => {
            if (isProductType(value)) setProductType(value);
          }}
          options={PRODUCT_TYPES.map((t) => ({ value: t, label: PRODUCT_TYPE_LABELS[t] }))}
          error={fe.productType}
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <SelectField
            label="Category"
            name="categoryId"
            optional
            defaultValue={v.categoryId}
            options={[
              { value: "", label: "No category" },
              ...categories.map((c) => ({
                value: c.id,
                label: c.status === "inactive" ? `${c.name} (inactive)` : c.name,
              })),
            ]}
            error={fe.categoryId}
          />
          <Link
            href="/products/categories"
            className="mt-1 inline-block text-xs text-zinc-600 underline hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50"
          >
            {canManageCategories ? "Add or manage categories" : "View categories"}
          </Link>
        </div>
        <SelectField
          label="Unit"
          name="unit"
          defaultValue={v.unit}
          options={PRODUCT_UNITS.map((u) => ({ value: u, label: PRODUCT_UNIT_LABELS[u] }))}
          error={fe.unit}
        />
      </div>
      </FormSection>
      <FormSection title="Pricing and reorder level">
      <div className="grid gap-4 sm:grid-cols-2">
        <DecimalField
          label={`Purchase price (${currency})`}
          name="purchasePrice"
          defaultValue={v.purchasePrice}
          error={fe.purchasePrice}
        />
        <DecimalField
          label={`Selling price (${currency})`}
          name="sellingPrice"
          defaultValue={v.sellingPrice}
          error={fe.sellingPrice}
        />
      </div>
      {isProductType(productType) && hasReorderLevel(productType) && (
        <DecimalField
          label="Reorder level"
          name="reorderLevel"
          defaultValue={v.reorderLevel}
          error={fe.reorderLevel}
          placeholder="0"
          hint="Stock level at which to reorder. Leave blank for 0. Stock tracking comes later."
        />
      )}
      </FormSection>
      <FormSection title="Description">
      <TextArea
        label="Description"
        name="description"
        rows={4}
        required={false}
        defaultValue={v.description}
        error={fe.description}
      />
      </FormSection>
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

function SelectField({
  label,
  name,
  options,
  value,
  defaultValue,
  onChange,
  optional,
  error,
}: {
  label: string;
  name: string;
  options: { value: string; label: string }[];
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  optional?: boolean;
  error?: string;
}) {
  const errorId = `${name}-error`;
  return (
    <div>
      <label htmlFor={name} className={LABEL}>
        {label}
        {optional && <span className="font-normal text-zinc-500"> (optional)</span>}
      </label>
      <select
        id={name}
        name={name}
        value={value}
        defaultValue={value === undefined ? defaultValue : undefined}
        onChange={onChange ? (e) => onChange(e.target.value) : undefined}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        className={INPUT}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {error && (
        <p id={errorId} className="mt-1 text-sm text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}

function DecimalField({
  label,
  name,
  defaultValue,
  error,
  hint,
  placeholder = "0.00",
}: {
  label: string;
  name: string;
  defaultValue?: string;
  error?: string;
  hint?: string;
  placeholder?: string;
}) {
  const errorId = `${name}-error`;
  const hintId = `${name}-hint`;
  const describedBy = [hint && hintId, error && errorId].filter(Boolean).join(" ");
  return (
    <div>
      <label htmlFor={name} className={LABEL}>
        {label}
        <span className="font-normal text-zinc-500"> (optional)</span>
      </label>
      <input
        id={name}
        name={name}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        placeholder={placeholder}
        defaultValue={defaultValue}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy || undefined}
        className={INPUT}
      />
      {hint && (
        <p id={hintId} className="mt-1 text-xs text-zinc-500">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="mt-1 text-sm text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}
