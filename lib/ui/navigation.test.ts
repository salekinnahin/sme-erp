import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { activeNavItem, isActiveRoute, isDocumentPrintRoute, organizationInitials, visibleNavigation, type NavGroup } from "./navigation";

describe("workspace navigation", () => {
  it("groups every implemented module without dead routes", () => {
    const groups = visibleNavigation();
    expect(groups.map((group) => group.label)).toEqual(["Overview", "Sales", "Purchases", "Inventory", "Settings"]);
    expect(groups.find((group) => group.label === "Sales")?.items.map((item) => item.label)).toEqual(["Customers", "Quotations", "Sales orders", "Invoices"]);
    const links = groups.flatMap((group) => group.items);
    expect(groups.find((group) => group.label === "Purchases")?.items.map((item) => item.label)).toEqual(["Vendors", "Purchase orders", "Goods receipts"]);
    // Inventory is read-only: current stock and product master data only (no adjustments, warehouses or transfers yet).
    expect(groups.find((group) => group.label === "Inventory")?.items.map((item) => [item.label, item.href])).toEqual([["Current stock", "/inventory"], ["Products", "/products"]]);
    expect(links.some((item) => /adjust|warehouse|transfer/i.test(`${item.label} ${item.href}`))).toBe(false);
    expect(new Set(links.map((item) => item.href)).size).toBe(11);
    for (const item of links) expect(existsSync(`app${item.href}/page.tsx`), item.href).toBe(true);
  });
  it.each([undefined, false, true])("does not invent a Rental route for entitlement %s", (rentals) => {
    expect(visibleNavigation({ rentals }).some((group) => group.label === "Rental")).toBe(false);
    expect(visibleNavigation({ rentals }).flatMap((group) => group.items).some((item) => item.href.startsWith("/rentals"))).toBe(false);
  });
  it("requires an explicit entitlement for optional route groups", () => {
    // A future registry entry, never installed into production navigation.
    const optional: NavGroup[] = [{ label: "Optional", feature: "rentals", items: [{ href: "/future-example", label: "Example", icon: "order" }] }];
    expect(visibleNavigation({}, optional)).toEqual([]);
    expect(visibleNavigation({ rentals: false }, optional)).toEqual([]);
    expect(visibleNavigation({ rentals: true }, optional)).toEqual(optional);
  });
  it.each(["/products", "/products/new", "/products/categories", "/products/abc/edit"])("keeps Products active at %s", (path) => {
    expect(isActiveRoute(path, "/products")).toBe(true);
    expect(activeNavItem(path)?.label).toBe("Products");
  });
  it.each(["/inventory", "/inventory/abc"])("keeps Current stock active at %s", (path) => {
    expect(activeNavItem(path)?.label).toBe("Current stock");
    expect(isActiveRoute("/inventory-other", "/inventory")).toBe(false);
  });
  it("matches segment boundaries instead of similarly prefixed routes", () => {
    expect(isActiveRoute("/products-other", "/products")).toBe(false);
    expect(activeNavItem("/unimplemented")).toBeUndefined();
  });
  it("keeps Goods receipts active on its detail and print routes, and PO receiving under Purchase orders", () => {
    expect(activeNavItem("/goods-receipts/abc")?.label).toBe("Goods receipts");
    expect(activeNavItem("/purchase-orders/abc/receive")?.label).toBe("Purchase orders");
    expect(isDocumentPrintRoute("/purchase-orders/abc/receive")).toBe(false);
  });
  it.each(["quotations", "sales-orders", "invoices", "purchase-orders", "goods-receipts"])("bypasses the shell only for %s document print routes", (module) => {
    expect(isDocumentPrintRoute(`/${module}/document/print`)).toBe(true);
    expect(isDocumentPrintRoute(`/${module}/document/print/`)).toBe(true);
    expect(isDocumentPrintRoute(`/${module}/print`)).toBe(false);
    expect(isDocumentPrintRoute(`/${module}/document/edit`)).toBe(false);
    expect(isDocumentPrintRoute(`/${module}/document/print/extra`)).toBe(false);
  });
  it.each([["Northstar Trading", "NT"], ["  Acme  ", "A"], ["", "OR"], ["  ", "OR"], ["🏢 Trading", "🏢T"], ["Alpha Beta Gamma", "AB"]])("provides a bounded organization fallback for %s", (name, expected) => {
    expect(organizationInitials(name)).toBe(expected);
  });
});
