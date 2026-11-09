import type { OrganizationFeatureKey } from "@/lib/organizations/feature-keys";

export type NavIcon = "overview" | "customers" | "quotation" | "order" | "invoice" | "vendors" | "purchase" | "receipt" | "stock" | "products" | "settings";
export type NavItem = { href: string; label: string; icon: NavIcon };
export type NavGroup = { label: string; items: readonly NavItem[]; feature?: OrganizationFeatureKey };

/** Register only implemented routes. Optional modules also need server/database authorization. */
export const NAVIGATION: readonly NavGroup[] = [
  { label: "Overview", items: [{ href: "/dashboard", label: "Dashboard", icon: "overview" }] },
  { label: "Sales", items: [
    { href: "/customers", label: "Customers", icon: "customers" },
    { href: "/quotations", label: "Quotations", icon: "quotation" },
    { href: "/sales-orders", label: "Sales orders", icon: "order" },
    { href: "/invoices", label: "Invoices", icon: "invoice" },
  ] },
  { label: "Purchases", items: [
    { href: "/vendors", label: "Vendors", icon: "vendors" },
    { href: "/purchase-orders", label: "Purchase orders", icon: "purchase" },
    { href: "/goods-receipts", label: "Goods receipts", icon: "receipt" },
  ] },
  // Inventory is read-only in this phase: stock changes only through business documents.
  { label: "Inventory", items: [
    { href: "/inventory", label: "Current stock", icon: "stock" },
    { href: "/products", label: "Products", icon: "products" },
  ] },
  // No rental route exists. Even entitled organizations must never see a dead link.
  { label: "Rental", feature: "rentals", items: [] },
  { label: "Settings", items: [{ href: "/settings/organization", label: "Organization", icon: "settings" }] },
];

export function visibleNavigation(features: Partial<Record<OrganizationFeatureKey, boolean>> = {}, groups = NAVIGATION): NavGroup[] {
  return groups.filter((group) => group.items.length > 0 && (!group.feature || features[group.feature] === true));
}

export function isActiveRoute(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function activeNavItem(pathname: string): NavItem | undefined {
  return NAVIGATION.flatMap((group) => group.items).find((item) => isActiveRoute(pathname, item.href));
}

export function isDocumentPrintRoute(pathname: string): boolean {
  return /^\/(quotations|sales-orders|invoices|purchase-orders|goods-receipts)\/[^/]+\/print\/?$/.test(pathname);
}

export function organizationInitials(name: string): string {
  return name.trim().split(/\s+/u).filter(Boolean).slice(0, 2).map((word) => Array.from(word)[0]).join("").toLocaleUpperCase("en") || "OR";
}
