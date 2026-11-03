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
