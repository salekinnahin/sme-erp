-- Platform-managed organization entitlements. Company roles never manage these.
create table public.organization_features (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  feature_key text not null,
  enabled boolean not null default false,
  -- Last activation metadata, supplied by trusted tooling; retained on disable.
  enabled_at timestamptz,
  enabled_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organization_features_feature_key_check check (feature_key in ('rentals')),
  constraint organization_features_org_feature_key unique (organization_id, feature_key),
  -- Tenant-safe target for any future references to an entitlement row.
  constraint organization_features_org_id_key unique (organization_id, id)
);

create index organization_features_enabled_by_idx on public.organization_features (enabled_by);

create trigger organization_features_set_updated_at
  before update on public.organization_features
  for each row execute function public.set_updated_at();

alter table public.organization_features enable row level security;

-- Revoke Supabase default grants too. Activation metadata is platform-only.
revoke all on table public.organization_features from public, anon, authenticated;
grant select (organization_id, feature_key, enabled) on public.organization_features to authenticated;

create policy "organization_features: read as active member"
  on public.organization_features for select to authenticated
  using (public.is_org_member(organization_id));

-- No write policies and no management RPC. Initial writes use trusted DB tooling.
-- INVOKER preserves column privileges and RLS, unlike a privilege-elevating read.
-- Explicit membership also prevents privileged callers without a user from
-- treating this as an unrestricted platform configuration lookup.
create function public.has_org_feature(p_organization_id uuid, p_feature_key text)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select public.is_org_member(p_organization_id) and exists (
    select 1 from public.organization_features f
    where f.organization_id = p_organization_id
      and f.feature_key = p_feature_key
      and f.enabled
  );
$$;

revoke all on function public.has_org_feature(uuid, text) from public, anon, authenticated;
grant execute on function public.has_org_feature(uuid, text) to authenticated;
