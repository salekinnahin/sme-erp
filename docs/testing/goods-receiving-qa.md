# Goods Receiving QA — 2026-11-07

## Verdict and severity counts

**Not ready for release sign-off: QA is incomplete.** Automated receiving checks pass, with no confirmed Critical, High or Medium defect. One Low accessibility defect remains. Actual authenticated browser writes, native concurrent transactions, print preview and the full responsive matrix remain unverified. These gaps are not counted as product defects.

- Critical: **0**
- High: **0**
- Medium: **0**
- Low: **1**

Scope: Goods Receiving Part 1, Part 2, PO integration, receiving/list/history RPCs, immutable snapshots, detail and print. Read the requested repository guidance and relevant implementation/tests. Existing uncommitted work was preserved. No application code, migration, business rule, test assertion, dependency or architectural decision was changed. No remote Supabase access, commit or push.

## Finding GR-QA-001 — blank submission does not move focus to its error

- **Severity:** Low.
- **Route:** `/purchase-orders/[id]/receive`.
- **Source:** `app/goods-receipts/_components/receive-goods-form.tsx:81` and `:131`.
- **Reproduce:** Open a receivable PO, leave all quantities blank and activate **Record goods receipt**. Reproduced in Chrome using the actual component in an isolated local fixture at 375px.
- **Expected:** Submission is rejected, the at-least-one-positive-quantity error appears, and focus moves to the error or a quantity input.
- **Actual:** Submission is correctly rejected and the error appears, but focus remains on **Record goods receipt**. The submit handler calls `.focus()` on `#items-error`, a paragraph without a `tabIndex`, which cannot receive programmatic focus. Chrome's accessibility state confirmed focus remained on Submit. The paragraph has `role="alert"`; screen-reader announcement itself was not tested.
- **Impact:** Keyboard users are left below the error and must navigate back to the quantities. No receipt/data-integrity impact.
- **Recommended fix:** Make the error programmatically focusable with `tabIndex={-1}`, or focus the first open quantity input for this error. Verify native keyboard focus and viewport scrolling after both blank and all-zero submissions.
- **Disposition:** Reported, not fixed, as requested for Low findings.

## Workflow results

“Automated pass” below means locally executed SQL, Vitest or render checks; it does not mean an authenticated end-to-end browser pass.

1. **Ordered → first partial receipt: automated pass.** An additional disposable SQL probe created an ordered PO with inventory 100, non-inventory 20 and service 1. Receiving 30 + 5 created one two-line receipt, left 70/15, and changed the PO to `partially_received`. Service was absent from the receipt. Render tests verify the action for all roles and all three line types. The browser fixture showed both physical inputs and a non-editable service line.
2. **Second partial receipt: automated pass.** Receiving another 20 on the first physical line created a one-line receipt, with cumulative 50 and remaining 50; the other line remained at 15. Zero/blank omission is verified separately through real normalization/action tests; the SQL RPC intentionally requires positive quantities only.
3. **Partial → received: automated pass.** Final 50 + 15 completed the PO, leaving both physical lines at `0.000`. Three distinct GR numbers existed. Service did not block completion. Render tests verify the action disappears and the receive route has no form. The PO summary uses a “Received” badge for a complete line; the underlying summary returns zero.
4. **Over-receive: automated pass; browser validation observed.** With 20 remaining, 21 was rejected in a disposable SQL probe without changing receipt count or receiving summary. The main suite additionally compares the previous receipt and counter before/after rejection. At 375px Chrome showed “You can receive a maximum of 20.000.” No browser database write was attempted.
5. **Blank/zero/mixed: automated pass, with GR-QA-001.** Form/action tests reject all blank/zero and omit zero/blank alongside positive values. Browser blank submission showed “Enter a quantity to receive for at least one line.”
6. **Decimals: automated pass.** Additional SQL probes accepted `1`, `1.5`, `1.250`, `0.001`, preserved exact numeric values and rejected `1.0001`. Quantity storage/readback uses three decimal places; `1.250` remains `1.250`. Vitest verifies comparisons beyond floating-point precision. Chrome rejected four decimals; entering `1.250` reached the disabled “Recording…” state in the fixture. Completion of that stub action was not verified because browser control stopped responding.
7. **Received date: automated pass.** Same-day/later dates succeed; an explicit `2099-01-01` probe succeeds; a date before the PO is rejected. Form/action tests verify friendly date text. No native browser date-picker matrix completed.
8. **Service-only/fully received lines: automated pass.** SQL denies services and already-complete lines, preserves service-only POs as ordered, and prevents excess receipts. Render tests verify no service-only action/form, “Fully received” without an input, and editable remaining physical lines.
9. **Multiple receipts: automated pass.** Unique transactional numbers, sum-derived received quantities, failed-allocation rollback and immutable headers/items passed. History is ordered by received date descending, then created timestamp and ID descending, including deliberately out-of-order received dates. Link markup is verified; browser history navigation was not completed.
10. **Received-by snapshot: automated pass.** SQL verifies trimmed owner/employee names, unnamed manager NULL, rename/clear/disable stability, forged-value overwrite and immutability. Render tests verify list/detail/PO history/print consume the snapshot and use “Name not recorded”, without email fallback. A signed-in browser profile-rename scenario was not performed.
11. **Item count: automated pass.** A mixed-unit three-line receipt reports `item_count = 3`; list/history render that count. The final list RPC has no cross-unit quantity sum or raw creator column.
12. **Cancellation: automated pass.** Backend rejects cancellation after receipts, including the exact guard on an unsealed receipt. UI render tests hide Cancel when history exists. Native receiving-versus-cancellation lock waits remain unverified.
13. **Roles: automated pass.** Simulated authenticated owner/manager/employee SQL contexts can create/read; all roles have view/create permissions, with immutable receipt tables and no edit/delete/cancel endpoint. Render tests verify receiving and read-only detail actions for all roles. Real Auth sessions and role-specific browser printing were not exercised.
14. **Tenant isolation: automated pass.** SQL exercises A/B, disabled and anonymous contexts for reads, creation, list/history and forged IDs. Domain tests enforce the selected tenant and reject malformed IDs. Detail/print/receive route tests verify safe not-found behavior with missing domain results. Native Supabase Auth/PostgREST and actual cross-tenant HTTP route/print requests remain unverified.
15. **List/search: automated pass.** GR number, PO number and vendor snapshot name/company search, literal `%`/`_`, Unicode trimming, 25/page, clamping, totals and stable ordering passed. Required columns are covered by render tests. No interactive browser list/pagination check completed.
16. **Detail: automated pass.** Read-only vendor/document snapshots, received/ordered quantities, recorder name, notes and created metadata render. Header actions are exactly **View purchase order** and **Print** for all roles. No interactive detail browser check completed.
17. **GR print: source/render checks pass; browser print unverified.** GRN uses the shared letterhead/logo component, document/vendor/recorder snapshots, exact quantities, notes, signature lines and a shell-free route. CSS specifies A4/14mm and item rows avoid breaks. Actual logo loading, print preview, clipping and multipage table behavior were not checked; source/render tests cannot establish those outcomes.
18. **Mobile/responsive: partial browser validation only.** At verified 375px Chrome showed stacked line cards, full-width quantity inputs, readable service text, visible primary action and validation text. Screenshots showed content within the viewport for the portions inspected; no DOM overflow measurement was taken. Widths 768/1024/desktop were attempted but not successfully set and verified. Drawer, full-page overflow, receipt detail and list scrolling remain unchecked.
19. **Concurrency: partial automated validation, no actual concurrency pass.** A sequential stale probe on a 50-unit line accepted 30, rejected stale 30 and 21 without receipt/summary artifacts, then accepted 20 and completed the PO. SQL/source inspection confirms a shared parent `FOR UPDATE` lock and post-lock checks. Vitest verifies stale-message mapping, serialization/deadlock/lock-conflict mapping and path revalidation. PGlite does not establish two-session waiting; neither the two-tab flow nor simultaneous transaction races were performed.
20. **No inventory effects: confirmed locally.** Complete product-row JSON before/after the exact three-receipt workflow was identical. Schema inspection found no stock table or product quantity/stock-balance column. No stock movements could be created in this schema. Receiving domain/action/SQL writes and rendered success copy have no inventory update. Success text is “Goods receipt recorded successfully.”
21. **Safe errors: automated pass.** Allowlisted mappings cover missing/inaccessible PO, invalid/service/full lines, over-receive, stale state, date, permissions and serialization/locking conflicts; unknown errors get generic text. Action/route tests cover safe failures and not-found. No raw SQLSTATE/PostgreSQL/Supabase/stack text appeared in the validation messages inspected in Chrome. Actual transport failures were not induced in a live signed-in application.

## Regression execution

- **Vitest:** `npm test` — **1,286 passed, 77 files**, exit 0.
- **Lint:** `npm run lint` — passed, exit 0.
- **TypeScript:** `npx tsc --noEmit` — passed, exit 0.
- **Default build:** `npm run build` — failed both inside and outside the sandbox at Turbopack CSS worker process/port creation: `Operation not permitted`. No application compilation defect was established; the requested default build is not marked passed.
- **Supplemental build:** `npm run build -- --webpack` — passed production compilation, TypeScript and generation of all 49 pages. No configuration/package changes.
- **SQL:** All **24 migrations** applied in order to fresh in-memory PGlite; all **11 suites** passed: `tenant_isolation.sql`, `customers.sql`, `vendors.sql`, `products.sql`, `quotations.sql`, `sales_orders.sql`, `invoices.sql`, `organization_features.sql`, **`purchase_orders.sql`**, **`goods_receipts.sql`**, `organization_branding.sql`. No assertion removed or weakened.
- **Additional SQL probes:** Exact requested workflow, decimal/date checks, sequential stale rejection, immutable prior state and unchanged products passed.
- **Whitespace:** `git diff --check` passed before report creation; checked again afterward.

PGlite bootstrapped simulated `auth.users`, JWT-derived `auth.uid()`, API roles/default grants and minimal Storage tables/RLS. It is real embedded PostgreSQL execution of the repository migrations/suites, but not native Supabase Auth, PostgREST, Storage service or concurrent PostgreSQL sessions. Native `psql`, `supabase` and `docker` commands were not installed on PATH.

Temporary runners: `/private/tmp/goods-receiving-qa-sql.mjs`, `/private/tmp/goods-receiving-qa-probe.mjs`, `/private/tmp/goods-receiving-qa-extra.mjs`. They depend on an existing temporary PGlite installation and are session-local evidence, not supported repository test infrastructure.

## Browser checks actually performed

Chrome native controls loaded `/purchase-orders/qa/receive` on an isolated Vite fixture server at `127.0.0.1:4174`. It renders the repository's actual page, form, shared shell and compiled CSS against synthetic tenant/PO data. Server Actions/domain reads are replaced; Supabase imports are blocked and no remote data can be changed.

Observed: inventory/non-inventory inputs; service with no input; 100/0/100 and 20/0/20; date/notes/context; 375px cards; blank rejection and retained Submit focus; over-receive friendly text; four-decimal rejection; three-decimal submission entering pending state. Initial browser-connector tab creation failed with `timeoutMs`; native controls worked for the observations above, then stopped reflecting navigation/viewport commands. Later viewport, print-navigation and reload attempts produced no verifiable state change. They are not passes. The fixture pending state is not reported as a product defect because the harness/automation could not be distinguished from application behavior.

## Remaining verification and recommendation

**Final recommendation: Not ready.** This is a QA sign-off decision, not evidence of a Critical/High receiving defect. Resolve or explicitly accept GR-QA-001, then complete:

1. Authenticated PO → partial → second receipt → complete → history/detail/print using actual local Supabase, including profile rename and unnamed recorder.
2. Two native transaction/session receiving races and receiving/cancellation races, with rejected losers leaving no receipt/counter artifact; verify refreshed UI and safe conflict messaging.
3. Actual cross-tenant/disabled/malformed/unknown HTTP route and print access with real sessions.
4. Browser A4 print preview with logo, long items/notes, multipage table, signatures and no shell/clipping.
5. Verified 768/1024/desktop layouts, 375px list/detail, overflow, quantity/error focus, drawer open/close/navigation and keyboard behavior.
6. Default Turbopack production build in an environment that permits its worker port binding.

The temporary fixture server was stopped after QA. Browser control could not verify tab closure or reset of the 375px DevTools emulation; the disposable QA tab may remain open.

Only `docs/testing/goods-receiving-qa.md` was added by this QA pass. No durable architecture decision was made, so `docs/DECISIONS.md` was left unchanged.
