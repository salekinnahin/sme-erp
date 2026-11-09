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
- **A draft line `id` is an edit/reference token, not a durable identifier** (clarified after the Part 2 review, 2026-11-06). It tells `update_sales_order_draft()` which previously recorded line an item continues, for that one save. `sales_order_replace_items()` deletes and re-inserts the draft's items, so a line's row ID may change after every draft save. The edit form reloads IDs from the saved draft each time. No module may store or reference a draft sales order line by ID. Once the order is confirmed, its items are immutable and their IDs are stable, so downstream documents (delivery, invoices, stock) may reference confirmed lines. Keeping row IDs stable across draft saves would need an in-place update and a new decision. V1 does not need it.
- In the edit form, re-selecting a line's originally recorded product (for example A → B → A) restores that line's recorded snapshot, description and unit price, not the product's current master data (`applyProductToSalesOrderLine()`). A genuinely different product still prefills from its current data. This only affects the form's display and prefill; the database rules above stay authoritative.
- A quotation whose order was cancelled cannot be converted again. Re-ordering needs a new quotation or a direct order. Relaxing this later needs a new decision and a migration, because the uniqueness is a constraint.
- Because a kept customer snapshot is not refreshed, a draft does not pick up customer detail changes unless the customer is changed. This differs from quotation drafts, which always re-snapshot.
- When inventory arrives (Phase 3 / later Part), confirmation or completion is the natural hook for reservation or stock movements; drafts must keep not affecting stock.

## 023 — Invoices: numbering, user vs payment statuses, one invoice per sales order ever, conversion snapshots, reserved balance, immutable after issue

Date: 2026-11-06
Status: accepted

**Context:** Invoice Management Part 1 adds the third sales document, without UI or payments. An invoice is created directly or converted from a confirmed sales order, which is the confirmed commercial agreement. Payments come later and must be able to move the invoice to `partially_paid` / `paid` without users being able to fake it now. Authenticated users can call the API directly.

**Decision:**

- **Same shape as sales orders (DECISIONS 018, 020, 022).** `invoices` + `invoice_items`, `SELECT`-only for clients (RLS `is_org_member`), writes only through `SECURITY DEFINER` functions (`create_invoice`, `create_invoice_from_sales_order`, `update_invoice_draft`, `set_invoice_status`), composite tenant FKs (customer, product, header, source sales order), triggers for identity, transitions, post-draft immutability and no delete, one-statement read `get_invoice()`. Line CHECK, rounding and TypeScript calculations are the quotation ones, reused (`lib/invoices/calculations.ts` re-exports; `validateInvoiceItem()` wraps `validateQuotationItem()`; SQL reuses `quotation_parse_decimal()`).
- **Numbering:** `INV-000001`, … per organization from `document_number_counters` with `document_type = 'invoice'` (DECISIONS 017). Failed creates and conversions roll back their number.
- **Statuses:** `draft`, `issued`, `partially_paid`, `paid`, `cancelled`.
  - User transitions, through `set_invoice_status()`: `draft → issued | cancelled`, `issued → cancelled`.
  - System transitions, reserved for the Payment module: `issued → partially_paid | paid`, `partially_paid → paid`. `set_invoice_status()` refuses `partially_paid` and `paid` for every role (`42501`), before any lookup.
  - `paid` and `cancelled` are terminal. `partially_paid` and `paid` have no path to `cancelled` (no refunds or customer credits in V1).
  - The trigger's transition table (`invoice_status_transition_allowed()`) holds the whole lifecycle, so the Payment module will not need to change it.
- **Permissions:** every active member may view, create, convert, edit drafts and issue; owners and managers may also cancel. Nobody may set a payment status by hand. Enforced in `lib/invoices/permissions.ts`, the domain functions and `set_invoice_status()`.
- **Balance reserved for payments:** `amount_paid` and `amount_due` live on the header, never sent by clients. `amount_due = grand_total − amount_paid` and `0 ≤ amount_paid ≤ grand_total` (no overpayment) are CHECKs; `invoices_status_balance_check` makes the status agree with the balance: `paid` ⇒ `amount_due = 0` and `amount_paid = grand_total` (settled; this **includes a zero-total invoice, 0 / 0**, and does not require `amount_paid > 0`), `partially_paid` ⇒ `amount_paid > 0` and `amount_due > 0`, every other status ⇒ nothing paid. In Part 1, `invoices_no_payments_yet_check` pins `amount_paid = 0` **and** forbids the statuses `partially_paid` / `paid`, so no payment state can be stored by any writer, `postgres` included, not even a zero-total `paid`. New invoices start at `0.00` / `grand_total`; draft saves recompute `amount_due` with the totals. The Payment module will drop that one constraint, record payment transactions, keep `amount_paid` equal to the sum of valid payments and move the status from its own `SECURITY DEFINER` function; the trigger already lets `status`, `amount_paid` and `amount_due` change after issue.
- **One sales order → at most one invoice, ever:** `unique (organization_id, source_sales_order_id)`; a cancelled invoice still consumes the sales order. Direct invoices have NULL and are unaffected. The function checks first for a clear `23505`; under concurrency the second conversion waits on the counter row and hits the constraint.
- **An invoiced sales order cannot be cancelled; it may still be completed.** Trigger `sales_orders_block_invoiced_cancel` (added by the invoice migration) rejects any move of a sales order to `cancelled` while an invoice exists for it (`55000`, `sales order has an invoice and cannot be cancelled`). Any invoice counts, including a cancelled one, because the order stays consumed. Being a trigger, it holds for `set_sales_order_status()` and every other writer; `set_sales_order_status()` itself is unchanged. It is tenant-safe: it only looks at invoices of the order's organization, and API callers reach it only after `set_sales_order_status()`'s membership-scoped lookup (other tenant: `P0002`) and role check (employee: `42501`), so nothing about invoices leaks. `completed` stays terminal; a cancelled sales order cannot be invoiced.
- **Cancel vs invoice race** (READ COMMITTED, the PostgREST default): the conversion holds the sales order `FOR SHARE` until it commits. If the conversion wins, the cancel's row lock waits for it, and the guard then sees the committed invoice and rejects the cancel. If the cancel wins, the conversion's `FOR SHARE` waits for it, then reads `cancelled` and rejects (`55000`).
- **Only `confirmed` sales orders convert** (`55000` for draft, completed and cancelled). Because `confirmed` is not terminal, the conversion locks the authorized sales order row `FOR SHARE`: a concurrent `set_sales_order_status()` (which takes `FOR UPDATE`) waits until the conversion commits, and a conversion that waited on a status change sees the new status.
- **Conversion copies the sales order, not the master data:** customer reference and snapshot, notes and every line (product reference, snapshot, quantity, price, discount, tax rate, tax amount, line total, order) as stored on the confirmed sales order. Customers and products are not re-read, so renames, price changes and **deactivation after confirmation do not block conversion**. Recomputed totals must equal the order's. The sales order is never modified.
- **Direct create and new selections need active master data** of the same organization, snapshotted from current data.
- **Draft edits re-snapshot only what changes** — the sales order rule (DECISIONS 022): unchanged customer keeps its snapshot (may be inactive); a changed customer must be active. An item `id` is an **edit/reference token for that save only**: with the same product, the line's snapshot, price and description are kept as defaults (product may be inactive); a changed product or a new line needs an active product. Unknown, other-invoice and repeated IDs are rejected (`22023`). Draft items are deleted and re-inserted on each save, so draft line IDs are not durable; nothing may reference a draft invoice line. After issue, items are immutable and their IDs stable.
- **Immutable after issue:** once not `draft`, only `status`, `amount_paid` and `amount_due` may change (trigger, whole-row comparison), and items cannot be inserted, updated or deleted. Identity columns (`organization_id`, `invoice_number`, `source_sales_order_id`, `created_at`, `created_by` except to NULL) never change, not even on a draft.
- **Never deleted:** the header trigger rejects DELETE in every status for every writer (`55000`), before the item cascade, with no purge exception. Deleting an organization that has invoices therefore fails until an explicit purge workflow is designed.
- **Out of scope in Part 1:** UI, list RPC, print, payments, receipts, credits, refunds, accounting, stock.

**Consequences:**

- A sales order cannot be invoiced after it is marked `completed`. The workflow is confirm → invoice → (optionally) complete. If completion should come first, the conversion rule must be widened in a new migration.
- An invoiced sales order can only be completed. Its cancellation has to happen on the invoice side (cancel the invoice); the order then stays consumed and confirmed until completed. The invoice UI work hides **Cancel sales order** on an invoiced order; the database guard remains authoritative for concurrent changes and direct API calls.
- A zero-total invoice is consistent with `paid` once payments exist. Who moves it there (the Payment module automatically on issue, or a "settle" action) is for the Payment module to decide; in Part 1 it stays `issued`.
- **Line-level source links stay out of scope until partial invoicing exists.** Invoice lines do not reference sales order lines by ID (only the header references the sales order), and there is no partial invoicing in V1. Confirmed sales order line IDs are stable, so a later link is possible, but it would be a new decision.
- The domain pre-checks in `lib/invoices/invoices.ts` mirror those of `lib/sales-orders/sales-orders.ts` rather than sharing a helper, to leave the sales order module untouched. They are a candidate for extraction when a third document needs them.


## 024 — Invoice UI: shared selectors and decimal previews, draft reference tokens, explicit conversion

Date: 2026-11-06
Status: accepted

**Decision:** Invoice Part 2 adds `app/invoices/` (list, direct create, detail, draft edit, browser print), Server Actions, and `list_invoices()` in migration `20261104160000_list_invoices.sql`. Part 1 write functions, balance constraints, permissions and business rules are unchanged.

- Reuse the quotation selector (`OptionSearch` and its stale-response-safe reducer), tenant-scoped active customer/product searches (25 results), input parser, exact BigInt preview engine, date defaults and print button. Current references load separately by tenant and ID, without a status filter; search never clears the selection. The edit form displays recorded customer/product snapshots. Returning to an original customer/product restores the recorded details.
- Existing draft line IDs are submitted for one save, including when changing the product. New lines omit RPC IDs, removed lines are omitted. Saving redirects to the persisted invoice and editing again loads fresh IDs. No downstream reference uses draft invoice item IDs.
- Read-only balances show zero paid and the preview grand total due on create/edit; detail/list/print show exact persisted balance strings. No payment controls or payment-status actions exist.
- `list_invoices()` is STABLE SQL, SECURITY INVOKER, with fixed empty search path and authenticated-only execution. It filters by organization under RLS, number/customer snapshot search (literal wildcards), status and customer; it returns exact monetary text, source order number and a windowed count, ordered by creation time and ID with bounded pagination. An empty later page offers a first-page link, since a windowed count is absent there.
- Sales order detail performs a tenant-filtered invoice lookup in every status. Confirmed orders without an invoice offer explicit conversion (invoice date and optional due date only). Existing invoices always offer View invoice, including cancelled invoices and completed source orders. Invoiced orders hide Cancel while retaining permitted Complete actions. Server/database checks still resolve races.
- Mutations return allowlisted, safe messages and revalidate affected routes on success or stale-state failures. All pages and actions re-check the session tenant; browser-supplied organizations, totals, balances, snapshots and statuses are never trusted.

**Consequences:** Browser Print → Save as PDF is the export path, with snapshot document content and current organization letterhead. No PDF dependency, payments, accounting, credits or stock effects are introduced. As on the quotation/sales-order lists, the list-page customer dropdown remains capped at 500 plus its current reference; create/edit customer/product searches have no 500-record cap.

**Part 2 review fixes (2026-11-06):** A saved draft line whose selected product differs from its loaded snapshot offers **Restore recorded product**. Restoration uses only that line's recorded product ID, name, SKU, unit, description and unit price, preserving its reference token, quantity, discount and tax rate. This also works for an inactive recorded product; normal product searches remain active-only. Invoice list source numbers link to the sales order only when both the recorded number and the RPC's tenant-filtered source ID exist. Historical labels and Part 1 rules remain unchanged.

## 025 — Organization Feature Entitlements

Date: 2026-11-06
Status: accepted

**Context:** Optional modules need platform-controlled organization eligibility separate from company roles. No platform-admin identity or console exists yet.

**Decision:** Add `organization_features` in `20261104170000_organization_features.sql`, with a controlled text CHECK initially allowing only `rentals`, unique organization/key, UUID identity, enabled default false and last-activation/timestamp metadata. Missing row means disabled. No Rental tables, routes, navigation, placeholder UI, billing or subscriptions are implemented. Add future keys through a new CHECK migration and the shared TypeScript allowlist/type together.

- Features are organization-level entitlements; owner/manager/employee cannot manage them. Entitlement answers “Is this organization allowed to use this module?” Role permission answers “Is this user allowed to perform this action inside the module?” Future Rental access requires both entitlement and required organization role.
- Active members read only their organizations' ID/key/enabled columns through RLS. All API writes are revoked, with no write policies and no privileged management RPC. Platform metadata is not exposed to members.
- `has_org_feature(uuid, text)` is STABLE SQL, SECURITY INVOKER with fixed empty search path. Least privilege suffices: member SELECT privileges and RLS already support this query. Explicit active membership ensures false for inaccessible organizations even when called from a privileged function with a user JWT. Missing/disabled/unknown/null inputs deny. Anonymous execution is revoked.
- `hasOrganizationFeature(feature)` is server-only, takes only the shared `OrganizationFeatureKey`, derives the tenant from the verified session, calls the boolean RPC and grants only on exact true. Errors/exceptions deny; no cross-request entitlement cache or service credential exists.
- Initial management uses trusted platform/database tooling. A future platform-admin console may manage these rows only after a separate secure platform identity and authorization path are designed. Activation metadata is provided by trusted tooling (actor may be null for database-only administration), retained when disabled, and is not a complete audit log.
- Future modules enforce eligibility at UI/navigation, server/actions and database layers. Privileged module RPCs must explicitly check caller entitlement and role; earlier UI/server checks can be stale. No weak browser-accessible admin role is added.

**Consequences:** Existing organizations stay disabled without backfills. The server helper is reusable for future navigation but introduces no menu item today. The root organization FK plus unique `(organization_id, id)` supports tenant-safe future composite references. Trusted database owners remain intentionally privileged. Feature revocation is checked at database statement time; stronger serialization against concurrent admin changes can be designed if a future module requires it. No new dependencies.

## 026 — Purchase Order Management – Part 1

Date: 2026-11-06
Status: accepted

**Decision:** Implement only the vendor-side purchasing database/domain foundation in `20261104180000_purchase_orders.sql` and `lib/purchase-orders/`. No Purchase Order UI, Goods Receiving, inventory ledger/quantities/reservations, bills, payments, rental purchasing or accounting is added. Purchasing is core functionality, not gated by the optional `rentals` entitlement.

- `purchase_orders` and `purchase_order_items` follow the sales document pattern. Composite `(organization_id, id)` references enforce vendor, product and header/item tenancy. The migration adds the missing composite vendor key without changing historical migrations.
- Numbers are `PO-000001`, etc., allocated by `next_document_number(org, 'purchase_order')`. Extend only the controlled counter type CHECK, retaining quotation, sales order and invoice types. Counters are row-locked, transactional and independent per organization/document type; failures roll back number allocation.
- Creation derives the organization through an active vendor and authenticated membership, creator from `auth.uid()`, and snapshots/totals/status/number from the database. Active inventory, non-inventory and service products are all allowed. New product selections default to **purchase_price**, never selling_price. A missing purchase price requires an explicit price. Same numeric parser, rounded line model and exact BigInt preview arithmetic as quotations; no authoritative JS floats.
- Vendor snapshots preserve name, company, phone, email, address and tax number. Product snapshots preserve name, SKU, description and unit. Draft edits keep unchanged vendor snapshots (even if inactive). A new vendor must be active and gets a fresh snapshot. Kept lines (original item ID plus same product) keep their snapshot, description and recorded unit-price defaults, even if now inactive. New/changed products must be active and use current purchase-price defaults. Explicit permitted commercial edits still apply.
- Draft item IDs are temporary reference tokens for **one save**. Unknown, foreign-order, cross-tenant and repeated IDs are rejected atomically; replacement generates new IDs. Future UI must retain a loaded line's original product snapshot and recorded PO price: A → B → A restores the recorded A name/SKU/description/unit/price, including inactive A. Do not substitute A's current purchase_price. Reload IDs after saving. No downstream references to draft item IDs.
- Lifecycle: `draft → ordered`, `draft → cancelled`, `ordered → cancelled` are user transitions. Every active role may view/create/edit drafts/order; only owner/manager cancel. `ordered → partially_received`, `ordered → received`, `partially_received → received` are reserved system transitions for future Goods Receiving. The normal status RPC rejects receiving targets with `42501` for every role. `received` and `cancelled` are terminal. No receiving write path is provided yet; database transition rules reserve the future trusted path.
- Commercial content freezes on leaving draft, including notes/dates/snapshots/totals and all item changes. Whole-row header guards cover future columns. Item guards lock the parent to serialize changes against ordering. Identity is frozen; only the established auth-user deletion nullification of created_by is permitted.
- Purchase orders can never be DELETEd, including drafts, cancelled documents and privileged writers. No purge exception. Organization deletion can consequently fail until a future explicit purge design exists.
- **Creating, editing or ordering a purchase order never changes stock. Goods Receiving will be the stock-in source**, affecting inventory-type products only. No stock mutation dependency is introduced. Future receiving records must tighten cancellation rules once any goods have been received; Part 1 intentionally has no speculative receiving checks.
- API table access is read-only under active-membership RLS. Three SECURITY DEFINER write RPCs have fixed empty search paths, authorization-scoped lookups and internal helpers denied to API roles. `get_purchase_order(org, id)` is one STABLE SQL SECURITY INVOKER statement with RLS, deterministic items and exact decimal strings. Unknown/other-tenant IDs are equivalent. No service credential, new dependency, list RPC or route is required.

**Consequences:** Historical data is displayed from recorded snapshots. Header/item writes and counter allocation are atomic. Native Supabase/PostgREST and real two-session race checks remain separate from local embedded PostgreSQL tests. Goods Receiving, supplier bills/payments and UI remain later tasks.

**Review regression coverage (2026-11-06):** Explicitly reject privileged DELETE while `partially_received`, checking the existing error and unchanged header/items. Cover A → B → inactive A within one unsaved edit: preserve the original reference token, omit B's description/price overrides, and verify recorded A snapshots/PO price plus unchanged quantity/discount/tax against PostgreSQL. The token is consumed on save as already specified; no migration, production helper or business-rule change is needed.

## 027 — Goods Receiving: immutable physical events, PO locking, historical type snapshots

Date: 2026-11-06
Status: accepted

Goods Receiving Part 1 implements PO → Goods Receipt, without UI, inventory ledger, bills, payments or returns. Apply `20261104200000_goods_receipts.sql` after all migrations through `20261104190000_list_purchase_orders.sql`; applied migrations remain unchanged.

- A receipt is an immediate, immutable business event. Header and item UUIDs are durable future stock source references. Numbers use the existing transactional organization/document counter (`goods_receipt`, `GR-000001`), with failed receipts rolling back allocation. `received_date` is a required finite calendar date; the future form defaults it using organization timezone without converting the saved date to a timestamp. Notes use the shared Unicode trim and 2000-code-point limit.
- Any active owner, manager or employee may create/view receipts. No role may edit/delete them. API roles have SELECT under active-membership RLS, no direct writes or helper execution. RPC organization, number, creator, source product, snapshots, quantities and PO receiving status are database-derived/validated. Composite foreign keys bind tenant, receipt, PO, source line and product, including privileged inserts.
- Only `ordered` and `partially_received` POs accept receipts. Each request has 1–100 distinct source lines and positive exact quantities (numeric(18,3)). Ordered quantities never change. Remaining = ordered − sum of all receipt quantities, by source line. Partial deliveries and arbitrarily many receipts are supported, with no over-receiving.
- **Locking:** first authorize without locking, then acquire `FOR UPDATE` on the PO while rechecking membership. All receipt validation, summation, insertion, numbering and status updates run in this transaction. The item insertion trigger takes the same parent lock even for trusted tools. Cancellation already updates/locks that PO row; its new trigger rejects cancellation whenever any receipt exists. At READ COMMITTED, the waiter sums committed receipts after obtaining the lock; repeatable-read/serializable conflicts must be retried after reloading. PO updates occur even when status remains partially_received, establishing a new row version. Error mapping handles serialization, deadlock and lock-timeout SQLSTATEs without exposing DB text. No automatic blind retry of physical receiving.
- `purchase_order_items.product_type` is a historical snapshot. New selections capture master type; kept draft lines preserve their recorded type along with other snapshots. Receiving copies only PO data, even if product master changes type, name, unit or status. Inventory and non-inventory lines are physical/receivable; services are rejected and ignored for completion. A mixed PO becomes received when all physical lines are full. A service-only PO stays ordered: it cannot produce an empty physical receipt and needs a future explicit service-fulfilment design; this task does not invent one.
- **Legacy types:** pre-migration PO lines stay NULL. Historical type cannot be reconstructed from mutable master data. Any unknown line blocks receiving the entire PO (and therefore unsafe completion). A future explicit, reviewed data-reconciliation migration must use historical evidence, specify organization/order/line IDs, lock affected POs and preserve every other value. For frozen POs that migration must deliberately manage the existing item immutability trigger in its transaction. Do not globally backfill from current products, disable guards in normal operations, or silently call unknown lines non-receivable. No public reconciliation API is added. Existing draft unknown lines likewise need reconciliation or an intentional new product selection; keeping an old token preserves unknown.
- Header `sealed` is an internal assembly marker, never a user draft. Creation inserts header/items then seals it. The only permitted header update is false → true without any other field change. A deferred constraint requires a sealed, nonempty receipt at commit; sealed receipts cannot gain lines, including later in the same transaction. UPDATE/DELETE item triggers always reject. These guards also cover privileged tooling. Receipt actor uses a restrictive Auth FK (no nullification exception), so deleting that actor's Auth account is blocked; use membership disabling instead. Organization/PO/line deletion cannot cascade away receiving history; no purge exception exists.
- `get_goods_receipt(org,id)` and `get_purchase_order_receiving_summary(org,po)` are single-statement STABLE SQL SECURITY INVOKER reads, with fixed empty search paths, authenticated-only grants and explicit organization filters under RLS. Receipt lines are ordered by sort_order/id and all quantities are text. The summary is the shared database path for reads and completion, returning each line's ordered, cumulative received and remaining quantities plus type/receivable. Services retain their arithmetic quantities but never count toward physical completion. Unknown/foreign/missing lines share the same safe error; inaccessible PO IDs reveal no state.
- **Goods Receipt is the future source document for stock-in movements.** No stock table, product.quantity, temporary balance or reservations are introduced. Future inventory will atomically emit positive movements for inventory receipt items with `movement_type=purchase_receipt`, `source_type=goods_receipt`, `source_id=receipt.id`, `source_item_id=item.id`, `quantity_delta=received_quantity`. Non-inventory/service lines do not produce stock. Historical receipts will require an explicit inventory cutover/backfill policy when that ledger ships.

Verification: Vitest covers validation, exact arithmetic, permission rules, eligibility, service exclusion, safe error mappings, tenant-filtered domain reads and RPC payloads/stale errors. SQL covers partial/multi-line receiving, complete receipts, snapshots, all roles, tenancy, permissions, sealing, immutability, failures and locking structure. Embedded PostgreSQL cannot prove actual two-session waits; native local checks are documented in `docs/testing/tenant-isolation.md` § 10.


## 028 — Goods Receipt sealing owns PO receiving status

Date: 2026-11-06
Status: accepted

**Context:** The Goods Receiving Part 1 review identified privileged status drift and a TRUNCATE gap. The user confirmed `20261104200000_goods_receipts.sql` has not been applied remotely; this review edits that migration directly. Earlier migrations remain unchanged. No remote Supabase connection was made.

**Decision:** The shared receiving summary counts sealed receipt lines only. A private status helper derives ordered/partially_received/received from that summary, excluding services and refusing completion with unknown types. A PO INSERT/UPDATE trigger rejects mismatched receiving states (including a return to ordered after receiving) with `GR009`, `purchase order receiving status does not match goods receipts`. The normal PO status RPC continues denying both receiving targets.

Receipt header insertion locks the PO and validates its receiving eligibility, known historical types and `received_date >= order_date` (`GR007` for invalid/early dates); sealed-at-insert headers are rejected. The existing false → true-only seal now runs an AFTER UPDATE trigger requiring nonempty items and updating PO status through the same helper, even for privileged writers. The PO validator only reads receipt state, so it never recursively seals or updates receipts. The deferred completeness constraint still rejects unfinished assembly at commit. Sealing writes a PO row version even when its status remains partial. No future-date ban is added.

Cheap finite-date, notes, array/count, UUID shape, duplicate-ID and positive decimal checks run after initial authorization but before the RPC PO lock. Membership is rechecked under lock; trusted state, date comparison, line snapshots and cumulative quantities remain database-validated under that lock.

Statement-level BEFORE TRUNCATE triggers protect goods_receipts, goods_receipt_items, purchase_orders and purchase_order_items with SQLSTATE `55000`, `immutable purchase documents cannot be truncated`. No production trigger is disabled for testing. The cancellation regression assembles an unsealed receipt while the PO is still ordered and checks the exact receipt-specific cancellation error. SQL also verifies privileged sealing, mismatch rejection, 100 → 70 + rejected 31 with unchanged receipt/items/counter/summary, same/later dates and early-date rejection. TypeScript behavior is unchanged; SQL trigger rules are not duplicated in Vitest.

**Consequences:** Unsealed assembly is transient and does not count as completed receiving; item over-receive checks still include all assembled quantities. Database owners can deliberately disable triggers, which is outside normal supported writes. No receiving UI or inventory is introduced.

## 029 — Organization branding: live logo in a private bucket

Date: 2026-11-06
Status: accepted

**Context:** Printed quotations and sales orders need the company logo. The organization table had an unused `logo_url` column with no write path. Storage was not used yet.

**Decision:**

- **Live, not snapshotted.** Branding (logo, name, address, phone, email, tax number) is current organization data. Old documents reprint with the current logo; document-level logo snapshots are out of scope for V1. Document business snapshots (customer, lines, totals) are unchanged.
- **Private bucket + server-signed URLs (Option A).** Bucket `organization-branding`, created by the migration with a 2 MiB limit and PNG/JPEG/WebP allowlist. Pages sign a 1-hour URL at render time; print views are dynamic per request, so this stays simple and reliable, and logos are not publicly enumerable. No URL is stored.
- **One fixed object key per organization**, `organizations/<id>/logo`, without an extension. Replacing overwrites the same key (no abandoned files); the content type is stored with the object. Remove clears the database pointer first, then deletes the object best-effort (a leftover is overwritten by the next upload and is visible to members only).
- **Owner and manager** upload/replace/remove; employees view. Enforced by the Server Action, the domain function, Storage RLS and the RPCs. Not a feature entitlement.
- **Upload through a Server Action** using the user's session (no service role), so the server can validate the actual bytes (signature-detected format, size, 16–4096 px) before Storage sees them. Server Actions accept up to 3 MB bodies for this.
- **No SVG** until an SVG sanitizing policy exists. **No website** field is added (none exists).
- `logo_url` is dropped; the migration refuses if any row has a value.
- Logo rendering uses a plain `<img>` in a fixed box (not `next/image`, whose optimizer would need remote patterns and cannot usefully cache short-lived signed URLs); it hides itself if loading fails.

**Consequences:** Changing the logo changes every reprint, including historical documents; a future requirement to reproduce the exact historical letterhead needs document-level snapshots. Follow-up (same day): invoice and purchase order prints also use `DocumentBrandHeader`; goods receipts and supplier bills can reuse it later. A print page left open longer than an hour keeps its already-loaded image, but a reload re-signs it.


## 030 — Shared light workspace shell and presentation primitives

Date: 2026-11-06
Status: accepted

**Decision:** Replace the horizontal application header with a shared grouped sidebar and compact topbar across all implemented modules. Retain module route locations and existing server-page/action/domain/database boundaries. Request-time identity and private branding load server-side inside Suspense; only navigation/dialog interactions require client state. Root error handling covers the new request-time layouts. No dependency, database, RPC, RLS, calculation, permission, snapshot, status-transition or entitlement behavior changes.

The route registry is shared by desktop and mobile navigation. Only actual routes are registered; empty or non-entitled optional groups are omitted. Rental remains invisible because no Rental route exists, regardless of entitlement. Avoid querying entitlements purely to render an empty group. A future real module must supply a server-verified entitlement and enforce eligibility independently at its entry points and database layer.

Use Tailwind v4 plus semantic CSS tokens/classes and small reusable page, card, filter, table, metadata, document-item and money-summary components. The repository has no shadcn setup; do not introduce a second design framework. Preserve URL-driven GET filters and server pagination. Show no fabricated analytics or new aggregate queries. Light mode is deliberate; no OS-driven dark palette or theme-switching infrastructure is added.

Document/detail and form layouts share a main region and desktop summary rail, stacking on smaller screens. Display existing authoritative amounts; previews continue using the same exact-decimal helpers. Preserve line tokens, inactive references, A → B → A restoration and selector-generation guards. Centralized badge tones change only visual presentation, including neutral expired quotations.

Native HTML dialogs provide modal keyboard behavior without a UI library. Confirmation content stays inside the original action form, including hidden IDs/status, so pending state and server validation remain intact. Cancellation/back receives initial focus; errors are available inside an open modal. Organization avatars use bounded private logos with initials fallback. Logo management roles and read-only organization details are unchanged.

Print route rendering bypasses the workspace shell entirely. A dedicated paper-preview wrapper preserves the previous preview spacing and document font; print media removes wrapper spacing. Application table and heading selectors cannot affect print content. The existing four print page sources and DocumentBrandHeader are retained.

**Consequences:** New module screens should use the shared page/layout primitives and register their implemented route once. Future optional modules still require server/database authorization. No Goods Receiving, stock, payments, analytics or Rental UI is included. New UI tests render synthetic data locally; signed-in integration and real Storage tests remain the earlier tasks' manual checks. No remote Supabase connection, commit or push is part of this task.


### UI review follow-up — 2026-11-06

- Error recovery uses the installed Next.js 16.4.5 `retry` prop, which refreshes server data and resets the boundary. Its runtime/types no longer expose `unstable_retry` (stabilized in 16.3). The user confirmed using the installed API after this discrepancy was verified locally. Raw production error details remain hidden by `TenantLoadError`.
- `getOrganizationBranding` is wrapped in module-scope React server `cache()`. All six render callers pass the unchanged object returned by `requireTenant()`, which returns `getTenant()`'s request-cached object. This stable reference is verified using the installed server React cache and the real tenant resolver in a simulated request dispatcher. Organization reads and private URL signing deduplicate per request; there is no persistent URL cache, session bypass or changed Storage/write behavior.
- Existing document status components live in `PageHeader.actions`, together with Edit/Print and sales-order Create/View Invoice controls. The summary rail holds information only. Permission/transition helpers are unchanged. Quotation action state now survives refreshed statuses like the other documents; its confirmation resets without a status key discarding safe errors.
- Filter labels remain visible and compact. Desktop sticky detail/form rails have a viewport-relative height limit and scroll only at widths >=1280px; sticking and the height limit are disabled below 800px viewport height. Mobile rails remain in normal flow.
- The native mobile drawer exposes expanded state, locks/restores page scroll, returns focus on explicit close/Escape, and closes on navigation/desktop resize. Route changes clear state even when a print route removes the dialog before a close event. Logout feedback uses `useFormStatus` without changing the action. `ConfirmDialog.description` contains only the message; alerts and buttons remain separate.
- The branding action's only change is success-message copy: supported business documents, rather than a fixed list of document types. No mutation logic, RPC, RLS, SQL, pricing, receiving, payment, selector, payload or snapshot changes.

## 031 — Goods Receiving UI: PO-originated receipts, preview-only rules, private "received by"

Date: 2026-11-07
Status: accepted

**Context:** Goods Receiving Part 1 (DECISIONS 027/028) is the authoritative backend. Part 2 adds the UI on the shared shell (DECISIONS 030) without changing those rules or adding inventory.

**Decision:**

- **Receipts always start from a purchase order.** Routes: `/purchase-orders/[id]/receive`, `/goods-receipts`, `/goods-receipts/[id]`, `/goods-receipts/[id]/print`. There is no `/goods-receipts/new` and no edit/delete/cancel for any role.
- **Database stays authoritative; the browser previews.** The receive form and the Server Action share pure helpers (`lib/goods-receipts/receiving.ts`): blank/zero lines omitted, positive exact decimals (max 3 places, BigInt comparison, never JS floats), `<= remaining` from the backend summary, `received_date >= order_date`, no future-date limit, at least one positive line. The browser posts only `{ purchaseOrderItemId, receivedQuantity }` pairs plus date and notes; the action keeps only those fields. `createGoodsReceipt()` now also pre-checks the order date (same rule as GR007) before reading lines.
- **Stale/concurrent outcomes** (over-receive, line already full, PO no longer receivable, lock/serialization conflicts, changed lines) return one friendly message and revalidate the PO detail and receive pages, which re-render with the latest summary; quantities typed for lines that are no longer open are dropped. No silent retry of a physical event.
- **One read for lists and history.** `list_goods_receipts()` (invoker, RLS, explicit organization filter, sealed only, Unicode trim, literal wildcards, clamped paging, deterministic newest-received-first order) serves `/goods-receipts` and, with a PO filter, the PO receipt history with item count and total quantity aggregated in SQL (no N+1, no browser aggregation). PO detail reads PO, receiving summary and history in parallel.
- **Cancellation UX follows the Part 1 rule:** Cancel is hidden once any receipt exists; a stale cancel is still rejected by the database and shown as the existing safe transition message with a refresh.
- **"Received by" is privacy-preserving.** Superseded by DECISIONS 032: receipts now store a recorder name snapshot instead of the earlier "You" / "Another team member" labels.
- **No stock wording.** Success says "Goods receipt recorded successfully." Inventory will later consume receipts as stock-in.

**Consequences:** A future Inventory module links receipts to stock movements without changing these screens' write path. Showing member names on receipts requires a deliberate profile-visibility decision (and SQL tests).

## 032 — Goods receipt "Received By" name snapshot; item count instead of cross-unit totals

Date: 2026-11-07
Status: accepted

**Context:** Receipts are operational/audit documents and must name who recorded them, but profiles are deliberately readable only by their owner. The PO receipt history also summed quantities across different units, which has no business meaning.

**Decision:**

- `goods_receipts.received_by_name` (migration `20261104230000_goods_receipt_received_by_snapshot.sql`) is a snapshot of the recorder's `profiles.full_name` (the name captured at sign-up), trimmed and capped at 200 code points. A private BEFORE INSERT trigger derives it from `created_by` for every insert path (the RPC uses `auth.uid()`), overwriting any supplied value. `created_by` remains the authoritative user reference; no second user column.
- It is historical receipt content: the existing whole-row immutability trigger prevents any later change (also privileged), and API roles have no write grants. Profile renames, membership disabling or removal do not alter existing receipts. Auth-user deletion of a recorder remains restricted by the existing FK.
- No profile access is widened. Reads return the stored value only; nothing joins live profiles for display, and the name is not a search target.
- Staged nullable column: when no trusted name exists (profile without `full_name`), NULL is stored and the UI shows "Name not recorded". Email is not used as a fallback because the product only shows a user's email to that user. Existing receipts are not backfilled: a current profile name is not evidence of the name at receiving time, and backfilling would require disabling the immutability guard. A NOT NULL constraint can be considered once every account is guaranteed a name.
- `list_goods_receipts()` returns `item_count` (receipt lines) and `received_by_name`; the mixed-unit `total_received_quantity` and raw `created_by` are removed (dropped and recreated with unchanged invoker/RLS/search/paging/order and grants). PO receipt history shows GR number, received date, item count and received by; the main list keeps its Items column.

**Consequences:** Names on receipts are as of recording time by design. Quantity, status, concurrency, sealing, cancellation, service-line, permission and stock behavior are unchanged.

## 033 — Inventory Part 1: immutable stock movement ledger, posted when a Goods Receipt is sealed

Date: 2026-11-10
Status: accepted

**Context:** Goods Receiving (DECISIONS 027, 028, 031, 032) records immutable physical receipts but did not affect stock. DECISIONS 007 requires stock to be derived from append-only movements. Migration `20261104230000` is already applied remotely, so this is a new forward migration only: `20261104240000_stock_movements.sql`. No Inventory UI, warehouses, adjustments, stock-out or returns.

**Decision:**

1. **The ledger is the only source of truth.** `stock_movements` holds signed `quantity_delta numeric(18,3)` rows. Current stock = `SUM(quantity_delta)` per product. Products have no quantity/stock/balance column, and receiving never writes a product row.
2. **Types.** `movement_type` and `source_type` are CHECK lists, currently only `goods_receipt`. Allowed `(movement_type, source_type)` pairs and an "inbound types are positive" CHECK make future types (sale dispatch, adjustments, returns) explicit migrations. Goods receipt movements are strictly positive; zero and NaN are rejected for all types. This supersedes DECISIONS 027's tentative `purchase_receipt` / `source_item_id` naming.
3. **Eligibility uses the receipt line's snapshot.** Only goods receipt lines whose immutable `product_type` (copied from the PO line) is `inventory` move stock. `non_inventory` lines are received but never stocked; services are never receivable. The current `products.product_type` is never consulted.
4. **Source identity and idempotency.** `source_type = 'goods_receipt'`, `source_id = receipt id`, `source_line_id = receipt item id`. `UNIQUE (organization_id, source_type, source_line_id)` guarantees one movement per receipt line, whatever runs twice. Stored generated columns `goods_receipt_id` / `goods_receipt_item_id` (NULL for other future sources) carry a composite FK `(organization_id, goods_receipt_id, goods_receipt_item_id, product_id)` → `goods_receipt_items`, and `(organization_id, product_id)` → `products`, so a movement can never reference another tenant's product, receipt or line, even for privileged writers.
5. **Posting point.** A SECURITY DEFINER AFTER UPDATE trigger on `goods_receipts`, firing only on the single permitted `sealed` false → true transition, posts all inventory lines. It fires before `goods_receipts_reconcile_status` (trigger name order): stock is posted, then the PO status reconciled, in the receipt's transaction. Any failure (over-receive, serialization, abort) rolls back the receipt and its movements together. No second API call; no application code writes stock. Privileged tooling that assembles and seals a valid receipt gets the same movements.
6. **Every insert path is derived.** A BEFORE INSERT trigger looks up the source line in the same organization, requires a sealed receipt and an `inventory` snapshot (`ST001` otherwise), and overwrites product, quantity, snapshots, `occurred_on` and `created_at` from the source. A direct privileged insert therefore cannot forge a quantity or product; for an already-posted line it fails on the unique key.
7. **Snapshots.** `product_name_snapshot`, `sku_snapshot`, `unit_snapshot` come from the receipt line (never the live product), so history stays readable after renames, SKU/unit changes or deactivation.
8. **Dates.** `occurred_on date` = the receipt's `received_date` (a business date, no invented midnight timestamp). `created_at` = database insertion time. **Current stock includes all recorded movements regardless of `occurred_on`**, including future-dated receipts: recording the receipt is the act that acknowledges possession. No effective-dated stock in V1.
9. **Immutability.** Row triggers block UPDATE/DELETE and a statement trigger blocks TRUNCATE for every writer (`55000`, `stock movements are immutable`). Corrections will be compensating movements in a future phase. Receipt, product and organization deletion is blocked by restrictive FKs and existing guards.
10. **Access.** RLS: active members of the organization read (owner, manager, employee alike); disabled members and other tenants see nothing. `anon`, `authenticated` and `service_role` have no INSERT/UPDATE/DELETE/TRUNCATE; there is no generic create-movement RPC, and the posting/derivation helpers have no API execute grants.
11. **Reads.** `list_current_stock(org, search, product_id, limit, offset)` and `list_stock_movements(org, product_id, source_type, limit, offset)` are STABLE SQL SECURITY INVOKER functions with an empty search path, RLS plus explicit organization filter, clamped paging, deterministic order and exact text quantities. Current stock groups by stable `product_id` and shows **current** product master data; movement history shows the **snapshots** and the GR number (same query, no N+1). Current stock lists every product whose current type is `inventory` (active and inactive, `0.000` before the first receipt) **plus any product that has movements** even if its type changed later, so ledger quantity is never hidden; `product_type` is returned so a future UI can flag it. Balances are text with scale 3 and are not cast back to numeric(18,3), so a balance above 10^15 is still exact. No text search on history in Part 1 (product filter only).
12. **Negative stock.** No aggregate `>= 0` constraint on the ledger. Receipts only add stock. Preventing negative stock (DECISIONS 007) belongs to future stock-out operations, which must lock and check availability transactionally.
13. **Backfill.** The migration installs the sealing trigger first (its creation waits for in-flight receipt writers), then posts every existing sealed receipt through the same generation function with `ON CONFLICT DO NOTHING`, then verifies the ledger against the receipts (missing, unexpected and mismatched rows) and aborts on any difference. Receipts sealed concurrently are covered by the trigger; the unique key prevents doubles in either order.
14. **TypeScript.** `lib/inventory/` provides typed, validated readers only (`listCurrentStock`, `getProductStock`, `listStockMovements`), exact quantity strings (never JS numbers) and safe error messages. No mutation helper.
15. **Deferred:** warehouses/locations, adjustments, transfers, reservations, sales stock-out, returns, lots/serials, costing/valuation, reorder alerts, counting and the Inventory UI. Product type changes after stock exists are still allowed (the existing receiving suite relies on that); a guard is an open decision.

**Consequences:** Goods receipts now have a stock effect for inventory lines; Purchase Orders still have none (`purchase_orders.sql` asserts the ledger is untouched by PO operations). Disabling triggers by a database owner bypasses these guards, as for the existing immutable documents. Native two-session concurrency waits are not exercised by the embedded runner.

## 034 — Product type is immutable once the product has a stock movement

Date: 2026-11-10
Status: accepted (supersedes DECISIONS 033 item 15 and the "type changes allowed" note of DECISIONS 016 for products with movements)

**Context:** With the ledger (DECISIONS 033), retyping a stocked product would produce states like "type: service, balance: 100". Migration `20261104240000_stock_movements.sql` was not yet applied remotely (user confirmed), so the guard is added to that same migration, keeping the ledger invariants together, as with the unapplied receiving migration in DECISIONS 028. Migrations through `20261104230000` are unchanged.

**Decision:**

- `products_lock_type_after_stock` (BEFORE UPDATE OF `product_type`, only when the value actually changes; SECURITY DEFINER, empty search path, no API grants) rejects the change with `ST002` "product type cannot change after stock movements exist" whenever any `stock_movements` row exists for the product. It covers authenticated column updates (the normal product edit path), and privileged updates. It only reads; no recursion.
- The locking event is a stock movement, not a receipt: products whose receipts were all `non_inventory` (no movements) and products with no movements stay retypeable in every direction.
- Only `product_type` is locked. Name, SKU, description, category, prices, unit, reorder level (within existing rules) and active/inactive status stay editable; edits never rewrite receipt or movement snapshots.
- Race: movement derivation takes `FOR SHARE` on the product row. A type change that is waiting on that lock re-checks for movements after the receipt commits, and is then rejected. Conversely, a type change that commits first does not block the receipt, because receipt eligibility is the PO line snapshot (DECISIONS 033).
- `list_current_stock()` keeps returning every product that has movements whatever its current type. This still happens legitimately when a product is retyped between ordering and its first receipt (the PO snapshot says `inventory`), and for legacy or privileged-invalid data. `product_type` is returned so a UI can flag it.
- The app maps `ST002` to `type_locked`: a field error on the product type ("This product already has stock movements, so its type can no longer be changed.").

**Consequences:** `goods_receipts.sql` no longer retypes an already-received inventory product. It now asserts the rejection and unchanged receipt/ledger history, and proves receipt-snapshot eligibility with a fresh product that has no movements yet. A product whose type must truly change after stocking needs a future, explicit process (for example, zeroing stock with compensating movements and creating a new product).

## 035 — Product type stays inventory during open inventory procurement; stock posting re-checks the live type

Date: 2026-11-10
Status: accepted (extends DECISIONS 034; its trigger `products_lock_type_after_stock` is replaced by `products_guard_type_change` in the same, still unapplied migration `20261104240000_stock_movements.sql`)

**Context:** DECISIONS 034 locked a product's type only after its first movement. A product could still be retyped (for example to `service`) between ordering and its first receipt. The receipt then followed the PO line's `inventory` snapshot and posted stock, leaving a permanently locked service product with positive stock. The migration is still not applied remotely (user confirmed), so this closes the gap in the same migration. Migrations through `20261104230000` are unchanged.

**Invariant:** no committed state has stock movements for a product whose current type is not `inventory`, except data that bypassed the guards (legacy or disabled triggers), which the reader still shows.

**Decision:**

- **Rule A (open procurement).** While the product is on a purchase order line with an `inventory` type snapshot whose PO is `ordered` or `partially_received`, it cannot change away from `inventory` (`ST003`). Draft, cancelled and received POs, and `non_inventory` or `service` lines, do not lock it. Changing to `inventory` is always allowed by this rule, which repairs a product that was retyped while its PO was a draft.
- **Rule B (movements).** Unchanged from DECISIONS 034: any movement fixes the type permanently (`ST002`, checked first), even at zero balance. This also means a legacy product that already has stock under a non-inventory type cannot be retyped by normal writes.
- **Rule C (posting compatibility).** When an inventory receipt line posts, the derivation trigger reads the current product row `FOR SHARE` and rejects with `ST004` if its type is not `inventory`. The whole receipt transaction rolls back: nothing is skipped, converted or posted. The PO and receipt snapshots remain the eligibility source and are never rewritten.
- **Isolation.** Product type changes require READ COMMITTED (`ST005`), which is the Supabase API and SQL Editor default. Under REPEATABLE READ or SERIALIZABLE, the guard's snapshot can predate a receipt that held the product row, and a lock-only conflict raises no error, so the guard could miss its movement.
- **Lock order.** Receiving: PO row (`FOR UPDATE`) → product row (`FOR SHARE`, posting). Type change: product row (taken by the UPDATE itself) → plain reads only. No path locks product then PO, so there is no deadlock cycle. If the receipt holds the product, the change waits and then sees the movement (`ST002`). If the change holds it, posting waits and then reads the committed type (`ST004` if it is no longer inventory). If the change rolls back, posting proceeds.
- **Guard implementation.** `products_guard_type_change` is a BEFORE UPDATE OF `product_type` row trigger, firing only on an actual change. It is SECURITY DEFINER with an empty search path, read-only and has no API grants. It applies to every writer.
- **Reader.** `list_current_stock()` is unchanged: rows with movements are always returned with their actual `product_type`.
- **Errors.** Products: `ST002` → `type_locked` ("This product already has stock movements, so its type can no longer be changed."). `ST003` → `type_locked_open_po` ("This product is used as an inventory item on an active purchase order, so its type cannot be changed."). Both are shown on the type field. `ST005` → generic failure (unreachable from the app). Receiving: `ST004` → `product_not_inventory` ("This product is no longer classified as inventory. Restore its type before receiving inventory goods."). Raw database text is never shown.

**Consequences:** A PO can still be ordered while a draft line's product was retyped; the receipt then fails with `ST004` until the product is restored to `inventory`. Blocking at order time is a possible future refinement. Bypassing triggers (owner `ALTER TABLE … DISABLE TRIGGER`) remains outside supported writes. Native two-session behaviour was verified locally with embedded PostgreSQL 18.6.

## 036 — Ordering a purchase order re-checks inventory lines against the live product type

Date: 2026-11-10
Status: accepted (completes DECISIONS 035; same, still unapplied migration `20261104240000_stock_movements.sql`)

**Context:** Under DECISIONS 035, a product could still be retyped while its PO was a draft. The PO could then be ordered with an `inventory` line that could never be received (`ST004`).

**Decision:**

- **Invariant.** No ordered or partially received PO has an `inventory`-snapshot line whose product's current type is not `inventory`. Data that bypassed the guards is the only exception.
- **Enforcement point.** `purchase_orders_validate_inventory_types` is a BEFORE UPDATE OF `status` trigger on `purchase_orders`. It fires only for `draft → ordered`, runs after `purchase_orders_enforce_rules` (name order), and is SECURITY DEFINER with no API grants. It covers `set_purchase_order_status` and privileged updates; API roles have no PO write grant. It checks only lines whose snapshot is `inventory`; `non_inventory` and `service` lines are unchanged. Snapshots are never rewritten, and nothing is retyped or skipped.
- **Error.** `ST006`, message `inventory products changed type since the purchase order lines were recorded`, detail `lines: 1,3` (PO line numbers only). The app maps it to `product_type_changed`. It shows: "One or more inventory products have changed type since this purchase order was created. Restore their product type before marking the purchase order as ordered." It appends "Affected line(s): 1, 3." only when the detail matches a strict allowlist pattern. Not a stale failure; the PO stays a draft.
- **Repair.** Restore the product to `inventory` (allowed by DECISIONS 035), then order again. No line recreation is needed.
- **Locking.** The trigger locks the product of every inventory-snapshot line `FOR SHARE`, in product id order, and only then tests the locked rows' types. Filtering by type inside the locking query is wrong: PostgreSQL evaluates the filter on the old snapshot first, so a row being retyped concurrently is never locked or re-read. Native race tests caught exactly this during development.
- **Final lock order.**
  - Receiving: PO row (`FOR UPDATE`) → product row (`FOR SHARE`, stock posting).
  - Ordering: PO row (the status UPDATE) → product rows (`FOR SHARE`).
  - Product type change: product row only (the UPDATE); open PO lines and movements are plain reads.
  - No transaction locks product then PO, so there is no inversion.
  - If a type change holds the product, ordering waits and then sees the committed type (`ST006`); if it rolls back, ordering proceeds. If ordering holds the product, the type change waits and then sees the ordered PO (`ST003`).
  - At REPEATABLE READ or SERIALIZABLE, locking a row changed after the snapshot raises `40001`, and type changes themselves require READ COMMITTED (`ST005`).
- `ST002`–`ST005` are unchanged. `ST004` is now reachable only for data that bypassed the guards, and remains as defence in depth.

**Consequences:** `goods_receipts.sql` now expects `ST006` (PO stays draft, snapshot kept), then repair, ordering and receipt. `ST004` is tested with deliberately constructed invalid data in a rolled-back subtransaction. The native embedded-PostgreSQL harness covers the races; sequential SQL suites cannot detect filter-before-lock regressions.

## 037 — Inventory UI is read-only: current stock list and per-product movement history

Date: 2026-11-10
Status: accepted (UI only; no migration, SQL, RLS or ledger change)

**Context:** The stock ledger (DECISIONS 033–036) had read RPCs and `lib/inventory/` readers but no screens. Stock may only change through business documents (Goods Receipts today).

**Decision:**

- Routes `/inventory` (current stock) and `/inventory/[productId]` (product stock + movement history). Navigation: Inventory → Current stock, Products. No Adjust Stock, Stock In/Out, Edit Balance, warehouses, transfers or valuation, and no dead links for them.
- **Read-only.** No Server Action, form or client fetch writes stock. Every active role (owner, manager, employee) can view; the organization is always the session tenant (`requireTenant()`), never a URL value. Only `q` (search) and `page` are read from the list URL; the detail page uses the route's validated product ID and `page` only.
- **Current vs historical data.** Current stock rows and the detail summary show CURRENT product master data (name, SKU, unit, type, status) with the ledger balance. Movement rows show each movement's SNAPSHOTS (name, SKU, unit) under "Recorded product"; they are never replaced with current master data.
- **Visibility.** Zero-stock and inactive inventory products stay visible. A product whose current type is not `inventory` but has movements stays visible with a text "Stock history exists" badge (list) and an "Inventory history mismatch" warning (detail). No repair action; the balance is shown unchanged.
- **Exact quantities.** Balances and movement quantities are formatted as strings (`lib/inventory/display.ts`, reusing the exact `exactQuantity` grouping): 3 decimals, thousands separators, sign from the database string (`+30.000`, `-10.000`). No JS number conversion. No aggregate across products (mixed units are meaningless to sum), no KPI cards, no valuation.
- **Labels and links.** Movement and source types map through the central label tables; source links come only from the explicit source-type mapping in `lib/inventory/movements.ts` (`goods_receipt` → `/goods-receipts/[id]`), whose route re-checks tenant access.
- Malformed, unknown, other-tenant and non-stock product IDs all show the same not-found page. A movement read failure shows a safe inline message while the stock summary still renders; list read failures use the route error boundary.
- Deferred: movement-type filter (only one type exists), category/reorder level on inventory screens (not returned by `list_current_stock`; no extra query added), low-stock alerts.

**Consequences:** Future stock-changing features (adjustments, sales stock-out) need their own source types, database functions and a deliberate UI decision; the read screens pick up new movement types by adding labels and a source-link mapping.
