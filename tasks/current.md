# Current Task

> All agents read this file before starting work. Replace its contents when the active task changes. Keep it short.

## Task

Customer Management (Roadmap Phase 2: first tenant-owned master-data module). It sets the pattern that vendors and products will reuse.

## Scope

- In: `customers` table migration (constraints, indexes, RLS, column privileges); `set_customer_status()` and `list_customers()` functions; domain functions in `lib/customers/`; `/customers` (search, status filter, pagination of 25, newest first), `/customers/new`, `/customers/[id]`, `/customers/[id]/edit`; deactivate (with confirmation) and reactivate; Customers navigation link; SQL tests; docs.
- Out: invoices, quotations, balances, receivables, payments, customer credit, CRM leads or pipeline, tags, attachments, import/export, bulk operations, hard delete, advanced duplicate detection, audit log UI.

## Permissions (Version 1)

| Action | Owner | Manager | Employee |
| --- | --- | --- | --- |
| View, create, edit | ✓ | ✓ | ✓ |
| Deactivate, reactivate | ✓ | ✓ | — |

## Acceptance Criteria

- [x] Migration `supabase/migrations/20261104020000_customers.sql`: table, CHECK constraints, indexes, RLS, column privileges, no delete
- [x] Organization taken from `requireTenant()`, never from the browser
- [x] Server-side validation with friendly per-field errors; the database enforces the same rules
- [x] List with server-side search (name, company, phone, email), status filter and pagination
- [x] Detail, create and edit pages; deactivate requires confirmation; employees cannot change status
- [x] Unknown, malformed or other-tenant IDs show "Customer not found"
- [x] SQL tests `supabase/tests/customers.sql` pass (verified on local PGlite); `tenant_isolation.sql` still passes
- [x] `npm run lint`, `npx tsc --noEmit`, `npm run build` pass
- [x] Review follow-up (3 Medium findings): status RPC authorizes before locking; one whitespace set and code-point lengths in TS and SQL (DECISIONS 014). Migration `20261104030000_harden_customer_validation.sql`. Local PGlite: both SQL suites pass
- [ ] Migration `20261104020000_customers.sql` applied to the Supabase project (manual)
- [ ] Migration `20261104030000_harden_customer_validation.sql` applied; no `NOT VALID` customer constraints remain (manual, see DATA_MODEL § customers)
- [ ] `supabase/tests/customers.sql` run in the Supabase SQL Editor (manual)
- [ ] UI scenarios in `docs/testing/tenant-isolation.md` § Customers checked (manual)

## Relevant Docs / Files

- `docs/DATA_MODEL.md`, `docs/DECISIONS.md` (010, 011, 013, 014), `docs/testing/tenant-isolation.md`
- `lib/customers/`, `lib/validation/fields.ts`, `lib/validation/text.ts`, `app/customers/`

## Still open from the previous task (organization onboarding)

- [ ] Migrations `20261104000000_…` and `20261104010000_…` applied to the Supabase project (manual)
- [ ] `supabase/tests/tenant_isolation.sql` run in the Supabase SQL Editor (manual)
- [ ] UI scenarios in `docs/testing/tenant-isolation.md` checked (manual)

## Foundation cleanup: organization validation alignment + Vitest

- [x] `lib/organizations/validation.ts` uses the shared helpers (`trimText`, `charLength`, `optionalText`, `normalizeEmail`, `isValidEmail`, `isValidPhone`); onboarding form keeps HTML `maxLength` on phone only
- [x] Migration `20261104040000_align_organization_validation.sql` replaces `create_organization()` body with the shared SQL helpers (no table changes)
- [x] Vitest added (`npm test`); tests in `lib/**/*.test.ts`
- [x] `tenant_isolation.sql` covers Unicode whitespace and code-point limits; both SQL suites pass on local PGlite
- [ ] Migration `20261104040000_align_organization_validation.sql` applied to the Supabase project (manual; needs `20261104030000_…` applied first)
- [ ] `supabase/tests/tenant_isolation.sql` re-run in the Supabase SQL Editor (manual)
