import { describe, expect, it } from "vitest";
import type { Role } from "@/lib/tenancy/context";
import {
  availableStatusChanges,
  canChangeQuotationStatus,
  canEditQuotation,
  canQuotation,
  type QuotationAction,
} from "./permissions";
import { QUOTATION_STATUSES } from "./validation";

const ROLES: Role[] = ["owner", "manager", "employee"];

describe("canQuotation", () => {
  it("matches the V1 permission table", () => {
    const everyone: QuotationAction[] = ["view", "create", "editDraft", "markSent"];
    const managers: QuotationAction[] = ["accept", "reject", "expire", "cancel"];
    for (const role of ROLES) {
      for (const action of everyone) expect(canQuotation(role, action)).toBe(true);
      for (const action of managers) expect(canQuotation(role, action)).toBe(role !== "employee");
    }
  });
});

describe("canChangeQuotationStatus", () => {
  it("lets every role mark a draft as sent", () => {
    for (const role of ROLES) expect(canChangeQuotationStatus(role, "draft", "sent")).toBe(true);
  });

  it("restricts accept, reject, expire and cancel to owners and managers", () => {
    for (const to of ["accepted", "rejected", "expired", "cancelled"] as const) {
      expect(canChangeQuotationStatus("owner", "sent", to)).toBe(true);
      expect(canChangeQuotationStatus("manager", "sent", to)).toBe(true);
      expect(canChangeQuotationStatus("employee", "sent", to)).toBe(false);
    }
    expect(canChangeQuotationStatus("manager", "draft", "cancelled")).toBe(true);
    expect(canChangeQuotationStatus("employee", "draft", "cancelled")).toBe(false);
  });

  it("never allows an invalid transition, whatever the role", () => {
    for (const role of ROLES) {
      expect(canChangeQuotationStatus(role, "draft", "accepted")).toBe(false);
      expect(canChangeQuotationStatus(role, "sent", "sent")).toBe(false);
      expect(canChangeQuotationStatus(role, "sent", "draft")).toBe(false);
      for (const terminal of ["accepted", "rejected", "expired", "cancelled"] as const)
        for (const to of QUOTATION_STATUSES)
          expect(canChangeQuotationStatus(role, terminal, to)).toBe(false);
    }
  });
});

describe("availableStatusChanges", () => {
  it("lists what each role can do next", () => {
    expect(availableStatusChanges("owner", "draft")).toEqual(["sent", "cancelled"]);
    expect(availableStatusChanges("employee", "draft")).toEqual(["sent"]);
    expect(availableStatusChanges("manager", "sent")).toEqual([
      "accepted",
      "rejected",
      "expired",
      "cancelled",
    ]);
    expect(availableStatusChanges("employee", "sent")).toEqual([]);
    expect(availableStatusChanges("owner", "accepted")).toEqual([]);
  });
});

describe("canEditQuotation", () => {
  it("allows editing drafts only, for every role", () => {
    for (const role of ROLES)
      for (const status of QUOTATION_STATUSES)
        expect(canEditQuotation(role, status)).toBe(status === "draft");
  });
});
