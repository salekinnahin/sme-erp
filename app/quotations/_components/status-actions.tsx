"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { Alert } from "@/app/auth/_components/ui";
import type { StatusAction, StatusActionTone } from "@/lib/quotations/status-actions";
import { setQuotationStatusAction, type StatusState } from "../actions";

const BUTTON =
  "rounded-md px-3 py-1.5 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-60";
const TONES: Record<StatusActionTone, string> = {
  primary: `${BUTTON} bg-zinc-900 text-white hover:bg-zinc-700 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200`,
  secondary: `${BUTTON} border border-zinc-300 bg-white text-zinc-900 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:hover:bg-zinc-800`,
  danger: `${BUTTON} bg-red-600 text-white hover:bg-red-700`,
};

/**
 * Status buttons with a confirmation step. The page passes only the actions
 * that quotationStatusActions() allows for the user's role and the current
 * status; the Server Action and set_quotation_status() check both again.
 */
export function QuotationStatusActions({
  quotationId,
  quotationNumber,
  actions,
}: {
  quotationId: string;
  quotationNumber: string;
  actions: StatusAction[];
}) {
  const [state, formAction] = useActionState<StatusState, FormData>(setQuotationStatusAction, {});
  const [confirming, setConfirming] = useState<StatusAction | null>(null);

  if (actions.length === 0) return null;

  return (
    <div className="space-y-2">
      {state.error && <Alert kind="error">{state.error}</Alert>}
      {confirming ? (
        <form action={formAction}>
          <input type="hidden" name="quotationId" value={quotationId} />
          <input type="hidden" name="status" value={confirming.status} />
          <div
            role="alertdialog"
            aria-labelledby="status-confirm-title"
            className="max-w-md space-y-3 rounded-md border border-zinc-200 bg-zinc-50 p-3 text-sm dark:border-zinc-800 dark:bg-zinc-900"
          >
            <p id="status-confirm-title">
              <strong>{quotationNumber}</strong>: {confirming.confirm}
            </p>
            <div className="flex flex-wrap gap-2">
              <ConfirmButton className={TONES[confirming.tone]} pendingText={confirming.pendingText}>
                Yes, {confirming.label.toLowerCase()}
              </ConfirmButton>
              <button type="button" className={TONES.secondary} onClick={() => setConfirming(null)}>
                Go back
              </button>
            </div>
          </div>
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
