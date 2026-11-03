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
| Tests | — | No test framework is installed yet |

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
  _components/               Shared non-auth UI (TenantLoadError)
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
supabase/
  migrations/                SQL migrations
  tests/                     SQL tests (tenant isolation), run in the SQL Editor
proxy.ts                     Session refresh + optimistic route protection
```

Planned conventions for new code (not yet present):

- `lib/<domain>/` for domain logic, e.g. `lib/invoices/`, `lib/inventory/`.
- Shared, non-auth UI components in a common components folder, created when the first one is needed.

## Request and Auth Flow

1. `proxy.ts` runs on every non-static request. It calls `updateSession()`, which refreshes the Supabase session cookies and returns the user.
2. The proxy redirects **optimistically only**. Unauthenticated users are sent away from `/dashboard`, and authenticated users are sent away from the login and sign-up pages.
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
- Any ERP domain tables
- Supabase Storage usage
- Automated tests
