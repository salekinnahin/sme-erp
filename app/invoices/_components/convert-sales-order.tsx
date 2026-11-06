"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { Alert, SubmitButton } from "@/app/auth/_components/ui";
import { PRIMARY_LINK, SECONDARY_LINK } from "@/app/_components/styles";
import type { ConversionView } from "@/lib/invoices/conversion";
import type { ConversionFormState } from "@/lib/invoices/messages";

const INPUT = "ui-input mt-1";
const LABEL = "ui-label";

/** Sales order conversion. Only dates are entered; the database copies snapshots.
 * Keep action errors visible if a concurrent conversion changes the view.
 */
export function ConvertSalesOrder({
  action,
  view,
  today,
  compact = false,
}: {
  /** convertSalesOrderAction bound to the sales order ID by the page. */
  action: (state: ConversionFormState, formData: FormData) => Promise<ConversionFormState>;
  view: ConversionView;
  /** Today in the organization's time zone (YYYY-MM-DD). */
  today: string;
  /** Compact controls for the document PageHeader; the same form and action state. */
  compact?: boolean;
}) {
  const [state, formAction] = useActionState<ConversionFormState, FormData>(action, {});
  const [open, setOpen] = useState(false);
  const [invoiceDate, setInvoiceDate] = useState(today);
  const [due, setDue] = useState("");
  const fe = state.fieldErrors ?? {};

  if (view.kind === "hidden" && !state.error) return null;

  return (
    <section className={compact ? "document-conversion space-y-3" : "space-y-3 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950"}>
      {state.error && <Alert kind="error">{state.error}</Alert>}

      {view.kind === "view" && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          {!compact && <p className="text-sm text-zinc-700 dark:text-zinc-300">
            Converted to invoice <span className="font-mono font-medium">{view.invoiceNumber}</span>.
          </p>}
          <Link href={`/invoices/${view.invoiceId}`} className={SECONDARY_LINK}>
            View invoice
          </Link>
        </div>
      )}

      {view.kind === "create" && !open && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          {!compact && <p className="text-sm text-zinc-700 dark:text-zinc-300">
            This sales order is confirmed. Create a draft invoice with its customer and items.
          </p>}
          <button type="button" className={PRIMARY_LINK} onClick={() => setOpen(true)}>
            Create invoice
          </button>
        </div>
      )}

      {view.kind === "create" && open && (
        <form action={formAction} noValidate className="space-y-4">
          <h2 className="text-base font-semibold">Create invoice</h2>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            The customer, items, prices and notes are copied from this sales order.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="convert-invoiceDate" className={LABEL}>
                Invoice date
              </label>
              <input
                id="convert-invoiceDate"
                name="invoiceDate"
                type="date"
                value={invoiceDate}
                onChange={(e) => setInvoiceDate(e.target.value)}
                aria-invalid={fe.invoiceDate ? true : undefined}
                aria-describedby={fe.invoiceDate ? "convert-invoiceDate-error" : undefined}
                className={INPUT}
              />
              {fe.invoiceDate && (
                <p id="convert-invoiceDate-error" className="mt-1 text-sm text-red-600">
                  {fe.invoiceDate}
                </p>
              )}
            </div>
            <div>
              <label htmlFor="convert-due" className={LABEL}>
                Due date <span className="font-normal text-zinc-500">(optional)</span>
              </label>
              <input
                id="convert-due"
                name="dueDate"
                type="date"
                min={invoiceDate || undefined}
                value={due}
                onChange={(e) => setDue(e.target.value)}
                aria-invalid={fe.dueDate ? true : undefined}
                aria-describedby={fe.dueDate ? "convert-due-error" : undefined}
                className={INPUT}
              />
              {fe.dueDate && (
                <p id="convert-due-error" className="mt-1 text-sm text-red-600">
                  {fe.dueDate}
                </p>
              )}
            </div>
          </div>
          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-end">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-sm text-zinc-600 underline hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50"
            >
              Go back
            </button>
            <div className="sm:w-56">
              <SubmitButton pendingText="Creating…">Create invoice</SubmitButton>
            </div>
          </div>
        </form>
      )}
    </section>
  );
}
