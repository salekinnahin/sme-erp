# Inventory QA — 2026-11-10

## Verdict

**Not ready for release sign-off: hosted QA is incomplete.** No Inventory product defect was confirmed in the checks completed. Local SQL, unit/render tests and native concurrency checks passed. Hosted schema and existing owner-session Inventory data were inspected, but the requested fresh hosted workflow, full hosted suites and browser matrix are not yet verified.

- Critical: **0**
- High: **0**
- Medium: **0**
- Low: **0**

These are confirmed defect counts, not a claim that unchecked scenarios pass. Browser automation failures are verification blockers, not established application defects. No Medium/Low fix or application change was made.

## Scope and preservation

Reviewed the requested repository guidance, Inventory migration, four SQL suites, `lib/inventory/`, both Inventory routes, shared table/pagination/error components, tenant resolution, Goods Receipt integration, Product error mappings and PO ordering/type guards. Existing uncommitted Inventory UI and documentation work was preserved.

Stock remains a database-derived ledger: receipt sealing posts movements atomically; readers return exact decimal strings; pages resolve the session tenant and only render reads. No stock adjustment, warehouse, valuation, sales stock-out or Supplier Bill feature was added. No commit or push. No durable architecture decision changed, so this pass does not add a DECISIONS entry.

## Automated regression actually executed

- `npm test`: **1,404 passed / 85 files**, exit 0. Includes Inventory readers/formatters, role checks, safe errors, route render checks, zero/inactive/mismatch cases, fixed tenant/product filters, search/pagination links, historical snapshots, signed exact quantities and absence of write/valuation controls. Supabase is mocked in the TypeScript/UI tests; these are not hosted integration tests.
- `npm run lint`: **passed**, exit 0.
- `npx tsc --noEmit`: **passed**, exit 0.
- Default `npm run build`: **failed**, both sandboxed and escalated, while Turbopack's CSS worker creates a process/binds a port (`Operation not permitted`). The default build is not marked passed.
- Documented fallback `npm run build -- --webpack`: **passed**, exit 0; production compilation, TypeScript and all **51** generated pages, including both Inventory routes. No package/configuration change.
- `git diff --check`: passed before report creation; checked again at completion.

### Local SQL, separate from hosted SQL

The current, unchanged repository copies ran after all **25** migrations on fresh PGlite with simulated Supabase Auth/API roles and minimal Storage schema:

- `stock_movements.sql`: **ALL STOCK MOVEMENT CHECKS PASSED**.
- `goods_receipts.sql`: **ALL GOODS RECEIPT CHECKS PASSED**.
- `purchase_orders.sql`: **ALL PURCHASE ORDER CHECKS PASSED**.
- `products.sql`: **ALL PRODUCT CHECKS PASSED**.

The existing native PostgreSQL **18.6** harness was also run against the current repository. All **25 migrations**, all **12 SQL suites**, pre-ledger backfill and isolation probes passed. The server was stopped afterward. Its initial sandboxed initialization failed on shared-memory permission; the escalated isolated run passed.

An additional disposable PGlite probe received `1.500` and compared `SUM(quantity_delta)::text`, current-stock RPC text and movement-history RPC text using SQL string comparisons: **passed**, all exactly `1.500`. The repository suites were not edited. Two initial probe-runner mistakes (replacement escaping, then immediate constraint mode inherited from the suite) were corrected in the temporary runner; neither was a product defect.

Temporary runners use pre-existing packages; no dependencies were added to the repository. Native runner: `/private/tmp/inventory-qa-native.mjs`; decimal probe: `/private/tmp/inventory-qa-decimal.mjs`. They are session-local evidence, not maintained repository test infrastructure. Auth simulation and PostgreSQL 18.6 do not establish hosted Supabase/Auth/PostgREST behavior.

## Hosted migration/schema check actually executed

The signed-in Supabase SQL Editor project was checked against the URL configured locally: **same project**. The ledger migration was **not reapplied**.

A read-only catalog query returned all six expected triggers with `tgenabled = O`:

- `goods_receipts.goods_receipts_post_stock_movements`
- `products.products_guard_type_change`
- `purchase_orders.purchase_orders_validate_inventory_types`
- `stock_movements.stock_movements_derive_from_source`
- `stock_movements.stock_movements_immutable`
- `stock_movements.stock_movements_block_truncate`

The live owner-session Inventory list and detail also returned ledger data. This confirms deployed ledger objects exist, including the later type and ordering guards. **Complete migration equivalence is not verified:** migration-history entry, full remote function bodies, constraints, grants, RLS and backfill reconciliation were not captured. The catalog script also selected reader signatures, but only the final trigger result was visible; their exact signatures are not claimed verified from that output. Older notes calling the migration unapplied must not be used as current hosted evidence.

## Hosted SQL suites

- `stock_movements.sql`: **unverified**. Loading the full current file into the SQL Editor timed out; no success result was observed.
- `goods_receipts.sql`: **not run hosted**.
- `purchase_orders.sql`: **not run hosted**.
- `products.sql`: **not run hosted**.

Local passes above are not substitutes for these hosted results. No assertions were weakened. Only the read-only catalog command has a confirmed successful hosted SQL execution in this pass. The separate QA snippet may remain open with unexecuted editor content; existing user queries were not intentionally replaced.

## Browser checks actually performed

Observed actual signed-in owner-session pages at `localhost:3000`, backed by the configured hosted Supabase environment, rather than synthetic fixture pages:

1. `/inventory`: columns Product, SKU, Unit, Type, Status and Current stock; normal shell/navigation; labelled Current stock table region; two rows and pagination `Showing 1–2 of 2`.
2. Existing `Alu` / `Aloo01` / `kg`: Inventory, Active, **`0.000`**. This demonstrates a real zero-stock row is visible; a new zero-stock fixture was not created.
3. Existing `QA Inventory Product` / `QA001` / `pcs`: Inventory, Active, **`10.000`**. Product ID: `68a0add1-799e-4437-a2d8-48fa0de3fe13`. This pre-existing product was not used as evidence of a fresh 100-unit workflow.
4. `/inventory/68a0add1-799e-4437-a2d8-48fa0de3fe13`: current name/SKU/unit/type/status, **`10.000 pcs`**, correct View product href and one movement.
5. Movement: **Goods receipt**, **`+10.000 pcs (stock in)`**, date **10 Nov 2026**, recorded `QA Inventory Product` / `QA001`, and **GR-000001** linked to `/goods-receipts/4266bd92-de89-4cef-b6f2-2e9984665c10`. The reference href was inspected; successful navigation through it was not verified.
6. No Inventory stock-writing or valuation controls appeared in the inspected list/detail accessibility trees. No cross-product quantity total appeared.

The browser connector failed with an undefined `timeoutMs`. Native Chrome control could read pages, but cross-profile focus, clipboard input and clicks became unreliable (`noWindowsAvailable`, stale targets and timeouts). Recovery was attempted, including user-assisted foreground/profile selection. Unchanged or failed actions were not recorded as successful checks. A native Products screenshot was inspected; it is not an Inventory responsive pass. No viewport dimensions, keyboard/focus behavior or mobile drawer interaction were reliably verified in this pass.

## Workflow results and their limits

1. **Goods Receipt → movement:** local SQL pass. Inventory/non-inventory/service mixed PO creates exactly one movement per received inventory line, with correct product, tenant, source receipt/line, quantity and snapshots. Complete Product-row JSON remains unchanged; no mutable stock field exists. Hosted: one pre-existing movement observed, fresh posting unverified.
2. **Partial/multiple receipts:** local SQL pass for `30 → 30.000`, another `20 → 50.000`, final `50 → 100.000`, exactly three movements and PO `received`. Over-receive `50.001` and post-completion receipt fail without extra stock. UI render tests hide Receive goods on complete POs. Fresh hosted workflow/action disappearance unverified.
3. **SQL/UI reconciliation:** local SQL validates exact SUM/read-model agreement and render tests preserve exact quantities. **Hosted direct SUM versus the real detail value was not compared.** The observed `10.000` is not a reconciliation pass.
4. **Non-inventory:** local SQL pass: physically received, no movement and no ordinary inventory row; eligibility follows the recorded line snapshot. Hosted fixture not created.
5. **Service:** local SQL pass: cannot physically receive and creates no movement/balance. UI tests omit physical inputs. Hosted service workflow unverified.
6. **Zero stock:** local SQL/render pass; existing real active `0.000` row observed. Fresh hosted product with no receipts unverified.
7. **Inactive product:** local SQL/render pass: inactive stock remains visible, retains nonzero balance and unchanged history. Hosted deactivation unverified.
8. **Exact decimals:** local SQL passes `0.001`, supplemental `1.500`, `999999999999999.999` (zero commercial price to stay within monetary limits) and aggregate balances above numeric(18,3). UI helper/render tests preserve three decimals and thousands grouping without authoritative quantity conversion to JS Number. Hosted extreme-value/UI checks unverified.
9. **Snapshots:** local SQL passes permitted name/SKU/unit/description/price/status changes; current-stock metadata changes while movement/receipt snapshots and balances remain unchanged. UI render tests distinguish current and recorded values. Hosted rename/SKU/unit workflow unverified.
10. **Product type lock:** local SQL rejects both Inventory → Service and → Non Inventory with `ST002`, leaving type, history and balance unchanged. Friendly application mapping tested. Hosted form error unverified.
11. **Draft PO ordering guard:** local SQL allows draft-product retype, rejects ordering with `ST006` and unchanged draft/line snapshot, then accepts the same line after restoring Inventory. Safe message and affected-line mapping pass Vitest. Hosted interaction unverified.
12. **Active PO guard:** local SQL rejects leaving Inventory on ordered/partially received inventory lines (`ST003`), including an unreceived line without movements. Once movements exist, `ST002` takes precedence. Hosted interaction unverified.
13. **Posting compatibility:** local SQL deliberately constructs an incompatible product in a rolled-back subtransaction; `ST004` aborts the whole receipt with no movement/header residue. No persistent hosted corruption was created; hosted probe unverified.
14. **Current stock list:** local SQL/render pass and real owner list observed. Current metadata, exact balance and zero stock seen. Inactive/long-content/mismatch hosted examples unverified.
15. **Search/pagination:** local SQL validates case-insensitive name/SKU substring search, literal `%`/`_`, Unicode trim, stable name/ID ordering, clamping, offsets and totals. UI checks enforce 25/page, `q`, preserved search and server RPC filtering. Hosted search and multi-page navigation unverified; only two real rows observed, no excessive fixtures manufactured.
16. **Detail:** local render pass and real owner detail observed with current summary, View product link and movement history. Malformed/unknown/other-tenant safe not-found behavior is automated only.
17. **Movement history:** local SQL passes newest-first business-date/created-at/ID order, exact quantities, GR references and pagination. Render tests pass signed labels, recorded snapshots and links. One real movement observed; hosted ordering across multiple receipts/pagination unverified.
18. **GR source link:** source-type allowlist, href, GR number and tenant-safe destination handling pass automated checks. One real reference href observed; opening that receipt and cross-tenant denial unverified.
19. **Permissions:** local SQL owner/manager/employee can read; disabled/anonymous cannot; API roles cannot write ledger or execute posting helpers. Render tests show read-only Inventory for all active roles. Only the real owner session was inspected.
20. **Tenant isolation:** local SQL A/B/disabled tests and domain/render checks pass, including foreign organization/product filters and destination document reads. Browser organization/product query parameters are ignored in favor of session tenant and route ID. Two real Auth sessions/cross-tenant HTTP routes remain unverified.
21. **Legacy mismatch:** local rolled-back SQL probe preserves row and balance under actual non-inventory type; render tests show list/detail text warnings and no automatic repair. No persistent hosted invalid fixture was created; hosted warning unverified.
22. **Responsive:** source uses the existing receiving-table stacked-card rules below 768px and contained table scrolling; earlier fixture screenshots are documented in `ui-revamp.md`. **No new verified 375/768/1024/1440 real-data matrix** was completed here. Long names/SKUs, maximum balance, zero state and movement links require that browser pass.
23. **Accessibility:** automated markup and source checks pass labelled focusable table regions, ordinary links, text warnings, status labels and stock-in/out screen-reader labels. Real detail accessibility tree includes `+10.000 pcs (stock in)`. Keyboard reachability, visible focus, actual screen-reader output and mobile menu remain unverified.
24. **No stock writing:** confirmed by source/read-boundary/render checks and the real list/detail trees inspected. Inventory has no mutation helper, mutation route or stock-write form; its sole form performs GET search. No Adjust Stock, Manual Stock In/Out, Edit Quantity, Warehouse or Transfer feature.
25. **No valuation:** confirmed by source/render checks and inspected real pages. No inventory value, average cost, FIFO/LIFO/COGS/weighted average or mixed-unit quantity total.
26. **Errors:** local SQL/mapping/render tests pass safe inventory load errors, inline movement failure retaining summary, equivalent missing/foreign IDs and friendly `ST002`/`ST003`/`ST004`/`ST006` messages. Raw database text is not forwarded. Hosted read/transport failures and actual guarded form failures were not induced.

## Concurrency — native local, not hosted

Five actual two-session transactions ran on the isolated native PostgreSQL server:

1. First full receipt held its product lock; retype waited, then failed `ST002` after receipt commit. Final state Inventory plus one movement.
2. Retype on an ordered PO failed `ST003` immediately; after rollback the receipt succeeded. No lock wait was observed in this case (the failed statement released its conflicting work); it is not claimed as a waiting-race pass.
3. Draft-product retype held the product; ordering waited; retype rollback allowed ordering and receiving.
4. Draft-product retype committed while ordering waited; ordering failed `ST006` with `lines: 1`, PO remained draft; restoration allowed ordering.
5. Ordering held the product; retype waited, then failed `ST003` after ordering committed.

All asserted outcomes passed. No deadlock. Final global checks found no non-inventory product with movements and no open inventory PO line whose current product was non-inventory. Backfill/isolation probes also passed (type changes outside READ COMMITTED fail `ST005`). The existing harness uses privileged local type-change connections plus simulated authenticated order/receipt connections; it is not two real Supabase Auth tabs. **Hosted two-session concurrency remains unverified.**

## Findings and release recommendation

No confirmed Inventory defect to reproduce or fix; therefore no defect-severity entries or application patches. The incomplete hosted/browser checks are material release-verification gaps, tracked separately from defect counts.

**Final recommendation: Not ready.** Complete the following before release sign-off:

1. Confirm full remote migration equivalence and run each unchanged hosted SQL suite with its rollback intact.
2. Fresh hosted 100-unit PO with 30/20/50 receipts; compare exact SQL SUM with real detail at 50.000 and 100.000; verify counts/source identity and completion controls.
3. Hosted non-inventory/service, fresh zero, inactive, exact decimals, permitted master edits and friendly type/ordering guards.
4. Real owner/manager/employee/disabled and A/B Auth-session route/RPC/source-link checks.
5. Hosted concurrency, real search/pagination and the four-width responsive/keyboard/mobile-menu matrix.
6. A default Turbopack build in an environment permitting its worker port binding. The webpack fallback already passed.

Only `docs/testing/inventory-qa.md` was added by this QA pass. Existing dirty files predate the pass. No migration was reapplied, no production schema change was made and no new feature was started.
