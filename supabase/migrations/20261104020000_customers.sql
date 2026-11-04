-- =============================================================================
-- Customers: the first tenant-owned master-data table.
--
-- This migration sets the pattern for later master-data modules (vendors,
-- products):
--
--   * Integrity lives in table CHECK constraints, so it holds for every write
--     path (Server Actions, direct Supabase API calls, SQL).
--   * RLS scopes every row to an organization where the caller is an ACTIVE
--     member (public.is_org_member).
--   * Column-level privileges limit what clients may write:
--       INSERT  only the editable fields plus organization_id (RLS checks it)
--       UPDATE  only the editable fields. organization_id, status,
--               created_by and created_at can never be changed by a client
--       DELETE  not granted. Customers are deactivated, never deleted
--   * Role-restricted state changes (deactivate / reactivate) go through a
--     SECURITY DEFINER function that checks the caller's role.
--
-- Version 1 permissions (docs/DECISIONS.md 013):
--   owner, manager, employee  view, create, edit
--   owner, manager            deactivate, reactivate
--
-- Validation mirrors lib/customers/validation.ts. Keep the two in sync.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Role helper: is the current user an ACTIVE member of org_id with one of
-- the given roles? Reusable by later modules' functions and policies.
-- -----------------------------------------------------------------------------
create or replace function public.has_org_role(org_id uuid, roles text[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.organization_members m
    where m.organization_id = org_id
      and m.user_id = (select auth.uid())
      and m.status = 'active'
      and m.role = any (roles)
  );
$$;

revoke all on function public.has_org_role(uuid, text[]) from public, anon;
grant execute on function public.has_org_role(uuid, text[]) to authenticated;

-- -----------------------------------------------------------------------------
-- customers
--
-- Text rules: optional fields are NULL when empty (never ''), and no value
-- may start or end with whitespace. The app trims before writing.
-- -----------------------------------------------------------------------------
create table public.customers (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  name             text not null,
  company_name     text,
  phone            text,
  email            text,
  address          text,
  tax_number       text,
  notes            text,
  status           text not null default 'active',
  -- Defaults to the calling user. Clients cannot set or change it (no column
  -- privilege). Nullable so deleting an auth account keeps its customers.
  created_by       uuid default auth.uid() references auth.users (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  constraint customers_status_check
    check (status in ('active', 'inactive')),

  constraint customers_name_check
    check (char_length(name) between 1 and 200
           and name !~ '^[[:space:]]|[[:space:]]$'),

  constraint customers_company_name_check
    check (company_name is null or (
      char_length(company_name) between 1 and 200
      and company_name !~ '^[[:space:]]|[[:space:]]$')),

  -- Same rules as organization phone numbers: optional leading +, then
  -- digits, spaces, ( ) - and dots, with at least 6 digits.
  constraint customers_phone_check
    check (phone is null or (
      char_length(phone) <= 50
      and phone ~ '^\+?[0-9() .-]+$'
      and phone !~ '^[[:space:]]|[[:space:]]$'
      and char_length(regexp_replace(phone, '[^0-9]', '', 'g')) >= 6)),

  -- Lowercase, trimmed, simple local@domain.tld.
  constraint customers_email_check
    check (email is null or (
      char_length(email) <= 320
      and email = lower(email)
      and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')),

  constraint customers_address_check
    check (address is null or (
      char_length(address) between 1 and 500
      and address !~ '^[[:space:]]|[[:space:]]$')),

  constraint customers_tax_number_check
    check (tax_number is null or (
      char_length(tax_number) between 1 and 100
      and tax_number !~ '^[[:space:]]|[[:space:]]$')),

  constraint customers_notes_check
    check (notes is null or (
      char_length(notes) between 1 and 2000
      and notes !~ '^[[:space:]]|[[:space:]]$'))
);

-- List queries: newest first within an organization. Also serves lookups by
-- organization_id alone (leftmost column), e.g. the FK cascade.
create index customers_org_created_idx
  on public.customers (organization_id, created_at desc, id desc);

-- Status filter within an organization.
create index customers_org_status_created_idx
  on public.customers (organization_id, status, created_at desc, id desc);

-- FK index (ON DELETE SET NULL when an auth user is removed).
create index customers_created_by_idx
  on public.customers (created_by);

create trigger customers_set_updated_at
  before update on public.customers
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- Privileges. Supabase grants ALL on new public tables to API roles by
-- default, so start from nothing and grant only what is needed.
-- -----------------------------------------------------------------------------
revoke all on table public.customers from anon, authenticated;

grant select on table public.customers to authenticated;

grant insert (organization_id, name, company_name, phone, email, address, tax_number, notes)
  on table public.customers to authenticated;

grant update (name, company_name, phone, email, address, tax_number, notes)
  on table public.customers to authenticated;

-- -----------------------------------------------------------------------------
-- Row Level Security
-- -----------------------------------------------------------------------------
alter table public.customers enable row level security;

create policy "customers: read as active member"
  on public.customers for select
  to authenticated
  using (public.is_org_member(organization_id));

-- Any active member may create customers, but only in their own organization
-- and only as themselves.
create policy "customers: insert as active member"
  on public.customers for insert
  to authenticated
  with check (
    public.is_org_member(organization_id)
    and created_by = (select auth.uid())
  );

-- Any active member may edit the editable fields (see column privileges).
create policy "customers: update as active member"
  on public.customers for update
  to authenticated
  using (public.is_org_member(organization_id))
  with check (public.is_org_member(organization_id));

-- There is deliberately no DELETE policy or privilege.

-- -----------------------------------------------------------------------------
-- set_customer_status: deactivate / reactivate (owner or manager only)
--
-- Errors (SQLSTATE) that the app maps to friendly messages:
--   42501  not authenticated, or the caller's role may not change status
--   22023  invalid status
--   P0002  customer not found, or not in an organization where the caller is
--          an active member (the two cases are indistinguishable on purpose)
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
  v_org_id uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  if p_status is null or p_status not in ('active', 'inactive') then
    raise exception 'invalid customer status' using errcode = '22023';
  end if;

  select c.organization_id into v_org_id
  from public.customers c
  where c.id = p_customer_id
  for update;

  if v_org_id is null or not public.is_org_member(v_org_id) then
    raise exception 'customer not found' using errcode = 'P0002';
  end if;

  if not public.has_org_role(v_org_id, array['owner', 'manager']) then
    raise exception 'not allowed to change customer status' using errcode = '42501';
  end if;

  update public.customers
  set status = p_status
  where id = p_customer_id
    and status <> p_status;
end;
$$;

revoke all on function public.set_customer_status(uuid, text) from public, anon;
grant execute on function public.set_customer_status(uuid, text) to authenticated;

-- -----------------------------------------------------------------------------
-- list_customers: search, status filter and pagination in one query.
--
-- SECURITY INVOKER, so the customers RLS policies still apply: a caller only
-- ever gets rows from organizations where they are an active member, whatever
-- p_organization_id they pass. The explicit organization filter keeps the
-- query on the indexes above.
--
--   p_search  matched case-insensitively as a substring of name, company
--             name, email or phone. LIKE wildcards in it are literal. If it
--             looks like a phone number, its digits are also matched against
--             the phone's digits, so "01711000000" finds "+880 1711-000000".
--             Trimmed and capped at 100 characters.
--   p_status  'active', 'inactive' or NULL for all.
--   p_limit   clamped to 1..100.
--   total_count  rows matching the filters, before limit/offset.
-- -----------------------------------------------------------------------------
create or replace function public.list_customers(
  p_organization_id  uuid,
  p_search           text default null,
  p_status           text default null,
  p_limit            integer default 25,
  p_offset           integer default 0
)
returns table (
  id            uuid,
  name          text,
  company_name  text,
  phone         text,
  email         text,
  status        text,
  created_at    timestamptz,
  total_count   bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  with term as (
    select nullif(btrim(left(coalesce(p_search, ''), 100)), '') as value
  ),
  patterns as (
    select
      '%' || replace(replace(replace(t.value, '\', '\\'), '%', '\%'), '_', '\_') || '%'
        as text_pattern,
      case
        when t.value ~ '^\+?[0-9() .-]+$'
         and char_length(regexp_replace(t.value, '[^0-9]', '', 'g')) >= 3
        then '%' || regexp_replace(t.value, '[^0-9]', '', 'g') || '%'
      end as digits_pattern
    from term t
  )
  select
    c.id,
    c.name,
    c.company_name,
    c.phone,
    c.email,
    c.status,
    c.created_at,
    count(*) over () as total_count
  from public.customers c
  cross join patterns p
  where c.organization_id = p_organization_id
    and (p_status is null or c.status = p_status)
    and (
      p.text_pattern is null
      or c.name ilike p.text_pattern
      or c.company_name ilike p.text_pattern
      or c.email ilike p.text_pattern
      or c.phone ilike p.text_pattern
      or (p.digits_pattern is not null
          and regexp_replace(coalesce(c.phone, ''), '[^0-9]', '', 'g') like p.digits_pattern)
    )
  order by c.created_at desc, c.id desc
  limit least(greatest(coalesce(p_limit, 25), 1), 100)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

revoke all on function public.list_customers(uuid, text, text, integer, integer) from public, anon;
grant execute on function public.list_customers(uuid, text, text, integer, integer) to authenticated;
