# SME ERP — Agent Instructions

## Product

This repository contains a lightweight multi-tenant SME ERP.

The product is intended for small businesses and should remain simple, modular, secure, maintainable, and easy to use.

Version 1 focuses on:

- organizations
- users and roles
- customers
- vendors
- products
- quotations
- sales orders
- invoices
- customer payments
- purchase orders
- goods receiving
- supplier bills
- supplier payments
- inventory
- expenses
- dashboards
- basic reports
- CSV import/export
- audit logs

Do not add out-of-scope functionality unless explicitly requested.

## Technology

Current intended stack:

- Next.js 16
- TypeScript
- App Router
- Tailwind CSS
- Supabase
- PostgreSQL
- Supabase Auth
- Supabase Storage
- Vercel

If the repository differs from this, document the difference instead of silently changing code.

Do not introduce new major frameworks or infrastructure without explicit approval.

## Architecture

Keep clear separation between:

```text
UI
→ Server Actions / API
→ Business Logic
→ Database
```

Do not place important business logic directly inside React UI components.

Prefer reusable domain functions such as:

- createInvoice()
- recordPayment()
- cancelInvoice()
- receiveGoods()
- adjustStock()

## Multi-Tenancy

The ERP is multi-tenant.

Every organization-owned record must belong to an organization.

Use `organization_id` consistently.

Never trust an organization ID supplied by the browser without validating the authenticated user's membership.

A user from Organization A must never be able to access Organization B data.

Use PostgreSQL Row Level Security where appropriate.

## Authentication

Use Supabase Auth.

Never store passwords manually.

For server-side authorization, validate the authenticated user securely.

Do not rely only on client-side auth state.

## Authorization

Version 1 roles:

- owner
- manager
- employee

Permissions must be enforced server-side and/or database-side where practical.

Hiding a button in the UI is not sufficient authorization.

## Financial Data

Financial history must be traceable.

Do not silently overwrite financial transactions.

Customer payments must be stored as payment transactions.

Supplier payments must be stored as payment transactions.

Invoice balances should be derived from invoice totals and valid payment records.

For Version 1:

- customer overpayments are not allowed
- supplier overpayments are not allowed
- customer credit balances are out of scope

## Inventory

Inventory must use stock movements.

Do not treat a mutable `product.quantity` field as the authoritative inventory history.

Stock changes must create traceable stock movement records.

Draft quotations and draft sales orders must not reduce inventory.

For Version 1, negative stock is not allowed.

## Historical Documents

Changes to customer, vendor, and product master data must not silently alter historical documents.

Important transaction values should preserve the state relevant at the time of the transaction.

## Security

Never expose:

- database passwords
- Supabase service-role keys
- private secrets
- environment credentials

Do not commit `.env.local`.

Validate sensitive operations on the server.

Protect uploaded files.

Use tenant-safe database queries.

## UI

Prefer existing shared components before creating new ones.

Keep the UI simple and suitable for SME users.

Important data pages should handle:

- loading
- empty state
- validation errors
- unexpected errors

Use server-side pagination for lists expected to grow.

## Coding

Use TypeScript.

Avoid `any` unless there is a strong reason.

Keep functions small and readable.

Avoid unnecessary abstraction.

Do not refactor unrelated code while completing a scoped task.

Do not add dependencies unless necessary.

## Database

Use migrations for schema changes.

Do not make undocumented manual production schema changes.

Consider indexes for:

- organization_id
- foreign keys
- frequently filtered dates
- status
- invoice/order numbers
- SKU

## Testing

For every feature, test:

- happy path
- validation
- permissions
- tenant isolation
- important edge cases

Run:

```bash
npm run lint
npm run build
```

before considering implementation complete.

## Task Execution

Before modifying code:

1. Inspect the existing implementation.
2. Read relevant docs under `/docs`.
3. Read `/tasks/current.md`.
4. Identify existing patterns to reuse.
5. Keep changes limited to the requested task.

At completion:

1. Run relevant checks.
2. Summarize files changed.
3. Explain important architectural decisions.
4. Record durable decisions in `docs/DECISIONS.md`.
5. Do not silently expand scope.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
