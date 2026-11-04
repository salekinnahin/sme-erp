# Current Task

> All agents read this file before starting work. Replace its contents when the active task changes. Keep it short.

## Task

Product Management (Roadmap Phase 2: third tenant-owned master-data module). It follows the customer/vendor pattern (DECISIONS 013, 014) plus product rules (DECISIONS 016).

## Scope

- In: `product_categories` and `products` migration (constraints, indexes, RLS, column privileges, composite same-organization category FK); `set_product_status()`, `set_product_category_status()`, `list_products()`; domain functions in `lib/products/`; `/products` (search by name/SKU/category, status/type/category filters, pagination of 25, newest first), `/products/new`, `/products/[id]`, `/products/[id]/edit`, `/products/categories` (view for all; add, rename, deactivate/reactivate for owners and managers); Products navigation link; SQL tests; Vitest; docs.
- Out: stock quantities, stock movements, warehouses, purchase/sales documents, variants, serial/batch/lot, barcodes, images, price lists, discounts, taxes, unit conversion, manufacturing, valuation, category hierarchy, SKU auto-generation, hard delete.

## Permissions (Version 1)

| Action | Owner | Manager | Employee |
| --- | --- | --- | --- |
| View, create, edit products | ✓ | ✓ | ✓ |
| View categories, assign active ones to products | ✓ | ✓ | ✓ |
| Create, rename categories | ✓ | ✓ | — |
| Deactivate, reactivate products and categories | ✓ | ✓ | — |

## Acceptance Criteria

- [x] Migration `supabase/migrations/20261104070000_products.sql`: tables, CHECK constraints on the shared text helpers, case-insensitive unique SKU and category name, composite category FK, indexes, RLS, column privileges, no delete
- [x] Product types `inventory` / `non_inventory` / `service`; reorder level only for inventory; predefined units; prices `numeric(18,2)` handled as decimal strings
- [x] Organization taken from `requireTenant()`, never from the browser
- [x] Server-side validation with the shared helpers; the database enforces the same rules; duplicate SKU shows a field error
- [x] List, detail, create and edit pages; deactivate requires confirmation; employees cannot change status
- [x] Unknown, malformed or other-tenant IDs show "Product not found"
- [x] `supabase/tests/products.sql` passes on local PGlite; `tenant_isolation.sql`, `customers.sql`, `vendors.sql` still pass
- [x] `npm test`, `npm run lint`, `npx tsc --noEmit`, `npm run build` pass
- [ ] Migration `20261104070000_products.sql` applied to the Supabase project (manual; needs `20261104020000_…` and `20261104030000_…` applied first)
- [ ] Migration `20261104080000_restrict_product_category_writes.sql` applied right after it (manual)
- [ ] `supabase/tests/products.sql` run in the Supabase SQL Editor (manual)
- [ ] UI scenarios in `docs/testing/tenant-isolation.md` § 5 checked (manual)

## Fixes after review

- [x] Category create/rename restricted to owners and managers in every layer (permissions, Server Actions, domain, RLS via migration `20261104080000_restrict_product_category_writes.sql`, UI, SQL and Vitest tests)
- [x] Product edit page always includes the current category (fetched by ID within the tenant when outside the 1,000-row category list), so unrelated edits never clear it; regression tests in `lib/products/categories.test.ts`

## Follow-ups

- When stock movements exist (Phase 3): restrict product type changes for products with movements (DECISIONS 016).
- Future transaction forms must offer only active products and snapshot name, SKU and price on lines (DECISIONS 008).

## Relevant Docs / Files

- `docs/DATA_MODEL.md` § products, `docs/DECISIONS.md` (013, 014, 016), `docs/testing/tenant-isolation.md` § 5
- `lib/products/`, `app/products/`; reference implementation `lib/vendors/`, `app/vendors/`

## Still open from earlier tasks (manual Supabase steps)

- [ ] Vendors: migration `20261104050000_vendors.sql` applied; `supabase/tests/vendors.sql` run; UI scenarios in § 4 checked
- [ ] Customer search trim: migration `20261104060000_align_customer_search_trim.sql` applied; `customers.sql` re-run
- [ ] Customers: migrations `20261104020000_…` and `20261104030000_…` applied; no `NOT VALID` customer constraints remain; `customers.sql` run; UI scenarios in § 3 checked
- [ ] Organization onboarding: migrations `20261104000000_…`, `20261104010000_…` and `20261104040000_…` applied; `tenant_isolation.sql` run; UI scenarios checked
