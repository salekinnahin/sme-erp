-- =============================================================================
-- Vendors: tenant isolation, role permissions and data integrity.
--
-- How to run: paste this into the Supabase SQL Editor (it runs as `postgres`)
-- after applying the migrations up to 20261104050000_vendors.sql.
-- Everything runs in one transaction that is ROLLED BACK at the end, so no
-- data is left behind. Run it separately from tenant_isolation.sql and
-- customers.sql.
--
-- Same structure as customers.sql: vendors follow the same tenant-owned
-- module pattern (docs/DECISIONS.md 013, 014).
--
-- Like tenant_isolation.sql, it simulates real API users by switching to the
-- `authenticated` role and setting the JWT claims that auth.uid() reads.
--
-- Users
--   A  owner of Organization A        M  manager of Organization A
--   E  employee of Organization A     D  disabled member of Organization A
--   B  owner of Organization B
--
-- Success: the last result shows 'ALL VENDOR CHECKS PASSED'.
-- Failure: it stops with an error that starts with 'FAIL:'.
-- =============================================================================

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('e0000000-0000-4000-8000-00000000000a', 'vendors-test-a@example.com', '{"full_name":"Owner A"}'),
  ('e0000000-0000-4000-8000-00000000000b', 'vendors-test-b@example.com', '{"full_name":"Owner B"}'),
  ('e0000000-0000-4000-8000-00000000000c', 'vendors-test-m@example.com', '{"full_name":"Manager A"}'),
  ('e0000000-0000-4000-8000-00000000000d', 'vendors-test-d@example.com', '{"full_name":"Disabled A"}'),
  ('e0000000-0000-4000-8000-00000000000e', 'vendors-test-e@example.com', '{"full_name":"Employee A"}');

-- -----------------------------------------------------------------------------
-- Organizations A and B, created the same way the app does
-- -----------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"e0000000-0000-4000-8000-00000000000a","role":"authenticated"}', true);
select set_config('test.org_a', public.create_organization('Vendors Org A', 'BDT', 'Asia/Dhaka')::text, true);
reset role;

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"e0000000-0000-4000-8000-00000000000b","role":"authenticated"}', true);
select set_config('test.org_b', public.create_organization('Vendors Org B', 'USD', 'UTC')::text, true);
reset role;

-- Extra members of Organization A. There is no invitation flow yet, so the
-- fixture inserts them as postgres.
insert into public.organization_members (organization_id, user_id, role, status) values
  (current_setting('test.org_a')::uuid, 'e0000000-0000-4000-8000-00000000000c', 'manager',  'active'),
  (current_setting('test.org_a')::uuid, 'e0000000-0000-4000-8000-00000000000e', 'employee', 'active'),
  (current_setting('test.org_a')::uuid, 'e0000000-0000-4000-8000-00000000000d', 'employee', 'disabled');

-- -----------------------------------------------------------------------------
-- anon: no access
-- -----------------------------------------------------------------------------
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);

do $$ begin
  begin
    perform 1 from public.vendors;
    raise exception 'FAIL: anon could select vendors';
  exception when insufficient_privilege then null;
  end;
  begin
    perform * from public.list_vendors(current_setting('test.org_a')::uuid);
    raise exception 'FAIL: anon could call list_vendors';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.set_vendor_status(gen_random_uuid(), 'inactive');
    raise exception 'FAIL: anon could call set_vendor_status';
  exception when insufficient_privilege then null;
  end;
end $$;

reset role;

-- -----------------------------------------------------------------------------
-- Owner A: create, read, update, integrity rules, deactivate / reactivate
-- -----------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"e0000000-0000-4000-8000-00000000000a","role":"authenticated"}', true);

do $$
declare
  v_org_a uuid := current_setting('test.org_a')::uuid;
  v_org_b uuid := current_setting('test.org_b')::uuid;
  v_id    uuid;
  v_n     integer;
begin
  -- Create Vendor A
  insert into public.vendors (organization_id, name, company_name, phone, email, notes)
  values (v_org_a, 'Acme Buyer', 'Acme Ltd', '+880 1711-000000', 'buyer@acme.test', 'Line 1
Line 2')
  returning id into v_id;
  perform set_config('test.vendor_a', v_id::text, true);

  -- Read it back, with server-side defaults
  if not exists (
    select 1 from public.vendors
    where id = v_id
      and organization_id = v_org_a
      and status = 'active'
      and created_by = 'e0000000-0000-4000-8000-00000000000a'
  ) then
    raise exception 'FAIL: owner cannot read Vendor A, or defaults are wrong';
  end if;

  -- Update it
  update public.vendors set company_name = 'Acme Trading' where id = v_id;
  get diagnostics v_n = row_count;
  if v_n <> 1 or (select company_name from public.vendors where id = v_id) is distinct from 'Acme Trading' then
    raise exception 'FAIL: owner cannot update Vendor A';
  end if;
  update public.vendors set company_name = null where id = v_id;
  if (select company_name from public.vendors where id = v_id) is not null then
    raise exception 'FAIL: optional field could not be cleared';
  end if;

  -- Integrity: invalid values are rejected by CHECK constraints
  begin
    insert into public.vendors (organization_id, name) values (v_org_a, '');
    raise exception 'FAIL: empty name accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.vendors (organization_id, name) values (v_org_a, '  Padded  ');
    raise exception 'FAIL: untrimmed name accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.vendors (organization_id, name) values (v_org_a, repeat('x', 201));
    raise exception 'FAIL: over-long name accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.vendors (organization_id, name) values (v_org_a, null);
    raise exception 'FAIL: null name accepted';
  exception when not_null_violation then null;
  end;
  begin
    insert into public.vendors (organization_id, name, email) values (v_org_a, 'X', 'Upper@Example.com');
    raise exception 'FAIL: non-lowercase email accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.vendors (organization_id, name, email) values (v_org_a, 'X', 'not-an-email');
    raise exception 'FAIL: malformed email accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.vendors (organization_id, name, email) values (v_org_a, 'X', repeat('a', 315) || '@x.com');
    raise exception 'FAIL: over-long email accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.vendors (organization_id, name, phone) values (v_org_a, 'X', 'call me');
    raise exception 'FAIL: malformed phone accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.vendors (organization_id, name, phone) values (v_org_a, 'X', '12-34');
    raise exception 'FAIL: phone with fewer than 6 digits accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.vendors (organization_id, name, company_name) values (v_org_a, 'X', '');
    raise exception 'FAIL: empty-string company name accepted (must be NULL)';
  exception when check_violation then null;
  end;
  begin
    insert into public.vendors (organization_id, name, address) values (v_org_a, 'X', repeat('x', 501));
    raise exception 'FAIL: over-long address accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.vendors (organization_id, name, tax_number) values (v_org_a, 'X', repeat('x', 101));
    raise exception 'FAIL: over-long tax number accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.vendors (organization_id, name, notes) values (v_org_a, 'X', repeat('x', 2001));
    raise exception 'FAIL: over-long notes accepted';
  exception when check_violation then null;
  end;

  -- Unicode whitespace (DECISIONS 014): one explicit set, same as
  -- lib/validation/text.ts. U+00A0, U+0085 and U+2003 are whitespace.
  begin
    insert into public.vendors (organization_id, name) values (v_org_a, E' ');
    raise exception 'FAIL: NBSP-only name accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.vendors (organization_id, name) values (v_org_a, E' Acme');
    raise exception 'FAIL: name with leading NBSP accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.vendors (organization_id, name) values (v_org_a, E'Acme\u0085');
    raise exception 'FAIL: name with trailing U+0085 accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.vendors (organization_id, name) values (v_org_a, E' Acme');
    raise exception 'FAIL: name with leading U+2003 accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.vendors (organization_id, name) values (v_org_a, E'Acme\t');
    raise exception 'FAIL: name with trailing tab accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.vendors (organization_id, name, company_name) values (v_org_a, 'X', E' \u0085 ');
    raise exception 'FAIL: whitespace-only company name accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.vendors (organization_id, name, notes) values (v_org_a, 'X', E'Note\n');
    raise exception 'FAIL: notes with trailing newline accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.vendors (organization_id, name, email) values (v_org_a, 'X', E'buy er@acme.test');
    raise exception 'FAIL: email containing NBSP accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.vendors (organization_id, name, email) values (v_org_a, 'X', E'buyer@acme\u0085.test');
    raise exception 'FAIL: email containing U+0085 accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.vendors (organization_id, name, email) values (v_org_a, 'X', E'buyer@acme.test ');
    raise exception 'FAIL: email containing U+2003 accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.vendors (organization_id, name, phone) values (v_org_a, 'X', E' +880 1711-000000');
    raise exception 'FAIL: phone with leading NBSP accepted';
  exception when check_violation then null;
  end;
  -- Whitespace inside a value is fine. Accepted rows are rolled back (the
  -- U0001 sentinel) so the Org A counts below stay unchanged.
  begin
    insert into public.vendors (organization_id, name, notes)
    values (v_org_a, E'Inner Space Ltd', E'Line 1\u0085Line 2\nLine 3');
    raise exception 'rollback accepted rows' using errcode = 'U0001';
  exception when sqlstate 'U0001' then null;
  end;

  -- Helpers agree with lib/validation/text.ts
  if public.trim_whitespace(E' \t\n\r\u000b\u000c\u0085\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeffAcme\u2029\u2028 ') <> 'Acme' then
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

  -- U+2028 LINE SEPARATOR and U+2029 PARAGRAPH SEPARATOR are whitespace;
  -- U+200B is not. Written as escapes so editors cannot drop them
  -- (migration 20261104100000_restore_whitespace_line_separators.sql).
  if public.trim_whitespace(E'\u2028Acme\u2029') <> 'Acme'
     or public.trim_whitespace(E'\u2029Acme\u2028') <> 'Acme'
     or public.trim_whitespace(E'\u2028') <> ''
     or public.trim_whitespace(E'\u2029') <> ''
     or public.trim_whitespace(E'A\u2028B') <> E'A\u2028B'
     or public.trim_whitespace(E'\u200bAcme') <> E'\u200bAcme' then
    raise exception 'FAIL: trim_whitespace mishandles U+2028 / U+2029 / U+200B';
  end if;
  if public.text_is_trimmed(E'\u2028') or public.text_is_trimmed(E'\u2029')
     or public.text_is_trimmed(E'\u2028Acme') or public.text_is_trimmed(E'Acme\u2028')
     or public.text_is_trimmed(E'\u2029Acme') or public.text_is_trimmed(E'Acme\u2029')
     or not public.text_is_trimmed(E'A\u2028\u2029B')
     or not public.text_is_trimmed(E'\u200bAcme') then
    raise exception 'FAIL: text_is_trimmed mishandles U+2028 / U+2029 / U+200B';
  end if;
  if not public.text_has_whitespace(E'a\u2028b') or not public.text_has_whitespace(E'a\u2029b')
     or public.text_has_whitespace(E'a\u200bb') then
    raise exception 'FAIL: text_has_whitespace mishandles U+2028 / U+2029 / U+200B';
  end if;
  -- ... and the vendors constraints use them.
  begin
    insert into public.vendors (organization_id, name) values (v_org_a, E'\u2028');
    raise exception 'FAIL: U+2028-only vendor name accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.vendors (organization_id, name) values (v_org_a, E'\u2029');
    raise exception 'FAIL: U+2029-only vendor name accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.vendors (organization_id, name) values (v_org_a, E'\u2028Acme');
    raise exception 'FAIL: vendor name with leading U+2028 accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.vendors (organization_id, name) values (v_org_a, E'Acme\u2029');
    raise exception 'FAIL: vendor name with trailing U+2029 accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.vendors (organization_id, name, email) values (v_org_a, 'Acme', E'a\u2028b@acme.test');
    raise exception 'FAIL: vendor email with U+2028 accepted';
  exception when check_violation then null;
  end;

  -- Character length counts code points, like charLength() in the app.
  -- U+1F600 is one code point (two UTF-16 code units, four UTF-8 bytes).
  begin
    insert into public.vendors (organization_id, name, company_name, address, tax_number, notes)
    values (v_org_a, repeat(E'\U0001F600', 200), repeat(E'\U0001F600', 200),
            repeat(E'\U0001F600', 500), repeat(E'\U0001F600', 100), repeat(E'\U0001F600', 2000));
    insert into public.vendors (organization_id, name)
    values (v_org_a, repeat(E'গ', 200));   -- Bengali letter GA
    raise exception 'rollback accepted rows' using errcode = 'U0001';
  exception when sqlstate 'U0001' then null;
  end;
  begin
    insert into public.vendors (organization_id, name) values (v_org_a, repeat(E'\U0001F600', 201));
    raise exception 'FAIL: 201-emoji name accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.vendors (organization_id, name, notes) values (v_org_a, 'X', repeat(E'\U0001F600', 2001));
    raise exception 'FAIL: 2001-emoji notes accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.vendors (organization_id, name, company_name) values (v_org_a, 'X', repeat(E'\U0001F600', 201));
    raise exception 'FAIL: 201-emoji company name accepted';
  exception when check_violation then null;
  end;

  -- Protected columns cannot be written by clients
  begin
    insert into public.vendors (organization_id, name, status) values (v_org_a, 'X', 'inactive');
    raise exception 'FAIL: client set status on insert';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.vendors (organization_id, name, created_by)
    values (v_org_a, 'X', 'e0000000-0000-4000-8000-00000000000b');
    raise exception 'FAIL: client set created_by on insert';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.vendors set status = 'inactive' where id = v_id;
    raise exception 'FAIL: client updated status directly';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.vendors set organization_id = v_org_b where id = v_id;
    raise exception 'FAIL: client moved a vendor to another organization';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.vendors set created_by = null where id = v_id;
    raise exception 'FAIL: client changed created_by';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.vendors set created_at = now() - interval '1 day' where id = v_id;
    raise exception 'FAIL: client changed created_at';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.vendors where id = v_id;
    raise exception 'FAIL: client deleted a vendor';
  exception when insufficient_privilege then null;
  end;

  -- Deactivate / reactivate
  begin
    perform public.set_vendor_status(v_id, 'archived');
    raise exception 'FAIL: invalid status accepted';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.set_vendor_status(gen_random_uuid(), 'inactive');
    raise exception 'FAIL: unknown vendor id did not raise not-found';
  exception when no_data_found then null;
  end;
  perform public.set_vendor_status(v_id, 'inactive');
  if (select status from public.vendors where id = v_id) <> 'inactive' then
    raise exception 'FAIL: owner could not deactivate Vendor A';
  end if;
  perform public.set_vendor_status(v_id, 'inactive'); -- repeat is a no-op
  perform public.set_vendor_status(v_id, 'active');
  if (select status from public.vendors where id = v_id) <> 'active' then
    raise exception 'FAIL: owner could not reactivate Vendor A';
  end if;

  -- Search fixtures: LIKE wildcards in names, and an inactive vendor
  insert into public.vendors (organization_id, name) values (v_org_a, '100% Cotton');
  insert into public.vendors (organization_id, name) values (v_org_a, 'Under_Score');
  insert into public.vendors (organization_id, name, email)
  values (v_org_a, 'Dormant Buyer', 'dormant@acme.test')
  returning id into v_id;
  perform public.set_vendor_status(v_id, 'inactive');
end $$;

reset role;

-- -----------------------------------------------------------------------------
-- Manager M: create, edit, deactivate, reactivate
-- -----------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"e0000000-0000-4000-8000-00000000000c","role":"authenticated"}', true);

do $$
declare
  v_org_a uuid := current_setting('test.org_a')::uuid;
  v_vend  uuid := current_setting('test.vendor_a')::uuid;
  v_id    uuid;
begin
  insert into public.vendors (organization_id, name) values (v_org_a, 'Manager Created')
  returning id into v_id;
  if (select created_by from public.vendors where id = v_id) is distinct from 'e0000000-0000-4000-8000-00000000000c' then
    raise exception 'FAIL: created_by is not the manager';
  end if;
  update public.vendors set notes = 'Edited by manager' where id = v_vend;
  if (select notes from public.vendors where id = v_vend) is distinct from 'Edited by manager' then
    raise exception 'FAIL: manager cannot edit Vendor A';
  end if;
  perform public.set_vendor_status(v_vend, 'inactive');
  if (select status from public.vendors where id = v_vend) <> 'inactive' then
    raise exception 'FAIL: manager could not deactivate Vendor A';
  end if;
  perform public.set_vendor_status(v_vend, 'active');
  if (select status from public.vendors where id = v_vend) <> 'active' then
    raise exception 'FAIL: manager could not reactivate Vendor A';
  end if;
end $$;

reset role;

-- -----------------------------------------------------------------------------
-- Employee E: create, read, edit, but cannot deactivate or reactivate
-- -----------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"e0000000-0000-4000-8000-00000000000e","role":"authenticated"}', true);

do $$
declare
  v_org_a   uuid := current_setting('test.org_a')::uuid;
  v_vend    uuid := current_setting('test.vendor_a')::uuid;
  v_dormant uuid;
begin
  insert into public.vendors (organization_id, name) values (v_org_a, 'Employee Created');
  if not exists (select 1 from public.vendors where id = v_vend) then
    raise exception 'FAIL: employee cannot read Vendor A';
  end if;
  update public.vendors set notes = 'Edited by employee' where id = v_vend;
  if (select notes from public.vendors where id = v_vend) is distinct from 'Edited by employee' then
    raise exception 'FAIL: employee cannot edit Vendor A';
  end if;

  begin
    perform public.set_vendor_status(v_vend, 'inactive');
    raise exception 'FAIL: employee deactivated Vendor A';
  exception when insufficient_privilege then null;
  end;
  if (select status from public.vendors where id = v_vend) <> 'active' then
    raise exception 'FAIL: employee changed Vendor A status';
  end if;

  select id into v_dormant from public.vendors where name = 'Dormant Buyer';
  begin
    perform public.set_vendor_status(v_dormant, 'active');
    raise exception 'FAIL: employee reactivated a vendor';
  exception when insufficient_privilege then null;
  end;
  if (select status from public.vendors where id = v_dormant) <> 'inactive' then
    raise exception 'FAIL: employee changed Dormant Buyer status';
  end if;
end $$;

reset role;

-- -----------------------------------------------------------------------------
-- Disabled member D of Organization A: no access at all
-- -----------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"e0000000-0000-4000-8000-00000000000d","role":"authenticated"}', true);

do $$
declare
  v_org_a uuid := current_setting('test.org_a')::uuid;
  v_vend  uuid := current_setting('test.vendor_a')::uuid;
  v_n     integer;
begin
  if exists (select 1 from public.vendors) then
    raise exception 'FAIL: disabled member can read vendors';
  end if;
  if exists (select 1 from public.list_vendors(v_org_a)) then
    raise exception 'FAIL: disabled member can list vendors';
  end if;
  if public.has_org_role(v_org_a, array['owner', 'manager', 'employee']) then
    raise exception 'FAIL: has_org_role is true for a disabled member';
  end if;
  begin
    insert into public.vendors (organization_id, name) values (v_org_a, 'Disabled Created');
    raise exception 'FAIL: disabled member created a vendor';
  exception when insufficient_privilege then null;
  end;
  update public.vendors set name = 'Hacked' where id = v_vend;
  get diagnostics v_n = row_count;
  if v_n <> 0 then
    raise exception 'FAIL: disabled member updated a vendor';
  end if;
  begin
    perform public.set_vendor_status(v_vend, 'inactive');
    raise exception 'FAIL: disabled member changed vendor status';
  exception when no_data_found then null;
  end;
end $$;

reset role;

-- -----------------------------------------------------------------------------
-- Owner B: own vendors only. No way to reach Organization A's vendors
-- -----------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"e0000000-0000-4000-8000-00000000000b","role":"authenticated"}', true);

do $$
declare
  v_org_a uuid := current_setting('test.org_a')::uuid;
  v_org_b uuid := current_setting('test.org_b')::uuid;
  v_vend  uuid := current_setting('test.vendor_a')::uuid;
  v_n     integer;
  v_status      text;
  v_err_other   text;
  v_err_unknown text;
begin
  -- B's own vendor, with a name that also matches A's search terms
  insert into public.vendors (organization_id, name, email)
  values (v_org_b, 'Acme Rival', 'rival@acme.test');

  -- Read
  if exists (select 1 from public.vendors where id = v_vend) then
    raise exception 'FAIL: user B can read Vendor A';
  end if;
  if exists (select 1 from public.vendors where organization_id = v_org_a) then
    raise exception 'FAIL: user B can read Organization A vendors';
  end if;
  if (select count(*) from public.vendors) <> 1 then
    raise exception 'FAIL: user B sees % vendors, expected 1', (select count(*) from public.vendors);
  end if;

  -- Update
  update public.vendors set name = 'Hacked' where id = v_vend;
  get diagnostics v_n = row_count;
  if v_n <> 0 then
    raise exception 'FAIL: user B updated Vendor A';
  end if;

  -- Deactivate / reactivate (not found, so existence is not revealed)
  begin
    perform public.set_vendor_status(v_vend, 'inactive');
    raise exception 'FAIL: user B deactivated Vendor A';
  exception when no_data_found then null;
  end;

  -- An other-tenant ID and an unknown ID fail identically (SQLSTATE and
  -- message), for both target statuses
  foreach v_status in array array['inactive', 'active'] loop
    begin
      perform public.set_vendor_status(v_vend, v_status);
      raise exception 'FAIL: user B changed Vendor A status';
    exception when others then
      v_err_other := sqlstate || ': ' || sqlerrm;
    end;
    begin
      perform public.set_vendor_status(gen_random_uuid(), v_status);
      raise exception 'FAIL: unknown vendor id did not raise';
    exception when others then
      v_err_unknown := sqlstate || ': ' || sqlerrm;
    end;
    if v_err_other is distinct from v_err_unknown or v_err_other <> 'P0002: vendor not found' then
      raise exception 'FAIL: other-tenant (%) and unknown (%) vendor IDs fail differently',
        v_err_other, v_err_unknown;
    end if;
  end loop;

  -- Authorization happens before any row lock: the function takes no
  -- explicit row lock (the authorized UPDATE takes it). The lock-wait side
  -- channel itself needs two sessions; see docs/testing/tenant-isolation.md.
  if pg_get_functiondef('public.set_vendor_status(uuid, text)'::regprocedure)
       ~* 'for[[:space:]]+(no[[:space:]]+key[[:space:]]+)?(update|share)' then
    raise exception 'FAIL: set_vendor_status takes an explicit row lock';
  end if;
  begin
    perform public.set_vendor_status(v_vend, 'active');
    raise exception 'FAIL: user B reactivated Vendor A';
  exception when no_data_found then null;
  end;

  -- Create under Organization A's ID
  begin
    insert into public.vendors (organization_id, name) values (v_org_a, 'Planted by B');
    raise exception 'FAIL: user B created a vendor in Organization A';
  exception when insufficient_privilege then null;
  end;

  -- Delete
  begin
    delete from public.vendors where id = v_vend;
    raise exception 'FAIL: user B deleted Vendor A';
  exception when insufficient_privilege then null;
  end;

  -- list_vendors with Organization A's ID: RLS returns nothing, for any
  -- search, status filter or page
  if exists (select 1 from public.list_vendors(v_org_a)) then
    raise exception 'FAIL: user B listed Organization A vendors';
  end if;
  if exists (select 1 from public.list_vendors(v_org_a, 'Acme', 'active', 100, 0)) then
    raise exception 'FAIL: user B searched Organization A vendors';
  end if;
  if exists (select 1 from public.list_vendors(v_org_a, null, 'inactive', 100, 0)) then
    raise exception 'FAIL: user B filtered Organization A vendors';
  end if;

  -- Own search: only B's vendor, even with large pages and offsets
  if (select count(*) from public.list_vendors(v_org_b, 'acme', null, 100, 0)) <> 1
     or exists (select 1 from public.list_vendors(v_org_b, 'acme', null, 100, 0) where name <> 'Acme Rival') then
    raise exception 'FAIL: user B search returned rows outside Organization B';
  end if;
  if exists (select 1 from public.list_vendors(v_org_b, null, null, 100000, 1)) then
    raise exception 'FAIL: pagination past the end returned rows';
  end if;
  if (select max(total_count) from public.list_vendors(v_org_b, null, null, 100000, 0)) <> 1 then
    raise exception 'FAIL: total_count for user B is not 1';
  end if;
end $$;

reset role;

-- -----------------------------------------------------------------------------
-- Owner A: data is untouched; search, filter and pagination stay in Org A
-- -----------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"e0000000-0000-4000-8000-00000000000a","role":"authenticated"}', true);

do $$
declare
  v_org_a uuid := current_setting('test.org_a')::uuid;
  v_org_b uuid := current_setting('test.org_b')::uuid;
  v_vend  uuid := current_setting('test.vendor_a')::uuid;
  v_total bigint;
begin
  if (select name from public.vendors where id = v_vend) is distinct from 'Acme Buyer'
     or (select status from public.vendors where id = v_vend) <> 'active' then
    raise exception 'FAIL: Vendor A was modified by another tenant';
  end if;
  if exists (select 1 from public.vendors where organization_id = v_org_b) then
    raise exception 'FAIL: user A can read Organization B vendors';
  end if;
  if exists (select 1 from public.list_vendors(v_org_b)) then
    raise exception 'FAIL: user A listed Organization B vendors';
  end if;
  if exists (select 1 from public.vendors where name = 'Planted by B') then
    raise exception 'FAIL: a vendor planted by user B exists in Organization A';
  end if;

  -- Org A has: Acme Buyer, 100% Cotton, Under_Score, Dormant Buyer (inactive),
  -- Manager Created, Employee Created
  select max(total_count) into v_total from public.list_vendors(v_org_a);
  if v_total <> 6 then
    raise exception 'FAIL: expected 6 vendors in Org A, got %', v_total;
  end if;

  -- Search by name, company, email and phone; never returns Org B's "Acme Rival"
  if exists (select 1 from public.list_vendors(v_org_a, 'acme', null, 100, 0) where name = 'Acme Rival') then
    raise exception 'FAIL: search crossed into Organization B';
  end if;
  if (select count(*) from public.list_vendors(v_org_a, 'ACME', null, 100, 0)) <> 2 then
    raise exception 'FAIL: case-insensitive search by name/email did not return 2 rows';
  end if;
  if (select count(*) from public.list_vendors(v_org_a, 'buyer@acme', null, 100, 0)) <> 1 then
    raise exception 'FAIL: search by email failed';
  end if;
  if (select count(*) from public.list_vendors(v_org_a, '1711-000', null, 100, 0)) <> 1 then
    raise exception 'FAIL: search by formatted phone failed';
  end if;
  -- Digits typed without formatting still match "+880 1711-000000"
  if (select count(*) from public.list_vendors(v_org_a, '01711000000', null, 100, 0)) <> 1 then
    raise exception 'FAIL: search by phone digits failed';
  end if;

  -- LIKE wildcards are literal
  if (select count(*) from public.list_vendors(v_org_a, '%', null, 100, 0)) <> 1 then
    raise exception 'FAIL: %% in search is treated as a wildcard';
  end if;
  if (select count(*) from public.list_vendors(v_org_a, '_', null, 100, 0)) <> 1 then
    raise exception 'FAIL: _ in search is treated as a wildcard';
  end if;

  -- Status filter
  if (select count(*) from public.list_vendors(v_org_a, null, 'inactive', 100, 0)) <> 1 then
    raise exception 'FAIL: inactive filter did not return exactly Dormant Buyer';
  end if;
  if (select count(*) from public.list_vendors(v_org_a, null, 'active', 100, 0)) <> 5 then
    raise exception 'FAIL: active filter did not return 5 rows';
  end if;
  if (select count(*) from public.list_vendors(v_org_a, 'buyer', 'active', 100, 0)) <> 1 then
    raise exception 'FAIL: search combined with status filter failed';
  end if;

  -- Pagination: pages are disjoint, total_count is stable, limit is clamped
  if (select count(*) from public.list_vendors(v_org_a, null, null, 4, 0)) <> 4
     or (select count(*) from public.list_vendors(v_org_a, null, null, 4, 4)) <> 2 then
    raise exception 'FAIL: pagination returned wrong page sizes';
  end if;
  if exists (
    select id from public.list_vendors(v_org_a, null, null, 4, 0)
    intersect
    select id from public.list_vendors(v_org_a, null, null, 4, 4)
  ) then
    raise exception 'FAIL: pages overlap';
  end if;
  if (select max(total_count) from public.list_vendors(v_org_a, null, null, 4, 4)) <> 6 then
    raise exception 'FAIL: total_count changes between pages';
  end if;
  if (select count(*) from public.list_vendors(v_org_a, null, null, 0, -5)) <> 1 then
    raise exception 'FAIL: limit/offset are not clamped';
  end if;
end $$;

reset role;

-- -----------------------------------------------------------------------------
-- Vendor-specific checks
-- -----------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"e0000000-0000-4000-8000-00000000000a","role":"authenticated"}', true);

do $$
declare
  v_org_a uuid := current_setting('test.org_a')::uuid;
  v_vend  uuid := current_setting('test.vendor_a')::uuid;
  v_cust  uuid;
begin
  -- list_vendors trims the search with the shared whitespace set
  if (select count(*) from public.list_vendors(v_org_a, E'\u00a0ACME\u3000', null, 100, 0)) <> 2 then
    raise exception 'FAIL: list_vendors does not trim Unicode whitespace in the search';
  end if;
  if (select coalesce(max(total_count), 0) from public.list_vendors(v_org_a, E'\u00a0', null, 100, 0)) <> 6 then
    raise exception 'FAIL: a whitespace-only search does not list everything';
  end if;

  -- Vendors and customers are separate tables: neither leaks into the other
  insert into public.customers (organization_id, name) values (v_org_a, 'Acme Customer')
  returning id into v_cust;
  if exists (select 1 from public.list_vendors(v_org_a, 'Acme Customer', null, 100, 0)) then
    raise exception 'FAIL: a customer appears in list_vendors';
  end if;
  if exists (select 1 from public.customers where id = v_vend)
     or exists (select 1 from public.vendors where id = v_cust) then
    raise exception 'FAIL: vendor and customer rows are mixed';
  end if;
  begin
    perform public.set_vendor_status(v_cust, 'inactive');
    raise exception 'FAIL: set_vendor_status accepted a customer id';
  exception when no_data_found then null;
  end;
end $$;

reset role;

-- A member who is disabled later loses access at once. Manager M is active
-- above; disable the membership (as postgres, there is no UI for it yet).
update public.organization_members
set status = 'disabled'
where organization_id = current_setting('test.org_a')::uuid
  and user_id = 'e0000000-0000-4000-8000-00000000000c';

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"e0000000-0000-4000-8000-00000000000c","role":"authenticated"}', true);

do $$
declare
  v_org_a uuid := current_setting('test.org_a')::uuid;
  v_vend  uuid := current_setting('test.vendor_a')::uuid;
  v_n     integer;
begin
  if exists (select 1 from public.vendors) then
    raise exception 'FAIL: newly disabled manager can still read vendors';
  end if;
  if exists (select 1 from public.list_vendors(v_org_a)) then
    raise exception 'FAIL: newly disabled manager can still list vendors';
  end if;
  update public.vendors set notes = 'After disable' where id = v_vend;
  get diagnostics v_n = row_count;
  if v_n <> 0 then
    raise exception 'FAIL: newly disabled manager updated a vendor';
  end if;
  begin
    insert into public.vendors (organization_id, name) values (v_org_a, 'After disable');
    raise exception 'FAIL: newly disabled manager created a vendor';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.set_vendor_status(v_vend, 'inactive');
    raise exception 'FAIL: newly disabled manager changed vendor status';
  exception when no_data_found then null;
  end;
end $$;

reset role;

select 'ALL VENDOR CHECKS PASSED' as result;

rollback;
