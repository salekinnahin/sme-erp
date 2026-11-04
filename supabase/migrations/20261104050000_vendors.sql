-- =============================================================================
-- Vendors: the second tenant-owned master-data table.
--
-- Follows the customers pattern (docs/DECISIONS.md 013, 014;
-- docs/ARCHITECTURE.md § Tenant-Owned Module Pattern), in its final,
-- hardened form (20261104020000_customers.sql as amended by
-- 20261104030000_harden_customer_validation.sql):
--
--   * Integrity lives in table CHECK constraints built on the shared text
--     helpers public.text_is_trimmed() / public.text_has_whitespace() (one
--     explicit whitespace set) and char_length() (code points).
--   * RLS scopes every row to an organization where the caller is an ACTIVE
--     member (public.is_org_member).
--   * Column-level privileges:
--       INSERT  only the editable fields plus organization_id (RLS checks it)
--       UPDATE  only the editable fields. organization_id, status,
--               created_by and created_at can never be changed by a client
--       DELETE  not granted. Vendors are deactivated, never deleted
--   * Deactivate / reactivate goes through set_vendor_status(), a
--     SECURITY DEFINER function that authorizes before it locks anything.
--   * Search and pagination go through list_vendors(), SECURITY INVOKER.
--
-- Version 1 permissions:
--   owner, manager, employee  view, create, edit
--   owner, manager            deactivate, reactivate
--
-- Validation mirrors lib/vendors/validation.ts. Keep the two in sync.
--
-- Requires 20261104030000_harden_customer_validation.sql (text helpers) and
-- 20261104020000_customers.sql (public.has_org_role). Creates new objects
-- only; no existing table, function or row is changed.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- vendors
--
-- Text rules: optional fields are NULL when empty (never ''), and no value
-- may start or end with whitespace. The app trims before writing.
-- -----------------------------------------------------------------------------
create table public.vendors (
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
  -- privilege). Nullable so deleting an auth account keeps its vendors.
  -- Same reference as customers.created_by (auth.users, not profiles).
  created_by       uuid default auth.uid() references auth.users (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  constraint vendors_status_check
    check (status in ('active', 'inactive')),

  constraint vendors_name_check
    check (char_length(name) between 1 and 200
           and public.text_is_trimmed(name)),

  constraint vendors_company_name_check
    check (company_name is null or (
      char_length(company_name) between 1 and 200
      and public.text_is_trimmed(company_name))),

  -- Optional leading +, then digits, spaces, ( ) - and dots, with at least
  -- 6 digits (same as customers and organizations).
  constraint vendors_phone_check
    check (phone is null or (
      char_length(phone) <= 50
      and phone ~ '^\+?[0-9() .-]+$'
      and public.text_is_trimmed(phone)
      and char_length(regexp_replace(phone, '[^0-9]', '', 'g')) >= 6)),

  -- Lowercase, simple local@domain.tld, no whitespace anywhere.
  constraint vendors_email_check
    check (email is null or (
      char_length(email) <= 320
      and email = lower(email)
      and not public.text_has_whitespace(email)
      and email ~ '^[^@]+@[^@]+\.[^@]+$')),

  constraint vendors_address_check
    check (address is null or (
      char_length(address) between 1 and 500
      and public.text_is_trimmed(address))),

  constraint vendors_tax_number_check
    check (tax_number is null or (
      char_length(tax_number) between 1 and 100
      and public.text_is_trimmed(tax_number))),

  constraint vendors_notes_check
    check (notes is null or (
      char_length(notes) between 1 and 2000
      and public.text_is_trimmed(notes)))
);

-- List queries: newest first within an organization. Also serves lookups by
-- organization_id alone (leftmost column), e.g. the FK cascade.
create index vendors_org_created_idx
  on public.vendors (organization_id, created_at desc, id desc);

-- Status filter within an organization.
create index vendors_org_status_created_idx
  on public.vendors (organization_id, status, created_at desc, id desc);

-- FK index (ON DELETE SET NULL when an auth user is removed).
create index vendors_created_by_idx
  on public.vendors (created_by);

create trigger vendors_set_updated_at
  before update on public.vendors
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- Privileges. Supabase grants ALL on new public tables to API roles by
-- default, so start from nothing and grant only what is needed.
-- -----------------------------------------------------------------------------
revoke all on table public.vendors from anon, authenticated;

grant select on table public.vendors to authenticated;

grant insert (organization_id, name, company_name, phone, email, address, tax_number, notes)
  on table public.vendors to authenticated;

grant update (name, company_name, phone, email, address, tax_number, notes)
  on table public.vendors to authenticated;

-- -----------------------------------------------------------------------------
-- Row Level Security
-- -----------------------------------------------------------------------------
alter table public.vendors enable row level security;

create policy "vendors: read as active member"
  on public.vendors for select
  to authenticated
  using (public.is_org_member(organization_id));

-- Any active member may create vendors, but only in their own organization
-- and only as themselves.
create policy "vendors: insert as active member"
  on public.vendors for insert
  to authenticated
  with check (
    public.is_org_member(organization_id)
    and created_by = (select auth.uid())
  );

-- Any active member may edit the editable fields (see column privileges).
create policy "vendors: update as active member"
  on public.vendors for update
  to authenticated
  using (public.is_org_member(organization_id))
  with check (public.is_org_member(organization_id));

-- There is deliberately no DELETE policy or privilege.

-- -----------------------------------------------------------------------------
-- set_vendor_status: deactivate / reactivate (owner or manager only)
--
-- Order of checks (same as set_customer_status):
--   1. caller is authenticated                          else 42501
--   2. status is valid                                  else 22023
--   3. authorization-scoped lookup: the vendor joined to the CALLER's active
--      membership of the vendor's organization. A plain read: it takes no
--      row lock and never waits on other transactions' row locks.
--      Missing vendor, other tenant, disabled member    -> P0002 (identical)
--   4. role is owner or manager                         else 42501
--      (only reachable by active members of the vendor's organization, who
--      can already read the vendor, so nothing is revealed)
--   5. UPDATE, which re-checks the role in its own WHERE clause and takes
--      the row lock itself, only on an authorized row.
-- -----------------------------------------------------------------------------
create or replace function public.set_vendor_status(
  p_vendor_id  uuid,
  p_status     text
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
    raise exception 'invalid vendor status' using errcode = '22023';
  end if;

  select m.role into v_role
  from public.vendors v
  join public.organization_members m
    on m.organization_id = v.organization_id
  where v.id = p_vendor_id
    and m.user_id = v_user_id
    and m.status = 'active';

  if not found then
    raise exception 'vendor not found' using errcode = 'P0002';
  end if;

  if v_role not in ('owner', 'manager') then
    raise exception 'not allowed to change vendor status' using errcode = '42501';
  end if;

  update public.vendors v
  set status = p_status
  where v.id = p_vendor_id
    and v.status <> p_status
    and public.has_org_role(v.organization_id, array['owner', 'manager']);
end;
$$;

revoke all on function public.set_vendor_status(uuid, text) from public, anon;
grant execute on function public.set_vendor_status(uuid, text) to authenticated;

-- -----------------------------------------------------------------------------
-- list_vendors: search, status filter and pagination in one query.
--
-- SECURITY INVOKER, so the vendors RLS policies still apply: a caller only
-- ever gets rows from organizations where they are an active member, whatever
-- p_organization_id they pass. The explicit organization filter keeps the
-- query on the indexes above.
--
--   p_search  matched case-insensitively as a substring of name, company
--             name, email or phone. LIKE wildcards in it are literal. If it
--             looks like a phone number, its digits are also matched against
--             the phone's digits, so "01711000000" finds "+880 1711-000000".
--             Trimmed with the shared whitespace set and capped at 100
--             code points.
--   p_status  'active', 'inactive' or NULL for all.
--   p_limit   clamped to 1..100.
--   total_count  rows matching the filters, before limit/offset.
-- Order: newest first, id as tie-breaker (deterministic pages).
-- -----------------------------------------------------------------------------
create or replace function public.list_vendors(
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
    select nullif(public.trim_whitespace(left(coalesce(p_search, ''), 100)), '') as value
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
    v.id,
    v.name,
    v.company_name,
    v.phone,
    v.email,
    v.status,
    v.created_at,
    count(*) over () as total_count
  from public.vendors v
  cross join patterns p
  where v.organization_id = p_organization_id
    and (p_status is null or v.status = p_status)
    and (
      p.text_pattern is null
      or v.name ilike p.text_pattern
      or v.company_name ilike p.text_pattern
      or v.email ilike p.text_pattern
      or v.phone ilike p.text_pattern
      or (p.digits_pattern is not null
          and regexp_replace(coalesce(v.phone, ''), '[^0-9]', '', 'g') like p.digits_pattern)
    )
  order by v.created_at desc, v.id desc
  limit least(greatest(coalesce(p_limit, 25), 1), 100)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

revoke all on function public.list_vendors(uuid, text, text, integer, integer) from public, anon;
grant execute on function public.list_vendors(uuid, text, text, integer, integer) to authenticated;
