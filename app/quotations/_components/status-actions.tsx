"use client";

import { ConfirmDialog } from "@/app/_components/confirm-dialog";
import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { Alert } from "@/app/auth/_components/ui";
import type { QuotationStatus } from "@/lib/quotations/validation";
import type { StatusAction, StatusActionTone } from "@/lib/quotations/status-actions";
import { setQuotationStatusAction, type StatusState } from "../actions";

const BUTTON = "ui-button";
const TONES: Record<StatusActionTone, string> = {
  primary: `${BUTTON} ui-button-primary`,
  secondary: `${BUTTON} ui-button-secondary`,
  danger: `${BUTTON} ui-button-danger`,
};

/**
 * Status buttons with a confirmation step. The page passes only the actions
 * that quotationStatusActions() allows for the user's role and the current
 * status; the Server Action and set_quotation_status() check both again.
 */
export function QuotationStatusActions({
  quotationId,
  quotationNumber,
  status,
  actions,
}: {
  quotationId: string;
  quotationNumber: string;
  status: QuotationStatus;
  actions: StatusAction[];
}) {
  const [state, formAction] = useActionState<StatusState, FormData>(setQuotationStatusAction, {});
  const [confirming, setConfirming] = useState<StatusAction | null>(null);

  const [seenStatus, setSeenStatus] = useState(status);
  if (seenStatus !== status) {
    setSeenStatus(status);
    setConfirming(null);
  }

  if (actions.length === 0 && !state.error) return null;

  return (
    <div role="group" aria-label="Status actions" data-confirm-scope className="document-status-actions space-y-2">
      {state.error && !confirming && <Alert kind="error">{state.error}</Alert>}
      {confirming ? (
        <form action={formAction}>
          <input type="hidden" name="quotationId" value={quotationId} />
          <input type="hidden" name="status" value={confirming.status} />
          <ConfirmDialog
            title={confirming.label}
            description={
              <p id="status-confirm-title">
                <strong>{quotationNumber}</strong>: {confirming.confirm}
              </p>
            }
            onClose={() => setConfirming(null)}
          >
            {state.error && <Alert kind="error">{state.error}</Alert>}
            <div className="flex flex-wrap gap-2">
              <ConfirmButton className={TONES[confirming.tone]} pendingText={confirming.pendingText}>
                Yes, {confirming.label.toLowerCase()}
              </ConfirmButton>
              <button type="button" className={TONES.secondary} onClick={() => setConfirming(null)}>
                Go back
              </button>
            </div>
          </ConfirmDialog>
        </form>
      ) : (
        <div className="flex flex-wrap gap-2">
          {actions.map((a) => (
            <button key={a.status} type="button" className={TONES[a.tone]} onClick={() => setConfirming(a)}>
              {a.label}
            </button>
          ))}
        </div>
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
    <button type="submit" disabled={pending} aria-disabled={pending} className={className}>
      {pending ? pendingText : children}
    </button>
  );
}
