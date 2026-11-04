-- =============================================================================
-- Harden customer validation and set_customer_status().
--
-- Follow-up to 20261104020000_customers.sql (already applied remotely, so it
-- is not edited). Three review findings:
--
--   1. set_customer_status() took a row lock (SELECT ... FOR UPDATE) BEFORE
--      checking the caller's membership. A customer of another tenant that
--      was locked by a concurrent transaction made the call wait, while an
--      unknown UUID returned at once: an existence / timing side channel.
--      Now the lookup is authorization-scoped and takes no lock. The only
--      row lock is taken by the final UPDATE, on an authorized row.
--
--   2. Whitespace: JavaScript trim()/\s and PostgreSQL [[:space:]] disagree
--      (e.g. U+00A0 is whitespace only in JS, U+0085 only in PostgreSQL).
--      Both layers now use ONE explicit set (docs/DECISIONS.md 014):
--
--        U+0009..U+000D, U+0020, U+0085, U+00A0, U+1680, U+2000..U+200A,
--        U+2028, U+2029, U+202F, U+205F, U+3000, U+FEFF
--
--      i.e. the Unicode White_Space property plus U+FEFF (which JS trims).
--      TypeScript twin: lib/validation/text.ts. Keep the two in sync.
--
--   3. Length: char_length() counts Unicode code points; the app now counts
--      code points too (charLength() in lib/validation/text.ts). The limits
--      and char_length() checks are unchanged.
--
-- Existing data: the rebuilt CHECK constraints are added NOT VALID (enforced
-- for every new insert/update at once) and then validated one by one. If old
-- rows violate one, the migration does NOT fail: that constraint stays
-- NOT VALID and a WARNING names it. See docs/DATA_MODEL.md § customers for
-- the query that finds such rows. No row is modified by this migration.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Text helpers (pure, IMMUTABLE, no table access). They stay executable by
-- every role on purpose: CHECK constraints call them with the privileges of
-- whoever writes the row (authenticated, service_role, postgres).
-- -----------------------------------------------------------------------------

-- Removes leading and trailing whitespace (the set above).
create or replace function public.trim_whitespace(p_value text)
returns text
language sql
immutable
strict
parallel safe
set search_path = ''
as $$
  select pg_catalog.regexp_replace(
    p_value,
    '^[\u0009-\u000d \u0085   -     　﻿]+|[\u0009-\u000d \u0085   -     　﻿]+$',
    '',
    'g'
  );
$$;

-- True if the value is non-empty and has no leading or trailing whitespace.
create or replace function public.text_is_trimmed(p_value text)
returns boolean
language sql
immutable
strict
parallel safe
set search_path = ''
as $$
  select p_value <> '' and p_value = public.trim_whitespace(p_value);
$$;

-- True if the value contains whitespace anywhere (the set above).
create or replace function public.text_has_whitespace(p_value text)
returns boolean
language sql
immutable
strict
parallel safe
set search_path = ''
as $$
  select p_value ~ '[\u0009-\u000d \u0085   -     　﻿]';
$$;

-- -----------------------------------------------------------------------------
-- customers CHECK constraints, rebuilt on the helpers. Same names, same
-- limits; only the whitespace rules change. Mirrors
-- lib/customers/validation.ts.
-- -----------------------------------------------------------------------------
alter table public.customers
  drop constraint customers_name_check,
  drop constraint customers_company_name_check,
  drop constraint customers_phone_check,
  drop constraint customers_email_check,
  drop constraint customers_address_check,
  drop constraint customers_tax_number_check,
  drop constraint customers_notes_check;

alter table public.customers
  add constraint customers_name_check
    check (char_length(name) between 1 and 200
           and public.text_is_trimmed(name)) not valid,

  add constraint customers_company_name_check
    check (company_name is null or (
      char_length(company_name) between 1 and 200
      and public.text_is_trimmed(company_name))) not valid,

  -- Optional leading +, then digits, spaces, ( ) - and dots, with at least
  -- 6 digits (same as organization phone numbers).
  add constraint customers_phone_check
    check (phone is null or (
      char_length(phone) <= 50
      and phone ~ '^\+?[0-9() .-]+$'
      and public.text_is_trimmed(phone)
      and char_length(regexp_replace(phone, '[^0-9]', '', 'g')) >= 6)) not valid,

  -- Lowercase, simple local@domain.tld, no whitespace anywhere.
  add constraint customers_email_check
    check (email is null or (
      char_length(email) <= 320
      and email = lower(email)
      and not public.text_has_whitespace(email)
      and email ~ '^[^@]+@[^@]+\.[^@]+$')) not valid,

  add constraint customers_address_check
    check (address is null or (
      char_length(address) between 1 and 500
      and public.text_is_trimmed(address))) not valid,

  add constraint customers_tax_number_check
    check (tax_number is null or (
      char_length(tax_number) between 1 and 100
      and public.text_is_trimmed(tax_number))) not valid,

  add constraint customers_notes_check
    check (notes is null or (
      char_length(notes) between 1 and 2000
      and public.text_is_trimmed(notes))) not valid;

-- Validate existing rows. A violation leaves that constraint NOT VALID
-- (still enforced for new writes) instead of failing the migration.
do $$
declare
  v_constraint text;
begin
  foreach v_constraint in array array[
    'customers_name_check',
    'customers_company_name_check',
    'customers_phone_check',
    'customers_email_check',
    'customers_address_check',
    'customers_tax_number_check',
    'customers_notes_check'
  ] loop
    begin
      execute format('alter table public.customers validate constraint %I', v_constraint);
    exception when check_violation then
      raise warning 'customers: existing rows violate %, so it is left NOT VALID (new writes are still checked). Clean the rows up, then run: alter table public.customers validate constraint %;',
        v_constraint, v_constraint;
    end;
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- set_customer_status: deactivate / reactivate (owner or manager only)
--
-- Order of checks:
--   1. caller is authenticated                          else 42501
--   2. status is valid                                  else 22023
--   3. authorization-scoped lookup: the customer joined to the CALLER's
--      active membership of the customer's organization. A plain read: it
--      takes no row lock and never waits on other transactions' row locks.
--      Missing customer, other tenant, disabled member  -> P0002 (identical)
--   4. role is owner or manager                         else 42501
--      (only reachable by active members of the customer's organization,
--      who can already read the customer, so nothing is revealed)
--   5. UPDATE, which re-checks the role in its own WHERE clause and takes
--      the row lock itself, only on an authorized row.
--
-- The signature is unchanged, so existing grants are kept; they are
-- restated below.
-- -----------------------------------------------------------------------------
create or replace function public.set_customer_status(
  p_customer_id  uuid,
  p_status       text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_role    text;
begin
  if v_user_id is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  if p_status is null or p_status not in ('active', 'inactive') then
    raise exception 'invalid customer status' using errcode = '22023';
  end if;

  select m.role into v_role
  from public.customers c
  join public.organization_members m
    on m.organization_id = c.organization_id
  where c.id = p_customer_id
    and m.user_id = v_user_id
    and m.status = 'active';

  if not found then
    raise exception 'customer not found' using errcode = 'P0002';
  end if;

  if v_role not in ('owner', 'manager') then
    raise exception 'not allowed to change customer status' using errcode = '42501';
  end if;

  update public.customers c
  set status = p_status
  where c.id = p_customer_id
    and c.status <> p_status
    and public.has_org_role(c.organization_id, array['owner', 'manager']);
end;
$$;

revoke all on function public.set_customer_status(uuid, text) from public, anon;
grant execute on function public.set_customer_status(uuid, text) to authenticated;
