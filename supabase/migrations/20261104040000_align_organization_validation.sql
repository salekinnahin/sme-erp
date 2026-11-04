-- =============================================================================
-- Align create_organization() validation with the shared text rules.
--
-- Follow-up to 20261104010000_harden_create_organization_validation.sql
-- (already applied remotely, so it is not edited). That version used
-- btrim() (ASCII space only) and [[:space:]] (locale-dependent), so it kept
-- e.g. a leading U+00A0 or U+2003 and accepted an NBSP-only name.
--
-- It now uses the helpers from 20261104030000_harden_customer_validation.sql,
-- the same rules as customers (docs/DECISIONS.md 014):
--
--   public.trim_whitespace()      trim the explicit Unicode whitespace set
--   public.text_has_whitespace()  "no whitespace anywhere" (email)
--   char_length()                 Unicode code points
--
-- Rules (mirror lib/organizations/validation.ts; keep the two in sync):
--
--   name        trimmed, 1..200 code points
--   currency    trimmed, uppercased, one of BDT USD EUR GBP INR (DECISIONS 012)
--   timezone    trimmed, a time zone known to PostgreSQL
--   email       optional; trimmed, lowercased, <= 320, no whitespace
--               anywhere, simple local@domain.tld
--   phone       optional; trimmed, <= 50, optional leading +, then digits,
--               spaces, ( ) - and dots, at least 6 digits
--   address     optional; trimmed, <= 500
--   tax_number  optional; trimmed, <= 100
--
-- Invalid input raises SQLSTATE 22023 (invalid_parameter_value), as before.
--
-- Unchanged: identity from auth.uid() only, owner/active membership fixed
-- in the function, one organization per user (V1), atomic creation, the
-- advisory lock, search_path = '' and the grants (restated below; the
-- signature is unchanged). Only the function body is replaced. No table,
-- constraint or existing row is touched.
--
-- Requires 20261104030000_harden_customer_validation.sql (the helpers).
-- =============================================================================

create or replace function public.create_organization(
  p_name        text,
  p_currency    text,
  p_timezone    text,
  p_email       text default null,
  p_phone       text default null,
  p_address     text default null,
  p_tax_number  text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id    uuid := auth.uid();
  v_org_id     uuid;
  v_name       text := nullif(public.trim_whitespace(p_name), '');
  v_currency   text := upper(nullif(public.trim_whitespace(p_currency), ''));
  v_timezone   text := nullif(public.trim_whitespace(p_timezone), '');
  v_email      text := lower(nullif(public.trim_whitespace(p_email), ''));
  v_phone      text := nullif(public.trim_whitespace(p_phone), '');
  v_address    text := nullif(public.trim_whitespace(p_address), '');
  v_tax_number text := nullif(public.trim_whitespace(p_tax_number), '');
begin
  if v_user_id is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  if v_name is null then
    raise exception 'organization name is required' using errcode = '22023';
  end if;
  if char_length(v_name) > 200 then
    raise exception 'organization name is too long' using errcode = '22023';
  end if;

  -- Version 1 supported currencies. Keep in sync with SUPPORTED_CURRENCIES
  -- in lib/organizations/validation.ts.
  if v_currency is null
     or v_currency <> all (array['BDT', 'USD', 'EUR', 'GBP', 'INR']) then
    raise exception 'unsupported currency' using errcode = '22023';
  end if;

  if v_timezone is null
     or not exists (select 1 from pg_catalog.pg_timezone_names where name = v_timezone) then
    raise exception 'invalid time zone' using errcode = '22023';
  end if;

  -- Same rule as customers_email_check.
  if v_email is not null and (
       char_length(v_email) > 320
       or public.text_has_whitespace(v_email)
       or v_email !~ '^[^@]+@[^@]+\.[^@]+$'
     ) then
    raise exception 'invalid email' using errcode = '22023';
  end if;

  -- Same rule as customers_phone_check. The pattern only allows ASCII, so
  -- the only whitespace it accepts is an inner U+0020.
  if v_phone is not null and (
       char_length(v_phone) > 50
       or v_phone !~ '^\+?[0-9() .-]+$'
       or char_length(regexp_replace(v_phone, '[^0-9]', '', 'g')) < 6
     ) then
    raise exception 'invalid phone' using errcode = '22023';
  end if;

  if v_address is not null and char_length(v_address) > 500 then
    raise exception 'address is too long' using errcode = '22023';
  end if;

  if v_tax_number is not null and char_length(v_tax_number) > 100 then
    raise exception 'tax number is too long' using errcode = '22023';
  end if;

  -- Serialize concurrent calls for the same user (e.g. a double-submit).
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('create_organization:' || v_user_id::text, 0)
  );

  -- Version 1: one organization per user (no invitations or switching yet).
  if exists (
    select 1 from public.organization_members m
    where m.user_id = v_user_id and m.status = 'active'
  ) then
    raise exception 'user already belongs to an organization' using errcode = '23505';
  end if;

  -- Make sure the profile exists (e.g. users created before the trigger).
  insert into public.profiles (id, full_name)
  select
    u.id,
    nullif(left(public.trim_whitespace(coalesce(u.raw_user_meta_data ->> 'full_name', '')), 200), '')
  from auth.users u
  where u.id = v_user_id
  on conflict (id) do nothing;

  insert into public.organizations
    (name, email, phone, address, currency, timezone, tax_number, created_by)
  values
    (v_name, v_email, v_phone, v_address, v_currency, v_timezone, v_tax_number, v_user_id)
  returning id into v_org_id;

  insert into public.organization_members (organization_id, user_id, role, status)
  values (v_org_id, v_user_id, 'owner', 'active');

  return v_org_id;
end;
$$;

revoke all on function public.create_organization(text, text, text, text, text, text, text)
  from public, anon;
grant execute on function public.create_organization(text, text, text, text, text, text, text)
  to authenticated;
