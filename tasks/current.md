# Current Task

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
