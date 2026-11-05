# Security

## Secrets

- `.env.local` holds environment values. It is gitignored by the `.env*` rule and must never be committed, printed, or pasted into prompts, logs, issues or chats.
- Only values that are safe to expose may use the `NEXT_PUBLIC_` prefix. Today that means the Supabase URL and the publishable key.
- Server-only secrets, such as a service-role key or database password, must never be prefixed `NEXT_PUBLIC_`, imported into Client Components, or returned to the browser.
- The service-role key bypasses RLS. Do not introduce it without explicit approval and a documented reason in `docs/DECISIONS.md`.

## Authentication

- Supabase Auth handles all credentials. Never store or hash passwords in application tables.
- Server-side code must validate the user with `supabase.auth.getUser()`, which verifies the token with the Auth server. Do not use `getSession()` alone for authorization.
- `proxy.ts` redirects only optimistically. Every protected page, Server Action and Route Handler must check auth itself.
- Never echo passwords back in form state. `app/auth/actions.ts` already follows this rule.
- Map auth errors to safe messages (`lib/auth/errors.ts`). Don't leak internal error details.

## Multi-Tenancy

- Every organization-owned row has an `organization_id`.
- Never trust an `organization_id` from the browser. Resolve it on the server, or verify that the authenticated user is a member of that organization before using it.
- RLS must be enabled on every organization-owned table, with policies scoped to the user's memberships.
- Defense in depth: application-level checks **and** RLS.
- Tenant isolation is a required test case for every feature.

## Authorization

- Fixed roles: `owner`, `manager`, `employee`.
- Enforce role checks on the server and/or in the database. Hiding UI controls is not authorization.

## Data Integrity

- Financial transactions and stock movements are append-only. Corrections use reversing entries or status changes, never silent updates or deletes.
- Use database transactions or Postgres functions for multi-step operations, such as an invoice plus its stock movements, so they cannot be partially applied.
- Enforce no-overpayment and no-negative-stock rules on the server and, where practical, in the database.

## Input Validation

- Validate all input on the server, even if the client also validates.
- Use parameterized queries through the Supabase client. Never build SQL from user strings.

## File Uploads (when added)

- Store in private Supabase Storage buckets with organization-scoped paths and policies.
- Serve through signed URLs or server checks. Validate file type and size.

## CSV Import/Export

- Imports are validated row by row on the server and scoped to the user's organization.
- Exports include only the requesting organization's data.
- Guard against CSV formula injection in exports: escape cells starting with `=`, `+`, `-` or `@`.

## Audit Logs

- Record sensitive actions: financial documents, payments, stock adjustments, role changes, imports.
- Audit log rows are append-only.

## Platform-controlled Feature Entitlements

Feature entitlement answers “Is this organization allowed to use this module?” Role permission answers “Is this user allowed to perform this action inside the module?” Future Rental authorization requires `organization has rentals feature AND user has required organization role`. Neither check replaces the other; UI hiding alone never authorizes an operation.

`organization_features` has RLS on active membership. Authenticated owners, managers and employees can read only their own organization's `organization_id`, `feature_key`, `enabled`. They have no table or column INSERT/UPDATE grants, DELETE/TRUNCATE grants, or write policies. Anonymous users have no table access or helper execution. Disabling membership removes visibility and makes the helper return false. The invoker helper uses a fixed empty search path and returns only a boolean.

Initial entitlement enable/disable operations use trusted platform/database tooling (e.g. a privileged database operator), never the organization session. No management RPC, public Server Action, browser admin role, or service-role credential is introduced. A future platform-admin console must establish an independent, securely verified platform identity and trusted server write path; an organization owner is never a platform administrator.

Example for a trusted database operator only (replace the organization UUID deliberately):

```sql
insert into public.organization_features (organization_id, feature_key, enabled, enabled_at, enabled_by)
values ('<organization uuid>'::uuid, 'rentals', true, now(), null)
on conflict (organization_id, feature_key) do update
set enabled = true, enabled_at = now(), enabled_by = excluded.enabled_by;

-- Disable without losing last-activation metadata.
update public.organization_features set enabled = false
where organization_id = '<organization uuid>'::uuid and feature_key = 'rentals';
```

If a verified platform actor has an Auth user ID, trusted tooling may record it in `enabled_by`; it is never derived from an organization user's request. Use tooling's operational logs for change accountability until an explicit audit/admin workflow exists. The database owner and existing trusted Supabase service administration can bypass RLS by design; their credentials remain outside browser and normal server actions.

Future gated modules must check entitlements in UI/navigation, server actions/routes, and database tables/RPCs/RLS. A server check cannot replace the database mutation check. Errors deny access; callers can present a safe unavailable message and retry without granting access. No feature billing, plans, expiration, trials or per-user entitlements are introduced.
