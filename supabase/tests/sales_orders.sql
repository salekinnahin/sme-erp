-- =============================================================================
-- Sales orders: direct creation, quotation conversion, numbering,
-- calculations, snapshots, draft editing, status model, immutability, role
-- permissions, direct API protection and tenant isolation.
--
-- How to run: paste this into the Supabase SQL Editor (it runs as `postgres`)
-- after applying the migrations up to 20261104140000_list_sales_orders.sql.
-- Everything runs in one transaction that is ROLLED BACK at the end, so no
-- data is left behind. Run it separately from the other suites.
--
-- Same structure as quotations.sql: it switches to the `authenticated` role
-- with JWT claims to simulate API users. A few checks run as `postgres` on
-- purpose, to prove the triggers and constraints hold for any writer.
--
-- Users
--   A  owner of Organization A        M  manager of Organization A
--   E  employee of Organization A     D  disabled member of Organization A
--   B  owner of Organization B
--
-- Success: the last result shows 'ALL SALES ORDER CHECKS PASSED'.
-- Failure: it stops with an error that starts with 'FAIL:'.
-- =============================================================================

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('c2000000-0000-4000-8000-00000000000a', 'so-test-a@example.com', '{"full_name":"Owner A"}'),
  ('c2000000-0000-4000-8000-00000000000b', 'so-test-b@example.com', '{"full_name":"Owner B"}'),
  ('c2000000-0000-4000-8000-00000000000c', 'so-test-m@example.com', '{"full_name":"Manager A"}'),
  ('c2000000-0000-4000-8000-00000000000d', 'so-test-d@example.com', '{"full_name":"Disabled A"}'),
  ('c2000000-0000-4000-8000-00000000000e', 'so-test-e@example.com', '{"full_name":"Employee A"}');

-- -----------------------------------------------------------------------------
-- Organizations A and B
-- -----------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"c2000000-0000-4000-8000-00000000000a","role":"authenticated"}', true);
select set_config('test.org_a', public.create_organization('Sales Org A', 'BDT', 'Asia/Dhaka')::text, true);
reset role;

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"c2000000-0000-4000-8000-00000000000b","role":"authenticated"}', true);
select set_config('test.org_b', public.create_organization('Sales Org B', 'USD', 'UTC')::text, true);
reset role;

insert into public.organization_members (organization_id, user_id, role, status) values
  (current_setting('test.org_a')::uuid, 'c2000000-0000-4000-8000-00000000000c', 'manager',  'active'),
  (current_setting('test.org_a')::uuid, 'c2000000-0000-4000-8000-00000000000e', 'employee', 'active'),
  (current_setting('test.org_a')::uuid, 'c2000000-0000-4000-8000-00000000000d', 'employee', 'disabled');

-- -----------------------------------------------------------------------------
-- Master data and quotations. Owner B first, then owner A.
-- -----------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"c2000000-0000-4000-8000-00000000000b","role":"authenticated"}', true);

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

  -- An accepted quotation of Organization B.
  v_id := public.create_quotation(current_setting('test.cust_b')::uuid, date '2026-11-04', null, null,
    jsonb_build_array(jsonb_build_object('product_id', current_setting('test.prod_b')::uuid, 'quantity', '2')));
  perform public.set_quotation_status(v_id, 'sent');
  perform public.set_quotation_status(v_id, 'accepted');
  perform set_config('test.q_b', v_id::text, true);
end $$;

reset role;

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"c2000000-0000-4000-8000-00000000000a","role":"authenticated"}', true);

do $$
declare
  v_org uuid := current_setting('test.org_a')::uuid;
  v_id  uuid;
  v_s   text;
begin
  insert into public.customers (organization_id, name, company_name, phone, email, address, tax_number)
  values (v_org, 'Acme Buyer', 'Acme Ltd', '+880 1711 000000', 'buyer@acme.test', 'Dhaka', 'BIN-1')
  returning id into v_id;
  perform set_config('test.cust_a', v_id::text, true);

  insert into public.customers (organization_id, name, email)
  values (v_org, 'Second Buyer', 'second@buyer.test') returning id into v_id;
  perform set_config('test.cust_a2', v_id::text, true);

  insert into public.customers (organization_id, name)
  values (v_org, 'Old Customer') returning id into v_id;
  perform set_config('test.cust_inactive', v_id::text, true);
  perform public.set_customer_status(v_id, 'inactive');

  -- Customer of the accepted quotation; renamed and deactivated later.
  insert into public.customers (organization_id, name, company_name, email, address)
  values (v_org, 'Later Buyer', 'Later Co', 'later@buyer.test', 'Sylhet') returning id into v_id;
  perform set_config('test.cust_later', v_id::text, true);

  insert into public.products (organization_id, name, sku, product_type, unit, description, selling_price)
  values (v_org, 'Laptop', 'LAP-1', 'inventory', 'pcs', 'Laptop desc', 100)
  returning id into v_id;
  perform set_config('test.prod_a', v_id::text, true);

  insert into public.products (organization_id, name, sku, product_type, unit)
  values (v_org, 'Setup', 'SRV-1', 'service', 'hour')
  returning id into v_id;
  perform set_config('test.prod_service', v_id::text, true);

  insert into public.products (organization_id, name, sku, product_type, unit, selling_price)
  values (v_org, 'Discontinued', 'OLD-1', 'inventory', 'pcs', 1)
  returning id into v_id;
  perform set_config('test.prod_inactive', v_id::text, true);
  perform public.set_product_status(v_id, 'inactive');

  -- Products of the accepted quotation; renamed / repriced / deactivated later.
  insert into public.products (organization_id, name, sku, product_type, unit, description, selling_price)
  values (v_org, 'Conv Widget', 'CW-1', 'inventory', 'box', 'Widget desc', 40)
  returning id into v_id;
  perform set_config('test.prod_conv', v_id::text, true);

  insert into public.products (organization_id, name, sku, product_type, unit, description, selling_price)
  values (v_org, 'Later Gadget', 'LG-1', 'inventory', 'pcs', 'Gadget desc', 12.5)
  returning id into v_id;
  perform set_config('test.prod_later', v_id::text, true);

  -- The accepted quotation that will be converted.
  --   line 1: 2.5 x 90.00 = 225.00, discount 10, tax 15% of 215.00 = 32.25 -> 247.25
  --   line 2: 3 x 12.50 = 37.50, tax 7.5% = 2.8125 -> 2.81 -> 40.31
  --   totals 262.50 / 10.00 / 35.06 / 287.56
  v_id := public.create_quotation(current_setting('test.cust_later')::uuid, date '2026-11-01', date '2026-11-30',
    'Agreed terms',
    jsonb_build_array(
      jsonb_build_object('product_id', current_setting('test.prod_conv')::uuid, 'quantity', '2.5',
                         'unit_price', '90.00', 'discount_amount', '10', 'tax_rate', '15'),
      jsonb_build_object('product_id', current_setting('test.prod_later')::uuid, 'quantity', '3',
                         'tax_rate', '7.5', 'description', 'Custom later')));
  perform public.set_quotation_status(v_id, 'sent');
  perform public.set_quotation_status(v_id, 'accepted');
  perform set_config('test.q_acc', v_id::text, true);

  -- Two more accepted quotations (employee conversion; never converted).
  foreach v_s in array array['test.q_acc2', 'test.q_acc3'] loop
    v_id := public.create_quotation(current_setting('test.cust_a')::uuid, date '2026-11-02', null, null,
      jsonb_build_array(jsonb_build_object('product_id', current_setting('test.prod_a')::uuid, 'quantity', '1')));
    perform public.set_quotation_status(v_id, 'sent');
    perform public.set_quotation_status(v_id, 'accepted');
    perform set_config(v_s, v_id::text, true);
  end loop;

  -- Quotations in every other status.
  v_id := public.create_quotation(current_setting('test.cust_a')::uuid, date '2026-11-02', null, null,
    jsonb_build_array(jsonb_build_object('product_id', current_setting('test.prod_a')::uuid, 'quantity', '1')));
  perform set_config('test.q_draft', v_id::text, true);

  foreach v_s in array array['sent', 'rejected', 'expired', 'cancelled'] loop
    v_id := public.create_quotation(current_setting('test.cust_a')::uuid, date '2026-11-02', null, null,
      jsonb_build_array(jsonb_build_object('product_id', current_setting('test.prod_a')::uuid, 'quantity', '1')));
    perform public.set_quotation_status(v_id, 'sent');
    if v_s <> 'sent' then
      perform public.set_quotation_status(v_id, v_s);
    end if;
    perform set_config('test.q_' || v_s, v_id::text, true);
  end loop;

  -- A quotation cancelled straight from draft.
  v_id := public.create_quotation(current_setting('test.cust_a')::uuid, date '2026-11-02', null, null,
    jsonb_build_array(jsonb_build_object('product_id', current_setting('test.prod_a')::uuid, 'quantity', '1')));
  perform public.set_quotation_status(v_id, 'cancelled');
  perform set_config('test.q_draft_cancelled', v_id::text, true);

  -- After acceptance, the master data changes.
  update public.customers set name = 'Later Renamed', email = 'renamed@buyer.test'
  where id = current_setting('test.cust_later')::uuid;
  perform public.set_customer_status(current_setting('test.cust_later')::uuid, 'inactive');
  update public.products set name = 'Conv Renamed', sku = 'CW-NEW', selling_price = 999
  where id = current_setting('test.prod_conv')::uuid;
  perform public.set_product_status(current_setting('test.prod_later')::uuid, 'inactive');

  -- The source quotation as it is now, to prove conversion never changes it.
  perform set_config('test.q_acc_before',
    (select to_jsonb(q)::text from public.quotations q where q.id = current_setting('test.q_acc')::uuid), true);
  perform set_config('test.q_acc_items_before',
    (select jsonb_agg(to_jsonb(i) order by i.sort_order)::text
     from public.quotation_items i where i.quotation_id = current_setting('test.q_acc')::uuid), true);
end $$;

reset role;

-- -----------------------------------------------------------------------------
-- anon: no access
-- -----------------------------------------------------------------------------
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);

do $$ begin
  begin
    perform 1 from public.sales_orders;
    raise exception 'FAIL: anon could select sales orders';
  exception when insufficient_privilege then null;
  end;
  begin
    perform 1 from public.sales_order_items;
    raise exception 'FAIL: anon could select sales order items';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.create_sales_order(gen_random_uuid(), current_date, null, null, '[]'::jsonb);
    raise exception 'FAIL: anon could call create_sales_order';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.create_sales_order_from_quotation(gen_random_uuid(), current_date, null);
    raise exception 'FAIL: anon could call create_sales_order_from_quotation';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.update_sales_order_draft(gen_random_uuid(), gen_random_uuid(), current_date, null, null, '[]'::jsonb);
    raise exception 'FAIL: anon could call update_sales_order_draft';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.set_sales_order_status(gen_random_uuid(), 'confirmed');
    raise exception 'FAIL: anon could call set_sales_order_status';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.get_sales_order(gen_random_uuid(), gen_random_uuid());
    raise exception 'FAIL: anon could call get_sales_order';
  exception when insufficient_privilege then null;
  end;
end $$;

reset role;

-- -----------------------------------------------------------------------------
-- Definitions and privileges
-- -----------------------------------------------------------------------------
do $$
declare
  v_fn text;
begin
  foreach v_fn in array array[
    'public.create_sales_order(uuid, date, date, text, jsonb)',
    'public.create_sales_order_from_quotation(uuid, date, date)',
    'public.update_sales_order_draft(uuid, uuid, date, date, text, jsonb)',
    'public.set_sales_order_status(uuid, text)'
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
    'public.sales_order_replace_items(uuid, uuid, jsonb)',
    'public.sales_order_recompute_totals(uuid, uuid)',
    'public.sales_order_normalize_header(date, date, text)',
    'public.sales_order_status_transition_allowed(text, text)',
    'public.sales_orders_enforce_rules()',
    'public.sales_order_items_enforce_draft()'
  ] loop
    if has_function_privilege('authenticated', v_fn, 'execute')
       or has_function_privilege('anon', v_fn, 'execute') then
      raise exception 'FAIL: API roles can execute internal function %', v_fn;
    end if;
    if not exists (select 1 from pg_proc where oid = v_fn::regprocedure
                   and proconfig @> array['search_path=""']) then
      raise exception 'FAIL: % has no fixed search_path', v_fn;
    end if;
  end loop;

  if not exists (
    select 1 from pg_proc p join pg_language l on l.oid = p.prolang
    where p.oid = 'public.get_sales_order(uuid, uuid)'::regprocedure
      and not p.prosecdef and l.lanname = 'sql' and p.provolatile = 's'
      and p.proconfig @> array['search_path=""']
  ) then
    raise exception 'FAIL: get_sales_order is not a SECURITY INVOKER, STABLE SQL function with search_path = ''''';
  end if;
  if has_function_privilege('anon', 'public.get_sales_order(uuid, uuid)', 'execute')
     or not has_function_privilege('authenticated', 'public.get_sales_order(uuid, uuid)', 'execute') then
    raise exception 'FAIL: get_sales_order grants wrong';
  end if;

  if pg_get_functiondef('public.set_sales_order_status(uuid, text)'::regprocedure)
     !~* 'has_org_role\(so\.organization_id, v_roles\)\s+for update' then
    raise exception 'FAIL: set_sales_order_status locks without the authorization predicate';
  end if;

  if has_table_privilege('authenticated', 'public.sales_orders', 'insert')
     or has_table_privilege('authenticated', 'public.sales_orders', 'update')
     or has_table_privilege('authenticated', 'public.sales_orders', 'delete')
     or has_table_privilege('authenticated', 'public.sales_order_items', 'insert')
     or has_table_privilege('authenticated', 'public.sales_order_items', 'update')
     or has_table_privilege('authenticated', 'public.sales_order_items', 'delete')
     or has_any_column_privilege('authenticated', 'public.sales_orders', 'insert')
     or has_any_column_privilege('authenticated', 'public.sales_orders', 'update')
     or has_any_column_privilege('authenticated', 'public.sales_order_items', 'insert')
     or has_any_column_privilege('authenticated', 'public.sales_order_items', 'update')
     or has_table_privilege('anon', 'public.sales_orders', 'select')
     or has_table_privilege('anon', 'public.sales_order_items', 'select') then
    raise exception 'FAIL: API roles have a write privilege on sales order tables (or anon can read)';
  end if;

  if pg_get_constraintdef((select oid from pg_constraint
       where conname = 'document_number_counters_type_check')) !~ 'sales_order' then
    raise exception 'FAIL: document_number_counters does not allow sales_order';
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- Owner A: direct creation, numbering, snapshots, totals
-- -----------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"c2000000-0000-4000-8000-00000000000a","role":"authenticated"}', true);

do $$
declare
  v_org     uuid := current_setting('test.org_a')::uuid;
  v_cust    uuid := current_setting('test.cust_a')::uuid;
  v_prod    uuid := current_setting('test.prod_a')::uuid;
  v_service uuid := current_setting('test.prod_service')::uuid;
  v_so      uuid;
  v_row     record;
  v_item    record;
begin
  -- Forged snapshot, amount, id-like and status keys are ignored.
  v_so := public.create_sales_order(v_cust, date '2026-11-04', date '2026-12-04', E'  Thanks! ',
    jsonb_build_array(
      jsonb_build_object('product_id', v_prod, 'quantity', '2.5', 'discount_amount', '10.00',
                         'tax_rate', '15', 'product_name', 'FORGED', 'sku', 'FORGED',
                         'unit', 'kg', 'tax_amount', '0', 'line_total', '1',
                         'organization_id', current_setting('test.org_b'),
                         'sales_order_id', gen_random_uuid()),
      jsonb_build_object('product_id', v_service, 'quantity', 3, 'unit_price', '33.33',
                         'tax_rate', 7.5, 'description', E'  Custom setup \u3000')));
  perform set_config('test.so1', v_so::text, true);

  select * into v_row from public.sales_orders where id = v_so;
  if v_row.sales_order_number <> 'SO-000001' then
    raise exception 'FAIL: first number is %, expected SO-000001', v_row.sales_order_number;
  end if;
  if v_row.organization_id <> v_org or v_row.status <> 'draft'
     or v_row.created_by <> 'c2000000-0000-4000-8000-00000000000a'
     or v_row.source_quotation_id is not null then
    raise exception 'FAIL: organization, status, created_by or source not derived correctly';
  end if;
  if v_row.customer_name <> 'Acme Buyer' or v_row.customer_company_name <> 'Acme Ltd'
     or v_row.customer_phone <> '+880 1711 000000' or v_row.customer_email <> 'buyer@acme.test'
     or v_row.customer_address <> 'Dhaka' or v_row.customer_tax_number <> 'BIN-1' then
    raise exception 'FAIL: customer snapshot wrong';
  end if;
  if v_row.notes <> 'Thanks!' or v_row.order_date <> date '2026-11-04'
     or v_row.expected_delivery_date <> date '2026-12-04' then
    raise exception 'FAIL: header wrong: %', row_to_json(v_row);
  end if;
  if v_row.subtotal::text <> '349.99' or v_row.discount_total::text <> '10.00'
     or v_row.tax_total::text <> '43.50' or v_row.grand_total::text <> '383.49' then
    raise exception 'FAIL: totals % % % %', v_row.subtotal, v_row.discount_total,
      v_row.tax_total, v_row.grand_total;
  end if;

  select * into v_item from public.sales_order_items where sales_order_id = v_so and sort_order = 1;
  if v_item.product_name <> 'Laptop' or v_item.sku <> 'LAP-1' or v_item.unit <> 'pcs'
     or v_item.description <> 'Laptop desc' or v_item.unit_price::text <> '100.00'
     or v_item.quantity::text <> '2.500' or v_item.tax_amount::text <> '36.00'
     or v_item.line_total::text <> '276.00' or v_item.organization_id <> v_org then
    raise exception 'FAIL: item 1 snapshot or amounts wrong: %', row_to_json(v_item);
  end if;
  select * into v_item from public.sales_order_items where sales_order_id = v_so and sort_order = 2;
  if v_item.product_name <> 'Setup' or v_item.unit <> 'hour'
     or v_item.description <> 'Custom setup' or v_item.unit_price::text <> '33.33'
     or v_item.tax_rate::text <> '7.50' or v_item.tax_amount::text <> '7.50'
     or v_item.line_total::text <> '107.49' then
    raise exception 'FAIL: item 2 override or amounts wrong: %', row_to_json(v_item);
  end if;

  -- Rounding (half up), decimal quantities, discount equal to gross.
  v_so := public.create_sales_order(v_cust, date '2026-11-04', null, null,
    jsonb_build_array(
      jsonb_build_object('product_id', v_prod, 'quantity', '1.005', 'unit_price', '1.00'),
      jsonb_build_object('product_id', v_prod, 'quantity', '1', 'unit_price', '10.00', 'tax_rate', '0.05'),
      jsonb_build_object('product_id', v_prod, 'quantity', '0.001', 'unit_price', '0.01'),
      jsonb_build_object('product_id', v_prod, 'quantity', '3', 'unit_price', '19.99',
                         'discount_amount', '0.97', 'tax_rate', '12.5', 'description', null),
      jsonb_build_object('product_id', v_prod, 'quantity', '1', 'unit_price', '5',
                         'discount_amount', '5')));
  perform set_config('test.so2', v_so::text, true);

  select * into v_row from public.sales_orders where id = v_so;
  if v_row.sales_order_number <> 'SO-000002' or v_row.expected_delivery_date is not null then
    raise exception 'FAIL: second order number or optional expected delivery date';
  end if;
  if (select string_agg(line_total::text, ',' order by sort_order)
      from public.sales_order_items where sales_order_id = v_so) <> '1.01,10.01,0.00,66.38,0.00' then
    raise exception 'FAIL: line rounding wrong';
  end if;
  if (select description from public.sales_order_items where sales_order_id = v_so and sort_order = 4) is not null
     or (select description from public.sales_order_items where sales_order_id = v_so and sort_order = 1) <> 'Laptop desc' then
    raise exception 'FAIL: description default / explicit null';
  end if;
  if v_row.subtotal::text <> '75.98' or v_row.discount_total::text <> '5.97'
     or v_row.tax_total::text <> '7.39' or v_row.grand_total::text <> '77.40'
     or v_row.grand_total <> (select sum(line_total) from public.sales_order_items where sales_order_id = v_so) then
    raise exception 'FAIL: rounding totals % % % %', v_row.subtotal, v_row.discount_total,
      v_row.tax_total, v_row.grand_total;
  end if;

  -- 100 items is the maximum and allowed.
  v_so := public.create_sales_order(v_cust, date '2026-11-04', date '2026-11-04', null,
    (select jsonb_agg(jsonb_build_object('product_id', v_prod, 'quantity', '1'))
     from generate_series(1, 100)));
  if (select count(*) from public.sales_order_items where sales_order_id = v_so) <> 100
     or (select sales_order_number from public.sales_orders where id = v_so) <> 'SO-000003'
     or (select grand_total::text from public.sales_orders where id = v_so) <> '10000.00' then
    raise exception 'FAIL: 100-item sales order';
  end if;

  -- 2000 code points of notes and description are accepted.
  v_so := public.create_sales_order(v_cust, date '2026-11-04', null, repeat('😀', 2000),
    jsonb_build_array(jsonb_build_object('product_id', v_prod, 'quantity', '1',
                                         'description', repeat('😀', 2000))));

  -- U+2028 / U+2029 are trimmed from notes and descriptions; inner kept.
  v_so := public.create_sales_order(v_cust, date '2026-11-04', null, E'\u2028Line 1\u2028Line 2\u2029',
    jsonb_build_array(
      jsonb_build_object('product_id', v_prod, 'quantity', '1', 'description', E'\u2029Custom\u2028'),
      jsonb_build_object('product_id', v_prod, 'quantity', '1', 'description', E'\u2028\u2029')));
  if (select notes from public.sales_orders where id = v_so) <> E'Line 1\u2028Line 2'
     or (select description from public.sales_order_items where sales_order_id = v_so and sort_order = 1) <> 'Custom'
     or (select description from public.sales_order_items where sales_order_id = v_so and sort_order = 2) is not null then
    raise exception 'FAIL: U+2028 / U+2029 not trimmed from notes or descriptions';
  end if;
  if (select sales_order_number from public.sales_orders where id = v_so) <> 'SO-000005' then
    raise exception 'FAIL: fifth number wrong';
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- Owner A: rejected direct-create input. Failures consume no numbers.
-- -----------------------------------------------------------------------------
do $$
declare
  v_cust  uuid := current_setting('test.cust_a')::uuid;
  v_prod  uuid := current_setting('test.prod_a')::uuid;
  v_case  record;
  v_so    uuid;
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
      ('4-decimal quantity',     jsonb_build_array(jsonb_build_object('product_id', v_prod, 'quantity', '1.0001')), '22023'),
      ('text quantity',          jsonb_build_array(jsonb_build_object('product_id', v_prod, 'quantity', 'abc')), '22023'),
      ('NaN quantity',           jsonb_build_array(jsonb_build_object('product_id', v_prod, 'quantity', 'NaN')), '22023'),
      ('exponent quantity',      jsonb_build_array(jsonb_build_object('product_id', v_prod, 'quantity', '1e3')), '22023'),
      ('missing quantity',       jsonb_build_array(jsonb_build_object('product_id', v_prod)), '22023'),
      ('negative price',         jsonb_build_array(jsonb_build_object('product_id', v_prod, 'quantity', '1', 'unit_price', '-1')), '22023'),
      ('3-decimal price',        jsonb_build_array(jsonb_build_object('product_id', v_prod, 'quantity', '1', 'unit_price', '1.001')), '22023'),
      ('no price available',     jsonb_build_array(jsonb_build_object('product_id', current_setting('test.prod_service')::uuid, 'quantity', '1')), '22023'),
      ('tax over 100',           jsonb_build_array(jsonb_build_object('product_id', v_prod, 'quantity', '1', 'tax_rate', '100.01')), '22023'),
      ('negative tax',           jsonb_build_array(jsonb_build_object('product_id', v_prod, 'quantity', '1', 'tax_rate', '-1')), '22023'),
      ('3-decimal tax',          jsonb_build_array(jsonb_build_object('product_id', v_prod, 'quantity', '1', 'tax_rate', '1.125')), '22023'),
      ('negative discount',      jsonb_build_array(jsonb_build_object('product_id', v_prod, 'quantity', '1', 'discount_amount', '-1')), '22023'),
      ('discount over gross',    jsonb_build_array(jsonb_build_object('product_id', v_prod, 'quantity', '2', 'unit_price', '5', 'discount_amount', '10.01')), '22023'),
      ('description too long',   jsonb_build_array(jsonb_build_object('product_id', v_prod, 'quantity', '1', 'description', repeat('😀', 2001))), '22023'),
      ('description not text',   jsonb_build_array(jsonb_build_object('product_id', v_prod, 'quantity', '1', 'description', 5)), '22023'),
      ('line id on create',      jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'product_id', v_prod, 'quantity', '1')), '22023'),
      ('line total overflow',    jsonb_build_array(jsonb_build_object('product_id', v_prod, 'quantity', '999999999999999', 'unit_price', '9999999999999999.99')), '22003'),
      ('subtotal overflow',      jsonb_build_array(
                                   jsonb_build_object('product_id', v_prod, 'quantity', '1', 'unit_price', '9999999999999999.99'),
                                   jsonb_build_object('product_id', v_prod, 'quantity', '1', 'unit_price', '9999999999999999.99')), '22003'),
      ('inactive product',       jsonb_build_array(jsonb_build_object('product_id', current_setting('test.prod_inactive')::uuid, 'quantity', '1')), '23503'),
      ('product deactivated after a quotation', jsonb_build_array(jsonb_build_object('product_id', current_setting('test.prod_later')::uuid, 'quantity', '1')), '23503'),
      ('other tenant product',   jsonb_build_array(jsonb_build_object('product_id', current_setting('test.prod_b')::uuid, 'quantity', '1')), '23503')
    ) as t (label, items, expected)
  loop
    begin
      perform public.create_sales_order(v_cust, date '2026-11-04', null, null, v_case.items);
      raise exception 'FAIL: % accepted', v_case.label;
    exception when others then
      if sqlstate <> v_case.expected then
        raise exception 'FAIL: % raised % (%), expected %', v_case.label, sqlstate, sqlerrm, v_case.expected;
      end if;
    end;
  end loop;

  begin
    perform public.create_sales_order(v_cust, date '2026-11-04', null, null,
      (select jsonb_agg(jsonb_build_object('product_id', v_prod, 'quantity', '1'))
       from generate_series(1, 101)));
    raise exception 'FAIL: 101 items accepted';
  exception when invalid_parameter_value then null;
  end;

  -- Header input
  for v_case in
    select * from (values
      ('missing order date',           null::date,           null::date,           null::text),
      ('infinite order date',          'infinity'::date,     null::date,           null::text),
      ('delivery before order date',   date '2026-11-04',    date '2026-11-03',    null::text),
      ('infinite delivery date',       date '2026-11-04',    'infinity'::date,     null::text),
      ('2001-code-point notes',        date '2026-11-04',    null::date,           repeat('😀', 2001))
    ) as t (label, order_date, delivery_date, notes)
  loop
    begin
      perform public.create_sales_order(v_cust, v_case.order_date, v_case.delivery_date, v_case.notes,
        jsonb_build_array(jsonb_build_object('product_id', v_prod, 'quantity', '1')));
      raise exception 'FAIL: % accepted', v_case.label;
    exception when invalid_parameter_value then null;
    end;
  end loop;

  -- Customers: inactive, deactivated after acceptance, null
  begin
    perform public.create_sales_order(current_setting('test.cust_inactive')::uuid, date '2026-11-04', null, null,
      jsonb_build_array(jsonb_build_object('product_id', v_prod, 'quantity', '1')));
    raise exception 'FAIL: inactive customer accepted';
  exception when foreign_key_violation then null;
  end;
  begin
    perform public.create_sales_order(current_setting('test.cust_later')::uuid, date '2026-11-04', null, null,
      jsonb_build_array(jsonb_build_object('product_id', v_prod, 'quantity', '1')));
    raise exception 'FAIL: direct create with a deactivated customer accepted';
  exception when foreign_key_violation then null;
  end;
  begin
    perform public.create_sales_order(null, date '2026-11-04', null, null,
      jsonb_build_array(jsonb_build_object('product_id', v_prod, 'quantity', '1')));
    raise exception 'FAIL: null customer accepted';
  exception when foreign_key_violation then null;
  end;

  -- No gap.
  v_so := public.create_sales_order(v_cust, date '2026-11-04', null, null,
    jsonb_build_array(jsonb_build_object('product_id', v_prod, 'quantity', '1')));
  if (select sales_order_number from public.sales_orders where id = v_so) <> 'SO-000006' then
    raise exception 'FAIL: failed creates consumed numbers; got %',
      (select sales_order_number from public.sales_orders where id = v_so);
  end if;
  perform set_config('test.so_draft', v_so::text, true);
end $$;

-- Unknown and other-tenant customers and products fail identically.
do $$
declare
  v_prod   uuid := current_setting('test.prod_a')::uuid;
  v_err1   text;
  v_err2   text;
  v_state1 text;
  v_state2 text;
begin
  begin
    perform public.create_sales_order(current_setting('test.cust_b')::uuid, date '2026-11-04', null, null,
      jsonb_build_array(jsonb_build_object('product_id', v_prod, 'quantity', '1')));
    raise exception 'FAIL: other tenant customer accepted';
  exception when others then v_state1 := sqlstate; v_err1 := sqlerrm;
  end;
  begin
    perform public.create_sales_order(gen_random_uuid(), date '2026-11-04', null, null,
      jsonb_build_array(jsonb_build_object('product_id', v_prod, 'quantity', '1')));
  exception when others then v_state2 := sqlstate; v_err2 := sqlerrm;
  end;
  if v_state1 <> '23503' or v_state1 <> v_state2 or v_err1 <> v_err2 then
    raise exception 'FAIL: other-tenant customer (% %) differs from unknown (% %)', v_state1, v_err1, v_state2, v_err2;
  end if;

  begin
    perform public.create_sales_order(current_setting('test.cust_a')::uuid, date '2026-11-04', null, null,
      jsonb_build_array(jsonb_build_object('product_id', current_setting('test.prod_b')::uuid, 'quantity', '1')));
  exception when others then v_state1 := sqlstate; v_err1 := sqlerrm;
  end;
  begin
    perform public.create_sales_order(current_setting('test.cust_a')::uuid, date '2026-11-04', null, null,
      jsonb_build_array(jsonb_build_object('product_id', gen_random_uuid(), 'quantity', '1')));
  exception when others then v_state2 := sqlstate; v_err2 := sqlerrm;
  end;
  if v_state1 <> '23503' or v_state1 <> v_state2 or v_err1 <> v_err2 then
    raise exception 'FAIL: other-tenant product (% %) differs from unknown (% %)', v_state1, v_err1, v_state2, v_err2;
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- Owner A: quotation conversion
-- -----------------------------------------------------------------------------
do $$
declare
  v_q    uuid := current_setting('test.q_acc')::uuid;
  v_so   uuid;
  v_row  record;
  v_quo  record;
  v_case record;
  v_e1   text;
  v_e2   text;
  v_s1   text;
  v_s2   text;
begin
  -- The customer (cust_later) and one product (prod_later) were deactivated
  -- after acceptance, and the other product was renamed and repriced.
  -- Conversion still works and uses the quotation's snapshot and amounts.
  v_so := public.create_sales_order_from_quotation(v_q, date '2026-11-05', date '2026-11-20');
  perform set_config('test.so_conv', v_so::text, true);

  select * into v_row from public.sales_orders where id = v_so;
  select * into v_quo from public.quotations where id = v_q;

  if v_row.sales_order_number <> 'SO-000007' or v_row.status <> 'draft'
     or v_row.source_quotation_id <> v_q
     or v_row.organization_id <> current_setting('test.org_a')::uuid
     or v_row.created_by <> 'c2000000-0000-4000-8000-00000000000a'
     or v_row.order_date <> date '2026-11-05' or v_row.expected_delivery_date <> date '2026-11-20' then
    raise exception 'FAIL: converted header wrong: %', row_to_json(v_row);
  end if;
  if v_row.customer_id <> v_quo.customer_id
     or v_row.customer_name <> 'Later Buyer' or v_row.customer_company_name <> 'Later Co'
     or v_row.customer_email <> 'later@buyer.test' or v_row.customer_address <> 'Sylhet'
     or v_row.customer_phone is not null or v_row.customer_tax_number is not null
     or v_row.notes <> 'Agreed terms' then
    raise exception 'FAIL: converted customer snapshot or notes not taken from the quotation: %', row_to_json(v_row);
  end if;
  if v_row.subtotal::text <> '262.50' or v_row.discount_total::text <> '10.00'
     or v_row.tax_total::text <> '35.06' or v_row.grand_total::text <> '287.56'
     or (v_row.subtotal, v_row.discount_total, v_row.tax_total, v_row.grand_total)
        is distinct from (v_quo.subtotal, v_quo.discount_total, v_quo.tax_total, v_quo.grand_total) then
    raise exception 'FAIL: converted totals % % % %', v_row.subtotal, v_row.discount_total,
      v_row.tax_total, v_row.grand_total;
  end if;

  -- Every line equals the quotation line, column for column.
  if (select jsonb_agg(jsonb_build_array(product_id, product_name, sku, description, unit,
                                         quantity::text, unit_price::text, discount_amount::text,
                                         tax_rate::text, tax_amount::text, line_total::text, sort_order)
                       order by sort_order)
      from public.sales_order_items where sales_order_id = v_so)
     is distinct from
     (select jsonb_agg(jsonb_build_array(product_id, product_name, sku, description, unit,
                                         quantity::text, unit_price::text, discount_amount::text,
                                         tax_rate::text, tax_amount::text, line_total::text, sort_order)
                       order by sort_order)
      from public.quotation_items where quotation_id = v_q) then
    raise exception 'FAIL: converted items differ from the quotation items';
  end if;
  -- ... and those are the old snapshot values, not the current master data.
  if (select string_agg(product_name || '|' || sku || '|' || unit || '|' || unit_price::text
                        || '|' || coalesce(description, '-'), ',' order by sort_order)
      from public.sales_order_items where sales_order_id = v_so)
     <> 'Conv Widget|CW-1|box|90.00|Widget desc,Later Gadget|LG-1|pcs|12.50|Custom later' then
    raise exception 'FAIL: converted lines re-read the current products';
  end if;

  -- The source quotation is unchanged.
  if (select to_jsonb(q)::text from public.quotations q where q.id = v_q) <> current_setting('test.q_acc_before')
     or (select jsonb_agg(to_jsonb(i) order by i.sort_order)::text
         from public.quotation_items i where i.quotation_id = v_q) <> current_setting('test.q_acc_items_before') then
    raise exception 'FAIL: conversion modified the source quotation';
  end if;

  -- The same quotation cannot be converted twice.
  begin
    perform public.create_sales_order_from_quotation(v_q, date '2026-11-05', null);
    raise exception 'FAIL: quotation converted twice';
  exception when unique_violation then null;
  end;
  if (select count(*) from public.sales_orders where source_quotation_id = v_q) <> 1 then
    raise exception 'FAIL: more than one sales order for the quotation';
  end if;

  -- Only accepted quotations convert.
  for v_case in
    select * from (values
      ('draft',              current_setting('test.q_draft')),
      ('sent',               current_setting('test.q_sent')),
      ('rejected',           current_setting('test.q_rejected')),
      ('expired',            current_setting('test.q_expired')),
      ('cancelled',          current_setting('test.q_cancelled')),
      ('cancelled as draft', current_setting('test.q_draft_cancelled'))
    ) as t (label, id)
  loop
    begin
      perform public.create_sales_order_from_quotation(v_case.id::uuid, date '2026-11-05', null);
      raise exception 'FAIL: % quotation converted', v_case.label;
    exception when object_not_in_prerequisite_state then null;
    end;
  end loop;

  -- Header input on conversion.
  begin
    perform public.create_sales_order_from_quotation(current_setting('test.q_acc3')::uuid, null, null);
    raise exception 'FAIL: conversion without an order date accepted';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.create_sales_order_from_quotation(current_setting('test.q_acc3')::uuid,
      date '2026-11-05', date '2026-11-04');
    raise exception 'FAIL: conversion with delivery before order date accepted';
  exception when invalid_parameter_value then null;
  end;

  -- Unknown, NULL and other-tenant quotations fail identically.
  begin
    perform public.create_sales_order_from_quotation(current_setting('test.q_b')::uuid, date '2026-11-05', null);
    raise exception 'FAIL: other-tenant quotation converted';
  exception when others then v_s1 := sqlstate; v_e1 := sqlerrm;
  end;
  begin
    perform public.create_sales_order_from_quotation(gen_random_uuid(), date '2026-11-05', null);
  exception when others then v_s2 := sqlstate; v_e2 := sqlerrm;
  end;
  if v_s1 <> 'P0002' or v_s1 <> v_s2 or v_e1 <> v_e2 then
    raise exception 'FAIL: other-tenant quotation (% %) differs from unknown (% %)', v_s1, v_e1, v_s2, v_e2;
  end if;
  begin
    perform public.create_sales_order_from_quotation(null, date '2026-11-05', null);
    raise exception 'FAIL: null quotation converted';
  exception when no_data_found then null;
  end;

  -- Failed conversions consumed no numbers (checked by the next create in
  -- the employee section: SO-000008).
end $$;

-- get_sales_order: header and items in one statement, exact strings.
do $$
declare
  v_so   uuid := current_setting('test.so_conv')::uuid;
  v_doc  jsonb;
begin
  v_doc := public.get_sales_order(current_setting('test.org_a')::uuid, v_so);
  if v_doc is null
     or v_doc ->> 'id' <> v_so::text
     or v_doc ->> 'sales_order_number' <> 'SO-000007'
     or v_doc ->> 'source_quotation_id' <> current_setting('test.q_acc')
     or v_doc ->> 'source_quotation_number'
        <> (select quotation_number from public.quotations where id = current_setting('test.q_acc')::uuid)
     or v_doc ->> 'customer_name' <> 'Later Buyer'
     or v_doc ->> 'status' <> 'draft'
     or v_doc ->> 'order_date' <> '2026-11-05'
     or v_doc ->> 'expected_delivery_date' <> '2026-11-20'
     or jsonb_typeof(v_doc -> 'grand_total') <> 'string'
     or v_doc ->> 'grand_total' <> '287.56'
     or jsonb_array_length(v_doc -> 'items') <> 2
     or v_doc -> 'items' -> 0 ->> 'quantity' <> '2.500'
     or jsonb_typeof(v_doc -> 'items' -> 0 -> 'quantity') <> 'string'
     or v_doc -> 'items' -> 1 ->> 'tax_amount' <> '2.81'
     or v_doc -> 'items' -> 1 ->> 'sort_order' <> '2' then
    raise exception 'FAIL: get_sales_order document wrong: %', v_doc;
  end if;

  v_doc := public.get_sales_order(current_setting('test.org_a')::uuid, current_setting('test.so1')::uuid);
  if v_doc -> 'source_quotation_id' <> 'null'::jsonb or v_doc -> 'source_quotation_number' <> 'null'::jsonb then
    raise exception 'FAIL: direct order shows a source quotation';
  end if;

  if public.get_sales_order(current_setting('test.org_b')::uuid, v_so) is not null
     or public.get_sales_order(current_setting('test.org_a')::uuid, gen_random_uuid()) is not null
     or public.get_sales_order(null, v_so) is not null
     or public.get_sales_order(current_setting('test.org_a')::uuid, null) is not null then
    raise exception 'FAIL: get_sales_order returned a document for a wrong organization or ID';
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- Owner A: direct table writes are impossible
-- -----------------------------------------------------------------------------
do $$
declare
  v_so   uuid := current_setting('test.so1')::uuid;
  v_item uuid := (select id from public.sales_order_items where sales_order_id = current_setting('test.so1')::uuid limit 1);
  v_sql  text;
begin
  foreach v_sql in array array[
    format('insert into public.sales_orders (organization_id, sales_order_number, customer_id, customer_name, order_date)
            values (%L, %L, %L, %L, current_date)',
           current_setting('test.org_a'), 'SO-999999', current_setting('test.cust_a'), 'X'),
    format('insert into public.sales_orders (organization_id, sales_order_number, customer_id, customer_name, order_date, source_quotation_id)
            values (%L, %L, %L, %L, current_date, %L)',
           current_setting('test.org_a'), 'SO-999998', current_setting('test.cust_a'), 'X', current_setting('test.q_acc3')),
    format('update public.sales_orders set sales_order_number = %L where id = %L', 'SO-000099', v_so),
    format('update public.sales_orders set organization_id = %L where id = %L', current_setting('test.org_b'), v_so),
    format('update public.sales_orders set created_by = %L where id = %L', 'c2000000-0000-4000-8000-00000000000b', v_so),
    format('update public.sales_orders set source_quotation_id = %L where id = %L', current_setting('test.q_acc3'), v_so),
    format('update public.sales_orders set grand_total = 1, subtotal = 1 where id = %L', v_so),
    format('update public.sales_orders set customer_name = %L where id = %L', 'Forged', v_so),
    format('update public.sales_orders set status = %L where id = %L', 'completed', v_so),
    format('update public.sales_orders set notes = %L where id = %L', 'direct', v_so),
    format('delete from public.sales_orders where id = %L', v_so),
    format('insert into public.sales_order_items (organization_id, sales_order_id, product_id, product_name, sku, unit,
              quantity, unit_price, tax_amount, line_total, sort_order)
            values (%L, %L, %L, %L, %L, %L, 1, 1, 0, 1, 50)',
           current_setting('test.org_a'), v_so, current_setting('test.prod_a'), 'X', 'X', 'pcs'),
    format('update public.sales_order_items set unit_price = 0 where id = %L', v_item),
    format('update public.sales_order_items set product_name = %L where id = %L', 'Forged', v_item),
    format('delete from public.sales_order_items where id = %L', v_item)
  ] loop
    begin
      execute v_sql;
      raise exception 'FAIL: direct write accepted: %', v_sql;
    exception when insufficient_privilege then null;
    end;
  end loop;

  foreach v_sql in array array[
    format('select public.sales_order_replace_items(%L, %L, %L::jsonb)', v_so, current_setting('test.org_a'), '[]'),
    format('select public.sales_order_recompute_totals(%L, %L)', v_so, current_setting('test.org_a')),
    format('select public.next_document_number(%L, %L)', current_setting('test.org_a'), 'sales_order')
  ] loop
    begin
      execute v_sql;
      raise exception 'FAIL: internal function callable: %', v_sql;
    exception when insufficient_privilege then null;
    end;
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- Snapshots survive master-data changes
-- -----------------------------------------------------------------------------
do $$
declare
  v_so uuid := current_setting('test.so1')::uuid;
begin
  update public.customers set name = 'Renamed Buyer', email = 'new@acme.test'
  where id = current_setting('test.cust_a')::uuid;
  update public.products set name = 'Renamed Laptop', sku = 'LAP-NEW', unit = 'box',
                             description = 'New desc', selling_price = 999
  where id = current_setting('test.prod_a')::uuid;

  if (select customer_name from public.sales_orders where id = v_so) <> 'Acme Buyer'
     or (select customer_email from public.sales_orders where id = v_so) <> 'buyer@acme.test' then
    raise exception 'FAIL: customer change altered the sales order snapshot';
  end if;
  if exists (
    select 1 from public.sales_order_items
    where sales_order_id = v_so and sort_order = 1
      and (product_name <> 'Laptop' or sku <> 'LAP-1' or unit <> 'pcs'
           or description <> 'Laptop desc' or unit_price <> 100)
  ) or (select grand_total::text from public.sales_orders where id = v_so) <> '383.49' then
    raise exception 'FAIL: product change altered the item snapshot or totals';
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- Draft update of a direct order: re-snapshot only what changes
-- -----------------------------------------------------------------------------
do $$
declare
  v_so     uuid := current_setting('test.so1')::uuid;
  v_line1  uuid := (select id from public.sales_order_items where sales_order_id = current_setting('test.so1')::uuid and sort_order = 1);
  v_line2  uuid := (select id from public.sales_order_items where sales_order_id = current_setting('test.so1')::uuid and sort_order = 2);
  v_row    record;
begin
  -- Same customer; line 1 kept (id + same product), plus a new line.
  perform public.update_sales_order_draft(v_so, current_setting('test.cust_a')::uuid,
    date '2026-11-05', date '2026-11-30', null,
    jsonb_build_array(
      jsonb_build_object('id', upper(v_line1::text), 'product_id', current_setting('test.prod_a')::uuid,
                         'quantity', '1', 'tax_rate', '10'),
      jsonb_build_object('product_id', current_setting('test.prod_a')::uuid, 'quantity', '1')));

  select * into v_row from public.sales_orders where id = v_so;
  if v_row.sales_order_number <> 'SO-000001' or v_row.status <> 'draft'
     or v_row.created_by <> 'c2000000-0000-4000-8000-00000000000a'
     or v_row.order_date <> date '2026-11-05' or v_row.notes is not null
     or v_row.source_quotation_id is not null then
    raise exception 'FAIL: draft update header wrong: %', row_to_json(v_row);
  end if;
  if v_row.customer_name <> 'Acme Buyer' or v_row.customer_email <> 'buyer@acme.test' then
    raise exception 'FAIL: unchanged customer was re-snapshotted';
  end if;
  if (select string_agg(product_name || '|' || sku || '|' || unit || '|' || unit_price::text
                        || '|' || coalesce(description, '-'), ',' order by sort_order)
      from public.sales_order_items where sales_order_id = v_so)
     <> 'Laptop|LAP-1|pcs|100.00|Laptop desc,Renamed Laptop|LAP-NEW|box|999.00|New desc' then
    raise exception 'FAIL: kept line / new line snapshots wrong: %',
      (select string_agg(product_name || '|' || unit_price::text, ',' order by sort_order)
       from public.sales_order_items where sales_order_id = v_so);
  end if;
  if exists (select 1 from public.sales_order_items where id in (v_line1, v_line2)) then
    raise exception 'FAIL: items were not replaced';
  end if;
  -- 100.00 + 10% = 110.00; 999.00
  if v_row.subtotal::text <> '1099.00' or v_row.tax_total::text <> '10.00'
     or v_row.grand_total::text <> '1109.00' then
    raise exception 'FAIL: draft update totals % % %', v_row.subtotal, v_row.tax_total, v_row.grand_total;
  end if;

  -- Another customer: fresh snapshot. And back: fresh snapshot of the
  -- current (renamed) customer.
  perform public.update_sales_order_draft(v_so, current_setting('test.cust_a2')::uuid,
    date '2026-11-05', null, null,
    (select jsonb_agg(jsonb_build_object('id', id, 'product_id', product_id, 'quantity', quantity::text) order by sort_order)
     from public.sales_order_items where sales_order_id = v_so));
  if (select customer_name || '|' || coalesce(customer_email, '-') || '|' || coalesce(customer_company_name, '-')
      from public.sales_orders where id = v_so) <> 'Second Buyer|second@buyer.test|-' then
    raise exception 'FAIL: changed customer not snapshotted';
  end if;
  perform public.update_sales_order_draft(v_so, current_setting('test.cust_a')::uuid,
    date '2026-11-05', null, null,
    (select jsonb_agg(jsonb_build_object('id', id, 'product_id', product_id, 'quantity', quantity::text) order by sort_order)
     from public.sales_order_items where sales_order_id = v_so));
  if (select customer_name || '|' || customer_email from public.sales_orders where id = v_so)
     <> 'Renamed Buyer|new@acme.test' then
    raise exception 'FAIL: changed-back customer not freshly snapshotted';
  end if;
  -- Kept lines kept their prices across both saves.
  if (select string_agg(unit_price::text, ',' order by sort_order)
      from public.sales_order_items where sales_order_id = v_so) <> '100.00,999.00' then
    raise exception 'FAIL: kept line prices changed';
  end if;

  -- Customer rules on update.
  begin
    perform public.update_sales_order_draft(v_so, current_setting('test.cust_inactive')::uuid,
      date '2026-11-05', null, null,
      jsonb_build_array(jsonb_build_object('product_id', current_setting('test.prod_a')::uuid, 'quantity', '1')));
    raise exception 'FAIL: update to inactive customer accepted';
  exception when foreign_key_violation then null;
  end;
  begin
    perform public.update_sales_order_draft(v_so, current_setting('test.cust_b')::uuid,
      date '2026-11-05', null, null,
      jsonb_build_array(jsonb_build_object('product_id', current_setting('test.prod_a')::uuid, 'quantity', '1')));
    raise exception 'FAIL: update to other-tenant customer accepted';
  exception when foreign_key_violation then null;
  end;
  begin
    perform public.update_sales_order_draft(v_so, current_setting('test.cust_a')::uuid,
      date '2026-11-05', null, null,
      jsonb_build_array(jsonb_build_object('product_id', current_setting('test.prod_b')::uuid, 'quantity', '1')));
    raise exception 'FAIL: update with other-tenant product accepted';
  exception when foreign_key_violation then null;
  end;
  begin
    perform public.update_sales_order_draft(v_so, current_setting('test.cust_a')::uuid,
      date '2026-11-05', null, null, '[]'::jsonb);
    raise exception 'FAIL: update with no items accepted';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.update_sales_order_draft(v_so, current_setting('test.cust_a')::uuid,
      date '2026-11-05', date '2026-11-01', null,
      jsonb_build_array(jsonb_build_object('product_id', current_setting('test.prod_a')::uuid, 'quantity', '1')));
    raise exception 'FAIL: update with delivery before order date accepted';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.update_sales_order_draft(gen_random_uuid(), current_setting('test.cust_a')::uuid,
      date '2026-11-05', null, null,
      jsonb_build_array(jsonb_build_object('product_id', current_setting('test.prod_a')::uuid, 'quantity', '1')));
    raise exception 'FAIL: update of unknown sales order accepted';
  exception when no_data_found then null;
  end;
end $$;

-- -----------------------------------------------------------------------------
-- Draft update of a converted order: kept lines need no active product, the
-- unchanged customer need not be active, the source quotation never changes
-- -----------------------------------------------------------------------------
do $$
declare
  v_so     uuid := current_setting('test.so_conv')::uuid;
  v_l1     uuid := (select id from public.sales_order_items where sales_order_id = current_setting('test.so_conv')::uuid and sort_order = 1);
  v_l2     uuid := (select id from public.sales_order_items where sales_order_id = current_setting('test.so_conv')::uuid and sort_order = 2);
  v_other  uuid := (select id from public.sales_order_items where sales_order_id = current_setting('test.so1')::uuid limit 1);
  v_before text;
  v_case   record;
  v_row    record;
begin
  -- Same (now inactive) customer; both lines kept, including the now
  -- inactive product. Line 1 quantity 3: 270.00 - 10 = 260.00 + 15% 39.00.
  perform public.update_sales_order_draft(v_so, current_setting('test.cust_later')::uuid,
    date '2026-11-05', null, 'Agreed terms, revised',
    jsonb_build_array(
      jsonb_build_object('id', v_l1, 'product_id', current_setting('test.prod_conv')::uuid,
                         'quantity', '3', 'unit_price', '90.00', 'discount_amount', '10', 'tax_rate', '15'),
      jsonb_build_object('id', v_l2, 'product_id', current_setting('test.prod_later')::uuid,
                         'quantity', '3', 'tax_rate', '7.5')));

  select * into v_row from public.sales_orders where id = v_so;
  if v_row.customer_name <> 'Later Buyer' or v_row.notes <> 'Agreed terms, revised'
     or v_row.source_quotation_id <> current_setting('test.q_acc')::uuid then
    raise exception 'FAIL: converted draft update header wrong: %', row_to_json(v_row);
  end if;
  if (select string_agg(product_name || '|' || sku || '|' || unit_price::text
                        || '|' || coalesce(description, '-') || '|' || line_total::text, ',' order by sort_order)
      from public.sales_order_items where sales_order_id = v_so)
     <> 'Conv Widget|CW-1|90.00|Widget desc|299.00,Later Gadget|LG-1|12.50|Custom later|40.31' then
    raise exception 'FAIL: converted kept lines wrong: %',
      (select string_agg(product_name || '|' || unit_price::text || '|' || line_total::text, ',' order by sort_order)
       from public.sales_order_items where sales_order_id = v_so);
  end if;
  if v_row.subtotal::text <> '307.50' or v_row.discount_total::text <> '10.00'
     or v_row.tax_total::text <> '41.81' or v_row.grand_total::text <> '339.31' then
    raise exception 'FAIL: converted draft totals % % % %', v_row.subtotal, v_row.discount_total,
      v_row.tax_total, v_row.grand_total;
  end if;

  -- Rejected edits leave the order unchanged.
  v_before := (select to_jsonb(so)::text from public.sales_orders so where so.id = v_so)
           || (select jsonb_agg(to_jsonb(i) order by i.sort_order)::text
               from public.sales_order_items i where i.sales_order_id = v_so);
  v_l1 := (select id from public.sales_order_items where sales_order_id = v_so and sort_order = 1);
  v_l2 := (select id from public.sales_order_items where sales_order_id = v_so and sort_order = 2);

  for v_case in
    select * from (values
      ('new line of an inactive product',
        current_setting('test.cust_later'),
        jsonb_build_array(jsonb_build_object('product_id', current_setting('test.prod_later')::uuid, 'quantity', '1')),
        '23503'),
      ('kept line id with a changed, inactive product',
        current_setting('test.cust_later'),
        jsonb_build_array(jsonb_build_object('id', v_l2, 'product_id', current_setting('test.prod_inactive')::uuid, 'quantity', '1')),
        '23503'),
      ('line id of another order',
        current_setting('test.cust_later'),
        jsonb_build_array(jsonb_build_object('id', v_other, 'product_id', current_setting('test.prod_a')::uuid, 'quantity', '1')),
        '22023'),
      ('unknown line id',
        current_setting('test.cust_later'),
        jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'product_id', current_setting('test.prod_conv')::uuid, 'quantity', '1')),
        '22023'),
      ('repeated line id',
        current_setting('test.cust_later'),
        jsonb_build_array(
          jsonb_build_object('id', v_l1, 'product_id', current_setting('test.prod_conv')::uuid, 'quantity', '1'),
          jsonb_build_object('id', v_l1, 'product_id', current_setting('test.prod_conv')::uuid, 'quantity', '1')),
        '22023'),
      ('line id not a string',
        current_setting('test.cust_later'),
        jsonb_build_array(jsonb_build_object('id', 5, 'product_id', current_setting('test.prod_conv')::uuid, 'quantity', '1')),
        '22023'),
      ('customer changed to an inactive one',
        current_setting('test.cust_inactive'),
        jsonb_build_array(jsonb_build_object('id', v_l1, 'product_id', current_setting('test.prod_conv')::uuid, 'quantity', '1')),
        '23503'),
      ('kept line with a zero quantity',
        current_setting('test.cust_later'),
        jsonb_build_array(jsonb_build_object('id', v_l1, 'product_id', current_setting('test.prod_conv')::uuid, 'quantity', '0')),
        '22023')
    ) as t (label, customer, items, expected)
  loop
    begin
      perform public.update_sales_order_draft(v_so, v_case.customer::uuid, date '2026-11-05', null, 'x', v_case.items);
      raise exception 'FAIL: % accepted', v_case.label;
    exception when others then
      if sqlstate <> v_case.expected then
        raise exception 'FAIL: % raised % (%), expected %', v_case.label, sqlstate, sqlerrm, v_case.expected;
      end if;
    end;
  end loop;

  if (select to_jsonb(so)::text from public.sales_orders so where so.id = v_so)
     || (select jsonb_agg(to_jsonb(i) order by i.sort_order)::text
         from public.sales_order_items i where i.sales_order_id = v_so) <> v_before then
    raise exception 'FAIL: a rejected edit partially changed the converted order';
  end if;

  -- A kept line id with a different, active product is a new selection:
  -- current snapshot and current price.
  perform public.update_sales_order_draft(v_so, current_setting('test.cust_later')::uuid,
    date '2026-11-05', null, null,
    jsonb_build_array(
      jsonb_build_object('id', v_l1, 'product_id', current_setting('test.prod_conv')::uuid, 'quantity', '1'),
      jsonb_build_object('id', v_l2, 'product_id', current_setting('test.prod_a')::uuid, 'quantity', '1')));
  if (select string_agg(product_name || '|' || unit_price::text, ',' order by sort_order)
      from public.sales_order_items where sales_order_id = v_so) <> 'Conv Widget|90.00,Renamed Laptop|999.00' then
    raise exception 'FAIL: changed product on a line id not re-snapshotted';
  end if;

  -- The source quotation is still exactly as it was.
  if (select to_jsonb(q)::text from public.quotations q where q.id = current_setting('test.q_acc')::uuid)
       <> current_setting('test.q_acc_before')
     or (select jsonb_agg(to_jsonb(i) order by i.sort_order)::text
         from public.quotation_items i where i.quotation_id = current_setting('test.q_acc')::uuid)
       <> current_setting('test.q_acc_items_before') then
    raise exception 'FAIL: editing the converted order modified the source quotation';
  end if;
end $$;

reset role;

-- -----------------------------------------------------------------------------
-- Employee: view, create, convert, edit draft, confirm; nothing else
-- -----------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"c2000000-0000-4000-8000-00000000000e","role":"authenticated"}', true);

do $$
declare
  v_so  uuid;
  v_s   text;
begin
  if not exists (select 1 from public.sales_orders where id = current_setting('test.so1')::uuid)
     or not exists (select 1 from public.sales_order_items where sales_order_id = current_setting('test.so1')::uuid)
     or public.get_sales_order(current_setting('test.org_a')::uuid, current_setting('test.so1')::uuid) is null then
    raise exception 'FAIL: employee cannot read sales orders';
  end if;

  -- Conversion by an employee; numbering continued without gaps after the
  -- failed conversions above.
  v_so := public.create_sales_order_from_quotation(current_setting('test.q_acc2')::uuid, date '2026-11-06', null);
  if (select sales_order_number from public.sales_orders where id = v_so) <> 'SO-000008'
     or (select created_by from public.sales_orders where id = v_so) <> 'c2000000-0000-4000-8000-00000000000e' then
    raise exception 'FAIL: employee conversion: number or created_by wrong';
  end if;
  perform set_config('test.so_conv2', v_so::text, true);   -- converted, stays draft

  v_so := public.create_sales_order(current_setting('test.cust_a')::uuid, date '2026-11-04', null, null,
    jsonb_build_array(jsonb_build_object('product_id', current_setting('test.prod_a')::uuid, 'quantity', '1')));
  if (select sales_order_number from public.sales_orders where id = v_so) <> 'SO-000009' then
    raise exception 'FAIL: employee create number wrong';
  end if;

  perform public.update_sales_order_draft(v_so, current_setting('test.cust_a')::uuid, date '2026-11-04', null, 'Edited',
    jsonb_build_array(jsonb_build_object('product_id', current_setting('test.prod_a')::uuid, 'quantity', '2')));
  if (select notes from public.sales_orders where id = v_so) <> 'Edited' then
    raise exception 'FAIL: employee cannot edit a draft';
  end if;

  foreach v_s in array array['completed', 'cancelled'] loop
    begin
      perform public.set_sales_order_status(v_so, v_s);
      raise exception 'FAIL: employee set draft to %', v_s;
    exception when insufficient_privilege then null;
    end;
  end loop;

  perform public.set_sales_order_status(v_so, 'confirmed');
  if (select status from public.sales_orders where id = v_so) <> 'confirmed' then
    raise exception 'FAIL: employee cannot confirm';
  end if;

  foreach v_s in array array['completed', 'cancelled'] loop
    begin
      perform public.set_sales_order_status(v_so, v_s);
      raise exception 'FAIL: employee set confirmed to %', v_s;
    exception when insufficient_privilege then null;
    end;
  end loop;
  if (select status from public.sales_orders where id = v_so) <> 'confirmed' then
    raise exception 'FAIL: employee changed a confirmed sales order';
  end if;
end $$;

reset role;

-- -----------------------------------------------------------------------------
-- Manager: status transitions
-- -----------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"c2000000-0000-4000-8000-00000000000c","role":"authenticated"}', true);

do $$
declare
  v_items jsonb := jsonb_build_array(jsonb_build_object(
    'product_id', current_setting('test.prod_a')::uuid, 'quantity', '1'));
  v_so    uuid;
  v_case  record;
  v_from  text;
  v_to    text;
begin
  for v_case in
    select * from (values
      ('confirmed', array['confirmed']),
      ('cancelled', array['cancelled']),
      ('completed', array['confirmed', 'completed']),
      ('cancelled', array['confirmed', 'cancelled'])
    ) as t (final, steps)
  loop
    v_so := public.create_sales_order(current_setting('test.cust_a')::uuid, date '2026-11-04', null, null, v_items);
    foreach v_to in array v_case.steps loop
      perform public.set_sales_order_status(v_so, v_to);
    end loop;
    if (select status from public.sales_orders where id = v_so) <> v_case.final then
      raise exception 'FAIL: path % did not end in %', v_case.steps, v_case.final;
    end if;
    perform set_config('test.so_' || array_to_string(v_case.steps, '_'), v_so::text, true);
  end loop;

  for v_case in
    select * from (values
      ('confirmed',            array['confirmed']),
      ('confirmed_completed',  array['confirmed', 'completed', 'cancelled']),
      ('confirmed_cancelled',  array['confirmed', 'completed', 'cancelled']),
      ('cancelled',            array['confirmed', 'completed', 'cancelled'])
    ) as t (key, targets)
  loop
    v_so := current_setting('test.so_' || v_case.key)::uuid;
    v_from := (select status from public.sales_orders where id = v_so);
    foreach v_to in array v_case.targets loop
      begin
        perform public.set_sales_order_status(v_so, v_to);
        raise exception 'FAIL: % -> % accepted', v_from, v_to;
      exception when object_not_in_prerequisite_state then null;
      end;
    end loop;
  end loop;

  v_so := public.create_sales_order(current_setting('test.cust_a')::uuid, date '2026-11-04', null, null, v_items);
  begin
    perform public.set_sales_order_status(v_so, 'completed');
    raise exception 'FAIL: draft -> completed accepted';
  exception when object_not_in_prerequisite_state then null;
  end;

  foreach v_to in array array['draft', 'bogus', 'CONFIRMED', '', 'sent', 'accepted'] loop
    begin
      perform public.set_sales_order_status(v_so, v_to);
      raise exception 'FAIL: status % accepted', v_to;
    exception when invalid_parameter_value then null;
    end;
  end loop;
  begin
    perform public.set_sales_order_status(v_so, null);
    raise exception 'FAIL: null status accepted';
  exception when invalid_parameter_value then null;
  end;
  if (select status from public.sales_orders where id = v_so) <> 'draft' then
    raise exception 'FAIL: rejected transitions changed the status';
  end if;

  -- The manager can also convert and complete a converted order.
  v_so := current_setting('test.so_conv')::uuid;
  perform public.set_sales_order_status(v_so, 'confirmed');
  perform public.set_sales_order_status(v_so, 'completed');
  if (select status from public.quotations where id = current_setting('test.q_acc')::uuid) <> 'accepted' then
    raise exception 'FAIL: sales order status change touched the quotation';
  end if;
end $$;

reset role;

-- -----------------------------------------------------------------------------
-- Immutability after confirmed
-- -----------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"c2000000-0000-4000-8000-00000000000a","role":"authenticated"}', true);

do $$
declare
  v_so uuid := current_setting('test.so1')::uuid;
begin
  perform public.set_sales_order_status(v_so, 'confirmed');
  begin
    perform public.update_sales_order_draft(v_so, current_setting('test.cust_a')::uuid,
      date '2026-11-05', null, 'late edit',
      jsonb_build_array(jsonb_build_object('product_id', current_setting('test.prod_a')::uuid, 'quantity', '9')));
    raise exception 'FAIL: confirmed sales order edited';
  exception when object_not_in_prerequisite_state then null;
  end;
  begin
    perform public.update_sales_order_draft(current_setting('test.so_conv')::uuid,
      current_setting('test.cust_later')::uuid, date '2026-11-05', null, null,
      jsonb_build_array(jsonb_build_object('product_id', current_setting('test.prod_a')::uuid, 'quantity', '9')));
    raise exception 'FAIL: completed sales order edited';
  exception when object_not_in_prerequisite_state then null;
  end;
  begin
    perform public.update_sales_order_draft(current_setting('test.so_cancelled')::uuid,
      current_setting('test.cust_a')::uuid, date '2026-11-05', null, null,
      jsonb_build_array(jsonb_build_object('product_id', current_setting('test.prod_a')::uuid, 'quantity', '9')));
    raise exception 'FAIL: cancelled sales order edited';
  exception when object_not_in_prerequisite_state then null;
  end;
end $$;

reset role;

-- The triggers hold for a writer that bypasses privileges and RLS.
do $$
declare
  v_so     uuid := current_setting('test.so1')::uuid;        -- confirmed
  v_draft  uuid := current_setting('test.so_draft')::uuid;   -- draft, direct
  v_conv   uuid := current_setting('test.so_conv')::uuid;    -- completed, converted
  v_item   uuid := (select id from public.sales_order_items where sales_order_id = current_setting('test.so1')::uuid limit 1);
  v_sql    text;
begin
  foreach v_sql in array array[
    format('update public.sales_orders set notes = %L where id = %L', 'x', v_so),
    format('update public.sales_orders set customer_name = %L where id = %L', 'x', v_so),
    format('update public.sales_orders set customer_id = %L where id = %L', current_setting('test.cust_a2'), v_so),
    format('update public.sales_orders set order_date = order_date + 1 where id = %L', v_so),
    format('update public.sales_orders set expected_delivery_date = order_date + 30 where id = %L', v_so),
    format('update public.sales_orders set grand_total = grand_total + 1, subtotal = subtotal + 1 where id = %L', v_so),
    format('update public.sales_order_items set quantity = 9 where id = %L', v_item),
    format('update public.sales_order_items set unit_price = 0, tax_amount = 0, line_total = 0, discount_amount = 0 where id = %L', v_item),
    format('update public.sales_order_items set tax_rate = 0, tax_amount = 0, line_total = round(quantity * unit_price, 2) - discount_amount where id = %L', v_item),
    format('update public.sales_order_items set product_name = %L where id = %L', 'x', v_item),
    format('delete from public.sales_order_items where id = %L', v_item),
    format('insert into public.sales_order_items (organization_id, sales_order_id, product_id, product_name, sku, unit,
              quantity, unit_price, tax_amount, line_total, sort_order)
            values (%L, %L, %L, %L, %L, %L, 1, 1, 0, 1, 50)',
           current_setting('test.org_a'), v_so, current_setting('test.prod_a'), 'X', 'X', 'pcs'),
    -- identity columns never change, not even on a draft
    format('update public.sales_orders set sales_order_number = %L where id = %L', 'SO-999999', v_draft),
    format('update public.sales_orders set organization_id = %L where id = %L', current_setting('test.org_b'), v_draft),
    format('update public.sales_orders set created_by = %L where id = %L', 'c2000000-0000-4000-8000-00000000000b', v_draft),
    format('update public.sales_orders set source_quotation_id = %L where id = %L', current_setting('test.q_acc3'), v_draft),
    format('update public.sales_orders set source_quotation_id = null where id = %L', v_conv),
    -- transitions are checked by the trigger too
    format('update public.sales_orders set status = %L where id = %L', 'draft', v_so),
    format('update public.sales_orders set status = %L where id = %L', 'completed', v_draft),
    format('update public.sales_orders set status = %L where id = %L', 'confirmed', v_conv)
  ] loop
    begin
      execute v_sql;
      raise exception 'FAIL: trigger allowed: %', v_sql;
    exception when object_not_in_prerequisite_state then null;
    end;
  end loop;

  -- created_by may still become NULL (auth user deleted).
  update public.sales_orders set created_by = null where id = v_so;
end $$;

-- Integrity constraints hold for any writer (postgres here).
do $$
declare
  v_draft uuid := current_setting('test.so_draft')::uuid;
  v_item  uuid := (select id from public.sales_order_items where sales_order_id = current_setting('test.so_draft')::uuid limit 1);
begin
  begin
    update public.sales_order_items set line_total = line_total + 1 where id = v_item;
    raise exception 'FAIL: inconsistent line total accepted';
  exception when check_violation then null;
  end;
  begin
    update public.sales_order_items set tax_amount = tax_amount + 0.01, line_total = line_total + 0.01 where id = v_item;
    raise exception 'FAIL: inconsistent tax amount accepted';
  exception when check_violation then null;
  end;
  begin
    update public.sales_order_items set quantity = 0 where id = v_item;
    raise exception 'FAIL: zero quantity accepted by the table';
  exception when check_violation then null;
  end;
  begin
    update public.sales_order_items set tax_rate = 101 where id = v_item;
    raise exception 'FAIL: tax rate over 100 accepted by the table';
  exception when check_violation then null;
  end;
  begin
    update public.sales_orders set grand_total = grand_total + 1 where id = v_draft;
    raise exception 'FAIL: inconsistent grand total accepted';
  exception when check_violation then null;
  end;
  begin
    update public.sales_orders set expected_delivery_date = order_date - 1 where id = v_draft;
    raise exception 'FAIL: delivery before order date accepted by the table';
  exception when check_violation then null;
  end;
  begin
    update public.sales_order_items set product_id = current_setting('test.prod_b')::uuid where id = v_item;
    raise exception 'FAIL: item linked to another tenant''s product';
  exception when foreign_key_violation then null;
  end;
  begin
    update public.sales_orders set customer_id = current_setting('test.cust_b')::uuid where id = v_draft;
    raise exception 'FAIL: sales order linked to another tenant''s customer';
  exception when foreign_key_violation then null;
  end;
  begin
    insert into public.sales_order_items (organization_id, sales_order_id, product_id, product_name, sku, unit,
                                          quantity, unit_price, tax_amount, line_total, sort_order)
    values (current_setting('test.org_b')::uuid, v_draft, current_setting('test.prod_b')::uuid,
            'X', 'X', 'pcs', 1, 1, 0, 1, 50);
    raise exception 'FAIL: item of Organization B attached to a sales order of Organization A';
  exception when foreign_key_violation then null;
  end;
  begin
    insert into public.sales_orders (organization_id, sales_order_number, customer_id, customer_name,
                                     order_date, source_quotation_id)
    values (current_setting('test.org_a')::uuid, 'SO-900001', current_setting('test.cust_a')::uuid, 'X',
            date '2026-11-04', current_setting('test.q_b')::uuid);
    raise exception 'FAIL: sales order linked to another tenant''s quotation';
  exception when foreign_key_violation then null;
  end;
  begin
    insert into public.sales_orders (organization_id, sales_order_number, customer_id, customer_name,
                                     order_date, source_quotation_id)
    values (current_setting('test.org_a')::uuid, 'SO-900002', current_setting('test.cust_a')::uuid, 'X',
            date '2026-11-04', current_setting('test.q_acc')::uuid);
    raise exception 'FAIL: second sales order for the same quotation accepted by the table';
  exception when unique_violation then null;
  end;
  begin
    insert into public.sales_orders (organization_id, sales_order_number, customer_id, customer_name, order_date)
    values (current_setting('test.org_a')::uuid, 'SO-000001', current_setting('test.cust_a')::uuid, 'X', date '2026-11-04');
    raise exception 'FAIL: duplicate sales order number accepted';
  exception when unique_violation then null;
  end;
  begin
    insert into public.sales_orders (organization_id, sales_order_number, customer_id, customer_name, order_date)
    values (current_setting('test.org_a')::uuid, 'SO-1', current_setting('test.cust_a')::uuid, 'X', date '2026-11-04');
    raise exception 'FAIL: malformed sales order number accepted';
  exception when check_violation then null;
  end;
  -- Many direct orders share source_quotation_id NULL.
  if (select count(*) from public.sales_orders
      where organization_id = current_setting('test.org_a')::uuid and source_quotation_id is null) < 5 then
    raise exception 'FAIL: direct orders limited by the source quotation uniqueness';
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- Sales orders are never deleted, in any status, by any writer (postgres
-- here). The guard fires before the item cascade, so items and the
-- source_quotation_id link survive, and the quotation still cannot be
-- converted again.
-- -----------------------------------------------------------------------------
do $$
declare
  v_case    record;
  v_items   bigint;
  v_source  uuid;
  v_status  text;
begin
  for v_case in
    select * from (values
      ('direct draft',       'test.so_draft',            'draft'),
      ('confirmed',          'test.so_confirmed',        'confirmed'),
      ('completed',          'test.so_confirmed_completed', 'completed'),
      ('cancelled (draft)',  'test.so_cancelled',        'cancelled'),
      ('cancelled (confirmed)', 'test.so_confirmed_cancelled', 'cancelled'),
      ('converted draft',    'test.so_conv2',            'draft'),
      ('converted completed', 'test.so_conv',            'completed')
    ) as t (label, setting, expected_status)
  loop
    select so.status, so.source_quotation_id into v_status, v_source
    from public.sales_orders so where so.id = current_setting(v_case.setting)::uuid;
    if v_status is distinct from v_case.expected_status then
      raise exception 'FAIL: test data: % is %, expected %', v_case.label, v_status, v_case.expected_status;
    end if;
    select count(*) into v_items from public.sales_order_items
    where sales_order_id = current_setting(v_case.setting)::uuid;

    begin
      delete from public.sales_orders where id = current_setting(v_case.setting)::uuid;
      raise exception 'FAIL: % sales order deleted', v_case.label;
    exception when object_not_in_prerequisite_state then
      if sqlerrm <> 'sales orders cannot be deleted' then
        raise exception 'FAIL: % delete raised the wrong error: %', v_case.label, sqlerrm;
      end if;
    end;

    if not exists (select 1 from public.sales_orders where id = current_setting(v_case.setting)::uuid)
       or (select count(*) from public.sales_order_items
           where sales_order_id = current_setting(v_case.setting)::uuid) <> v_items
       or v_items = 0
       or (select source_quotation_id from public.sales_orders
           where id = current_setting(v_case.setting)::uuid) is distinct from v_source then
      raise exception 'FAIL: failed delete of % changed the header, items or source link', v_case.label;
    end if;
  end loop;

  -- Converted orders really carry their link (so the checks above mean something).
  if (select source_quotation_id from public.sales_orders where id = current_setting('test.so_conv')::uuid)
       <> current_setting('test.q_acc')::uuid
     or (select source_quotation_id from public.sales_orders where id = current_setting('test.so_conv2')::uuid)
       <> current_setting('test.q_acc2')::uuid then
    raise exception 'FAIL: converted orders lost their source quotation';
  end if;

  -- Bulk deletes fail too, and so does the organization cascade.
  begin
    delete from public.sales_orders where organization_id = current_setting('test.org_a')::uuid;
    raise exception 'FAIL: bulk delete of sales orders succeeded';
  exception when object_not_in_prerequisite_state then null;
  end;
  begin
    delete from public.organizations where id = current_setting('test.org_a')::uuid;
    raise exception 'FAIL: organization delete cascaded through its sales orders';
  exception when object_not_in_prerequisite_state then null;
  end;
  if (select count(*) from public.sales_orders where organization_id = current_setting('test.org_a')::uuid) < 10 then
    raise exception 'FAIL: sales orders missing after rejected deletes';
  end if;

  -- UPDATE immutability is unchanged: still the "not a draft" rule.
  begin
    update public.sales_orders set notes = 'after delete attempt' where id = current_setting('test.so1')::uuid;
    raise exception 'FAIL: confirmed order editable after delete attempts';
  exception when object_not_in_prerequisite_state then
    if sqlerrm <> 'sales order is not a draft' then
      raise exception 'FAIL: update raised the wrong error: %', sqlerrm;
    end if;
  end;
end $$;

-- The quotations of the undeletable orders still cannot be converted again.
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"c2000000-0000-4000-8000-00000000000a","role":"authenticated"}', true);
do $$
declare
  v_q text;
begin
  foreach v_q in array array['test.q_acc', 'test.q_acc2'] loop
    begin
      perform public.create_sales_order_from_quotation(current_setting(v_q)::uuid, date '2026-11-07', null);
      raise exception 'FAIL: % converted again after a delete attempt', v_q;
    exception when unique_violation then null;
    end;
    if (select count(*) from public.sales_orders where source_quotation_id = current_setting(v_q)::uuid) <> 1 then
      raise exception 'FAIL: % does not have exactly one sales order', v_q;
    end if;
  end loop;
  -- authenticated has no DELETE privilege either.
  if has_table_privilege('authenticated', 'public.sales_orders', 'delete') then
    raise exception 'FAIL: authenticated has DELETE on sales_orders';
  end if;
end $$;
reset role;

-- -----------------------------------------------------------------------------
-- Owner B: tenant isolation
-- -----------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"c2000000-0000-4000-8000-00000000000b","role":"authenticated"}', true);

do $$
declare
  v_sa  uuid := current_setting('test.so_draft')::uuid;   -- Organization A draft
  v_so  uuid;
  v_s1  text;
  v_s2  text;
  v_e1  text;
  v_e2  text;
  v_t   text;
begin
  if exists (select 1 from public.sales_orders where organization_id = current_setting('test.org_a')::uuid)
     or exists (select 1 from public.sales_order_items where organization_id = current_setting('test.org_a')::uuid) then
    raise exception 'FAIL: user B can read Organization A sales orders or items';
  end if;
  if public.get_sales_order(current_setting('test.org_a')::uuid, v_sa) is not null
     or public.get_sales_order(current_setting('test.org_b')::uuid, v_sa) is not null then
    raise exception 'FAIL: user B read Organization A sales order through get_sales_order';
  end if;

  -- B converts B's own accepted quotation; numbering is separate.
  v_so := public.create_sales_order_from_quotation(current_setting('test.q_b')::uuid, date '2026-11-04', null);
  if (select sales_order_number from public.sales_orders where id = v_so) <> 'SO-000001'
     or (select grand_total::text from public.sales_orders where id = v_so) <> '10.00' then
    raise exception 'FAIL: Organization B conversion or numbering wrong';
  end if;

  -- B cannot convert A's accepted quotation: same as an unknown ID.
  begin
    perform public.create_sales_order_from_quotation(current_setting('test.q_acc3')::uuid, date '2026-11-04', null);
    raise exception 'FAIL: user B converted Organization A quotation';
  exception when others then v_s1 := sqlstate; v_e1 := sqlerrm;
  end;
  begin
    perform public.create_sales_order_from_quotation(gen_random_uuid(), date '2026-11-04', null);
  exception when others then v_s2 := sqlstate; v_e2 := sqlerrm;
  end;
  if v_s1 <> 'P0002' or v_s1 <> v_s2 or v_e1 <> v_e2 then
    raise exception 'FAIL: other-tenant conversion (% %) differs from unknown (% %)', v_s1, v_e1, v_s2, v_e2;
  end if;

  -- B cannot use A's customer or product.
  begin
    perform public.create_sales_order(current_setting('test.cust_a')::uuid, date '2026-11-04', null, null,
      jsonb_build_array(jsonb_build_object('product_id', current_setting('test.prod_b')::uuid, 'quantity', '1')));
    raise exception 'FAIL: user B used Organization A customer';
  exception when foreign_key_violation then null;
  end;
  begin
    perform public.update_sales_order_draft(v_so, current_setting('test.cust_b')::uuid, date '2026-11-04', null, null,
      jsonb_build_array(jsonb_build_object('product_id', current_setting('test.prod_a')::uuid, 'quantity', '1')));
    raise exception 'FAIL: user B used Organization A product';
  exception when foreign_key_violation then null;
  end;
  -- ... nor copy a line snapshot from A's order by its id.
  begin
    perform public.update_sales_order_draft(v_so, current_setting('test.cust_b')::uuid, date '2026-11-04', null, null,
      jsonb_build_array(jsonb_build_object(
        'id', (select id from public.sales_order_items where sales_order_id = v_so limit 1),
        'product_id', current_setting('test.prod_b')::uuid, 'quantity', '1'),
      jsonb_build_object('id', 'c2000000-0000-4000-8000-0000000000ff',
        'product_id', current_setting('test.prod_b')::uuid, 'quantity', '1')));
    raise exception 'FAIL: user B referenced a foreign line id';
  exception when invalid_parameter_value then null;
  end;

  -- Update and status changes of A's order fail exactly like unknown IDs.
  begin
    perform public.update_sales_order_draft(v_sa, current_setting('test.cust_b')::uuid, date '2026-11-04', null, null,
      jsonb_build_array(jsonb_build_object('product_id', current_setting('test.prod_b')::uuid, 'quantity', '1')));
    raise exception 'FAIL: user B updated Organization A sales order';
  exception when others then v_s1 := sqlstate; v_e1 := sqlerrm;
  end;
  begin
    perform public.update_sales_order_draft(gen_random_uuid(), current_setting('test.cust_b')::uuid, date '2026-11-04', null, null,
      jsonb_build_array(jsonb_build_object('product_id', current_setting('test.prod_b')::uuid, 'quantity', '1')));
  exception when others then v_s2 := sqlstate; v_e2 := sqlerrm;
  end;
  if v_s1 <> 'P0002' or v_s1 <> v_s2 or v_e1 <> v_e2 then
    raise exception 'FAIL: other-tenant update (% %) differs from unknown (% %)', v_s1, v_e1, v_s2, v_e2;
  end if;

  foreach v_t in array array['confirmed', 'cancelled', 'completed'] loop
    begin
      perform public.set_sales_order_status(v_sa, v_t);
      raise exception 'FAIL: user B changed Organization A sales order status';
    exception when others then v_s1 := sqlstate; v_e1 := sqlerrm;
    end;
    begin
      perform public.set_sales_order_status(gen_random_uuid(), v_t);
    exception when others then v_s2 := sqlstate; v_e2 := sqlerrm;
    end;
    if v_s1 <> 'P0002' or v_s1 <> v_s2 or v_e1 <> v_e2 then
      raise exception 'FAIL: other-tenant status change (% %) differs from unknown (% %)', v_s1, v_e1, v_s2, v_e2;
    end if;
  end loop;
end $$;

reset role;

do $$ begin
  if (select status from public.sales_orders where id = current_setting('test.so_draft')::uuid) <> 'draft'
     or (select notes from public.sales_orders where id = current_setting('test.so_draft')::uuid) is not null
     or exists (select 1 from public.sales_orders where source_quotation_id = current_setting('test.q_acc3')::uuid) then
    raise exception 'FAIL: Organization A data changed by user B';
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- list_sales_orders (migration 20261104140000_list_sales_orders.sql)
-- -----------------------------------------------------------------------------

-- anon cannot call it; definition: SECURITY INVOKER, STABLE SQL, fixed
-- search_path, authenticated only.
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
do $$ begin
  begin
    perform public.list_sales_orders(current_setting('test.org_a')::uuid);
    raise exception 'FAIL: anon could call list_sales_orders';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

do $$
declare
  v_fn text := 'public.list_sales_orders(uuid, text, text, uuid, integer, integer)';
begin
  if not exists (
    select 1 from pg_proc p join pg_language l on l.oid = p.prolang
    where p.oid = v_fn::regprocedure
      and not p.prosecdef and l.lanname = 'sql' and p.provolatile = 's'
      and p.proconfig @> array['search_path=""']
  ) then
    raise exception 'FAIL: list_sales_orders is not a SECURITY INVOKER, STABLE SQL function with search_path = ''''';
  end if;
  if has_function_privilege('anon', v_fn, 'execute')
     or not has_function_privilege('authenticated', v_fn, 'execute') then
    raise exception 'FAIL: list_sales_orders grants wrong';
  end if;
end $$;

-- Owner A: ordering, row content, search, filters, pagination.
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"c2000000-0000-4000-8000-00000000000a","role":"authenticated"}', true);

do $$
declare
  v_org      uuid := current_setting('test.org_a')::uuid;
  v_cust     uuid;
  v_prod     uuid;
  v_so       uuid;
  v_ids      uuid[];
  v_expected uuid[];
  v_page1    uuid[];
  v_page2    uuid[];
  v_total    bigint;
  v_n        bigint;
  v_status   text;
  v_row      record;
begin
  -- A direct order for a customer whose name contains LIKE wildcards; the
  -- customer is renamed afterwards (the list searches the snapshot).
  insert into public.customers (organization_id, name)
  values (v_org, 'Wild 100% Under_score') returning id into v_cust;
  insert into public.products (organization_id, name, sku, product_type, unit, selling_price)
  values (v_org, 'List Product', 'LST-1', 'inventory', 'pcs', 12.5) returning id into v_prod;
  v_so := public.create_sales_order(v_cust, date '2026-11-06', date '2026-11-20', null,
    jsonb_build_array(jsonb_build_object('product_id', v_prod, 'quantity', '2')));
  perform set_config('test.so_wild', v_so::text, true);
  update public.customers set name = 'Tame Renamed' where id = v_cust;

  -- No filters: every order of A, newest first, id as tie-breaker (all rows
  -- share created_at inside this transaction, so the tie-breaker decides).
  select array_agg(id order by created_at desc, id desc) into v_expected
  from public.sales_orders where organization_id = v_org;
  select array_agg(l.id order by l.ordinality), max(l.total_count) into v_ids, v_total
  from public.list_sales_orders(v_org, null, null, null, 100, 0) with ordinality as l;
  if v_ids is distinct from v_expected or v_total <> cardinality(v_expected) or v_total < 10 then
    raise exception 'FAIL: unfiltered list wrong: % rows, total %', cardinality(v_ids), v_total;
  end if;

  -- Row content of a direct order: snapshot name, exact money text, dates,
  -- no source quotation.
  select * into v_row from public.list_sales_orders(v_org, 'under_score') l;
  if v_row.id <> v_so or v_row.customer_id <> v_cust
     or v_row.customer_name <> 'Wild 100% Under_score' or v_row.status <> 'draft'
     or v_row.order_date <> date '2026-11-06' or v_row.expected_delivery_date <> date '2026-11-20'
     or v_row.grand_total <> '25.00' or pg_typeof(v_row.grand_total)::text <> 'text'
     or v_row.source_quotation_id is not null or v_row.source_quotation_number is not null
     or v_row.sales_order_number <> (select sales_order_number from public.sales_orders where id = v_so) then
    raise exception 'FAIL: list row wrong: %', row_to_json(v_row);
  end if;

  -- Row content of a converted order: the source quotation's number.
  select * into v_row from public.list_sales_orders(v_org, null, null, null, 100) l
  where l.id = current_setting('test.so_conv')::uuid;
  if v_row.source_quotation_id <> current_setting('test.q_acc')::uuid
     or v_row.source_quotation_number is distinct from
        (select quotation_number from public.quotations where id = current_setting('test.q_acc')::uuid)
     or v_row.grand_total <> (select grand_total::text from public.sales_orders where id = v_row.id) then
    raise exception 'FAIL: converted list row wrong: %', row_to_json(v_row);
  end if;

  -- Search by number: substring, any case, Unicode-padded.
  if (select array_agg(id) from public.list_sales_orders(v_org,
        lower((select sales_order_number from public.sales_orders where id = current_setting('test.so1')::uuid))))
     is distinct from array[current_setting('test.so1')::uuid] then
    raise exception 'FAIL: number search (lower case)';
  end if;
  if (select array_agg(id) from public.list_sales_orders(v_org,
        E'　' || substr((select sales_order_number from public.sales_orders where id = current_setting('test.so1')::uuid), 4) || E' '))
     is distinct from array[current_setting('test.so1')::uuid] then
    raise exception 'FAIL: padded number search';
  end if;

  -- Customer search uses the snapshot, not the current name.
  if not exists (select 1 from public.list_sales_orders(v_org, 'wild 100') where id = v_so)
     or exists (select 1 from public.list_sales_orders(v_org, 'tame renamed')) then
    raise exception 'FAIL: customer search does not use the snapshot name';
  end if;
  select count(*) into v_n from public.sales_orders where organization_id = v_org and customer_name ilike '%acme%';
  if v_n = 0
     or (select count(*) from public.list_sales_orders(v_org, 'ACME', null, null, 100)) <> v_n
     or (select max(total_count) from public.list_sales_orders(v_org, 'acme', null, null, 100)) <> v_n then
    raise exception 'FAIL: customer search count';
  end if;

  -- Wildcards are literal; whitespace-only search lists everything.
  if (select array_agg(id) from public.list_sales_orders(v_org, '%')) is distinct from array[v_so]
     or (select array_agg(id) from public.list_sales_orders(v_org, '_')) is distinct from array[v_so]
     or exists (select 1 from public.list_sales_orders(v_org, '\'))
     or exists (select 1 from public.list_sales_orders(v_org, 'no such order')) then
    raise exception 'FAIL: wildcard or no-match search';
  end if;
  if (select max(total_count) from public.list_sales_orders(v_org, E'　 ')) <> cardinality(v_expected) then
    raise exception 'FAIL: whitespace-only search did not list everything';
  end if;

  -- Status filter, alone and with a search.
  foreach v_status in array array['draft', 'confirmed', 'completed', 'cancelled'] loop
    select count(*) into v_n from public.sales_orders where organization_id = v_org and status = v_status;
    if v_n = 0 then
      raise exception 'FAIL: test data has no % sales order', v_status;
    end if;
    if (select count(*) from public.list_sales_orders(v_org, null, v_status, null, 100)) <> v_n
       or exists (select 1 from public.list_sales_orders(v_org, null, v_status, null, 100) where status <> v_status) then
      raise exception 'FAIL: status filter %', v_status;
    end if;
  end loop;
  select count(*) into v_n from public.sales_orders
  where organization_id = v_org and status = 'draft' and customer_name ilike '%acme%';
  if (select count(*) from public.list_sales_orders(v_org, 'acme', 'draft', null, 100)) <> v_n then
    raise exception 'FAIL: search combined with status filter';
  end if;
  if exists (select 1 from public.list_sales_orders(v_org, null, 'bogus')) then
    raise exception 'FAIL: unknown status matched rows';
  end if;

  -- Customer filter: own customer, a customer without orders, another
  -- tenant's customer, combined with a status.
  if (select array_agg(id) from public.list_sales_orders(v_org, null, null, v_cust)) is distinct from array[v_so]
     or exists (select 1 from public.list_sales_orders(v_org, null, null, current_setting('test.cust_inactive')::uuid))
     or exists (select 1 from public.list_sales_orders(v_org, null, null, current_setting('test.cust_b')::uuid))
     or exists (select 1 from public.list_sales_orders(v_org, null, 'confirmed', v_cust)) then
    raise exception 'FAIL: customer filter';
  end if;

  -- Pagination: consecutive slices; stable total; clamped limit/offset.
  select array_agg(l.id order by l.ordinality) into v_page1 from public.list_sales_orders(v_org, null, null, null, 4, 0) with ordinality as l;
  select array_agg(l.id order by l.ordinality) into v_page2 from public.list_sales_orders(v_org, null, null, null, 4, 4) with ordinality as l;
  if v_page1 || v_page2 is distinct from v_expected[1:8] then
    raise exception 'FAIL: pages are not consecutive slices of the ordered list';
  end if;
  if (select count(distinct total_count) from (
        select total_count from public.list_sales_orders(v_org, null, null, null, 4, 0)
        union all
        select total_count from public.list_sales_orders(v_org, null, null, null, 4, 4)) t) <> 1 then
    raise exception 'FAIL: total_count differs between pages';
  end if;
  if (select count(*) from public.list_sales_orders(v_org, null, null, null, 0, 0)) <> 1
     or (select count(*) from public.list_sales_orders(v_org, null, null, null, null, 0)) <> least(25, cardinality(v_expected))
     or (select count(*) from public.list_sales_orders(v_org, null, null, null, 1000, 0)) <> least(100, cardinality(v_expected))
     or (select array_agg(l.id order by l.ordinality) from public.list_sales_orders(v_org, null, null, null, 4, -10) with ordinality as l)
        is distinct from v_page1
     or exists (select 1 from public.list_sales_orders(v_org, null, null, null, 25, 100000)) then
    raise exception 'FAIL: limit/offset clamping';
  end if;

  -- The organization filter never widens access.
  if exists (select 1 from public.list_sales_orders(current_setting('test.org_b')::uuid))
     or exists (select 1 from public.list_sales_orders(null)) then
    raise exception 'FAIL: list_sales_orders returned rows for another or no organization';
  end if;

  -- The quotation detail page's lookup (lib/sales-orders/sales-orders.ts,
  -- getSalesOrderForQuotation): tenant filter + source quotation, one row.
  if (select count(*) from public.sales_orders
      where organization_id = v_org and source_quotation_id = current_setting('test.q_acc')::uuid) <> 1
     or exists (select 1 from public.sales_orders
                where organization_id = v_org and source_quotation_id = current_setting('test.q_b')::uuid) then
    raise exception 'FAIL: source quotation lookup wrong';
  end if;
end $$;

reset role;

-- Employee: same list as the owner.
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"c2000000-0000-4000-8000-00000000000e","role":"authenticated"}', true);
do $$ begin
  if (select max(total_count) from public.list_sales_orders(current_setting('test.org_a')::uuid))
     <> (select count(*) from public.sales_orders where organization_id = current_setting('test.org_a')::uuid) then
    raise exception 'FAIL: employee list differs';
  end if;
end $$;
reset role;

-- Owner B: nothing of A, whatever the filters; B's own list holds only B's
-- converted order, with B's quotation number.
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"c2000000-0000-4000-8000-00000000000b","role":"authenticated"}', true);
do $$ begin
  if exists (select 1 from public.list_sales_orders(current_setting('test.org_a')::uuid))
     or exists (select 1 from public.list_sales_orders(current_setting('test.org_a')::uuid, 'SO'))
     or exists (select 1 from public.list_sales_orders(current_setting('test.org_a')::uuid, null, 'draft'))
     or exists (select 1 from public.list_sales_orders(current_setting('test.org_a')::uuid, null, null,
                                                       current_setting('test.cust_a')::uuid)) then
    raise exception 'FAIL: user B listed Organization A sales orders';
  end if;
  if (select count(*) from public.list_sales_orders(current_setting('test.org_b')::uuid)) <> 1
     or exists (select 1 from public.list_sales_orders(current_setting('test.org_b')::uuid) l
                where l.customer_id <> current_setting('test.cust_b')::uuid
                   or l.source_quotation_id <> current_setting('test.q_b')::uuid
                   or l.source_quotation_number is null)
     or exists (select 1 from public.list_sales_orders(current_setting('test.org_b')::uuid, null, null,
                                                       current_setting('test.cust_a')::uuid)) then
    raise exception 'FAIL: user B list wrong';
  end if;
  -- B cannot find A's order for A's quotation either.
  if exists (select 1 from public.sales_orders where source_quotation_id = current_setting('test.q_acc')::uuid) then
    raise exception 'FAIL: user B found Organization A order by source quotation';
  end if;
end $$;
reset role;

-- -----------------------------------------------------------------------------
-- Disabled member: no access at all
-- -----------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"c2000000-0000-4000-8000-00000000000d","role":"authenticated"}', true);

do $$ begin
  if exists (select 1 from public.sales_orders) or exists (select 1 from public.sales_order_items) then
    raise exception 'FAIL: disabled member can read sales orders';
  end if;
  if public.get_sales_order(current_setting('test.org_a')::uuid, current_setting('test.so_draft')::uuid) is not null then
    raise exception 'FAIL: disabled member read a sales order through get_sales_order';
  end if;
  if exists (select 1 from public.list_sales_orders(current_setting('test.org_a')::uuid)) then
    raise exception 'FAIL: disabled member listed sales orders';
  end if;
  begin
    perform public.create_sales_order(current_setting('test.cust_a')::uuid, date '2026-11-04', null, null,
      jsonb_build_array(jsonb_build_object('product_id', current_setting('test.prod_a')::uuid, 'quantity', '1')));
    raise exception 'FAIL: disabled member created a sales order';
  exception when foreign_key_violation then null;
  end;
  begin
    perform public.create_sales_order_from_quotation(current_setting('test.q_acc3')::uuid, date '2026-11-04', null);
    raise exception 'FAIL: disabled member converted a quotation';
  exception when no_data_found then null;
  end;
  begin
    perform public.update_sales_order_draft(current_setting('test.so_draft')::uuid, current_setting('test.cust_a')::uuid,
      date '2026-11-04', null, null,
      jsonb_build_array(jsonb_build_object('product_id', current_setting('test.prod_a')::uuid, 'quantity', '1')));
    raise exception 'FAIL: disabled member updated a sales order';
  exception when no_data_found then null;
  end;
  begin
    perform public.set_sales_order_status(current_setting('test.so_draft')::uuid, 'confirmed');
    raise exception 'FAIL: disabled member changed a sales order status';
  exception when no_data_found then null;
  end;
end $$;

reset role;

-- A manager disabled later loses access at once.
update public.organization_members set status = 'disabled'
where user_id = 'c2000000-0000-4000-8000-00000000000c';

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"c2000000-0000-4000-8000-00000000000c","role":"authenticated"}', true);

do $$ begin
  if exists (select 1 from public.sales_orders)
     or public.get_sales_order(current_setting('test.org_a')::uuid, current_setting('test.so_draft')::uuid) is not null then
    raise exception 'FAIL: newly disabled manager can still read sales orders';
  end if;
  if exists (select 1 from public.list_sales_orders(current_setting('test.org_a')::uuid)) then
    raise exception 'FAIL: newly disabled manager listed sales orders';
  end if;
  begin
    perform public.set_sales_order_status(current_setting('test.so_draft')::uuid, 'cancelled');
    raise exception 'FAIL: newly disabled manager changed a sales order status';
  exception when no_data_found then null;
  end;
  begin
    perform public.create_sales_order_from_quotation(current_setting('test.q_acc3')::uuid, date '2026-11-04', null);
    raise exception 'FAIL: newly disabled manager converted a quotation';
  exception when no_data_found then null;
  end;
  begin
    perform public.update_sales_order_draft(current_setting('test.so_draft')::uuid, current_setting('test.cust_a')::uuid,
      date '2026-11-04', null, null,
      jsonb_build_array(jsonb_build_object('product_id', current_setting('test.prod_a')::uuid, 'quantity', '1')));
    raise exception 'FAIL: newly disabled manager updated a sales order';
  exception when no_data_found then null;
  end;
  begin
    perform public.create_sales_order(current_setting('test.cust_a')::uuid, date '2026-11-04', null, null,
      jsonb_build_array(jsonb_build_object('product_id', current_setting('test.prod_a')::uuid, 'quantity', '1')));
    raise exception 'FAIL: newly disabled manager created a sales order';
  exception when foreign_key_violation then null;
  end;
end $$;

reset role;

select 'ALL SALES ORDER CHECKS PASSED' as result;

rollback;
