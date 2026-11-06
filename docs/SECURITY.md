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

## File Uploads

- Store in private Supabase Storage buckets with organization-scoped paths and policies.
- Serve through signed URLs or server checks. Validate file type and size.

### Organization logos (DECISIONS 029)

- Private bucket `organization-branding`; bucket-level 2 MiB limit and PNG/JPEG/WebP MIME allowlist. **No SVG** (no sanitizing policy exists).
- Fixed key per organization, `organizations/<organization_id>/logo`. `storage.objects` policies: active members SELECT their own organization's key; only active owners/managers INSERT/UPDATE/DELETE it. Keys that do not parse as exactly that shape (other names, extensions, upper case, traversal) match no policy. UPDATE WITH CHECK prevents renaming an object into another tenant's key.
- `organizations.logo_path` can only be NULL or the row's own key (CHECK, also for privileged writers). It changes only through `set_organization_logo` / `clear_organization_logo`, which re-check owner/manager for the given organization; the app passes the session tenant, never a browser value.
- The server validates the actual bytes (signature, size, dimensions) and stores the **detected** content type; the browser `accept` attribute and client checks are hints only. Storage errors are logged server-side and mapped to friendly messages.
- Signed read URLs are created per render (1 hour) and never stored. Print views sign only the tenant's own key.

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

## Purchase Orders (Part 1)

`purchase_orders` and `purchase_order_items` are authenticated SELECT-only, RLS-scoped to active organization membership, with no direct write policies. Anonymous table/RPC access and API execution of internal helpers/counters are revoked. Direct organization/number/creator/status/snapshot/total forgeries cannot mutate tables. Three fixed-search-path SECURITY DEFINER RPCs derive trusted identity, resolve same-tenant active references and validate amounts/dates/items before committing atomically. No organization, snapshots, totals, status, number or creator is accepted as a create argument.

All active roles create/edit drafts/order; only owner/manager cancel. Every user is denied receiving targets, which belong to the future trusted Goods Receiving path. Unknown and cross-tenant document/reference IDs behave equivalently. Draft line tokens must belong to that specific order and occur only once. Kept inactive references retain snapshots; new selections must be active. Composite FKs enforce tenancy even for privileged tooling. Status RPC authorization is checked before locking, then role-checked again in the locking query.

Whole-row triggers freeze identity and post-draft commercial content; item guards serialize against parent status changes. DELETE is blocked for every status and privileged writer, with no purge exception; organization cascades may fail. `get_purchase_order` is STABLE SQL SECURITY INVOKER with empty search path, one-statement header/items, deterministic ordering and decimal strings. No stock/receiving/billing/payment mutation or service-role key is introduced.

## Goods Receiving (Part 1)

Both receipt tables use active-membership SELECT RLS. Anonymous access, API INSERT/UPDATE/DELETE/TRUNCATE and internal trigger/helper execution are revoked, including column writes. Only `create_goods_receipt` (fixed-path SECURITY DEFINER) writes for active owners/managers/employees. There are no edit/delete RPCs. Trusted organization, creator, number, product reference, snapshot, sort and PO state derive in SQL. Raw domain payloads are validated and allowlisted; decimals stay strings.

Creation authorizes the PO before locking and rechecks membership in `FOR UPDATE`; unknown, foreign and disabled-member POs return the same not-found result. References use composite tenant/receipt/PO/source-line/product keys. Wrong-PO, missing and cross-tenant line IDs deliberately share an error. No state from inaccessible receipts is exposed. Reads are fixed-path SECURITY INVOKER single statements with RLS and explicit organization filters. Disabled members lose all visibility and creation rights.

The common PO lock serializes receiving against receiving and cancellation; cumulative received quantities are checked after locking and may never exceed ordered quantities. The item trigger enforces this for privileged inserts too. PO receiving targets remain system-only through the existing status RPC. Any receipt blocks cancellation at the database level.

Receipts seal atomically and must be nonempty at commit. Header changes/deletion, item changes/deletion and insertion into a sealed receipt are blocked by triggers, including for privileged writers. Restrictive FKs preserve source documents and receipt actor; organization deletion and deletion of a receipt creator's Auth user can fail. Membership disabling remains available. There is no purge/reversal exception or user-editable draft. Legacy unknown product types fail closed pending explicit historical reconciliation; current master types never determine existing receiving eligibility. SQLSTATEs map to safe allowlisted messages, including concurrency failures; raw database errors are not sent to future UI.


Goods receipt "Received By" (DECISIONS 032): the recorder's name is snapshotted into `goods_receipts.received_by_name` by a private BEFORE INSERT trigger from `profiles.full_name` of `created_by` (`auth.uid()` in the RPC). The browser never sends it; supplied values are overwritten even for privileged inserts; API roles have no write grant and the immutability trigger blocks later changes, including privileged updates. No profile policy or grant was added: members still read only their own profile and see a co-member's name only as stored on receipts of their own organization (receipt RLS). No email/phone fallback: a recorder without a profile name gets NULL ("Name not recorded").

Goods Receiving review (DECISIONS 028): direct PO receiving states must agree with sealed receipt quantities (GR009), and sealing itself updates the PO. Header insertion locks/validates the source PO and rejects dates before order_date (GR007), including privileged writes. Both PO and receipt tables reject privileged TRUNCATE with explicit statement triggers; their private helpers have no API execution grants. These protections assume enabled triggers, as do the existing immutable-document guards.
