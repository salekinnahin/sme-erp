# Current Task

## Inventory / Stock Movement Ledger – Part 1 Backend (2026-11-10)

Immutable stock ledger with Goods Receipt stock-in (DECISIONS 033). No Inventory UI, warehouses, adjustments, sales stock-out or returns.

- Migration **`20261104240000_stock_movements.sql`** (after `20261104230000`; earlier migrations unchanged): `stock_movements` (signed numeric(18,3) `quantity_delta`, `goods_receipt` type/source, source receipt + line, product snapshots, `occurred_on` = received date), idempotency key `(organization_id, source_type, source_line_id)`, composite tenant FKs, RLS read-only, UPDATE/DELETE/TRUNCATE guards, posting trigger on receipt sealing (inventory snapshot lines only), derivation trigger for every insert path, verified backfill of existing sealed receipts, `list_current_stock()` and `list_stock_movements()`.
- `lib/inventory/`: read-only typed readers, list params, exact quantity strings, labels/messages, permissions. No mutation helper.
- `purchase_orders.sql`: the "no ledger yet" tripwire replaced by a check that PO operations leave the ledger unchanged. New suite `stock_movements.sql`.

### Verification (local only)

- [x] `npm test`: **1342 passed / 82 files** (56 new inventory tests in 5 files).
- [x] `npm run lint`; `npx tsc --noEmit`; `npm run build` succeeded.
- [x] All 25 migrations apply and all **twelve** SQL suites pass on local PGlite (PostgreSQL 18.6) with simulated Auth/API roles. Pre-ledger backfill scenario passes. 16 mutations each fail the new suite. Migration also applied inside an explicit transaction.
- [ ] Manual: apply `20261104240000_stock_movements.sql` as one complete script after `20261104230000`; run `stock_movements.sql`, then re-run `goods_receipts.sql`, `purchase_orders.sql`, `products.sql` in the SQL Editor; native two-session check and API probe in `docs/testing/tenant-isolation.md` § 12.
- No remote Supabase access, commit or push.
- Follow-up (DECISIONS 034, same unapplied migration): `product_type` is locked once a product has a stock movement (`ST002`, trigger `products_lock_type_after_stock`; derivation takes `FOR SHARE` on the product). App maps it to a product-type field error. `goods_receipts.sql` updated to assert the lock; `stock_movements.sql` extended. Verification after the follow-up: `npm test` **1345 passed / 83 files**, lint, `tsc`, build, all 12 SQL suites, backfill scenario and 6 new mutations (see § 12).

- Follow-up 2 (DECISIONS 035, same unapplied migration). Trigger `products_guard_type_change` replaces the DECISIONS 034 trigger.
  - Rule A: a product cannot leave inventory while on an inventory line of an ordered/partially_received PO (`ST003`). Draft and cancelled POs do not lock. Repair to inventory is allowed.
  - Rule B: movements lock the type permanently (`ST002`).
  - Rule C: posting re-reads the product `FOR SHARE` and rolls the receipt back unless it is inventory (`ST004`).
  - Type changes require READ COMMITTED (`ST005`).
  - App messages for `ST003` (product form) and `ST004` (receive form).
  - Tests: `goods_receipts.sql` updated for `ST004` and repair; `stock_movements.sql` extended; receive-message safety test allows "inventory" only for `product_not_inventory`.
  - Verification: `npm test` **1349 passed / 83 files**, lint, `tsc`, build, all 12 SQL suites (PGlite and native embedded PostgreSQL 18.6), backfill and isolation scenarios, 3 native two-session races, 11 new mutations.

- Follow-up 3 (DECISIONS 036, same unapplied migration): `draft → ordered` is refused with `ST006` (detail `lines: n,…`) when an inventory-snapshot line's product is no longer inventory.
  - Trigger `purchase_orders_validate_inventory_types` covers the RPC and privileged updates; products are locked `FOR SHARE` before the type test.
  - The app shows the friendly message plus the affected line numbers.
  - Final lock order: PO → product for receiving and ordering; product only for type changes.
  - Tests: `goods_receipts.sql` and `stock_movements.sql` updated (`ST004` now uses constructed invalid data); PO Vitest added.
  - Verification: `npm test` **1354 passed / 83 files**, lint, `tsc`, build, all 12 SQL suites (PGlite and native), 5 native races (one regression found and fixed: filter-before-lock), mutations.

## Previous task

## Goods Receiving – Received By snapshot and history item count (2026-11-07)

Two focused Part 2 improvements (DECISIONS 032). No Inventory, no quantity/status/concurrency/sealing/cancellation/service/permission changes, no profile access widening.

- Migration **`20261104230000_goods_receipt_received_by_snapshot.sql`** (after `20261104220000`; earlier migrations unchanged): nullable `goods_receipts.received_by_name` with trim/length CHECK; private BEFORE INSERT trigger snapshots `profiles.full_name` of `created_by` (overwrites any supplied value, all insert paths); `get_goods_receipt()` returns it; `list_goods_receipts()` recreated returning `item_count` + `received_by_name` (mixed-unit total and raw creator removed; search/paging/order/grants unchanged).
- No backfill: existing receipts and recorders without a profile name show "Name not recorded" (no email fallback, no invented names).
- UI: list, detail, PO history and GRN print show the stored name ("Received By: Rahim Uddin" + signature line). PO history columns: GR number, Received date, Items, Received by. "You" / "Another team member" removed.

### Verification (local only)

- [x] `npm test`: **1286 passed / 77 files** (snapshot/item-count assertions replace the viewer-relative label tests).
- [x] `npm run lint`; `npx tsc --noEmit`; `npm run build` (default) succeeded.
- [x] All 24 migrations apply; all **eleven** SQL suites pass on local PGlite. `goods_receipts.sql` extended; five snapshot mutations each fail.
- [ ] Manual: apply `20261104220000` then `20261104230000`, re-run `goods_receipts.sql` and `purchase_orders.sql` in the SQL Editor; browser checks in `docs/testing/tenant-isolation.md` § 10.1.
- No remote Supabase access, commit or push.

## Previous task

## Goods Receiving – Part 2 UI (2026-11-07)

Built the Goods Receiving UI on the Part 1 backend and the shared design system (DECISIONS 031). Flow: PO → Receive goods → enter quantities → Record goods receipt → PO status updates from the database. No stock ledger, balances, warehouses, returns/reversals, supplier bills/payments, attachments or inspection.

- Routes: `/purchase-orders/[id]/receive`, `/goods-receipts`, `/goods-receipts/[id]`, `/goods-receipts/[id]/print`. No `/goods-receipts/new`. Nav "Goods receipts" under Purchases; proxy prefix `/goods-receipts`; GRN print bypasses the shell.
- PO detail: Receiving section (backend summary: ordered/received/remaining, services "—"), receipt history (one query, compact empty state, links), **Receive goods** / **Receive remaining goods** only for ordered/partially received POs with something receivable, all active roles. Cancel hidden once any receipt exists.
- Receive form: exact decimal strings, blank/zero omitted, ≥ 1 positive line, ≤ remaining ("You can receive a maximum of 30.000."), received date default today in org timezone and ≥ order date (client + server), optional notes, services/fully received lines not editable, Fill all remaining / Clear, pending + double-submit guard. Posts only line ID + quantity. Stale/concurrent failures show one friendly message and refresh with the latest summary. Mobile: same table as stacked line cards.
- List (search GR/PO/vendor snapshot, 25/page), read-only detail (View purchase order, Print only), GRN print with `DocumentBrandHeader`, items, notes and signature lines. "Received by" later replaced by a stored name snapshot (see above). Success copy: "Goods receipt recorded successfully." No stock wording.
- Migration **`20261104220000_list_goods_receipts.sql`** (after `20261104210000_organization_branding.sql`; no earlier migration changed): `list_goods_receipts()` invoker read for list and PO history. `createGoodsReceipt()` gained an order-date pre-check (same rule as GR007); no other Part 1 change.

### Verification (local only)

- [x] `npm test`: **1286 passed / 77 files** (125 new checks, 5 new files; existing nav/component tests updated for the now-real `/goods-receipts` route).
- [x] `npm run lint`; `npx tsc --noEmit` (after `next typegen`).
- [x] `npm run build` (default Turbopack) succeeded, including the four new routes.
- [x] All 23 migrations apply and all **eleven** SQL suites pass on local PGlite with simulated Auth/API roles. `goods_receipts.sql` extended (list/history/search/wildcards/Unicode/paging/order/isolation/disabled/anon); six mutations of the new RPC each fail the intended assertion.
- [ ] Manual: apply `20261104220000_list_goods_receipts.sql`, re-run `goods_receipts.sql` in the SQL Editor, then the signed-in checks in `docs/testing/tenant-isolation.md` § 10.1 (including two-tab stale receiving and mobile cards).
- No remote Supabase access, commit or push.

## Previous task

## UI Revamp review fixes (2026-11-06)

- Fixed root recovery with installed Next.js 16.4.5 `retry` (user confirmed; `unstable_retry` is absent from this runtime). Safe error presentation retained.
- Request-only React branding cache uses the exact tenant reference returned by request-cached `getTenant()`; no persistent signed URL cache or changed authorization.
- Existing document status actions moved into PageHeader, plus sales-order Create/View Invoice. Same role/status matrix; safe stale-action feedback survives refresh, including quotations.
- Visible filter labels, bounded desktop rails (static below 800px height), expanded drawer state/scroll lock/focus and resize handling, logout pending feedback, descriptive-only confirmation text, orphan comment and branding success-copy cleanup.
- Final Vitest: **1161 passed / 72 files** (81 additional checks). Lint and `npx tsc --noEmit` passed. Default `npm run build` blocked by local Turbopack worker port binding in both sandboxed and escalated runs; supplemental `npm run build -- --webpack` passed (compilation, TypeScript and 45 generated pages). Details in `docs/testing/ui-revamp.md`.
- No SQL run or remote Supabase access. SQL, write/domain rules, four print sources, payloads, selectors, permissions and snapshots unchanged. Existing branding action changed only its success copy. No commit or push.
- Browser checks performed and remaining manual/visual checks: `docs/testing/ui-revamp.md`. DECISIONS 030 follow-up records the implementation.

## Modern UI Design System + App Shell Revamp (2026-11-06)

Presentation refactor across Dashboard, Purchase Orders, Invoices, Sales Orders, Quotations, Products/categories, Customers, Vendors, Organization Settings and shared auth controls. DECISIONS 030 and ARCHITECTURE document the reusable system.

- Shared server-resolved organization/branding shell; fixed desktop sidebar and compact topbar, native mobile navigation drawer. One grouped route registry, segment-safe active links, no dead links or optional Rental entries. No new dependency or feature queries.
- Light tokens, page headers/actions, section cards, filter toolbars, accessible scrollable tables, metadata, document item/totals components, empty states and skeletons. Existing GET parameters, bounded reads and pagination retained. Dashboard only launches existing modules; no analytics/KPI queries.
- Four document detail/form patterns migrated with summary rails and stacked responsive layouts. Existing business helpers, snapshots, exact money, line-token serialization, inactive-reference behavior, restoration controls and race-safe selectors retained. Confirmations use a native modal with keyboard focus handling and errors visible inside it.
- Logo avatar uses private server-signed URL or initials; organization settings retain existing permissions and read-only details. All four print route sources and DocumentBrandHeader preserved; shell omitted from print routes with a separate paper-preview wrapper.
- Baseline includes uncommitted branding/SQL work from the preceding task. This refactor preserves that work and changes no SQL, migrations, domain functions, Server Actions, RLS, proxy, Supabase config or package dependencies. No remote Supabase access, commit or push.

### Verification

- [x] `npm test`: **1080 passed / 68 files**, including 77 new UI checks. Final rerun recorded on completion.
- [x] `npm run lint`; `npx tsc --noEmit`.
- [x] `npm run build` with local worker escalation (sandbox first hit the documented port-binding restriction).
- [x] Baseline comparison: SQL, existing domain files, Server Actions and the four print sources unchanged. No SQL suites run.
- [x] Desktop fixture screenshots: sidebar, Dashboard, Customers/Vendors/Products lists, Organization Settings, PO list/detail/new and quotation list/new/edit.
- [ ] Full browser matrix remains incomplete: mobile drawer/focus, remaining document screens, real logo interactions and all four browser print previews. Details and exact checked/pending screens: `docs/testing/ui-revamp.md`. Browser targeting/focus contention prevented a safe complete pass; two affected existing tabs were restored.
- No product/architecture decision needs user input. No new receiving, inventory, payment, analytics or Rental functionality.

## Previous task

## Organization Branding / Logo Upload (2026-11-06)

Owners/managers upload, replace and remove the company logo; quotation and sales order prints show it through a shared `DocumentBrandHeader` (DECISIONS 029). Branding is live, not snapshotted. No UI revamp, theming, invoice/PO header changes, document snapshots or entitlements.

- Migration **`20261104210000_organization_branding.sql`**, after `20261104200000_goods_receipts.sql`; earlier migrations unchanged. Drops the unused `organizations.logo_url` (refuses if any value exists), adds `logo_path` + `logo_updated_at` with integrity CHECKs, creates the private `organization-branding` bucket (2 MiB, PNG/JPEG/WebP), four `storage.objects` policies and the `set_organization_logo` / `clear_organization_logo` RPCs.
- One fixed object per organization: `organizations/<org id>/logo`. Server Action validates bytes (signature, size, dimensions), uploads with the user's session (no service role) and records via RPC. Signed 1-hour read URLs per render; missing/failed logo → text-only header.
- Follow-up: invoice and purchase order print views now also use `DocumentBrandHeader` (all four documents share one letterhead). Snapshots, source sales order, amount paid/due and notes unchanged. `npm test` 1003 passed / 64 files; lint, `tsc`, build pass. No schema/storage change.
- `/settings/organization` (+ nav "Settings", proxy prefix `/settings`): company details (read-only), logo preview, upload/replace/remove. Server Action body limit raised to 3 MB.

### Verification (local only)

- [x] `npm test`: **997 passed / 64 files** (77 new branding tests in 4 files)
- [x] `npm run lint`, `npx tsc --noEmit` (after `next typegen`)
- [x] `npm run build`: succeeded
- [x] All 22 migrations apply and all **eleven** SQL suites pass on local PGlite (simulated Auth/API roles plus a minimal `storage` schema). Branding suite mutation-checked (role-weakened insert policy, removed path CHECK, removed object-existence check all fail).
- [ ] Manual: apply `20261104210000_organization_branding.sql` (bucket and policies included), run `organization_branding.sql` in the SQL Editor, then the signed-in checks in `docs/testing/tenant-isolation.md` § 11 (real Storage API, including delete).
- No remote Supabase access, commit or push performed.

## Goods Receiving Part 1 — review fixes (2026-11-06)

- User confirmed receiving migration is **not applied remotely**. Edited `20261104200000_goods_receipts.sql` directly; no older migrations modified. DECISIONS 028 records the design.
- Sealed-only summary and private derived status helper; PO INSERT/UPDATE rejects receiving-state mismatches (GR009). AFTER seal reconciles PO status for privileged writers too; no recursion. Normal status RPC still forbids receiving targets.
- Header insert locks PO and enforces receiving eligibility, historical type reconciliation and received_date >= order_date (GR007). No future-date restriction. Cheap request-only checks now precede the RPC lock, after authorization.
- Statement-level BEFORE TRUNCATE blocks both receipt tables and both PO tables. Cancellation regression checks the exact receipt-specific error while PO remains ordered with an unsealed receipt, without disabling guards. Mutation-checking with only that trigger removed makes the regression fail at the intended assertion.
- SQL covers first 70/100 + rejected 31 with unchanged receipt/items/counter/summary, existing 101-from-zero, direct status mismatch/valid states, privileged seal, date rules, partial/multiple receipts and immutable-table TRUNCATE. PO status fixtures now use real receiving events.
- Verification: `npm test` **920 passed / 60 files**; lint and `npx tsc --noEmit` passed. All 21 migrations and ten SQL suites pass locally on PGlite with simulated Supabase Auth/API roles. `npm run build` fails in both normal and escalated runs at the existing Turbopack CSS worker port bind (`Operation not permitted`). Native local concurrent-session waits remain manual.
- No Goods Receiving UI or Inventory added. No remote Supabase connection, commit or push.

## Goods Receiving – Part 1 (backend/domain)

Implemented immutable PO → Goods Receipt events. No receiving UI, inventory ledger, product stock quantity, warehouses, supplier bills/payments, returns/reversal or rental functionality.

- Migration **`20261104200000_goods_receipts.sql`**, after all existing migrations through **`20261104190000_list_purchase_orders.sql`**. Applied migrations unchanged. Tables, tenant-safe composite keys, transactional GR counter, RLS/read-only API tables, atomic creation, one-statement invoker receipt read and shared receiving summary.
- Positive exact numeric(18,3) receipt quantities, 1–100 distinct PO lines, partial/multiple receipts, no over-receiving. Authorize/recheck membership, lock the PO row, sum received quantities after locking, insert/seal receipt and automate partially_received/received in one transaction. Same lock serializes cancellation; any receipt prevents cancellation.
- Product type captured on new PO selections and preserved for kept draft lines. Inventory/non-inventory are receivable; services rejected and excluded from completion. Service-only POs stay ordered. Legacy unknown types block receiving pending historical reconciliation; never guessed from current master data (DECISIONS 027).
- Receipt snapshots derive exclusively from PO lines. Sealing/deferred completeness and immutable triggers protect headers/items, even privileged writes; organization/PO deletion cannot purge history. Receipt creator Auth deletion is restricted. All active roles create/view; none edit/delete.
- Domain validation, exact arithmetic, safe error/messages and create/read/summary in `lib/goods-receipts/`. SQL regression suite plus four Vitest suites. Existing PO SQL allowlist recognizes the summary RPC.
- Goods Receipt is the future source document for stock-in; inventory cutover/backfill remains future work.

### Verification (local only)

- [x] `npm test`: **920 passed across 60 files** (82 new receiving tests).
- [x] `npm run lint`: passed.
- [x] `npx tsc --noEmit`: passed.
- [x] All **21 migrations** apply and all **ten SQL suites** pass locally in PGlite with simulated Supabase Auth/API roles/default grants. Extended receiving snapshot/100-line/late-failure checks also pass.
- [ ] `npm run build`: attempted normally and with approved escalation; both fail in the existing Turbopack CSS worker while binding a local port (`Operation not permitted`). Re-run where worker binding is allowed.
- [ ] Native local Supabase/PostgREST and actual two-session receiving/cancellation waits: manual procedure in `docs/testing/tenant-isolation.md` § 10. Embedded execution verifies locking structure, not actual waiting.
- [ ] Deployment/manual: apply the new migration only after its predecessors. Reconcile legacy unknown product types using historical evidence before receiving those POs. No remote Supabase access, commit or push performed.
- No product decision is required to use new physical POs. Future explicit service fulfilment, legacy reconciliation evidence, inventory cutover and receipt reversal/purge are outside this task.

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
