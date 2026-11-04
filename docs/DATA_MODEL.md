# Data Model

> **Status:** The tenancy tables (`profiles`, `organizations`, `organization_members`) exist, created by `supabase/migrations/20261104000000_organizations_and_memberships.sql`. `customers` exists, created by `supabase/migrations/20261104020000_customers.sql`. `vendors` exists, created by `supabase/migrations/20261104050000_vendors.sql`. `product_categories` and `products` exist, created by `supabase/migrations/20261104070000_products.sql`. Everything else below is the **planned** model and guiding rules. Update this file in the same change as each migration.

## Global Rules

- Every organization-owned table has `organization_id uuid not null` referencing `organizations(id)`.
- Every organization-owned table has RLS enabled. Policies allow access only to members of that organization.
- Standard columns: `id uuid primary key`, `created_at timestamptz`, `updated_at timestamptz`, `created_by uuid` (references `auth.users`).
- Money uses exact decimal types, never floating point. Prices are `numeric(18,2)` in the organization's base currency (DECISIONS 016); use the same type for future money columns unless a decision says otherwise. Read money as text (`::text`) and write it as a decimal string, so the app never parses it into a JavaScript number.
- Document numbers, such as invoice and order numbers, are unique per organization: `unique (organization_id, number)`.
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
- Indexes: `(organization_id, created_at desc, id desc)`, `(organization_id, status, created_at desc, id desc)`, `(created_by)`.
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
- Indexes: unique `(organization_id, lower(sku))`, `(organization_id, created_at desc, id desc)`, `(organization_id, status, created_at desc, id desc)`, `(organization_id, category_id)`, `(created_by)`.
- Never deleted. Inactive products stay editable and visible to historical documents; future transaction forms should offer only active products.
- Future documents (quotations, orders, invoices, bills) must snapshot name, SKU and price on their lines (DECISIONS 008); editing a product does not change them.

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

| Table | Notes |
| --- | --- |
| `quotations`, `quotation_lines` | Drafts do not affect inventory |
| `sales_orders`, `sales_order_lines` | Drafts do not affect inventory |
| `invoices`, `invoice_lines` | Lines snapshot product name, price and tax at the time of issue |
| `customer_payments` | One row per payment transaction. Total valid payments may not exceed the invoice total |

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
