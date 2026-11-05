-- =============================================================================
-- Quotations: creation, numbering, calculations, snapshots, status model,
-- immutability, role permissions and tenant isolation.
--
-- How to run: paste this into the Supabase SQL Editor (it runs as `postgres`)
-- after applying the migrations up to 20261104120000_list_quotations.sql.
-- Everything runs in one transaction that is ROLLED BACK at the end, so no
-- data is left behind. Run it separately from the other suites.
--
-- Same structure as products.sql. It simulates real API users by switching
-- to the `authenticated` role and setting the JWT claims that auth.uid()
-- reads. A few checks run as `postgres` on purpose: they prove that the
-- triggers hold even for a writer that bypasses privileges and RLS.
--
-- Users
--   A  owner of Organization A        M  manager of Organization A
--   E  employee of Organization A     D  disabled member of Organization A
--   B  owner of Organization B
--
-- Success: the last result shows 'ALL QUOTATION CHECKS PASSED'.
-- Failure: it stops with an error that starts with 'FAIL:'.
-- =============================================================================

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('c1000000-0000-4000-8000-00000000000a', 'quotations-test-a@example.com', '{"full_name":"Owner A"}'),
  ('c1000000-0000-4000-8000-00000000000b', 'quotations-test-b@example.com', '{"full_name":"Owner B"}'),
  ('c1000000-0000-4000-8000-00000000000c', 'quotations-test-m@example.com', '{"full_name":"Manager A"}'),
  ('c1000000-0000-4000-8000-00000000000d', 'quotations-test-d@example.com', '{"full_name":"Disabled A"}'),
  ('c1000000-0000-4000-8000-00000000000e', 'quotations-test-e@example.com', '{"full_name":"Employee A"}');

-- -----------------------------------------------------------------------------
-- Organizations A and B, created the same way the app does
-- -----------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"c1000000-0000-4000-8000-00000000000a","role":"authenticated"}', true);
select set_config('test.org_a', public.create_organization('Quotations Org A', 'BDT', 'Asia/Dhaka')::text, true);
reset role;

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"c1000000-0000-4000-8000-00000000000b","role":"authenticated"}', true);
select set_config('test.org_b', public.create_organization('Quotations Org B', 'USD', 'UTC')::text, true);
reset role;

insert into public.organization_members (organization_id, user_id, role, status) values
  (current_setting('test.org_a')::uuid, 'c1000000-0000-4000-8000-00000000000c', 'manager',  'active'),
  (current_setting('test.org_a')::uuid, 'c1000000-0000-4000-8000-00000000000e', 'employee', 'active'),
  (current_setting('test.org_a')::uuid, 'c1000000-0000-4000-8000-00000000000d', 'employee', 'disabled');

-- -----------------------------------------------------------------------------
-- Master data. Owner B first, then owner A.
-- -----------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"c1000000-0000-4000-8000-00000000000b","role":"authenticated"}', true);

do $$
declare
  v_id uuid;
begin
  insert into public.customers (organization_id, name)
  values (current_setting('test.org_b')::uuid, 'Customer B') returning id into v_id;
  perform set_config('test.cust_b', v_id::text, true);

  insert into public.products (organization_id, name, sku, product_type, unit, selling_price)
  values (current_setting('test.org_b')::uuid, 'Product B', 'B-1', 'inventory', 'pcs', 5)
  returning id into v_id;
  perform set_config('test.prod_b', v_id::text, true);
end $$;

reset role;

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"c1000000-0000-4000-8000-00000000000a","role":"authenticated"}', true);

do $$
declare
  v_org uuid := current_setting('test.org_a')::uuid;
  v_id  uuid;
begin
  insert into public.customers (organization_id, name, company_name, phone, email, address, tax_number)
  values (v_org, 'Acme Buyer', 'Acme Ltd', '+880 1711 000000', 'buyer@acme.test', 'Dhaka', 'BIN-1')
  returning id into v_id;
  perform set_config('test.cust_a', v_id::text, true);

  insert into public.customers (organization_id, name)
  values (v_org, 'Old Customer') returning id into v_id;
  perform set_config('test.cust_inactive', v_id::text, true);
  perform public.set_customer_status(v_id, 'inactive');

  insert into public.products (organization_id, name, sku, product_type, unit, description, selling_price)
  values (v_org, 'Laptop', 'LAP-1', 'inventory', 'pcs', 'Laptop desc', 100)
  returning id into v_id;
  perform set_config('test.prod_a', v_id::text, true);

  -- A service without a selling price.
  insert into public.products (organization_id, name, sku, product_type, unit)
  values (v_org, 'Setup', 'SRV-1', 'service', 'hour')
  returning id into v_id;
  perform set_config('test.prod_service', v_id::text, true);

  insert into public.products (organization_id, name, sku, product_type, unit, selling_price)
  values (v_org, 'Discontinued', 'OLD-1', 'inventory', 'pcs', 1)
  returning id into v_id;
  perform set_config('test.prod_inactive', v_id::text, true);
  perform public.set_product_status(v_id, 'inactive');
end $$;

reset role;

-- -----------------------------------------------------------------------------
-- anon: no access
-- -----------------------------------------------------------------------------
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);

do $$ begin
  begin
    perform 1 from public.quotations;
    raise exception 'FAIL: anon could select quotations';
  exception when insufficient_privilege then null;
  end;
  begin
    perform 1 from public.quotation_items;
    raise exception 'FAIL: anon could select quotation items';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.create_quotation(gen_random_uuid(), current_date, null, null, '[]'::jsonb);
    raise exception 'FAIL: anon could call create_quotation';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.update_quotation_draft(gen_random_uuid(), gen_random_uuid(), current_date, null, null, '[]'::jsonb);
    raise exception 'FAIL: anon could call update_quotation_draft';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.set_quotation_status(gen_random_uuid(), 'sent');
    raise exception 'FAIL: anon could call set_quotation_status';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.get_quotation(gen_random_uuid(), gen_random_uuid());
    raise exception 'FAIL: anon could call get_quotation';
  exception when insufficient_privilege then null;
  end;
end $$;

reset role;

-- -----------------------------------------------------------------------------
-- Function definitions: SECURITY DEFINER with a fixed search_path; internal
-- helpers not executable by API roles; no explicit lock in the status RPC.
-- -----------------------------------------------------------------------------
do $$
declare
  v_fn text;
begin
  foreach v_fn in array array[
    'public.create_quotation(uuid, date, date, text, jsonb)',
    'public.update_quotation_draft(uuid, uuid, date, date, text, jsonb)',
    'public.set_quotation_status(uuid, text)'
  ] loop
    if not exists (
      select 1 from pg_proc
      where oid = v_fn::regprocedure and prosecdef
        and proconfig @> array['search_path=""']
    ) then
      raise exception 'FAIL: % is not SECURITY DEFINER with search_path = ''''', v_fn;
    end if;
    if has_function_privilege('anon', v_fn, 'execute') then
      raise exception 'FAIL: anon can execute %', v_fn;
    end if;
    if not has_function_privilege('authenticated', v_fn, 'execute') then
      raise exception 'FAIL: authenticated cannot execute %', v_fn;
    end if;
  end loop;

  foreach v_fn in array array[
    'public.next_document_number(uuid, text)',
    'public.quotation_replace_items(uuid, uuid, jsonb)',
    'public.quotation_parse_decimal(jsonb, integer, integer)',
    'public.quotation_normalize_header(date, date, text)',
    'public.quotation_status_transition_allowed(text, text)',
    'public.quotations_enforce_rules()',
    'public.quotation_items_enforce_draft()'
  ] loop
    if has_function_privilege('authenticated', v_fn, 'execute')
       or has_function_privilege('anon', v_fn, 'execute') then
      raise exception 'FAIL: API roles can execute internal function %', v_fn;
    end if;
  end loop;

  -- get_quotation is a read: SECURITY INVOKER (RLS applies), fixed search_path,
  -- one SQL statement, authenticated only.
  if not exists (
    select 1 from pg_proc p join pg_language l on l.oid = p.prolang
    where p.oid = 'public.get_quotation(uuid, uuid)'::regprocedure
      and not p.prosecdef and l.lanname = 'sql' and p.provolatile = 's'
      and p.proconfig @> array['search_path=""']
  ) then
    raise exception 'FAIL: get_quotation is not a SECURITY INVOKER, STABLE SQL function with search_path = ''''';
  end if;
  if has_function_privilege('anon', 'public.get_quotation(uuid, uuid)', 'execute')
     or not has_function_privilege('authenticated', 'public.get_quotation(uuid, uuid)', 'execute') then
    raise exception 'FAIL: get_quotation grants wrong';
  end if;

  -- The status function locks only through the role-checked predicate.
  if pg_get_functiondef('public.set_quotation_status(uuid, text)'::regprocedure)
     !~* 'has_org_role\(q\.organization_id, v_roles\)\s+for update' then
    raise exception 'FAIL: set_quotation_status locks without the authorization predicate';
  end if;

  if has_table_privilege('authenticated', 'public.quotations', 'insert')
     or has_table_privilege('authenticated', 'public.quotations', 'update')
     or has_table_privilege('authenticated', 'public.quotations', 'delete')
     or has_table_privilege('authenticated', 'public.quotation_items', 'insert')
     or has_table_privilege('authenticated', 'public.quotation_items', 'update')
     or has_table_privilege('authenticated', 'public.quotation_items', 'delete')
     or has_any_column_privilege('authenticated', 'public.quotations', 'insert')
     or has_any_column_privilege('authenticated', 'public.quotations', 'update')
     or has_any_column_privilege('authenticated', 'public.quotation_items', 'insert')
     or has_any_column_privilege('authenticated', 'public.quotation_items', 'update')
     or has_table_privilege('authenticated', 'public.document_number_counters', 'select') then
    raise exception 'FAIL: authenticated has a write privilege on quotation tables or reads counters';
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- Owner A: creation, numbering, snapshots, totals
-- -----------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"c1000000-0000-4000-8000-00000000000a","role":"authenticated"}', true);

do $$
declare
  v_org     uuid := current_setting('test.org_a')::uuid;
  v_cust    uuid := current_setting('test.cust_a')::uuid;
  v_prod    uuid := current_setting('test.prod_a')::uuid;
  v_service uuid := current_setting('test.prod_service')::uuid;
  v_q       uuid;
  v_row     record;
  v_item    record;
begin
  -- Browser-style payload with forged snapshot and amount fields: all ignored.
  v_q := public.create_quotation(v_cust, date '2026-11-04', date '2026-12-04', E'  Thanks! ',
    jsonb_build_array(
      jsonb_build_object('product_id', v_prod, 'quantity', '2.5', 'discount_amount', '10.00',
                         'tax_rate', '15', 'product_name', 'FORGED', 'sku', 'FORGED',
                         'unit', 'kg', 'tax_amount', '0', 'line_total', '1'),
      jsonb_build_object('product_id', v_service, 'quantity', 3, 'unit_price', '33.33',
                         'tax_rate', 7.5, 'description', E'  Custom setup 　')));
  perform set_config('test.q1', v_q::text, true);

  select * into v_row from public.quotations where id = v_q;
  if v_row.quotation_number <> 'QT-000001' then
    raise exception 'FAIL: first number is %, expected QT-000001', v_row.quotation_number;
  end if;
  if v_row.organization_id <> v_org or v_row.status <> 'draft'
     or v_row.created_by <> 'c1000000-0000-4000-8000-00000000000a' then
    raise exception 'FAIL: organization, status or created_by not derived correctly';
  end if;
  if v_row.customer_name <> 'Acme Buyer' or v_row.customer_company_name <> 'Acme Ltd'
     or v_row.customer_phone <> '+880 1711 000000' or v_row.customer_email <> 'buyer@acme.test'
     or v_row.customer_address <> 'Dhaka' or v_row.customer_tax_number <> 'BIN-1' then
    raise exception 'FAIL: customer snapshot wrong';
  end if;
  if v_row.notes <> 'Thanks!' then
    raise exception 'FAIL: notes not trimmed with the shared whitespace set: %', v_row.notes;
  end if;
  -- 250.00 + 99.99; tax 36.00 + round(99.99 * 7.5%) = 7.50
  if v_row.subtotal::text <> '349.99' or v_row.discount_total::text <> '10.00'
     or v_row.tax_total::text <> '43.50' or v_row.grand_total::text <> '383.49' then
    raise exception 'FAIL: totals % % % %', v_row.subtotal, v_row.discount_total,
      v_row.tax_total, v_row.grand_total;
  end if;

  select * into v_item from public.quotation_items where quotation_id = v_q and sort_order = 1;
  if v_item.product_name <> 'Laptop' or v_item.sku <> 'LAP-1' or v_item.unit <> 'pcs'
     or v_item.description <> 'Laptop desc' or v_item.unit_price::text <> '100.00'
     or v_item.quantity::text <> '2.500' or v_item.tax_amount::text <> '36.00'
     or v_item.line_total::text <> '276.00' or v_item.organization_id <> v_org then
    raise exception 'FAIL: item 1 snapshot or amounts wrong: %', row_to_json(v_item);
  end if;

  select * into v_item from public.quotation_items where quotation_id = v_q and sort_order = 2;
  if v_item.product_name <> 'Setup' or v_item.unit <> 'hour'
     or v_item.description <> 'Custom setup' or v_item.unit_price::text <> '33.33'
     or v_item.tax_rate::text <> '7.50' or v_item.tax_amount::text <> '7.50'
     or v_item.line_total::text <> '107.49' then
    raise exception 'FAIL: item 2 override or amounts wrong: %', row_to_json(v_item);
  end if;

  -- Rounding (half up) and decimal quantities.
  v_q := public.create_quotation(v_cust, date '2026-11-04', null, null,
    jsonb_build_array(
      jsonb_build_object('product_id', v_prod, 'quantity', '1.005', 'unit_price', '1.00'),
      jsonb_build_object('product_id', v_prod, 'quantity', '1', 'unit_price', '10.00', 'tax_rate', '0.05'),
      jsonb_build_object('product_id', v_prod, 'quantity', '0.001', 'unit_price', '0.01'),
      jsonb_build_object('product_id', v_prod, 'quantity', '3', 'unit_price', '19.99',
                         'discount_amount', '0.97', 'tax_rate', '12.5', 'description', null),
      jsonb_build_object('product_id', v_prod, 'quantity', '1', 'unit_price', '5',
                         'discount_amount', '5')));
  perform set_config('test.q2', v_q::text, true);

  select * into v_row from public.quotations where id = v_q;
  if v_row.quotation_number <> 'QT-000002' then
    raise exception 'FAIL: second number is %', v_row.quotation_number;
  end if;
  if v_row.expiry_date is not null then
    raise exception 'FAIL: expiry date should be optional';
  end if;
  if (select string_agg(line_total::text, ',' order by sort_order)
      from public.quotation_items where quotation_id = v_q) <> '1.01,10.01,0.00,66.38,0.00' then
    raise exception 'FAIL: line rounding wrong: %', (select string_agg(line_total::text, ',' order by sort_order)
      from public.quotation_items where quotation_id = v_q);
  end if;
  if (select description from public.quotation_items where quotation_id = v_q and sort_order = 4) is not null then
    raise exception 'FAIL: explicit null description did not clear the product description';
  end if;
  if (select description from public.quotation_items where quotation_id = v_q and sort_order = 1) <> 'Laptop desc' then
    raise exception 'FAIL: missing description key did not use the product description';
  end if;
  -- subtotal 1.01 + 10.00 + 0.00 + 59.97 + 5.00; discount 0.97 + 5; tax 0.01 + 7.38
  if v_row.subtotal::text <> '75.98' or v_row.discount_total::text <> '5.97'
     or v_row.tax_total::text <> '7.39' or v_row.grand_total::text <> '77.40' then
    raise exception 'FAIL: rounding totals % % % %', v_row.subtotal, v_row.discount_total,
      v_row.tax_total, v_row.grand_total;
  end if;
  if v_row.grand_total <> (select sum(line_total) from public.quotation_items where quotation_id = v_q) then
    raise exception 'FAIL: grand total differs from the sum of line totals';
  end if;

  -- 100 items is the maximum and allowed.
  v_q := public.create_quotation(v_cust, date '2026-11-04', date '2026-11-04', null,
    (select jsonb_agg(jsonb_build_object('product_id', v_prod, 'quantity', '1'))
     from generate_series(1, 100)));
  if (select count(*) from public.quotation_items where quotation_id = v_q) <> 100
     or (select quotation_number from public.quotations where id = v_q) <> 'QT-000003'
     or (select grand_total::text from public.quotations where id = v_q) <> '10000.00' then
    raise exception 'FAIL: 100-item quotation';
  end if;

  -- 2000 code points of notes and description are accepted.
  v_q := public.create_quotation(v_cust, date '2026-11-04', null, repeat('😀', 2000),
    jsonb_build_array(jsonb_build_object('product_id', v_prod, 'quantity', '1',
                                         'description', repeat('😀', 2000))));
  perform set_config('test.q4', v_q::text, true);
end $$;

-- U+2028 / U+2029 are whitespace for notes and item descriptions
-- (migration 20261104100000_restore_whitespace_line_separators.sql).
do $$
declare
  v_q uuid;
begin
  v_q := public.create_quotation(current_setting('test.cust_a')::uuid, date '2026-11-04', null,
    E'\u2028Thanks\u2029',
    jsonb_build_array(
      jsonb_build_object('product_id', current_setting('test.prod_a')::uuid, 'quantity', '1',
                         'description', E'\u2029Custom\u2028'),
      jsonb_build_object('product_id', current_setting('test.prod_a')::uuid, 'quantity', '1',
                         'description', E'\u2028\u2029')));
  if (select notes from public.quotations where id = v_q) <> 'Thanks'
     or (select description from public.quotation_items where quotation_id = v_q and sort_order = 1) <> 'Custom'
     or (select description from public.quotation_items where quotation_id = v_q and sort_order = 2) is not null then
    raise exception 'FAIL: U+2028 / U+2029 not trimmed from notes or descriptions';
  end if;

  v_q := public.create_quotation(current_setting('test.cust_a')::uuid, date '2026-11-04', null,
    E'\u2028', jsonb_build_array(jsonb_build_object(
      'product_id', current_setting('test.prod_a')::uuid, 'quantity', '1')));
  if (select notes from public.quotations where id = v_q) is not null then
    raise exception 'FAIL: U+2028-only notes not treated as empty';
  end if;

  -- Inner line separators are kept.
  v_q := public.create_quotation(current_setting('test.cust_a')::uuid, date '2026-11-04', null,
    E'Line 1\u2028Line 2', jsonb_build_array(jsonb_build_object(
      'product_id', current_setting('test.prod_a')::uuid, 'quantity', '1')));
  if (select notes from public.quotations where id = v_q) <> E'Line 1\u2028Line 2' then
    raise exception 'FAIL: inner U+2028 removed from notes';
  end if;
end $$;

-- get_quotation: header and items in one statement, exact strings, ordered.
do $$
declare
  v_q    uuid := current_setting('test.q2')::uuid;
  v_doc  jsonb;
  v_row  record;
begin
  v_doc := public.get_quotation(current_setting('test.org_a')::uuid, v_q);
  select * into v_row from public.quotations where id = v_q;

  if v_doc is null then
    raise exception 'FAIL: get_quotation returned nothing for the owner';
  end if;
  if v_doc ->> 'id' <> v_q::text
     or v_doc ->> 'quotation_number' <> v_row.quotation_number
     or v_doc ->> 'customer_name' <> v_row.customer_name
     or v_doc ->> 'customer_email' <> v_row.customer_email
     or v_doc ->> 'status' <> 'draft'
     or v_doc ->> 'quotation_date' <> '2026-11-04'
     or v_doc -> 'expiry_date' <> 'null'::jsonb then
    raise exception 'FAIL: get_quotation header wrong: %', v_doc;
  end if;
  -- Money is JSON text, not a JSON number, and keeps its scale.
  if jsonb_typeof(v_doc -> 'grand_total') <> 'string'
     or v_doc ->> 'subtotal' <> '75.98' or v_doc ->> 'discount_total' <> '5.97'
     or v_doc ->> 'tax_total' <> '7.39' or v_doc ->> 'grand_total' <> '77.40' then
    raise exception 'FAIL: get_quotation totals not exact strings: %', v_doc;
  end if;
  if jsonb_array_length(v_doc -> 'items') <> 5
     or (select string_agg(e ->> 'line_total', ',' order by n)
         from jsonb_array_elements(v_doc -> 'items') with ordinality as t (e, n)) <> '1.01,10.01,0.00,66.38,0.00'
     or (select string_agg(e ->> 'sort_order', ',' order by n)
         from jsonb_array_elements(v_doc -> 'items') with ordinality as t (e, n)) <> '1,2,3,4,5'
     or v_doc -> 'items' -> 0 ->> 'quantity' <> '1.005'
     or v_doc -> 'items' -> 0 ->> 'unit_price' <> '1.00'
     or v_doc -> 'items' -> 1 ->> 'tax_rate' <> '0.05'
     or jsonb_typeof(v_doc -> 'items' -> 0 -> 'quantity') <> 'string'
     or v_doc -> 'items' -> 0 ->> 'product_name' <> 'Laptop'
     or v_doc -> 'items' -> 3 -> 'description' <> 'null'::jsonb then
    raise exception 'FAIL: get_quotation items wrong: %', v_doc -> 'items';
  end if;
  -- The document is internally consistent: items add up to the header.
  if (select sum((e ->> 'line_total')::numeric) from jsonb_array_elements(v_doc -> 'items') e)
     <> (v_doc ->> 'grand_total')::numeric then
    raise exception 'FAIL: get_quotation items do not add up to its header';
  end if;
  -- Same document as the tables, column for column.
  if (select jsonb_agg(jsonb_build_object('id', id, 'line_total', line_total::text) order by sort_order)
      from public.quotation_items where quotation_id = v_q)
     <> (select jsonb_agg(jsonb_build_object('id', e ->> 'id', 'line_total', e ->> 'line_total') order by n)
         from jsonb_array_elements(v_doc -> 'items') with ordinality as t (e, n)) then
    raise exception 'FAIL: get_quotation items differ from the table';
  end if;

  -- The organization filter never widens access: wrong organization, unknown
  -- ID and NULLs all return NULL.
  if public.get_quotation(current_setting('test.org_b')::uuid, v_q) is not null
     or public.get_quotation(current_setting('test.org_a')::uuid, gen_random_uuid()) is not null
     or public.get_quotation(null, v_q) is not null
     or public.get_quotation(current_setting('test.org_a')::uuid, null) is not null then
    raise exception 'FAIL: get_quotation returned a document for a wrong organization or ID';
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- Owner A: rejected input. Every failure rolls back its own numbering, so the
-- next successful create continues without a gap.
-- -----------------------------------------------------------------------------
do $$
declare
  v_cust  uuid := current_setting('test.cust_a')::uuid;
  v_prod  uuid := current_setting('test.prod_a')::uuid;
  v_case  record;
  v_q     uuid;
begin
  for v_case in
    select * from (values
      ('no items',               '[]'::jsonb, '22023'),
      ('items not an array',     '{}'::jsonb, '22023'),
      ('null items',             null::jsonb, '22023'),
      ('item not an object',     '[1]'::jsonb, '22023'),
      ('missing product',        '[{"quantity":"1"}]'::jsonb, '22023'),
      ('malformed product id',   '[{"product_id":"nope","quantity":"1"}]'::jsonb, '22023'),
      ('unknown product',        jsonb_build_array(jsonb_build_object('product_id', gen_random_uuid(), 'quantity', '1')), '23503'),
      ('zero quantity',          jsonb_build_array(jsonb_build_object('product_id', v_prod, 'quantity', '0')), '22023'),
      ('zero quantity 0.000',    jsonb_build_array(jsonb_build_object('product_id', v_prod, 'quantity', '0.000')), '22023'),
      ('negative quantity',      jsonb_build_array(jsonb_build_object('product_id', v_prod, 'quantity', '-1')), '22023'),
      ('negative number qty',    jsonb_build_array(jsonb_build_object('product_id', v_prod, 'quantity', -1)), '22023'),
      ('4-decimal quantity',     jsonb_build_array(jsonb_build_object('product_id', v_prod, 'quantity', '1.0001')), '22023'),
      ('text quantity',          jsonb_build_array(jsonb_build_object('product_id', v_prod, 'quantity', 'abc')), '22023'),
      ('NaN quantity',           jsonb_build_array(jsonb_build_object('product_id', v_prod, 'quantity', 'NaN')), '22023'),
      ('exponent quantity',      jsonb_build_array(jsonb_build_object('product_id', v_prod, 'quantity', '1e3')), '22023'),
      ('missing quantity',       jsonb_build_array(jsonb_build_object('product_id', v_prod)), '22023'),
      ('negative price',         jsonb_build_array(jsonb_build_object('product_id', v_prod, 'quantity', '1', 'unit_price', '-1')), '22023'),
      ('3-decimal price',        jsonb_build_array(jsonb_build_object('product_id', v_prod, 'quantity', '1', 'unit_price', '1.001')), '22023'),
      ('no price available',     jsonb_build_array(jsonb_build_object('product_id', current_setting('test.prod_service')::uuid, 'quantity', '1')), '22023'),
      ('tax over 100',           jsonb_build_array(jsonb_build_object('product_id', v_prod, 'quantity', '1', 'tax_rate', '100.01')), '22023'),
      ('tax 101',                jsonb_build_array(jsonb_build_object('product_id', v_prod, 'quantity', '1', 'tax_rate', 101)), '22023'),
      ('negative tax',           jsonb_build_array(jsonb_build_object('product_id', v_prod, 'quantity', '1', 'tax_rate', '-1')), '22023'),
      ('3-decimal tax',          jsonb_build_array(jsonb_build_object('product_id', v_prod, 'quantity', '1', 'tax_rate', '1.125')), '22023'),
      ('negative discount',      jsonb_build_array(jsonb_build_object('product_id', v_prod, 'quantity', '1', 'discount_amount', '-1')), '22023'),
      ('discount over gross',    jsonb_build_array(jsonb_build_object('product_id', v_prod, 'quantity', '2', 'unit_price', '5', 'discount_amount', '10.01')), '22023'),
      ('description too long',   jsonb_build_array(jsonb_build_object('product_id', v_prod, 'quantity', '1', 'description', repeat('😀', 2001))), '22023'),
      ('description not text',   jsonb_build_array(jsonb_build_object('product_id', v_prod, 'quantity', '1', 'description', 5)), '22023'),
      ('line total overflow',    jsonb_build_array(jsonb_build_object('product_id', v_prod, 'quantity', '999999999999999', 'unit_price', '9999999999999999.99')), '22003'),
      ('subtotal overflow',      jsonb_build_array(
                                   jsonb_build_object('product_id', v_prod, 'quantity', '1', 'unit_price', '9999999999999999.99'),
                                   jsonb_build_object('product_id', v_prod, 'quantity', '1', 'unit_price', '9999999999999999.99')), '22003'),
      ('inactive product',       jsonb_build_array(jsonb_build_object('product_id', current_setting('test.prod_inactive')::uuid, 'quantity', '1')), '23503'),
      ('other tenant product',   jsonb_build_array(jsonb_build_object('product_id', current_setting('test.prod_b')::uuid, 'quantity', '1')), '23503')
    ) as t (label, items, expected)
  loop
    begin
      perform public.create_quotation(v_cust, date '2026-11-04', null, null, v_case.items);
      raise exception 'FAIL: % accepted', v_case.label;
    exception when others then
      if sqlstate <> v_case.expected then
        raise exception 'FAIL: % raised % (%), expected %', v_case.label, sqlstate, sqlerrm, v_case.expected;
      end if;
    end;
  end loop;

  -- 101 items
  begin
    perform public.create_quotation(v_cust, date '2026-11-04', null, null,
      (select jsonb_agg(jsonb_build_object('product_id', v_prod, 'quantity', '1'))
       from generate_series(1, 101)));
    raise exception 'FAIL: 101 items accepted';
  exception when invalid_parameter_value then null;
  end;

  -- Header input
  begin
    perform public.create_quotation(v_cust, null, null, null,
      jsonb_build_array(jsonb_build_object('product_id', v_prod, 'quantity', '1')));
    raise exception 'FAIL: missing quotation date accepted';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.create_quotation(v_cust, 'infinity'::date, null, null,
      jsonb_build_array(jsonb_build_object('product_id', v_prod, 'quantity', '1')));
    raise exception 'FAIL: infinite quotation date accepted';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.create_quotation(v_cust, date '2026-11-04', date '2026-11-03', null,
      jsonb_build_array(jsonb_build_object('product_id', v_prod, 'quantity', '1')));
    raise exception 'FAIL: expiry before quotation date accepted';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.create_quotation(v_cust, date '2026-11-04', 'infinity'::date, null,
      jsonb_build_array(jsonb_build_object('product_id', v_prod, 'quantity', '1')));
    raise exception 'FAIL: infinite expiry date accepted';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.create_quotation(v_cust, date '2026-11-04', null, repeat('😀', 2001),
      jsonb_build_array(jsonb_build_object('product_id', v_prod, 'quantity', '1')));
    raise exception 'FAIL: 2001-code-point notes accepted';
  exception when invalid_parameter_value then null;
  end;

  -- Customers: inactive, unknown, other tenant
  begin
    perform public.create_quotation(current_setting('test.cust_inactive')::uuid, date '2026-11-04', null, null,
      jsonb_build_array(jsonb_build_object('product_id', v_prod, 'quantity', '1')));
    raise exception 'FAIL: inactive customer accepted';
  exception when foreign_key_violation then null;
  end;
  begin
    perform public.create_quotation(null, date '2026-11-04', null, null,
      jsonb_build_array(jsonb_build_object('product_id', v_prod, 'quantity', '1')));
    raise exception 'FAIL: null customer accepted';
  exception when foreign_key_violation then null;
  end;

  -- No gap: the failures above did not consume numbers.
  v_q := public.create_quotation(v_cust, date '2026-11-04', null, null,
    jsonb_build_array(jsonb_build_object('product_id', v_prod, 'quantity', '1')));
  if (select quotation_number from public.quotations where id = v_q) <> 'QT-000008' then
    raise exception 'FAIL: failed creates consumed numbers; got %',
      (select quotation_number from public.quotations where id = v_q);
  end if;
  perform set_config('test.q5', v_q::text, true);
end $$;

-- Unknown and other-tenant customers and products fail identically.
do $$
declare
  v_prod  uuid := current_setting('test.prod_a')::uuid;
  v_err1  text;
  v_err2  text;
  v_state1 text;
  v_state2 text;
begin
  begin
    perform public.create_quotation(current_setting('test.cust_b')::uuid, date '2026-11-04', null, null,
      jsonb_build_array(jsonb_build_object('product_id', v_prod, 'quantity', '1')));
    raise exception 'FAIL: other tenant customer accepted';
  exception when others then v_state1 := sqlstate; v_err1 := sqlerrm;
  end;
  begin
    perform public.create_quotation(gen_random_uuid(), date '2026-11-04', null, null,
      jsonb_build_array(jsonb_build_object('product_id', v_prod, 'quantity', '1')));
    raise exception 'FAIL: unknown customer accepted';
  exception when others then v_state2 := sqlstate; v_err2 := sqlerrm;
  end;
  if v_state1 <> '23503' or v_state1 <> v_state2 or v_err1 <> v_err2 then
    raise exception 'FAIL: other-tenant customer (% %) differs from unknown (% %)', v_state1, v_err1, v_state2, v_err2;
  end if;

  begin
    perform public.create_quotation(current_setting('test.cust_a')::uuid, date '2026-11-04', null, null,
      jsonb_build_array(jsonb_build_object('product_id', current_setting('test.prod_b')::uuid, 'quantity', '1')));
  exception when others then v_state1 := sqlstate; v_err1 := sqlerrm;
  end;
  begin
    perform public.create_quotation(current_setting('test.cust_a')::uuid, date '2026-11-04', null, null,
      jsonb_build_array(jsonb_build_object('product_id', gen_random_uuid(), 'quantity', '1')));
  exception when others then v_state2 := sqlstate; v_err2 := sqlerrm;
  end;
  if v_state1 <> '23503' or v_state1 <> v_state2 or v_err1 <> v_err2 then
    raise exception 'FAIL: other-tenant product (% %) differs from unknown (% %)', v_state1, v_err1, v_state2, v_err2;
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- Owner A: direct table writes are impossible (forged organization_id,
-- created_by, number, totals, status, items)
-- -----------------------------------------------------------------------------
do $$
declare
  v_q    uuid := current_setting('test.q1')::uuid;
  v_item uuid := (select id from public.quotation_items where quotation_id = current_setting('test.q1')::uuid limit 1);
begin
  begin
    insert into public.quotations (organization_id, quotation_number, customer_id, customer_name, quotation_date)
    values (current_setting('test.org_a')::uuid, 'QT-999999', current_setting('test.cust_a')::uuid, 'X', current_date);
    raise exception 'FAIL: direct quotation insert accepted';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.quotations set grand_total = 1 where id = v_q;
    raise exception 'FAIL: direct total update accepted';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.quotations set organization_id = current_setting('test.org_b')::uuid where id = v_q;
    raise exception 'FAIL: direct organization_id update accepted';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.quotations set quotation_number = 'QT-000099' where id = v_q;
    raise exception 'FAIL: direct number update accepted';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.quotations set created_by = 'c1000000-0000-4000-8000-00000000000b' where id = v_q;
    raise exception 'FAIL: direct created_by update accepted';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.quotations set status = 'accepted' where id = v_q;
    raise exception 'FAIL: direct status update accepted';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.quotations set notes = 'direct' where id = v_q;
    raise exception 'FAIL: direct notes update accepted';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.quotations where id = v_q;
    raise exception 'FAIL: direct quotation delete accepted';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.quotation_items (organization_id, quotation_id, product_id, product_name, sku, unit,
                                        quantity, unit_price, tax_amount, line_total, sort_order)
    values (current_setting('test.org_a')::uuid, v_q, current_setting('test.prod_a')::uuid, 'X', 'X', 'pcs',
            1, 1, 0, 1, 50);
    raise exception 'FAIL: direct item insert accepted';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.quotation_items set unit_price = 0 where id = v_item;
    raise exception 'FAIL: direct item update accepted';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.quotation_items where id = v_item;
    raise exception 'FAIL: direct item delete accepted';
  exception when insufficient_privilege then null;
  end;
  begin
    perform 1 from public.document_number_counters;
    raise exception 'FAIL: counters readable';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.next_document_number(current_setting('test.org_a')::uuid, 'quotation');
    raise exception 'FAIL: next_document_number callable';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.quotation_replace_items(v_q, current_setting('test.org_a')::uuid, '[]'::jsonb);
    raise exception 'FAIL: quotation_replace_items callable';
  exception when insufficient_privilege then null;
  end;
end $$;

-- -----------------------------------------------------------------------------
-- Snapshots survive master-data changes
-- -----------------------------------------------------------------------------
do $$
declare
  v_q uuid := current_setting('test.q1')::uuid;
begin
  update public.customers set name = 'Renamed Buyer', email = 'new@acme.test', address = 'Chittagong'
  where id = current_setting('test.cust_a')::uuid;
  update public.products set name = 'Renamed Laptop', sku = 'LAP-NEW', unit = 'box',
                             description = 'New desc', selling_price = 999
  where id = current_setting('test.prod_a')::uuid;

  if (select customer_name from public.quotations where id = v_q) <> 'Acme Buyer'
     or (select customer_email from public.quotations where id = v_q) <> 'buyer@acme.test'
     or (select customer_address from public.quotations where id = v_q) <> 'Dhaka' then
    raise exception 'FAIL: customer change altered the quotation snapshot';
  end if;
  if exists (
    select 1 from public.quotation_items
    where quotation_id = v_q and sort_order = 1
      and (product_name <> 'Laptop' or sku <> 'LAP-1' or unit <> 'pcs'
           or description <> 'Laptop desc' or unit_price <> 100)
  ) then
    raise exception 'FAIL: product change altered the item snapshot';
  end if;
  if (select grand_total::text from public.quotations where id = v_q) <> '383.49' then
    raise exception 'FAIL: product change altered totals';
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- Draft update: header + items replaced atomically, snapshots refreshed
-- -----------------------------------------------------------------------------
do $$
declare
  v_q    uuid := current_setting('test.q1')::uuid;
  v_row  record;
  v_before_items uuid[];
begin
  select array_agg(id order by sort_order) into v_before_items
  from public.quotation_items where quotation_id = v_q;

  perform public.update_quotation_draft(v_q, current_setting('test.cust_a')::uuid,
    date '2026-11-05', date '2026-11-30', null,
    jsonb_build_array(jsonb_build_object('product_id', current_setting('test.prod_a')::uuid,
                                         'quantity', '1', 'tax_rate', '10')));

  select * into v_row from public.quotations where id = v_q;
  if v_row.quotation_number <> 'QT-000001' or v_row.status <> 'draft'
     or v_row.created_by <> 'c1000000-0000-4000-8000-00000000000a'
     or v_row.quotation_date <> date '2026-11-05' or v_row.notes is not null then
    raise exception 'FAIL: draft update header wrong: %', row_to_json(v_row);
  end if;
  -- Re-snapshotted from the current (renamed) master data.
  if v_row.customer_name <> 'Renamed Buyer' or v_row.customer_email <> 'new@acme.test' then
    raise exception 'FAIL: draft update did not refresh the customer snapshot';
  end if;
  if (select count(*) from public.quotation_items where quotation_id = v_q) <> 1
     or exists (select 1 from public.quotation_items where id = any (v_before_items)) then
    raise exception 'FAIL: draft update did not replace the items';
  end if;
  if (select product_name || '|' || sku || '|' || unit || '|' || unit_price::text
      from public.quotation_items where quotation_id = v_q) <> 'Renamed Laptop|LAP-NEW|box|999.00' then
    raise exception 'FAIL: draft update did not refresh the product snapshot';
  end if;
  if v_row.subtotal::text <> '999.00' or v_row.tax_total::text <> '99.90'
     or v_row.grand_total::text <> '1098.90' then
    raise exception 'FAIL: draft update totals % % %', v_row.subtotal, v_row.tax_total, v_row.grand_total;
  end if;

  -- A failed update leaves the draft unchanged (atomic).
  begin
    perform public.update_quotation_draft(v_q, current_setting('test.cust_a')::uuid,
      date '2026-11-06', null, 'should not stick',
      jsonb_build_array(
        jsonb_build_object('product_id', current_setting('test.prod_a')::uuid, 'quantity', '2'),
        jsonb_build_object('product_id', current_setting('test.prod_a')::uuid, 'quantity', '0')));
    raise exception 'FAIL: update with a zero quantity accepted';
  exception when invalid_parameter_value then null;
  end;
  if (select notes from public.quotations where id = v_q) is not null
     or (select count(*) from public.quotation_items where quotation_id = v_q) <> 1 then
    raise exception 'FAIL: failed draft update was partially applied';
  end if;

  -- Customer rules on update
  begin
    perform public.update_quotation_draft(v_q, current_setting('test.cust_inactive')::uuid,
      date '2026-11-05', null, null,
      jsonb_build_array(jsonb_build_object('product_id', current_setting('test.prod_a')::uuid, 'quantity', '1')));
    raise exception 'FAIL: update to inactive customer accepted';
  exception when foreign_key_violation then null;
  end;
  begin
    perform public.update_quotation_draft(v_q, current_setting('test.cust_b')::uuid,
      date '2026-11-05', null, null,
      jsonb_build_array(jsonb_build_object('product_id', current_setting('test.prod_a')::uuid, 'quantity', '1')));
    raise exception 'FAIL: update to other-tenant customer accepted';
  exception when foreign_key_violation then null;
  end;
  begin
    perform public.update_quotation_draft(v_q, current_setting('test.cust_a')::uuid,
      date '2026-11-05', null, null,
      jsonb_build_array(jsonb_build_object('product_id', current_setting('test.prod_b')::uuid, 'quantity', '1')));
    raise exception 'FAIL: update with other-tenant product accepted';
  exception when foreign_key_violation then null;
  end;
  begin
    perform public.update_quotation_draft(v_q, current_setting('test.cust_a')::uuid,
      date '2026-11-05', null, null, '[]'::jsonb);
    raise exception 'FAIL: update with no items accepted';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.update_quotation_draft(gen_random_uuid(), current_setting('test.cust_a')::uuid,
      date '2026-11-05', null, null,
      jsonb_build_array(jsonb_build_object('product_id', current_setting('test.prod_a')::uuid, 'quantity', '1')));
    raise exception 'FAIL: update of unknown quotation accepted';
  exception when no_data_found then null;
  end;
end $$;

reset role;

-- -----------------------------------------------------------------------------
-- Employee: view, create, edit draft, mark sent; nothing else
-- -----------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"c1000000-0000-4000-8000-00000000000e","role":"authenticated"}', true);

do $$
declare
  v_q   uuid;
  v_s   text;
begin
  if not exists (select 1 from public.quotations where id = current_setting('test.q1')::uuid)
     or not exists (select 1 from public.quotation_items where quotation_id = current_setting('test.q1')::uuid) then
    raise exception 'FAIL: employee cannot read quotations';
  end if;
  if public.get_quotation(current_setting('test.org_a')::uuid, current_setting('test.q1')::uuid) is null then
    raise exception 'FAIL: employee cannot read a quotation through get_quotation';
  end if;

  v_q := public.create_quotation(current_setting('test.cust_a')::uuid, date '2026-11-04', null, null,
    jsonb_build_array(jsonb_build_object('product_id', current_setting('test.prod_a')::uuid, 'quantity', '1')));
  if (select created_by from public.quotations where id = v_q) <> 'c1000000-0000-4000-8000-00000000000e'
     or (select quotation_number from public.quotations where id = v_q) <> 'QT-000009' then
    raise exception 'FAIL: employee create: created_by or number wrong';
  end if;
  perform set_config('test.q_emp', v_q::text, true);

  perform public.update_quotation_draft(v_q, current_setting('test.cust_a')::uuid, date '2026-11-04', null, 'Edited',
    jsonb_build_array(jsonb_build_object('product_id', current_setting('test.prod_a')::uuid, 'quantity', '2')));
  if (select notes from public.quotations where id = v_q) <> 'Edited' then
    raise exception 'FAIL: employee cannot edit a draft';
  end if;

  -- Restricted transitions are refused before anything else, from draft ...
  foreach v_s in array array['cancelled', 'accepted', 'rejected', 'expired'] loop
    begin
      perform public.set_quotation_status(v_q, v_s);
      raise exception 'FAIL: employee set draft to %', v_s;
    exception when insufficient_privilege then null;
    end;
  end loop;

  perform public.set_quotation_status(v_q, 'sent');
  if (select status from public.quotations where id = v_q) <> 'sent' then
    raise exception 'FAIL: employee cannot mark sent';
  end if;

  -- ... and from sent.
  foreach v_s in array array['accepted', 'rejected', 'expired', 'cancelled'] loop
    begin
      perform public.set_quotation_status(v_q, v_s);
      raise exception 'FAIL: employee set sent to %', v_s;
    exception when insufficient_privilege then null;
    end;
  end loop;
  if (select status from public.quotations where id = v_q) <> 'sent' then
    raise exception 'FAIL: employee changed a sent quotation';
  end if;
end $$;

reset role;

-- -----------------------------------------------------------------------------
-- Owner and manager: status transitions
-- -----------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"c1000000-0000-4000-8000-00000000000c","role":"authenticated"}', true);

do $$
declare
  v_items jsonb := jsonb_build_array(jsonb_build_object(
    'product_id', current_setting('test.prod_a')::uuid, 'quantity', '1'));
  v_q     uuid;
  v_case  record;
  v_from  text;
  v_to    text;
begin
  -- Every allowed transition, by the manager.
  for v_case in
    select * from (values
      ('sent',      array['sent']),
      ('cancelled', array['cancelled']),
      ('accepted',  array['sent', 'accepted']),
      ('rejected',  array['sent', 'rejected']),
      ('expired',   array['sent', 'expired']),
      ('cancelled', array['sent', 'cancelled'])
    ) as t (final, steps)
  loop
    v_q := public.create_quotation(current_setting('test.cust_a')::uuid, date '2026-11-04', null, null, v_items);
    foreach v_to in array v_case.steps loop
      perform public.set_quotation_status(v_q, v_to);
    end loop;
    if (select status from public.quotations where id = v_q) <> v_case.final then
      raise exception 'FAIL: path % did not end in %', v_case.steps, v_case.final;
    end if;
    perform set_config('test.q_' || array_to_string(v_case.steps, '_'), v_q::text, true);
  end loop;

  -- Invalid transitions: from draft and from every terminal status.
  for v_case in
    select * from (values
      ('sent',               array['sent']),                                -- no repeat
      ('sent_accepted',      array['sent', 'accepted', 'rejected', 'expired', 'cancelled']),
      ('sent_rejected',      array['sent', 'accepted', 'rejected', 'expired', 'cancelled']),
      ('sent_expired',       array['sent', 'accepted', 'rejected', 'expired', 'cancelled']),
      ('sent_cancelled',     array['sent', 'accepted', 'rejected', 'expired', 'cancelled']),
      ('cancelled',          array['sent', 'accepted', 'rejected', 'expired', 'cancelled'])
    ) as t (key, targets)
  loop
    v_q := current_setting('test.q_' || v_case.key)::uuid;
    v_from := (select status from public.quotations where id = v_q);
    foreach v_to in array v_case.targets loop
      begin
        perform public.set_quotation_status(v_q, v_to);
        raise exception 'FAIL: % -> % accepted', v_from, v_to;
      exception when object_not_in_prerequisite_state then null;
      end;
    end loop;
  end loop;

  -- Draft -> accepted/rejected/expired directly is invalid.
  v_q := public.create_quotation(current_setting('test.cust_a')::uuid, date '2026-11-04', null, null, v_items);
  foreach v_to in array array['accepted', 'rejected', 'expired'] loop
    begin
      perform public.set_quotation_status(v_q, v_to);
      raise exception 'FAIL: draft -> % accepted', v_to;
    exception when object_not_in_prerequisite_state then null;
    end;
  end loop;

  -- Unknown statuses, and back to draft, are rejected outright.
  foreach v_to in array array['draft', 'bogus', 'SENT', ''] loop
    begin
      perform public.set_quotation_status(v_q, v_to);
      raise exception 'FAIL: status % accepted', v_to;
    exception when invalid_parameter_value then null;
    end;
  end loop;
  begin
    perform public.set_quotation_status(v_q, null);
    raise exception 'FAIL: null status accepted';
  exception when invalid_parameter_value then null;
  end;
  if (select status from public.quotations where id = v_q) <> 'draft' then
    raise exception 'FAIL: rejected transitions changed the status';
  end if;
end $$;

reset role;

-- -----------------------------------------------------------------------------
-- Immutability after sent
-- -----------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"c1000000-0000-4000-8000-00000000000a","role":"authenticated"}', true);

do $$
declare
  v_q uuid := current_setting('test.q1')::uuid;
begin
  perform public.set_quotation_status(v_q, 'sent');
  begin
    perform public.update_quotation_draft(v_q, current_setting('test.cust_a')::uuid,
      date '2026-11-05', null, 'late edit',
      jsonb_build_array(jsonb_build_object('product_id', current_setting('test.prod_a')::uuid, 'quantity', '9')));
    raise exception 'FAIL: sent quotation edited through update_quotation_draft';
  exception when object_not_in_prerequisite_state then null;
  end;
  -- Accepted / terminal quotations are not editable either.
  begin
    perform public.update_quotation_draft(current_setting('test.q_sent_accepted')::uuid,
      current_setting('test.cust_a')::uuid, date '2026-11-05', null, null,
      jsonb_build_array(jsonb_build_object('product_id', current_setting('test.prod_a')::uuid, 'quantity', '9')));
    raise exception 'FAIL: accepted quotation edited';
  exception when object_not_in_prerequisite_state then null;
  end;
end $$;

reset role;

-- The triggers hold even for a writer that bypasses privileges and RLS
-- (here: postgres). Each check runs in its own subtransaction.
do $$
declare
  v_q     uuid := current_setting('test.q1')::uuid;
  v_draft uuid := current_setting('test.q5')::uuid;
  v_item  uuid := (select id from public.quotation_items where quotation_id = current_setting('test.q1')::uuid limit 1);
  v_sql   text;
begin
  foreach v_sql in array array[
    format('update public.quotations set notes = %L where id = %L', 'x', v_q),
    format('update public.quotations set customer_name = %L where id = %L', 'x', v_q),
    format('update public.quotations set quotation_date = quotation_date + 1 where id = %L', v_q),
    format('update public.quotations set expiry_date = null where id = %L', v_q),
    format('update public.quotations set grand_total = grand_total + 1, subtotal = subtotal + 1 where id = %L', v_q),
    format('update public.quotations set customer_id = %L where id = %L', current_setting('test.cust_inactive'), v_q),
    format('update public.quotation_items set quantity = 9 where id = %L', v_item),
    format('update public.quotation_items set unit_price = 0, tax_amount = 0, line_total = 0, discount_amount = 0 where id = %L', v_item),
    format('update public.quotation_items set tax_rate = 0, tax_amount = 0, line_total = round(quantity * unit_price, 2) - discount_amount where id = %L', v_item),
    format('delete from public.quotation_items where id = %L', v_item),
    format('insert into public.quotation_items (organization_id, quotation_id, product_id, product_name, sku, unit,
              quantity, unit_price, tax_amount, line_total, sort_order)
            values (%L, %L, %L, %L, %L, %L, 1, 1, 0, 1, 50)',
           current_setting('test.org_a'), v_q, current_setting('test.prod_a'), 'X', 'X', 'pcs'),
    -- identity columns never change, not even on a draft
    format('update public.quotations set quotation_number = %L where id = %L', 'QT-999999', v_draft),
    format('update public.quotations set organization_id = %L where id = %L', current_setting('test.org_b'), v_draft),
    format('update public.quotations set created_by = %L where id = %L', 'c1000000-0000-4000-8000-00000000000b', v_draft),
    -- transitions are checked by the trigger too
    format('update public.quotations set status = %L where id = %L', 'draft', v_q),
    format('update public.quotations set status = %L where id = %L', 'accepted', v_draft)
  ] loop
    begin
      execute v_sql;
      raise exception 'FAIL: trigger allowed: %', v_sql;
    exception when object_not_in_prerequisite_state then null;
    end;
  end loop;

  -- Bookkeeping that must still work: created_by may become NULL (auth user
  -- deleted, ON DELETE SET NULL).
  update public.quotations set created_by = null where id = v_q;
end $$;

-- Integrity constraints hold for any writer (postgres here).
do $$
declare
  v_draft uuid := current_setting('test.q5')::uuid;
  v_item  uuid := (select id from public.quotation_items where quotation_id = current_setting('test.q5')::uuid limit 1);
begin
  begin
    update public.quotation_items set line_total = line_total + 1 where id = v_item;
    raise exception 'FAIL: inconsistent line total accepted';
  exception when check_violation then null;
  end;
  begin
    update public.quotation_items set tax_amount = tax_amount + 0.01, line_total = line_total + 0.01 where id = v_item;
    raise exception 'FAIL: inconsistent tax amount accepted';
  exception when check_violation then null;
  end;
  begin
    update public.quotation_items set quantity = 0 where id = v_item;
    raise exception 'FAIL: zero quantity accepted by the table';
  exception when check_violation then null;
  end;
  begin
    update public.quotation_items set tax_rate = 101 where id = v_item;
    raise exception 'FAIL: tax rate over 100 accepted by the table';
  exception when check_violation then null;
  end;
  begin
    update public.quotations set grand_total = grand_total + 1 where id = v_draft;
    raise exception 'FAIL: inconsistent grand total accepted';
  exception when check_violation then null;
  end;
  begin
    update public.quotation_items set product_id = current_setting('test.prod_b')::uuid where id = v_item;
    raise exception 'FAIL: item linked to another tenant''s product';
  exception when foreign_key_violation then null;
  end;
  begin
    update public.quotations set customer_id = current_setting('test.cust_b')::uuid where id = v_draft;
    raise exception 'FAIL: quotation linked to another tenant''s customer';
  exception when foreign_key_violation then null;
  end;
  begin
    insert into public.quotation_items (organization_id, quotation_id, product_id, product_name, sku, unit,
                                        quantity, unit_price, tax_amount, line_total, sort_order)
    values (current_setting('test.org_b')::uuid, v_draft, current_setting('test.prod_b')::uuid,
            'X', 'X', 'pcs', 1, 1, 0, 1, 50);
    raise exception 'FAIL: item of Organization B attached to a quotation of Organization A';
  exception when foreign_key_violation then null;
  end;
end $$;

-- -----------------------------------------------------------------------------
-- list_quotations (migration 20261104120000_list_quotations.sql)
-- -----------------------------------------------------------------------------

-- anon cannot call it; definition: SECURITY INVOKER, STABLE SQL, fixed
-- search_path, authenticated only.
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
do $$ begin
  begin
    perform public.list_quotations(current_setting('test.org_a')::uuid);
    raise exception 'FAIL: anon could call list_quotations';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

do $$
declare
  v_fn text := 'public.list_quotations(uuid, text, text, uuid, integer, integer)';
begin
  if not exists (
    select 1 from pg_proc p join pg_language l on l.oid = p.prolang
    where p.oid = v_fn::regprocedure
      and not p.prosecdef and l.lanname = 'sql' and p.provolatile = 's'
      and p.proconfig @> array['search_path=""']
  ) then
    raise exception 'FAIL: list_quotations is not a SECURITY INVOKER, STABLE SQL function with search_path = ''''';
  end if;
  if has_function_privilege('anon', v_fn, 'execute')
     or not has_function_privilege('authenticated', v_fn, 'execute') then
    raise exception 'FAIL: list_quotations grants wrong';
  end if;
end $$;

-- Owner A: ordering, search, filters, pagination.
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"c1000000-0000-4000-8000-00000000000a","role":"authenticated"}', true);

do $$
declare
  v_org      uuid := current_setting('test.org_a')::uuid;
  v_cust     uuid;
  v_q        uuid;
  v_ids      uuid[];
  v_expected uuid[];
  v_page1    uuid[];
  v_page2    uuid[];
  v_total    bigint;
  v_n        bigint;
  v_status   text;
  v_row      record;
begin
  -- A customer whose name contains LIKE wildcards.
  insert into public.customers (organization_id, name)
  values (v_org, 'Wild 100% Under_score') returning id into v_cust;
  v_q := public.create_quotation(v_cust, date '2026-11-05', null, null,
    jsonb_build_array(jsonb_build_object('product_id', current_setting('test.prod_a')::uuid, 'quantity', '1')));
  perform set_config('test.q_wild', v_q::text, true);

  -- No filters: every quotation of A, newest first, id as tie-breaker
  -- (all rows share created_at inside this transaction, so the tie-breaker
  -- decides the whole order).
  select array_agg(id order by created_at desc, id desc) into v_expected
  from public.quotations where organization_id = v_org;
  select array_agg(l.id order by l.ordinality), max(l.total_count) into v_ids, v_total
  from public.list_quotations(v_org, null, null, null, 100, 0) with ordinality as l;
  if v_ids is distinct from v_expected or v_total <> cardinality(v_expected) or v_total < 17 then
    raise exception 'FAIL: unfiltered list wrong: % rows, total %', cardinality(v_ids), v_total;
  end if;

  -- Row content: snapshot name, exact money text, dates.
  select * into v_row from public.list_quotations(v_org, 'under_score') l;
  if v_row.id <> v_q or v_row.customer_id <> v_cust
     or v_row.customer_name <> 'Wild 100% Under_score' or v_row.status <> 'draft'
     or v_row.quotation_date <> date '2026-11-05' or v_row.expiry_date is not null
     or v_row.grand_total <> '999.00' or pg_typeof(v_row.grand_total)::text <> 'text'
     or v_row.quotation_number <> (select quotation_number from public.quotations where id = v_q) then
    raise exception 'FAIL: list row wrong: %', row_to_json(v_row);
  end if;

  -- Search by number: substring, any case, Unicode-padded.
  if (select array_agg(id) from public.list_quotations(v_org, 'qt-000001'))
     is distinct from array[current_setting('test.q1')::uuid] then
    raise exception 'FAIL: number search qt-000001';
  end if;
  if (select array_agg(id) from public.list_quotations(v_org, E' 000008　'))
     is distinct from array[current_setting('test.q5')::uuid] then
    raise exception 'FAIL: padded number search 000008';
  end if;

  -- Search by customer name uses the snapshot: q2 was created as
  -- 'Acme Buyer'; the customer is now 'Renamed Buyer'.
  if not exists (select 1 from public.list_quotations(v_org, 'ACME', null, null, 100) where id = current_setting('test.q2')::uuid)
     or exists (select 1 from public.list_quotations(v_org, 'renamed', null, null, 100) where id = current_setting('test.q2')::uuid) then
    raise exception 'FAIL: customer search does not use the snapshot name';
  end if;
  select count(*) into v_n from public.quotations where organization_id = v_org and customer_name ilike '%acme%';
  if (select count(*) from public.list_quotations(v_org, 'acme', null, null, 100)) <> v_n
     or (select max(total_count) from public.list_quotations(v_org, 'acme', null, null, 100)) <> v_n then
    raise exception 'FAIL: customer search count';
  end if;

  -- Wildcards are literal; whitespace-only search lists everything.
  if (select array_agg(id) from public.list_quotations(v_org, '%')) is distinct from array[v_q]
     or (select array_agg(id) from public.list_quotations(v_org, '_')) is distinct from array[v_q]
     or exists (select 1 from public.list_quotations(v_org, '\'))
     or exists (select 1 from public.list_quotations(v_org, 'no such quotation')) then
    raise exception 'FAIL: wildcard or no-match search';
  end if;
  if (select max(total_count) from public.list_quotations(v_org, E'　')) <> cardinality(v_expected) then
    raise exception 'FAIL: whitespace-only search did not list everything';
  end if;

  -- Status filter, alone and with a search.
  foreach v_status in array array['draft', 'sent', 'accepted', 'rejected', 'expired', 'cancelled'] loop
    select count(*) into v_n from public.quotations where organization_id = v_org and status = v_status;
    if v_n = 0 then
      raise exception 'FAIL: test data has no % quotation', v_status;
    end if;
    if (select count(*) from public.list_quotations(v_org, null, v_status, null, 100)) <> v_n
       or exists (select 1 from public.list_quotations(v_org, null, v_status, null, 100) where status <> v_status) then
      raise exception 'FAIL: status filter %', v_status;
    end if;
  end loop;
  select count(*) into v_n from public.quotations
  where organization_id = v_org and status = 'draft' and customer_name ilike '%acme%';
  if (select count(*) from public.list_quotations(v_org, 'acme', 'draft', null, 100)) <> v_n then
    raise exception 'FAIL: search combined with status filter';
  end if;
  if exists (select 1 from public.list_quotations(v_org, null, 'bogus')) then
    raise exception 'FAIL: unknown status matched rows';
  end if;

  -- Customer filter: own customer, a customer without quotations, another
  -- tenant's customer.
  if (select array_agg(id) from public.list_quotations(v_org, null, null, v_cust)) is distinct from array[v_q]
     or exists (select 1 from public.list_quotations(v_org, null, null, current_setting('test.cust_inactive')::uuid))
     or exists (select 1 from public.list_quotations(v_org, null, null, current_setting('test.cust_b')::uuid))
     or exists (select 1 from public.list_quotations(v_org, null, 'sent', v_cust)) then
    raise exception 'FAIL: customer filter';
  end if;

  -- Pagination: disjoint, ordered pages; stable total; clamped limit/offset.
  select array_agg(l.id order by l.ordinality) into v_page1 from public.list_quotations(v_org, null, null, null, 5, 0) with ordinality as l;
  select array_agg(l.id order by l.ordinality) into v_page2 from public.list_quotations(v_org, null, null, null, 5, 5) with ordinality as l;
  if v_page1 || v_page2 is distinct from v_expected[1:10] then
    raise exception 'FAIL: pages are not consecutive slices of the ordered list';
  end if;
  if (select count(distinct total_count) from (
        select total_count from public.list_quotations(v_org, null, null, null, 5, 0)
        union all
        select total_count from public.list_quotations(v_org, null, null, null, 5, 5)) t) <> 1 then
    raise exception 'FAIL: total_count differs between pages';
  end if;
  if (select count(*) from public.list_quotations(v_org, null, null, null, 0, 0)) <> 1
     or (select count(*) from public.list_quotations(v_org, null, null, null, null, 0)) <> least(25, cardinality(v_expected))
     or (select array_agg(l.id order by l.ordinality) from public.list_quotations(v_org, null, null, null, 5, -10) with ordinality as l)
        is distinct from v_page1
     or exists (select 1 from public.list_quotations(v_org, null, null, null, 25, 100000)) then
    raise exception 'FAIL: limit/offset clamping';
  end if;

  -- The organization filter never widens access.
  if exists (select 1 from public.list_quotations(current_setting('test.org_b')::uuid))
     or exists (select 1 from public.list_quotations(null)) then
    raise exception 'FAIL: list_quotations returned rows for another or no organization';
  end if;
end $$;

reset role;

-- Employee: same list as the owner.
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"c1000000-0000-4000-8000-00000000000e","role":"authenticated"}', true);
do $$ begin
  if (select max(total_count) from public.list_quotations(current_setting('test.org_a')::uuid))
     <> (select count(*) from public.quotations where organization_id = current_setting('test.org_a')::uuid) then
    raise exception 'FAIL: employee list differs';
  end if;
end $$;
reset role;

-- -----------------------------------------------------------------------------
-- Owner B: tenant isolation
-- -----------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"c1000000-0000-4000-8000-00000000000b","role":"authenticated"}', true);

do $$
declare
  v_qa     uuid := current_setting('test.q5')::uuid;   -- Organization A draft
  v_q      uuid;
  v_s1     text;
  v_s2     text;
  v_e1     text;
  v_e2     text;
begin
  if exists (select 1 from public.quotations where organization_id = current_setting('test.org_a')::uuid)
     or exists (select 1 from public.quotation_items where organization_id = current_setting('test.org_a')::uuid) then
    raise exception 'FAIL: user B can read Organization A quotations or items';
  end if;
  -- get_quotation: RLS hides A's quotation whatever organization B passes.
  if public.get_quotation(current_setting('test.org_a')::uuid, v_qa) is not null
     or public.get_quotation(current_setting('test.org_b')::uuid, v_qa) is not null then
    raise exception 'FAIL: user B read Organization A quotation through get_quotation';
  end if;

  -- B's numbering is independent of A's.
  v_q := public.create_quotation(current_setting('test.cust_b')::uuid, date '2026-11-04', null, null,
    jsonb_build_array(jsonb_build_object('product_id', current_setting('test.prod_b')::uuid, 'quantity', '1')));
  if (select quotation_number from public.quotations where id = v_q) <> 'QT-000001' then
    raise exception 'FAIL: Organization B numbering is not separate';
  end if;

  -- B cannot use A's customer or product, even from B's own quotation.
  begin
    perform public.create_quotation(current_setting('test.cust_a')::uuid, date '2026-11-04', null, null,
      jsonb_build_array(jsonb_build_object('product_id', current_setting('test.prod_b')::uuid, 'quantity', '1')));
    raise exception 'FAIL: user B used Organization A customer';
  exception when foreign_key_violation then null;
  end;
  begin
    perform public.update_quotation_draft(v_q, current_setting('test.cust_b')::uuid, date '2026-11-04', null, null,
      jsonb_build_array(jsonb_build_object('product_id', current_setting('test.prod_a')::uuid, 'quantity', '1')));
    raise exception 'FAIL: user B used Organization A product';
  exception when foreign_key_violation then null;
  end;

  -- Update and status change of A's quotation fail exactly like unknown IDs.
  begin
    perform public.update_quotation_draft(v_qa, current_setting('test.cust_b')::uuid, date '2026-11-04', null, null,
      jsonb_build_array(jsonb_build_object('product_id', current_setting('test.prod_b')::uuid, 'quantity', '1')));
    raise exception 'FAIL: user B updated Organization A quotation';
  exception when others then v_s1 := sqlstate; v_e1 := sqlerrm;
  end;
  begin
    perform public.update_quotation_draft(gen_random_uuid(), current_setting('test.cust_b')::uuid, date '2026-11-04', null, null,
      jsonb_build_array(jsonb_build_object('product_id', current_setting('test.prod_b')::uuid, 'quantity', '1')));
  exception when others then v_s2 := sqlstate; v_e2 := sqlerrm;
  end;
  if v_s1 <> 'P0002' or v_s1 <> v_s2 or v_e1 <> v_e2 then
    raise exception 'FAIL: other-tenant update (% %) differs from unknown (% %)', v_s1, v_e1, v_s2, v_e2;
  end if;

  foreach v_e2 in array array['sent', 'cancelled'] loop
    begin
      perform public.set_quotation_status(v_qa, v_e2);
      raise exception 'FAIL: user B changed Organization A quotation status';
    exception when others then v_s1 := sqlstate; v_e1 := sqlerrm;
    end;
    begin
      perform public.set_quotation_status(gen_random_uuid(), v_e2);
    exception when others then v_s2 := sqlstate;
      if v_s1 <> 'P0002' or v_s1 <> v_s2 or v_e1 <> sqlerrm then
        raise exception 'FAIL: other-tenant status change (% %) differs from unknown (% %)', v_s1, v_e1, v_s2, sqlerrm;
      end if;
    end;
  end loop;
end $$;

reset role;

do $$ begin
  if (select status from public.quotations where id = current_setting('test.q5')::uuid) <> 'draft'
     or (select notes from public.quotations where id = current_setting('test.q5')::uuid) is not null then
    raise exception 'FAIL: Organization A quotation changed by user B';
  end if;
end $$;

-- list_quotations as user B: nothing of A, whatever the filters; B's own list
-- holds only B's quotation.
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"c1000000-0000-4000-8000-00000000000b","role":"authenticated"}', true);
do $$ begin
  if exists (select 1 from public.list_quotations(current_setting('test.org_a')::uuid))
     or exists (select 1 from public.list_quotations(current_setting('test.org_a')::uuid, 'QT'))
     or exists (select 1 from public.list_quotations(current_setting('test.org_a')::uuid, null, 'draft'))
     or exists (select 1 from public.list_quotations(current_setting('test.org_a')::uuid, null, null,
                                                     current_setting('test.cust_a')::uuid)) then
    raise exception 'FAIL: user B listed Organization A quotations';
  end if;
  if exists (select 1 from public.list_quotations(current_setting('test.org_b')::uuid, null, null,
                                                  current_setting('test.cust_a')::uuid))
     or (select count(*) from public.list_quotations(current_setting('test.org_b')::uuid)) <> 1
     or exists (select 1 from public.list_quotations(current_setting('test.org_b')::uuid) l
                where l.customer_id <> current_setting('test.cust_b')::uuid) then
    raise exception 'FAIL: user B list wrong';
  end if;
end $$;
reset role;

-- -----------------------------------------------------------------------------
-- Quotation form selectors (lib/quotations/options.ts). The form searches
-- with the existing list_customers() / list_products() RPCs, active only,
-- 25 per search, instead of loading a capped list of 500. No new database
-- function: these checks pin down the behavior the selectors rely on.
-- -----------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"c1000000-0000-4000-8000-00000000000a","role":"authenticated"}', true);

do $$
declare
  v_org uuid := current_setting('test.org_a')::uuid;
  v_id  uuid;
begin
  -- More than the old 500 cap; the targets sort after every bulk row by name.
  insert into public.customers (organization_id, name)
  select v_org, 'Bulk Customer ' || lpad(n::text, 4, '0') from generate_series(1, 520) n;
  insert into public.customers (organization_id, name, company_name, phone, email)
  values (v_org, 'Zulu Late Buyer', 'Zulu Trading', '+880 1999 123456', 'zulu@late.test')
  returning id into v_id;
  perform set_config('test.cust_late', v_id::text, true);
  insert into public.customers (organization_id, name) values
    (v_org, 'Pct 7% Co'), (v_org, 'Pct 70 Co'), (v_org, 'Sel_ector Co'), (v_org, 'SelXector Co');

  insert into public.products (organization_id, name, sku, product_type, unit, selling_price)
  select v_org, 'Bulk Product ' || lpad(n::text, 4, '0'), 'BULK-' || n, 'inventory', 'pcs', 1
  from generate_series(1, 520) n;
  insert into public.products (organization_id, name, sku, product_type, unit, description, selling_price)
  values (v_org, 'Zulu Gadget', 'ZG-777', 'inventory', 'pcs', 'Late desc', 12.5)
  returning id into v_id;
  perform set_config('test.prod_late', v_id::text, true);
  insert into public.products (organization_id, name, sku, product_type, unit, selling_price) values
    (v_org, 'Wild One', 'W%1', 'inventory', 'pcs', 1), (v_org, 'Wild Two', 'WX1', 'inventory', 'pcs', 1),
    (v_org, 'Wild Three', 'W_2', 'inventory', 'pcs', 1), (v_org, 'Wild Four', 'WY2', 'inventory', 'pcs', 1);
end $$;

do $$
declare
  v_org  uuid := current_setting('test.org_a')::uuid;
  v_ids  uuid[];
begin
  -- Customers: a record beyond the old first-500 set is found by name,
  -- company, phone digits and email; whitespace is trimmed (Unicode set).
  if (select array_agg(id) from public.list_customers(v_org, 'Zulu Late', 'active', 25, 0))
       <> array[current_setting('test.cust_late')::uuid]
     or (select count(*) from public.list_customers(v_org, 'zulu trading', 'active', 25, 0)) <> 1
     or (select count(*) from public.list_customers(v_org, '01999-123', 'active', 25, 0)) <> 1
     or (select count(*) from public.list_customers(v_org, 'ZULU@LATE', 'active', 25, 0)) <> 1
     or (select count(*) from public.list_customers(v_org, E'\u3000Zulu Late\u2028', 'active', 25, 0)) <> 1 then
    raise exception 'FAIL: customer selector search beyond 500 / matching / trimming';
  end if;
  -- Active only: the inactive customer is not offered, though it exists.
  if exists (select 1 from public.list_customers(v_org, 'Old Customer', 'active', 25, 0))
     or not exists (select 1 from public.list_customers(v_org, 'Old Customer', null, 25, 0)) then
    raise exception 'FAIL: customer selector search not active-only';
  end if;
  -- Bounded: 25 rows, total_count tells the form that more match.
  if (select count(*) from public.list_customers(v_org, 'Bulk Customer', 'active', 25, 0)) <> 25
     or (select max(total_count) from public.list_customers(v_org, 'Bulk Customer', 'active', 25, 0)) <> 520
     or (select count(*) from public.list_customers(v_org, null, 'active', 25, 0)) <> 25
     or (select count(*) from public.list_customers(v_org, 'Bulk', 'active', 1000, 0)) <> 100 then
    raise exception 'FAIL: customer selector search not bounded';
  end if;
  -- Deterministic: the same search returns the same rows in the same order.
  select array_agg(id) into v_ids from public.list_customers(v_org, 'Bulk Customer', 'active', 25, 0);
  if v_ids <> (select array_agg(id) from public.list_customers(v_org, 'Bulk Customer', 'active', 25, 0)) then
    raise exception 'FAIL: customer selector search order not deterministic';
  end if;
  -- % and _ match literally.
  if (select string_agg(name, ',') from public.list_customers(v_org, '7%', 'active', 25, 0)) <> 'Pct 7% Co'
     or (select string_agg(name, ',') from public.list_customers(v_org, 'Sel_', 'active', 25, 0)) <> 'Sel_ector Co' then
    raise exception 'FAIL: customer selector search wildcards not literal';
  end if;
  -- Another tenant: nothing, whatever organization or term is passed.
  if exists (select 1 from public.list_customers(current_setting('test.org_b')::uuid, null, 'active', 25, 0))
     or exists (select 1 from public.list_customers(v_org, 'Customer B', 'active', 25, 0)) then
    raise exception 'FAIL: customer selector search crossed tenants';
  end if;

  -- Products: beyond 500 by name and by SKU; trimmed; active only; bounded.
  if (select array_agg(id) from public.list_products(v_org, 'Zulu Gadget', 'active', null, null, 25, 0))
       <> array[current_setting('test.prod_late')::uuid]
     or (select array_agg(id) from public.list_products(v_org, 'zg-777', 'active', null, null, 25, 0))
       <> array[current_setting('test.prod_late')::uuid]
     or (select count(*) from public.list_products(v_org, E'\u3000ZG-777\u2029', 'active', null, null, 25, 0)) <> 1 then
    raise exception 'FAIL: product selector search beyond 500 / name / SKU / trimming';
  end if;
  if exists (select 1 from public.list_products(v_org, 'Discontinued', 'active', null, null, 25, 0))
     or not exists (select 1 from public.list_products(v_org, 'Discontinued', null, null, null, 25, 0)) then
    raise exception 'FAIL: product selector search not active-only';
  end if;
  if (select count(*) from public.list_products(v_org, 'Bulk Product', 'active', null, null, 25, 0)) <> 25
     or (select max(total_count) from public.list_products(v_org, 'BULK-', 'active', null, null, 25, 0)) <> 520 then
    raise exception 'FAIL: product selector search not bounded';
  end if;
  if (select string_agg(sku, ',') from public.list_products(v_org, 'W%', 'active', null, null, 25, 0)) <> 'W%1'
     or (select string_agg(sku, ',') from public.list_products(v_org, 'W_', 'active', null, null, 25, 0)) <> 'W_2' then
    raise exception 'FAIL: product selector search wildcards not literal';
  end if;
  if exists (select 1 from public.list_products(current_setting('test.org_b')::uuid, null, 'active', null, null, 25, 0))
     or exists (select 1 from public.list_products(v_org, 'B-1', 'active', null, null, 25, 0)) then
    raise exception 'FAIL: product selector search crossed tenants';
  end if;
  -- The detail read after the search (description for prefill): tenant
  -- and status filters, by ID. Another tenant's ID is simply not found.
  if (select description from public.products
      where organization_id = v_org and status = 'active'
        and id = current_setting('test.prod_late')::uuid) <> 'Late desc'
     or exists (select 1 from public.products
                where organization_id = v_org and status = 'active'
                  and id = current_setting('test.prod_b')::uuid) then
    raise exception 'FAIL: product selector detail read wrong';
  end if;

  -- Current references stay readable by ID whatever their status (edit form).
  if (select status from public.customers where organization_id = v_org
      and id = current_setting('test.cust_inactive')::uuid) <> 'inactive'
     or (select status from public.products where organization_id = v_org
      and id = current_setting('test.prod_inactive')::uuid) <> 'inactive' then
    raise exception 'FAIL: inactive current references not readable by ID';
  end if;
end $$;

reset role;

-- Owner B sees none of A's selector data, by search or by ID.
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"c1000000-0000-4000-8000-00000000000b","role":"authenticated"}', true);
do $$ begin
  if exists (select 1 from public.list_customers(current_setting('test.org_a')::uuid, 'Zulu', 'active', 25, 0))
     or exists (select 1 from public.list_customers(current_setting('test.org_b')::uuid, 'Zulu', 'active', 25, 0))
     or exists (select 1 from public.list_products(current_setting('test.org_a')::uuid, 'ZG-777', 'active', null, null, 25, 0))
     or exists (select 1 from public.list_products(current_setting('test.org_b')::uuid, 'ZG-777', 'active', null, null, 25, 0))
     or exists (select 1 from public.customers where id = current_setting('test.cust_late')::uuid)
     or exists (select 1 from public.products where id = current_setting('test.prod_late')::uuid) then
    raise exception 'FAIL: user B found Organization A selector data';
  end if;
  -- B's own search works and holds only B's records.
  if (select count(*) from public.list_customers(current_setting('test.org_b')::uuid, null, 'active', 25, 0)) <> 1
     or (select count(*) from public.list_products(current_setting('test.org_b')::uuid, null, 'active', null, null, 25, 0)) <> 1 then
    raise exception 'FAIL: user B selector search wrong';
  end if;
end $$;
reset role;

-- -----------------------------------------------------------------------------
-- Disabled member: no access at all
-- -----------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"c1000000-0000-4000-8000-00000000000d","role":"authenticated"}', true);

do $$ begin
  if exists (select 1 from public.quotations) or exists (select 1 from public.quotation_items) then
    raise exception 'FAIL: disabled member can read quotations';
  end if;
  if public.get_quotation(current_setting('test.org_a')::uuid, current_setting('test.q5')::uuid) is not null then
    raise exception 'FAIL: disabled member read a quotation through get_quotation';
  end if;
  if exists (select 1 from public.list_quotations(current_setting('test.org_a')::uuid)) then
    raise exception 'FAIL: disabled member listed quotations';
  end if;
  if exists (select 1 from public.list_customers(current_setting('test.org_a')::uuid, null, 'active', 25, 0))
     or exists (select 1 from public.list_products(current_setting('test.org_a')::uuid, null, 'active', null, null, 25, 0))
     or exists (select 1 from public.customers where id = current_setting('test.cust_inactive')::uuid)
     or exists (select 1 from public.products where id = current_setting('test.prod_inactive')::uuid) then
    raise exception 'FAIL: disabled member searched customers or products';
  end if;
  begin
    perform public.create_quotation(current_setting('test.cust_a')::uuid, date '2026-11-04', null, null,
      jsonb_build_array(jsonb_build_object('product_id', current_setting('test.prod_a')::uuid, 'quantity', '1')));
    raise exception 'FAIL: disabled member created a quotation';
  exception when foreign_key_violation then null;
  end;
  begin
    perform public.update_quotation_draft(current_setting('test.q5')::uuid, current_setting('test.cust_a')::uuid,
      date '2026-11-04', null, null,
      jsonb_build_array(jsonb_build_object('product_id', current_setting('test.prod_a')::uuid, 'quantity', '1')));
    raise exception 'FAIL: disabled member updated a quotation';
  exception when no_data_found then null;
  end;
  begin
    perform public.set_quotation_status(current_setting('test.q5')::uuid, 'sent');
    raise exception 'FAIL: disabled member changed a quotation status';
  exception when no_data_found then null;
  end;
end $$;

reset role;

-- A manager disabled later loses access at once.
update public.organization_members set status = 'disabled'
where user_id = 'c1000000-0000-4000-8000-00000000000c';

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"c1000000-0000-4000-8000-00000000000c","role":"authenticated"}', true);

do $$ begin
  if exists (select 1 from public.quotations) then
    raise exception 'FAIL: newly disabled manager can still read quotations';
  end if;
  if public.get_quotation(current_setting('test.org_a')::uuid, current_setting('test.q5')::uuid) is not null then
    raise exception 'FAIL: newly disabled manager read a quotation through get_quotation';
  end if;
  if exists (select 1 from public.list_quotations(current_setting('test.org_a')::uuid)) then
    raise exception 'FAIL: newly disabled manager listed quotations';
  end if;
  if exists (select 1 from public.list_customers(current_setting('test.org_a')::uuid, 'Zulu', 'active', 25, 0))
     or exists (select 1 from public.list_products(current_setting('test.org_a')::uuid, 'ZG-777', 'active', null, null, 25, 0)) then
    raise exception 'FAIL: newly disabled manager searched customers or products';
  end if;
  begin
    perform public.set_quotation_status(current_setting('test.q5')::uuid, 'cancelled');
    raise exception 'FAIL: newly disabled manager changed a quotation status';
  exception when no_data_found then null;
  end;
  begin
    perform public.update_quotation_draft(current_setting('test.q5')::uuid, current_setting('test.cust_a')::uuid,
      date '2026-11-04', null, null,
      jsonb_build_array(jsonb_build_object('product_id', current_setting('test.prod_a')::uuid, 'quantity', '1')));
    raise exception 'FAIL: newly disabled manager updated a quotation';
  exception when no_data_found then null;
  end;
  begin
    perform public.create_quotation(current_setting('test.cust_a')::uuid, date '2026-11-04', null, null,
      jsonb_build_array(jsonb_build_object('product_id', current_setting('test.prod_a')::uuid, 'quantity', '1')));
    raise exception 'FAIL: newly disabled manager created a quotation';
  exception when foreign_key_violation then null;
  end;
end $$;

reset role;

select 'ALL QUOTATION CHECKS PASSED' as result;

rollback;
