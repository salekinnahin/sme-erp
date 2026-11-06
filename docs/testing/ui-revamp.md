# UI revamp verification — 2026-11-06

This UI task preserves domain behavior (DECISIONS 030). Preserve all preceding branding work. Do not run SQL or contact remote Supabase for this verification.

## Goods Receiving Part 2 UI — 2026-11-07

New screens use the existing system only: PageHeader actions, SectionCard, DataTable, MetadataList, DocumentSummary rail, EmptyState, Badge, a read-only detail with no confirmation dialogs, and `DocumentBrandHeader` for the GRN. One new CSS block, `.receiving-table`: Remaining / Receive now columns carry the emphasis; at ≤ 767 px the same table (one input per line) renders as stacked line cards with labelled values. Nav gains "Goods receipts" under Purchases (route exists); `/goods-receipts/<id>/print` bypasses the shell like the other prints. `lib/ui/goods-receipts.test.ts` renders the PO receiving integration, receive page (desktop/mobile markup, terminal states), list, read-only detail and print with synthetic data. Pending manual browser checks: receive form keyboard/mobile cards at 375 px, inline error focus, GRN print preview/A4 and logo. See `docs/testing/tenant-isolation.md` § 10.1.

## Review fixes — verification on 2026-11-06

This section records this follow-up only; the original desktop review below predates these fixes.

### Automated verification

- `npm test`: **1161 passed across 72 files**; 81 additional checks versus the 1080-test task-start baseline.
- `npm run lint`: passed with no warnings/errors.
- `npx tsc --noEmit`: passed.
- `npm run build`: attempted both normally and with escalation; both blocked while Turbopack's CSS worker creates a process/binds a local port (`Operation not permitted`). This is an environment failure, and the default build is not claimed as passing.
- Supplemental `npm run build -- --webpack`: production compilation, TypeScript and all 45 generated pages passed with escalation (required for the existing Google Fonts download). No bundler/config/package changes were made. The final rerun after markup cleanup also passed.
- `git diff --check`: passed.

Focused coverage:

- Root `retry` callback forwarding/click and safe error presentation. Next.js 16.4.5 has stabilized this callback and supplies no `unstable_retry`; installed runtime/types were checked and the user confirmed using `retry`.
- Branding tests exercise installed server React `cache()` through a test-only simulated request dispatcher and the real `requireTenant()` resolver: stable object identity, one organization read/sign for concurrent/repeated consumers, fresh request signing, separate user/organization contexts, and denied missing membership. They do not contact Auth, Storage or Supabase.
- Every role and status for all four documents: exact existing action-helper output appears in PageHeader, Edit remains draft-only, Print remains present, destructive tones remain, and the summary has no workflow buttons. Sales-order Create/View Invoice and invoice-dependent Cancel suppression are covered for all roles.
- All four stale-status components keep safe errors even when refreshed action lists become empty. Quotations no longer lose action state to a status key.
- Visible filter-label and desktop/short-height rail CSS safeguards; both mobile trigger expanded states; logout disabled/busy/announced pending state; confirmation description excludes alerts/buttons.
- Drawer event/effect tests cover scroll restoration, Escape focus return, navigation, route changes, desktop resize/reopen, unmount cleanup and navigation to a shell-free print route. These Node tests do not replace native focus/scroll testing.
- Existing four print route and shell-bypass render tests still pass. Print sources and letterhead component are unchanged from this follow-up's start.

### Browser checks actually performed in this follow-up

The existing disposable Vite harness in `/private/tmp/sme-erp-ui-preview` rendered synthetic tenant data. Supabase imports were blocked and writes were local-only stubs. No application preview route or dependency was added. Browser viewport overrides were reset, and the temporary tab/server were closed afterward.

- [x] Purchase-order draft detail at 390px width: Edit, Mark ordered, destructive Cancel and Print appear above the vendor/items; controls wrap within the header.
- [x] Drawer at 390px width: opens as a native modal, background content leaves the accessibility tree, Close navigation initially receives focus, Escape closes and returns focus to Open navigation.

The browser connector's navigation/DOM APIs failed, so those two checks used native Chrome controls. Further fixture navigation did not yield a reliable completed review; no other screen or behavior is marked checked here.

### Remaining priority manual checks

1. Full mobile drawer check: keyboard focus containment, actual background scroll lock/restoration, navigation and Back/Forward, close button, resize to desktop and back, short-height layouts, screen-reader expanded/pending announcements.
2. All four document detail headers at mobile, tablet and 1024px laptop widths, including sent/confirmed/issued/ordered and terminal statuses, invoice conversion/view and stale-action errors. The 390px PO draft check above is only a partial check.
3. Quotation form: new/edit, selectors, line add/remove/restore, validation, notes and sticky rail on short/tall displays.
4. Sales-order form: the same interactions and layout checks.
5. Invoice form: the same interactions and layout checks.
6. Purchase-order form: the same interactions plus missing purchase price.
7. Real logo upload/replace/remove and broken/wide/tall logo behavior; actual Storage checks remain separate and require an authorized local setup. No remote Supabase was accessed.
8. All four print previews and browser print: shell-free output, letterhead, A4 page breaks, long item tables/notes and financial summaries.

Also pending: representative filter toolbars at narrow widths; confirmation focus/error announcements and logout pending behavior in the browser. Remaining visual debt is the broader breakpoint/long-content/print review and existing legacy zinc/dark utility styling in migrated components. No further visual redesign was included.

### Follow-up scope safeguards and files

Task-start content hashes confirm no changes to SQL/migrations, RPC/RLS, tenancy/session derivation, domain calculations/transitions/permissions, receiving/payment rules, document form payloads/line IDs/selectors/snapshots, print sources, proxy/configuration or dependencies. `lib/organizations/branding.ts` changed only read memoization; the existing branding Server Action changed only success-message text. No SQL suites were run. No commit or push.

Files changed in this follow-up (33):

- `app/_components/app-frame.tsx`
- `app/_components/app-layout.tsx`
- `app/_components/app-topbar.tsx`
- `app/_components/confirm-dialog.tsx`
- `app/_components/logout-button.tsx`
- `app/customers/_components/status-actions.tsx`
- `app/error.tsx`
- `app/globals.css`
- `app/invoices/[id]/page.tsx`
- `app/invoices/_components/convert-sales-order.tsx`
- `app/invoices/_components/status-actions.tsx`
- `app/products/_components/status-actions.tsx`
- `app/purchase-orders/[id]/page.tsx`
- `app/purchase-orders/_components/status-actions.tsx`
- `app/quotations/[id]/page.tsx`
- `app/quotations/_components/status-actions.tsx`
- `app/sales-orders/[id]/page.tsx`
- `app/sales-orders/_components/status-actions.tsx`
- `app/settings/organization/actions.ts`
- `app/settings/organization/logo-settings.tsx`
- `app/vendors/_components/status-actions.tsx`
- `docs/ARCHITECTURE.md`
- `docs/DECISIONS.md`
- `docs/testing/ui-revamp.md`
- `lib/organizations/branding-cache.test.ts`
- `lib/organizations/branding.ts`
- `lib/ui/components.test.ts`
- `lib/ui/error-recovery.test.ts`
- `lib/ui/mobile-navigation.test.ts`
- `lib/ui/pages.test.ts`
- `lib/ui/review-regressions.test.ts`
- `lib/ui/status-panel.test.ts`
- `tasks/current.md`

## Original revamp automated coverage (before review fixes)

`lib/ui/` adds 77 checks covering the route registry and real route existence; segment-safe active states; entitlement gating and Rental absence even when enabled; organization initials and image markup; native dialog/skip-link markup; shared financial display; all status labels/tones; rendered GET forms, filter parameters and pagination; empty states; role-sensitive controls; all document create/edit/detail/print routes; missing document handling; logo-management permissions; and stale-action errors after available actions become empty.

These are Node/Vitest render checks with synthetic tenant/domain fixtures. They supplement the existing selector race, input validation, line restoration/token, exact arithmetic, permissions, action allowlist, tenancy and domain tests. They do not execute browser focus, CSS breakpoints, real Auth, Storage or database policies.

## Original revamp browser review

A disposable Vite fixture harness outside the repository rendered the actual application pages and components with synthetic Northstar Trading data. All domain reads and Server Actions were replaced; writes returned a local-only error. The harness blocked Supabase imports and external connections. No preview route or dependency was added to the application.

Inspected desktop screenshots for:

- [x] Sidebar groups, organization initials, active links, bottom account/settings area and topbar
- [x] Dashboard/workspace launcher
- [x] Customers list
- [x] Vendors list
- [x] Products list
- [x] Organization settings without a logo
- [x] Purchase orders list
- [x] Purchase order detail and summary rail
- [x] New purchase order form
- [x] Quotations list
- [x] New quotation form
- [x] Edit quotation form

Observed consistent spacing, button hierarchy, compact tables/status badges, line-editor grouping and preview alignment. Supplier/customer detail cards were tightened into two columns after the initial inspection. Overflow on wide document item tables is intentionally confined to the scrollable table region.

## Original revamp pending browser checks

Browser automation could not reliably target the agent-owned tab in the shared active Chrome session. Native fallback inspected the screens above, but focus changes prevented a safe, complete matrix. Two existing tabs inadvertently navigated to fixture pages were restored. Do not mark the following checks complete based on automated render tests:

- [ ] Mobile/tablet sidebar: opening, modal focus containment, Escape, focus return, navigation close, resizing to desktop
- [ ] Mobile/tablet list and document/form layout: no page-level horizontal overflow; tables scroll within their regions
- [ ] Quotation detail
- [ ] Purchase order edit
- [ ] Sales order list/detail/new/edit
- [ ] Invoice list/detail/new/edit
- [ ] Native status and remove-logo confirmation keyboard behavior, pending state and server-error display
- [ ] Live line selection, add/remove, purchase-price-required hint, saved-line restoration and inactive references in the browser (existing unit/render coverage still passes)
- [ ] Organization avatar with unusually wide/tall logos, broken-image fallback and successful logo replacement/removal
- [ ] All four print previews, then browser print: no sidebar/topbar/drawer, correct A4 layout, totals, page breaks and letterhead
- [ ] Auth forms and unexpected-error/retry screens at narrow widths

Use disposable local fixtures or an explicitly authorized local Supabase environment for these checks. Earlier tasks' real Storage and signed-in integration checks remain separate; this revamp does not claim them complete.

## Original revamp print and backend safeguards

All four print page sources and DocumentBrandHeader are byte-identical to the task-start working copy. AppFrame tests render each print route with only the paper-preview wrapper and its document child. Application headings/tables are scoped; print CSS removes wrapper padding and defensively hides chrome. Actual browser pagination/page-break behavior remains a manual check.

Task-start comparisons confirm no edits to SQL/migrations, existing `lib` domain functions, Server Actions, proxy, configuration or package manifests. Existing uncommitted changes in those areas predate this task and were preserved.
