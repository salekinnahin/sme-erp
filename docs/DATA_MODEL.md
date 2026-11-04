# Data Model

> **Status:** The tenancy tables (`profiles`, `organizations`, `organization_members`) exist, created by `supabase/migrations/20261104000000_organizations_and_memberships.sql`. `customers` exists, created by `supabase/migrations/20261104020000_customers.sql`. Everything else below is the **planned** model and guiding rules. Update this file in the same change as each migration.

## Global Rules

- Every organization-owned table has `organization_id uuid not null` referencing `organizations(id)`.
- Every organization-owned table has RLS enabled. Policies allow access only to members of that organization.
- Standard columns: `id uuid primary key`, `created_at timestamptz`, `updated_at timestamptz`, `created_by uuid` (references `auth.users`).
- Money uses `numeric(14,2)` or similar exact types. Never use floating point.
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
- `public.list_customers(org_id, search, status, limit, offset)`: `SECURITY INVOKER` (RLS applies). Search, status filter and pagination, with `total_count`. Search matches name, company, email and phone (case-insensitive substring, wildcards literal), plus phone digits.

### Planned

| Table | Notes |
| --- | --- |
| `vendors` | Organization-owned |
| `products` | Products and services. SKU is unique per organization. Do **not** treat a quantity column as authoritative stock |

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
