-- Organization branding (logo). Run locally as postgres after
-- 20261104210000_organization_branding.sql. Simulates API roles/JWTs and
-- performs the same storage.objects writes the Storage API performs on behalf
-- of a signed-in user. All fixtures and temporary helpers roll back.
begin;
create function pg_temp.expect_error(p_sql text, p_code text) returns void
language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if sqlstate = p_code then return; end if;
    raise exception 'FAIL: expected %, got %: % [%]', p_code, sqlstate, sqlerrm, p_sql;
  end;
  raise exception 'FAIL: expected error % [%]', p_code, p_sql;
end $$;
-- Rows affected by a statement that RLS may silently filter.
create function pg_temp.affected(p_sql text) returns bigint
language plpgsql as $$
declare n bigint;
begin
  execute p_sql;
  get diagnostics n = row_count;
  return n;
end $$;
create function pg_temp.as_user(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;

insert into auth.users (id, email) values
 ('a9000000-0000-4000-8000-000000000001','brand-owner@test.example'),
 ('a9000000-0000-4000-8000-000000000002','brand-manager@test.example'),
 ('a9000000-0000-4000-8000-000000000003','brand-employee@test.example'),
 ('a9000000-0000-4000-8000-000000000004','brand-disabled@test.example'),
 ('a9000000-0000-4000-8000-000000000005','brand-other@test.example');
set local role authenticated;
select pg_temp.as_user('a9000000-0000-4000-8000-000000000001');
select set_config('test.org_a', public.create_organization('Brand A','BDT','UTC')::text, true);
select pg_temp.as_user('a9000000-0000-4000-8000-000000000005');
select set_config('test.org_b', public.create_organization('Brand B','USD','UTC')::text, true);
reset role;
insert into public.organization_members (organization_id,user_id,role,status) values
 (current_setting('test.org_a')::uuid,'a9000000-0000-4000-8000-000000000002','manager','active'),
 (current_setting('test.org_a')::uuid,'a9000000-0000-4000-8000-000000000003','employee','active'),
 (current_setting('test.org_a')::uuid,'a9000000-0000-4000-8000-000000000004','manager','disabled');
select set_config('test.path_a', 'organizations/' || current_setting('test.org_a') || '/logo', true);
select set_config('test.path_b', 'organizations/' || current_setting('test.org_b') || '/logo', true);

-- -----------------------------------------------------------------------------
-- Definitions: columns, bucket, policies, functions and grants.
-- -----------------------------------------------------------------------------
do $$
declare f record; v_count int;
begin
 if exists (select 1 from information_schema.columns where table_schema='public' and table_name='organizations' and column_name='logo_url')
  or (select count(*) from information_schema.columns where table_schema='public' and table_name='organizations'
      and column_name in ('logo_path','logo_updated_at')) <> 2 then
  raise exception 'FAIL: organization branding columns';
 end if;
 if not exists (select 1 from storage.buckets where id='organization-branding' and not public
   and file_size_limit = 2097152
   and allowed_mime_types @> array['image/png','image/jpeg','image/webp']
   and allowed_mime_types <@ array['image/png','image/jpeg','image/webp']) then
  raise exception 'FAIL: bucket must be private, 2 MiB, PNG/JPEG/WebP only (no SVG)';
 end if;
 select count(*) into v_count from pg_policies
 where schemaname='storage' and tablename='objects' and policyname like 'organization-branding:%';
 if v_count <> 4 then raise exception 'FAIL: expected 4 branding policies, got %', v_count; end if;
 if exists (select 1 from pg_policies where schemaname='storage' and tablename='objects'
   and policyname like 'organization-branding:%'
   and (roles <> '{authenticated}'
        or coalesce(qual, with_check) not like '%organization-branding%'
        or (cmd <> 'SELECT' and (coalesce(qual,'') || coalesce(with_check,'')) not like '%has_org_role%'))) then
  raise exception 'FAIL: branding policies must be authenticated-only, bucket-scoped, writes role-checked';
 end if;
 for f in select p.oid, p.proname, p.prosecdef, p.proconfig from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname in ('organization_logo_path','organization_logo_object_org','set_organization_logo','clear_organization_logo') loop
  if not (f.proconfig @> array['search_path=""']) then raise exception 'FAIL: search path %', f.proname; end if;
  if has_function_privilege('anon', f.oid, 'EXECUTE') or not has_function_privilege('authenticated', f.oid, 'EXECUTE') then
   raise exception 'FAIL: grants %', f.proname;
  end if;
  if f.prosecdef <> (f.proname in ('set_organization_logo','clear_organization_logo')) then
   raise exception 'FAIL: security definer %', f.proname;
  end if;
 end loop;
 if has_column_privilege('authenticated','public.organizations','logo_path','UPDATE')
  or has_column_privilege('authenticated','public.organizations','logo_path','INSERT') then
  raise exception 'FAIL: logo_path must not be directly writable';
 end if;
 -- Path parsing accepts only the exact canonical key.
 if public.organization_logo_object_org(current_setting('test.path_a')) is distinct from current_setting('test.org_a')::uuid
  or public.organization_logo_object_org(upper(current_setting('test.path_a'))) is not null
  or public.organization_logo_object_org(current_setting('test.path_a') || '.png') is not null
  or public.organization_logo_object_org('x/' || current_setting('test.path_a')) is not null
  or public.organization_logo_object_org('organizations/' || current_setting('test.org_a') || '/other') is not null
  or public.organization_logo_object_org('organizations/' || current_setting('test.org_a') || '/../' || current_setting('test.org_b') || '/logo') is not null
  or public.organization_logo_object_org(null) is not null
  or public.organization_logo_path(current_setting('test.org_a')::uuid) <> current_setting('test.path_a') then
  raise exception 'FAIL: logo path helpers';
 end if;
end $$;

-- -----------------------------------------------------------------------------
-- Employee and other-tenant writes are denied; nothing is recorded.
-- -----------------------------------------------------------------------------
set local role authenticated;
select pg_temp.as_user('a9000000-0000-4000-8000-000000000003');
do $$ begin
 perform pg_temp.expect_error(format(
  'insert into storage.objects (bucket_id,name,metadata) values (''organization-branding'',%L,''{"mimetype":"image/png"}'')',
  current_setting('test.path_a')), '42501');
 perform pg_temp.expect_error(format('select public.set_organization_logo(%L)', current_setting('test.org_a')), '42501');
 perform pg_temp.expect_error(format('select public.clear_organization_logo(%L)', current_setting('test.org_a')), '42501');
end $$;
select pg_temp.as_user('a9000000-0000-4000-8000-000000000004');
do $$ begin
 perform pg_temp.expect_error(format(
  'insert into storage.objects (bucket_id,name) values (''organization-branding'',%L)', current_setting('test.path_a')), '42501');
 perform pg_temp.expect_error(format('select public.set_organization_logo(%L)', current_setting('test.org_a')), '42501');
end $$;
select pg_temp.as_user('a9000000-0000-4000-8000-000000000005');
do $$ declare s text; begin
 foreach s in array array[
  current_setting('test.path_a'),
  'organizations/' || current_setting('test.org_b') || '/logo.png',
  'organizations/' || current_setting('test.org_b') || '/other',
  upper(current_setting('test.path_b')),
  'logo',
  current_setting('test.org_b') || '/logo'] loop
  perform pg_temp.expect_error(format(
   'insert into storage.objects (bucket_id,name) values (''organization-branding'',%L)', s), '42501');
 end loop;
 perform pg_temp.expect_error(format('select public.set_organization_logo(%L)', current_setting('test.org_a')), '42501');
 perform pg_temp.expect_error('select public.set_organization_logo(null)', '42501');
end $$;

-- -----------------------------------------------------------------------------
-- Manager uploads and records; the RPC refuses before the object exists.
-- -----------------------------------------------------------------------------
select pg_temp.as_user('a9000000-0000-4000-8000-000000000002');
do $$ declare d record; begin
 perform pg_temp.expect_error(format('select public.set_organization_logo(%L)', current_setting('test.org_a')), 'P0002');
 insert into storage.objects (bucket_id,name,metadata)
 values ('organization-branding', current_setting('test.path_a'), '{"mimetype":"image/png"}');
 perform public.set_organization_logo(current_setting('test.org_a')::uuid);
 select logo_path, logo_updated_at into d from public.organizations where id = current_setting('test.org_a')::uuid;
 if d.logo_path is distinct from current_setting('test.path_a') or d.logo_updated_at is null then
  raise exception 'FAIL: manager set logo %', d;
 end if;
 -- Direct writes to organizations stay closed even for managers.
 perform pg_temp.expect_error(format('update public.organizations set logo_path = null where id = %L', current_setting('test.org_a')), '42501');
end $$;

-- Owner replaces (upsert = UPDATE); members read; other tenants cannot.
select pg_temp.as_user('a9000000-0000-4000-8000-000000000001');
do $$ begin
 if pg_temp.affected(format('update storage.objects set metadata = ''{"mimetype":"image/webp"}'' where bucket_id=''organization-branding'' and name=%L',
    current_setting('test.path_a'))) <> 1 then raise exception 'FAIL: owner replace'; end if;
 perform public.set_organization_logo(current_setting('test.org_a')::uuid);
end $$;
select pg_temp.as_user('a9000000-0000-4000-8000-000000000003');
do $$ begin
 if (select count(*) from storage.objects where bucket_id='organization-branding') <> 1
  or (select logo_path from public.organizations where id = current_setting('test.org_a')::uuid) is distinct from current_setting('test.path_a') then
  raise exception 'FAIL: employee must read own logo and branding';
 end if;
 if pg_temp.affected(format('update storage.objects set metadata = ''{}'' where name=%L', current_setting('test.path_a'))) <> 0 then
  raise exception 'FAIL: employee replaced logo';
 end if;
end $$;
do $$ declare u uuid; begin
 foreach u in array array['a9000000-0000-4000-8000-000000000004'::uuid,'a9000000-0000-4000-8000-000000000005'::uuid] loop
  perform pg_temp.as_user(u);
  if exists (select 1 from storage.objects where bucket_id='organization-branding')
   or exists (select 1 from public.organizations where id = current_setting('test.org_a')::uuid) then
   raise exception 'FAIL: % read A branding', u;
  end if;
  if pg_temp.affected(format('update storage.objects set metadata = ''{}'' where name=%L', current_setting('test.path_a'))) <> 0 then
   raise exception 'FAIL: % replaced A logo', u;
  end if;
 end loop;
 -- Tenant B cannot clear A's logo either.
 perform pg_temp.expect_error(format('select public.clear_organization_logo(%L)', current_setting('test.org_a')), '42501');
end $$;
-- Moving A's object into B's path (or vice versa) is blocked by WITH CHECK.
select pg_temp.as_user('a9000000-0000-4000-8000-000000000001');
do $$ begin
 perform pg_temp.expect_error(format('update storage.objects set name=%L where name=%L',
  current_setting('test.path_b'), current_setting('test.path_a')), '42501');
end $$;
reset role;
do $$ begin
 if (select metadata->>'mimetype' from storage.objects where name = current_setting('test.path_a')) <> 'image/webp' then
  raise exception 'FAIL: denied writes changed the object';
 end if;
end $$;

-- -----------------------------------------------------------------------------
-- logo_path integrity holds for privileged writers too.
-- -----------------------------------------------------------------------------
do $$ begin
 perform pg_temp.expect_error(format('update public.organizations set logo_path=%L where id=%L',
  current_setting('test.path_b'), current_setting('test.org_a')), '23514');
 perform pg_temp.expect_error(format('update public.organizations set logo_path=%L, logo_updated_at=now() where id=%L',
  current_setting('test.path_a') || '.png', current_setting('test.org_a')), '23514');
 perform pg_temp.expect_error(format('update public.organizations set logo_updated_at=null where id=%L', current_setting('test.org_a')), '23514');
 perform pg_temp.expect_error(format('update public.organizations set logo_path=null where id=%L', current_setting('test.org_a')), '23514');
end $$;

-- -----------------------------------------------------------------------------
-- Delete policy: only own owner/manager. Hosted Supabase may block direct
-- SQL deletes on storage tables (storage.protect_delete); there the policy
-- is checked structurally above and through the Storage API manually.
-- -----------------------------------------------------------------------------
set local role authenticated;
do $$
declare v_direct boolean := to_regproc('storage.protect_delete') is null; u uuid;
begin
 if v_direct then
  foreach u in array array['a9000000-0000-4000-8000-000000000003','a9000000-0000-4000-8000-000000000004','a9000000-0000-4000-8000-000000000005']::uuid[] loop
   perform pg_temp.as_user(u);
   if pg_temp.affected(format('delete from storage.objects where name=%L', current_setting('test.path_a'))) <> 0 then
    raise exception 'FAIL: % deleted A logo', u;
   end if;
  end loop;
 end if;
 -- Manager clears: documents fall back to text-only.
 perform pg_temp.as_user('a9000000-0000-4000-8000-000000000002');
 perform public.clear_organization_logo(current_setting('test.org_a')::uuid);
 if exists (select 1 from public.organizations where id = current_setting('test.org_a')::uuid
   and (logo_path is not null or logo_updated_at is not null)) then
  raise exception 'FAIL: clear logo';
 end if;
 -- Clearing again is a harmless no-op.
 perform public.clear_organization_logo(current_setting('test.org_a')::uuid);
 if v_direct then
  perform pg_temp.as_user('a9000000-0000-4000-8000-000000000001');
  if pg_temp.affected(format('delete from storage.objects where name=%L', current_setting('test.path_a'))) <> 1 then
   raise exception 'FAIL: owner remove object';
  end if;
  -- Recording a removed object is refused.
  perform pg_temp.expect_error(format('select public.set_organization_logo(%L)', current_setting('test.org_a')), 'P0002');
 end if;
end $$;
reset role;

-- Anonymous callers: no RPCs, no objects.
set local role anon;
select set_config('request.jwt.claims','{"role":"anon"}',true);
select pg_temp.expect_error(format('select public.set_organization_logo(%L)', current_setting('test.org_a')), '42501');
select pg_temp.expect_error(format('select public.clear_organization_logo(%L)', current_setting('test.org_a')), '42501');
do $$ begin
 if exists (select 1 from storage.objects where bucket_id='organization-branding') then raise exception 'FAIL: anon read'; end if;
exception when insufficient_privilege then null;
end $$;
reset role;
select 'ALL ORGANIZATION BRANDING CHECKS PASSED' as result;
rollback;
