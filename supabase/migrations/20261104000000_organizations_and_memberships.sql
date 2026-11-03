-- =============================================================================
-- Organizations, memberships and profiles: multi-tenancy foundation.
--
-- Security model
--   * RLS is enabled on every table.
--   * The `anon` and `authenticated` roles get SELECT only. They have no
--     INSERT/UPDATE/DELETE privilege, so a wrong policy cannot open writes.
--   * The only write path is `public.create_organization()`, a SECURITY
--     DEFINER function. It derives the user from auth.uid() and fixes
--     role = 'owner', status = 'active'.
--   * Profiles are created by a trigger on auth.users, never by the client.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Shared trigger: keep updated_at current
-- -----------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- profiles: one row per auth user. Credentials stay in auth.users.
-- -----------------------------------------------------------------------------
create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  full_name   text check (char_length(full_name) <= 200),
  phone       text check (char_length(phone) <= 50),
  avatar_url  text check (char_length(avatar_url) <= 2048),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- organizations: a tenant
-- -----------------------------------------------------------------------------
create table public.organizations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(btrim(name)) between 1 and 200),
  email       text check (char_length(email) <= 320),
  phone       text check (char_length(phone) <= 50),
  address     text check (char_length(address) <= 500),
  currency    text not null default 'BDT' check (currency ~ '^[A-Z]{3}$'),
  timezone    text not null default 'Asia/Dhaka' check (char_length(timezone) between 1 and 64),
  tax_number  text check (char_length(tax_number) <= 100),
  logo_url    text check (char_length(logo_url) <= 2048),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  -- Nullable so deleting the creator's auth account does not delete the tenant.
  created_by  uuid references auth.users (id) on delete set null
);

create trigger organizations_set_updated_at
  before update on public.organizations
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- organization_members: (organization, user, role, status)
-- -----------------------------------------------------------------------------
create table public.organization_members (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  user_id          uuid not null references auth.users (id) on delete cascade,
  role             text not null check (role in ('owner', 'manager', 'employee')),
  status           text not null default 'active' check (status in ('active', 'disabled')),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  -- No duplicate membership. The backing index on (organization_id, user_id)
  -- also serves lookups by organization_id alone (leftmost column).
  constraint organization_members_org_user_key unique (organization_id, user_id)
);

create index organization_members_user_id_idx
  on public.organization_members (user_id);

create trigger organization_members_set_updated_at
  before update on public.organization_members
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- RLS helper: is the current user an ACTIVE member of org_id?
-- SECURITY DEFINER so policies can call it without recursing into the
-- organization_members policies. It only reveals the caller's own membership.
-- -----------------------------------------------------------------------------
create or replace function public.is_org_member(org_id uuid)
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
  );
$$;

revoke all on function public.is_org_member(uuid) from public, anon;
grant execute on function public.is_org_member(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- Privileges: read-only for API roles. All writes go through functions.
-- -----------------------------------------------------------------------------
revoke all on table public.profiles, public.organizations, public.organization_members
  from anon, authenticated;
grant select on table public.profiles, public.organizations, public.organization_members
  to authenticated;

-- -----------------------------------------------------------------------------
-- Row Level Security
-- -----------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;

-- A user can read only their own profile.
create policy "profiles: read own"
  on public.profiles for select
  to authenticated
  using (id = (select auth.uid()));

-- A user can read only organizations where they are an active member.
create policy "organizations: read as active member"
  on public.organizations for select
  to authenticated
  using (public.is_org_member(id));

-- A user can read their own membership rows, plus the membership rows of
-- organizations where they are an active member.
create policy "organization_members: read own or same organization"
  on public.organization_members for select
  to authenticated
  using (
    user_id = (select auth.uid())
    or public.is_org_member(organization_id)
  );

-- There are deliberately no INSERT/UPDATE/DELETE policies (see Privileges).

-- -----------------------------------------------------------------------------
-- Profile creation: trigger on new auth users, plus a backfill for existing ones
-- -----------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name)
  values (
    new.id,
    nullif(left(btrim(coalesce(new.raw_user_meta_data ->> 'full_name', '')), 200), '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

revoke all on function public.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

insert into public.profiles (id, full_name)
select
  u.id,
  nullif(left(btrim(coalesce(u.raw_user_meta_data ->> 'full_name', '')), 200), '')
from auth.users u
on conflict (id) do nothing;

-- -----------------------------------------------------------------------------
-- create_organization: atomic organization and owner membership creation
--
-- Never accepts user_id, organization_id or role from the caller.
-- Errors (SQLSTATE) that the app maps to friendly messages:
--   42501  not authenticated
--   23505  caller already belongs to an organization (repeat submission)
--   22023  invalid input (e.g. unknown time zone)
--   23514  check constraint violation (length or format)
-- -----------------------------------------------------------------------------
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
  v_user_id  uuid := auth.uid();
  v_org_id   uuid;
  v_name     text := nullif(btrim(p_name), '');
  v_currency text := upper(nullif(btrim(p_currency), ''));
  v_timezone text := nullif(btrim(p_timezone), '');
begin
  if v_user_id is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  if v_name is null then
    raise exception 'organization name is required' using errcode = '22023';
  end if;

  if v_currency is null or v_currency !~ '^[A-Z]{3}$' then
    raise exception 'invalid currency' using errcode = '22023';
  end if;

  if v_timezone is null
     or not exists (select 1 from pg_catalog.pg_timezone_names where name = v_timezone) then
    raise exception 'invalid time zone' using errcode = '22023';
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
    nullif(left(btrim(coalesce(u.raw_user_meta_data ->> 'full_name', '')), 200), '')
  from auth.users u
  where u.id = v_user_id
  on conflict (id) do nothing;

  insert into public.organizations
    (name, email, phone, address, currency, timezone, tax_number, created_by)
  values (
    v_name,
    nullif(btrim(p_email), ''),
    nullif(btrim(p_phone), ''),
    nullif(btrim(p_address), ''),
    v_currency,
    v_timezone,
    nullif(btrim(p_tax_number), ''),
    v_user_id
  )
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
