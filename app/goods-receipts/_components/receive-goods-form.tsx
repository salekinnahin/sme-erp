"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { Alert } from "@/app/auth/_components/ui";
import { Badge } from "@/app/_components/status-badge";
import { DataTable, FormSection } from "@/app/_components/ui";
import { SECONDARY_LINK, TEXT_LINK } from "@/app/_components/styles";
import { plainDecimal } from "@/lib/format";
import type { ReceivingLine } from "@/lib/goods-receipts/calculations";
import type { ReceiveGoodsFormState } from "@/lib/goods-receipts/messages";
import {
  RECEIPT_NOTES_MAX_LENGTH,
  exactQuantity,
  receivingLineState,
  validateReceivingForm,
} from "@/lib/goods-receipts/receiving";

type Action = (state: ReceiveGoodsFormState, formData: FormData) => Promise<ReceiveGoodsFormState>;

/**
 * Receive form. Quantities are kept as the exact strings the user typed and
 * validated with the shared exact-decimal rules against the summary the
 * server loaded. Only lines with a positive quantity are posted, as
 * { purchaseOrderItemId, receivedQuantity } in a hidden "items" field.
 *
 * Stale data: if another user received first, the Server Action refreshes
 * the page; `lines` then carries the latest remaining quantities and the
 * inline checks re-run against them. Quantities typed for lines that are no
 * longer open are dropped (those lines show "Fully received").
 */
export function ReceiveGoodsForm({ action, lines, orderDate, defaultReceivedDate, cancelHref }: {
  action: Action;
  lines: ReceivingLine[];
  orderDate: string;
  defaultReceivedDate: string;
  cancelHref: string;
}) {
  const [state, formAction, pending] = useActionState<ReceiveGoodsFormState, FormData>(action, {});
  const [receivedDate, setReceivedDate] = useState(defaultReceivedDate);
  const [notes, setNotes] = useState("");
  const [typed, setTyped] = useState<Record<string, string>>({});
  const [attempted, setAttempted] = useState(false);
  const [seenState, setSeenState] = useState(state);
  const [editedSinceResult, setEditedSinceResult] = useState(false);
  if (seenState !== state) {
    setSeenState(state);
    setEditedSinceResult(false);
  }

  const openIds = new Set(lines.filter((line) => receivingLineState(line) === "open").map((line) => line.purchase_order_item_id));
  const quantities = Object.fromEntries(Object.entries(typed).filter(([id]) => openIds.has(id)));
  const result = validateReceivingForm({ receivedDate, notes, quantities }, lines, orderDate);
  const clientErrors = attempted && !result.ok ? result : null;
  const serverErrors = editedSinceResult ? null : state;
  const fieldError = (name: "receivedDate" | "notes" | "items") =>
    clientErrors?.fieldErrors[name] ?? serverErrors?.fieldErrors?.[name];
  const lineError = (id: string) => clientErrors?.lineErrors[id] ?? serverErrors?.lineErrors?.[id];
  const payload = JSON.stringify(result.ok ? result.items.map(({ purchaseOrderItemId, receivedQuantity }) => ({ purchaseOrderItemId, receivedQuantity })) : []);

  function edit(update: () => void) {
    update();
    setEditedSinceResult(true);
  }
  function fillRemaining() {
    edit(() => setTyped(Object.fromEntries(lines.filter((l) => openIds.has(l.purchase_order_item_id)).map((l) => [l.purchase_order_item_id, plainDecimal(l.remaining_quantity)]))));
  }

  return (
    <form
      action={formAction}
      noValidate
      className="space-y-5"
      onSubmit={(event) => {
        setAttempted(true);
        if (pending || !result.ok) {
          event.preventDefault();
          const form = event.currentTarget;
          // After React renders the inline errors, move focus to the first one.
          if (!result.ok) setTimeout(() => form.querySelector<HTMLElement>('[aria-invalid="true"], #items-error')?.focus(), 0);
        }
      }}
    >
      <input type="hidden" name="items" value={payload} />
      {state.error && !editedSinceResult && <Alert kind="error">{state.error}</Alert>}

      <FormSection title="Receipt details">
        <div className="grid gap-4 sm:grid-cols-[14rem_1fr]">
          <div>
            <label htmlFor="receivedDate" className="ui-label">Received date</label>
            <input
              id="receivedDate" name="receivedDate" type="date" required min={orderDate}
              value={receivedDate}
              onChange={(e) => edit(() => setReceivedDate(e.target.value))}
              aria-invalid={fieldError("receivedDate") ? true : undefined}
              aria-describedby={fieldError("receivedDate") ? "receivedDate-error" : undefined}
              className="ui-input mt-1"
            />
            {fieldError("receivedDate") && <p id="receivedDate-error" className="mt-1 text-xs text-red-700">{fieldError("receivedDate")}</p>}
          </div>
          <div>
            <label htmlFor="notes" className="ui-label">Notes <span className="font-normal text-muted">(optional)</span></label>
            <textarea
              id="notes" name="notes" rows={2} maxLength={RECEIPT_NOTES_MAX_LENGTH}
              value={notes}
              onChange={(e) => edit(() => setNotes(e.target.value))}
              placeholder="e.g. Second shipment, received at project site"
              aria-invalid={fieldError("notes") ? true : undefined}
              aria-describedby={fieldError("notes") ? "notes-error" : undefined}
              className="ui-input mt-1"
            />
            {fieldError("notes") && <p id="notes-error" className="mt-1 text-xs text-red-700">{fieldError("notes")}</p>}
          </div>
        </div>
      </FormSection>

      <section className="min-w-0 space-y-3" aria-labelledby="receiving-lines-heading">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="receiving-lines-heading" className="text-sm font-semibold">Items to receive</h2>
            <p className="text-xs text-muted">Enter what arrived in this delivery. Leave a line blank if nothing arrived for it.</p>
          </div>
          {openIds.size > 0 && (
            <div className="flex gap-3">
              <button type="button" className={TEXT_LINK} onClick={fillRemaining}>Fill all remaining</button>
              <button type="button" className={TEXT_LINK} onClick={() => edit(() => setTyped({}))}>Clear</button>
            </div>
          )}
        </div>
        {fieldError("items") && <p id="items-error" role="alert" className="text-sm text-red-700">{fieldError("items")}</p>}
        <DataTable label="Receiving lines">
          <table className="receiving-table w-full text-left">
            <thead>
              <tr>
                <th scope="col">Product</th>
                <th scope="col">Unit</th>
                <th scope="col" className="num">Ordered</th>
                <th scope="col" className="num">Already received</th>
                <th scope="col" className="num emphasis">Remaining</th>
                <th scope="col" className="num emphasis">Receive now</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => {
                const lineState = receivingLineState(line);
                const id = line.purchase_order_item_id;
                const error = lineState === "open" ? lineError(id) : undefined;
                return (
                  <tr key={id} data-state={lineState}>
                    <td data-label="Product">
                      <p className="font-medium">{line.product_name}</p>
                      <p className="font-mono text-[11px] text-muted">{line.sku}</p>
                    </td>
                    <td data-label="Unit" className="text-muted">{line.unit}</td>
                    <td data-label="Ordered" className="num">{exactQuantity(line.ordered_quantity)}</td>
                    <td data-label="Already received" className="num">{lineState === "service" ? "—" : exactQuantity(line.received_quantity)}</td>
                    <td data-label="Remaining" className="num emphasis remaining">{lineState === "service" ? "—" : exactQuantity(line.remaining_quantity)}</td>
                    <td data-label="Receive now" className="num emphasis receive-cell">
                      {lineState === "open" ? (
                        <>
                          <input
                            type="text" inputMode="decimal" autoComplete="off"
                            aria-label={`Receive now: ${line.product_name}`}
                            value={typed[id] ?? ""}
                            onChange={(e) => edit(() => setTyped((q) => ({ ...q, [id]: e.target.value })))}
                            placeholder="0"
                            aria-invalid={error ? true : undefined}
                            aria-describedby={error ? `qty-error-${id}` : undefined}
                            className="ui-input receive-input"
                          />
                          {error && <p id={`qty-error-${id}`} className="mt-1 text-xs text-red-700">{error}</p>}
                        </>
                      ) : lineState === "complete" ? (
                        <Badge tone="green">Fully received</Badge>
                      ) : lineState === "service" ? (
                        <span className="text-xs text-muted">Not applicable for goods receiving</span>
                      ) : (
                        <span className="text-xs text-muted">Needs product type reconciliation</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </DataTable>
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton />
        <Link href={cancelHref} className={SECONDARY_LINK}>Cancel</Link>
      </div>
    </form>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} aria-disabled={pending} className="ui-button ui-button-primary">
      {pending ? "Recording…" : "Record goods receipt"}
    </button>
  );
}
