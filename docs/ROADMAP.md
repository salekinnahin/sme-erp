# Roadmap

Version 1 delivery order. Each phase builds on the previous one. Check items off as they ship. Scope is defined in `docs/PRODUCT.md`.

## Phase 0 — Foundation

- [x] Next.js 16 + TypeScript + Tailwind project
- [x] Supabase client setup (browser, server, proxy)
- [x] Email/password authentication (sign-up, sign-in, sign-out, email confirmation)
- [x] AI agent context: `AGENTS.md`, `CLAUDE.md`, `docs/`, `tasks/`
- [x] Migrations folder (`supabase/migrations/`); the CLI workflow is not set up yet
- [x] Test setup (Vitest for TypeScript; SQL suites in `supabase/tests/`)
- [x] Remove the temporary `app/test-supabase` diagnostic page

## Phase 1 — Tenancy and Access

- [x] Organizations and organization setup
- [x] Memberships with fixed roles (owner, manager, employee)
- [x] RLS foundation and helper functions
- [ ] User management (invite, role change, remove)
- [ ] Audit log foundation
- [x] Shared modern light UI and app shell: grouped desktop sidebar, accessible mobile drawer, organization branding, consistent list/detail/forms across existing modules, isolated business-document prints (DECISIONS 030). No new business modules or analytics. Verification details in `tasks/current.md`.
- [x] Organization branding: company logo upload/replace/remove (owner/manager) on `/settings/organization`, shown on quotation, sales order, invoice and purchase order prints via the shared `DocumentBrandHeader` (DECISIONS 029). Goods received notes use it too; supplier bills can adopt it later

## Phase 2 — Master Data

- [x] Customers
- [x] Vendors
- [x] Products/services (with flat categories; no stock yet)

## Phase 3 — Inventory Core

- [x] Stock movements — Part 1 backend (DECISIONS 033; migration `20261104240000_stock_movements.sql`): immutable signed ledger, Goods Receipt stock-in for inventory lines at sealing, idempotent per receipt line, backfill of existing receipts, RLS/read-only API, `list_current_stock()` / `list_stock_movements()` reads and `lib/inventory/` readers. No UI
- [ ] Stock on hand / movement history UI (backend reads ready)
- [ ] Stock adjustments (compensating movements)
- [ ] Sales stock-out with transactional negative-stock prevention
- Deferred: warehouses/locations, transfers, reservations, returns, lots/serials, costing/valuation

## Phase 4 — Sales

- [x] Quotations — Part 1 (database, domain, validation, calculations, permissions, tests) and Part 2 (pages, list/search/filter, status actions, print view). Manual Supabase steps open: see `tasks/current.md`
- [x] Sales orders — Part 1 (database, domain, validation, calculations, quotation conversion, permissions, tests) and Part 2 (pages, list/search/filter, conversion from accepted quotations, status actions, print view). Manual Supabase steps open: see `tasks/current.md`
- [x] Invoices — Part 1 (database/domain) and Part 2 (list, direct create, detail, draft edit, sales order conversion, issue/cancel, print and navigation). Manual Supabase/UI checks and environment-blocked production build remain open: see `tasks/current.md`
- [ ] Customer payments

## Phase 5 — Purchasing

- [x] Purchase orders — Part 1 database/domain foundation (DECISIONS 026): vendor/product snapshots, purchase-price defaults, exact totals, PO numbering, draft edits, order/cancel, receiving-status reservation, RLS and tests. No stock effects.
- [x] Purchase orders — Part 2 UI: list (server-side search/status/vendor filter, 25/page), direct create, detail, draft edit with line tokens and A → B → A restore, order/cancel, browser print, navigation. Purchase-price defaults; no stock effects. Migration `20261104190000_list_purchase_orders.sql`. Manual Supabase/browser checks remain open: see `tasks/current.md`
- [x] Goods receiving — Part 1 backend/domain: immutable receipts, partial/multiple deliveries, exact remaining quantities, PO status automation, cancellation guard, type snapshots, GR numbering, tenant security and tests (DECISIONS 027; migration `20261104200000_goods_receipts.sql`). Native concurrency/build checks and legacy reconciliation remain documented in `tasks/current.md`.
- [x] Goods receiving — Part 2 UI (DECISIONS 031): PO detail Receiving summary + receipt history, Receive goods / Receive remaining goods action, `/purchase-orders/[id]/receive` partial-receiving form (exact decimals, remaining limits, stale-safe), `/goods-receipts` list/search, read-only detail, Goods Received Note print, navigation. Cancel hidden once receipts exist. Migration `20261104220000_list_goods_receipts.sql`. No stock effects yet; manual Supabase/browser checks open: see `tasks/current.md`
- [ ] Supplier bills
- [ ] Supplier payments

## Phase 6 — Expenses, Reporting and Data

- [ ] Expenses
- [ ] Dashboard
- [ ] Essential reports
- [ ] CSV import/export
- [ ] Basic in-app indicators

## Version 2 Candidates

Anything listed under "Explicit Non-Scope" in `docs/PRODUCT.md`.
