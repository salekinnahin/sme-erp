"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { Alert } from "@/app/auth/_components/ui";
import type { ProductStatus } from "@/lib/products/validation";
import {
  createCategoryAction,
  renameCategoryAction,
  setCategoryStatusAction,
  type CategoryFormState,
  type StatusState,
} from "../actions";

const INPUT = "ui-input";
const BUTTON = "ui-button";
const PRIMARY = `${BUTTON} ui-button-primary`;
const SECONDARY = `${BUTTON} ui-button-secondary`;

/** Adds a category. The form clears after a successful save. */
export function AddCategoryForm() {
  const [state, action] = useActionState<CategoryFormState, FormData>(
    createCategoryAction,
    {},
  );
  return (
    <form action={action} noValidate className="space-y-2">
      {state.error && <Alert kind="error">{state.error}</Alert>}
      {state.saved && <Alert kind="success">Category added.</Alert>}
      <label htmlFor="new-category" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
        New category
      </label>
      <div className="flex gap-2">
        <input
          id="new-category"
          name="name"
          autoComplete="off"
          defaultValue={state.name}
          aria-invalid={state.nameError ? true : undefined}
          aria-describedby={state.nameError ? "new-category-error" : undefined}
          className={INPUT}
        />
        <Submit className={PRIMARY} pendingText="Adding…">
          Add
        </Submit>
      </div>
      {state.nameError && (
        <p id="new-category-error" className="text-sm text-red-600">
          {state.nameError}
        </p>
      )}
    </form>
  );
}

/** Shows a category name with an inline rename form. */
export function CategoryName({
  categoryId,
  name,
  canRename,
}: {
  categoryId: string;
  name: string;
  canRename: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [state, action] = useActionState<CategoryFormState, FormData>(
    async (prev, formData) => {
      const next = await renameCategoryAction(categoryId, prev, formData);
      if (next.saved) setEditing(false);
      return next;
    },
    {},
  );
  const errorId = `rename-${categoryId}-error`;

  if (!editing) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <span className="font-medium break-all">{name}</span>
        {canRename && (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="text-xs text-zinc-600 underline hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50"
          >
            Rename
          </button>
        )}
      </div>
    );
  }

  return (
    <form action={action} noValidate className="space-y-2">
      {state.error && <Alert kind="error">{state.error}</Alert>}
      <div className="flex flex-wrap gap-2">
        <input
          name="name"
          aria-label="Category name"
          autoComplete="off"
          defaultValue={state.name ?? name}
          aria-invalid={state.nameError ? true : undefined}
          aria-describedby={state.nameError ? errorId : undefined}
          className={`${INPUT} min-w-0 flex-1`}
        />
        <Submit className={PRIMARY} pendingText="Saving…">
          Save
        </Submit>
        <button type="button" className={SECONDARY} onClick={() => setEditing(false)}>
          Cancel
        </button>
      </div>
      {state.nameError && (
        <p id={errorId} className="text-sm text-red-600">
          {state.nameError}
        </p>
      )}
    </form>
  );
}

/** Deactivate / reactivate. Only rendered for owners and managers; the
 *  Server Action and the database check the role again. */
export function CategoryStatusButton({
  categoryId,
  status,
}: {
  categoryId: string;
  status: ProductStatus;
}) {
  const [state, action] = useActionState<StatusState, FormData>(
    setCategoryStatusAction,
    {},
  );
  const target: ProductStatus = status === "active" ? "inactive" : "active";
  return (
    <form action={action} className="space-y-2">
      {state.error && <Alert kind="error">{state.error}</Alert>}
      <input type="hidden" name="categoryId" value={categoryId} />
      <input type="hidden" name="status" value={target} />
      <Submit
        className={SECONDARY}
        pendingText={target === "inactive" ? "Deactivating…" : "Reactivating…"}
      >
        {target === "inactive" ? "Deactivate" : "Reactivate"}
      </Submit>
    </form>
  );
}

function Submit({
  className,
  pendingText,
  children,
}: {
  className: string;
  pendingText: string;
  children: React.ReactNode;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} aria-disabled={pending} className={className}>
      {pending ? pendingText : children}
    </button>
  );
}
