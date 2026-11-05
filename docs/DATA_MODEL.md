# Data Model

> **Status:** The tenancy tables (`profiles`, `organizations`, `organization_members`) exist, created by `supabase/migrations/20261104000000_organizations_and_memberships.sql`. `customers` exists, created by `supabase/migrations/20261104020000_customers.sql`. `vendors` exists, created by `supabase/migrations/20261104050000_vendors.sql`. `product_categories` and `products` exist, created by `supabase/migrations/20261104070000_products.sql`. `quotations`, `quotation_items` and `document_number_counters` exist, created by `supabase/migrations/20261104090000_quotations.sql` (single-document read `get_quotation()` added by `20261104110000_get_quotation.sql`, list/search `list_quotations()` by `20261104120000_list_quotations.sql`). `invoices` and `invoice_items` exist (migration `20261104150000_invoices.sql`, list RPC `20261104160000_list_invoices.sql`). `sales_orders` and `sales_order_items` exist, created by `supabase/migrations/20261104130000_sales_orders.sql` (list/search `list_sales_orders()` added by `20261104140000_list_sales_orders.sql`). Everything else below is the **planned** model and guiding rules. Update this file in the same change as each migration.

## Global Rules

- Every organization-owned table has `organization_id uuid not null` referencing `organizations(id)`.
- Every organization-owned table has RLS enabled. Policies allow access only to members of that organization.
- Standard columns: `id uuid primary key`, `created_at timestamptz`, `updated_at timestamptz`, `created_by uuid` (references `auth.users`).
- Money uses exact decimal types, never floating point. Prices are `numeric(18,2)` in the organization's base currency (DECISIONS 016); use the same type for future money columns unless a decision says otherwise. Read money as text (`::text`) and write it as a decimal string, so the app never parses it into a JavaScript number.
- Document numbers, such as invoice and order numbers, are unique per organization: `unique (organization_id, number)`. They are generated in the database from `document_number_counters` (DECISIONS 017), never by the browser and never with `MAX + 1`.
- Links between two tenant-owned tables use composite foreign keys `(organization_id, x_id)` → `x(organization_id, id)`, so a row can only reference rows of its own organization (DECISIONS 016). `customers`, `products`, `quotations` and `sales_orders` have `unique (organization_id, id)` as the target.
- Transaction documents snapshot the master data they show (DECISIONS 008). Historical display uses the snapshot columns, never a join to the live customer or product.
- Index `organization_id`, foreign keys, status columns, frequently filtered dates, document numbers, and SKU.
- Schema changes are made only through migrations.

## Tenancy and Users (implemented)

| Table | Columns | Notes |
| --- | --- | --- |
| `profiles` | `id` (= `auth.users.id`), `full_name`, `phone`, `avatar_url`, `created_at`, `updated_at` | Created by the `on_auth_user_created` trigger from signup metadata (`full_name`). No credentials. |
| `organizations` | `id`, `name`, `email`, `phone`, `address`, `currency` (one of the V1 supported codes, default `BDT`; see DECISIONS 012), `timezone` (IANA, default `Asia/Dhaka`), `tax_number`, `logo_url`, `created_at`, `updated_at`, `created_by` | A tenant. `created_by` is set null if the user is deleted. |
| `organization_members` | `id`, `organization_id`, `user_id`, `role` (`owner`/`manager`/`employee`), `status` (`active`/`disabled`), `created_at`, `updated_at` | `unique (organization_id, user_id)`; index on `user_id`. The unique index also serves lookups by `organization_id`. |

Access rules:

- API roles have `SELECT` only on these tables. There is no client write path.
- RLS: a user reads their own profile, organizations where they are an **active** member, and membership rows that are their own or belong to such organizations.
- `public.is_org_member(org_id)`: the RLS helper for every organization-owned table.
- Shared text helpers `public.trim_whitespace()`, `public.text_is_trimmed()`, `public.text_has_whitespace()` (DECISIONS 014): last redefined by `20261104100000_restore_whitespace_line_separators.sql`, which restores U+2028 / U+2029 and writes the set with escapes (DECISIONS 019).
- `public.create_organization(...)`: the only way to create an organization. Atomically inserts the organization and an `owner`/`active` membership for `auth.uid()`. Version 1 allows one active organization per user.
- `public.has_org_role(org_id, roles[])`: true if the caller is an **active** member of `org_id` with one of `roles`. Used for role-restricted operations.

## Master Data

### `customers` (implemented)

| Column | Type | Rules |
| --- | --- | --- |
| `id` | uuid | Primary key, `gen_random_uuid()` |
| `organization_id` | uuid, not null | → `organizations(id)` on delete cascade. Set on insert only |
| `name` | text, not null | Trimmed, 1–200 characters |
| `company_name` | text | Optional. Trimmed, 1–200 |
| `phone` | text | Optional. Trimmed, ≤ 50, optional leading `+`, then digits, spaces, `( ) - .`, at least 6 digits (same as organizations) |
| `email` | text | Optional. Lowercase, trimmed, ≤ 320, `local@domain.tld` |
| `address` | text | Optional. Trimmed, 1–500 |
| `tax_number` | text | Optional. Trimmed, 1–100 |
| `notes` | text | Optional. Trimmed, 1–2000 |
| `status` | text, not null | `active` (default) or `inactive` |
| `created_by` | uuid | → `auth.users(id)` on delete set null. Defaults to `auth.uid()` |
| `created_at`, `updated_at` | timestamptz, not null | `updated_at` is maintained by the `set_updated_at` trigger |

- Optional text is stored as NULL, never `''`. "Trimmed" means no leading or trailing whitespace, using the explicit whitespace set in DECISIONS 014 (`public.text_is_trimmed()`). Email may not contain that whitespace anywhere (`public.text_has_whitespace()`).
- Lengths are Unicode code points (`char_length()`), so 200 emoji is a valid name. The app counts the same way (DECISIONS 014).
- Migration `20261104030000_harden_customer_validation.sql` rebuilt the CHECK constraints with these rules. If older rows violated a rebuilt constraint, that constraint was left `NOT VALID` with a warning: it still checks every new insert and update, but old rows were not changed. To check and clean up:

  ```sql
  select conname from pg_constraint
  where conrelid = 'public.customers'::regclass and not convalidated;   -- should be empty

  select id, organization_id from public.customers
  where not public.text_is_trimmed(name)
     or (company_name is not null and not public.text_is_trimmed(company_name))
     or (phone is not null and not public.text_is_trimmed(phone))
     or (email is not null and public.text_has_whitespace(email))
     or (address is not null and not public.text_is_trimmed(address))
     or (tax_number is not null and not public.text_is_trimmed(tax_number))
     or (notes is not null and not public.text_is_trimmed(notes));
  -- fix those rows, then: alter table public.customers validate constraint <name>;
  ```
- Indexes: `(organization_id, created_at desc, id desc)`, `(organization_id, status, created_at desc, id desc)`, `(created_by)`, and unique `(organization_id, id)` (target of the quotations composite foreign key, added by `20261104090000_quotations.sql`).
- Customers are never deleted. They are deactivated (`status = 'inactive'`) and stay available to historical documents.
- Duplicate names, emails and phone numbers are allowed in Version 1.

Access rules:

- RLS: select, insert and update only in organizations where the caller is an active member. Inserts must have `created_by = auth.uid()`.
- Column privileges for `authenticated`:
  - INSERT: `organization_id` and the editable fields only.
  - UPDATE: the editable fields only (`name`, `company_name`, `phone`, `email`, `address`, `tax_number`, `notes`).
  - `status`, `created_by` and `created_at` are never client-writable. There is no DELETE privilege.
- `public.set_customer_status(customer_id, status)`: the only way to change status. Allowed for owners and managers. Raises `P0002` for missing or other-tenant customers and `42501` for other roles. The customer is looked up only through the caller's active membership, without a row lock. The row lock is taken only by the final `UPDATE`, on an authorized row, so other tenants' locked rows can't cause a wait.
- `public.list_customers(org_id, search, status, limit, offset)`: `SECURITY INVOKER` (RLS applies). Search, status filter and pagination, with `total_count`. Search matches name, company, email and phone (case-insensitive substring, wildcards literal), plus phone digits. The search term is trimmed with `public.trim_whitespace()` (the shared set, DECISIONS 014) since migration `20261104060000_align_customer_search_trim.sql`; before that it used `btrim()`, which strips ASCII spaces only.

### `vendors` (implemented)

Follows the tenant-owned entity pattern established by `customers` (DECISIONS 013, 014; ARCHITECTURE § Tenant-Owned Module Pattern). Same columns, types and rules as `customers`:

| Column | Type | Rules |
| --- | --- | --- |
| `id` | uuid | Primary key, `gen_random_uuid()` |
| `organization_id` | uuid, not null | → `organizations(id)` on delete cascade. Set on insert only |
| `name` | text, not null | Trimmed, 1–200 code points |
| `company_name` | text | Optional. Trimmed, 1–200 |
| `phone` | text | Optional. Same rule as customers and organizations (≤ 50, at least 6 digits) |
| `email` | text | Optional. Lowercase, ≤ 320, no whitespace anywhere, `local@domain.tld` |
| `address` | text | Optional. Trimmed, 1–500 |
| `tax_number` | text | Optional (tax / VAT / BIN number). Trimmed, 1–100 |
| `notes` | text | Optional. Trimmed, 1–2000 |
| `status` | text, not null | `active` (default) or `inactive` |
| `created_by` | uuid | → `auth.users(id)` on delete set null. Defaults to `auth.uid()` |
| `created_at`, `updated_at` | timestamptz, not null | `updated_at` is maintained by the `set_updated_at` trigger |

- CHECK constraints use `public.text_is_trimmed()` / `public.text_has_whitespace()` from the start (the customers hardening migration's helpers), so there are no `NOT VALID` constraints to clean up. They mirror `lib/vendors/validation.ts`.
- Indexes: `(organization_id, created_at desc, id desc)`, `(organization_id, status, created_at desc, id desc)`, `(created_by)`.
- Vendors are never deleted. They are deactivated (`status = 'inactive'`), stay editable, and stay available to future purchasing documents.
- Duplicate names, emails and phone numbers are allowed in Version 1.
- No payable balance is stored. Supplier balances will be derived from bills and payments (Phase 5).

Access rules (same as `customers`):

- RLS: select, insert and update only in organizations where the caller is an active member. Inserts must have `created_by = auth.uid()`.
- Column privileges for `authenticated`: INSERT `organization_id` and the editable fields; UPDATE the editable fields only (`name`, `company_name`, `phone`, `email`, `address`, `tax_number`, `notes`). `status`, `created_by` and `created_at` are never client-writable. There is no DELETE privilege.
- `public.set_vendor_status(vendor_id, status)`: the only way to change status. Owners and managers only. Raises `P0002: vendor not found` for missing, other-tenant and disabled-member cases alike, and `42501` for employees. Authorization-scoped lookup without a row lock; only the final `UPDATE` locks, on an authorized row.
- `public.list_vendors(org_id, search, status, limit, offset)`: `SECURITY INVOKER` (RLS applies). Same search, filter and pagination behaviour as `list_customers`, including trimming the search with `public.trim_whitespace()`.

### `product_categories` (implemented)

A flat list of product categories per organization (no hierarchy).

| Column | Type | Rules |
| --- | --- | --- |
| `id` | uuid | Primary key, `gen_random_uuid()` |
| `organization_id` | uuid, not null | → `organizations(id)` on delete cascade. Set on insert only |
| `name` | text, not null | Trimmed, 1–100 code points. Unique per organization, ignoring case |
| `status` | text, not null | `active` (default) or `inactive` |
| `created_by` | uuid | → `auth.users(id)` on delete set null. Defaults to `auth.uid()` |
| `created_at`, `updated_at` | timestamptz, not null | `updated_at` is maintained by the `set_updated_at` trigger |

- Indexes: unique `(organization_id, lower(name))`, unique `(organization_id, id)` (target of the products composite foreign key), `(created_by)`.
- Never deleted. Deactivating a category does not change its products. Inactive categories are not offered for new or edited products (app rule in `lib/products/products.ts`), but a product keeps an inactive category it already has.

### `products` (implemented)

| Column | Type | Rules |
| --- | --- | --- |
| `id` | uuid | Primary key, `gen_random_uuid()` |
| `organization_id` | uuid, not null | → `organizations(id)` on delete cascade. Set on insert only |
| `name` | text, not null | Trimmed, 1–200 code points |
| `sku` | text, not null | Trimmed, 1–100 code points, stored as typed. Unique per organization, ignoring case (`lower(sku)`). Inner spaces allowed |
| `category_id` | uuid | Optional. Composite FK `(organization_id, category_id)` → `product_categories(organization_id, id)`, so the category always belongs to the same organization |
| `product_type` | text, not null | `inventory`, `non_inventory` or `service` |
| `unit` | text, not null | One of `pcs`, `unit`, `kg`, `g`, `litre`, `ml`, `box`, `pack`, `set`, `hour`, `day`, `service` |
| `description` | text | Optional. Trimmed, 1–2000 code points |
| `purchase_price` | numeric(18,2) | Optional. ≥ 0, not NaN. Base currency |
| `selling_price` | numeric(18,2) | Optional. ≥ 0, not NaN. Base currency |
| `reorder_level` | numeric(18,3), not null | Default 0. ≥ 0, not NaN. Must be 0 unless `product_type = 'inventory'` |
| `status` | text, not null | `active` (default) or `inactive` |
| `created_by` | uuid | → `auth.users(id)` on delete set null. Defaults to `auth.uid()` |
| `created_at`, `updated_at` | timestamptz, not null | `updated_at` is maintained by the `set_updated_at` trigger |

- There is **no stock quantity column**. Stock on hand will be derived from `stock_movements` (Phase 3, DECISIONS 007).
- `numeric(18,2)` rounds extra decimals on input. The app rejects more than 2 price decimals (3 for the reorder level) before writing, so only a direct API call can be rounded.
- Product type changes are allowed while no stock data exists. Once stock movements exist, changing an inventory product with movements to another type needs a rule (DECISIONS 016).
- Indexes: unique `(organization_id, lower(sku))`, `(organization_id, created_at desc, id desc)`, `(organization_id, status, created_at desc, id desc)`, `(organization_id, category_id)`, `(created_by)`, and unique `(organization_id, id)` (target of the quotation items composite foreign key, added by `20261104090000_quotations.sql`).
- Never deleted. Inactive products stay editable and visible to historical documents; future transaction forms should offer only active products.
- Documents snapshot name, SKU, unit, description and price on their lines (DECISIONS 008); editing a product does not change them. Quotations do this since `20261104090000_quotations.sql`; orders, invoices and bills must follow.

Access rules (same pattern as `customers` and `vendors`):

- RLS on `products`: select, insert and update only in organizations where the caller is an active member. Inserts must have `created_by = auth.uid()`.
- RLS on `product_categories`: any active member can select. Insert and update require an active `owner` or `manager` membership (`public.has_org_role`), since migration `20261104080000_restrict_product_category_writes.sql`; before it, any active member could insert and rename. Inserts must have `created_by = auth.uid()`. Employees view categories and assign active ones to products.
- Column privileges for `authenticated`:
  - `products` INSERT: `organization_id`, `name`, `sku`, `category_id`, `product_type`, `unit`, `description`, `purchase_price`, `selling_price`, `reorder_level`. UPDATE: the same without `organization_id`.
  - `product_categories` INSERT: `organization_id`, `name`. UPDATE: `name`.
  - `status`, `created_by` and `created_at` are never client-writable. There is no DELETE privilege.
- `public.set_product_status(product_id, status)` and `public.set_product_category_status(category_id, status)`: the only way to change status. Owners and managers only. Raise `P0002` (`product not found` / `category not found`) for missing, other-tenant and disabled-member cases alike, and `42501` for employees. Authorization-scoped lookup without a row lock.
- `public.list_products(org_id, search, status, product_type, category_id, limit, offset)`: `SECURITY INVOKER` (RLS applies). Search matches name, SKU and category name (case-insensitive substring, wildcards literal, trimmed with `public.trim_whitespace()`, capped at 100 code points). Filters by status, type and category. Newest first, id tie-breaker; limit clamped to 1–100; returns `total_count`. Prices are returned as text.

## Sales

### `quotations` (implemented)

| Column | Type | Rules |
| --- | --- | --- |
| `id` | uuid | Primary key |
| `organization_id` | uuid, not null | → `organizations(id)` on delete cascade. Taken from the customer's organization by `create_quotation()`; never changes |
| `quotation_number` | text, not null | `QT-000001`, `QT-000002`, … per organization (`^QT-[0-9]{6,}$`; 7+ digits after 999999). Unique `(organization_id, quotation_number)`. Generated by the database; never changes |
| `customer_id` | uuid, not null | Composite FK `(organization_id, customer_id)` → `customers(organization_id, id)` |
| `customer_name` | text, not null | Snapshot, 1–200 code points |
| `customer_company_name`, `customer_phone`, `customer_email`, `customer_address`, `customer_tax_number` | text | Snapshot of the customer at create / last draft update |
| `quotation_date` | date, not null | Finite |
| `expiry_date` | date | Optional. Finite, `>= quotation_date` |
| `status` | text, not null | `draft` (default), `sent`, `accepted`, `rejected`, `expired`, `cancelled` |
| `notes` | text | Optional. Trimmed (shared whitespace set), 1–2000 code points |
| `subtotal`, `discount_total`, `tax_total`, `grand_total` | numeric(18,2), not null | Computed by the database from the items. CHECK: non-negative, `discount_total <= subtotal`, `grand_total = subtotal - discount_total + tax_total` |
| `created_by` | uuid | → `auth.users(id)` on delete set null. Set to `auth.uid()` by the database |
| `created_at`, `updated_at` | timestamptz, not null | `updated_at` maintained by `set_updated_at` |

### `quotation_items` (implemented)

| Column | Type | Rules |
| --- | --- | --- |
| `id` | uuid | Primary key |
| `organization_id` | uuid, not null | → `organizations(id)` on delete cascade |
| `quotation_id` | uuid, not null | Composite FK `(organization_id, quotation_id)` → `quotations(organization_id, id)` on delete cascade |
| `product_id` | uuid, not null | Composite FK `(organization_id, product_id)` → `products(organization_id, id)` |
| `product_name`, `sku`, `unit` | text, not null | Snapshot from the product, always taken by the database |
| `description` | text | Product description by default; the user may replace or clear it. Trimmed, 1–2000 code points |
| `quantity` | numeric(18,3), not null | `> 0`, not NaN |
| `unit_price` | numeric(18,2), not null | Product selling price by default; the user may override it. `>= 0` |
| `discount_amount` | numeric(18,2), not null | Default 0. `0 <= discount <= round(quantity × unit_price, 2)` |
| `tax_rate` | numeric(5,2), not null | Percent, default 0, `0..100` |
| `tax_amount`, `line_total` | numeric(18,2), not null | Computed. CHECK `quotation_items_amounts_check` enforces the calculation model below |
| `sort_order` | integer, not null | 1–100, position in the quotation. Unique `(organization_id, quotation_id, sort_order)` |
| `created_at`, `updated_at` | timestamptz, not null | |

Calculation model (DECISIONS 018), all values non-negative, `round()` = half up:

```text
gross      = round(quantity × unit_price, 2)
taxable    = gross − discount_amount
tax_amount = round(taxable × tax_rate × 0.01, 2)
line_total = taxable + tax_amount

subtotal = Σ gross        discount_total = Σ discount_amount
tax_total = Σ tax_amount  grand_total = subtotal − discount_total + tax_total
```

`gross` is not stored; it equals `line_total − tax_amount + discount_amount`. A quotation has 1–100 items.

### `document_number_counters` (implemented, internal)

`(organization_id, document_type)` primary key, `last_value bigint`, `updated_at`. `document_type` is `quotation` or `sales_order` (widened by `20261104130000_sales_orders.sql`). No client privileges, RLS on with no policies. Only `public.next_document_number()` (no client EXECUTE) writes it (DECISIONS 017).

### Quotation access rules

- `authenticated` has `SELECT` only on `quotations` and `quotation_items`, limited by RLS to organizations where the caller is an **active** member. There is no INSERT, UPDATE or DELETE privilege or policy. `anon` has nothing.
- Writes go only through `SECURITY DEFINER` functions with `search_path = ''`:
  - `create_quotation(customer_id, quotation_date, expiry_date, notes, items jsonb) → uuid`. Any active member. The organization is the customer's, and only if the caller is an active member of it. The customer must be active. Derives the number, `created_by`, snapshots and all amounts.
  - `update_quotation_draft(quotation_id, customer_id, quotation_date, expiry_date, notes, items jsonb)`. Any active member, `draft` only. It updates the header and replaces all items in one transaction, re-snapshotting the customer and products from current master data. The customer and every product must be active.
  - `set_quotation_status(quotation_id, status)`. `sent` for any active member; `accepted`, `rejected`, `expired`, `cancelled` for owners and managers.
- Reads of a single document use `get_quotation(organization_id, quotation_id) → jsonb` (`SECURITY INVOKER`, RLS applies): header and items from one statement, money as JSON strings, items ordered by `sort_order, id`, NULL when not visible (DECISIONS 020). Do not read the header and items with separate requests.
- Lists use `list_quotations(organization_id, search, status, customer_id, limit, offset)` (`SECURITY INVOKER`, RLS applies). Search is a case-insensitive substring of `quotation_number` or the `customer_name` snapshot (wildcards literal, trimmed with the shared whitespace set, 100 code points). `grand_total` is text. Order `created_at desc, id desc`; limit clamped to 1–100; `total_count` before limit/offset.
- `items` is a JSON array of `{ product_id, quantity, unit_price?, discount_amount?, tax_rate?, description? }`. Decimals are strings (or JSON numbers) with at most 3 (quantity) / 2 (money, rate) decimals; extra decimals are rejected, not rounded. A missing or null `unit_price` uses the product's selling price (error if it has none). A missing `description` key uses the product's description; a present key (string or null) is the user's value. Any other key (`product_name`, `sku`, `unit`, `tax_amount`, `line_total`, …) is ignored.
- Errors: `42501` not authenticated / role not allowed; `P0002` quotation not found (unknown, other tenant and disabled member alike); `23503` customer or product not found (any tenant) or inactive; `22023` invalid input; `22003` amount too large for `numeric(18,2)`; `55000` not a draft / transition not allowed.
- Triggers, for every writer, including `postgres`:
  - `quotations_enforce_rules`: `organization_id`, `quotation_number`, `created_at` never change; `created_by` may only become NULL. Status changes must be allowed transitions (`quotation_status_transition_allowed()`). Once `status <> 'draft'`, no column other than `status`, `updated_at` and `created_by` (to NULL) may change.
  - `quotation_items_enforce_draft`: items may only be inserted, updated or deleted while their quotation is `draft`. Deleting an organization still cascades.
- Status transitions: `draft → sent | cancelled`, `sent → accepted | rejected | expired | cancelled`. `accepted`, `rejected`, `expired`, `cancelled` are terminal. Repeating the current status is rejected. There is no automatic expiry in V1.
- Indexes: `quotations (organization_id, created_at desc, id desc)`, `(organization_id, status, created_at desc, id desc)`, `(organization_id, quotation_date desc)`, `(organization_id, customer_id)`, `(created_by)`, unique `(organization_id, quotation_number)`, unique `(organization_id, id)`; `quotation_items` unique `(organization_id, quotation_id, sort_order)`, `(organization_id, product_id)`.
- Quotations never affect inventory and are never deleted (by any writer).

### `sales_orders` (implemented)

| Column | Type | Rules |
| --- | --- | --- |
| `id` | uuid | Primary key |
| `organization_id` | uuid, not null | → `organizations(id)` on delete cascade. From the customer (direct) or the quotation (conversion), through the caller's active membership; never changes |
| `sales_order_number` | text, not null | `SO-000001`, … per organization (`^SO-[0-9]{6,}$`). Unique `(organization_id, sales_order_number)`. Generated by the database (`next_document_number(org, 'sales_order')`); never changes |
| `customer_id` | uuid, not null | Composite FK `(organization_id, customer_id)` → `customers(organization_id, id)` |
| `source_quotation_id` | uuid | NULL for direct orders. Composite FK `(organization_id, source_quotation_id)` → `quotations(organization_id, id)`. Unique `(organization_id, source_quotation_id)`: one order per quotation (NULLs are distinct, so direct orders are unaffected). Set only by conversion; never changes |
| `customer_name` | text, not null | Snapshot, 1–200 code points |
| `customer_company_name`, `customer_phone`, `customer_email`, `customer_address`, `customer_tax_number` | text | Snapshot: from the customer (direct create, customer change on a draft) or copied from the quotation (conversion) |
| `order_date` | date, not null | Finite |
| `expected_delivery_date` | date | Optional. Finite, `>= order_date` |
| `status` | text, not null | `draft` (default), `confirmed`, `completed`, `cancelled` |
| `notes` | text | Optional. Trimmed, 1–2000 code points. Conversion copies the quotation's notes |
| `subtotal`, `discount_total`, `tax_total`, `grand_total` | numeric(18,2), not null | Computed by the database from the items; same CHECK as quotations |
| `created_by` | uuid | → `auth.users(id)` on delete set null. `auth.uid()` |
| `created_at`, `updated_at` | timestamptz, not null | |

### `sales_order_items` (implemented)

Same columns, types and CHECK constraints as `quotation_items` (including `sales_order_items_amounts_check`, the calculation model above), with `sales_order_id` instead of `quotation_id`: composite FK `(organization_id, sales_order_id)` → `sales_orders(organization_id, id)` on delete cascade, composite FK `(organization_id, product_id)` → `products(organization_id, id)`, unique `(organization_id, sales_order_id, sort_order)`. A sales order has 1–100 items.

Snapshot sources for `product_name`, `sku`, `unit` (and the default `unit_price` / `description`):

- direct create, or a new line on a draft: the active product's current data
- conversion: the quotation line, copied with its quantity, price, discount, tax rate and amounts
- a kept line on a draft (item `id` = an existing line of the same order, same product): that line

Draft line IDs are not durable. An item `id` sent to `update_sales_order_draft()` only identifies the previously recorded line for that save. `sales_order_replace_items()` deletes and re-inserts a draft's items, so row IDs may change after each draft save. Nothing should reference a draft line by ID. After confirmation, items are immutable and their IDs are stable (DECISIONS 022).

### Sales order access rules

- `authenticated` has `SELECT` only on `sales_orders` and `sales_order_items` (RLS `is_org_member`). No INSERT, UPDATE or DELETE privilege or policy. `anon` has nothing.
- Writes go only through `SECURITY DEFINER` functions with `search_path = ''`:
  - `create_sales_order(customer_id, order_date, expected_delivery_date, notes, items jsonb) → uuid`. Any active member. Active customer and active products of the same organization. Items as for `create_quotation`, plus `id` is rejected (no existing lines).
  - `create_sales_order_from_quotation(quotation_id, order_date, expected_delivery_date default null) → uuid`. Any active member. The quotation must be `accepted` and not yet converted. Copies customer reference and snapshot, notes, and every line as stored; customers and products are not re-read, so their later changes or deactivation do not matter. Recomputed totals must equal the quotation's. The quotation is not modified. The result is a `draft`.
  - `update_sales_order_draft(sales_order_id, customer_id, order_date, expected_delivery_date, notes, items jsonb)`. Any active member, `draft` only, direct or converted. Header updated and all items replaced in one transaction. Unchanged `customer_id`: snapshot kept (customer may be inactive). Changed: active customer, fresh snapshot. Each item may carry `id` (an existing line of this order, at most once; unknown or repeated → `22023`): with the same `product_id` the line's snapshot is kept and its price and description are the defaults, and the product may be inactive. Any other item is a new selection and needs an active product.
  - `set_sales_order_status(sales_order_id, status)`. `confirmed` for any active member; `completed`, `cancelled` for owners and managers. Same lookup-then-lock pattern as `set_quotation_status`.
- `get_sales_order(organization_id, sales_order_id) → jsonb` (`SECURITY INVOKER`): header (including `source_quotation_number`) and items in one statement, money as strings, NULL when not visible.
- Lists use `list_sales_orders(organization_id, search, status, customer_id, limit, offset)` (`SECURITY INVOKER`, RLS applies), same rules as `list_quotations`: search is a substring of `sales_order_number` or the `customer_name` snapshot, `grand_total` is text, order `created_at desc, id desc`, limit 1–100, `total_count` before limit/offset. Each row also carries `source_quotation_id` and `source_quotation_number`.
- Errors: `42501` not authenticated / role not allowed; `P0002` sales order or (conversion) quotation not found, the same for unknown, other tenant and disabled member; `23503` customer or product not found or inactive; `22023` invalid input; `22003` amount too large; `23505` quotation already converted; `55000` not a draft / transition not allowed / quotation not accepted.
- Triggers, for every writer: `sales_orders_enforce_rules` freezes `organization_id`, `sales_order_number`, `source_quotation_id`, `created_at` and `created_by` (except to NULL), checks transitions, after `draft` allows no change but `status`, and rejects every DELETE (any status, `55000` `sales orders cannot be deleted`), before the item cascade starts. Deleting an organization that has sales orders therefore fails too; a purge would need an explicit workflow. `sales_order_items_enforce_draft` allows item writes only while the order is `draft`.
- Status transitions: `draft → confirmed | cancelled`, `confirmed → completed | cancelled`. `completed` and `cancelled` are terminal. A confirmed order that has an invoice can no longer be cancelled, only completed (see Invoice access rules).
- Indexes: `(organization_id, created_at desc, id desc)`, `(organization_id, status, created_at desc, id desc)`, `(organization_id, order_date desc)`, `(organization_id, customer_id)`, `(created_by)`, unique `(organization_id, sales_order_number)`, `(organization_id, id)`, `(organization_id, source_quotation_id)`; items unique `(organization_id, sales_order_id, sort_order)`, `(organization_id, product_id)`.
- Sales orders do not affect inventory in V1 Part 1 (no reservation, no deduction) and are never deleted by clients.

### `invoices` (implemented, Part 1: database and domain layer, no UI)

Migration `20261104150000_invoices.sql`, DECISIONS 023. Same shape as `sales_orders`.

| Column | Type | Rules |
| --- | --- | --- |
| `id` | uuid | Primary key |
| `organization_id` | uuid, not null | → `organizations(id)` on delete cascade (blocked by the no-delete trigger). From the customer (direct) or the sales order (conversion), through the caller's active membership; never changes |
| `invoice_number` | text, not null | `INV-000001`, … per organization (`^INV-[0-9]{6,}$`). Unique `(organization_id, invoice_number)`. Generated by the database (`next_document_number(org, 'invoice')`); never changes |
| `customer_id` | uuid, not null | Composite FK `(organization_id, customer_id)` → `customers(organization_id, id)` |
| `source_sales_order_id` | uuid | NULL for direct invoices. Composite FK `(organization_id, source_sales_order_id)` → `sales_orders(organization_id, id)`. Unique `(organization_id, source_sales_order_id)`: one invoice per sales order, ever, even if cancelled (NULLs are distinct, so direct invoices are unaffected). Set only by conversion; never changes |
| `customer_name` | text, not null | Snapshot, 1–200 code points |
| `customer_company_name`, `customer_phone`, `customer_email`, `customer_address`, `customer_tax_number` | text | Snapshot: from the customer (direct create, customer change on a draft) or copied from the sales order (conversion) |
| `invoice_date` | date, not null | Finite |
| `due_date` | date | Optional. Finite, `>= invoice_date` |
| `status` | text, not null | `draft` (default), `issued`, `partially_paid`, `paid`, `cancelled` |
| `notes` | text | Optional. Trimmed, 1–2000 code points. Conversion copies the sales order's notes |
| `subtotal`, `discount_total`, `tax_total`, `grand_total` | numeric(18,2), not null | Computed by the database from the items; same CHECK as quotations |
| `amount_paid` | numeric(18,2), not null | Reserved for the Payment module. `0 ≤ amount_paid ≤ grand_total`. **Part 1: always 0** (`invoices_no_payments_yet_check`) |
| `amount_due` | numeric(18,2), not null | Always `grand_total − amount_paid` (`invoices_balance_check`). Recomputed with the totals on every draft save |
| `created_by` | uuid | → `auth.users(id)` on delete set null. `auth.uid()` |
| `created_at`, `updated_at` | timestamptz, not null | |

Balance constraints:

- `invoices_balance_check` (durable): `amount_paid ≥ 0`, `amount_paid ≤ grand_total` (no overpayment), `amount_due = grand_total − amount_paid`.
- `invoices_status_balance_check` (durable): `paid` ⇒ `amount_due = 0` and `amount_paid = grand_total` (settled; a zero-total invoice with 0 / 0 qualifies, `amount_paid > 0` is not required); `partially_paid` ⇒ `amount_paid > 0` and `amount_due > 0`; every other status ⇒ `amount_paid = 0`.
- `invoices_no_payments_yet_check` (**Part 1 only**): `amount_paid = 0` and status not `partially_paid` / `paid`. No writer can store a payment state yet, not even a zero-total `paid`. The Payment module's migration drops this one constraint.

### `invoice_items` (implemented)

Same columns, types and CHECK constraints as `quotation_items` / `sales_order_items` (including `invoice_items_amounts_check`, the calculation model above), with `invoice_id`: composite FK `(organization_id, invoice_id)` → `invoices(organization_id, id)` on delete cascade, composite FK `(organization_id, product_id)` → `products(organization_id, id)`, unique `(organization_id, invoice_id, sort_order)`. An invoice has 1–100 items.

Snapshot sources for `product_name`, `sku`, `unit` (and the default `unit_price` / `description`):

- direct create, or a new line on a draft: the active product's current data
- conversion: the sales order line, copied with its quantity, price, discount, tax rate and amounts
- a kept line on a draft (item `id` = an existing line of the same invoice, same product): that line

Draft line IDs are not durable (same rule as sales orders, DECISIONS 022/023): an item `id` sent to `update_invoice_draft()` only identifies the previously recorded line for that save. `invoice_replace_items()` deletes and re-inserts a draft's items, so row IDs change after each draft save. Nothing may reference a draft invoice line by ID. After issue, items are immutable and their IDs are stable.

### Invoice access rules

- `authenticated` has `SELECT` only on `invoices` and `invoice_items` (RLS `is_org_member`). No INSERT, UPDATE or DELETE privilege or policy. `anon` has nothing.
- Writes go only through `SECURITY DEFINER` functions with `search_path = ''`. Clients never send the organization, number, status, source sales order, snapshots, amounts, totals, `amount_paid` or `amount_due`:
  - `create_invoice(customer_id, invoice_date, due_date, notes, items jsonb) → uuid`. Any active member. Active customer and active products of the same organization. Items as for `create_sales_order` (`id` rejected). `amount_paid = 0`, `amount_due = grand_total`.
  - `create_invoice_from_sales_order(sales_order_id, invoice_date, due_date default null) → uuid`. Any active member. Locks the authorized sales order `FOR SHARE` (a concurrent status change waits), which must be `confirmed` and not yet invoiced. Copies customer reference and snapshot, notes, and every line as stored; customers and products are not re-read. Recomputed totals must equal the sales order's. The sales order is not modified. The result is a `draft` with `amount_paid = 0`, `amount_due = grand_total`.
  - `update_invoice_draft(invoice_id, customer_id, invoice_date, due_date, notes, items jsonb)`. Any active member, `draft` only, direct or converted. Same customer and line-ID rules as `update_sales_order_draft`.
  - `set_invoice_status(invoice_id, status)`. `issued` for any active member; `cancelled` for owners and managers; `partially_paid` and `paid` are refused for everyone (`42501`, before any lookup). Same lookup-then-lock pattern as `set_sales_order_status`.
- `get_invoice(organization_id, invoice_id) → jsonb` (`SECURITY INVOKER`): header (including `source_sales_order_number`, `amount_paid`, `amount_due`) and items in one statement, money as strings, NULL when not visible.
- No list RPC yet (Part 2, with the UI).
- Errors: `42501` not authenticated / role not allowed / payment status requested; `P0002` invoice or (conversion) sales order not found, the same for unknown, other tenant and disabled member; `23503` customer or product not found or inactive; `22023` invalid input; `22003` amount too large; `23505` sales order already invoiced; `55000` not a draft / transition not allowed / sales order not confirmed.
- Triggers, for every writer: `invoices_enforce_rules` freezes `organization_id`, `invoice_number`, `source_sales_order_id`, `created_at` and `created_by` (except to NULL), checks transitions against the lifecycle table, after `draft` allows no change but `status`, `amount_paid` and `amount_due`, and rejects every DELETE (any status, `55000` `invoices cannot be deleted`) before the item cascade. Deleting an organization that has invoices therefore fails; a purge would need an explicit workflow. `invoice_items_enforce_draft` allows item writes only while the invoice is `draft`.
- Status lifecycle (`invoice_status_transition_allowed`):
  - user: `draft → issued | cancelled`, `issued → cancelled`
  - system, reserved for the Payment module: `issued → partially_paid | paid`, `partially_paid → paid`
  - `paid` and `cancelled` are terminal. `partially_paid` and `paid` have no path to `cancelled` (no refunds or credits in V1).
- Indexes: `(organization_id, created_at desc, id desc)`, `(organization_id, status, created_at desc, id desc)`, `(organization_id, invoice_date desc)`, `(organization_id, due_date)`, `(organization_id, customer_id)`, `(created_by)`, unique `(organization_id, invoice_number)`, `(organization_id, id)`, `(organization_id, source_sales_order_id)`; items unique `(organization_id, invoice_id, sort_order)`, `(organization_id, product_id)`.
- **Invoiced sales orders cannot be cancelled.** Trigger `sales_orders_block_invoiced_cancel` on `sales_orders` (from the invoice migration) rejects a move to `cancelled` while any invoice, also a cancelled one, has that order as its source (`55000`). The order may still be completed. Under concurrency the conversion's `FOR SHARE` lock decides: whichever commits first wins and the other fails with `55000`.
- Invoice lines carry no link to sales order lines; line-level source links stay out of scope until partial invoicing exists.
- Invoices do not affect inventory and are never deleted.

### Other sales tables (planned)

| Table | Notes |
| --- | --- |
| `customer_payments` | One row per payment transaction. Total valid payments may not exceed the invoice total. The Payment module maintains `invoices.amount_paid` (= sum of valid payments) and moves the status to `partially_paid` / `paid` from its own `SECURITY DEFINER` function |

## Purchasing

| Table | Notes |
| --- | --- |
| `purchase_orders`, `purchase_order_lines` | |
| `goods_receipts`, `goods_receipt_lines` | Receiving creates stock movements |
| `supplier_bills`, `supplier_bill_lines` | |
| `supplier_payments` | One row per payment transaction. No overpayment |

## Inventory

| Table | Notes |
| --- | --- |
| `stock_movements` | Append-only. Each row has signed quantity, product, source document type and id, reason, and timestamp. Current stock = sum of movements. Negative resulting stock is rejected |
| `stock_adjustments` | Manual corrections that generate stock movements |

## Other

| Table | Notes |
| --- | --- |
| `expenses` | Organization-owned, with an optional attachment in Storage |
| `audit_logs` | Append-only record of who did what, when, and to which record |

## Derived Values

- Invoice balance = invoice total − sum of valid customer payments.
- Bill balance = bill total − sum of valid supplier payments.
- Stock on hand = sum of `stock_movements.quantity` per product.

Cancelling a document uses a status change and, where relevant, reversing movements or payments. Financial rows are never deleted.


### Invoice list read (Part 2)

`list_invoices(organization_id, search, status, customer_id, limit, offset)` follows the sales order list: STABLE, SECURITY INVOKER, empty search path, authenticated only. RLS and an explicit organization predicate both apply. Searches use invoice number/customer snapshot name, with Unicode trimming and literal LIKE wildcards. Status/customer filters combine; limit is clamped to 1–100, offset to at least zero. Rows sort by `created_at desc, id desc`, include `total_count` before pagination, source sales order ID/number, and exact text for `grand_total`, `amount_paid`, `amount_due`. No Part 1 tables, constraints or write rules change (DECISIONS 024).
