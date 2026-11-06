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
| File storage | Supabase Storage | Organization logos only (private `organization-branding` bucket, DECISIONS 029) |
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
  _components/               Shared workspace shell, page/form/table/document primitives,
                             native dialogs, badges, pagination and safe errors
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
                             getOrganizationDetails() (letterhead), branding.ts
                             (getOrganizationBranding(), logo upload/remove),
                             logo.ts (client-safe logo rules), permissions.ts
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

## Goods Receiving foundation (Part 1)

`lib/goods-receipts/` provides runtime payload validation, permission checks, exact remaining-quantity arithmetic, safe error/message mapping and create/read/summary functions. No UI, routes or Server Actions are added. Future entry points authenticate with `requireTenant()` and pass that context into the domain. The domain checks the selected tenant explicitly, validates the raw payload and uses the database summary for friendly prechecks. The final `create_goods_receipt` RPC independently reauthorizes and revalidates under a PO row lock, so stale application prechecks never permit over-receiving.

The migration `20261104200000_goods_receipts.sql` follows PO list migration `20261104190000`. It extends the existing counter CHECK and the PO line replacement helper to capture/preserve product type; it leaves applied migrations unchanged. Historical unknown types block receiving until deliberate reconciliation (DECISIONS 027). Receipt snapshots always come from PO lines, not current products. Inventory and non-inventory lines count for completion; service lines do not. Service-only POs remain ordered without a physical receipt.

Receipt creation, item validation, transactional GR numbering, sealing and PO receiving-state update are atomic. Authorize before `FOR UPDATE`; recheck membership in the locking query. Item triggers lock the same PO before summing cumulative receipt quantities. Cancellation takes the same lock and is database-blocked after any receipt. Internal sealing and a deferred nonempty constraint prevent incomplete receipts and later item insertion. Every created receipt/item is immutable, even to privileged writers; organization deletion fails rather than purging history.

`get_goods_receipt()` reads one whole document in one statement. `get_purchase_order_receiving_summary()` is the shared query path for UI data and completion: each PO line includes ordered/received/remaining decimal strings, product type and receivable flag under invoker RLS. Reads use stable SQL, fixed paths and deterministic line ordering. Services' arithmetic remaining quantities are visible but ignored for completion.

Goods Receipt is the future source document for stock-in movements; no ledger or quantity column is added. Future inventory creation must emit immutable positive movements for inventory-type receipt items in the same transaction and define the historical cutover explicitly. Native local concurrent-session verification remains manual; no remote Supabase access is part of this task.


Goods Receiving Part 2 UI (DECISIONS 031): `/purchase-orders/[id]/receive` (form), `/goods-receipts` (list), `/goods-receipts/[id]` (read-only detail) and `/goods-receipts/[id]/print` (GRN). The page layer calls `lib/goods-receipts/` only; `receiving.ts` holds pure, client-safe preview rules shared by the form and `app/goods-receipts/actions.ts`, and `messages.ts` maps reasons to safe text. `list_goods_receipts()` (migration `20261104220000`, reshaped by `20261104230000`) is the single invoker read for the list and a PO's receipt history; it returns item count and the stored `received_by_name`. "Received By" is a database-side snapshot of the recorder's profile name taken at creation (DECISIONS 032); the UI never reads other members' profiles. Still no stock effect.

Goods Receiving review (DECISIONS 028): only sealed receipts count in the shared summary. Receipt sealing now reconciles PO status through a private summary-derived helper, covering privileged assembly as well as the RPC. PO INSERT/UPDATE validates receiving states against that helper (`GR009`) without mutating receipts. Header insertion locks the PO and enforces eligibility and received_date >= order_date. Cheap payload checks precede the RPC lock after authorization. BEFORE TRUNCATE guards protect both receipt tables and both PO tables.

## Organization Branding

See DECISIONS 029.

- Route `/settings/organization` (`app/settings/`): read-only company details, current logo preview, Upload/Replace and Remove (owner/manager; employees see the logo only). Grouped sidebar navigation: Settings → Organization; `/settings` is a signed-in proxy prefix.
- Upload: the Server Action reads only the `logo` file, takes the tenant from `requireTenant()`, and calls `uploadOrganizationLogo()`. That checks the role, validates the bytes (`lib/organizations/logo.ts`: signature-detected PNG/JPEG/WebP, ≤ 2 MB, 16–4096 px per side), uploads with the **user's** Supabase session (`upsert`, detected content type) and then calls `set_organization_logo`. No service-role key. `experimental.serverActions.bodySizeLimit` is `3mb` for this upload.
- Read: `getOrganizationBranding(tenant)` uses module-scope React `cache()` for request-only deduplication. Pass the exact `requireTenant()` result (the object from request-cached `getTenant()`), never a fresh copy. It reuses `getOrganizationDetails()` and adds a signed URL (1 hour) created at render time; any signing failure falls back to `logoUrl = null`.
- Documents: `app/_components/document-brand-header.tsx` (`DocumentBrandHeader`: branding + title + number + metadata rows) is the shared letterhead, used by the quotation, sales order, invoice and purchase order print views. The logo is a plain `<img>` in a fixed 4 × 10 rem box (`object-contain`), hidden if it fails to load. Goods receipts and supplier bills can adopt it when their print views are built.


## Workspace UI and navigation (DECISIONS 030)

All main modules use `app/_components/app-layout.tsx`. `AppLayout` places request-time `Workspace` inside Suspense; it resolves `requireTenant()` and the existing private-logo branding helper. `AppFrame` owns only route presentation and the mobile dialog. Server-rendered pages remain children of this client boundary; document/list reads, permission helpers, Server Actions and domain functions are unchanged. Root `app/error.tsx` also handles failures in async module layouts safely through the installed Next.js `retry` callback, which re-fetches server data.

- Desktop: a fixed 248px `AppSidebar`, a 57px `AppTopbar`, and a fluid content area capped at 1560px. At widths below 1024px the same sidebar renderer opens in a native modal drawer. It exposes `aria-expanded`, locks/restores page scroll, returns focus on explicit close/Escape, and closes on selection, route changes and crossing the desktop breakpoint. No client data fetching or new packages.
- `lib/ui/navigation.ts` is the single route registry: Overview (Dashboard); Sales (Customers, Quotations, Sales orders, Invoices); Purchases (Vendors, Purchase orders); Inventory (Products, including categories); Settings (Organization). Active matching uses segment boundaries. There are no unimplemented links. Rental has no routes and no entries, even for an entitled organization. `visibleNavigation` gates future optional groups by an explicit entitlement; no unnecessary feature RPC runs while there is no optional module to show. Actual future module authorization must still use the existing server/database entitlement checks.
- `globals.css` centralizes light-theme surface, border, typography, accent, status, radius, shadow and spacing tokens. Shared semantic CSS classes are scoped to their primitives; document tables never inherit application-table rules. Existing Tailwind utilities remain available. There is no shadcn installation, theme provider, dark-mode control or icon dependency; small SVG icons live in `icon.tsx`.
- Reusable UI in `_components/ui.tsx`: PageContainer, PageHeader/PageActions, SectionCard, FormSection, MetadataList/MetadataItem, MoneySummary, DocumentSummary, FilterToolbar, DataTable, EmptyState and PageSkeleton. `DocumentItems` renders the four documents' stored snapshots and exact-decimal amounts; it does not calculate totals. `MoneySummary` receives already formatted values, including incomplete preview placeholders.
- Lists keep their existing GET forms, parameter parsers, bounded queries, filters and pagination. No automatic search behavior or aggregate/KPI query was introduced. The dashboard is a workspace launcher using the existing organization context, not an analytics dashboard.
- Document workflow controls use `PageHeader.actions`, including sales-order invoice conversion. Permission/transition helpers and action implementations are reused; summary rails contain information only. Documents use main content plus a summary rail at 1280px and above; forms use the same split with a main form and sticky preview/notes rail. Narrow screens stack in DOM order, with horizontal scrolling confined to labelled, focusable data-table regions. Desktop rails are bounded to `100dvh - 105px` with overflow scrolling; below 800px viewport height they become static and unbounded. Mobile rails do not introduce nested scrolling. Filter toolbars use compact visible labels. Master-data forms use grouped sections. All line IDs, prices, snapshots, restore controls, inline errors and selector request-generation logic are retained.
- Status tones are centralized in `lib/ui/status.ts`; each module still owns its status labels and types. Native `ConfirmDialog` supplies modal focus containment, Escape, descriptive labels, safe initial focus on the back/cancel button, and focus return. The description references only the confirmation message, with controls and alerts outside it. Errors inside an open confirmation remain visible in the modal. Buttons still submit the original action form with its original IDs and target status.
- Organization identity uses the existing signed logo URL in a fixed 32px box and falls back to initials on absent/failed images. Organization settings remain read-only except for the existing role-controlled logo actions. Auth/onboarding reuse the same input/button styling without adopting tenant navigation.
- Print isolation: `AppFrame` recognizes only the implemented `/<module>/<id>/print` route shapes (four commercial documents plus the goods received note) and renders `document-print-frame`, with no sidebar, topbar, mobile drawer or application content padding. That wrapper preserves the old screen-preview width/padding and Arial document font; print CSS removes its padding. The four print page sources and `DocumentBrandHeader` are unchanged by the revamp. Print CSS also hides chrome defensively.

UI tests in `lib/ui/` exercise the registry, route states, status/branding presentation and rendered pages using synthetic tenant/domain fixtures. These supplement the existing permission, exact-money, selector-race, form-token, action and domain tests; they do not replace database integration coverage. Native dialog and breakpoint behavior also need browser checks. Fixture helpers are test-only; no preview or test route is exposed in the app.
