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
  organizations/             Organization validation + createOrganization()
  customers/                 validation.ts, permissions.ts, customers.ts (domain functions)
  vendors/                   validation.ts, permissions.ts, vendors.ts (domain functions)
  products/                  validation.ts, permissions.ts, errors.ts, products.ts,
                             categories.ts (domain functions)
  validation/fields.ts       Shared field rules (email, phone, UUID, optional text)
  validation/text.ts         Whitespace set and code-point length, matching SQL
  format.ts                  Date formatting in the organization's time zone; money and
                             quantity formatting on decimal strings (no floats)
supabase/
  migrations/                SQL migrations
  tests/                     SQL tests (tenant isolation, customers, vendors, products), run in the SQL Editor
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
| Validation | `lib/<domain>/validation.ts`, using `lib/validation/fields.ts` and `lib/validation/text.ts` (shared whitespace set and code-point lengths, DECISIONS 014). Mirrors the CHECK constraints, which use `text_is_trimmed()` / `text_has_whitespace()` |
| Permissions | `lib/<domain>/permissions.ts`, with a role → action table |
| Domain functions | `lib/<domain>/<domain>.ts`. They take the tenant from `requireTenant()`. Reads throw on error; writes return `{ ok, reason }` |
| Server Actions | `app/<domain>/actions.ts`. They call `requireTenant()`, validate, call the domain function, and map reasons to safe messages |
| Pages | Request-time data inside `<Suspense>`, `notFound()` for missing or other-tenant IDs, `error.tsx` built on `TenantLoadError` |

## Request and Auth Flow

1. `proxy.ts` runs on every non-static request. It calls `updateSession()`, which refreshes the Supabase session cookies and returns the user.
2. The proxy redirects **optimistically only**. Unauthenticated users are sent away from `/dashboard`, `/onboarding`, `/customers`, `/vendors` and `/products`, and authenticated users are sent away from the login and sign-up pages.
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
- ERP domain tables other than `customers`, `vendors`, `products` and `product_categories` (no stock, documents or payments yet)
- Supabase Storage usage
- Automated UI / end-to-end tests
