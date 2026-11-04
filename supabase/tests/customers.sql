-- =============================================================================
-- Customers: tenant isolation, role permissions and data integrity.
--
-- How to run: paste this into the Supabase SQL Editor (it runs as `postgres`)
-- after applying the migrations up to
-- 20261104060000_align_customer_search_trim.sql.
-- Everything runs in one transaction that is ROLLED BACK at the end, so no
-- data is left behind. Run it separately from tenant_isolation.sql.
--
-- Like tenant_isolation.sql, it simulates real API users by switching to the
-- `authenticated` role and setting the JWT claims that auth.uid() reads.
--
-- Users
--   A  owner of Organization A        M  manager of Organization A
--   E  employee of Organization A     D  disabled member of Organization A
--   B  owner of Organization B
--
-- Success: the last result shows 'ALL CUSTOMER CHECKS PASSED'.
-- Failure: it stops with an error that starts with 'FAIL:'.
-- =============================================================================

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('c0000000-0000-4000-8000-00000000000a', 'customers-test-a@example.com', '{"full_name":"Owner A"}'),
  ('c0000000-0000-4000-8000-00000000000b', 'customers-test-b@example.com', '{"full_name":"Owner B"}'),
  ('c0000000-0000-4000-8000-00000000000c', 'customers-test-m@example.com', '{"full_name":"Manager A"}'),
  ('c0000000-0000-4000-8000-00000000000d', 'customers-test-d@example.com', '{"full_name":"Disabled A"}'),
  ('c0000000-0000-4000-8000-00000000000e', 'customers-test-e@example.com', '{"full_name":"Employee A"}');

-- -----------------------------------------------------------------------------
-- Organizations A and B, created the same way the app does
-- -----------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"c0000000-0000-4000-8000-00000000000a","role":"authenticated"}', true);
select set_config('test.org_a', public.create_organization('Customers Org A', 'BDT', 'Asia/Dhaka')::text, true);
reset role;

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"c0000000-0000-4000-8000-00000000000b","role":"authenticated"}', true);
select set_config('test.org_b', public.create_organization('Customers Org B', 'USD', 'UTC')::text, true);
reset role;

-- Extra members of Organization A. There is no invitation flow yet, so the
-- fixture inserts them as postgres.
insert into public.organization_members (organization_id, user_id, role, status) values
  (current_setting('test.org_a')::uuid, 'c0000000-0000-4000-8000-00000000000c', 'manager',  'active'),
  (current_setting('test.org_a')::uuid, 'c0000000-0000-4000-8000-00000000000e', 'employee', 'active'),
  (current_setting('test.org_a')::uuid, 'c0000000-0000-4000-8000-00000000000d', 'employee', 'disabled');

-- -----------------------------------------------------------------------------
-- anon: no access
-- -----------------------------------------------------------------------------
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);

do $$ begin
  begin
    perform 1 from public.customers;
    raise exception 'FAIL: anon could select customers';
  exception when insufficient_privilege then null;
  end;
  begin
    perform * from public.list_customers(current_setting('test.org_a')::uuid);
    raise exception 'FAIL: anon could call list_customers';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.set_customer_status(gen_random_uuid(), 'inactive');
    raise exception 'FAIL: anon could call set_customer_status';
  exception when insufficient_privilege then null;
  end;
end $$;

reset role;

-- -----------------------------------------------------------------------------
-- Owner A: create, read, update, integrity rules, deactivate / reactivate
-- -----------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"c0000000-0000-4000-8000-00000000000a","role":"authenticated"}', true);

do $$
declare
  v_org_a uuid := current_setting('test.org_a')::uuid;
  v_org_b uuid := current_setting('test.org_b')::uuid;
  v_id    uuid;
  v_n     integer;
begin
  -- Create Customer A
  insert into public.customers (organization_id, name, company_name, phone, email, notes)
  values (v_org_a, 'Acme Buyer', 'Acme Ltd', '+880 1711-000000', 'buyer@acme.test', 'Line 1
Line 2')
  returning id into v_id;
  perform set_config('test.customer_a', v_id::text, true);

  -- Read it back, with server-side defaults
  if not exists (
    select 1 from public.customers
    where id = v_id
      and organization_id = v_org_a
      and status = 'active'
      and created_by = 'c0000000-0000-4000-8000-00000000000a'
  ) then
    raise exception 'FAIL: owner cannot read Customer A, or defaults are wrong';
  end if;

  -- Update it
  update public.customers set company_name = 'Acme Trading' where id = v_id;
  get diagnostics v_n = row_count;
  if v_n <> 1 or (select company_name from public.customers where id = v_id) is distinct from 'Acme Trading' then
    raise exception 'FAIL: owner cannot update Customer A';
  end if;
  update public.customers set company_name = null where id = v_id;
  if (select company_name from public.customers where id = v_id) is not null then
    raise exception 'FAIL: optional field could not be cleared';
  end if;

  -- Integrity: invalid values are rejected by CHECK constraints
  begin
    insert into public.customers (organization_id, name) values (v_org_a, '');
    raise exception 'FAIL: empty name accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.customers (organization_id, name) values (v_org_a, '  Padded  ');
    raise exception 'FAIL: untrimmed name accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.customers (organization_id, name) values (v_org_a, repeat('x', 201));
    raise exception 'FAIL: over-long name accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.customers (organization_id, name) values (v_org_a, null);
    raise exception 'FAIL: null name accepted';
  exception when not_null_violation then null;
  end;
  begin
    insert into public.customers (organization_id, name, email) values (v_org_a, 'X', 'Upper@Example.com');
    raise exception 'FAIL: non-lowercase email accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.customers (organization_id, name, email) values (v_org_a, 'X', 'not-an-email');
    raise exception 'FAIL: malformed email accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.customers (organization_id, name, email) values (v_org_a, 'X', repeat('a', 315) || '@x.com');
    raise exception 'FAIL: over-long email accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.customers (organization_id, name, phone) values (v_org_a, 'X', 'call me');
    raise exception 'FAIL: malformed phone accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.customers (organization_id, name, phone) values (v_org_a, 'X', '12-34');
    raise exception 'FAIL: phone with fewer than 6 digits accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.customers (organization_id, name, company_name) values (v_org_a, 'X', '');
    raise exception 'FAIL: empty-string company name accepted (must be NULL)';
  exception when check_violation then null;
  end;
  begin
    insert into public.customers (organization_id, name, address) values (v_org_a, 'X', repeat('x', 501));
    raise exception 'FAIL: over-long address accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.customers (organization_id, name, tax_number) values (v_org_a, 'X', repeat('x', 101));
    raise exception 'FAIL: over-long tax number accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.customers (organization_id, name, notes) values (v_org_a, 'X', repeat('x', 2001));
    raise exception 'FAIL: over-long notes accepted';
  exception when check_violation then null;
  end;

  -- Unicode whitespace (DECISIONS 014): one explicit set, same as
  -- lib/validation/text.ts. U+00A0, U+0085 and U+2003 are whitespace.
  begin
    insert into public.customers (organization_id, name) values (v_org_a, E' ');
    raise exception 'FAIL: NBSP-only name accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.customers (organization_id, name) values (v_org_a, E' Acme');
    raise exception 'FAIL: name with leading NBSP accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.customers (organization_id, name) values (v_org_a, E'Acme\u0085');
    raise exception 'FAIL: name with trailing U+0085 accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.customers (organization_id, name) values (v_org_a, E' Acme');
    raise exception 'FAIL: name with leading U+2003 accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.customers (organization_id, name) values (v_org_a, E'Acme\t');
    raise exception 'FAIL: name with trailing tab accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.customers (organization_id, name, company_name) values (v_org_a, 'X', E' \u0085 ');
    raise exception 'FAIL: whitespace-only company name accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.customers (organization_id, name, notes) values (v_org_a, 'X', E'Note\n');
    raise exception 'FAIL: notes with trailing newline accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.customers (organization_id, name, email) values (v_org_a, 'X', E'buy er@acme.test');
    raise exception 'FAIL: email containing NBSP accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.customers (organization_id, name, email) values (v_org_a, 'X', E'buyer@acme\u0085.test');
    raise exception 'FAIL: email containing U+0085 accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.customers (organization_id, name, email) values (v_org_a, 'X', E'buyer@acme.test ');
    raise exception 'FAIL: email containing U+2003 accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.customers (organization_id, name, phone) values (v_org_a, 'X', E' +880 1711-000000');
    raise exception 'FAIL: phone with leading NBSP accepted';
  exception when check_violation then null;
  end;
  -- Whitespace inside a value is fine. Accepted rows are rolled back (the
  -- U0001 sentinel) so the Org A counts below stay unchanged.
  begin
    insert into public.customers (organization_id, name, notes)
    values (v_org_a, E'Inner Space Ltd', E'Line 1\u0085Line 2\nLine 3');
    raise exception 'rollback accepted rows' using errcode = 'U0001';
  exception when sqlstate 'U0001' then null;
  end;

  -- Helpers agree with lib/validation/text.ts
  if public.trim_whitespace(E' \t\n\r\u000b\u000c\u0085      　﻿Acme  ') <> 'Acme' then
    raise exception 'FAIL: trim_whitespace does not strip the whole whitespace set';
  end if;
  if public.trim_whitespace(E'​Acme') <> E'​Acme' then
    raise exception 'FAIL: trim_whitespace strips U+200B (zero-width space is not whitespace)';
  end if;
  if public.text_is_trimmed('') or public.text_is_trimmed(E' ') or not public.text_is_trimmed('A b') then
    raise exception 'FAIL: text_is_trimmed is wrong';
  end if;
  if not public.text_has_whitespace(E'a\u0085b') or public.text_has_whitespace('ab') then
    raise exception 'FAIL: text_has_whitespace is wrong';
  end if;

  -- Character length counts code points, like charLength() in the app.
  -- U+1F600 is one code point (two UTF-16 code units, four UTF-8 bytes).
  begin
    insert into public.customers (organization_id, name, company_name, address, tax_number, notes)
    values (v_org_a, repeat(E'\U0001F600', 200), repeat(E'\U0001F600', 200),
            repeat(E'\U0001F600', 500), repeat(E'\U0001F600', 100), repeat(E'\U0001F600', 2000));
    insert into public.customers (organization_id, name)
    values (v_org_a, repeat(E'গ', 200));   -- Bengali letter GA
    raise exception 'rollback accepted rows' using errcode = 'U0001';
  exception when sqlstate 'U0001' then null;
  end;
  begin
    insert into public.customers (organization_id, name) values (v_org_a, repeat(E'\U0001F600', 201));
    raise exception 'FAIL: 201-emoji name accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.customers (organization_id, name, notes) values (v_org_a, 'X', repeat(E'\U0001F600', 2001));
    raise exception 'FAIL: 2001-emoji notes accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.customers (organization_id, name, company_name) values (v_org_a, 'X', repeat(E'\U0001F600', 201));
    raise exception 'FAIL: 201-emoji company name accepted';
  exception when check_violation then null;
  end;

  -- Protected columns cannot be written by clients
  begin
    insert into public.customers (organization_id, name, status) values (v_org_a, 'X', 'inactive');
    raise exception 'FAIL: client set status on insert';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.customers (organization_id, name, created_by)
    values (v_org_a, 'X', 'c0000000-0000-4000-8000-00000000000b');
    raise exception 'FAIL: client set created_by on insert';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.customers set status = 'inactive' where id = v_id;
    raise exception 'FAIL: client updated status directly';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.customers set organization_id = v_org_b where id = v_id;
    raise exception 'FAIL: client moved a customer to another organization';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.customers set created_by = null where id = v_id;
    raise exception 'FAIL: client changed created_by';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.customers set created_at = now() - interval '1 day' where id = v_id;
    raise exception 'FAIL: client changed created_at';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.customers where id = v_id;
    raise exception 'FAIL: client deleted a customer';
  exception when insufficient_privilege then null;
  end;

  -- Deactivate / reactivate
  begin
    perform public.set_customer_status(v_id, 'archived');
    raise exception 'FAIL: invalid status accepted';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.set_customer_status(gen_random_uuid(), 'inactive');
    raise exception 'FAIL: unknown customer id did not raise not-found';
  exception when no_data_found then null;
  end;
  perform public.set_customer_status(v_id, 'inactive');
  if (select status from public.customers where id = v_id) <> 'inactive' then
    raise exception 'FAIL: owner could not deactivate Customer A';
  end if;
  perform public.set_customer_status(v_id, 'inactive'); -- repeat is a no-op
  perform public.set_customer_status(v_id, 'active');
  if (select status from public.customers where id = v_id) <> 'active' then
    raise exception 'FAIL: owner could not reactivate Customer A';
  end if;

  -- Search fixtures: LIKE wildcards in names, and an inactive customer
  insert into public.customers (organization_id, name) values (v_org_a, '100% Cotton');
  insert into public.customers (organization_id, name) values (v_org_a, 'Under_Score');
  insert into public.customers (organization_id, name, email)
  values (v_org_a, 'Dormant Buyer', 'dormant@acme.test')
  returning id into v_id;
  perform public.set_customer_status(v_id, 'inactive');
end $$;

reset role;

-- -----------------------------------------------------------------------------
-- Manager M: create, edit, deactivate, reactivate
-- -----------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"c0000000-0000-4000-8000-00000000000c","role":"authenticated"}', true);

do $$
declare
  v_org_a uuid := current_setting('test.org_a')::uuid;
  v_cust  uuid := current_setting('test.customer_a')::uuid;
  v_id    uuid;
begin
  insert into public.customers (organization_id, name) values (v_org_a, 'Manager Created')
  returning id into v_id;
  if (select created_by from public.customers where id = v_id) is distinct from 'c0000000-0000-4000-8000-00000000000c' then
    raise exception 'FAIL: created_by is not the manager';
  end if;
  update public.customers set notes = 'Edited by manager' where id = v_cust;
  if (select notes from public.customers where id = v_cust) is distinct from 'Edited by manager' then
    raise exception 'FAIL: manager cannot edit Customer A';
  end if;
  perform public.set_customer_status(v_cust, 'inactive');
  if (select status from public.customers where id = v_cust) <> 'inactive' then
    raise exception 'FAIL: manager could not deactivate Customer A';
  end if;
  perform public.set_customer_status(v_cust, 'active');
  if (select status from public.customers where id = v_cust) <> 'active' then
    raise exception 'FAIL: manager could not reactivate Customer A';
  end if;
end $$;

reset role;

-- -----------------------------------------------------------------------------
-- Employee E: create, read, edit, but cannot deactivate or reactivate
-- -----------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"c0000000-0000-4000-8000-00000000000e","role":"authenticated"}', true);

do $$
declare
  v_org_a   uuid := current_setting('test.org_a')::uuid;
  v_cust    uuid := current_setting('test.customer_a')::uuid;
  v_dormant uuid;
begin
  insert into public.customers (organization_id, name) values (v_org_a, 'Employee Created');
  if not exists (select 1 from public.customers where id = v_cust) then
    raise exception 'FAIL: employee cannot read Customer A';
  end if;
  update public.customers set notes = 'Edited by employee' where id = v_cust;
  if (select notes from public.customers where id = v_cust) is distinct from 'Edited by employee' then
    raise exception 'FAIL: employee cannot edit Customer A';
  end if;

  begin
    perform public.set_customer_status(v_cust, 'inactive');
    raise exception 'FAIL: employee deactivated Customer A';
  exception when insufficient_privilege then null;
  end;
  if (select status from public.customers where id = v_cust) <> 'active' then
    raise exception 'FAIL: employee changed Customer A status';
  end if;

  select id into v_dormant from public.customers where name = 'Dormant Buyer';
  begin
    perform public.set_customer_status(v_dormant, 'active');
    raise exception 'FAIL: employee reactivated a customer';
  exception when insufficient_privilege then null;
  end;
  if (select status from public.customers where id = v_dormant) <> 'inactive' then
    raise exception 'FAIL: employee changed Dormant Buyer status';
  end if;
end $$;

reset role;

-- -----------------------------------------------------------------------------
-- Disabled member D of Organization A: no access at all
-- -----------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"c0000000-0000-4000-8000-00000000000d","role":"authenticated"}', true);

do $$
declare
  v_org_a uuid := current_setting('test.org_a')::uuid;
  v_cust  uuid := current_setting('test.customer_a')::uuid;
  v_n     integer;
begin
  if exists (select 1 from public.customers) then
    raise exception 'FAIL: disabled member can read customers';
  end if;
  if exists (select 1 from public.list_customers(v_org_a)) then
    raise exception 'FAIL: disabled member can list customers';
  end if;
  if public.has_org_role(v_org_a, array['owner', 'manager', 'employee']) then
    raise exception 'FAIL: has_org_role is true for a disabled member';
  end if;
  begin
    insert into public.customers (organization_id, name) values (v_org_a, 'Disabled Created');
    raise exception 'FAIL: disabled member created a customer';
  exception when insufficient_privilege then null;
  end;
  update public.customers set name = 'Hacked' where id = v_cust;
  get diagnostics v_n = row_count;
  if v_n <> 0 then
    raise exception 'FAIL: disabled member updated a customer';
  end if;
  begin
    perform public.set_customer_status(v_cust, 'inactive');
    raise exception 'FAIL: disabled member changed customer status';
  exception when no_data_found then null;
  end;
end $$;

reset role;

-- -----------------------------------------------------------------------------
-- Owner B: own customers only. No way to reach Organization A's customers
-- -----------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"c0000000-0000-4000-8000-00000000000b","role":"authenticated"}', true);

do $$
declare
  v_org_a uuid := current_setting('test.org_a')::uuid;
  v_org_b uuid := current_setting('test.org_b')::uuid;
  v_cust  uuid := current_setting('test.customer_a')::uuid;
  v_n     integer;
  v_status      text;
  v_err_other   text;
  v_err_unknown text;
begin
  -- B's own customer, with a name that also matches A's search terms
  insert into public.customers (organization_id, name, email)
  values (v_org_b, 'Acme Rival', 'rival@acme.test');

  -- Read
  if exists (select 1 from public.customers where id = v_cust) then
    raise exception 'FAIL: user B can read Customer A';
  end if;
  if exists (select 1 from public.customers where organization_id = v_org_a) then
    raise exception 'FAIL: user B can read Organization A customers';
  end if;
  if (select count(*) from public.customers) <> 1 then
    raise exception 'FAIL: user B sees % customers, expected 1', (select count(*) from public.customers);
  end if;

  -- Update
  update public.customers set name = 'Hacked' where id = v_cust;
  get diagnostics v_n = row_count;
  if v_n <> 0 then
    raise exception 'FAIL: user B updated Customer A';
  end if;

  -- Deactivate / reactivate (not found, so existence is not revealed)
  begin
    perform public.set_customer_status(v_cust, 'inactive');
    raise exception 'FAIL: user B deactivated Customer A';
  exception when no_data_found then null;
  end;

  -- An other-tenant ID and an unknown ID fail identically (SQLSTATE and
  -- message), for both target statuses
  foreach v_status in array array['inactive', 'active'] loop
    begin
      perform public.set_customer_status(v_cust, v_status);
      raise exception 'FAIL: user B changed Customer A status';
    exception when others then
      v_err_other := sqlstate || ': ' || sqlerrm;
    end;
    begin
      perform public.set_customer_status(gen_random_uuid(), v_status);
      raise exception 'FAIL: unknown customer id did not raise';
    exception when others then
      v_err_unknown := sqlstate || ': ' || sqlerrm;
    end;
    if v_err_other is distinct from v_err_unknown or v_err_other <> 'P0002: customer not found' then
      raise exception 'FAIL: other-tenant (%) and unknown (%) customer IDs fail differently',
        v_err_other, v_err_unknown;
    end if;
  end loop;

  -- Authorization happens before any row lock: the function takes no
  -- explicit row lock (the authorized UPDATE takes it). The lock-wait side
  -- channel itself needs two sessions; see docs/testing/tenant-isolation.md.
  if pg_get_functiondef('public.set_customer_status(uuid, text)'::regprocedure)
       ~* 'for[[:space:]]+(no[[:space:]]+key[[:space:]]+)?(update|share)' then
    raise exception 'FAIL: set_customer_status takes an explicit row lock';
  end if;
  begin
    perform public.set_customer_status(v_cust, 'active');
    raise exception 'FAIL: user B reactivated Customer A';
  exception when no_data_found then null;
  end;

  -- Create under Organization A's ID
  begin
    insert into public.customers (organization_id, name) values (v_org_a, 'Planted by B');
    raise exception 'FAIL: user B created a customer in Organization A';
  exception when insufficient_privilege then null;
  end;

  -- Delete
  begin
    delete from public.customers where id = v_cust;
    raise exception 'FAIL: user B deleted Customer A';
  exception when insufficient_privilege then null;
  end;

  -- list_customers with Organization A's ID: RLS returns nothing, for any
  -- search, status filter or page
  if exists (select 1 from public.list_customers(v_org_a)) then
    raise exception 'FAIL: user B listed Organization A customers';
  end if;
  if exists (select 1 from public.list_customers(v_org_a, 'Acme', 'active', 100, 0)) then
    raise exception 'FAIL: user B searched Organization A customers';
  end if;
  if exists (select 1 from public.list_customers(v_org_a, null, 'inactive', 100, 0)) then
    raise exception 'FAIL: user B filtered Organization A customers';
  end if;

  -- Own search: only B's customer, even with large pages and offsets
  if (select count(*) from public.list_customers(v_org_b, 'acme', null, 100, 0)) <> 1
     or exists (select 1 from public.list_customers(v_org_b, 'acme', null, 100, 0) where name <> 'Acme Rival') then
    raise exception 'FAIL: user B search returned rows outside Organization B';
  end if;
  if exists (select 1 from public.list_customers(v_org_b, null, null, 100000, 1)) then
    raise exception 'FAIL: pagination past the end returned rows';
  end if;
  if (select max(total_count) from public.list_customers(v_org_b, null, null, 100000, 0)) <> 1 then
    raise exception 'FAIL: total_count for user B is not 1';
  end if;
end $$;

reset role;

-- -----------------------------------------------------------------------------
-- Owner A: data is untouched; search, filter and pagination stay in Org A
-- -----------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"c0000000-0000-4000-8000-00000000000a","role":"authenticated"}', true);

do $$
declare
  v_org_a uuid := current_setting('test.org_a')::uuid;
  v_org_b uuid := current_setting('test.org_b')::uuid;
  v_cust  uuid := current_setting('test.customer_a')::uuid;
  v_total bigint;
begin
  if (select name from public.customers where id = v_cust) is distinct from 'Acme Buyer'
     or (select status from public.customers where id = v_cust) <> 'active' then
    raise exception 'FAIL: Customer A was modified by another tenant';
  end if;
  if exists (select 1 from public.customers where organization_id = v_org_b) then
    raise exception 'FAIL: user A can read Organization B customers';
  end if;
  if exists (select 1 from public.list_customers(v_org_b)) then
    raise exception 'FAIL: user A listed Organization B customers';
  end if;
  if exists (select 1 from public.customers where name = 'Planted by B') then
    raise exception 'FAIL: a customer planted by user B exists in Organization A';
  end if;

  -- Org A has: Acme Buyer, 100% Cotton, Under_Score, Dormant Buyer (inactive),
  -- Manager Created, Employee Created
  select max(total_count) into v_total from public.list_customers(v_org_a);
  if v_total <> 6 then
    raise exception 'FAIL: expected 6 customers in Org A, got %', v_total;
  end if;

  -- Search by name, company, email and phone; never returns Org B's "Acme Rival"
  if exists (select 1 from public.list_customers(v_org_a, 'acme', null, 100, 0) where name = 'Acme Rival') then
    raise exception 'FAIL: search crossed into Organization B';
  end if;
  if (select count(*) from public.list_customers(v_org_a, 'ACME', null, 100, 0)) <> 2 then
    raise exception 'FAIL: case-insensitive search by name/email did not return 2 rows';
  end if;
  if (select count(*) from public.list_customers(v_org_a, 'buyer@acme', null, 100, 0)) <> 1 then
    raise exception 'FAIL: search by email failed';
  end if;
  if (select count(*) from public.list_customers(v_org_a, '1711-000', null, 100, 0)) <> 1 then
    raise exception 'FAIL: search by formatted phone failed';
  end if;
  -- Digits typed without formatting still match "+880 1711-000000"
  if (select count(*) from public.list_customers(v_org_a, '01711000000', null, 100, 0)) <> 1 then
    raise exception 'FAIL: search by phone digits failed';
  end if;

  -- The search is trimmed with the shared whitespace set (DECISIONS 014,
  -- migration 20261104060000_align_customer_search_trim.sql), not btrim()
  if (select count(*) from public.list_customers(v_org_a, E' ACME　', null, 100, 0)) <> 2 then
    raise exception 'FAIL: search padded with U+00A0 / U+3000 is not trimmed';
  end if;
  if (select count(*) from public.list_customers(v_org_a, E' buyer@acme﻿', null, 100, 0)) <> 1 then
    raise exception 'FAIL: search padded with U+2003 / U+FEFF is not trimmed';
  end if;
  if (select count(*) from public.list_customers(v_org_a, E'\u008501711000000 ', null, 100, 0)) <> 1 then
    raise exception 'FAIL: padded phone-digit search is not trimmed';
  end if;
  if (select coalesce(max(total_count), 0) from public.list_customers(v_org_a, E' 　', null, 100, 0)) <> 6 then
    raise exception 'FAIL: a whitespace-only search does not list everything';
  end if;

  -- LIKE wildcards are literal
  if (select count(*) from public.list_customers(v_org_a, '%', null, 100, 0)) <> 1 then
    raise exception 'FAIL: %% in search is treated as a wildcard';
  end if;
  if (select count(*) from public.list_customers(v_org_a, '_', null, 100, 0)) <> 1 then
    raise exception 'FAIL: _ in search is treated as a wildcard';
  end if;

  -- Status filter
  if (select count(*) from public.list_customers(v_org_a, null, 'inactive', 100, 0)) <> 1 then
    raise exception 'FAIL: inactive filter did not return exactly Dormant Buyer';
  end if;
  if (select count(*) from public.list_customers(v_org_a, null, 'active', 100, 0)) <> 5 then
    raise exception 'FAIL: active filter did not return 5 rows';
  end if;
  if (select count(*) from public.list_customers(v_org_a, 'buyer', 'active', 100, 0)) <> 1 then
    raise exception 'FAIL: search combined with status filter failed';
  end if;

  -- Pagination: pages are disjoint, total_count is stable, limit is clamped
  if (select count(*) from public.list_customers(v_org_a, null, null, 4, 0)) <> 4
     or (select count(*) from public.list_customers(v_org_a, null, null, 4, 4)) <> 2 then
    raise exception 'FAIL: pagination returned wrong page sizes';
  end if;
  if exists (
    select id from public.list_customers(v_org_a, null, null, 4, 0)
    intersect
    select id from public.list_customers(v_org_a, null, null, 4, 4)
  ) then
    raise exception 'FAIL: pages overlap';
  end if;
  if (select max(total_count) from public.list_customers(v_org_a, null, null, 4, 4)) <> 6 then
    raise exception 'FAIL: total_count changes between pages';
  end if;
  if (select count(*) from public.list_customers(v_org_a, null, null, 0, -5)) <> 1 then
    raise exception 'FAIL: limit/offset are not clamped';
  end if;
end $$;

reset role;

select 'ALL CUSTOMER CHECKS PASSED' as result;

rollback;
