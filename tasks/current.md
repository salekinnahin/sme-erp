# Current Task

> All agents read this file before starting work. Replace its contents when the active task changes. Keep it short.

## Task

Sales Order Management — **Part 2 (implemented, manual checks open)**: user-facing workflow on top of Part 1 (Roadmap Phase 4). Part 1 business rules unchanged.

## Scope

- In: `/sales-orders` (list, search, status and customer filter, 25 per page), `/sales-orders/new`, `/sales-orders/[id]`, `/sales-orders/[id]/edit` (draft only, line IDs preserved), `/sales-orders/[id]/print`; **Create sales order / View sales order** on accepted quotations; status actions with stale-page handling; `list_sales_orders()` (migration `20261104140000_list_sales_orders.sql`); shared `OptionSearch` and `PrintButton` moved to `app/_components/`; Vitest; SQL tests appended to `supabase/tests/sales_orders.sql`; docs.
- Out: invoices, payments, inventory reservation or deduction, delivery notes, fulfilment, email/WhatsApp, PDF library.

## Permissions (Version 1, unchanged)

| Action | Owner | Manager | Employee |
| --- | --- | --- | --- |
| View, create, convert accepted quotation, edit draft, confirm | ✓ | ✓ | ✓ |
| Complete, cancel | ✓ | ✓ | — |

## Acceptance Criteria

- [x] Direct create and draft edit with searchable active-only selectors, exact preview, server-authoritative amounts
- [x] Edit keeps existing line IDs (also with a changed product), new lines have none, removed lines are omitted; a notes-only edit of a draft with an inactive product succeeds (regression test)
- [x] Conversion from an accepted quotation via `create_sales_order_from_quotation()`; already-converted and stale cases show friendly messages and the page refreshes
- [x] Status buttons per role and status; stale actions show a message and the page refreshes
- [x] Same not-found page for unknown, malformed and other-tenant IDs (detail, edit, print)
- [x] `npm test`, `npm run lint`, `npx tsc --noEmit`, `npm run build` pass; all six SQL suites pass on local PGlite
- [ ] Migration `20261104140000_list_sales_orders.sql` applied to the Supabase project, after `20261104130000_sales_orders.sql` (manual)
- [ ] `supabase/tests/sales_orders.sql` re-run in the Supabase SQL Editor (manual)
- [ ] UI scenarios in `docs/testing/tenant-isolation.md` § 7.3 and the API probe in § 7.2 checked (manual)

## Relevant Docs / Files

- `docs/DECISIONS.md` (017, 018, 020, 022), `docs/DATA_MODEL.md` § sales_orders, `docs/testing/tenant-isolation.md` § 7
- `app/sales-orders/`, `lib/sales-orders/`, `supabase/migrations/20261104140000_list_sales_orders.sql`

## Still open from earlier tasks (manual Supabase steps)

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
