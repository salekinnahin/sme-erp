# Architecture

## Stack

Intended stack, and what the repository actually uses today:

| Area | Intended | Actual (as of 2026-11-04) |
| --- | --- | --- |
| Framework | Next.js 16 | `next` 16.4.5, App Router |
| UI library | React | `react` / `react-dom` 19.3.0 |
| Language | TypeScript | TypeScript 5, `strict: true` |
| Styling | Tailwind CSS | Tailwind CSS v4, loaded through the `@tailwindcss/turbopack` loader in `next.config.ts` (no PostCSS config) |
| Backend / DB | Supabase + PostgreSQL | Supabase via `@supabase/ssr` and `@supabase/supabase-js`. SQL migrations in `supabase/migrations/` (applied manually or with the Supabase CLI; the CLI is not a project dependency) |
| Auth | Supabase Auth | Implemented: email/password sign-up, sign-in, sign-out, email confirmation |
| File storage | Supabase Storage | Not used yet |
| Hosting | Vercel | Not configured in the repository |
| Linting | ESLint | ESLint 9 with `eslint-config-next` (core-web-vitals + typescript) |
| Tests | — | Vitest 4 (`npm test`) for TypeScript domain/validation logic, `lib/**/*.test.ts`, Node environment. SQL tests in `supabase/tests/`, run in the SQL Editor |

Notable Next.js 16 specifics already in use (read `node_modules/next/dist/docs/` before changing these):

- `proxy.ts` at the repository root replaces the old `middleware.ts`.
- `cacheComponents: true` and `partialPrefetching: true` are enabled in `next.config.ts`. Request-time data, such as auth, must render inside a `<Suspense>` boundary. The Supabase server client calls `connection()` before it reads cookies.
- Root layout uses the global `LayoutProps<"/">` type.

## Layering

```text
UI (app/**, React Server and Client Components)
→ Server Actions / Route Handlers (app/**/actions.ts, app/**/route.ts)
→ Business logic (lib/<domain>/…, plain TypeScript functions)
→ Database (Supabase / PostgreSQL, protected by RLS)
```

Rules:

- UI components render data and collect input. They do not hold business rules.
- Server Actions and Route Handlers read input, authenticate the user, check membership and role, then call domain functions.
- Domain functions such as `createInvoice()`, `recordPayment()` and `adjustStock()` hold the business rules and are reusable from any entry point.
- The database enforces tenant isolation through RLS, plus integrity rules through constraints and transactions. The application layer must not be the only line of defence.

## Current Directory Layout

```text
app/
  layout.tsx                 Root layout (fonts, global CSS)
  page.tsx                   Redirects to /dashboard or /auth/login
  globals.css
  auth/
    actions.ts               Server Actions: signUp, signIn, signOut
    confirm/route.ts         Email confirmation handler (token_hash or PKCE code)
    login/, sign-up/, forgot-password/
    _components/ui.tsx       Shared auth UI (AuthCard, SubmitButton, …)
  _components/               Shared non-auth UI (AppHeader navigation, TenantLoadError,
                             StatusBadge, ListPagination, link styles)
  customers/                 Customer list, new, [id] detail, [id]/edit
    actions.ts               Server Actions: create, update, set status
    _components/             Customer form, deactivate/reactivate control
    error.tsx, [id]/not-found.tsx
  vendors/                   Vendor list, new, [id] detail, [id]/edit (same structure as customers)
  products/                  Product list, new, [id] detail, [id]/edit (same structure), plus
                             categories/ (minimal category list: add, rename, deactivate)
  quotations/                Quotation list, new, [id] detail, [id]/edit (drafts only),
                             [id]/print (browser print view)
    actions.ts               Server Actions: create, update draft, set status
    _components/             Line-item form with preview, status buttons, status badge,
                             print button
  invoices/                  Invoice list, new, detail, draft edit and browser print;
                             issue/cancel controls, sales order conversion
  dashboard/page.tsx         Authenticated landing page (requires an organization)
  dashboard/error.tsx        Error boundary: retryable "couldn't load organization" message
  onboarding/error.tsx       Same error boundary for onboarding
  onboarding/organization/   Create-organization page + Server Action
lib/
  supabase/
    client.ts                Browser client (Client Components)
    server.ts                Server client (Server Components, Server Actions, Route Handlers)
    proxy.ts                 Session refresh helpers used by proxy.ts
  auth/errors.ts             Maps Supabase auth errors to safe user-facing messages
  tenancy/context.ts         getUser / requireUser / getTenant / requireTenant
  organizations/             Organization validation, createOrganization(),
                             getOrganizationDetails() (letterhead)
  customers/                 validation.ts, permissions.ts, customers.ts (domain functions)
  vendors/                   validation.ts, permissions.ts, vendors.ts (domain functions)
  products/                  validation.ts, permissions.ts, errors.ts, products.ts,
                             categories.ts (domain functions)
  quotations/                validation.ts (input, dates, status transitions, RPC payload),
                             calculations.ts (exact line/total math), permissions.ts,
                             errors.ts, quotations.ts (domain functions), options.ts
                             (customer/product choices incl. current references),
                             form.ts (form values, payload parsing, preview; client-safe),
                             status-actions.ts, messages.ts (safe failure messages)
  sales-orders/              validation.ts (input, dates, line IDs, statuses, conversion,
                             RPC payloads; line rules reused from quotations),
                             calculations.ts (re-exports the quotation math), permissions.ts,
                             errors.ts, sales-orders.ts (domain functions)
  invoices/                  validation.ts (input, dates, line IDs, user vs payment statuses,
                             initial balance, sales order conversion, RPC payloads; line
                             rules reused from quotations), calculations.ts (re-exports the
                             quotation math), permissions.ts, errors.ts, invoices.ts
                             (domain functions), plus form, list parameters, selector guards, safe messages,
                             status and conversion presentation (Invoice Part 2)
  validation/fields.ts       Shared field rules (email, phone, UUID, optional text)
  validation/decimal.ts      Decimal-string parsing and BigInt scaled arithmetic (no floats)
  validation/text.ts         Whitespace set and code-point length, matching SQL
  format.ts                  Timestamps in the organization's time zone, calendar dates
                             (formatCalendarDate, for `date` columns); money and
                             quantity formatting on decimal strings (no floats)
supabase/
  migrations/                SQL migrations
  tests/                     SQL tests (tenant isolation, customers, vendors, products, quotations, sales orders, invoices), run in the SQL Editor
lib/**/*.test.ts             Vitest unit tests, next to the code they test
proxy.ts                     Session refresh + optimistic route protection
```

Conventions for new code:

- `lib/<domain>/` for domain logic, e.g. `lib/invoices/`, `lib/inventory/`.
- Shared, non-auth UI components go in `app/_components/`. The form primitives (`Field`, `TextArea`, `Select`, `SubmitButton`, `Alert`) still live in `app/auth/_components/ui.tsx` and are used outside auth. Move them when that file next changes for another reason.

## Tenant-Owned Module Pattern (customers)

Master-data modules follow the customers module. See DECISIONS 013. Vendors (`lib/vendors/`, `app/vendors/`, migration `20261104050000_vendors.sql`) are the second module built on it, and products (`lib/products/`, `app/products/`, migration `20261104070000_products.sql`) the third. Products add a second table (categories) linked by a composite `(organization_id, …)` foreign key, a case-insensitive unique SKU, and decimal-string money handling (DECISIONS 016). Generic presentational pieces (status badge, pagination, link styles) live in `app/_components/`; entity-specific forms and status controls stay in each module.

| Layer | Customers example |
| --- | --- |
| Migration | Table with `organization_id`, CHECK constraints, indexes, RLS on `is_org_member()`, column-level INSERT/UPDATE privileges, no DELETE |
| Role-restricted change | `SECURITY DEFINER` function (`set_customer_status`). It finds the row only through the caller's active membership and role. Authorize before locking: no `SELECT … FOR UPDATE` on rows the caller may not access |
| Search and list | `SECURITY INVOKER` SQL function (`list_customers`), so RLS still applies and user input never becomes a PostgREST filter string |
| Validation | `lib/<domain>/validation.ts`, using `lib/validation/fields.ts` and `lib/validation/text.ts` (shared whitespace set and code-point lengths, DECISIONS 014). Mirrors the CHECK constraints, which use `text_is_trimmed()` / `text_has_whitespace()`. Write invisible or line-breaking characters as escapes, never literally (DECISIONS 019) |
| Permissions | `lib/<domain>/permissions.ts`, with a role → action table |
| Domain functions | `lib/<domain>/<domain>.ts`. They take the tenant from `requireTenant()`. Reads throw on error; writes return `{ ok, reason }` |
| Server Actions | `app/<domain>/actions.ts`. They call `requireTenant()`, validate, call the domain function, and map reasons to safe messages |
| Pages | Request-time data inside `<Suspense>`, `notFound()` for missing or other-tenant IDs, `error.tsx` built on `TenantLoadError` |

## Transaction Document Pattern (quotations)

Transaction documents differ from master data: a header and items change together, totals must not be forgeable, master data is snapshotted, and the document becomes immutable after its first status change. Quotations (`lib/quotations/`, migration `20261104090000_quotations.sql`) set the pattern for sales orders and invoices. See DECISIONS 017 and 018.

| Layer | Quotations |
| --- | --- |
| Tables | Header + items, composite `(organization_id, …)` FKs to customers, products and the header. Snapshot columns for customer and product data. Totals and line amounts stored, with CHECKs that keep each line consistent |
| Privileges | `SELECT` only (RLS on `is_org_member()`). No INSERT/UPDATE/DELETE for any API role |
| Writes | `SECURITY DEFINER` functions (`create_quotation`, `update_quotation_draft`, `set_quotation_status`). They derive the organization, creator, number, snapshots and amounts, and take items as a JSON array in one call, so one transaction covers everything |
| Numbering | `next_document_number()` over `document_number_counters` (row lock, transactional, per organization) |
| Document rules | Triggers: identity columns frozen, status transitions checked, nothing but status changes after draft, items only writable while draft. They apply to every writer |
| Calculations | SQL `numeric` is authoritative. `lib/quotations/calculations.ts` mirrors it with BigInt on decimal strings for previews and early errors |
| Validation / permissions | `validation.ts` (fields, dates, items, status table, RPC payload), `permissions.ts` (role → action, role + transition) |
| Reads | One document = one statement: `get_quotation()` (`SECURITY INVOKER`, RLS applies) returns header + items as JSON with money as text. Never read header and items with separate requests (DECISIONS 020) |
| Domain functions | `quotations.ts`: pre-check customer and products against the tenant for per-field errors, then call the RPC. `getQuotation()` makes a single `get_quotation` call |
| List | `list_quotations()` (`SECURITY INVOKER`), like the master-data lists. Search uses snapshot columns |
| Form | One client form for create and edit. Lines are sent as one JSON field read by an allowlist (`parseFormItems()`); snapshots and amounts are never sent. The preview reuses `validateQuotationItem()` and `calculations.ts`. Customer/product choices are a small server-side search (Server Actions → `option-search.ts` → `options.ts`, reusing `list_customers()` / `list_products()`, active only, 25 per search) plus the current references fetched by ID within the tenant whatever their status (`options.ts`). `app/_components/option-search.tsx` is a dependency-free combobox, shared with sales orders |
| Print | `[id]/print` page with Tailwind `print:` variants and `@media print` in `globals.css`. Browser Print → Save as PDF; no PDF library |

Sales orders (`lib/sales-orders/`, migration `20261104130000_sales_orders.sql`, DECISIONS 022) follow the same pattern for the database, domain, validation and UI layers (Part 2: `app/sales-orders/`, `list_sales_orders()` in `20261104140000_list_sales_orders.sql`). The UI reuses the shared selector and print button (`app/_components/`), the quotation selector search, preview engine (`previewLines()`) and payload parser. Differences:

- A second create path, `create_sales_order_from_quotation()`, copies an accepted quotation's snapshots and amounts instead of reading master data. It is limited to one order per quotation by `unique (organization_id, source_quotation_id)`.
- Draft edits re-snapshot only what changes: the customer only if it changes, and lines only if they are not kept by `id` with the same product.
- Calculations and line validation are imported from `lib/quotations/`, not copied.
- The edit form keeps each existing line's ID (`lib/sales-orders/form.ts`): unchanged lines and lines with a changed product send their ID, new lines none, removed lines are omitted. The ID is an edit/reference token for that save only; draft items are re-inserted on save, so row IDs are not durable until confirmation (DECISIONS 022). Kept lines display the snapshot recorded on the order; re-selecting a line's original product restores its recorded description and price.
- The accepted quotation's detail page shows **Create sales order** / **View sales order** from one tenant-filtered lookup (`getSalesOrderForQuotation()`); the conversion itself is only the database function.

Invoices (`lib/invoices/`, migration `20261104150000_invoices.sql`, DECISIONS 023) follow the sales order pattern exactly for the database, domain and validation layers, with UI in `app/invoices/` and `list_invoices()` in migration `20261104160000_list_invoices.sql` (DECISIONS 024). Differences:

- The second create path is `create_invoice_from_sales_order()`: a **confirmed** sales order, locked `FOR SHARE` (confirmed is not terminal, unlike an accepted quotation), copied with its snapshots and amounts. One invoice per sales order ever: `unique (organization_id, source_sales_order_id)`.
- The header carries a balance, `amount_paid` / `amount_due`, reserved for the Payment module. Clients never send it; the database sets `0` / `grand_total` and keeps `amount_due = grand_total − amount_paid` by CHECK. Part 1 pins `amount_paid = 0` with a constraint the Payment migration will drop.
- Statuses split into user transitions (`set_invoice_status()`: issue, cancel) and reserved system transitions (`partially_paid`, `paid`), which the user RPC refuses. The trigger knows the whole lifecycle; the balance constraints make payment statuses unreachable until payments exist.
- The invoice migration adds one trigger to `sales_orders`, `sales_orders_block_invoiced_cancel`: an invoiced sales order cannot be cancelled (it may be completed). The sales order functions are unchanged.
- `paid` means settled (`amount_due = 0`, `amount_paid = grand_total`), so a zero-total invoice can be `paid` once payments exist.
- `getInvoiceForSalesOrder()` is the tenant-filtered lookup for the **Create invoice / View invoice** control on the sales order page.

## Request and Auth Flow

1. `proxy.ts` runs on every non-static request. It calls `updateSession()`, which refreshes the Supabase session cookies and returns the user.
2. The proxy redirects **optimistically only**. Unauthenticated users are sent away from `/dashboard`, `/onboarding`, `/customers`, `/vendors`, `/products`, `/quotations`, `/sales-orders` and `/invoices`, and authenticated users are sent away from the login and sign-up pages.
3. Every protected page, Server Action and Route Handler must re-check the user server-side. Use `requireUser()` or `requireTenant()` from `lib/tenancy/context.ts` (built on `supabase.auth.getUser()`). Never rely on `getSession()` or on client state for authorization.
4. Organization routing happens in pages, not the proxy. `requireTenant()` sends users with no active membership to `/onboarding/organization`, and the onboarding page sends members to `/dashboard`. If the membership lookup fails, it throws. The segment's `error.tsx` then shows a generic message with a Retry button. It never redirects and never shows tenant data.
5. Supabase clients are created per request. Never share one across requests.

## Environment Variables

Names only. Values live in `.env.local`, which is gitignored by the `.env*` rule.

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`

No server-only secret, such as a service-role key, is used yet. If one is ever needed, it must not have a `NEXT_PUBLIC_` prefix and must only be imported from server code.

## Not Yet Implemented

- Invitations, member management, role changes
- ERP domain tables other than `customers`, `vendors`, `products`, `product_categories`, `quotations`, `quotation_items`, `sales_orders`, `sales_order_items`, `invoices` and `invoice_items` (no stock or payments yet)
- Supabase Storage usage
- Automated UI / end-to-end tests

## Organization Feature Entitlements

`organization_features` is a small platform capability (DECISIONS 025), initially supporting only `rentals`. It has no module UI, routes or management Server Actions. `lib/organizations/feature-keys.ts` provides the client-safe key type and exact runtime allowlist; `lib/organizations/features.ts` is marked `server-only`.

Use `await hasOrganizationFeature("rentals")` from server navigation, routes or actions. It resolves `getTenant()` through the verified Auth session, takes no organization argument, and calls `has_org_feature()` with the session organization. Only a literal boolean true without an RPC error grants access. Missing session/membership, invalid keys, errors and exceptions return false. No persistent feature cache is introduced; database checks re-evaluate active membership even if the request's tenant context was loaded earlier. Request data should render inside the existing Suspense boundaries.

The SQL helper is STABLE, SECURITY INVOKER with an empty search path: it needs no elevated privileges because its read can use the member SELECT policy. It checks active membership explicitly and reads only organization ID, key and enabled state under RLS. Missing, disabled, unknown, null and inaccessible inputs return false for authenticated callers. Anonymous callers cannot execute it.

Future modules must enforce **entitlement AND required organization role**: hide navigation/routes when disabled, check the server entry point, and enforce entitlement and permissions inside database RPCs/RLS. For SECURITY DEFINER module writes, explicitly call `has_org_feature()` using the authorized organization and caller JWT; do not rely on invoker RLS alone when the outer function is privileged. The final database mutation must enforce entitlement, since an earlier UI/server read can become stale. No Rental navigation or placeholder is added now.

Migration order: apply the existing migrations through `20261104150000_invoices.sql`, then `20261104160000_list_invoices.sql`, then `20261104170000_organization_features.sql`. The new migration directly depends on the initial organizations/membership migration (`organizations`, `is_org_member`, `set_updated_at`), and changes no invoice behavior. There are no new package dependencies.

## Purchase Order foundation (Part 1)

`lib/purchase-orders/` supplies validation, role/status permissions, safe errors, exact calculation re-exports and create/read/edit/status domain functions. It follows the existing UI → server/actions → domain → database separation, with no UI or Server Actions yet. A future action authenticates with `requireTenant()`, validates raw input and calls these functions; SQL independently authorizes every write. Purchase orders are core ERP functionality and do not use the optional rentals entitlement.

Migration `20261104180000_purchase_orders.sql` adds header/items, a composite vendor key, counter type and private helpers. Public writes are `create_purchase_order`, `update_purchase_order_draft`, `set_purchase_order_status`. Creation resolves organization through the active vendor and active session membership; header/item snapshots and numbers are database-owned. Draft updates lock the authorized document, replace items atomically and recalculate totals. Item triggers lock the parent so a concurrent ordered status cannot permit a late commercial edit. Read one whole document through `get_purchase_order`, never separate header/items requests.

Exact money/quantity strings and quotation calculation helpers are reused; new selections use `purchase_price`. Saved line IDs serve one edit/save only. Future UI must preserve original recorded details when reselecting A after A → B → A, including the PO's recorded price. Snapshots remain readable after vendor/product master changes and deactivation.

Ordering a PO has **no stock effect**. There is no stock movement, quantity update, reservation or receiving dependency. Future Goods Receiving supplies stock-in for inventory products and controls reserved receiving statuses; it will also prevent cancellation after receiving. No receiving workflow is implemented here. Commercial content is frozen outside draft, and DELETE is rejected in every status, including organization cascades.
