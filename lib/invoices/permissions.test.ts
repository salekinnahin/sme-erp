import { describe, expect, it } from "vitest";
import type { Role } from "@/lib/tenancy/context";
import {
  availableInvoiceStatusChanges,
  canChangeInvoiceStatus,
  canEditInvoice,
  canInvoice,
  type InvoiceAction,
} from "./permissions";
import { INVOICE_STATUSES } from "./validation";

const ROLES: Role[] = ["owner", "manager", "employee"];

describe("canInvoice", () => {
  it("matches the V1 permission table", () => {
    const everyone: InvoiceAction[] = ["view", "create", "convertSalesOrder", "editDraft", "issue"];
    for (const role of ROLES) {
      for (const action of everyone) expect(canInvoice(role, action)).toBe(true);
      expect(canInvoice(role, "cancel")).toBe(role !== "employee");
    }
  });
});

describe("canChangeInvoiceStatus", () => {
  it("lets every role issue a draft", () => {
    for (const role of ROLES) expect(canChangeInvoiceStatus(role, "draft", "issued")).toBe(true);
  });

  it("restricts cancel to owners and managers", () => {
    for (const role of ["owner", "manager"] as const) {
      expect(canChangeInvoiceStatus(role, "draft", "cancelled")).toBe(true);
      expect(canChangeInvoiceStatus(role, "issued", "cancelled")).toBe(true);
    }
    expect(canChangeInvoiceStatus("employee", "draft", "cancelled")).toBe(false);
    expect(canChangeInvoiceStatus("employee", "issued", "cancelled")).toBe(false);
  });

  it("never lets anyone set a payment status", () => {
    for (const role of ROLES)
      for (const from of INVOICE_STATUSES) {
        expect(canChangeInvoiceStatus(role, from, "paid")).toBe(false);
        expect(canChangeInvoiceStatus(role, from, "partially_paid")).toBe(false);
      }
  });

  it("never allows an invalid transition, whatever the role", () => {
    for (const role of ROLES) {
      expect(canChangeInvoiceStatus(role, "issued", "issued")).toBe(false);
      expect(canChangeInvoiceStatus(role, "issued", "draft")).toBe(false);
      expect(canChangeInvoiceStatus(role, "partially_paid", "cancelled")).toBe(false);
      for (const to of INVOICE_STATUSES) {
        expect(canChangeInvoiceStatus(role, "paid", to)).toBe(false);
        expect(canChangeInvoiceStatus(role, "cancelled", to)).toBe(false);
      }
    }
  });
});

describe("availableInvoiceStatusChanges", () => {
  it("lists only allowed, permitted, user-settable changes", () => {
    expect(availableInvoiceStatusChanges("owner", "draft")).toEqual(["issued", "cancelled"]);
    expect(availableInvoiceStatusChanges("manager", "issued")).toEqual(["cancelled"]);
    expect(availableInvoiceStatusChanges("employee", "draft")).toEqual(["issued"]);
    expect(availableInvoiceStatusChanges("employee", "issued")).toEqual([]);
    for (const role of ROLES)
      for (const from of ["partially_paid", "paid", "cancelled"] as const)
        expect(availableInvoiceStatusChanges(role, from)).toEqual([]);
  });
});

describe("canEditInvoice", () => {
  it("allows editing drafts only, for every role", () => {
    for (const role of ROLES)
      for (const status of INVOICE_STATUSES) expect(canEditInvoice(role, status)).toBe(status === "draft");
  });
});
