# Current Task

> All agents read this file before starting work. Replace its contents when the active task changes. Keep it short.

## Task

Organization onboarding and multi-tenancy foundation (Roadmap Phase 1: organizations and memberships).

## Scope

- In: `profiles`, `organizations`, `organization_members` migration and RLS; atomic `create_organization()` RPC; `/onboarding/organization`; routing (no org → onboarding, member → dashboard); `lib/tenancy/context.ts`; dashboard showing organization and role; tenant isolation test.
- Out: invitations, member/role management UI, organization switching, multi-org UI, subscriptions, organization deletion, logo upload, all ERP domain tables.

## Acceptance Criteria

- [x] Migration with tables, constraints, indexes, RLS (`supabase/migrations/20261104000000_organizations_and_memberships.sql`)
- [x] Organization and owner membership created atomically; user, role and organization derived server-side
- [x] Onboarding page with validation, friendly errors, double-submit protection
- [x] Routing without loops
- [x] SQL tenant isolation test passes (verified on local Postgres/PGlite)
- [ ] Migration applied to the Supabase project (manual)
- [x] Security review fixes: RPC-side validation with supported currencies (`20261104010000_harden_create_organization_validation.sql`), tenant error boundaries, `/test-supabase` removed
- [ ] Follow-up migration `20261104010000_…` applied to the Supabase project (manual)
- [ ] `supabase/tests/tenant_isolation.sql` run in the Supabase SQL Editor (manual)
- [ ] UI scenarios in `docs/testing/tenant-isolation.md` checked (manual)

## Relevant Docs / Files

- `docs/DATA_MODEL.md`, `docs/DECISIONS.md` (010, 011), `docs/testing/tenant-isolation.md`
- `lib/tenancy/context.ts`, `lib/organizations/`, `app/onboarding/organization/`

## Notes / Open Questions

- Defaults: currency `BDT`, time zone `Asia/Dhaka` (assumed primary market).
