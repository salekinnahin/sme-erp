"use client";

import { useEffect, useId, useRef } from "react";

/** Native modal supplies focus containment, Escape and background inertness. Keep inside its action form. */
export function ConfirmDialog({ title = "Confirm action", description: message, onClose, children }: { title?: string; description: React.ReactNode; onClose: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const heading = useId();
  const description = useId();
  useEffect(() => {
    const previous = document.activeElement;
    const dialog = ref.current;
    const scope = dialog?.closest("[data-confirm-scope]");
    dialog?.showModal();
    dialog?.querySelector<HTMLButtonElement>('button[type="button"]')?.focus();
    return () => {
      dialog?.close();
      queueMicrotask(() => {
        if (previous instanceof HTMLElement && previous !== document.body && previous.isConnected) previous.focus();
        else scope?.querySelector<HTMLButtonElement>("button")?.focus();
      });
    };
  }, []);
  return <dialog ref={ref} role="alertdialog" aria-labelledby={heading} aria-describedby={description} className="confirm-dialog" onCancel={(event) => { event.preventDefault(); onClose(); }}>
    <h2 id={heading}>{title}</h2>
    <div id={description} className="mb-4 text-sm">{message}</div>
    <div className="space-y-4 text-sm">{children}</div>
  </dialog>;
}
