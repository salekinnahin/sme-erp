# Tenant Isolation Test

Run after any change to tenancy tables, RLS policies, or `lib/tenancy/`.

## 1. Database test (automated SQL)

File: `supabase/tests/tenant_isolation.sql`.

1. Open the Supabase dashboard → SQL Editor.
2. Paste the whole file and run it.
3. Expected: the last result is `ALL TENANT ISOLATION CHECKS PASSED`. Any `FAIL: …` error means a check failed.

The script runs in a transaction that is rolled back, so it leaves no data. It switches to the `anon` and `authenticated` roles with JWT claims set, which is the same path the app's API requests take. It checks:

- the profile trigger, and that each user can read only their own profile
- `anon` cannot read tables or call `create_organization`
- input validation in `create_organization` itself (blank or over-long name, unsupported currency such as `ZZZ`, malformed email or phone, over-long address or tax number), and that a repeat call is rejected
- the shared Unicode rules (DECISIONS 014): names that are only U+00A0, U+0085, U+2003 or U+FEFF are rejected; that whitespace is trimmed from the edges of every field; a 200-emoji name is accepted and a 201-emoji name rejected; an email with inner U+00A0, U+0085 or U+2003 is rejected
- user B cannot read Organization A, its memberships, or user A's profile
- user B cannot insert themselves into Organization A, create a membership for another user, change their own role, move their membership, or insert, update or delete organizations or profiles directly
- user A cannot read Organization B

## 2. UI test (manual, two users)

Use two browsers, or one normal and one private window.

| # | Step | Expected |
| --- | --- | --- |
| 1 | Sign up / sign in as **User A** (no organization yet) | Lands on `/onboarding/organization` |
| 2 | Visit `/dashboard` directly | Redirected back to `/onboarding/organization` |
| 3 | Submit with an empty name | "Organization name is required." No organization is created |
| 4 | Create **Organization A**. Double-click the submit button | Button shows "Creating organization…" and is disabled. Lands on `/dashboard` showing "Organization: Organization A" and "Role: Owner". Only one organization exists (Table Editor) |
| 5 | Refresh `/dashboard` | Same organization and role |
| 6 | Visit `/onboarding/organization` directly | Redirected to `/dashboard` |
| 7 | Log out, then log in again | Lands on `/dashboard`, not onboarding |
| 8 | Signed out, visit `/dashboard` and `/onboarding/organization` | Redirected to `/auth/login` |
| 9 | In the other browser, sign up as **User B** and create **Organization B** | B's dashboard shows Organization B only |
| 10 | As User B, open the browser devtools console on the app and run the API probe below | Every result is empty or an error. No Organization A data |

API probe for step 10. It uses the app's public URL and publishable key, which are already exposed to the browser, together with User B's session. Get the access token from the `sb-…-auth-token` cookie, or use the SQL test instead.

```js
const url = "<NEXT_PUBLIC_SUPABASE_URL>", key = "<NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY>";
const token = "<User B access token>";
const h = { apikey: key, Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
const orgA = "<Organization A id from Table Editor>";
console.log(await (await fetch(`${url}/rest/v1/organizations?id=eq.${orgA}`, { headers: h })).json());          // []
console.log(await (await fetch(`${url}/rest/v1/organization_members?organization_id=eq.${orgA}`, { headers: h })).json()); // []
console.log(await (await fetch(`${url}/rest/v1/organization_members`, { method: "POST", headers: h,
  body: JSON.stringify({ organization_id: orgA, user_id: "<User B id>", role: "owner" }) })).status);           // 401/403
console.log(await (await fetch(`${url}/rest/v1/rpc/create_organization`, { method: "POST", headers: h,
  body: JSON.stringify({ p_name: "Second", p_currency: "BDT", p_timezone: "UTC" }) })).json());                 // already-member error
```

## 3. Customers

Run after any change to `customers`, its functions or policies, `lib/customers/`, or `app/customers/`.

### 3.1 Database test (automated SQL)

File: `supabase/tests/customers.sql` (needs migrations up to `20261104060000_align_customer_search_trim.sql`). Run it like `tenant_isolation.sql`, but as a separate run in the SQL Editor. Expected last result: `ALL CUSTOMER CHECKS PASSED`. It is rolled back.

It checks:

- `anon` cannot read customers or call `list_customers` or `set_customer_status`
- owner A creates, reads and updates Customer A, and the server-side defaults (`status = 'active'`, `created_by`)
- CHECK constraints reject:
  - a blank, untrimmed or over-long name
  - leading/trailing or whitespace-only values using U+00A0, U+0085, U+2003, tab or newline, and email containing them anywhere (inner whitespace in names and notes is accepted)
  - 201 emoji in a name or company name, 2001 emoji in notes (200 / 2000 emoji, and 200 Bengali letters, are accepted: lengths count code points)
  - a non-lowercase or malformed email
  - a bad phone
  - `''` for an optional field
  - over-long address, tax number or notes
- clients cannot write `status`, `created_by`, `created_at` or `organization_id` on update, and cannot delete
- owner and manager can deactivate and reactivate; an invalid status is rejected
- an employee can create, read and edit, but cannot deactivate or reactivate
- a disabled member cannot read, list, create, update or change status, and `has_org_role` is false for them
- user B cannot read, update, deactivate, reactivate or delete Customer A, or create a customer with Organization A's ID
- `set_customer_status` fails identically (`P0002: customer not found`) for Customer A's ID and for an unknown ID, and its definition takes no explicit row lock (`FOR UPDATE`/`FOR SHARE`)
- `list_customers` with Organization A's ID returns nothing for user B, whatever the search, filter or page
- a search padded with U+00A0, U+3000, U+2003, U+0085 or U+FEFF is trimmed with the shared whitespace set (including phone-digit searches), and a whitespace-only search lists everything
- search (name, company, email, phone, phone digits) and the status filter stay within the tenant; `%` and `_` are literal; pages are disjoint; `total_count` is stable; limit and offset are clamped

Optional lock check (needs two `psql` sessions; the SQL Editor commits each run). Session 1, as `postgres`: `begin; select 1 from public.customers where id = '<Customer A id>' for update;` and leave it open. Session 2: `begin; set local role authenticated; select set_config('request.jwt.claims', '{"sub":"<User B id>","role":"authenticated"}', true); select public.set_customer_status('<Customer A id>', 'inactive');`. Expected: it returns `customer not found` at once, without waiting. Then roll back both sessions.

### 3.2 UI test (manual)

Use User A (owner of Organization A) and User B (owner of Organization B) from section 2. For the employee check, add a third user to Organization A as an `employee` in the Table Editor (`organization_members`), because there is no invitation flow yet.

| # | Step | Expected |
| --- | --- | --- |
| 1 | As A, open **Customers** in the header | "No customers yet." and "Add your first customer" |
| 2 | Submit the new-customer form with an empty name, `bad-email` as the email and `abc` as the phone | Per-field errors. Nothing is created |
| 3 | Create a customer: name `  Acme  `, email `Buyer@Acme.Test`. Double-click Create | Button shows "Creating…" and is disabled. Lands on the detail page showing `Acme` and `buyer@acme.test`. Exactly one customer exists |
| 4 | Edit the customer, change the company name, save | Back on the detail page with the new value. "Last updated" changes |
| 5 | Deactivate | A confirmation appears. Cancel keeps the customer active. Confirm shows the Inactive badge, and Reactivate is offered |
| 6 | Add 26+ customers (or use the SQL Editor), then page through the list | 25 per page, newest first. Previous/Next keep the search and status filter |
| 7 | Search by part of a name, company, email and phone; filter Active / Inactive | Only matching customers of Organization A |
| 8 | As B, open `/customers/<Customer A id>` and `/customers/<Customer A id>/edit` | "Customer not found". No Customer A data |
| 9 | As B, search for Customer A's name | "No customers match your search." |
| 10 | As the employee of Organization A, open a customer | Edit is shown. Deactivate and Reactivate are not |
| 11 | As B, run the API probe below in the devtools console | Every result is empty or an error |
| 12 | Open `/customers/not-a-uuid` | "Customer not found" |
| 13 | Create a customer whose name is 200 emoji (e.g. 😀); then try 201 | 200 is saved; 201 shows "Use at most 200 characters." |
| 14 | Create a customer whose name is only non-breaking spaces (Option+Space on macOS) | "Customer name is required." |

API probe for step 11. Use the same `url`, `key` and `h` as the probe in section 2, with User B's token.

```js
const custA = "<Customer A id>", orgA = "<Organization A id>";
console.log(await (await fetch(`${url}/rest/v1/customers?id=eq.${custA}`, { headers: h })).json());                 // []
console.log(await (await fetch(`${url}/rest/v1/customers?id=eq.${custA}`, { method: "PATCH", headers: { ...h, Prefer: "return=representation" },
  body: JSON.stringify({ name: "Hacked" }) })).json());                                                              // []
console.log(await (await fetch(`${url}/rest/v1/customers`, { method: "POST", headers: h,
  body: JSON.stringify({ organization_id: orgA, name: "Planted" }) })).status);                                     // 401/403
console.log(await (await fetch(`${url}/rest/v1/rpc/set_customer_status`, { method: "POST", headers: h,
  body: JSON.stringify({ p_customer_id: custA, p_status: "inactive" }) })).json());                                 // "customer not found"
console.log(await (await fetch(`${url}/rest/v1/rpc/list_customers`, { method: "POST", headers: h,
  body: JSON.stringify({ p_organization_id: orgA }) })).json());                                                     // []
console.log(await (await fetch(`${url}/rest/v1/customers?id=eq.${custA}`, { method: "DELETE", headers: h })).status); // 401/403
```

## 4. Vendors

Run after any change to `vendors`, its functions or policies, `lib/vendors/`, or `app/vendors/`. Vendors follow the customer pattern, so the checks mirror section 3.

### 4.1 Database test (automated SQL)

File: `supabase/tests/vendors.sql`. Run it as a separate run in the SQL Editor, after migration `20261104050000_vendors.sql`. Expected last result: `ALL VENDOR CHECKS PASSED`. It is rolled back.

It checks everything listed in 3.1 for `vendors`, `list_vendors` and `set_vendor_status` (the error for other-tenant and unknown IDs is `P0002: vendor not found`), plus:

- a search padded with U+00A0 / U+3000 is trimmed with the shared whitespace set; a whitespace-only search lists everything
- customers never appear in `list_vendors`, and `set_vendor_status` with a customer ID is "not found"
- a manager whose membership is disabled later loses read, list, create, update and status access at once

### 4.2 UI test (manual)

Repeat the steps in 3.2 under **Vendors** (`/vendors`), with these expected texts: "No vendors yet." / "Add your first vendor", "Vendor name is required.", "Vendor not found", "No vendors match your search.". The list has no payable balance column, and the detail page has no purchase history.

API probe: the probe in 3.2 with `vendors`, `set_vendor_status` (`p_vendor_id`) and `list_vendors`. Every result is empty or an error.
