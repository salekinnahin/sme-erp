-- =============================================================================
-- Tenant isolation test for organizations / organization_members / profiles.
--
-- How to run: paste this into the Supabase SQL Editor (it runs as `postgres`)
-- after applying the migrations. Everything runs in one transaction that is
-- ROLLED BACK at the end, so no data is left behind.
--
-- It simulates real API users by switching to the `authenticated` role and
-- setting the JWT claims that auth.uid() reads, which is how PostgREST
-- runs every request from the app.
--
-- Success: the script finishes and the last result shows
--   'ALL TENANT ISOLATION CHECKS PASSED'.
-- Failure: it stops with an error that starts with 'FAIL:'.
-- =============================================================================

begin;

-- Fixture users. The on_auth_user_created trigger creates their profiles.
insert into auth.users (id, email, raw_user_meta_data) values
  ('aaaaaaaa-0000-4000-8000-000000000001', 'tenant-test-a@example.com', '{"full_name":"User A"}'),
  ('bbbbbbbb-0000-4000-8000-000000000002', 'tenant-test-b@example.com', '{"full_name":"User B"}');

do $$ begin
  if (select full_name from public.profiles where id = 'aaaaaaaa-0000-4000-8000-000000000001') is distinct from 'User A' then
    raise exception 'FAIL: profile trigger did not create profile with full_name';
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- Anonymous role: no access at all
-- -----------------------------------------------------------------------------
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);

do $$ begin
  begin
    perform 1 from public.organizations;
    raise exception 'FAIL: anon could select organizations';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.create_organization('Anon Org', 'BDT', 'Asia/Dhaka');
    raise exception 'FAIL: anon could call create_organization';
  exception when insufficient_privilege then null;
  end;
end $$;

reset role;

-- -----------------------------------------------------------------------------
-- authenticated role with no user id: create_organization is rejected
-- -----------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated"}', true);

do $$ begin
  begin
    perform public.create_organization('Ghost Org', 'BDT', 'Asia/Dhaka');
    raise exception 'FAIL: create_organization worked without auth.uid()';
  exception when insufficient_privilege then null;
  end;
end $$;

reset role;

-- -----------------------------------------------------------------------------
-- User A creates Organization A
-- -----------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}', true);

do $$
declare v_org uuid;
begin
  -- Input validation
  begin
    perform public.create_organization('   ', 'BDT', 'Asia/Dhaka');
    raise exception 'FAIL: blank name accepted';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.create_organization('Org A', 'BD', 'Asia/Dhaka');
    raise exception 'FAIL: invalid currency accepted';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.create_organization('Org A', 'BDT', 'Not/AZone');
    raise exception 'FAIL: invalid time zone accepted';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.create_organization(repeat('x', 201), 'BDT', 'Asia/Dhaka');
    raise exception 'FAIL: over-long name accepted';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.create_organization('Org A', 'ZZZ', 'Asia/Dhaka');
    raise exception 'FAIL: unsupported currency ZZZ accepted';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.create_organization('Org A', 'BDT', 'Asia/Dhaka', 'not-an-email');
    raise exception 'FAIL: malformed email accepted';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.create_organization('Org A', 'BDT', 'Asia/Dhaka', 'a b@example.com');
    raise exception 'FAIL: email with whitespace accepted';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.create_organization('Org A', 'BDT', 'Asia/Dhaka', null, 'call me');
    raise exception 'FAIL: malformed phone accepted';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.create_organization('Org A', 'BDT', 'Asia/Dhaka', null, '+()-');
    raise exception 'FAIL: phone without digits accepted';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.create_organization('Org A', 'BDT', 'Asia/Dhaka', null, repeat('1', 51));
    raise exception 'FAIL: over-long phone accepted';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.create_organization('Org A', 'BDT', 'Asia/Dhaka', null, null, repeat('x', 501));
    raise exception 'FAIL: over-long address accepted';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.create_organization('Org A', 'BDT', 'Asia/Dhaka', null, null, null, repeat('x', 101));
    raise exception 'FAIL: over-long tax number accepted';
  exception when invalid_parameter_value then null;
  end;
  if exists (select 1 from public.organizations) then
    raise exception 'FAIL: a rejected call created an organization';
  end if;

  v_org := public.create_organization(
    '  Org A  ', 'bdt', 'Asia/Dhaka', '  A@Example.com ', ' +880 1711-000000 ');
  perform set_config('test.org_a', v_org::text, true);

  if (select name from public.organizations where id = v_org) is distinct from 'Org A' then
    raise exception 'FAIL: organization name not trimmed or not readable by owner';
  end if;
  if (select currency from public.organizations where id = v_org) is distinct from 'BDT' then
    raise exception 'FAIL: currency not normalized';
  end if;
  if (select email from public.organizations where id = v_org) is distinct from 'a@example.com' then
    raise exception 'FAIL: email not trimmed and lowercased';
  end if;
  if (select phone from public.organizations where id = v_org) is distinct from '+880 1711-000000' then
    raise exception 'FAIL: phone not trimmed';
  end if;
  if not exists (
    select 1 from public.organization_members
    where organization_id = v_org
      and user_id = 'aaaaaaaa-0000-4000-8000-000000000001'
      and role = 'owner' and status = 'active'
  ) then
    raise exception 'FAIL: owner membership missing';
  end if;

  -- A repeat submission is rejected and creates no second organization
  begin
    perform public.create_organization('Org A again', 'BDT', 'Asia/Dhaka');
    raise exception 'FAIL: second organization created for same user';
  exception when unique_violation then null;
  end;
  if (select count(*) from public.organizations) <> 1 then
    raise exception 'FAIL: user A sees % organizations, expected 1', (select count(*) from public.organizations);
  end if;
end $$;

reset role;

-- -----------------------------------------------------------------------------
-- User B creates Organization B, then tries to reach Organization A
-- -----------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"bbbbbbbb-0000-4000-8000-000000000002","role":"authenticated"}', true);

do $$
declare
  v_org_a uuid := current_setting('test.org_a')::uuid;
  v_org_b uuid;
begin
  v_org_b := public.create_organization('Org B', 'USD', 'UTC');
  perform set_config('test.org_b', v_org_b::text, true);

  -- Reads
  if (select count(*) from public.organizations) <> 1
     or not exists (select 1 from public.organizations where id = v_org_b) then
    raise exception 'FAIL: user B does not see exactly Organization B';
  end if;
  if exists (select 1 from public.organizations where id = v_org_a) then
    raise exception 'FAIL: user B can read Organization A';
  end if;
  if exists (select 1 from public.organization_members where organization_id = v_org_a) then
    raise exception 'FAIL: user B can read Organization A memberships';
  end if;
  if exists (select 1 from public.organization_members where user_id = 'aaaaaaaa-0000-4000-8000-000000000001') then
    raise exception 'FAIL: user B can read user A memberships';
  end if;
  if (select count(*) from public.profiles) <> 1
     or exists (select 1 from public.profiles where id = 'aaaaaaaa-0000-4000-8000-000000000001') then
    raise exception 'FAIL: user B can read other profiles';
  end if;
  if public.is_org_member(v_org_a) then
    raise exception 'FAIL: is_org_member(Org A) is true for user B';
  end if;

  -- Insert self into Organization A
  begin
    insert into public.organization_members (organization_id, user_id, role, status)
    values (v_org_a, 'bbbbbbbb-0000-4000-8000-000000000002', 'owner', 'active');
    raise exception 'FAIL: user B inserted themselves into Organization A';
  exception when insufficient_privilege then null;
  end;

  -- Create a membership for another user (user A) in B's own organization
  begin
    insert into public.organization_members (organization_id, user_id, role, status)
    values (v_org_b, 'aaaaaaaa-0000-4000-8000-000000000001', 'employee', 'active');
    raise exception 'FAIL: user B created a membership for another user';
  exception when insufficient_privilege then null;
  end;

  -- Change own role / move own membership to another organization
  begin
    update public.organization_members set role = 'manager'
    where user_id = 'bbbbbbbb-0000-4000-8000-000000000002';
    raise exception 'FAIL: user B changed their role';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.organization_members set organization_id = v_org_a
    where user_id = 'bbbbbbbb-0000-4000-8000-000000000002';
    raise exception 'FAIL: user B moved their membership to Organization A';
  exception when insufficient_privilege then null;
  end;

  -- Write directly to organizations
  begin
    insert into public.organizations (name, currency, timezone) values ('Rogue', 'BDT', 'UTC');
    raise exception 'FAIL: user B inserted an organization directly';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.organizations set name = 'Hacked' where id = v_org_a;
    raise exception 'FAIL: user B updated Organization A';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.organizations where id = v_org_a;
    raise exception 'FAIL: user B deleted Organization A';
  exception when insufficient_privilege then null;
  end;

  -- Write directly to profiles
  begin
    update public.profiles set full_name = 'Hacked' where id = 'aaaaaaaa-0000-4000-8000-000000000001';
    raise exception 'FAIL: user B updated user A profile';
  exception when insufficient_privilege then null;
  end;
end $$;

reset role;

-- -----------------------------------------------------------------------------
-- User A still sees only Organization A, and the data is untouched
-- -----------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}', true);

do $$
declare
  v_org_a uuid := current_setting('test.org_a')::uuid;
  v_org_b uuid := current_setting('test.org_b')::uuid;
begin
  if exists (select 1 from public.organizations where id = v_org_b) then
    raise exception 'FAIL: user A can read Organization B';
  end if;
  if exists (select 1 from public.organization_members where organization_id = v_org_b) then
    raise exception 'FAIL: user A can read Organization B memberships';
  end if;
  if (select name from public.organizations where id = v_org_a) is distinct from 'Org A' then
    raise exception 'FAIL: Organization A was modified';
  end if;
  if (select count(*) from public.organization_members) <> 1 then
    raise exception 'FAIL: user A sees unexpected memberships';
  end if;
end $$;

reset role;

select 'ALL TENANT ISOLATION CHECKS PASSED' as result;

rollback;
