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
