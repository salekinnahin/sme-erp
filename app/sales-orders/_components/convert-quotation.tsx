"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { Alert, SubmitButton } from "@/app/auth/_components/ui";
import { PRIMARY_LINK, SECONDARY_LINK } from "@/app/_components/styles";
import type { ConversionView } from "@/lib/sales-orders/conversion";
import type { ConversionFormState } from "@/lib/sales-orders/messages";

const INPUT = "ui-input mt-1";
const LABEL = "ui-label";

/**
 * "Create sales order" / "View sales order" on an accepted quotation. The
 * page decides the view with quotationConversionView() from a tenant-safe
 * lookup; only the order date and the optional expected delivery date are
 * entered here. The database copies customer, lines, prices and notes from
 * the quotation (create_sales_order_from_quotation()), and allows one order
 * per quotation.
 *
 * Not keyed by the view: if someone else converted the quotation first, the
 * action revalidates the page, which then passes kind "view", and the error
 * message stays visible next to the new link.
 */
export function ConvertQuotation({
  action,
  view,
  today,
}: {
  /** convertQuotationAction bound to the quotation ID by the page. */
  action: (state: ConversionFormState, formData: FormData) => Promise<ConversionFormState>;
  view: ConversionView;
  /** Today in the organization's time zone (YYYY-MM-DD). */
  today: string;
}) {
  const [state, formAction] = useActionState<ConversionFormState, FormData>(action, {});
  const [open, setOpen] = useState(false);
  const [orderDate, setOrderDate] = useState(today);
  const [expected, setExpected] = useState("");
  const fe = state.fieldErrors ?? {};

  if (view.kind === "hidden" && !state.error) return null;

  return (
    <section className="space-y-3 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
      {state.error && <Alert kind="error">{state.error}</Alert>}

      {view.kind === "view" && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-zinc-700 dark:text-zinc-300">
            Converted to sales order <span className="font-mono font-medium">{view.salesOrderNumber}</span>.
          </p>
          <Link href={`/sales-orders/${view.salesOrderId}`} className={SECONDARY_LINK}>
            View sales order
          </Link>
        </div>
      )}

      {view.kind === "create" && !open && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-zinc-700 dark:text-zinc-300">
            This quotation was accepted. Create a draft sales order with its customer and items.
          </p>
          <button type="button" className={PRIMARY_LINK} onClick={() => setOpen(true)}>
            Create sales order
          </button>
        </div>
      )}

      {view.kind === "create" && open && (
        <form action={formAction} noValidate className="space-y-4">
          <h2 className="text-base font-semibold">Create sales order</h2>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            The customer, items, prices and notes are copied from this quotation.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="convert-orderDate" className={LABEL}>
                Order date
              </label>
              <input
                id="convert-orderDate"
                name="orderDate"
                type="date"
                value={orderDate}
                onChange={(e) => setOrderDate(e.target.value)}
                aria-invalid={fe.orderDate ? true : undefined}
                aria-describedby={fe.orderDate ? "convert-orderDate-error" : undefined}
                className={INPUT}
              />
              {fe.orderDate && (
                <p id="convert-orderDate-error" className="mt-1 text-sm text-red-600">
                  {fe.orderDate}
                </p>
              )}
            </div>
            <div>
              <label htmlFor="convert-expected" className={LABEL}>
                Expected delivery <span className="font-normal text-zinc-500">(optional)</span>
              </label>
              <input
                id="convert-expected"
                name="expectedDeliveryDate"
                type="date"
                min={orderDate || undefined}
                value={expected}
                onChange={(e) => setExpected(e.target.value)}
                aria-invalid={fe.expectedDeliveryDate ? true : undefined}
                aria-describedby={fe.expectedDeliveryDate ? "convert-expected-error" : undefined}
                className={INPUT}
              />
              {fe.expectedDeliveryDate && (
                <p id="convert-expected-error" className="mt-1 text-sm text-red-600">
                  {fe.expectedDeliveryDate}
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
              <SubmitButton pendingText="Creating…">Create sales order</SubmitButton>
            </div>
          </div>
        </form>
      )}
    </section>
  );
}
