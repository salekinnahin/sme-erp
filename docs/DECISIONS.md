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

## 017 — Document numbering: per-organization counter rows

Date: 2026-11-04
Status: accepted

**Context:** Quotations are the first numbered document (`QT-000001`). Sales orders, invoices, purchase orders and bills will follow. Numbers must be unique per organization, generated on the server, and safe under concurrent creates. The browser must not choose them.

**Options considered:**

- `MAX(number) + 1`: two concurrent transactions read the same maximum. Unsafe without a table lock.
- One PostgreSQL sequence per organization: sequences are not transactional. Every failed or rolled-back create burns a number, and sequences have to be created dynamically for each tenant.
- An advisory lock plus `MAX + 1`: works, but the lock is easy to forget on a new write path, and it depends on scanning existing numbers.
- **A counter row per (organization, document type)**: chosen.

**Decision:**

- `public.document_number_counters (organization_id, document_type, last_value)` with primary key `(organization_id, document_type)`. `public.next_document_number(org, type)` runs `INSERT … ON CONFLICT DO UPDATE SET last_value = last_value + 1 RETURNING last_value`.
  - The upsert row-locks the counter until the creating transaction ends, so concurrent creates in one organization are serialized and get distinct numbers. Other organizations are not blocked.
  - A rolled-back create also rolls back its increment, so failed creates leave no gaps. Numbers are never reused once committed, because documents are never deleted.
- The function and table have no client privileges. Only `SECURITY DEFINER` document functions call them, after authorizing the caller.
- Format: prefix + at least 6 digits (`'QT-' || lpad(n, greatest(6, length(n)), '0')`). After `QT-999999` comes `QT-1000000`, never a truncated number. `unique (organization_id, quotation_number)` is the final guard.

**Consequences:** Creates within one organization are serialized for the length of the creating transaction. That is fine at SME scale, and the transactions are short. A new document type adds its value to `document_number_counters_type_check` in a migration. Numbers are opaque text, so sort lists by `created_at`, not by number string, because 7-digit numbers sort lexically before some 6-digit ones.

## 018 — Quotations: database-only writes, snapshots, exact calculations, immutable after draft

Date: 2026-11-04
Status: accepted

**Context:** Quotations are the first transaction document. Unlike master data (DECISIONS 013), a quotation has a header and items that must change together. Its totals must never be forged. It must snapshot customer and product data (DECISIONS 008), and it must become immutable once sent. Authenticated users can call the Supabase API directly.

**Decision:**

- **No client writes.** `authenticated` has `SELECT` only on `quotations` and `quotation_items` (RLS on `is_org_member`). All writes go through three `SECURITY DEFINER` functions (`search_path = ''`): `create_quotation()`, `update_quotation_draft()` and `set_quotation_status()`. They derive `organization_id` (from the customer, only through the caller's active membership), `created_by`, the number, every snapshot field, every line amount and every total. The browser sends only the customer ID, dates, notes, and per item the product ID, quantity, optional unit price, discount, tax rate and optional description. Snapshot or amount keys in the payload are ignored.
- **Atomic.** Create inserts the header and items and computes the totals in one transaction. A draft update locks the authorized header row, rewrites it, deletes and re-inserts all items, and recomputes totals in one transaction. Any error rolls back everything, including the number.
- **Snapshots** are taken by the database at create and at every draft update. A draft therefore shows current master data when it is saved again. Sent and later quotations keep their snapshot forever. A new or updated quotation needs an active customer and active products of the same organization. An unknown ID and another tenant's ID fail identically (`23503`).
- **Calculation model**, with exact `numeric` in SQL and BigInt on decimal strings in TypeScript (`lib/quotations/calculations.ts`):
  - `gross = round(qty × price, 2)`, `tax = round((gross − discount) × rate × 0.01, 2)`, `line_total = gross − discount + tax`
  - `subtotal = Σ gross`, `grand_total = subtotal − discount_total + tax_total`
  - Rounding is half up (PostgreSQL `round(numeric)` on non-negative values), per line, before summing.
  - SQL multiplies by `0.01` rather than dividing by 100, because numeric division can round to a limited scale first, which causes double rounding.
  - Inputs with more decimals than the column allows are rejected, not rounded (quantity 3, money and rate 2).
  - Tax is a per-line rate entered on the quotation: products have no tax field and there is no tax engine (PRODUCT non-scope). Discount is a per-line amount, `0 ≤ discount ≤ gross`.
  - A CHECK constraint makes each stored item satisfy the formula, so no writer can store an inconsistent line.
  - The TypeScript copy exists for previews and friendly errors; the database result is authoritative.
- **Status model:** `draft → sent | cancelled`; `sent → accepted | rejected | expired | cancelled`. The other four statuses are terminal, and repeating a status is rejected. `sent` is allowed for every role; the other transitions are for owners and managers only. `set_quotation_status()` looks up the quotation through the caller's active membership without a lock, checks the role, and then locks the row with the role predicate in the same query, so it never locks or waits on rows the caller may not change. It then checks the transition against the locked status. Unknown, other-tenant and disabled-member cases all raise `P0002`.
- **Immutability is enforced by triggers**, not only by the functions:
  - `quotations_enforce_rules` freezes identity columns and allows only listed transitions. Once a quotation is not a draft, it rejects any change other than `status`, comparing whole rows as JSON so future columns are covered too.
  - `quotation_items_enforce_draft` blocks item insert, update and delete unless the parent is a draft.
  - Both apply to every writer, including `postgres` and future functions.
- **Errors:** `55000` (object_not_in_prerequisite_state) means "not a draft" or "transition not allowed". `lib/quotations/errors.ts` maps it per operation.

**Consequences:**

- A draft that references a customer or product that has since been deactivated must be changed, or the master data reactivated, before it can be saved again.
- There is no automatic expiry: `expired` is a manual owner/manager action in V1. Automatic expiry would need a scheduled job and a new decision.
- Calculation rules exist twice (SQL and `lib/quotations/calculations.ts`). They are pinned to the same examples in `supabase/tests/quotations.sql` and `lib/quotations/calculations.test.ts`. A change to either needs a migration and both test suites.
- Sales orders and invoices should reuse this shape: database-only writes, counter numbering, composite FKs, snapshot columns and triggers for immutability.

## 019 — Whitespace helpers written with escapes; U+2028 / U+2029 restored

Date: 2026-11-04
Status: accepted

**Context:** `20261104030000_harden_customer_validation.sql` wrote the shared whitespace set (DECISIONS 014) with literal characters. A local, uncommitted edit of that file and of `supabase/tests/vendors.sql` lost U+2028 LINE SEPARATOR and U+2029 PARAGRAPH SEPARATOR, because editors treat them as line breaks. The committed `customers.sql` test line had never included them. A database built from such a copy treats them as ordinary characters, so a U+2028-only value passes the "required" checks, which disagrees with `lib/validation/text.ts`. That migration may already be applied remotely, so editing it cannot be the fix.

**Decision:**

- The local `030000` file and `vendors.sql` are restored to their committed content. History is not rewritten.
- New migration `20261104100000_restore_whitespace_line_separators.sql` redefines `trim_whitespace()`, `text_is_trimmed()` and `text_has_whitespace()` with the full set. Signatures, attributes and grants stay the same, so every CHECK constraint and function that uses them picks up the fix. It is idempotent on databases that already have the full set. It reports existing rows that the corrected rules would reject with a `WARNING` per column and modifies nothing.
- From now on, the whitespace set and every test value containing invisible or line-breaking characters are written as ASCII escapes (`\uXXXX` in SQL regular expressions and `E''` strings, `"\uXXXX"` in TypeScript), never as literal characters.
- Regression checks for U+2028 / U+2029 (leading, trailing, only, inner) and U+200B (not whitespace) are in the customers, vendors, products and quotations SQL suites and in `lib/validation/text.test.ts`.

**Consequences:** PostgreSQL does not re-check existing rows when a function used by a CHECK constraint changes. Rows flagged by the migration's warnings keep their values until someone trims them. The set itself is unchanged from DECISIONS 014.

## 020 — A quotation document is read in one statement

Date: 2026-11-04
Status: accepted

**Context:** `getQuotation()` read the header and the items with two requests. A draft saved by someone else between them could return an impossible document, such as old totals with new items.

**Decision:** `public.get_quotation(organization_id, quotation_id)` (migration `20261104110000_get_quotation.sql`) returns the header and its items as one JSON document built by one SQL statement, so both come from the same snapshot.

- It is `SECURITY INVOKER`, `STABLE` and `search_path = ''`, so RLS on `quotations` and `quotation_items` applies. It is executable by `authenticated` only.
- `organization_id` is an extra filter that never widens access.
- Unknown, other-tenant and disabled-member cases all return NULL.
- Money, quantities and rates are JSON strings (`::text`). Items are ordered by `sort_order, id`.
- `getQuotation()` makes exactly one `rpc("get_quotation")` call. `lib/quotations/quotations.test.ts` fails if it queries tables directly or makes more than one call.

**Consequences:** Future document reads (sales orders, invoices) should follow the same one-statement rule. A real two-session race cannot be reproduced in the single-session SQL Editor. The guarantee rests on PostgreSQL statement snapshots and on the test that pins `getQuotation()` to one statement.

## 021 — Document UI: allowlisted line payload, current-reference options, calendar dates, browser print

Date: 2026-11-04
Status: accepted

**Context:** Quotation Management Part 2 adds the first document pages. Sales orders and invoices will need the same pieces: a dynamic line-item form, customer and product pickers, date display and a printable copy.

**Decision:**

- **Line payload.** The form keeps lines in client state and submits them as one hidden JSON field. The server reads it with an allowlist (`parseFormItems()`): string fields only (product, description, quantity, unit price, discount, tax rate, a client key), at most 101 lines read and 1 MB, anything else is ignored. Snapshot fields, amounts, totals and the organization are never sent. The client key maps per-line errors back to the right line after lines are added or removed.
- **Choices keep current references.** Customers and products are chosen with a server-side search (amended after the Part 2 review: originally a capped list of 500, which made later records unreachable). The form's Server Actions take the tenant from the session and call the existing `list_customers()` / `list_products()` RPCs with status `active` and 25 rows per search (same matching, trimming, literal wildcards and `created_at desc, id desc` order as the list pages; no new migration). Product matches are read once more by ID for the description used to prefill a line. Separately, every record the document already references is fetched by ID within the tenant even when inactive (`getCustomerOption()` / `getProductOptions()` in `lib/quotations/options.ts`), and the form keeps it, plus every record chosen since, in state. An edit therefore never shows an empty field for an existing reference, and searching or saving unrelated changes never clears or swaps it. Other-tenant IDs are simply not found.
- **Preview, not authority.** The form preview reuses `validateQuotationItem()` and `calculations.ts` (BigInt on decimal strings). The database result is what is saved and shown afterwards.
- **Calendar dates.** PostgreSQL `date` values (`quotation_date`, `expiry_date`) are formatted with `formatCalendarDate()` (UTC), never `formatDate()`, which would read them as UTC midnight and show the previous day west of UTC. "Today" for a new document is computed in the organization's time zone (`todayInTimeZone()`).
- **Print.** A `/<document>/[id]/print` page styled as white paper with Tailwind `print:` variants and `@media print` in `globals.css`. The app chrome is `print:hidden`. Browser Print → Save as PDF; no PDF library. The letterhead uses the organization's current details (not a snapshot).

**Consequences:** Every active customer and product is reachable by search. Results are ordered newest first (the list RPCs' order), not by name; a search for a common word shows the 25 newest matches and asks for a longer term. The quotation list's customer filter still uses the capped, name-ordered list (unchanged). Printed letterheads change when the organization's details change; only the document content is historical.

## 022 — Sales orders: numbering, statuses, one order per accepted quotation, conversion snapshots, immutable after confirmation

Date: 2026-11-04
Status: accepted

**Context:** Sales Order Management Part 1 adds the second transaction document. An order can be created directly or converted from an accepted quotation. The accepted quotation is the commercial agreement, so the order must reflect it even if master data changed afterwards. Authenticated users can call the API directly.

**Decision:**

- **Same shape as quotations (DECISIONS 018).** `sales_orders` + `sales_order_items`, `SELECT`-only for clients (RLS `is_org_member`), writes only through `SECURITY DEFINER` functions (`create_sales_order`, `create_sales_order_from_quotation`, `update_sales_order_draft`, `set_sales_order_status`), composite tenant FKs (customer, product, header, source quotation), triggers for identity, transitions and post-draft immutability, one-statement read `get_sales_order()` (DECISIONS 020). The line CHECK constraint, rounding and TypeScript calculations are the quotation ones, reused, not copied (`lib/sales-orders/calculations.ts` re-exports `lib/quotations/calculations.ts`; `validateSalesOrderItem()` wraps `validateQuotationItem()`). The SQL line parsing reuses `quotation_parse_decimal()`.
- **Numbering:** `SO-000001`, … per organization from `document_number_counters` with `document_type = 'sales_order'` (DECISIONS 017). The type check was widened in the migration. Failed creates and failed conversions roll back their number.
- **Statuses:** `draft → confirmed | cancelled`, `confirmed → completed | cancelled`. `completed` and `cancelled` are terminal; no delivery or shipping statuses in V1.
- **Permissions:** every active member may view, create, convert, edit drafts and confirm. Owners and managers may also complete and cancel. Enforced in `lib/sales-orders/permissions.ts`, the domain functions and `set_sales_order_status()`.
- **One order per quotation:** `unique (organization_id, source_quotation_id)`. Direct orders have `source_quotation_id` NULL and are not limited, because NULLs are distinct. The conversion function checks first for a clear `23505`. Under concurrency, the second conversion waits on the counter row and then hits the unique constraint (`23505`), so it rolls back. A cancelled order still counts: the quotation cannot be converted again.
- **Conversion copies the quotation, not the master data:** customer reference and snapshot, notes, and every line (product reference, snapshot, quantity, price, discount, tax rate, tax amount, line total, order) are copied as stored on the quotation. Customers and products are not re-read, so renames, price changes and **deactivation after acceptance do not block conversion**. Recomputed header totals must equal the quotation's. The quotation itself is never modified. Only `accepted` quotations convert (`55000` otherwise). Unknown, other-tenant and disabled-member quotations all give `P0002`.
- **Direct create and new selections need active master data:** an active customer and active products of the same organization, snapshotted from current data. This is the same rule as quotations.
- **Draft edits re-snapshot only what changes.** This applies to direct and converted orders alike. Once edited, a converted order is its own document; the source quotation stays unchanged.
  - Same `customer_id` as before: the snapshot is kept, and the customer may be inactive. A different customer must be active and is snapshotted fresh.
  - An item may carry `id`, an existing line of the same order. With the same product, the line's product snapshot is kept, its price and description are the defaults, and the product may be inactive. Any other item (no `id`, or a changed product) is a new selection: an active product, with current snapshot and defaults. Unknown, other-order and repeated `id`s are rejected (`22023`), so no snapshot can be copied from another document.
  - Quantities, prices, discounts and tax rates are always re-validated and recomputed.
- **Immutable after confirmation:** once not `draft`, only `status` may change (trigger, whole-row comparison), and items cannot be inserted, updated or deleted. `source_quotation_id`, number, organization and creator never change, not even on a draft.
- **Never deleted:** the same header trigger also fires on DELETE and rejects it for every status and every writer (`55000`), before the item cascade starts. Otherwise a privileged delete could remove an order, its items and its `source_quotation_id` link, and the quotation could then be converted again. The rule also blocks the `organizations` ON DELETE CASCADE. There is no organization-purge workflow in V1; one would have to be built explicitly.
- **Out of scope in Part 1:** UI, inventory reservation or deduction, delivery, invoices, payments.

**Consequences:**

- Editing a draft without sending line `id`s re-snapshots every line from current products, and inactive products then block the save. The Part 2 form must send each existing line's `id`.
- A quotation whose order was cancelled cannot be converted again. Re-ordering needs a new quotation or a direct order. Relaxing this later needs a new decision and a migration, because the uniqueness is a constraint.
- Because a kept customer snapshot is not refreshed, a draft does not pick up customer detail changes unless the customer is changed. This differs from quotation drafts, which always re-snapshot.
- When inventory arrives (Phase 3 / later Part), confirmation or completion is the natural hook for reservation or stock movements; drafts must keep not affecting stock.
