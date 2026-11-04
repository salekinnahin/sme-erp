# Decisions

Durable architectural and product decisions. Add new entries at the bottom. Do not rewrite past entries. If a decision changes, add a new entry that supersedes the old one.

Format:

```text
## NNN — Title
Date: YYYY-MM-DD
Status: accepted | superseded by NNN
Context / Decision / Consequences
```

---

## 001 — Stack: Next.js 16 App Router + Supabase

Date: 2026-11-04
Status: accepted

**Decision:** Use Next.js 16 (App Router, TypeScript, Tailwind CSS v4) with Supabase (PostgreSQL, Auth, Storage), deployed on Vercel. No additional major frameworks without explicit approval.

## 002 — Auth via Supabase SSR with server-side `getUser()`

Date: 2026-11-04
Status: accepted

**Decision:** Use `@supabase/ssr` with cookie-based sessions. `proxy.ts` refreshes the session and redirects optimistically. All authorization decisions re-check the user server-side with `supabase.auth.getUser()`.

**Consequences:** Every protected page, Server Action and Route Handler must perform its own auth check.

## 003 — Publishable key only on the client

Date: 2026-11-04
Status: accepted

**Decision:** The app uses `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. No service-role key is used. Introducing one requires explicit approval and a new decision entry.

## 004 — Multi-tenancy by `organization_id` + RLS

Date: 2026-11-04
Status: accepted

**Decision:** All organization-owned data carries `organization_id`. Isolation is enforced by RLS on membership, plus server-side membership checks. Browser-supplied organization IDs are never trusted without verification.

## 005 — Fixed roles for Version 1

Date: 2026-11-04
Status: accepted

**Decision:** Roles are `owner`, `manager` and `employee`. There is no custom role builder in Version 1.

## 006 — Payments as transactions; derived balances; no overpayment

Date: 2026-11-04
Status: accepted

**Decision:** Customer and supplier payments are stored as individual transaction rows. Balances are derived from document totals minus valid payments. Overpayments and customer credit balances are out of scope for Version 1.

## 007 — Inventory via stock movements; no negative stock

Date: 2026-11-04
Status: accepted

**Decision:** Stock on hand is derived from append-only `stock_movements`. A mutable product quantity is never authoritative. Draft quotations and sales orders do not move stock. Negative stock is rejected.

## 008 — Historical documents snapshot master data

Date: 2026-11-04
Status: accepted

**Decision:** Transaction documents store the relevant master-data values, such as names, prices and tax, at the time of the transaction. Later master-data edits do not alter historical documents.

## 009 — Repository is the shared source of truth for AI agents

Date: 2026-11-04
Status: accepted

**Decision:** `AGENTS.md` holds the primary engineering rules for all agents (Codex, Claude Code, ChatGPT and others). `CLAUDE.md` points Claude Code to it. `docs/` holds product, architecture, data model, security, decisions and roadmap. `tasks/current.md` holds the active task.

**Consequences:** The `next dev`-generated block in `AGENTS.md` (between the `nextjs-agent-rules` markers) must be kept intact, or `next dev` will re-add it.

## 010 — Tenancy writes go only through SECURITY DEFINER functions

Date: 2026-11-04
Status: accepted

**Context:** Organization creation must atomically create the organization and its owner membership. The browser must never be able to choose `user_id`, `organization_id` or `role`.

**Decision:** `anon` and `authenticated` have `SELECT` only on `profiles`, `organizations` and `organization_members`, and RLS limits which rows they see. The single write path is `public.create_organization()`, a `SECURITY DEFINER` function. It takes `auth.uid()` as the user, fixes `role = 'owner'` and `status = 'active'`, and runs in one transaction with a per-user advisory lock. Profiles are created by an `auth.users` insert trigger. RLS policies use the `SECURITY DEFINER` helper `public.is_org_member(org_id)` to avoid recursive policies on `organization_members`.

**Consequences:** Future tenancy writes (invitations, role changes, organization settings) need either a new function or an explicit new grant and policy. No service-role key is needed. Every `SECURITY DEFINER` function must set `search_path = ''` and derive identity from `auth.uid()`.

## 011 — Server-side tenant context; one active organization per user in V1

Date: 2026-11-04
Status: accepted

**Decision:** `lib/tenancy/context.ts` is the single server-side source for the current user and their organization (`getUser`, `requireUser`, `getTenant`, `requireTenant`). Results are memoized per request with React `cache`. Pages, Server Actions and domain functions take the organization from `requireTenant()`, never from request input. In Version 1 a user has at most one active membership (`create_organization()` enforces this), and there is no organization switching. Organization routing (onboarding vs. dashboard) is done by pages, not by `proxy.ts`. A failed membership query throws instead of being treated as "no organization".

**Consequences:** Supporting several organizations per user later means adding an "active organization" selection. The helper's API can stay the same.

## 012 — Supported currencies and database-side organization validation

Date: 2026-11-04
Status: accepted

**Context:** `create_organization()` can be called directly through the Supabase API, bypassing the Server Action. It accepted any three-letter currency code and any email or phone value. Multi-currency is out of scope for Version 1. Each organization has one base currency.

**Decision:** Version 1 supports a fixed list of base currencies: `BDT` (default), `USD`, `EUR`, `GBP` and `INR`. The onboarding form offers exactly this list (`SUPPORTED_CURRENCIES` in `lib/organizations/validation.ts`). `create_organization()` accepts only this list. It also re-validates the name, email, phone, address and tax number with the same rules as the Server Action, and raises `22023` on invalid input. The duplication is deliberate. The Server Action gives friendly per-field errors, and the database protects against direct RPC calls. Both must be changed together.

**Consequences:** Adding a currency means updating both lists, which needs a new migration. Existing organizations are not re-validated, and no table constraint is added, because clients can only write through the function.

## 013 — Tenant-owned master data: direct RLS writes, column privileges, role-checked functions

Date: 2026-11-04
Status: accepted

**Context:** Customers are the first tenant-owned business table. Vendors and products will follow the same shape. Unlike the tenancy tables (DECISIONS 010), master data is edited often by every role. Only a few fields or state changes are restricted. The Version 1 roles are: all roles view, create and edit customers; only owners and managers deactivate or reactivate them.

**Decision:**

- Clients write master-data tables directly through the Supabase API, protected by four layers:
  1. RLS on `public.is_org_member(organization_id)`. Inserts must also have `created_by = auth.uid()`.
  2. Column-level privileges:
     - INSERT covers `organization_id` and the editable fields.
     - UPDATE covers the editable fields only.
     - `status`, `created_by` and `created_at` are never granted, and there is no DELETE privilege.
  3. CHECK constraints that hold the field rules: trimmed values, NULL rather than `''`, lowercase email, phone format, lengths. They mirror `lib/<domain>/validation.ts`, which gives friendly per-field errors. Both must be changed together.
  4. Server-side role checks in `lib/<domain>/permissions.ts`, applied by Server Actions and domain functions.
- Role-restricted state changes go through a `SECURITY DEFINER` function that checks `public.has_org_role()`, for example `set_customer_status()`. Missing and other-tenant rows raise the same not-found error (`P0002`), so existence is never revealed across tenants.
- Search and paginated lists go through a `SECURITY INVOKER` SQL function, for example `list_customers()`. RLS still applies, LIKE wildcards are escaped, and user input is never turned into a PostgREST filter string.
- Master data is never hard-deleted in Version 1. It is deactivated with `status = 'inactive'` and remains available to historical documents.

**Consequences:** Each new module needs its own migration with grants, policies and constraints, plus its own validation, permissions and domain files (see ARCHITECTURE § Tenant-Owned Module Pattern). Search uses substring `ILIKE` without trigram indexes. That is fine at SME scale, but add `pg_trgm` indexes if lists grow to tens of thousands of rows per organization. Validation is deliberately duplicated in TypeScript and SQL.

## 014 — One whitespace set and code-point lengths in TypeScript and SQL

Date: 2026-11-04
Status: accepted

**Context:** Validation is duplicated in TypeScript and SQL (DECISIONS 012, 013), but the two layers disagreed. JavaScript `trim()`/`\s` treats U+00A0 as whitespace but not U+0085, and PostgreSQL `[[:space:]]` does the opposite (and depends on the locale). `String.length` counts UTF-16 code units, while `char_length()` counts code points, so a 200-emoji name passed the database but failed the app.

**Decision:**

- **Whitespace** is one explicit set: U+0009–U+000D, U+0020, U+0085, U+00A0, U+1680, U+2000–U+200A, U+2028, U+2029, U+202F, U+205F, U+3000 and U+FEFF. This is the Unicode `White_Space` property plus U+FEFF, which JavaScript also trims. Zero-width characters such as U+200B are not whitespace. It is used for trimming, empty checks and "no whitespace" checks such as email.
  - TypeScript: `trimText()`, `hasWhitespace()` in `lib/validation/text.ts`.
  - SQL: `public.trim_whitespace()`, `public.text_is_trimmed()`, `public.text_has_whitespace()`.
  - Neither layer relies on `trim()`, `\s`, `btrim()` or `[[:space:]]` for these rules.
- **Length** is counted in Unicode code points: `charLength()` in TypeScript, `char_length()` in SQL. Limits are unchanged. Customer form fields have no HTML `maxLength`, because browsers count UTF-16 code units. Phone keeps it, because it only allows ASCII.
- No Unicode normalization (NFC/NFKC). A combining sequence such as `e` + U+0301 counts as two characters in both layers.

**Consequences:** The customers module uses these rules (migration `20261104030000_harden_customer_validation.sql`). Organizations use them too: `lib/organizations/validation.ts` uses the shared helpers, and `create_organization()` calls `trim_whitespace()` and `text_has_whitespace()` (migration `20261104040000_align_organization_validation.sql`). Vendors and products should reuse them. Shared field rules (optional text, email, phone, length message) live in `lib/validation/fields.ts`. Business limits stay in each module's `validation.ts`. The rules are covered by Vitest tests (`lib/**/*.test.ts`, `npm test`) and by the SQL suites. Changing the whitespace set means changing both files in a new migration, and re-validating the affected constraints.

## 015 — Known limitation: Unicode email casing differs between TypeScript and SQL

Date: 2026-11-04
Status: accepted

**Context:** The foundation cleanup aligns whitespace and code-point lengths (DECISIONS 014), but email casing still uses JavaScript `toLowerCase()` in `lib/validation/fields.ts` and PostgreSQL `lower()` in `create_organization()` and customer email constraints. These operations can differ for non-ASCII letters, depending on the database locale/provider. Local PGlite checks with `C.UTF-8` confirmed that `İpek@example.com` becomes `i` + U+0307 + `pek@example.com` in JavaScript but `ipek@example.com` in SQL. Similarly, `ΟΣ@example.com` becomes `ος@example.com` in JavaScript but `οσ@example.com` in SQL. These examples were verified locally; remote Supabase was not accessed.

**Decision:** Record this pre-existing mismatch as accepted technical debt for the foundation cleanup. Keep the current validation behavior for now. This entry qualifies the email consistency described in DECISIONS 012 and 013; the whitespace and code-point rules in DECISIONS 014 remain unchanged.

**Consequences:** The same Unicode email input can be stored differently through the app and a direct organization RPC call. Differences in case expansion can also affect acceptance near the email length limit, and customer email constraints can disagree with app-normalized values under some database locales. ASCII email casing is unaffected. Existing tests do not establish Unicode casing parity between TypeScript and SQL.

**Follow-up:** Define one deterministic email casing policy and implement it consistently in both layers. Add paired TypeScript and SQL regression cases for dotted capital I, Greek final sigma, and the email length boundary. Any database behavior change must use a new migration and assess existing email values before altering them.

## 016 — Products: SKU uniqueness, money precision, types, units, same-tenant categories

Date: 2026-11-04
Status: accepted

**Context:** Products are the third tenant-owned master-data module (DECISIONS 013, 014) and the base for quotations, orders, invoices, purchasing and inventory. They add rules that customers and vendors don't have: an identifying SKU, prices, a product type that decides inventory eligibility, units, and a link to a second tenant-owned table (categories).

**Decision:**

- **Product types** are fixed: `inventory` (will be stock-tracked), `non_inventory` (physical, not stock-tracked) and `service`. Only `inventory` products have a reorder level; for the others `reorder_level` is 0, enforced by a CHECK constraint, and the app forces it to 0.
- **SKU** is required, trimmed with the shared whitespace set, at most 100 code points, and stored as typed. It is unique per organization, **ignoring case**, through a unique index on `(organization_id, lower(sku))`. The same SKU may exist in different organizations. There is no SKU auto-generation. Duplicates are detected only by the database (`23505`), which the app maps to a field error, so there is no TypeScript copy of the case rule. Category names follow the same rule (unique per organization ignoring case, at most 100 code points).
- **Units** are a fixed list (`pcs`, `unit`, `kg`, `g`, `litre`, `ml`, `box`, `pack`, `set`, `hour`, `day`, `service`), held in `PRODUCT_UNITS` and in a CHECK constraint. There is no unit-management module and no unit conversion.
- **Money**: prices are `numeric(18,2)` in the organization's base currency (no per-product currency, no price lists). The reorder level is `numeric(18,3)` so weight and volume units can use fractions. Values are read as text (`::text`), validated and written as decimal strings, and formatted by string (`formatMoney()`), never via JavaScript numbers. The app rejects extra decimals instead of rounding. CHECK constraints reject negatives and `NaN` (which `numeric` accepts and which compares greater than every number).
- **Categories belong to the same organization** as their products through a composite foreign key `(organization_id, category_id)` → `product_categories(organization_id, id)`. Foreign-key checks bypass RLS, so a plain `category_id` foreign key would let one tenant link (and probe) another tenant's category IDs. Other-tenant and unknown category IDs fail with the same `23503`.
- **Product type changes are allowed** while there is no stock data. When stock movements are added (Phase 3), changing the type of a product that has movements must be restricted or handled explicitly.

**Consequences:** Adding a unit or product type needs a new migration and a change to `lib/products/validation.ts`. Case-insensitive uniqueness uses PostgreSQL `lower()` under the database collation: ASCII SKUs behave the same everywhere, but non-ASCII case folding depends on the collation (see DECISIONS 015), and changing the collation would require rebuilding these indexes. Future modules that link two tenant-owned tables should use the same composite foreign key pattern. Future transaction lines must snapshot product name, SKU and price (DECISIONS 008).
