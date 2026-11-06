"use client";

import { ConfirmDialog } from "@/app/_components/confirm-dialog";
import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { Alert } from "@/app/auth/_components/ui";
import {
  LOGO_ACCEPT,
  LOGO_REJECTION_MESSAGES,
  LOGO_RULES_TEXT,
  precheckLogoFile,
} from "@/lib/organizations/logo";
import { removeLogoAction, uploadLogoAction, type LogoActionState } from "./actions";

const BUTTON = "ui-button";
const PRIMARY = `${BUTTON} ui-button-primary`;
const SECONDARY = `${BUTTON} ui-button-secondary`;
const DANGER = `${BUTTON} ui-button-danger`;

type Selection = { url: string; name: string; after: LogoActionState };

/**
 * Current logo preview with Upload/Replace and Remove for owners/managers.
 * Checks here are for quick feedback only; the Server Action validates the
 * file's actual bytes and the role, and Storage policies check them again.
 */
export function LogoSettings({
  logoUrl,
  logoUpdatedLabel,
  organizationName,
  canManage,
}: {
  logoUrl: string | null;
  /** Formatted on the server (organization time zone), so hydration matches. */
  logoUpdatedLabel: string | null;
  organizationName: string;
  canManage: boolean;
}) {
  const [uploadState, uploadAction] = useActionState<LogoActionState, FormData>(uploadLogoAction, {});
  const [removeState, removeAction] = useActionState<LogoActionState, FormData>(removeLogoAction, {});
  const [selection, setSelection] = useState<Selection | null>(null);
  const [clientError, setClientError] = useState<string | null>(null);
  const [confirmingRemove, setConfirmingRemove] = useState(false);

  // Which action finished last decides the message shown. Updated during
  // render when an action state changes (React's documented pattern for
  // adjusting state on change); a finished remove also closes the prompt.
  const [seen, setSeen] = useState({ upload: uploadState, remove: removeState, last: null as LogoActionState | null });
  if (seen.upload !== uploadState || seen.remove !== removeState) {
    const removed = seen.remove !== removeState;
    setSeen({ upload: uploadState, remove: removeState, last: removed ? removeState : uploadState });
    if (removed) setConfirmingRemove(false);
  }
  const latest = seen.last;

  // A selection belongs to the action state it was made under, so it
  // disappears once that upload finishes (and the form resets).
  const pendingSelection = selection?.after === uploadState ? selection : null;

  function onFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    if (selection) URL.revokeObjectURL(selection.url);
    setSelection(null);
    setClientError(null);
    const file = event.target.files?.[0];
    if (!file) return;
    const rejection = precheckLogoFile(file);
    if (rejection) {
      setClientError(LOGO_REJECTION_MESSAGES[rejection]);
      event.target.value = "";
      return;
    }
    setSelection({ url: URL.createObjectURL(file), name: file.name, after: uploadState });
  }

  return (
    <div data-confirm-scope className="mt-4 space-y-4">
      {clientError && <Alert kind="error">{clientError}</Alert>}
      {!clientError && latest?.error && <Alert kind="error">{latest.error}</Alert>}
      {!clientError && latest?.success && !pendingSelection && <Alert kind="success">{latest.success}</Alert>}
      <div className="flex flex-wrap items-start gap-6">
        <figure className="space-y-1">
          <figcaption className="text-xs font-medium tracking-wide text-zinc-500 uppercase">
            {pendingSelection ? "Selected (not saved yet)" : "Current logo"}
          </figcaption>
          <div className="flex h-24 w-48 items-center justify-center rounded-md border border-dashed border-zinc-300 bg-white p-2 dark:border-zinc-700">
            {pendingSelection || logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- object URL or short-lived signed URL
              <img
                src={pendingSelection?.url ?? logoUrl ?? undefined}
                alt={pendingSelection ? `Selected file ${pendingSelection.name}` : `${organizationName} logo`}
                className="max-h-full max-w-full object-contain"
              />
            ) : (
              <span className="text-sm text-zinc-500">No logo</span>
            )}
          </div>
          {!pendingSelection && logoUrl && logoUpdatedLabel && (
            <p className="text-xs text-zinc-500">Updated {logoUpdatedLabel}</p>
          )}
        </figure>

        {canManage ? (
          <div className="min-w-0 flex-1 space-y-4">
            <form action={uploadAction} className="space-y-2">
              <label htmlFor="logo" className="block text-sm font-medium">
                {logoUrl ? "Replace logo" : "Upload logo"}
              </label>
              <input
                id="logo"
                name="logo"
                type="file"
                accept={LOGO_ACCEPT}
                required
                onChange={onFileChange}
                aria-describedby="logo-rules"
                className="block w-full text-sm file:mr-3 file:rounded-md file:border file:border-zinc-300 file:bg-white file:px-3 file:py-1.5 file:text-sm file:font-medium dark:file:border-zinc-700 dark:file:bg-zinc-900 dark:file:text-zinc-50"
              />
              <p id="logo-rules" className="text-xs text-zinc-500">
                {LOGO_RULES_TEXT} A wide logo on a transparent or white background prints best.
              </p>
              <SubmitButton className={PRIMARY} pendingText="Uploading…" disabled={!pendingSelection}>
                {logoUrl ? "Replace logo" : "Upload logo"}
              </SubmitButton>
            </form>

            {logoUrl && (
              <form action={removeAction} className="space-y-2">
                {!confirmingRemove ? (
                  <button type="button" className={SECONDARY} onClick={() => setConfirmingRemove(true)}>
                    Remove logo
                  </button>
                ) : (
                  <ConfirmDialog
                    title="Remove organization logo"
                    description={
                      <p id="remove-logo-title" className="text-red-800 dark:text-red-200">
                        Remove the logo? Business documents will print with the text-only header,
                        including existing documents.
                      </p>
                    }
                    onClose={() => setConfirmingRemove(false)}
                  >
                    <div className="flex gap-2">
                      <SubmitButton className={DANGER} pendingText="Removing…">
                        Yes, remove
                      </SubmitButton>
                      <button type="button" className={SECONDARY} onClick={() => setConfirmingRemove(false)}>
                        Cancel
                      </button>
                    </div>
                  </ConfirmDialog>
                )}
              </form>
            )}
          </div>
        ) : (
          <p className="min-w-0 flex-1 text-sm text-zinc-600 dark:text-zinc-400">
            Only owners and managers can change the logo.
          </p>
        )}
      </div>
    </div>
  );
}

function SubmitButton({
  className,
  pendingText,
  disabled,
  children,
}: {
  className: string;
  pendingText: string;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending || disabled} aria-disabled={pending || disabled} className={className}>
      {pending ? pendingText : children}
    </button>
  );
}
