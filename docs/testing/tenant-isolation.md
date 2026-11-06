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

### 3.3 Whitespace helpers (all suites)

Since migration `20261104100000_restore_whitespace_line_separators.sql`, `customers.sql`, `vendors.sql`, `products.sql` and `quotations.sql` also check U+2028 LINE SEPARATOR and U+2029 PARAGRAPH SEPARATOR: trimmed at both edges by `trim_whitespace()`, rejected by `text_is_trimmed()` at either edge or as the only content, detected anywhere by `text_has_whitespace()`, and rejected by the name, SKU, description, category and email constraints. U+200B is never whitespace. The whole-set test strings are written with `\uXXXX` escapes (DECISIONS 019).

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

## 5. Products and categories

Run after any change to `products`, `product_categories`, their functions or policies, `lib/products/`, or `app/products/`.

### 5.1 Database test (automated SQL)

File: `supabase/tests/products.sql`. Run it as a separate run in the SQL Editor, after migrations `20261104070000_products.sql` and `20261104080000_restrict_product_category_writes.sql`. Expected last result: `ALL PRODUCT CHECKS PASSED`. It is rolled back.

It checks:

- `anon` cannot read products or categories, or call `list_products`, `set_product_status` or `set_product_category_status`
- categories: defaults; duplicate names rejected ignoring case (insert and rename); blank, NBSP-only, U+2003-padded and 101-emoji names rejected, 100 emoji accepted; `status`, `organization_id` not client-writable; no delete; owner and manager can deactivate and reactivate, employee cannot
- SKU: duplicate rejected in the same organization, also with different case (insert and update); the same SKU and category name allowed in Organization B; blank, NULL, NBSP/U+0085/U+FEFF-padded and 101-emoji SKUs rejected; 100 emoji and inner spaces accepted
- name and description: shared whitespace set, code-point limits (200 / 2000), `''` rejected for description
- product type and unit: unknown values (and `PCS`) rejected
- prices: negative, `NaN`, `Infinity` and values over `numeric(18,2)` rejected; 0 and 9999999999999999.99 accepted; `list_products` returns prices as exact text
- reorder level: negative, `NaN` and NULL rejected; non-zero rejected for `service` and `non_inventory`; changing an inventory product to `service` requires `reorder_level = 0`; fractional values allowed for inventory
- an unknown category and another organization's category are both rejected with `foreign_key_violation`
- `status`, `created_by`, `created_at`, `organization_id` not client-writable; no delete; inactive products stay editable
- employee can create, read and edit products, read categories and assign an active one, but cannot create, rename, deactivate or reactivate categories, or change product status; manager can create, rename, deactivate and reactivate categories
- an unrelated product edit keeps an existing inactive category
- a disabled member, and a manager disabled later, cannot read, list, create, update or change status
- user B cannot read, update, change status of, or delete Product A or Organization A's categories, cannot create rows with Organization A's ID, and other-tenant and unknown IDs fail identically (`P0002: product not found` / `P0002: category not found`); the status functions take no explicit row lock
- `list_products` with Organization A's ID returns nothing for user B, whatever the search or filters
- search by name, SKU (partial and exact, any case) and category name; `%` and `_` literal; Unicode-padded search trimmed; whitespace-only search lists everything; status, type and category filters, alone and combined; disjoint pages, stable `total_count`, clamped limit and offset

### 5.2 UI test (manual)

Use Users A and B and the Organization A employee from section 3.2.

| # | Step | Expected |
| --- | --- | --- |
| 1 | As A, open **Products** in the header | "No products yet." and "Add your first product" |
| 2 | Open **Categories**, add `Electronics`, then add `electronics` | First is added; second shows "A category with this name already exists." |
| 3 | New product with empty name and SKU, purchase price `-5`, selling price `1.239` | Per-field errors. Nothing is created |
| 4 | Create `Laptop`, SKU `SKU-001`, Inventory, Electronics, pcs, purchase `1000.5`, selling `1200`, reorder `5`. Double-click Create | Button shows "Creating…". Lands on the detail page: prices `BDT 1,000.50` / `BDT 1,200.00`, reorder level `5 pcs`. One product exists |
| 5 | Create another product with SKU `sku-001` | "This SKU is already used by another product." |
| 6 | Switch the type to Service on the form | The Reorder level field disappears. After saving, the detail page has no reorder level |
| 7 | Edit the product, change category and prices, save | Detail shows the new values; "Last updated" changes |
| 8 | Deactivate (confirm) and reactivate | Inactive badge and note, then Active again |
| 9 | Deactivate the `Electronics` category, then open New product | `Electronics` is not offered. Editing a product already in it shows `Electronics (inactive)` |
| 10 | Add 26+ products, page through; search by name, SKU and category name; filter by status, type and category | 25 per page, newest first; filters kept across pages; only Organization A rows |
| 11 | As B, open `/products/<Product A id>` and its `/edit`; search for `SKU-001` | "Product not found"; B's own `SKU-001` (if created) only |
| 12 | As the employee, open a product and the categories page | Product Edit shown; no Deactivate / Reactivate. Categories page lists categories with no add form, Rename or status buttons. The product form link says "View categories" |
| 14 | Deactivate a product's category, then edit only that product's description and save | The edit form shows the category as "(inactive)"; after saving, the product still has it |
| 13 | Open `/products/not-a-uuid` | "Product not found" |

API probe: as in 3.2, with `products`, `set_product_status` (`p_product_id`), `set_product_category_status` (`p_category_id`) and `list_products`. Also try a `POST` to `products` in B's organization with `category_id` set to an Organization A category ID: expect a foreign-key error, the same as for a random UUID.

## 6. Quotations

Run after any change to `quotations`, `quotation_items`, `document_number_counters`, their functions, triggers or policies, `lib/quotations/`, or `app/quotations/`.

### 6.1 Database test (automated SQL)

File: `supabase/tests/quotations.sql`. Run it as a separate run in the SQL Editor, after migrations `20261104090000_quotations.sql`, `20261104100000_restore_whitespace_line_separators.sql`, `20261104110000_get_quotation.sql` and `20261104120000_list_quotations.sql`. Expected last result: `ALL QUOTATION CHECKS PASSED`. It is rolled back.

It checks:

- `anon` cannot read quotations or items, or call `create_quotation`, `update_quotation_draft`, `set_quotation_status` or `get_quotation`
- `get_quotation` is a `SECURITY INVOKER`, `STABLE` SQL function with `search_path = ''`, executable by `authenticated` only. For the owner and the employee it returns the header and the items as one document: exact money and quantity strings (JSON strings, not numbers), items ordered by `sort_order`, item totals adding up to the header, and items identical to the table. It returns NULL for a wrong organization, an unknown ID, NULL arguments, user B (with either organization ID), a disabled member, and a manager disabled later
- U+2028 / U+2029 at the start or end of notes and item descriptions are trimmed, U+2028-only notes and descriptions become empty, and inner U+2028 is kept
- the three functions are `SECURITY DEFINER` with `search_path = ''`, executable by `authenticated` only; the internal helpers (`next_document_number`, `quotation_replace_items`, `quotation_parse_decimal`, `quotation_normalize_header`, `quotation_status_transition_allowed`, trigger functions) are not executable by API roles; `authenticated` has no INSERT/UPDATE/DELETE (table or column) on either table and cannot read the counters; `set_quotation_status` locks only through the role-checked predicate
- creation: organization, `created_by`, `draft` status, number `QT-000001`, `QT-000002`, … and customer and product snapshots are derived by the database; forged `product_name`, `sku`, `unit`, `tax_amount` and `line_total` keys are ignored; notes and descriptions are trimmed with the shared whitespace set; unit price and description default to the product's and can be overridden (or the description cleared); 100 items and 2000-code-point notes and descriptions are accepted
- totals and rounding: exact values for decimal quantities, half-up rounding of gross and tax (`1.005 × 1.00 = 1.01`, `10.00 × 0.05% = 0.01`, `0.001 × 0.01 = 0.00`), discount equal to gross, and grand total = sum of line totals
- rejected input: no items, 101 items, non-array or non-object items, missing or malformed product, zero / negative / 4-decimal / NaN / exponent / missing quantity, negative or 3-decimal price, no price available, tax over 100, negative or 3-decimal tax, negative discount, discount over gross, over-long description or notes, missing or infinite dates, expiry before the quotation date, amounts over `numeric(18,2)`, inactive customer or product
- failed creates consume no numbers (the next one continues without a gap)
- unknown and other-tenant customers and products fail identically (`23503`)
- direct writes as an owner are refused (`42501`): insert, update of totals, `organization_id`, number, `created_by`, `status` or notes, delete, and item insert, update and delete
- snapshots: renaming the customer and product, changing the product's price, SKU, unit and description leave existing quotations unchanged; a draft update re-snapshots from current master data, replaces the items, recomputes totals, and keeps number and creator; a failed draft update leaves the draft unchanged
- draft update rejects inactive or other-tenant customers, other-tenant products, no items, and unknown IDs (`P0002`)
- employee: reads, creates, edits drafts and marks sent; cannot cancel, accept, reject or expire, from draft or from sent (`42501`)
- every allowed transition by a manager; invalid ones (`55000`): repeating `sent`, any change from a terminal status, draft straight to accepted / rejected / expired; `draft`, unknown, wrong-case, empty and NULL statuses (`22023`)
- after sent (and accepted): `update_quotation_draft` fails with `55000`; as `postgres` (bypassing privileges), the triggers still reject header changes (notes, customer, dates, totals), item insert, update and delete, identity changes on a draft, and invalid status updates; `created_by` may still become NULL
- table constraints (as `postgres`): inconsistent line total or tax amount, zero quantity, tax rate over 100, inconsistent grand total, and links to another organization's customer, product or quotation are rejected
- user B cannot read Organization A quotations or items, has separate numbering (`QT-000001`), cannot use A's customer or product, and update and status changes of A's quotation fail exactly like unknown IDs (`P0002: quotation not found`)
- a disabled member, and a manager disabled later, cannot read, list, create, update or change status
- `list_quotations`: `anon` cannot call it; `SECURITY INVOKER`, `STABLE` SQL, `search_path = ''`, `authenticated` only. Unfiltered it returns every quotation of the organization ordered `created_at desc, id desc` (the tie-breaker alone decides inside the test transaction). Rows carry the customer-name snapshot and `grand_total` as exact text. Search by number (substring, any case, NBSP/U+3000-padded) and by customer name uses the snapshot (a renamed customer's old quotations match the old name only); `%` and `_` are literal; `\` and unknown terms match nothing; whitespace-only lists everything. Status filter for each of the six statuses, combined with search, unknown status matches nothing. Customer filter for an own customer, a customer without quotations, and another tenant's customer. Consecutive pages are slices of the ordered list with a stable `total_count`; limit/offset clamping. Another or no organization ID returns nothing; the employee sees the same list; user B gets nothing of A with any filter and only B's own quotation in B

Not covered by the script (needs two sessions; the SQL Editor runs one): concurrent creates, and a draft saved while `get_quotation` runs (it reads in one statement, so it sees either the old or the new document, never a mix). To check by hand with two `psql` sessions as the same organization member, `begin;` and call `create_quotation(...)` in both. The second waits until the first commits, then gets the next number.

### 6.2 API probe (manual)

As User B (section 2 probe variables), with Organization A's quotation and customer IDs. Every result must be empty or an error:

```js
const qA = "<Quotation A id>", custA = "<Customer A id>", prodA = "<Product A id>";
console.log(await (await fetch(`${url}/rest/v1/quotations?id=eq.${qA}`, { headers: h })).json());                      // []
console.log(await (await fetch(`${url}/rest/v1/quotation_items?quotation_id=eq.${qA}`, { headers: h })).json());       // []
console.log(await (await fetch(`${url}/rest/v1/quotations?id=eq.${qA}`, { method: "PATCH", headers: h,
  body: JSON.stringify({ grand_total: 1 }) })).status);                                                                  // 401/403
console.log(await (await fetch(`${url}/rest/v1/rpc/set_quotation_status`, { method: "POST", headers: h,
  body: JSON.stringify({ p_quotation_id: qA, p_status: "cancelled" }) })).json());                                       // "quotation not found"
console.log(await (await fetch(`${url}/rest/v1/rpc/create_quotation`, { method: "POST", headers: h,
  body: JSON.stringify({ p_customer_id: custA, p_quotation_date: "2026-11-04", p_expiry_date: null, p_notes: null,
    p_items: [{ product_id: prodA, quantity: "1" }] }) })).json());                                                      // "customer not found"
```

### 6.3 UI test (manual)

Use Users A and B and the Organization A employee from section 3.2. Organization A needs an active customer, an inactive customer, an active product with a selling price (`Laptop`, 100.00), an active service without one, and one inactive product.

| # | Step | Expected |
| --- | --- | --- |
| 1 | As A, open **Quotations** in the header | "No quotations yet." and "Create your first quotation" |
| 2 | New quotation; click into Customer, then into Product on line 1 | Quotation date is today (organization time zone). Each field shows "Searching…", then up to 25 active records (newest first). Typing searches the server (customer: name, company, phone, email; product: name, SKU, category). The inactive customer and inactive product are never offered; a term with no match shows "No active customers found." / "No active products found."; more than 25 matches shows "More results match…". Enter in the search field never submits the form |
| 2a | With 500+ active customers and products, search for the last one by name (and a product by SKU); search `%` and `_` | Found and selectable; `%` / `_` match only records that contain those characters |
| 3 | Choose `Laptop` on line 1 | Description and unit price `100.00` are prefilled; unit shows `pcs`. Quantity `2.5`, discount `10`, tax `15` → line total `BDT 276.00` |
| 4 | Add a line: the service, quantity `3`, unit price `33.33`, tax `7.5` | Line total `BDT 107.49`; totals 349.99 / 10.00 / 43.50 / 383.49 |
| 5 | Set expiry before the quotation date, quantity `0` on a line, discount `999` on another, tax `101`; submit | Per-field errors next to each field; nothing is created; the lines are kept |
| 6 | Leave the service's unit price blank and submit | "Enter a unit price. This product has no selling price." on that line |
| 7 | Fix and create; double-click Create | "Creating…"; lands on `QT-000001` detail with exactly the previewed totals. One quotation exists |
| 8 | Rename the customer and change `Laptop`'s price; reopen the quotation | Detail still shows the old customer name and `100.00` (snapshot) |
| 9 | Edit the draft, change only the notes, save | Customer and products unchanged (not cleared); line prices unchanged; the customer snapshot now shows the new name. Opening a search and closing it without choosing (Escape or click away), or a search with no result, keeps the selection |
| 10 | Deactivate the customer, open Edit | The customer shows "(inactive)" with a warning; saving shows "This customer is inactive…". Same for an inactive product on a line |
| 11 | As the employee, open the draft | Edit, Print and only **Mark sent** shown. Mark sent (confirm) → status Sent; Edit disappears; no further buttons |
| 12 | As the employee, open `/quotations/<id>/edit` of the sent quotation | Redirected to the detail page |
| 13 | As A, on the sent quotation | Accept, Reject, Expire, Cancel quotation shown. Accept → no buttons left |
| 14 | As A, open a stale tab of the sent quotation after accepting it elsewhere and click Reject | "This status change is not possible from the quotation's current status…" |
| 15 | Create 26+ quotations; page through; search `QT-00001`, part of a customer name; filter by status and by customer | 25 per page, newest first; filters kept across pages; empty search result offers "Clear search and filters" |
| 16 | Print from the detail page; open the browser print preview | Organization name and contact details, number, dates, customer snapshot, items, totals, notes. No header, navigation or buttons. Readable in dark mode (paper is white). Save as PDF works |
| 17 | As B, open `/quotations/<A id>`, `/edit`, `/print`; `/quotations?customer=<A customer id>`; on B's new quotation, search A's customer and product names and SKU | "Quotation not found" for all three; the list shows nothing of A; the searches find nothing of A |
| 18 | Open `/quotations/not-a-uuid` and `/quotations/not-a-uuid/print` | "Quotation not found" |

## 7. Sales orders

Run after any change to `sales_orders`, `sales_order_items`, their functions, triggers or policies, `document_number_counters`, the quotation tables, or `lib/sales-orders/`.

### 7.1 Database test (automated SQL)

File: `supabase/tests/sales_orders.sql`. Run it as a separate run in the SQL Editor, after all migrations up to `20261104140000_list_sales_orders.sql`. Expected last result: `ALL SALES ORDER CHECKS PASSED`. It is rolled back.

It checks:

- `anon` cannot read orders or items, or call any of the five functions
- definitions: the four write functions are `SECURITY DEFINER` with `search_path = ''`, `authenticated` only. The internal helpers (`sales_order_replace_items`, `sales_order_recompute_totals`, `sales_order_normalize_header`, `sales_order_status_transition_allowed`, the trigger functions, `next_document_number`) have a fixed `search_path` and cannot be executed by API roles. `get_sales_order` is `SECURITY INVOKER`, `STABLE` SQL. `set_sales_order_status` locks only through the role-checked predicate. No INSERT/UPDATE/DELETE (table or column) for API roles. The counter type check allows `sales_order`
- direct creation: `SO-000001`, `SO-000002`, … per organization; organization, creator, `draft`, `source_quotation_id` NULL and customer and product snapshots derived by the database; forged snapshot, amount and organization keys ignored; trimming (including U+2028 / U+2029); defaults and overrides of price and description; 100 items and 2000-code-point notes and descriptions accepted
- calculations: the quotation examples (349.99 / 10.00 / 43.50 / 383.49 and the rounding set `1.01, 10.01, 0.00, 66.38, 0.00` → 75.98 / 5.97 / 7.39 / 77.40)
- rejected input: the quotation list (items, quantity, price, tax, discount, description, overflow, inactive / other-tenant product), plus a line `id` on create, a product deactivated after a quotation, missing or infinite dates, expected delivery before the order date, over-long notes, and an inactive, deactivated or NULL customer. Failures consume no numbers. Unknown and other-tenant customers and products fail identically
- conversion of an accepted quotation whose customer and one product were deactivated, and whose other product was renamed and repriced, after acceptance:
  - it succeeds as a `draft` with `source_quotation_id` set
  - the customer snapshot, notes and every line (column for column) come from the quotation, not the master data
  - totals are equal to the quotation's
  - the quotation is byte-for-byte unchanged
- conversion is refused for a second time (`23505`), for draft, sent, rejected, expired and cancelled quotations (`55000`), for invalid dates (`22023`), and for unknown, NULL and other-tenant quotations (`P0002`, identical)
- `get_sales_order`: one document with exact strings, `source_quotation_number`, ordered items; NULL for a wrong organization, unknown ID or NULLs
- direct writes as an owner (`42501`): insert (also with a forged `source_quotation_id`), update of number, organization, creator, source quotation, totals, snapshot, status, notes, delete, and item insert, update and delete; internal helpers not callable
- snapshots survive customer and product changes
- draft edits:
  - an unchanged customer keeps its snapshot; a changed customer is re-snapshotted (also when changed back)
  - kept lines (`id` + same product) keep their snapshot and price; new lines take the current product
  - a converted draft with an inactive customer and an inactive product can be saved with its lines kept, and totals are recomputed
  - rejected: a new line of an inactive product; a line `id` with a changed, inactive product; another order's, an unknown, a repeated or a non-string line `id`; a change to an inactive customer; a zero quantity. Each rejection leaves the order unchanged
  - a line `id` with a changed, active product re-snapshots
  - the source quotation stays unchanged throughout
- employee: reads, converts, creates, edits drafts and confirms; cannot complete or cancel, from draft or confirmed (`42501`)
- manager: every allowed path; invalid transitions (`55000`); `draft`, unknown, wrong-case, empty, quotation statuses and NULL (`22023`)
- after confirmation (and for completed and cancelled orders): `update_sales_order_draft` fails (`55000`). As `postgres`, the triggers still reject:
  - header, customer, date and total changes
  - item insert, update and delete
  - identity changes (number, organization, creator, `source_quotation_id` set or cleared), even on a draft
  - invalid status updates

  `created_by` may still become NULL
- no deletion (as `postgres`): deleting a direct draft, confirmed, completed, cancelled (from draft and from confirmed), converted draft or converted completed order fails (`55000`). Header, items and `source_quotation_id` remain. Bulk and organization deletes fail too. Both source quotations still cannot be converted again (`23505`). UPDATE immutability is unchanged
- table constraints (as `postgres`):
  - inconsistent line, tax or grand total; zero quantity; tax over 100; delivery before the order date
  - links to another tenant's product, customer, sales order or quotation
  - a second order for the same quotation (`23505`); a duplicate number; a malformed number
- user B:
  - cannot read A's orders or items
  - converts B's own quotation as `SO-000001`
  - converting A's quotation, updating A's order and changing its status all fail exactly like unknown IDs (`P0002`)
  - cannot use A's customer or product, or a foreign line `id`
- `list_sales_orders` (Part 2): `anon` cannot call it; `SECURITY INVOKER`, `STABLE` SQL, `search_path = ''`, `authenticated` only. As owner A: every order, newest first with the ID tie-breaker; row content (snapshot name, money as text, dates, `source_quotation_number` for converted orders, NULL for direct ones); number search (substring, any case, Unicode-padded); customer search uses the snapshot, not a later rename; `%`, `_`, `\` literal; whitespace-only search lists everything; each status filter, alone and with a search; customer filter (own, without orders, other tenant's); consecutive pages, stable `total_count`, clamped limit and offset; another or NULL organization gives nothing. The tenant-filtered lookup of a quotation's sales order. The employee sees the same total. User B lists nothing of A whatever the filters, and only B's own converted order
- a disabled member, and a manager disabled later, cannot read, list, create, convert, update or change status

Not covered by the script (needs two sessions): concurrent conversions of the same quotation. To check by hand, open two `psql` sessions as the same member, `begin;`, and call `create_sales_order_from_quotation(<id>, current_date)` in both. The second waits for the first to commit and then fails with `23505`.

### 7.2 API probe (manual)

As User B (section 2 probe variables), with Organization A's sales order, accepted quotation and customer IDs. Every result must be empty or an error:

```js
const soA = "<Sales order A id>", qA = "<Accepted quotation A id>";
console.log(await (await fetch(`${url}/rest/v1/sales_orders?id=eq.${soA}`, { headers: h })).json());                  // []
console.log(await (await fetch(`${url}/rest/v1/sales_order_items?sales_order_id=eq.${soA}`, { headers: h })).json()); // []
console.log(await (await fetch(`${url}/rest/v1/sales_orders?id=eq.${soA}`, { method: "PATCH", headers: h,
  body: JSON.stringify({ status: "completed" }) })).status);                                                          // 401/403
console.log(await (await fetch(`${url}/rest/v1/rpc/create_sales_order_from_quotation`, { method: "POST", headers: h,
  body: JSON.stringify({ p_quotation_id: qA, p_order_date: "2026-11-04" }) })).json());                               // "quotation not found"
console.log(await (await fetch(`${url}/rest/v1/rpc/set_sales_order_status`, { method: "POST", headers: h,
  body: JSON.stringify({ p_sales_order_id: soA, p_status: "cancelled" }) })).json());                                 // "sales order not found"
```

```js
console.log(await (await fetch(`${url}/rest/v1/rpc/list_sales_orders`, { method: "POST", headers: h,
  body: JSON.stringify({ p_organization_id: "<Organization A id>" }) })).json());                                    // []
```

### 7.3 UI test (manual)

Use Users A and B and the Organization A employee from section 3.2. Organization A needs an active customer, an active product with a selling price (`Laptop`, 100.00), an active service without one, and an accepted quotation.

| # | Step | Expected |
| --- | --- | --- |
| 1 | As A, open **Sales Orders** in the header | "No sales orders yet." and "Create your first sales order" |
| 2 | New sales order; open Customer and Product search | Order date is today (organization time zone); expected delivery empty. Same selector as quotations: server search, active only, 25 per search, "More results match…", Enter never submits. Find a record beyond the first 500 by name / SKU |
| 3 | Choose `Laptop`, quantity `2.5`, discount `10`, tax `15`; add the service at `33.33`, quantity `3`, tax `7.5` | Unit `pcs` shown (not editable); description and price prefilled; line totals `276.00` and `107.49`; totals 349.99 / 10.00 / 43.50 / 383.49 |
| 4 | Expected delivery before the order date; quantity `0`; discount `999`; tax `101`; submit | Per-field errors; nothing created; lines kept |
| 5 | Fix and create | Lands on `SO-000001` detail, status Draft, Source "Created directly", exactly the previewed totals |
| 6 | Deactivate `Laptop`; Edit the draft; change only the notes; save | Line 1 still shows `Laptop` "(inactive)" with its recorded unit and price; a note says it can be kept. Saving succeeds; the line is unchanged |
| 7 | Edit again: remove line 2, add a new line with an active product, change line 1 to another active product; save | Saved. Line 1 shows the new product's current details; the removed line is gone |
| 8 | Edit: choose an inactive customer is impossible (not offered); change to another active customer; save | Customer snapshot is the new customer's current details |
| 9 | As the employee, open the draft | Edit, Print, and only **Confirm**. Confirm → Confirmed; Edit disappears; no further buttons |
| 10 | As A, on the confirmed order | **Mark completed** and **Cancel sales order**. Mark completed → no buttons |
| 11 | Open the same draft in two tabs as A; cancel it in one; click Confirm in the other | "This status change is not possible…"; the page refreshes to Cancelled with no buttons |
| 12 | Open Edit of a draft in one tab, confirm it in another, then save the edit | "This sales order is no longer a draft…" |
| 13 | Open the accepted quotation | **Create sales order**. Click it, keep today's date, create → lands on the new draft order with the quotation's customer, lines and notes; Source links to the quotation |
| 14 | Reopen the quotation | **View sales order** with its number; no Create button. A sent / draft / rejected quotation shows neither |
| 15 | Open the accepted quotation in two tabs; convert in one, then submit the conversion in the other | "This quotation has already been converted to a sales order." and the panel switches to **View sales order**. Only one order exists |
| 16 | Create 26+ orders; page through; search `SO-00001` and part of a customer name; filter by status and customer | 25 per page, newest first; Source column shows the quotation number or "Direct"; filters kept across pages |
| 17 | Print from the detail page | Organization details, number, status, dates, customer snapshot, source quotation number, items, totals, notes; no app chrome; white paper in dark mode |
| 18 | As B, open `/sales-orders/<A id>`, `/edit`, `/print`, `/sales-orders/not-a-uuid`; `/sales-orders?customer=<A customer id>` | "Sales order not found" for all; the list shows nothing of A |

## 8. Invoices

Run after any change to `invoices`, `invoice_items`, their functions, triggers or policies, `document_number_counters`, the sales order tables, or `lib/invoices/`.

### 8.1 Database test (automated SQL)

File: `supabase/tests/invoices.sql`. Run it as a separate run in the SQL Editor, after all migrations up to `20261104150000_invoices.sql`. Expected last result: `ALL INVOICE CHECKS PASSED`. It is rolled back. Its last section drops `invoices_no_payments_yet_check` **inside the transaction** to simulate the Payment module; the rollback restores it.

It checks:

- `anon` cannot read invoices or items, or call any of the five functions
- definitions: the trigger `sales_orders_block_invoiced_cancel` exists and is enabled; the four write functions are `SECURITY DEFINER` with `search_path = ''`, `authenticated` only. The internal helpers (`sales_orders_block_invoiced_cancel`, `invoice_replace_items`, `invoice_recompute_totals`, `invoice_normalize_header`, `invoice_status_transition_allowed`, the trigger functions, `next_document_number`) have a fixed `search_path` and cannot be executed by API roles. `get_invoice` is `SECURITY INVOKER`, `STABLE` SQL. `set_invoice_status` locks only through the role-checked predicate; `create_invoice_from_sales_order` locks the authorized sales order `FOR SHARE`. No INSERT/UPDATE/DELETE (table or column) for API roles. The counter type check allows `invoice`. The transition table is exactly the user + reserved payment transitions
- direct creation: `INV-000001`, … per organization; organization, creator, `draft`, `source_sales_order_id` NULL, snapshots, `amount_paid = 0.00` and `amount_due = grand_total` derived by the database; forged snapshot, amount, `amount_paid`, `amount_due`, `status`, number and organization keys ignored; 100 items, 2000-code-point notes and descriptions, due date equal to the invoice date accepted
- calculations: the quotation examples (349.99 / 10.00 / 43.50 / 383.49 and the rounding set → 75.98 / 5.97 / 7.39 / 77.40)
- rejected input: the sales order list (items, quantity incl. NaN / exponent, price, tax, discount, description, overflow, inactive / other-tenant / later-deactivated product, line `id` on create), missing or infinite dates, a due date before the invoice date, over-long notes, an inactive, deactivated or NULL customer. Failures consume no numbers. Unknown and other-tenant customers and products fail identically
- conversion of a confirmed sales order whose customer and one product were deactivated, and whose other product was renamed and repriced, after confirmation:
  - it succeeds as a `draft` with `source_sales_order_id` set and `amount_due = grand_total`
  - the customer snapshot, notes and every line (column for column) come from the sales order, not the master data; totals equal the order's
  - the sales order (header and items) is byte-for-byte unchanged, including its status
- conversion is refused a second time (`23505`), for draft, completed and cancelled sales orders (`55000`), for invalid dates (`22023`), and for unknown, NULL and other-tenant sales orders (`P0002`, identical). A cancelled invoice still consumes its sales order
- `get_invoice`: one document with exact strings (including `amount_paid`, `amount_due`), `source_sales_order_number`, ordered items; NULL for a wrong organization, unknown ID or NULLs
- direct writes as an owner (`42501`): insert (also with a forged `source_sales_order_id`), update of number, organization, creator, `created_at`, source sales order, totals, `amount_paid`, `amount_due`, snapshot, status (`paid`, `issued`), notes, delete, item insert/update/delete; internal helpers not callable
- snapshots survive customer and product changes
- draft edits (direct and converted): unchanged customer keeps its snapshot (also when inactive); changed customer re-snapshotted; kept lines keep snapshot and price (also an inactive product); new or changed products need an active product; another invoice's, the source sales order's, unknown, repeated and non-string line `id`s rejected; each rejection leaves the invoice unchanged; `amount_due` follows the new total; the source sales order never changes
- statuses: employee issues but cannot cancel (draft or issued); manager paths draft → issued, draft → cancelled, issued → cancelled; invalid transitions `55000`; `paid` / `partially_paid` refused for every role and status (`42501`); unknown statuses `22023`; issuing does not touch the sales order
- immutability: an issued or cancelled invoice cannot be edited through the API; as `postgres`, every commercial header column, item insert/update/delete and identity column is blocked by the triggers; payment states (`paid`, `partially_paid`, any `amount_paid > 0`) are rejected by the balance constraints
- integrity (as `postgres`): line, tax, total and balance CHECKs, due date, composite FKs (product, customer, item organization, source sales order of another tenant), unique source sales order, unique and well-formed number, no `paid` insert
- no hard delete: draft, issued, cancelled (from draft and from issued), converted draft and converted issued invoices cannot be deleted, nor in bulk, nor through the organization cascade; items and the source link survive; the sales orders still cannot be invoiced again
- tenant isolation (User B): reads nothing of A (tables and `get_invoice`); converts B's own order to B's `INV-000001`; converting A's sales order, updating A's invoice and changing its status fail exactly like unknown IDs (`P0002`); cannot use A's customer, product or a foreign line `id`
- a disabled member, and a manager disabled later, cannot read, create, convert, update or change status
- invoiced sales orders: a confirmed order with an issued, a draft or a cancelled invoice cannot be cancelled by the owner (`55000`, order unchanged), by the employee (`42501`, role first) or by `postgres`; it can be completed (invoice unchanged) and then stays terminal; a confirmed order without an invoice can still be cancelled and then cannot be invoiced; User B's cancel of A's invoiced order is identical to an unknown ID (`P0002`)
- zero-total invoices: a draft and an issued invoice with `0.00 / 0.00 / 0.00`; the manager cannot set `paid` / `partially_paid` (`42501`); as `postgres`, `paid` is rejected in Part 1 (also on insert)
- simulated Payment module (constraint dropped in-transaction): status must agree with the balance, no overpayment, a positive `paid` needs `amount_paid = grand_total` (not `grand_total − 1`, not 0), `partially_paid` needs something paid and something due, a zero-total issued invoice becomes `paid` with 0 / 0 but never `partially_paid`, `issued → partially_paid → paid` works, an invoice with payments cannot be cancelled, content stays frozen, `paid` is terminal and cannot be deleted; the owner cannot cancel a paid invoice through the RPC

Not covered by the script (needs two sessions): concurrent conversions of the same sales order, and a sales order status change racing a conversion. To check by hand, open two `psql` sessions as members, `begin;`, and call `create_invoice_from_sales_order(<id>, current_date)` in both: the second waits and then fails with `23505`. With `set_sales_order_status(<id>, 'cancelled')` (as owner or manager) in the second session instead, it waits for the conversion to commit and then fails with `sales order has an invoice and cannot be cancelled`. In the reverse order (cancel first, uncommitted), the conversion waits and then fails with `only a confirmed sales order can be invoiced (status is cancelled)`.

### 8.2 API probe (manual)

As User B (section 2 probe variables), with Organization A's invoice and confirmed sales order IDs. Every result must be empty or an error:

```js
const invA = "<Invoice A id>", soA = "<Confirmed sales order A id>";
console.log(await (await fetch(`${url}/rest/v1/invoices?id=eq.${invA}`, { headers: h })).json());                 // []
console.log(await (await fetch(`${url}/rest/v1/invoice_items?invoice_id=eq.${invA}`, { headers: h })).json());   // []
console.log(await (await fetch(`${url}/rest/v1/invoices?id=eq.${invA}`, { method: "PATCH", headers: h,
  body: JSON.stringify({ amount_paid: 1, status: "paid" }) })).status);                                            // 401/403
console.log(await (await fetch(`${url}/rest/v1/rpc/create_invoice_from_sales_order`, { method: "POST", headers: h,
  body: JSON.stringify({ p_sales_order_id: soA, p_invoice_date: "2026-11-06" }) })).json());                      // "sales order not found"
console.log(await (await fetch(`${url}/rest/v1/rpc/set_invoice_status`, { method: "POST", headers: h,
  body: JSON.stringify({ p_invoice_id: invA, p_status: "cancelled" }) })).json());                                // "invoice not found"
```

As User A (owner of Organization A), the payment statuses are refused even for one's own invoice:

```js
console.log(await (await fetch(`${url}/rest/v1/rpc/set_invoice_status`, { method: "POST", headers: h,
  body: JSON.stringify({ p_invoice_id: invA, p_status: "paid" }) })).json());                                     // "invoice status paid is set by payments only"
```

### 8.3 UI test (manual)

None yet: Invoice Part 1 has no UI.


### 8.3 Invoice Part 2 UI/workflow checks

Apply `20261104160000_list_invoices.sql` after Part 1. Run the updated `invoices.sql`, then re-run `sales_orders.sql` and `quotations.sql`. Local SQL checks do not replace signed-in browser checks.

1. As each active role, visit `/invoices` and create a direct draft with an active customer, inventory product and service. Invoice date uses the organization timezone; due date is optional. Verify due-before-invoice rejection, 1–100 line limits, invalid quantity/price/discount/tax errors, exact rounding, add/remove, and read-only unit/paid/due.
2. Create more than 500 customers/products; search a late record by name/company/phone/email or SKU. Searches offer active records only, 25 per request. Type a second query while the first request is delayed: old options cannot be selected with Enter or mouse. Enter in the selector must never submit the invoice.
3. Edit a draft after changing/deactivating its customer/products. Current references remain visible with recorded snapshots and inactive labels. Change quantities without reselecting and save. Change product A → B → A and customer A → B → A; recorded details return. Keep existing IDs (including changed-product lines), add new lines without IDs, omit removed lines; after save, reopen edit to load new IDs.
4. On a confirmed sales order, Create invoice opens a date form; conversion copies stored snapshots, notes, prices and totals even if master data is now inactive. Source order is unchanged. View invoice replaces Create. Complete the source order and confirm its invoice link remains. Cancel the invoice and confirm reconversion remains unavailable; the order still hides Cancel and permits authorized Complete.
5. Employees can issue drafts but never see Cancel or payment-status actions. Owners/managers can cancel drafts or issued invoices with confirmation. Non-drafts redirect from edit to detail. Have a second user issue/cancel/convert first: stale actions show safe errors and refreshed status/link, with no duplicate conversion.
6. List search by invoice number/customer snapshot, status/customer filters, pages, empty results and past-end pages work. Detail, list and print preserve exact money strings, source links and paid/due balances. Master-data renames do not change historical displays.
7. Print drafts and issued/cancelled invoices in light/dark mode and use browser Save as PDF. Letterhead, dates, snapshots, all line values, notes, totals and balances are visible; navigation/controls are absent from paper. Check a long description and multi-page invoice.
8. Signed out, visit all five invoice routes. As another tenant, use a known invoice ID in detail/edit/print and submit forged IDs through actions: no data leaks. Disabled members lose invoice access and selector searches immediately. Simulate failed reads to verify retryable errors.

The list customer dropdown follows the existing quotation/sales-order cap (500 plus current); create/edit selectors are uncapped searches. Hosted/browser checks remain manual until executed.

## 9. Purchase Orders — Part 1

Run `supabase/tests/purchase_orders.sql` as postgres locally after all migrations through `20261104180000_purchase_orders.sql`. Fixtures, simulated JWT claims, roles and temporary assertion helpers roll back. Expected result: `ALL PURCHASE ORDER CHECKS PASSED`.

Coverage: active/inactive and cross-tenant vendors/products, all product types, purchase-price rather than selling-price defaults, missing purchase price, exact rounding/totals, generated per-organization numbers, failed number-allocation rollback, 1–100 items, input bounds/dates/notes/description, snapshots after master changes, kept inactive references/defaults, fresh changed-reference snapshots, invalid/repeated/foreign/cross-tenant line IDs, atomic rejected edits, every role's permissions, reserved receiving targets, no-op/terminal transitions, privileged header/item immutability, no hard delete in any status or organization cascade, direct API forgeries, internal helper privileges, disabled/revoked memberships and anonymous access. No inventory tables exist: structural checks assert the module has no stock mutation dependency; when stock tables arrive, replace that structural guard with ledger/balance before/after comparisons.

Re-run all nine suites independently: `tenant_isolation.sql`, `customers.sql`, `vendors.sql`, `products.sql`, `quotations.sql`, `sales_orders.sql`, `invoices.sql`, `organization_features.sql`, `purchase_orders.sql`. Local verification used PGlite PostgreSQL with simulated Supabase Auth/API roles/default grants; native Supabase Auth/PostgREST is not covered. Vitest tests are in `lib/purchase-orders/*.test.ts` and use the existing framework.

Manual Supabase application order (not performed by the agent; never reapply already-applied migrations): ensure every migration in `supabase/migrations/` through `20261104170000_organization_features.sql` is applied in filename order, then apply **only** `20261104180000_purchase_orders.sql`. Its dependencies are organizations/memberships, is_org_member/has_org_role, vendors, products, quotation decimal parser/document counter and corrected text helpers. The counter CHECK retains quotation/sales_order/invoice. It also adds the vendors composite unique key needed by tenant-safe purchasing FKs. No historical migration is modified.

Two-session native PostgreSQL checks remain manual: concurrently create POs in one organization (unique sequential numbers); roll back one creator (no number consumed); race draft editing with ordering (one waits; an edit after ordering fails); race two status changes (second checks the locked latest status). Embedded single-session SQL checks cannot verify lock waiting. Future receiving must use parent locking and disallow cancellation once receiving records exist. Original product A → B → A must restore the recorded PO snapshot/description/unit/price when UI is built. No PO UI/API browser workflow exists in Part 1.

### 9.1 Purchase Orders — Part 2 UI/workflow checks

Apply `20261104190000_list_purchase_orders.sql` after `20261104180000_purchase_orders.sql`, then re-run `purchase_orders.sql` (it now covers the list RPC: definition/grants, snapshot search, literal `%`/`_`/`\`, Unicode trim, strict status, tenant-safe vendor filter, pagination/clamping, deterministic order, totals, tenant B, employee and disabled members). Local SQL checks do not replace signed-in browser checks.

1. As each active role, open `/purchase-orders` and create a direct draft with an active vendor, inventory product, non-inventory product and service. Order date defaults to today in the organization timezone; expected delivery is optional and cannot precede the order date. The unit price defaults to the **purchase** price (never the selling price); a product without one shows "Required" and cannot be saved until a price is entered. Verify exact previews and 1–100 lines.
2. Vendor search by name/company/email/phone and product search by name/SKU/category return active records only, 25 per request. Delay one response and type again: stale options cannot be chosen. Enter in a selector never submits the form.
3. Deactivate and rename the vendor and a product of a draft, then edit it: both stay selected with recorded details and "(inactive)" labels; saving unrelated changes keeps them. Choose a different vendor: only active vendors are offered. Change a line A → B → A: recorded name/SKU/description/unit/price return, not A's current purchase price. With A inactive, use "Restore recorded product". Reopen edit after saving to load fresh line IDs.
4. Employees see Mark ordered on drafts and no Cancel; owners/managers can cancel drafts and ordered POs. No Mark received/partially received button exists. Ordered, received and cancelled POs show no Edit; `/edit` redirects to detail. Have a second user order/cancel first: the stale edit/status action shows a safe message and the refreshed status.
5. List search by PO number and vendor snapshot name/company, status and vendor filters, pages, empty and past-end states. Master-data renames do not change list/detail/print.
6. Print draft/ordered/cancelled POs in light and dark mode; letterhead, dates, vendor snapshot, all line values, notes and totals print; app chrome does not.
7. Signed out, all five routes redirect to login. As another tenant, known PO IDs give "not found" on detail/edit/print, and forged IDs via actions fail safely. Disabled members lose access and selector results immediately.
8. Confirm no stock figure changes anywhere after creating, ordering or cancelling a PO (no inventory module exists yet).


## 10. Goods Receiving — Part 1

Apply local migrations in filename order through `20261104190000_list_purchase_orders.sql`, then **`20261104200000_goods_receipts.sql`**. No remote connection is needed. Run `supabase/tests/goods_receipts.sql` independently as local postgres. Expected final result: `ALL GOODS RECEIPT CHECKS PASSED`; fixtures and helpers roll back. Re-run the other nine SQL suites independently. `purchase_orders.sql` now recognizes the receiving summary as a public invoker read RPC.

Coverage: ordered and partially_received creation; draft/received/cancelled rejection; GR numbering and failed-allocation rollback; 40/30/30 partial delivery; A100/B10 then B40; exact fractional and 100-line receipts; duplicate/foreign/missing lines; over/full receiving; invalid dates/quantities/notes/items; late-line rollback; PO-derived snapshots after current product name/type/unit/status changes; preserved draft product-type tokens; services rejected/ignored for mixed completion; service-only orders remain ordered; legacy unknown types blocked; receipt cancellation does not exist; PO cancellation guard; immutable headers/items and same-transaction late inserts; API writes/grants; invoker read definitions; RLS across tenants and disabled memberships; all active roles; organization-delete protection; locking and deferred sealing structure. Tests use simulated Auth JWT/API roles with local PGlite; this does not exercise native Supabase Auth/PostgREST or real lock waiting.

Native **local** PostgreSQL two-session checks (not verified by the embedded runner):

1. Prepare and commit a disposable ordered PO with known physical type snapshots and a line ordered 100, received 80. Retain the authorized member UUID, PO UUID and source line UUID. For testing an over-receiving error specifically, leave a second physical PO line outstanding; otherwise the winner completes the PO and the loser correctly sees “no longer receivable.”
2. In local psql session A, run `begin; set local role authenticated; select set_config('request.jwt.claims','{"sub":"<member UUID>","role":"authenticated"}',true); select public.create_goods_receipt('<PO UUID>',date '2026-11-06',null,'[{"purchase_order_item_id":"<line UUID>","received_quantity":"20"}]');`. Leave the transaction open.
3. In session B, begin and set the same authenticated role/claims, then call the same receipt RPC for 20. It must wait on A's PO lock. Commit A. B must fail with `GR004` (line full) or `55000` (PO completed), not create a second receipt. Roll back B. Check the source line's cumulative quantity is exactly 100 and only one new receipt exists. Repeating with 15 in A and 20 in B must fail `GR003` while the PO remains partial.
4. Repeat, rolling back A instead: B should succeed and receive the rolled-back GR number. Two successful receipts on different POs in one organization must get distinct sequential GR numbers; another organization starts at GR-000001 independently.
5. Race receiving with cancellation as owner/manager. With receipt uncommitted in A, B's `set_purchase_order_status('<PO UUID>','cancelled')` waits, then fails after A commits. Reverse the order: cancellation in A, receipt in B; B waits then fails as no longer receivable. Verify no receipt/counter was committed by the loser.
6. While A holds an A-tenant PO lock, try receiving that PO from tenant B and a disabled A membership: both must return `P0002` immediately, without waiting or exposing receiving state. Test readers with forged organization IDs and null IDs too.
7. At REPEATABLE READ/SERIALIZABLE, serialization conflicts (`40001`) are safe and expected. The domain returns a reload/retry message; do not silently retry an uncertain physical event. Confirm all receipt quantities and statuses remain consistent after rollback.

Legacy rollout: query `purchase_order_items where product_type is null` with trusted local/deployment tooling. These records are intentionally not backfilled from mutable products. Review historical evidence and prepare a scoped, transactional reconciliation migration before receiving those POs. Keep all other snapshots and quantities unchanged; ordered lines need explicit handling of the item immutability trigger. Do not expose a bypass RPC. See DECISIONS 027. Native API/browser checks wait for the future receiving UI; this part adds no route or control.


Goods Receiving review regressions (DECISIONS 028): direct ordered → received/partially_received without receipts and mismatched states after receiving fail GR009; privileged sealing produces partial status; RPC completion and valid direct status writes succeed. An ordered PO with an unsealed receipt rejects cancellation with the exact receipt-specific message, without disabling triggers. BEFORE TRUNCATE is exercised as postgres for receipt and PO tables (deferred receipt events are flushed first so the explicit guard is reached). A first 70-of-100 receipt followed by 31 fails GR003 with unchanged receipt/items/counter/summary, alongside the existing 101-from-zero and partial/multiple receipt cases. Early dates fail GR007 through RPC and privileged insert; same-day and later dates succeed. Removing only the cancellation trigger in a disposable local database makes the exact cancellation regression fail as intended. Native local concurrent lock waits remain unverified.
