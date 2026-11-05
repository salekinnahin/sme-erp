-- Organization entitlements: run locally as postgres after all migrations through
-- 20261104170000_organization_features.sql. Fixtures are rolled back.
begin;
insert into auth.users (id, email) values
  ('f1000000-0000-4000-8000-000000000001', 'features-owner@test.example'),
  ('f1000000-0000-4000-8000-000000000002', 'features-manager@test.example'),
  ('f1000000-0000-4000-8000-000000000003', 'features-employee@test.example'),
  ('f1000000-0000-4000-8000-000000000004', 'features-disabled@test.example'),
  ('f1000000-0000-4000-8000-000000000005', 'features-other@test.example');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"f1000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select set_config('test.features_org_a', public.create_organization('Features A', 'BDT', 'UTC')::text, true);
select set_config('request.jwt.claims', '{"sub":"f1000000-0000-4000-8000-000000000005","role":"authenticated"}', true);
select set_config('test.features_org_b', public.create_organization('Features B', 'USD', 'UTC')::text, true);
reset role;
insert into public.organization_members (organization_id, user_id, role, status) values
  (current_setting('test.features_org_a')::uuid, 'f1000000-0000-4000-8000-000000000002', 'manager', 'active'),
  (current_setting('test.features_org_a')::uuid, 'f1000000-0000-4000-8000-000000000003', 'employee', 'active'),
  (current_setting('test.features_org_a')::uuid, 'f1000000-0000-4000-8000-000000000004', 'employee', 'disabled');

-- Definition and grants, including default PUBLIC grants and column privileges.
do $$ begin
  if not exists (select 1 from pg_proc p join pg_language l on l.oid = p.prolang
    where p.oid = 'public.has_org_feature(uuid,text)'::regprocedure
      and not p.prosecdef and p.provolatile = 's' and l.lanname = 'sql'
      and p.proconfig @> array['search_path=""']) then
    raise exception 'FAIL: helper must be STABLE SQL INVOKER with fixed search_path';
  end if;
  if not exists (select 1 from pg_class where oid = 'public.organization_features'::regclass and relrowsecurity)
     or exists (select 1 from pg_policies where tablename = 'organization_features' and cmd <> 'SELECT') then
    raise exception 'FAIL: RLS configuration';
  end if;
  if has_any_column_privilege('authenticated', 'public.organization_features', 'INSERT')
     or has_any_column_privilege('authenticated', 'public.organization_features', 'UPDATE')
     or has_table_privilege('authenticated', 'public.organization_features', 'DELETE')
     or has_table_privilege('authenticated', 'public.organization_features', 'TRUNCATE')
     or has_column_privilege('authenticated', 'public.organization_features', 'enabled_by', 'SELECT') then
    raise exception 'FAIL: excessive privileges';
  end if;
end $$;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"f1000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
do $$ begin
  if public.has_org_feature(current_setting('test.features_org_a')::uuid, 'rentals') is distinct from false then
    raise exception 'FAIL: missing row must deny';
  end if;
end $$;
reset role;

-- Trusted database administration: no app RPC or service credential needed.
insert into public.organization_features (organization_id, feature_key)
values (current_setting('test.features_org_a')::uuid, 'rentals');
insert into public.organization_features (organization_id, feature_key, enabled, enabled_at)
values (current_setting('test.features_org_b')::uuid, 'rentals', true, now());
set local role authenticated;
do $$ begin
  if public.has_org_feature(current_setting('test.features_org_a')::uuid, 'rentals') is distinct from false then
    raise exception 'FAIL: disabled row must deny';
  end if;
end $$;
reset role;
update public.organization_features set enabled = true, enabled_at = now()
where organization_id = current_setting('test.features_org_a')::uuid;

set local role authenticated;
do $$
declare
  v_user uuid;
  v_sql text;
  v_org uuid := current_setting('test.features_org_a')::uuid;
begin
  -- Owner, manager and employee all read, but none can mutate any column.
  foreach v_user in array array[
    'f1000000-0000-4000-8000-000000000001'::uuid,
    'f1000000-0000-4000-8000-000000000002'::uuid,
    'f1000000-0000-4000-8000-000000000003'::uuid
  ] loop
    perform set_config('request.jwt.claims', jsonb_build_object('sub', v_user, 'role', 'authenticated')::text, true);
    if (select count(*) from public.organization_features where organization_id = v_org) <> 1
       or public.has_org_feature(v_org, 'rentals') is distinct from true then
      raise exception 'FAIL: active member cannot read enabled feature';
    end if;
    if exists (select 1 from public.organization_features where organization_id = current_setting('test.features_org_b')::uuid)
       or public.has_org_feature(current_setting('test.features_org_b')::uuid, 'rentals') is distinct from false
       or public.has_org_feature(gen_random_uuid(), 'rentals') is distinct from false
       or public.has_org_feature(null, 'rentals') is distinct from false
       or public.has_org_feature(v_org, null) is distinct from false
       or public.has_org_feature(v_org, 'payroll') is distinct from false then
      raise exception 'FAIL: helper leaks configuration or grants unknown inputs';
    end if;
    foreach v_sql in array array[
      format('insert into public.organization_features (organization_id, feature_key, enabled) values (%L, %L, true)', v_org, 'rentals'),
      'update public.organization_features set enabled = true',
      'update public.organization_features set enabled = false',
      'update public.organization_features set feature_key = feature_key',
      format('update public.organization_features set organization_id = %L', current_setting('test.features_org_b')),
      'delete from public.organization_features',
      'select enabled_by from public.organization_features'
    ] loop
      begin
        execute v_sql;
        raise exception 'FAIL: organization user allowed: %', v_sql;
      exception when insufficient_privilege then null;
      end;
    end loop;
  end loop;

  perform set_config('request.jwt.claims', '{"sub":"f1000000-0000-4000-8000-000000000005","role":"authenticated"}', true);
  if exists (select 1 from public.organization_features where organization_id = v_org)
     or public.has_org_feature(v_org, 'rentals') is distinct from false
     or public.has_org_feature(current_setting('test.features_org_b')::uuid, 'rentals') is distinct from true then
    raise exception 'FAIL: tenant B isolation';
  end if;
  perform set_config('request.jwt.claims', '{"sub":"f1000000-0000-4000-8000-000000000004","role":"authenticated"}', true);
  if exists (select 1 from public.organization_features)
     or public.has_org_feature(v_org, 'rentals') is distinct from false then
    raise exception 'FAIL: disabled member access';
  end if;
end $$;
reset role;

-- Disabling an existing membership revokes access on the next statement.
update public.organization_members set status = 'disabled'
where user_id = 'f1000000-0000-4000-8000-000000000002';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"f1000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
do $$ begin
  if exists (select 1 from public.organization_features)
     or public.has_org_feature(current_setting('test.features_org_a')::uuid, 'rentals') is distinct from false then
    raise exception 'FAIL: revoked membership retains access';
  end if;
end $$;
reset role;

set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
do $$ begin
  begin
    perform enabled from public.organization_features;
    raise exception 'FAIL: anon read';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.has_org_feature(current_setting('test.features_org_a')::uuid, 'rentals');
    raise exception 'FAIL: anon helper execute';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- Constraints hold for privileged tooling too.
do $$
declare v_org uuid := current_setting('test.features_org_a')::uuid;
begin
  begin
    insert into public.organization_features (organization_id, feature_key) values (v_org, 'rentals');
    raise exception 'FAIL: duplicate entitlement';
  exception when unique_violation then null;
  end;
  begin
    insert into public.organization_features (organization_id, feature_key) values (v_org, 'payroll');
    raise exception 'FAIL: unknown feature key';
  exception when check_violation then null;
  end;
  begin
    insert into public.organization_features (organization_id, feature_key) values (gen_random_uuid(), 'rentals');
    raise exception 'FAIL: invalid organization';
  exception when foreign_key_violation then null;
  end;
  if exists (select 1 from public.organization_features where not enabled or enabled_at is null) then
    raise exception 'FAIL: attempted client writes altered entitlement';
  end if;
end $$;
select 'ALL ORGANIZATION FEATURE CHECKS PASSED' as result;
rollback;
