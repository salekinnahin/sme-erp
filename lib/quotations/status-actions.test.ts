import { describe, expect, it } from "vitest";
import { quotationStatusActions } from "./status-actions";
import { QUOTATION_STATUSES, isTransitionAllowed } from "./validation";

const shown = (role: "owner" | "manager" | "employee", status: (typeof QUOTATION_STATUSES)[number]) =>
  quotationStatusActions(role, status).map((a) => a.status);

describe("quotationStatusActions", () => {
  it.each(["owner", "manager"] as const)("%s sees every valid change", (role) => {
    expect(shown(role, "draft")).toEqual(["sent", "cancelled"]);
    expect(shown(role, "sent")).toEqual(["accepted", "rejected", "expired", "cancelled"]);
  });

  it("employee sees only Mark sent, and only on a draft", () => {
    expect(shown("employee", "draft")).toEqual(["sent"]);
    expect(shown("employee", "sent")).toEqual([]);
  });

  it.each(["accepted", "rejected", "expired", "cancelled"] as const)(
    "shows nothing for the terminal status %s",
    (status) => {
      for (const role of ["owner", "manager", "employee"] as const) expect(shown(role, status)).toEqual([]);
    },
  );

  it("never shows an invalid transition or a change back to draft", () => {
    for (const role of ["owner", "manager", "employee"] as const)
      for (const from of QUOTATION_STATUSES)
        for (const to of shown(role, from)) {
          expect(to).not.toBe("draft");
          expect(isTransitionAllowed(from, to)).toBe(true);
        }
  });

  it("labels the buttons", () => {
    expect(quotationStatusActions("owner", "sent").map((a) => a.label)).toEqual([
      "Accept",
      "Reject",
      "Expire",
      "Cancel quotation",
    ]);
    expect(quotationStatusActions("employee", "draft")[0]).toMatchObject({ label: "Mark sent", tone: "primary" });
  });
});
