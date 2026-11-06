-- =============================================================================
-- Organization branding: company logo (DECISIONS 029).
--
-- Model
--   * organizations.logo_path is a stable Storage object key, never a URL.
--     It can only be NULL or exactly organizations/<own id>/logo (CHECK), so
--     no row can point at another tenant's object. logo_updated_at is set
--     together with it.
--   * The previously unused organizations.logo_url column is dropped. It had
--     no write path (authenticated has SELECT only on organizations, and
--     create_organization() never set it). The drop refuses to run if any
--     row has a value, so no data can be lost silently.
--
-- Storage
--   * Private bucket `organization-branding`, 2 MiB limit, PNG/JPEG/WebP
--     only (no SVG). The app reads logos through short-lived signed URLs
--     created server-side at render time; no URL is ever stored.
--   * One fixed object per organization: organizations/<org id>/logo (no
--     extension; the content type is stored with the object). Replacing
--     overwrites it, so abandoned files cannot accumulate.
--   * storage.objects policies: active members may read their own
--     organization's object; only active owners/managers may insert, update
--     or delete it. Any other key in this bucket is denied to everyone.
--
-- Writes to organizations go only through the two SECURITY DEFINER RPCs
-- below, which re-check the caller's role. Branding is a role permission,
-- not a feature entitlement.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Columns
-- -----------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from public.organizations where logo_url is not null) then
    raise exception 'organizations.logo_url has values; migrate them before dropping the column';
  end if;
end;
$$;

alter table public.organizations drop column logo_url;

alter table public.organizations
  add column logo_path text,
  add column logo_updated_at timestamptz,
  add constraint organizations_logo_path_check
    check (logo_path is null or logo_path = 'organizations/' || id::text || '/logo'),
  add constraint organizations_logo_updated_at_check
    check ((logo_path is null) = (logo_updated_at is null));

-- -----------------------------------------------------------------------------
-- Path helpers (pure). Policies call them as the requesting role, so
-- authenticated needs EXECUTE; they reveal nothing.
-- -----------------------------------------------------------------------------
create or replace function public.organization_logo_path(p_organization_id uuid)
returns text
language sql
immutable
set search_path = ''
as $$
  select 'organizations/' || p_organization_id::text || '/logo';
$$;

-- The organization that owns a branding object key, or NULL if the key is
-- not exactly organizations/<lower-case uuid>/logo.
create or replace function public.organization_logo_object_org(p_name text)
returns uuid
language sql
immutable
set search_path = ''
as $$
  select case
    when p_name ~ '^organizations/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/logo$'
      then substring(p_name from 15 for 36)::uuid
  end;
$$;

revoke all on function public.organization_logo_path(uuid) from public, anon;
revoke all on function public.organization_logo_object_org(text) from public, anon;
grant execute on function public.organization_logo_path(uuid) to authenticated;
grant execute on function public.organization_logo_object_org(text) to authenticated;

-- -----------------------------------------------------------------------------
-- Bucket. Re-asserts the safe configuration if it already exists.
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'organization-branding',
  'organization-branding',
  false,
  2097152,
  array['image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- -----------------------------------------------------------------------------
-- storage.objects policies (RLS is already enabled on storage.objects).
-- Uploading with upsert needs INSERT + SELECT + UPDATE; removing needs
-- SELECT + DELETE.
-- -----------------------------------------------------------------------------
create policy "organization-branding: members read own logo"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'organization-branding'
    and public.is_org_member(public.organization_logo_object_org(name))
  );

create policy "organization-branding: owners and managers upload own logo"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'organization-branding'
    and public.has_org_role(public.organization_logo_object_org(name), array['owner', 'manager'])
  );

create policy "organization-branding: owners and managers replace own logo"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'organization-branding'
    and public.has_org_role(public.organization_logo_object_org(name), array['owner', 'manager'])
  )
  with check (
    bucket_id = 'organization-branding'
    and public.has_org_role(public.organization_logo_object_org(name), array['owner', 'manager'])
  );

create policy "organization-branding: owners and managers remove own logo"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'organization-branding'
    and public.has_org_role(public.organization_logo_object_org(name), array['owner', 'manager'])
  );

-- -----------------------------------------------------------------------------
-- set_organization_logo: record the uploaded object as the current logo.
-- Called after the app uploads the object with the user's own session.
--   42501  not an active owner/manager of the organization
--   P0002  the logo object has not been uploaded
-- -----------------------------------------------------------------------------
create or replace function public.set_organization_logo(p_organization_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_path text := public.organization_logo_path(p_organization_id);
begin
  if p_organization_id is null
     or not public.has_org_role(p_organization_id, array['owner', 'manager']) then
    raise exception 'not allowed to change organization branding' using errcode = '42501';
  end if;

  if not exists (
    select 1 from storage.objects o
    where o.bucket_id = 'organization-branding' and o.name = v_path
  ) then
    raise exception 'logo has not been uploaded' using errcode = 'P0002';
  end if;

  update public.organizations
  set logo_path = v_path, logo_updated_at = now()
  where id = p_organization_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- clear_organization_logo: documents fall back to the text-only header.
-- The app removes the Storage object afterwards (best effort; the fixed key
-- means a leftover object is overwritten by the next upload).
--   42501  not an active owner/manager of the organization
-- -----------------------------------------------------------------------------
create or replace function public.clear_organization_logo(p_organization_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_organization_id is null
     or not public.has_org_role(p_organization_id, array['owner', 'manager']) then
    raise exception 'not allowed to change organization branding' using errcode = '42501';
  end if;

  update public.organizations
  set logo_path = null, logo_updated_at = null
  where id = p_organization_id;
end;
$$;

revoke all on function public.set_organization_logo(uuid) from public, anon;
revoke all on function public.clear_organization_logo(uuid) from public, anon;
grant execute on function public.set_organization_logo(uuid) to authenticated;
grant execute on function public.clear_organization_logo(uuid) to authenticated;
