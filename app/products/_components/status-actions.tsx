"use client";

import { ConfirmDialog } from "@/app/_components/confirm-dialog";
import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { Alert } from "@/app/auth/_components/ui";
import type { ProductStatus } from "@/lib/products/validation";
import { setProductStatusAction, type StatusState } from "../actions";

const BUTTON = "ui-button";
const SECONDARY = `${BUTTON} ui-button-secondary`;
const DANGER = `${BUTTON} ui-button-danger`;

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
    <div data-confirm-scope className="space-y-2">
      {state.error && !confirming && <Alert kind="error">{state.error}</Alert>}
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
            <ConfirmDialog
              title="Deactivate product"
              description={
                <p id="deactivate-title" className="text-red-800 dark:text-red-200">
                  Deactivate <strong>{productName}</strong>? The product and its
                  details are kept, and you can reactivate it later.
                </p>
              }
              onClose={() => setConfirming(false)}
            >
              {state.error && <Alert kind="error">{state.error}</Alert>}
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
            </ConfirmDialog>
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
