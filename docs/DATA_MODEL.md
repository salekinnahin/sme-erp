# Data Model

> **Status:** The tenancy tables (`profiles`, `organizations`, `organization_members`) exist, created by `supabase/migrations/20261104000000_organizations_and_memberships.sql`. Everything else below is the **planned** model and guiding rules. Update this file in the same change as each migration.

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

## Master Data

| Table | Notes |
| --- | --- |
| `customers` | Organization-owned |
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
