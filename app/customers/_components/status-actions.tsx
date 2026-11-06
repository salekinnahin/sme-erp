"use client";

import { ConfirmDialog } from "@/app/_components/confirm-dialog";
import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { Alert } from "@/app/auth/_components/ui";
import type { CustomerStatus } from "@/lib/customers/validation";
import { setCustomerStatusAction, type CustomerStatusState } from "../actions";

const BUTTON = "ui-button";
const SECONDARY = `${BUTTON} ui-button-secondary`;
const DANGER = `${BUTTON} ui-button-danger`;

/**
 * Deactivate (with confirmation) or reactivate a customer. Only rendered for
 * roles that may change status; the Server Action and the database check the
 * role again.
 */
export function StatusActions({
  customerId,
  customerName,
  status,
}: {
  customerId: string;
  customerName: string;
  status: CustomerStatus;
}) {
  const [state, action] = useActionState<CustomerStatusState, FormData>(
    setCustomerStatusAction,
    {},
  );
  const [confirming, setConfirming] = useState(false);
  const target: CustomerStatus = status === "active" ? "inactive" : "active";

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
          <input type="hidden" name="customerId" value={customerId} />
          <input type="hidden" name="status" value={target} />
          {target === "inactive" ? (
            <ConfirmDialog
              title="Deactivate customer"
              description={
                <p id="deactivate-title" className="text-red-800 dark:text-red-200">
                  Deactivate <strong>{customerName}</strong>? The customer and
                  their history are kept, and you can reactivate them later.
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
