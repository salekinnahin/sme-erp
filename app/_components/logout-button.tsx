"use client";

import { useFormStatus } from "react-dom";
import { Icon } from "./icon";

export function LogoutButton() {
  const { pending } = useFormStatus();
  const label = pending ? "Logging out…" : "Log out";
  return <>
    <button type="submit" className="icon-button" disabled={pending} aria-disabled={pending} aria-busy={pending} aria-label={label} title={label}>
      {pending ? <span aria-hidden="true" className="logout-spinner" /> : <Icon name="logout" />}
    </button>
    <span role="status" className="sr-only">{pending ? label : ""}</span>
  </>;
}
