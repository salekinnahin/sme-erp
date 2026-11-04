"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { Alert } from "@/app/auth/_components/ui";
import type { ProductStatus } from "@/lib/products/validation";
import { setProductStatusAction, type StatusState } from "../actions";

const BUTTON =
  "rounded-md px-3 py-1.5 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-60";
const SECONDARY = `${BUTTON} border border-zinc-300 bg-white text-zinc-900 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:hover:bg-zinc-800`;
const DANGER = `${BUTTON} bg-red-600 text-white hover:bg-red-700`;

/**
 * Deactivate (with confirmation) or reactivate a product. Only rendered for
 * roles that may change status; the Server Action and the database check the
 * role again.
 */
export function StatusActions({
  productId,
  productName,
  status,
}: {
  productId: string;
  productName: string;
  status: ProductStatus;
}) {
  const [state, action] = useActionState<StatusState, FormData>(
    setProductStatusAction,
    {},
  );
  const [confirming, setConfirming] = useState(false);
  const target: ProductStatus = status === "active" ? "inactive" : "active";

  return (
    <div className="space-y-2">
      {state.error && <Alert kind="error">{state.error}</Alert>}
      {status === "active" && !confirming ? (
        <button
          type="button"
          className={SECONDARY}
          onClick={() => setConfirming(true)}
        >
          Deactivate
        </button>
      ) : (
        <form action={action} className="space-y-2">
          <input type="hidden" name="productId" value={productId} />
          <input type="hidden" name="status" value={target} />
          {target === "inactive" ? (
            <div
              role="alertdialog"
              aria-labelledby="deactivate-title"
              className="space-y-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm dark:border-red-900 dark:bg-red-950"
            >
              <p id="deactivate-title" className="text-red-800 dark:text-red-200">
                Deactivate <strong>{productName}</strong>? The product and its
                details are kept, and you can reactivate it later.
              </p>
              <div className="flex gap-2">
                <ConfirmButton className={DANGER} pendingText="Deactivating…">
                  Yes, deactivate
                </ConfirmButton>
                <button
                  type="button"
                  className={SECONDARY}
                  onClick={() => setConfirming(false)}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <ConfirmButton className={SECONDARY} pendingText="Reactivating…">
              Reactivate
            </ConfirmButton>
          )}
        </form>
      )}
    </div>
  );
}

function ConfirmButton({
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
    <button
      type="submit"
      disabled={pending}
      aria-disabled={pending}
      className={className}
    >
      {pending ? pendingText : children}
    </button>
  );
}
