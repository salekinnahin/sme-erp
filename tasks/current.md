# Current Task

> All agents read this file before starting work. Replace its contents when the active task changes. Keep it short.

## Task

Vendor Management (Roadmap Phase 2: second tenant-owned master-data module). It follows the customer pattern (DECISIONS 013, 014; ARCHITECTURE § Tenant-Owned Module Pattern).

## Scope

- In: `vendors` table migration (constraints, indexes, RLS, column privileges); `set_vendor_status()` and `list_vendors()` functions; domain functions in `lib/vendors/`; `/vendors` (search, status filter, pagination of 25, newest first), `/vendors/new`, `/vendors/[id]`, `/vendors/[id]/edit`; deactivate (with confirmation) and reactivate; Vendors navigation link; SQL tests; Vitest; docs.
- Out: purchase orders, supplier bills, supplier payments, payables, attachments, import/export, bulk actions, vendor contacts, ratings, procurement, audit log UI, hard delete.

## Permissions (Version 1)

| Action | Owner | Manager | Employee |
| --- | --- | --- | --- |
| View, create, edit | ✓ | ✓ | ✓ |
| Deactivate, reactivate | ✓ | ✓ | — |

## Acceptance Criteria

- [x] Migration `supabase/migrations/20261104050000_vendors.sql`: table, CHECK constraints on the shared text helpers, indexes, RLS, column privileges, no delete
- [x] Organization taken from `requireTenant()`, never from the browser
- [x] Server-side validation with the shared helpers (`lib/validation/`); the database enforces the same rules
- [x] List with server-side search (name, company, phone, phone digits, email), status filter and pagination
- [x] Detail, create and edit pages; deactivate requires confirmation; employees cannot change status
- [x] Unknown, malformed or other-tenant IDs show "Vendor not found"
- [x] `supabase/tests/vendors.sql` passes on local PGlite; `tenant_isolation.sql` and `customers.sql` still pass
- [x] `npm test`, `npm run lint`, `npx tsc --noEmit`, `npm run build` pass
- [ ] Migration `20261104050000_vendors.sql` applied to the Supabase project (manual; needs `20261104030000_…` applied first)
- [ ] `supabase/tests/vendors.sql` run in the Supabase SQL Editor (manual)
- [ ] UI scenarios in `docs/testing/tenant-isolation.md` § Vendors checked (manual)

## Follow-up: customer search trimming

- [x] Migration `20261104060000_align_customer_search_trim.sql`: `list_customers()` trims the search with `public.trim_whitespace()` instead of `btrim()` (function body only; same signature and grants)
- [x] Regression test in `supabase/tests/customers.sql` (Unicode-padded and whitespace-only searches); fails without the migration, passes with it on local PGlite
- [ ] Migration `20261104060000_align_customer_search_trim.sql` applied to the Supabase project (manual; after `20261104030000_…`)
- [ ] `supabase/tests/customers.sql` re-run in the Supabase SQL Editor (manual)

## Relevant Docs / Files

- `docs/DATA_MODEL.md`, `docs/DECISIONS.md` (013, 014, 015), `docs/testing/tenant-isolation.md`
- `lib/vendors/`, `lib/validation/`, `app/vendors/`; reference implementation `lib/customers/`, `app/customers/`

## Completed earlier (code done; details in git history and docs)

- Customer Management: migrations `20261104020000_customers.sql`, `20261104030000_harden_customer_validation.sql`; `lib/customers/`, `app/customers/`; `supabase/tests/customers.sql` (passes on local PGlite)
- Foundation cleanup: shared validation (`lib/validation/`), Vitest, migration `20261104040000_align_organization_validation.sql`

## Still open from earlier tasks (manual Supabase steps)

- [ ] Customers: migrations `20261104020000_customers.sql` and `20261104030000_harden_customer_validation.sql` applied; no `NOT VALID` customer constraints remain (DATA_MODEL § customers); `supabase/tests/customers.sql` run in the SQL Editor; UI scenarios in `docs/testing/tenant-isolation.md` § Customers checked
- [ ] Organization onboarding: migrations `20261104000000_…` and `20261104010000_…` applied; `supabase/tests/tenant_isolation.sql` run; UI scenarios checked
- [ ] Foundation cleanup: migration `20261104040000_align_organization_validation.sql` applied (after `20261104030000_…`); `tenant_isolation.sql` re-run
