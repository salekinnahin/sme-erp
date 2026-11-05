import { describe, expect, it } from "vitest";
import type { Role } from "@/lib/tenancy/context";
import {
  availableSalesOrderStatusChanges,
  canChangeSalesOrderStatus,
  canEditSalesOrder,
  canSalesOrder,
  type SalesOrderAction,
} from "./permissions";
import { SALES_ORDER_STATUSES } from "./validation";

const ROLES: Role[] = ["owner", "manager", "employee"];

describe("canSalesOrder", () => {
  it("matches the V1 permission table", () => {
    const everyone: SalesOrderAction[] = ["view", "create", "convertQuotation", "editDraft", "confirm"];
    const managers: SalesOrderAction[] = ["complete", "cancel"];
    for (const role of ROLES) {
      for (const action of everyone) expect(canSalesOrder(role, action)).toBe(true);
      for (const action of managers) expect(canSalesOrder(role, action)).toBe(role !== "employee");
    }
  });
});

describe("canChangeSalesOrderStatus", () => {
  it("lets every role confirm a draft", () => {
    for (const role of ROLES) expect(canChangeSalesOrderStatus(role, "draft", "confirmed")).toBe(true);
  });

  it("restricts complete and cancel to owners and managers", () => {
    for (const role of ["owner", "manager"] as const) {
      expect(canChangeSalesOrderStatus(role, "confirmed", "completed")).toBe(true);
      expect(canChangeSalesOrderStatus(role, "confirmed", "cancelled")).toBe(true);
      expect(canChangeSalesOrderStatus(role, "draft", "cancelled")).toBe(true);
    }
    expect(canChangeSalesOrderStatus("employee", "confirmed", "completed")).toBe(false);
    expect(canChangeSalesOrderStatus("employee", "confirmed", "cancelled")).toBe(false);
    expect(canChangeSalesOrderStatus("employee", "draft", "cancelled")).toBe(false);
  });

  it("never allows an invalid transition, whatever the role", () => {
    for (const role of ROLES) {
      expect(canChangeSalesOrderStatus(role, "draft", "completed")).toBe(false);
      expect(canChangeSalesOrderStatus(role, "confirmed", "confirmed")).toBe(false);
      expect(canChangeSalesOrderStatus(role, "confirmed", "draft")).toBe(false);
      for (const to of SALES_ORDER_STATUSES) {
        expect(canChangeSalesOrderStatus(role, "completed", to)).toBe(false);
        expect(canChangeSalesOrderStatus(role, "cancelled", to)).toBe(false);
      }
    }
  });
});

describe("availableSalesOrderStatusChanges", () => {
  it("lists only allowed, permitted changes", () => {
    expect(availableSalesOrderStatusChanges("owner", "draft")).toEqual(["confirmed", "cancelled"]);
    expect(availableSalesOrderStatusChanges("manager", "confirmed")).toEqual(["completed", "cancelled"]);
    expect(availableSalesOrderStatusChanges("employee", "draft")).toEqual(["confirmed"]);
    expect(availableSalesOrderStatusChanges("employee", "confirmed")).toEqual([]);
    for (const role of ROLES) {
      expect(availableSalesOrderStatusChanges(role, "completed")).toEqual([]);
      expect(availableSalesOrderStatusChanges(role, "cancelled")).toEqual([]);
    }
  });
});

describe("canEditSalesOrder", () => {
  it("allows editing drafts only, for every role", () => {
    for (const role of ROLES)
      for (const status of SALES_ORDER_STATUSES)
        expect(canEditSalesOrder(role, status)).toBe(status === "draft");
  });
});
