# Current Task

## Purchase Order Management – Part 2 (UI)

Built the Purchase Order UI on the Part 1 backend (DECISIONS 026), reusing the invoice Part 2 patterns (DECISIONS 021, 024). No Goods Receiving, stock ledger/quantities/reservations, supplier bills/payments, returns, warehouses or landed cost.

- Routes `/purchase-orders`, `/new`, `/[id]`, `/[id]/edit`, `/[id]/print`; nav link; `/purchase-orders` added to the proxy's signed-in prefixes. Pages use `requireTenant()`; not-found for unknown/cross-tenant IDs.
- Vendor selector: server search via existing `list_vendors()` (active only, 25 per search, name/company/email/phone). Product selector: `list_products()` (name/SKU/category) re-read by ID with **purchase price** (never selling price). Shared stale-response-safe `OptionSearch`; Enter never submits. Current vendor/products shown from the PO snapshot, inactive labelled.
- Lines: purchase-price default; missing purchase price leaves the price blank with a "Required" hint. Saved lines send their `id` (also after a product change), new lines none, removed lines omitted. A → B → A restores recorded name/SKU/description/unit/PO price; per-line "Restore recorded product" for any changed saved line (the only route back to an inactive original). Exact-decimal preview via a non-breaking `previewLinesWithDefaultPrice()` hook on the shared quotation engine.
- Status actions: draft → Mark ordered (all roles) / Cancel (owner, manager); ordered → Cancel (owner, manager). No receiving actions, no Edit outside draft, no delete. Stale edit/status actions show safe messages and refresh the page.
- Migration `20261104190000_list_purchase_orders.sql` (invoker, fixed search path, RLS + explicit org filter, literal wildcards, Unicode trim, strict status, tenant-safe vendor filter, clamped limit, deterministic order, authenticated-only grant). `purchase_orders.sql` extended (and its helper-grant allowlist now includes the list RPC).

### Verification (local only)

- [x] `npm test`: 838 passed, 56 files (137 purchase order tests across 12 files)
- [x] `npm run lint`, `npx tsc --noEmit` (after `next typegen`)
- [x] `npm run build`: succeeded
- [x] All 20 migrations apply and all nine SQL suites pass on local PGlite with simulated Supabase Auth/API roles; list RPC assertions mutation-checked (escaping, strict status, company search)
- [ ] Manual: apply **only** `20261104190000_list_purchase_orders.sql` after `20261104180000_purchase_orders.sql`; re-run `purchase_orders.sql` in the SQL Editor
- [ ] Manual: signed-in browser scenarios in `docs/testing/tenant-isolation.md` § 9.1
- No remote Supabase access, commit or push performed.

## Purchase Order Management – Part 1

Implemented the secure Vendor → Purchase Order database/domain foundation (DECISIONS 026). No PO UI, Goods Receiving, inventory quantities/movements/reservations, supplier bills/payments or accounting.

- New migration `20261104180000_purchase_orders.sql`, after every migration through `20261104170000_organization_features.sql`; historical migrations unchanged. Adds header/items, tenant-safe composite vendor key, counter type, RLS, private helpers, three write RPCs and a one-statement invoker read RPC.
- Exact quotation calculation helpers reused. New products default from purchase_price; historical vendor/product snapshots survive master edits/deactivation. Draft line IDs are one-save edit tokens; original-product re-selection restores recorded snapshots/price for future UI.
- All active roles create/edit/order; owner/manager cancel. Receiving states are reserved for future Goods Receiving; received/cancelled terminal. Non-drafts commercially immutable; DELETE blocked in every status, including privileged tools and organization cascades. PO operations never affect stock.
- Focused Vitest and `supabase/tests/purchase_orders.sql`; all requested docs updated.

### Verification (local only)

- [x] `npm test`: 747 passed, 49 files (46 purchase order tests)
- [x] `npm run lint`: no warnings/errors after cleanup
- [x] `npx tsc --noEmit`
- [x] All 19 migrations apply and all nine SQL suites pass in local PGlite PostgreSQL with simulated Supabase Auth/API roles/default grants: tenant isolation, customers, vendors, products, quotations, sales orders, invoices, organization features, purchase orders
- [ ] `npm run build`: existing Turbopack worker port-binding failure (`Operation not permitted`), reproduced in sandbox and escalated retry
- [ ] Native local Supabase/PostgREST and two-session concurrency checks remain manual; embedded SQL tests do not exercise actual lock waiting
- [ ] Manual deployment only: apply any missing earlier migrations in filename order through `20261104170000`, then `20261104180000_purchase_orders.sql`; run all SQL suites independently. No remote connection, commit or push performed.
- No product decisions require input. Future receiving will tighten cancellation once goods are received and become the inventory stock-in source.

## Previous tasks and outstanding manual checks

## Organization Feature Entitlements

Implemented the platform foundation only (DECISIONS 025). Initial approved key: `rentals`. No Rental module, navigation, admin UI, billing, or new dependencies.

- Migration `20261104170000_organization_features.sql`, after invoice migrations `20261104150000` and `20261104160000`.
- Member read-only RLS and minimal column grants; all company roles denied writes. Trusted database/platform tooling controls activation.
- Invoker SQL helper and server-only `hasOrganizationFeature("rentals")`, with session tenant and fail-closed results; shared key type/runtime allowlist.
- SQL suite `supabase/tests/organization_features.sql` plus focused Vitest tests.
- Documentation covers entitlement versus roles, trusted writes and future UI + server + database enforcement.

### Verification (local only)

- [x] `npm test`: 701 passed across 44 files (15 focused entitlement checks)
- [x] `npm run lint`
- [x] `npx tsc --noEmit`
- [x] All 18 migrations applied and all eight SQL suites passed in local PGlite with simulated Supabase Auth/API roles/default grants: tenant isolation, customers, vendors, products, quotations, sales orders, invoices, organization features
- [ ] `npm run build`: blocked by existing Turbopack worker port binding failure (`Operation not permitted`), reproduced in sandbox and escalated run
- [ ] Native local Supabase/PostgREST integration remains unverified; PGlite tests execute PostgreSQL constraints, grants and RLS with a minimal Auth bootstrap
- No remote Supabase access, commit or push performed. No product decisions require input.

## Previous task and outstanding manual checks


## Task

Invoice Management — **Part 2 implemented; hosted/browser checks and production build open**. Invoice list, direct creation, detail, draft edit, confirmed sales order conversion, issue/cancel, print and navigation on the completed Part 1 foundation.

## Scope and decisions

- `app/invoices/`, UI helpers and list read in `lib/invoices/`, migration `20261104160000_list_invoices.sql`, extended invoice SQL suite, TypeScript tests and docs (DECISIONS 024).
- Reuse shared searchable selectors and exact decimal preview. Draft item IDs are temporary edit tokens. Preserve inactive current references/snapshots. No Part 1 business-rule changes.
- All roles may create, convert, edit drafts and issue. Only owner/manager cancel. No user payment statuses or editable balances.
- Sales order detail offers Create/View invoice; any existing invoice consumes the order, including cancelled invoices. Invoiced orders hide Cancel; permitted Complete remains.
- Out: payments, accounting, inventory effects, credits, refunds and PDF libraries.

## Verification

- [x] TypeScript tests: 680 passed (43 files), including form-to-RPC payloads, exact previews, reference preservation, selector guards, status/conversion controls, action input allowlists and list reads
- [x] `npm run lint`, `npx tsc --noEmit`
- [x] All seven SQL suites pass locally on PGlite with all migrations, including invoice list grants, filtering, exact balances, pagination and tenant isolation
- [ ] `npm run build`: attempted in sandbox and with escalation; Turbopack worker creation fails binding a local port (`Operation not permitted`). Re-run in an environment that permits the worker.
- [ ] Apply Part 1 migration `20261104150000_invoices.sql`, then Part 2 `20261104160000_list_invoices.sql` to hosted Supabase
- [ ] Run `supabase/tests/invoices.sql`, `sales_orders.sql` and `quotations.sql` in hosted SQL Editor
- [ ] Signed-in browser scenarios and API probes in `docs/testing/tenant-isolation.md` § 8.2–8.3

## Still open from earlier tasks (manual Supabase steps)

- [ ] Sales orders Part 2: migration `20261104140000_list_sales_orders.sql` applied after `20261104130000_sales_orders.sql`; `sales_orders.sql` re-run; UI scenarios in § 7.3 and the API probe in § 7.2 checked. Backlog: rare stale-draft timing message; 500-customer cap on the list-page customer filter
- [ ] Sales orders Part 1: migration `20261104130000_sales_orders.sql` applied after the quotation migrations; `sales_orders.sql` and `quotations.sql` run in the SQL Editor

- [ ] Quotations Part 2: migrations `20261104090000_quotations.sql`, `20261104100000_restore_whitespace_line_separators.sql` (check its WARNINGs), `20261104110000_get_quotation.sql`, `20261104120000_list_quotations.sql` applied in order; `quotations.sql` run; UI scenarios in § 6.3 checked
- [ ] Quotations Part 1 review fixes: after applying, re-run `customers.sql`, `vendors.sql`, `products.sql`, `quotations.sql` in the SQL Editor
- [ ] Local working copy of `20261104030000_harden_customer_validation.sql` differs from the committed file again (U+2028 / U+2029 missing, DECISIONS 019). Restore it to the committed content before committing; `20261104100000` corrects the database either way
- [ ] Products: migrations `20261104070000_products.sql` and `20261104080000_restrict_product_category_writes.sql` applied; `supabase/tests/products.sql` run; UI scenarios in § 5 checked
- [ ] Products follow-ups: restrict product type changes once stock movements exist (DECISIONS 016)
- [ ] Vendors: migration `20261104050000_vendors.sql` applied; `supabase/tests/vendors.sql` run; UI scenarios in § 4 checked
- [ ] Customer search trim: migration `20261104060000_align_customer_search_trim.sql` applied; `customers.sql` re-run
- [ ] Customers: migrations `20261104020000_…` and `20261104030000_…` applied; no `NOT VALID` customer constraints remain; `customers.sql` run; UI scenarios in § 3 checked
- [ ] Organization onboarding: migrations `20261104000000_…`, `20261104010000_…` and `20261104040000_…` applied; `tenant_isolation.sql` run; UI scenarios checked
