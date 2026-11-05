-- =============================================================================
-- Invoices: direct creation, sales order conversion, numbering, calculations,
-- snapshots, amount_paid / amount_due, draft editing, status model (user and
-- reserved payment statuses), immutability, no hard delete, role
-- permissions, direct API protection and tenant isolation.
--
-- How to run: paste this into the Supabase SQL Editor (it runs as `postgres`)
-- after applying the migrations up to 20261104160000_list_invoices.sql.
-- Everything runs in one transaction that is ROLLED BACK at the end, so no
-- data is left behind. Run it separately from the other suites.
--
-- Same structure as sales_orders.sql: it switches to the `authenticated` role
-- with JWT claims to simulate API users. A few checks run as `postgres` on
-- purpose, to prove the triggers and constraints hold for any writer.
--
-- Users
--   A  owner of Organization A        M  manager of Organization A
--   E  employee of Organization A     D  disabled member of Organization A
--   B  owner of Organization B
--
-- Success: the last result shows 'ALL INVOICE CHECKS PASSED'.
-- Failure: it stops with an error that starts with 'FAIL:'.
-- =============================================================================

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('c3000000-0000-4000-8000-00000000000a', 'inv-test-a@example.com', '{"full_name":"Owner A"}'),
  ('c3000000-0000-4000-8000-00000000000b', 'inv-test-b@example.com', '{"full_name":"Owner B"}'),
  ('c3000000-0000-4000-8000-00000000000c', 'inv-test-m@example.com', '{"full_name":"Manager A"}'),
  ('c3000000-0000-4000-8000-00000000000d', 'inv-test-d@example.com', '{"full_name":"Disabled A"}'),
  ('c3000000-0000-4000-8000-00000000000e', 'inv-test-e@example.com', '{"full_name":"Employee A"}');

-- -----------------------------------------------------------------------------
-- Organizations A and B
-- -----------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"c3000000-0000-4000-8000-00000000000a","role":"authenticated"}', true);
select set_config('test.org_a', public.create_organization('Invoice Org A', 'BDT', 'Asia/Dhaka')::text, true);
reset role;

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"c3000000-0000-4000-8000-00000000000b","role":"authenticated"}', true);
select set_config('test.org_b', public.create_organization('Invoice Org B', 'USD', 'UTC')::text, true);
reset role;

insert into public.organization_members (organization_id, user_id, role, status) values
  (current_setting('test.org_a')::uuid, 'c3000000-0000-4000-8000-00000000000c', 'manager',  'active'),
  (current_setting('test.org_a')::uuid, 'c3000000-0000-4000-8000-00000000000e', 'employee', 'active'),
  (current_setting('test.org_a')::uuid, 'c3000000-0000-4000-8000-00000000000d', 'employee', 'disabled');

-- -----------------------------------------------------------------------------
-- Master data and sales orders. Owner B first, then owner A.
-- -----------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"c3000000-0000-4000-8000-00000000000b","role":"authenticated"}', true);

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

  -- A confirmed sales order of Organization B.
  v_id := public.create_sales_order(current_setting('test.cust_b')::uuid, date '2026-11-04', null, null,
    jsonb_build_array(jsonb_build_object('product_id', current_setting('test.prod_b')::uuid, 'quantity', '2')));
  perform public.set_sales_order_status(v_id, 'confirmed');
  perform set_config('test.so_b', v_id::text, true);
end $$;

reset role;

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"c3000000-0000-4000-8000-00000000000a","role":"authenticated"}', true);

do $$
declare
  v_org   uuid := current_setting('test.org_a')::uuid;
  v_id    uuid;
  v_s     text;
  v_line  jsonb;
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

  -- Customer of the confirmed sales order; renamed and deactivated later.
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

  -- Products of the confirmed sales order; renamed / repriced / deactivated later.
  insert into public.products (organization_id, name, sku, product_type, unit, description, selling_price)
  values (v_org, 'Conv Widget', 'CW-1', 'inventory', 'box', 'Widget desc', 40)
  returning id into v_id;
  perform set_config('test.prod_conv', v_id::text, true);

  insert into public.products (organization_id, name, sku, product_type, unit, description, selling_price)
  values (v_org, 'Later Gadget', 'LG-1', 'inventory', 'pcs', 'Gadget desc', 12.5)
  returning id into v_id;
  perform set_config('test.prod_later', v_id::text, true);

  -- The confirmed sales order that will be invoiced.
  --   line 1: 2.5 x 90.00 = 225.00, discount 10, tax 15% of 215.00 = 32.25 -> 247.25
  --   line 2: 3 x 12.50 = 37.50, tax 7.5% = 2.8125 -> 2.81 -> 40.31
  --   totals 262.50 / 10.00 / 35.06 / 287.56
  v_id := public.create_sales_order(current_setting('test.cust_later')::uuid, date '2026-11-01', null,
    'Agreed terms',
    jsonb_build_array(
      jsonb_build_object('product_id', current_setting('test.prod_conv')::uuid, 'quantity', '2.5',
                         'unit_price', '90.00', 'discount_amount', '10', 'tax_rate', '15'),
      jsonb_build_object('product_id', current_setting('test.prod_later')::uuid, 'quantity', '3',
                         'tax_rate', '7.5', 'description', 'Custom later')));
  perform public.set_sales_order_status(v_id, 'confirmed');
  perform set_config('test.so_conf', v_id::text, true);

  -- Two more confirmed orders (employee conversion; cancelled-invoice case).
  v_line := jsonb_build_array(jsonb_build_object('product_id', current_setting('test.prod_a')::uuid, 'quantity', '1'));
  foreach v_s in array array['test.so_conf2', 'test.so_conf3'] loop
    v_id := public.create_sales_order(current_setting('test.cust_a')::uuid, date '2026-11-02', null, null, v_line);
    perform public.set_sales_order_status(v_id, 'confirmed');
    perform set_config(v_s, v_id::text, true);
  end loop;

  -- Sales orders in every other status.
  v_id := public.create_sales_order(current_setting('test.cust_a')::uuid, date '2026-11-02', null, null, v_line);
  perform set_config('test.so_draft', v_id::text, true);

  v_id := public.create_sales_order(current_setting('test.cust_a')::uuid, date '2026-11-02', null, null, v_line);
  perform public.set_sales_order_status(v_id, 'confirmed');
  perform public.set_sales_order_status(v_id, 'completed');
  perform set_config('test.so_completed', v_id::text, true);

  v_id := public.create_sales_order(current_setting('test.cust_a')::uuid, date '2026-11-02', null, null, v_line);
  perform public.set_sales_order_status(v_id, 'cancelled');
  perform set_config('test.so_cancelled', v_id::text, true);

  v_id := public.create_sales_order(current_setting('test.cust_a')::uuid, date '2026-11-02', null, null, v_line);
  perform public.set_sales_order_status(v_id, 'confirmed');
  perform public.set_sales_order_status(v_id, 'cancelled');
  perform set_config('test.so_conf_cancelled', v_id::text, true);

  -- After confirmation, the master data changes.
  update public.customers set name = 'Later Renamed', email = 'renamed@buyer.test'
  where id = current_setting('test.cust_later')::uuid;
  perform public.set_customer_status(current_setting('test.cust_later')::uuid, 'inactive');
  update public.products set name = 'Conv Renamed', sku = 'CW-NEW', selling_price = 999
  where id = current_setting('test.prod_conv')::uuid;
  perform public.set_product_status(current_setting('test.prod_later')::uuid, 'inactive');

  -- The source sales order as it is now, to prove conversion never changes it.
  perform set_config('test.so_conf_before',
    (select to_jsonb(so)::text from public.sales_orders so where so.id = current_setting('test.so_conf')::uuid), true);
  perform set_config('test.so_conf_items_before',
    (select jsonb_agg(to_jsonb(i) order by i.sort_order)::text
     from public.sales_order_items i where i.sales_order_id = current_setting('test.so_conf')::uuid), true);
end $$;

reset role;

-- -----------------------------------------------------------------------------
-- anon: no access
-- -----------------------------------------------------------------------------
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);

do $$ begin
  begin
    perform 1 from public.invoices;
    raise exception 'FAIL: anon could select invoices';
  exception when insufficient_privilege then null;
  end;
  begin
    perform 1 from public.invoice_items;
    raise exception 'FAIL: anon could select invoice items';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.create_invoice(gen_random_uuid(), current_date, null, null, '[]'::jsonb);
    raise exception 'FAIL: anon could call create_invoice';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.create_invoice_from_sales_order(gen_random_uuid(), current_date, null);
    raise exception 'FAIL: anon could call create_invoice_from_sales_order';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.update_invoice_draft(gen_random_uuid(), gen_random_uuid(), current_date, null, null, '[]'::jsonb);
    raise exception 'FAIL: anon could call update_invoice_draft';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.set_invoice_status(gen_random_uuid(), 'issued');
    raise exception 'FAIL: anon could call set_invoice_status';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.get_invoice(gen_random_uuid(), gen_random_uuid());
    raise exception 'FAIL: anon could call get_invoice';
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
    'public.create_invoice(uuid, date, date, text, jsonb)',
    'public.create_invoice_from_sales_order(uuid, date, date)',
    'public.update_invoice_draft(uuid, uuid, date, date, text, jsonb)',
    'public.set_invoice_status(uuid, text)'
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
    'public.invoice_replace_items(uuid, uuid, jsonb)',
    'public.invoice_recompute_totals(uuid, uuid)',
    'public.invoice_normalize_header(date, date, text)',
    'public.invoice_status_transition_allowed(text, text)',
    'public.invoices_enforce_rules()',
    'public.invoice_items_enforce_draft()',
    'public.sales_orders_block_invoiced_cancel()'
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
    where p.oid = 'public.get_invoice(uuid, uuid)'::regprocedure
      and not p.prosecdef and l.lanname = 'sql' and p.provolatile = 's'
      and p.proconfig @> array['search_path=""']
  ) then
    raise exception 'FAIL: get_invoice is not a SECURITY INVOKER, STABLE SQL function with search_path = ''''';
  end if;
  if has_function_privilege('anon', 'public.get_invoice(uuid, uuid)', 'execute')
     or not has_function_privilege('authenticated', 'public.get_invoice(uuid, uuid)', 'execute') then
    raise exception 'FAIL: get_invoice grants wrong';
  end if;

  if pg_get_functiondef('public.set_invoice_status(uuid, text)'::regprocedure)
     !~* 'has_org_role\(inv\.organization_id, v_roles\)\s+for update' then
    raise exception 'FAIL: set_invoice_status locks without the authorization predicate';
  end if;
  if pg_get_functiondef('public.create_invoice_from_sales_order(uuid, date, date)'::regprocedure)
     !~* 'so\.organization_id = v_org_id\s+for share' then
    raise exception 'FAIL: create_invoice_from_sales_order does not lock the authorized sales order';
  end if;

  if has_table_privilege('authenticated', 'public.invoices', 'insert')
     or has_table_privilege('authenticated', 'public.invoices', 'update')
     or has_table_privilege('authenticated', 'public.invoices', 'delete')
     or has_table_privilege('authenticated', 'public.invoice_items', 'insert')
     or has_table_privilege('authenticated', 'public.invoice_items', 'update')
     or has_table_privilege('authenticated', 'public.invoice_items', 'delete')
     or has_any_column_privilege('authenticated', 'public.invoices', 'insert')
     or has_any_column_privilege('authenticated', 'public.invoices', 'update')
     or has_any_column_privilege('authenticated', 'public.invoice_items', 'insert')
     or has_any_column_privilege('authenticated', 'public.invoice_items', 'update')
     or has_table_privilege('anon', 'public.invoices', 'select')
     or has_table_privilege('anon', 'public.invoice_items', 'select') then
    raise exception 'FAIL: API roles have a write privilege on invoice tables (or anon can read)';
  end if;

  if not exists (select 1 from pg_trigger
                 where tgrelid = 'public.sales_orders'::regclass
                   and tgname = 'sales_orders_block_invoiced_cancel' and tgenabled = 'O') then
    raise exception 'FAIL: sales_orders has no enabled invoiced-cancel guard';
  end if;

  if pg_get_constraintdef((select oid from pg_constraint
       where conname = 'document_number_counters_type_check')) !~ 'invoice' then
    raise exception 'FAIL: document_number_counters does not allow invoice';
  end if;

  -- The transition table: user and reserved payment transitions, nothing else.
  if (select string_agg(f || '>' || t, ',' order by f, t)
      from unnest(array['draft','issued','partially_paid','paid','cancelled']) f,
           unnest(array['draft','issued','partially_paid','paid','cancelled']) t
      where public.invoice_status_transition_allowed(f, t))
     <> 'draft>cancelled,draft>issued,issued>cancelled,issued>paid,issued>partially_paid,partially_paid>paid' then
    raise exception 'FAIL: invoice transition table wrong';
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- Owner A: direct creation, numbering, snapshots, totals, balance
-- -----------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"c3000000-0000-4000-8000-00000000000a","role":"authenticated"}', true);

do $$
declare
  v_org     uuid := current_setting('test.org_a')::uuid;
  v_cust    uuid := current_setting('test.cust_a')::uuid;
  v_prod    uuid := current_setting('test.prod_a')::uuid;
  v_service uuid := current_setting('test.prod_service')::uuid;
  v_inv     uuid;
  v_row     record;
  v_item    record;
begin
  -- Forged snapshot, amount, balance, id-like and status keys are ignored.
  v_inv := public.create_invoice(v_cust, date '2026-11-04', date '2026-12-04', E'  Thanks! ',
    jsonb_build_array(
      jsonb_build_object('product_id', v_prod, 'quantity', '2.5', 'discount_amount', '10.00',
                         'tax_rate', '15', 'product_name', 'FORGED', 'sku', 'FORGED',
                         'unit', 'kg', 'tax_amount', '0', 'line_total', '1',
                         'amount_paid', '383.49', 'amount_due', '0', 'status', 'paid',
                         'invoice_number', 'INV-999999',
                         'organization_id', current_setting('test.org_b'),
                         'invoice_id', gen_random_uuid()),
      jsonb_build_object('product_id', v_service, 'quantity', 3, 'unit_price', '33.33',
                         'tax_rate', 7.5, 'description', E'  Custom setup 　')));
  perform set_config('test.inv1', v_inv::text, true);

  select * into v_row from public.invoices where id = v_inv;
  if v_row.invoice_number <> 'INV-000001' then
    raise exception 'FAIL: first number is %, expected INV-000001', v_row.invoice_number;
  end if;
  if v_row.organization_id <> v_org or v_row.status <> 'draft'
     or v_row.created_by <> 'c3000000-0000-4000-8000-00000000000a'
     or v_row.source_sales_order_id is not null then
    raise exception 'FAIL: organization, status, created_by or source not derived correctly';
  end if;
  if v_row.customer_name <> 'Acme Buyer' or v_row.customer_company_name <> 'Acme Ltd'
     or v_row.customer_phone <> '+880 1711 000000' or v_row.customer_email <> 'buyer@acme.test'
     or v_row.customer_address <> 'Dhaka' or v_row.customer_tax_number <> 'BIN-1' then
    raise exception 'FAIL: customer snapshot wrong';
  end if;
  if v_row.notes <> 'Thanks!' or v_row.invoice_date <> date '2026-11-04'
     or v_row.due_date <> date '2026-12-04' then
    raise exception 'FAIL: header wrong: %', row_to_json(v_row);
  end if;
  if v_row.subtotal::text <> '349.99' or v_row.discount_total::text <> '10.00'
     or v_row.tax_total::text <> '43.50' or v_row.grand_total::text <> '383.49' then
    raise exception 'FAIL: totals % % % %', v_row.subtotal, v_row.discount_total,
      v_row.tax_total, v_row.grand_total;
  end if;
  if v_row.amount_paid::text <> '0.00' or v_row.amount_due::text <> '383.49' then
    raise exception 'FAIL: initial balance % / %', v_row.amount_paid, v_row.amount_due;
  end if;

  select * into v_item from public.invoice_items where invoice_id = v_inv and sort_order = 1;
  if v_item.product_name <> 'Laptop' or v_item.sku <> 'LAP-1' or v_item.unit <> 'pcs'
     or v_item.description <> 'Laptop desc' or v_item.unit_price::text <> '100.00'
     or v_item.quantity::text <> '2.500' or v_item.tax_amount::text <> '36.00'
     or v_item.line_total::text <> '276.00' or v_item.organization_id <> v_org then
    raise exception 'FAIL: item 1 snapshot or amounts wrong: %', row_to_json(v_item);
  end if;
  select * into v_item from public.invoice_items where invoice_id = v_inv and sort_order = 2;
  if v_item.product_name <> 'Setup' or v_item.unit <> 'hour'
     or v_item.description <> 'Custom setup' or v_item.unit_price::text <> '33.33'
     or v_item.tax_rate::text <> '7.50' or v_item.tax_amount::text <> '7.50'
     or v_item.line_total::text <> '107.49' then
    raise exception 'FAIL: item 2 override or amounts wrong: %', row_to_json(v_item);
  end if;

  -- Rounding (half up), decimal quantities, discount equal to gross.
  v_inv := public.create_invoice(v_cust, date '2026-11-04', null, null,
    jsonb_build_array(
      jsonb_build_object('product_id', v_prod, 'quantity', '1.005', 'unit_price', '1.00'),
      jsonb_build_object('product_id', v_prod, 'quantity', '1', 'unit_price', '10.00', 'tax_rate', '0.05'),
      jsonb_build_object('product_id', v_prod, 'quantity', '0.001', 'unit_price', '0.01'),
      jsonb_build_object('product_id', v_prod, 'quantity', '3', 'unit_price', '19.99',
                         'discount_amount', '0.97', 'tax_rate', '12.5', 'description', null),
      jsonb_build_object('product_id', v_prod, 'quantity', '1', 'unit_price', '5',
                         'discount_amount', '5')));

  select * into v_row from public.invoices where id = v_inv;
  if v_row.invoice_number <> 'INV-000002' or v_row.due_date is not null then
    raise exception 'FAIL: second invoice number or optional due date';
  end if;
  if (select string_agg(line_total::text, ',' order by sort_order)
      from public.invoice_items where invoice_id = v_inv) <> '1.01,10.01,0.00,66.38,0.00' then
    raise exception 'FAIL: line rounding wrong';
  end if;
  if (select description from public.invoice_items where invoice_id = v_inv and sort_order = 4) is not null
     or (select description from public.invoice_items where invoice_id = v_inv and sort_order = 1) <> 'Laptop desc' then
    raise exception 'FAIL: description default / explicit null';
  end if;
  if v_row.subtotal::text <> '75.98' or v_row.discount_total::text <> '5.97'
     or v_row.tax_total::text <> '7.39' or v_row.grand_total::text <> '77.40'
     or v_row.amount_paid::text <> '0.00' or v_row.amount_due::text <> '77.40'
     or v_row.grand_total <> (select sum(line_total) from public.invoice_items where invoice_id = v_inv) then
    raise exception 'FAIL: rounding totals % % % % / % %', v_row.subtotal, v_row.discount_total,
      v_row.tax_total, v_row.grand_total, v_row.amount_paid, v_row.amount_due;
  end if;

  -- 100 items is the maximum and allowed; due date may equal invoice date.
  v_inv := public.create_invoice(v_cust, date '2026-11-04', date '2026-11-04', null,
    (select jsonb_agg(jsonb_build_object('product_id', v_prod, 'quantity', '1'))
     from generate_series(1, 100)));
  if (select count(*) from public.invoice_items where invoice_id = v_inv) <> 100
     or (select invoice_number from public.invoices where id = v_inv) <> 'INV-000003'
     or (select grand_total::text || '/' || amount_due::text from public.invoices where id = v_inv)
        <> '10000.00/10000.00' then
    raise exception 'FAIL: 100-item invoice';
  end if;

  -- 2000 code points of notes and description are accepted; U+2028 trimmed.
  v_inv := public.create_invoice(v_cust, date '2026-11-04', null, E' ' || repeat('😀', 2000),
    jsonb_build_array(jsonb_build_object('product_id', v_prod, 'quantity', '1',
                                         'description', repeat('😀', 2000) || E' ')));
  if (select char_length(notes) from public.invoices where id = v_inv) <> 2000
     or (select char_length(description) from public.invoice_items where invoice_id = v_inv) <> 2000
     or (select invoice_number from public.invoices where id = v_inv) <> 'INV-000004' then
    raise exception 'FAIL: 2000-code-point notes / description or fourth number';
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
  v_inv   uuid;
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
      ('negative quantity',      jsonb_build_array(jsonb_build_object('product_id', v_prod, 'quantity', '-1')), '22023'),
      ('4-decimal quantity',     jsonb_build_array(jsonb_build_object('product_id', v_prod, 'quantity', '1.0001')), '22023'),
      ('text quantity',          jsonb_build_array(jsonb_build_object('product_id', v_prod, 'quantity', 'abc')), '22023'),
      ('NaN quantity',           jsonb_build_array(jsonb_build_object('product_id', v_prod, 'quantity', 'NaN')), '22023'),
      ('exponent quantity',      jsonb_build_array(jsonb_build_object('product_id', v_prod, 'quantity', '1e3')), '22023'),
      ('missing quantity',       jsonb_build_array(jsonb_build_object('product_id', v_prod)), '22023'),
      ('negative price',         jsonb_build_array(jsonb_build_object('product_id', v_prod, 'quantity', '1', 'unit_price', '-1')), '22023'),
      ('3-decimal price',        jsonb_build_array(jsonb_build_object('product_id', v_prod, 'quantity', '1', 'unit_price', '1.001')), '22023'),
      ('NaN price',              jsonb_build_array(jsonb_build_object('product_id', v_prod, 'quantity', '1', 'unit_price', 'NaN')), '22023'),
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
      ('product deactivated after a sales order', jsonb_build_array(jsonb_build_object('product_id', current_setting('test.prod_later')::uuid, 'quantity', '1')), '23503'),
      ('other tenant product',   jsonb_build_array(jsonb_build_object('product_id', current_setting('test.prod_b')::uuid, 'quantity', '1')), '23503')
    ) as t (label, items, expected)
  loop
    begin
      perform public.create_invoice(v_cust, date '2026-11-04', null, null, v_case.items);
      raise exception 'FAIL: % accepted', v_case.label;
    exception when others then
      if sqlstate <> v_case.expected then
        raise exception 'FAIL: % raised % (%), expected %', v_case.label, sqlstate, sqlerrm, v_case.expected;
      end if;
    end;
  end loop;

  begin
    perform public.create_invoice(v_cust, date '2026-11-04', null, null,
      (select jsonb_agg(jsonb_build_object('product_id', v_prod, 'quantity', '1'))
       from generate_series(1, 101)));
    raise exception 'FAIL: 101 items accepted';
  exception when invalid_parameter_value then null;
  end;

  -- Header input
  for v_case in
    select * from (values
      ('missing invoice date',      null::date,           null::date,           null::text),
      ('infinite invoice date',     'infinity'::date,     null::date,           null::text),
      ('-infinite invoice date',    '-infinity'::date,    null::date,           null::text),
      ('due before invoice date',   date '2026-11-04',    date '2026-11-03',    null::text),
      ('infinite due date',         date '2026-11-04',    'infinity'::date,     null::text),
      ('2001-code-point notes',     date '2026-11-04',    null::date,           repeat('😀', 2001))
    ) as t (label, invoice_date, due_date, notes)
  loop
    begin
      perform public.create_invoice(v_cust, v_case.invoice_date, v_case.due_date, v_case.notes,
        jsonb_build_array(jsonb_build_object('product_id', v_prod, 'quantity', '1')));
      raise exception 'FAIL: % accepted', v_case.label;
    exception when invalid_parameter_value then null;
    end;
  end loop;

  -- Customers: inactive, deactivated after the sales order, null
  begin
    perform public.create_invoice(current_setting('test.cust_inactive')::uuid, date '2026-11-04', null, null,
      jsonb_build_array(jsonb_build_object('product_id', v_prod, 'quantity', '1')));
    raise exception 'FAIL: inactive customer accepted';
  exception when foreign_key_violation then null;
  end;
  begin
    perform public.create_invoice(current_setting('test.cust_later')::uuid, date '2026-11-04', null, null,
      jsonb_build_array(jsonb_build_object('product_id', v_prod, 'quantity', '1')));
    raise exception 'FAIL: direct create with a deactivated customer accepted';
  exception when foreign_key_violation then null;
  end;
  begin
    perform public.create_invoice(null, date '2026-11-04', null, null,
      jsonb_build_array(jsonb_build_object('product_id', v_prod, 'quantity', '1')));
    raise exception 'FAIL: null customer accepted';
  exception when foreign_key_violation then null;
  end;

  -- No gap.
  v_inv := public.create_invoice(v_cust, date '2026-11-04', null, null,
    jsonb_build_array(jsonb_build_object('product_id', v_prod, 'quantity', '1')));
  if (select invoice_number from public.invoices where id = v_inv) <> 'INV-000005' then
    raise exception 'FAIL: failed creates consumed numbers; got %',
      (select invoice_number from public.invoices where id = v_inv);
  end if;
  perform set_config('test.inv_draft', v_inv::text, true);
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
    perform public.create_invoice(current_setting('test.cust_b')::uuid, date '2026-11-04', null, null,
      jsonb_build_array(jsonb_build_object('product_id', v_prod, 'quantity', '1')));
    raise exception 'FAIL: other tenant customer accepted';
  exception when others then v_state1 := sqlstate; v_err1 := sqlerrm;
  end;
  begin
    perform public.create_invoice(gen_random_uuid(), date '2026-11-04', null, null,
      jsonb_build_array(jsonb_build_object('product_id', v_prod, 'quantity', '1')));
  exception when others then v_state2 := sqlstate; v_err2 := sqlerrm;
  end;
  if v_state1 <> '23503' or v_state1 <> v_state2 or v_err1 <> v_err2 then
    raise exception 'FAIL: other-tenant customer (% %) differs from unknown (% %)', v_state1, v_err1, v_state2, v_err2;
  end if;

  begin
    perform public.create_invoice(current_setting('test.cust_a')::uuid, date '2026-11-04', null, null,
      jsonb_build_array(jsonb_build_object('product_id', current_setting('test.prod_b')::uuid, 'quantity', '1')));
  exception when others then v_state1 := sqlstate; v_err1 := sqlerrm;
  end;
  begin
    perform public.create_invoice(current_setting('test.cust_a')::uuid, date '2026-11-04', null, null,
      jsonb_build_array(jsonb_build_object('product_id', gen_random_uuid(), 'quantity', '1')));
  exception when others then v_state2 := sqlstate; v_err2 := sqlerrm;
  end;
  if v_state1 <> '23503' or v_state1 <> v_state2 or v_err1 <> v_err2 then
    raise exception 'FAIL: other-tenant product (% %) differs from unknown (% %)', v_state1, v_err1, v_state2, v_err2;
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- Owner A: sales order conversion
-- -----------------------------------------------------------------------------
do $$
declare
  v_so   uuid := current_setting('test.so_conf')::uuid;
  v_inv  uuid;
  v_row  record;
  v_ord  record;
  v_case record;
  v_e1   text;
  v_e2   text;
  v_s1   text;
  v_s2   text;
begin
  -- The customer (cust_later) and one product (prod_later) were deactivated
  -- after confirmation, and the other product was renamed and repriced.
  -- Conversion still works and uses the sales order's snapshot and amounts.
  v_inv := public.create_invoice_from_sales_order(v_so, date '2026-11-05', date '2026-12-05');
  perform set_config('test.inv_conv', v_inv::text, true);

  select * into v_row from public.invoices where id = v_inv;
  select * into v_ord from public.sales_orders where id = v_so;

  if v_row.invoice_number <> 'INV-000006' or v_row.status <> 'draft'
     or v_row.source_sales_order_id <> v_so
     or v_row.organization_id <> current_setting('test.org_a')::uuid
     or v_row.created_by <> 'c3000000-0000-4000-8000-00000000000a'
     or v_row.invoice_date <> date '2026-11-05' or v_row.due_date <> date '2026-12-05' then
    raise exception 'FAIL: converted header wrong: %', row_to_json(v_row);
  end if;
  if v_row.customer_id <> v_ord.customer_id
     or v_row.customer_name <> 'Later Buyer' or v_row.customer_company_name <> 'Later Co'
     or v_row.customer_email <> 'later@buyer.test' or v_row.customer_address <> 'Sylhet'
     or v_row.customer_phone is not null or v_row.customer_tax_number is not null
     or v_row.notes <> 'Agreed terms' then
    raise exception 'FAIL: converted customer snapshot or notes not taken from the sales order: %', row_to_json(v_row);
  end if;
  if v_row.subtotal::text <> '262.50' or v_row.discount_total::text <> '10.00'
     or v_row.tax_total::text <> '35.06' or v_row.grand_total::text <> '287.56'
     or v_row.amount_paid::text <> '0.00' or v_row.amount_due::text <> '287.56'
     or (v_row.subtotal, v_row.discount_total, v_row.tax_total, v_row.grand_total)
        is distinct from (v_ord.subtotal, v_ord.discount_total, v_ord.tax_total, v_ord.grand_total) then
    raise exception 'FAIL: converted totals % % % % / % %', v_row.subtotal, v_row.discount_total,
      v_row.tax_total, v_row.grand_total, v_row.amount_paid, v_row.amount_due;
  end if;

  -- Every line equals the sales order line, column for column.
  if (select jsonb_agg(jsonb_build_array(product_id, product_name, sku, description, unit,
                                         quantity::text, unit_price::text, discount_amount::text,
                                         tax_rate::text, tax_amount::text, line_total::text, sort_order)
                       order by sort_order)
      from public.invoice_items where invoice_id = v_inv)
     is distinct from
     (select jsonb_agg(jsonb_build_array(product_id, product_name, sku, description, unit,
                                         quantity::text, unit_price::text, discount_amount::text,
                                         tax_rate::text, tax_amount::text, line_total::text, sort_order)
                       order by sort_order)
      from public.sales_order_items where sales_order_id = v_so) then
    raise exception 'FAIL: converted items differ from the sales order items';
  end if;
  -- ... and those are the old snapshot values, not the current master data.
  if (select string_agg(product_name || '|' || sku || '|' || unit || '|' || unit_price::text
                        || '|' || coalesce(description, '-'), ',' order by sort_order)
      from public.invoice_items where invoice_id = v_inv)
     <> 'Conv Widget|CW-1|box|90.00|Widget desc,Later Gadget|LG-1|pcs|12.50|Custom later' then
    raise exception 'FAIL: converted lines re-read the current products';
  end if;

  -- The source sales order is unchanged (status, snapshot, items).
  if (select to_jsonb(so)::text from public.sales_orders so where so.id = v_so) <> current_setting('test.so_conf_before')
     or (select jsonb_agg(to_jsonb(i) order by i.sort_order)::text
         from public.sales_order_items i where i.sales_order_id = v_so) <> current_setting('test.so_conf_items_before') then
    raise exception 'FAIL: conversion modified the source sales order';
  end if;

  -- The same sales order cannot be invoiced twice.
  begin
    perform public.create_invoice_from_sales_order(v_so, date '2026-11-05', null);
    raise exception 'FAIL: sales order invoiced twice';
  exception when unique_violation then null;
  end;
  if (select count(*) from public.invoices where source_sales_order_id = v_so) <> 1 then
    raise exception 'FAIL: more than one invoice for the sales order';
  end if;

  -- Only confirmed sales orders convert.
  for v_case in
    select * from (values
      ('draft',                  current_setting('test.so_draft')),
      ('completed',              current_setting('test.so_completed')),
      ('cancelled from draft',   current_setting('test.so_cancelled')),
      ('cancelled when confirmed', current_setting('test.so_conf_cancelled'))
    ) as t (label, id)
  loop
    begin
      perform public.create_invoice_from_sales_order(v_case.id::uuid, date '2026-11-05', null);
      raise exception 'FAIL: % sales order invoiced', v_case.label;
    exception when object_not_in_prerequisite_state then null;
    end;
  end loop;

  -- Header input on conversion.
  begin
    perform public.create_invoice_from_sales_order(current_setting('test.so_conf3')::uuid, null, null);
    raise exception 'FAIL: conversion without an invoice date accepted';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.create_invoice_from_sales_order(current_setting('test.so_conf3')::uuid,
      date '2026-11-05', date '2026-11-04');
    raise exception 'FAIL: conversion with due date before invoice date accepted';
  exception when invalid_parameter_value then null;
  end;

  -- Unknown, NULL and other-tenant sales orders fail identically.
  begin
    perform public.create_invoice_from_sales_order(current_setting('test.so_b')::uuid, date '2026-11-05', null);
    raise exception 'FAIL: other-tenant sales order invoiced';
  exception when others then v_s1 := sqlstate; v_e1 := sqlerrm;
  end;
  begin
    perform public.create_invoice_from_sales_order(gen_random_uuid(), date '2026-11-05', null);
  exception when others then v_s2 := sqlstate; v_e2 := sqlerrm;
  end;
  if v_s1 <> 'P0002' or v_s1 <> v_s2 or v_e1 <> v_e2 then
    raise exception 'FAIL: other-tenant sales order (% %) differs from unknown (% %)', v_s1, v_e1, v_s2, v_e2;
  end if;
  begin
    perform public.create_invoice_from_sales_order(null, date '2026-11-05', null);
    raise exception 'FAIL: null sales order invoiced';
  exception when no_data_found then null;
  end;

  -- Failed conversions consumed no numbers (checked by the next create in
  -- the employee section: INV-000007).
end $$;

-- get_invoice: header and items in one statement, exact strings.
do $$
declare
  v_inv  uuid := current_setting('test.inv_conv')::uuid;
  v_doc  jsonb;
begin
  v_doc := public.get_invoice(current_setting('test.org_a')::uuid, v_inv);
  if v_doc is null
     or v_doc ->> 'id' <> v_inv::text
     or v_doc ->> 'invoice_number' <> 'INV-000006'
     or v_doc ->> 'source_sales_order_id' <> current_setting('test.so_conf')
     or v_doc ->> 'source_sales_order_number'
        <> (select sales_order_number from public.sales_orders where id = current_setting('test.so_conf')::uuid)
     or v_doc ->> 'customer_name' <> 'Later Buyer'
     or v_doc ->> 'status' <> 'draft'
     or v_doc ->> 'invoice_date' <> '2026-11-05'
     or v_doc ->> 'due_date' <> '2026-12-05'
     or jsonb_typeof(v_doc -> 'grand_total') <> 'string'
     or v_doc ->> 'grand_total' <> '287.56'
     or jsonb_typeof(v_doc -> 'amount_paid') <> 'string'
     or v_doc ->> 'amount_paid' <> '0.00'
     or v_doc ->> 'amount_due' <> '287.56'
     or jsonb_array_length(v_doc -> 'items') <> 2
     or v_doc -> 'items' -> 0 ->> 'quantity' <> '2.500'
     or jsonb_typeof(v_doc -> 'items' -> 0 -> 'quantity') <> 'string'
     or v_doc -> 'items' -> 1 ->> 'tax_amount' <> '2.81'
     or v_doc -> 'items' -> 1 ->> 'sort_order' <> '2' then
    raise exception 'FAIL: get_invoice document wrong: %', v_doc;
  end if;

  v_doc := public.get_invoice(current_setting('test.org_a')::uuid, current_setting('test.inv1')::uuid);
  if v_doc -> 'source_sales_order_id' <> 'null'::jsonb or v_doc -> 'source_sales_order_number' <> 'null'::jsonb
     or v_doc -> 'due_date' <> '"2026-12-04"'::jsonb then
    raise exception 'FAIL: direct invoice shows a source sales order';
  end if;

  if public.get_invoice(current_setting('test.org_b')::uuid, v_inv) is not null
     or public.get_invoice(current_setting('test.org_a')::uuid, gen_random_uuid()) is not null
     or public.get_invoice(null, v_inv) is not null
     or public.get_invoice(current_setting('test.org_a')::uuid, null) is not null then
    raise exception 'FAIL: get_invoice returned a document for a wrong organization or ID';
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- Owner A: direct table writes are impossible (forged number, organization,
-- creator, source sales order, totals, balance, snapshots, status)
-- -----------------------------------------------------------------------------
do $$
declare
  v_inv  uuid := current_setting('test.inv1')::uuid;
  v_item uuid := (select id from public.invoice_items where invoice_id = current_setting('test.inv1')::uuid limit 1);
  v_sql  text;
begin
  foreach v_sql in array array[
    format('insert into public.invoices (organization_id, invoice_number, customer_id, customer_name, invoice_date)
            values (%L, %L, %L, %L, current_date)',
           current_setting('test.org_a'), 'INV-999999', current_setting('test.cust_a'), 'X'),
    format('insert into public.invoices (organization_id, invoice_number, customer_id, customer_name, invoice_date, source_sales_order_id)
            values (%L, %L, %L, %L, current_date, %L)',
           current_setting('test.org_a'), 'INV-999998', current_setting('test.cust_a'), 'X', current_setting('test.so_conf3')),
    format('update public.invoices set invoice_number = %L where id = %L', 'INV-000099', v_inv),
    format('update public.invoices set organization_id = %L where id = %L', current_setting('test.org_b'), v_inv),
    format('update public.invoices set created_by = %L where id = %L', 'c3000000-0000-4000-8000-00000000000b', v_inv),
    format('update public.invoices set created_at = now() - interval ''1 year'' where id = %L', v_inv),
    format('update public.invoices set source_sales_order_id = %L where id = %L', current_setting('test.so_conf3'), v_inv),
    format('update public.invoices set grand_total = 1, subtotal = 1 where id = %L', v_inv),
    format('update public.invoices set amount_paid = grand_total, amount_due = 0 where id = %L', v_inv),
    format('update public.invoices set amount_due = 0 where id = %L', v_inv),
    format('update public.invoices set customer_name = %L where id = %L', 'Forged', v_inv),
    format('update public.invoices set status = %L where id = %L', 'paid', v_inv),
    format('update public.invoices set status = %L where id = %L', 'issued', v_inv),
    format('update public.invoices set notes = %L where id = %L', 'direct', v_inv),
    format('delete from public.invoices where id = %L', v_inv),
    format('insert into public.invoice_items (organization_id, invoice_id, product_id, product_name, sku, unit,
              quantity, unit_price, tax_amount, line_total, sort_order)
            values (%L, %L, %L, %L, %L, %L, 1, 1, 0, 1, 50)',
           current_setting('test.org_a'), v_inv, current_setting('test.prod_a'), 'X', 'X', 'pcs'),
    format('update public.invoice_items set unit_price = 0 where id = %L', v_item),
    format('update public.invoice_items set product_name = %L where id = %L', 'Forged', v_item),
    format('delete from public.invoice_items where id = %L', v_item)
  ] loop
    begin
      execute v_sql;
      raise exception 'FAIL: direct write accepted: %', v_sql;
    exception when insufficient_privilege then null;
    end;
  end loop;

  foreach v_sql in array array[
    format('select public.invoice_replace_items(%L, %L, %L::jsonb)', v_inv, current_setting('test.org_a'), '[]'),
    format('select public.invoice_recompute_totals(%L, %L)', v_inv, current_setting('test.org_a')),
    format('select public.next_document_number(%L, %L)', current_setting('test.org_a'), 'invoice')
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
  v_inv uuid := current_setting('test.inv1')::uuid;
begin
  update public.customers set name = 'Renamed Buyer', email = 'new@acme.test'
  where id = current_setting('test.cust_a')::uuid;
  update public.products set name = 'Renamed Laptop', sku = 'LAP-NEW', unit = 'box',
                             description = 'New desc', selling_price = 999
  where id = current_setting('test.prod_a')::uuid;

  if (select customer_name from public.invoices where id = v_inv) <> 'Acme Buyer'
     or (select customer_email from public.invoices where id = v_inv) <> 'buyer@acme.test' then
    raise exception 'FAIL: customer change altered the invoice snapshot';
  end if;
  if exists (
    select 1 from public.invoice_items
    where invoice_id = v_inv and sort_order = 1
      and (product_name <> 'Laptop' or sku <> 'LAP-1' or unit <> 'pcs'
           or description <> 'Laptop desc' or unit_price <> 100)
  ) or (select grand_total::text from public.invoices where id = v_inv) <> '383.49' then
    raise exception 'FAIL: product change altered the item snapshot or totals';
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- Draft update of a direct invoice: re-snapshot only what changes
-- -----------------------------------------------------------------------------
do $$
declare
  v_inv    uuid := current_setting('test.inv1')::uuid;
  v_line1  uuid := (select id from public.invoice_items where invoice_id = current_setting('test.inv1')::uuid and sort_order = 1);
  v_line2  uuid := (select id from public.invoice_items where invoice_id = current_setting('test.inv1')::uuid and sort_order = 2);
  v_row    record;
begin
  -- Same customer; line 1 kept (id + same product), plus a new line.
  perform public.update_invoice_draft(v_inv, current_setting('test.cust_a')::uuid,
    date '2026-11-05', date '2026-11-30', null,
    jsonb_build_array(
      jsonb_build_object('id', upper(v_line1::text), 'product_id', current_setting('test.prod_a')::uuid,
                         'quantity', '1', 'tax_rate', '10'),
      jsonb_build_object('product_id', current_setting('test.prod_a')::uuid, 'quantity', '1')));

  select * into v_row from public.invoices where id = v_inv;
  if v_row.invoice_number <> 'INV-000001' or v_row.status <> 'draft'
     or v_row.created_by <> 'c3000000-0000-4000-8000-00000000000a'
     or v_row.invoice_date <> date '2026-11-05' or v_row.due_date <> date '2026-11-30'
     or v_row.notes is not null or v_row.source_sales_order_id is not null then
    raise exception 'FAIL: draft update header wrong: %', row_to_json(v_row);
  end if;
  if v_row.customer_name <> 'Acme Buyer' or v_row.customer_email <> 'buyer@acme.test' then
    raise exception 'FAIL: unchanged customer was re-snapshotted';
  end if;
  if (select string_agg(product_name || '|' || sku || '|' || unit || '|' || unit_price::text
                        || '|' || coalesce(description, '-'), ',' order by sort_order)
      from public.invoice_items where invoice_id = v_inv)
     <> 'Laptop|LAP-1|pcs|100.00|Laptop desc,Renamed Laptop|LAP-NEW|box|999.00|New desc' then
    raise exception 'FAIL: kept line / new line snapshots wrong';
  end if;
  -- Draft line IDs are edit tokens: the rows were replaced.
  if exists (select 1 from public.invoice_items where id in (v_line1, v_line2)) then
    raise exception 'FAIL: items were not replaced';
  end if;
  -- 100.00 + 10% = 110.00; 999.00. amount_due follows the new total.
  if v_row.subtotal::text <> '1099.00' or v_row.tax_total::text <> '10.00'
     or v_row.grand_total::text <> '1109.00'
     or v_row.amount_paid::text <> '0.00' or v_row.amount_due::text <> '1109.00' then
    raise exception 'FAIL: draft update totals % % % / % %', v_row.subtotal, v_row.tax_total,
      v_row.grand_total, v_row.amount_paid, v_row.amount_due;
  end if;

  -- Another customer: fresh snapshot. And back: fresh snapshot of the
  -- current (renamed) customer.
  perform public.update_invoice_draft(v_inv, current_setting('test.cust_a2')::uuid,
    date '2026-11-05', null, null,
    (select jsonb_agg(jsonb_build_object('id', id, 'product_id', product_id, 'quantity', quantity::text) order by sort_order)
     from public.invoice_items where invoice_id = v_inv));
  if (select customer_name || '|' || coalesce(customer_email, '-') || '|' || coalesce(customer_company_name, '-')
      from public.invoices where id = v_inv) <> 'Second Buyer|second@buyer.test|-' then
    raise exception 'FAIL: changed customer not snapshotted';
  end if;
  perform public.update_invoice_draft(v_inv, current_setting('test.cust_a')::uuid,
    date '2026-11-05', null, null,
    (select jsonb_agg(jsonb_build_object('id', id, 'product_id', product_id, 'quantity', quantity::text) order by sort_order)
     from public.invoice_items where invoice_id = v_inv));
  if (select customer_name || '|' || customer_email from public.invoices where id = v_inv)
     <> 'Renamed Buyer|new@acme.test' then
    raise exception 'FAIL: changed-back customer not freshly snapshotted';
  end if;
  if (select string_agg(unit_price::text, ',' order by sort_order)
      from public.invoice_items where invoice_id = v_inv) <> '100.00,999.00' then
    raise exception 'FAIL: kept line prices changed';
  end if;

  -- Customer and item rules on update.
  begin
    perform public.update_invoice_draft(v_inv, current_setting('test.cust_inactive')::uuid,
      date '2026-11-05', null, null,
      jsonb_build_array(jsonb_build_object('product_id', current_setting('test.prod_a')::uuid, 'quantity', '1')));
    raise exception 'FAIL: update to inactive customer accepted';
  exception when foreign_key_violation then null;
  end;
  begin
    perform public.update_invoice_draft(v_inv, current_setting('test.cust_b')::uuid,
      date '2026-11-05', null, null,
      jsonb_build_array(jsonb_build_object('product_id', current_setting('test.prod_a')::uuid, 'quantity', '1')));
    raise exception 'FAIL: update to other-tenant customer accepted';
  exception when foreign_key_violation then null;
  end;
  begin
    perform public.update_invoice_draft(v_inv, current_setting('test.cust_a')::uuid,
      date '2026-11-05', null, null,
      jsonb_build_array(jsonb_build_object('product_id', current_setting('test.prod_b')::uuid, 'quantity', '1')));
    raise exception 'FAIL: update with other-tenant product accepted';
  exception when foreign_key_violation then null;
  end;
  begin
    perform public.update_invoice_draft(v_inv, current_setting('test.cust_a')::uuid,
      date '2026-11-05', null, null, '[]'::jsonb);
    raise exception 'FAIL: update with no items accepted';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.update_invoice_draft(v_inv, current_setting('test.cust_a')::uuid,
      date '2026-11-05', date '2026-11-01', null,
      jsonb_build_array(jsonb_build_object('product_id', current_setting('test.prod_a')::uuid, 'quantity', '1')));
    raise exception 'FAIL: update with due date before invoice date accepted';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.update_invoice_draft(gen_random_uuid(), current_setting('test.cust_a')::uuid,
      date '2026-11-05', null, null,
      jsonb_build_array(jsonb_build_object('product_id', current_setting('test.prod_a')::uuid, 'quantity', '1')));
    raise exception 'FAIL: update of unknown invoice accepted';
  exception when no_data_found then null;
  end;
end $$;

-- -----------------------------------------------------------------------------
-- Draft update of a converted invoice: kept lines need no active product, the
-- unchanged customer need not be active, the source sales order never changes
-- -----------------------------------------------------------------------------
do $$
declare
  v_inv    uuid := current_setting('test.inv_conv')::uuid;
  v_l1     uuid := (select id from public.invoice_items where invoice_id = current_setting('test.inv_conv')::uuid and sort_order = 1);
  v_l2     uuid := (select id from public.invoice_items where invoice_id = current_setting('test.inv_conv')::uuid and sort_order = 2);
  v_other  uuid := (select id from public.invoice_items where invoice_id = current_setting('test.inv1')::uuid limit 1);
  v_so_ln  uuid := (select id from public.sales_order_items where sales_order_id = current_setting('test.so_conf')::uuid and sort_order = 1);
  v_before text;
  v_case   record;
  v_row    record;
begin
  -- Same (now inactive) customer; both lines kept, including the now
  -- inactive product. Line 1 quantity 3: 270.00 - 10 = 260.00 + 15% 39.00.
  perform public.update_invoice_draft(v_inv, current_setting('test.cust_later')::uuid,
    date '2026-11-05', null, 'Agreed terms, revised',
    jsonb_build_array(
      jsonb_build_object('id', v_l1, 'product_id', current_setting('test.prod_conv')::uuid,
                         'quantity', '3', 'unit_price', '90.00', 'discount_amount', '10', 'tax_rate', '15'),
      jsonb_build_object('id', v_l2, 'product_id', current_setting('test.prod_later')::uuid,
                         'quantity', '3', 'tax_rate', '7.5')));

  select * into v_row from public.invoices where id = v_inv;
  if v_row.customer_name <> 'Later Buyer' or v_row.notes <> 'Agreed terms, revised'
     or v_row.source_sales_order_id <> current_setting('test.so_conf')::uuid then
    raise exception 'FAIL: converted draft update header wrong: %', row_to_json(v_row);
  end if;
  if (select string_agg(product_name || '|' || sku || '|' || unit_price::text
                        || '|' || coalesce(description, '-') || '|' || line_total::text, ',' order by sort_order)
      from public.invoice_items where invoice_id = v_inv)
     <> 'Conv Widget|CW-1|90.00|Widget desc|299.00,Later Gadget|LG-1|12.50|Custom later|40.31' then
    raise exception 'FAIL: converted kept lines wrong';
  end if;
  if v_row.subtotal::text <> '307.50' or v_row.discount_total::text <> '10.00'
     or v_row.tax_total::text <> '41.81' or v_row.grand_total::text <> '339.31'
     or v_row.amount_due::text <> '339.31' then
    raise exception 'FAIL: converted draft totals % % % % / %', v_row.subtotal, v_row.discount_total,
      v_row.tax_total, v_row.grand_total, v_row.amount_due;
  end if;

  -- Rejected edits leave the invoice unchanged.
  v_before := (select to_jsonb(inv)::text from public.invoices inv where inv.id = v_inv)
           || (select jsonb_agg(to_jsonb(i) order by i.sort_order)::text
               from public.invoice_items i where i.invoice_id = v_inv);
  v_l1 := (select id from public.invoice_items where invoice_id = v_inv and sort_order = 1);
  v_l2 := (select id from public.invoice_items where invoice_id = v_inv and sort_order = 2);

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
      ('line id of another invoice',
        current_setting('test.cust_later'),
        jsonb_build_array(jsonb_build_object('id', v_other, 'product_id', current_setting('test.prod_a')::uuid, 'quantity', '1')),
        '22023'),
      ('line id of the source sales order',
        current_setting('test.cust_later'),
        jsonb_build_array(jsonb_build_object('id', v_so_ln, 'product_id', current_setting('test.prod_conv')::uuid, 'quantity', '1')),
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
      perform public.update_invoice_draft(v_inv, v_case.customer::uuid, date '2026-11-05', null, 'x', v_case.items);
      raise exception 'FAIL: % accepted', v_case.label;
    exception when others then
      if sqlstate <> v_case.expected then
        raise exception 'FAIL: % raised % (%), expected %', v_case.label, sqlstate, sqlerrm, v_case.expected;
      end if;
    end;
  end loop;

  if (select to_jsonb(inv)::text from public.invoices inv where inv.id = v_inv)
     || (select jsonb_agg(to_jsonb(i) order by i.sort_order)::text
         from public.invoice_items i where i.invoice_id = v_inv) <> v_before then
    raise exception 'FAIL: a rejected edit partially changed the converted invoice';
  end if;

  -- A kept line id with a different, active product is a new selection:
  -- current snapshot and current price.
  perform public.update_invoice_draft(v_inv, current_setting('test.cust_later')::uuid,
    date '2026-11-05', null, null,
    jsonb_build_array(
      jsonb_build_object('id', v_l1, 'product_id', current_setting('test.prod_conv')::uuid, 'quantity', '1'),
      jsonb_build_object('id', v_l2, 'product_id', current_setting('test.prod_a')::uuid, 'quantity', '1')));
  if (select string_agg(product_name || '|' || unit_price::text, ',' order by sort_order)
      from public.invoice_items where invoice_id = v_inv) <> 'Conv Widget|90.00,Renamed Laptop|999.00' then
    raise exception 'FAIL: changed product on a line id not re-snapshotted';
  end if;

  -- The source sales order is still exactly as it was.
  if (select to_jsonb(so)::text from public.sales_orders so where so.id = current_setting('test.so_conf')::uuid)
       <> current_setting('test.so_conf_before')
     or (select jsonb_agg(to_jsonb(i) order by i.sort_order)::text
         from public.sales_order_items i where i.sales_order_id = current_setting('test.so_conf')::uuid)
       <> current_setting('test.so_conf_items_before') then
    raise exception 'FAIL: editing the converted invoice modified the source sales order';
  end if;
end $$;

reset role;

-- -----------------------------------------------------------------------------
-- Employee: view, create, convert, edit draft, issue; never cancel, never a
-- payment status
-- -----------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"c3000000-0000-4000-8000-00000000000e","role":"authenticated"}', true);

do $$
declare
  v_inv  uuid;
  v_s    text;
begin
  if not exists (select 1 from public.invoices where id = current_setting('test.inv1')::uuid)
     or not exists (select 1 from public.invoice_items where invoice_id = current_setting('test.inv1')::uuid)
     or public.get_invoice(current_setting('test.org_a')::uuid, current_setting('test.inv1')::uuid) is null then
    raise exception 'FAIL: employee cannot read invoices';
  end if;

  -- Conversion by an employee; numbering continued without gaps after the
  -- failed conversions above.
  v_inv := public.create_invoice_from_sales_order(current_setting('test.so_conf2')::uuid, date '2026-11-06', null);
  if (select invoice_number from public.invoices where id = v_inv) <> 'INV-000007'
     or (select created_by from public.invoices where id = v_inv) <> 'c3000000-0000-4000-8000-00000000000e' then
    raise exception 'FAIL: employee conversion: number or created_by wrong';
  end if;
  perform set_config('test.inv_conv2', v_inv::text, true);   -- converted, stays draft

  v_inv := public.create_invoice(current_setting('test.cust_a')::uuid, date '2026-11-04', null, null,
    jsonb_build_array(jsonb_build_object('product_id', current_setting('test.prod_a')::uuid, 'quantity', '1')));
  if (select invoice_number from public.invoices where id = v_inv) <> 'INV-000008' then
    raise exception 'FAIL: employee create number wrong';
  end if;

  perform public.update_invoice_draft(v_inv, current_setting('test.cust_a')::uuid, date '2026-11-04', null, 'Edited',
    jsonb_build_array(jsonb_build_object('product_id', current_setting('test.prod_a')::uuid, 'quantity', '2')));
  if (select notes || '|' || amount_due::text from public.invoices where id = v_inv) <> 'Edited|1998.00' then
    raise exception 'FAIL: employee cannot edit a draft (or amount_due did not follow)';
  end if;

  begin
    perform public.set_invoice_status(v_inv, 'cancelled');
    raise exception 'FAIL: employee cancelled a draft';
  exception when insufficient_privilege then null;
  end;
  foreach v_s in array array['paid', 'partially_paid'] loop
    begin
      perform public.set_invoice_status(v_inv, v_s);
      raise exception 'FAIL: employee set draft to %', v_s;
    exception when insufficient_privilege then null;
    end;
  end loop;

  perform public.set_invoice_status(v_inv, 'issued');
  if (select status from public.invoices where id = v_inv) <> 'issued' then
    raise exception 'FAIL: employee cannot issue';
  end if;
  perform set_config('test.inv_emp_issued', v_inv::text, true);

  foreach v_s in array array['cancelled', 'paid', 'partially_paid'] loop
    begin
      perform public.set_invoice_status(v_inv, v_s);
      raise exception 'FAIL: employee set issued to %', v_s;
    exception when insufficient_privilege then null;
    end;
  end loop;
  if (select status from public.invoices where id = v_inv) <> 'issued' then
    raise exception 'FAIL: employee changed an issued invoice';
  end if;
end $$;

reset role;

-- -----------------------------------------------------------------------------
-- Manager: status transitions
-- -----------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"c3000000-0000-4000-8000-00000000000c","role":"authenticated"}', true);

do $$
declare
  v_items jsonb := jsonb_build_array(jsonb_build_object(
    'product_id', current_setting('test.prod_a')::uuid, 'quantity', '1'));
  v_inv   uuid;
  v_case  record;
  v_from  text;
  v_to    text;
begin
  for v_case in
    select * from (values
      ('issued',    array['issued']),
      ('cancelled', array['cancelled']),
      ('cancelled', array['issued', 'cancelled'])
    ) as t (final, steps)
  loop
    v_inv := public.create_invoice(current_setting('test.cust_a')::uuid, date '2026-11-04', null, null, v_items);
    foreach v_to in array v_case.steps loop
      perform public.set_invoice_status(v_inv, v_to);
    end loop;
    if (select status from public.invoices where id = v_inv) <> v_case.final then
      raise exception 'FAIL: path % did not end in %', v_case.steps, v_case.final;
    end if;
    -- The balance never changes with a user status change.
    if (select amount_paid::text || '/' || (amount_due = grand_total)::text
        from public.invoices where id = v_inv) <> '0.00/true' then
      raise exception 'FAIL: status change touched the balance';
    end if;
    perform set_config('test.inv_' || array_to_string(v_case.steps, '_'), v_inv::text, true);
  end loop;

  -- Invalid user transitions (55000).
  for v_case in
    select * from (values
      ('issued',            array['issued']),
      ('cancelled',         array['issued', 'cancelled']),
      ('issued_cancelled',  array['issued', 'cancelled'])
    ) as t (key, targets)
  loop
    v_inv := current_setting('test.inv_' || v_case.key)::uuid;
    v_from := (select status from public.invoices where id = v_inv);
    foreach v_to in array v_case.targets loop
      begin
        perform public.set_invoice_status(v_inv, v_to);
        raise exception 'FAIL: % -> % accepted', v_from, v_to;
      exception when object_not_in_prerequisite_state then null;
      end;
    end loop;
  end loop;

  -- Payment statuses are reserved for the Payment module, from any status,
  -- for every role (42501), checked before the invoice is looked up.
  foreach v_to in array array['paid', 'partially_paid'] loop
    foreach v_from in array array['test.inv_issued', 'test.inv_draft', 'test.inv_cancelled'] loop
      begin
        perform public.set_invoice_status(current_setting(v_from)::uuid, v_to);
        raise exception 'FAIL: manager set % to %', v_from, v_to;
      exception when insufficient_privilege then null;
      end;
    end loop;
  end loop;

  foreach v_to in array array['draft', 'bogus', 'ISSUED', '', 'confirmed', 'sent'] loop
    begin
      perform public.set_invoice_status(current_setting('test.inv_draft')::uuid, v_to);
      raise exception 'FAIL: status % accepted', v_to;
    exception when invalid_parameter_value then null;
    end;
  end loop;
  begin
    perform public.set_invoice_status(current_setting('test.inv_draft')::uuid, null);
    raise exception 'FAIL: null status accepted';
  exception when invalid_parameter_value then null;
  end;
  if (select status from public.invoices where id = current_setting('test.inv_draft')::uuid) <> 'draft' then
    raise exception 'FAIL: rejected transitions changed the status';
  end if;

  -- Zero-total invoice (discount = gross): a valid draft and a valid issued
  -- invoice with nothing paid and nothing due; users still cannot mark it
  -- paid.
  v_inv := public.create_invoice(current_setting('test.cust_a')::uuid, date '2026-11-04', null, null,
    jsonb_build_array(jsonb_build_object('product_id', current_setting('test.prod_a')::uuid,
                                         'quantity', '1', 'unit_price', '5', 'discount_amount', '5')));
  perform set_config('test.inv_zero', v_inv::text, true);
  if (select status || '|' || grand_total::text || '|' || amount_paid::text || '|' || amount_due::text
      from public.invoices where id = v_inv) <> 'draft|0.00|0.00|0.00' then
    raise exception 'FAIL: zero-total draft wrong';
  end if;
  perform public.set_invoice_status(v_inv, 'issued');
  if (select status || '|' || grand_total::text || '|' || amount_paid::text || '|' || amount_due::text
      from public.invoices where id = v_inv) <> 'issued|0.00|0.00|0.00' then
    raise exception 'FAIL: zero-total issued wrong';
  end if;
  foreach v_to in array array['paid', 'partially_paid'] loop
    begin
      perform public.set_invoice_status(v_inv, v_to);
      raise exception 'FAIL: manager set a zero-total invoice to %', v_to;
    exception when insufficient_privilege then null;
    end;
  end loop;

  -- The manager issues the converted invoice; the sales order is untouched.
  perform public.set_invoice_status(current_setting('test.inv_conv')::uuid, 'issued');
  if (select status from public.sales_orders where id = current_setting('test.so_conf')::uuid) <> 'confirmed' then
    raise exception 'FAIL: invoice status change touched the sales order';
  end if;
end $$;

reset role;

-- -----------------------------------------------------------------------------
-- Immutability after issue (through the API)
-- -----------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"c3000000-0000-4000-8000-00000000000a","role":"authenticated"}', true);

do $$
declare
  v_inv uuid := current_setting('test.inv1')::uuid;
  v_key text;
begin
  perform public.set_invoice_status(v_inv, 'issued');
  foreach v_key in array array['test.inv1', 'test.inv_conv', 'test.inv_cancelled', 'test.inv_issued_cancelled'] loop
    begin
      perform public.update_invoice_draft(current_setting(v_key)::uuid, current_setting('test.cust_a')::uuid,
        date '2026-11-05', null, 'late edit',
        jsonb_build_array(jsonb_build_object('product_id', current_setting('test.prod_a')::uuid, 'quantity', '9')));
      raise exception 'FAIL: % (not a draft) edited', v_key;
    exception when object_not_in_prerequisite_state then null;
    end;
  end loop;
end $$;

reset role;

-- The triggers hold for a writer that bypasses privileges and RLS.
do $$
declare
  v_inv    uuid := current_setting('test.inv1')::uuid;        -- issued, direct
  v_draft  uuid := current_setting('test.inv_draft')::uuid;   -- draft, direct
  v_conv   uuid := current_setting('test.inv_conv')::uuid;    -- issued, converted
  v_canc   uuid := current_setting('test.inv_cancelled')::uuid;
  v_item   uuid := (select id from public.invoice_items where invoice_id = current_setting('test.inv1')::uuid limit 1);
  v_sql    text;
begin
  foreach v_sql in array array[
    -- commercial content of an issued invoice
    format('update public.invoices set notes = %L where id = %L', 'x', v_inv),
    format('update public.invoices set customer_name = %L where id = %L', 'x', v_inv),
    format('update public.invoices set customer_tax_number = %L where id = %L', 'x', v_inv),
    format('update public.invoices set customer_id = %L where id = %L', current_setting('test.cust_a2'), v_inv),
    format('update public.invoices set invoice_date = invoice_date + 1 where id = %L', v_inv),
    format('update public.invoices set due_date = invoice_date + 30 where id = %L', v_inv),
    format('update public.invoices set grand_total = grand_total + 1, subtotal = subtotal + 1, amount_due = amount_due + 1 where id = %L', v_inv),
    format('update public.invoices set notes = %L where id = %L', 'x', v_canc),
    format('update public.invoice_items set quantity = 9 where id = %L', v_item),
    format('update public.invoice_items set unit_price = 0, tax_amount = 0, line_total = 0, discount_amount = 0 where id = %L', v_item),
    format('update public.invoice_items set tax_rate = 0, tax_amount = 0, line_total = round(quantity * unit_price, 2) - discount_amount where id = %L', v_item),
    format('update public.invoice_items set product_name = %L where id = %L', 'x', v_item),
    format('delete from public.invoice_items where id = %L', v_item),
    format('insert into public.invoice_items (organization_id, invoice_id, product_id, product_name, sku, unit,
              quantity, unit_price, tax_amount, line_total, sort_order)
            values (%L, %L, %L, %L, %L, %L, 1, 1, 0, 1, 50)',
           current_setting('test.org_a'), v_inv, current_setting('test.prod_a'), 'X', 'X', 'pcs'),
    format('delete from public.invoice_items where invoice_id = %L', v_conv),
    -- identity columns never change, not even on a draft
    format('update public.invoices set invoice_number = %L where id = %L', 'INV-999999', v_draft),
    format('update public.invoices set organization_id = %L where id = %L', current_setting('test.org_b'), v_draft),
    format('update public.invoices set created_by = %L where id = %L', 'c3000000-0000-4000-8000-00000000000b', v_draft),
    format('update public.invoices set created_at = created_at - interval ''1 day'' where id = %L', v_draft),
    format('update public.invoices set source_sales_order_id = %L where id = %L', current_setting('test.so_conf3'), v_draft),
    format('update public.invoices set source_sales_order_id = null where id = %L', v_conv),
    -- transitions are checked by the trigger too
    format('update public.invoices set status = %L where id = %L', 'draft', v_inv),
    format('update public.invoices set status = %L where id = %L', 'paid', v_draft),
    format('update public.invoices set status = %L where id = %L', 'partially_paid', v_draft),
    format('update public.invoices set status = %L where id = %L', 'issued', v_canc),
    format('update public.invoices set status = %L where id = %L', 'paid', v_canc)
  ] loop
    begin
      execute v_sql;
      raise exception 'FAIL: trigger allowed: %', v_sql;
    exception when object_not_in_prerequisite_state then null;
    end;
  end loop;

  -- issued -> paid / partially_paid is a lifecycle transition the trigger
  -- knows, but Part 1 has no payments: the balance constraints reject it for
  -- every writer, with or without a forged amount_paid.
  foreach v_sql in array array[
    format('update public.invoices set status = %L where id = %L', 'paid', v_inv),
    format('update public.invoices set status = %L where id = %L', 'partially_paid', v_inv),
    format('update public.invoices set status = %L, amount_paid = grand_total, amount_due = 0 where id = %L', 'paid', v_inv),
    format('update public.invoices set status = %L, amount_paid = 1, amount_due = grand_total - 1 where id = %L', 'partially_paid', v_inv),
    format('update public.invoices set amount_paid = 1, amount_due = grand_total - 1 where id = %L', v_inv),
    format('update public.invoices set amount_paid = 1, amount_due = grand_total - 1 where id = %L', v_draft),
    -- a zero-total invoice is consistent with paid (0 / 0), but Part 1 has
    -- no payment states at all
    format('update public.invoices set status = %L where id = %L', 'paid', current_setting('test.inv_zero'))
  ] loop
    begin
      execute v_sql;
      raise exception 'FAIL: payment state stored in Part 1: %', v_sql;
    exception when check_violation then null;
    end;
  end loop;

  -- created_by may still become NULL (auth user deleted).
  update public.invoices set created_by = null where id = v_inv;
end $$;

-- Integrity constraints hold for any writer (postgres here).
do $$
declare
  v_draft uuid := current_setting('test.inv_draft')::uuid;
  v_item  uuid := (select id from public.invoice_items where invoice_id = current_setting('test.inv_draft')::uuid limit 1);
begin
  begin
    update public.invoice_items set line_total = line_total + 1 where id = v_item;
    raise exception 'FAIL: inconsistent line total accepted';
  exception when check_violation then null;
  end;
  begin
    update public.invoice_items set tax_amount = tax_amount + 0.01, line_total = line_total + 0.01 where id = v_item;
    raise exception 'FAIL: inconsistent tax amount accepted';
  exception when check_violation then null;
  end;
  begin
    update public.invoice_items set quantity = 0 where id = v_item;
    raise exception 'FAIL: zero quantity accepted by the table';
  exception when check_violation then null;
  end;
  begin
    update public.invoice_items set tax_rate = 101 where id = v_item;
    raise exception 'FAIL: tax rate over 100 accepted by the table';
  exception when check_violation then null;
  end;
  begin
    update public.invoices set grand_total = grand_total + 1, amount_due = amount_due + 1 where id = v_draft;
    raise exception 'FAIL: inconsistent grand total accepted';
  exception when check_violation then null;
  end;
  begin
    update public.invoices set amount_due = amount_due + 1 where id = v_draft;
    raise exception 'FAIL: amount_due not derived from grand_total - amount_paid';
  exception when check_violation then null;
  end;
  begin
    update public.invoices set amount_paid = -1, amount_due = grand_total + 1 where id = v_draft;
    raise exception 'FAIL: negative amount_paid accepted';
  exception when check_violation then null;
  end;
  begin
    update public.invoices set due_date = invoice_date - 1 where id = v_draft;
    raise exception 'FAIL: due before invoice date accepted by the table';
  exception when check_violation then null;
  end;
  begin
    update public.invoice_items set product_id = current_setting('test.prod_b')::uuid where id = v_item;
    raise exception 'FAIL: item linked to another tenant''s product';
  exception when foreign_key_violation then null;
  end;
  begin
    update public.invoices set customer_id = current_setting('test.cust_b')::uuid where id = v_draft;
    raise exception 'FAIL: invoice linked to another tenant''s customer';
  exception when foreign_key_violation then null;
  end;
  begin
    insert into public.invoice_items (organization_id, invoice_id, product_id, product_name, sku, unit,
                                      quantity, unit_price, tax_amount, line_total, sort_order)
    values (current_setting('test.org_b')::uuid, v_draft, current_setting('test.prod_b')::uuid,
            'X', 'X', 'pcs', 1, 1, 0, 1, 50);
    raise exception 'FAIL: item of Organization B attached to an invoice of Organization A';
  exception when foreign_key_violation then null;
  end;
  begin
    insert into public.invoices (organization_id, invoice_number, customer_id, customer_name,
                                 invoice_date, source_sales_order_id)
    values (current_setting('test.org_a')::uuid, 'INV-900001', current_setting('test.cust_a')::uuid, 'X',
            date '2026-11-04', current_setting('test.so_b')::uuid);
    raise exception 'FAIL: invoice linked to another tenant''s sales order';
  exception when foreign_key_violation then null;
  end;
  begin
    insert into public.invoices (organization_id, invoice_number, customer_id, customer_name,
                                 invoice_date, source_sales_order_id)
    values (current_setting('test.org_a')::uuid, 'INV-900002', current_setting('test.cust_a')::uuid, 'X',
            date '2026-11-04', current_setting('test.so_conf')::uuid);
    raise exception 'FAIL: second invoice for the same sales order accepted by the table';
  exception when unique_violation then null;
  end;
  begin
    insert into public.invoices (organization_id, invoice_number, customer_id, customer_name, invoice_date)
    values (current_setting('test.org_a')::uuid, 'INV-000001', current_setting('test.cust_a')::uuid, 'X', date '2026-11-04');
    raise exception 'FAIL: duplicate invoice number accepted';
  exception when unique_violation then null;
  end;
  begin
    insert into public.invoices (organization_id, invoice_number, customer_id, customer_name, invoice_date)
    values (current_setting('test.org_a')::uuid, 'INV-1', current_setting('test.cust_a')::uuid, 'X', date '2026-11-04');
    raise exception 'FAIL: malformed invoice number accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.invoices (organization_id, invoice_number, customer_id, customer_name, invoice_date,
                                 subtotal, grand_total, amount_due, amount_paid, status)
    values (current_setting('test.org_a')::uuid, 'INV-900003', current_setting('test.cust_a')::uuid, 'X', date '2026-11-04',
            10, 10, 0, 10, 'paid');
    raise exception 'FAIL: paid invoice inserted in Part 1';
  exception when check_violation then null;
  end;
  begin
    insert into public.invoices (organization_id, invoice_number, customer_id, customer_name, invoice_date, status)
    values (current_setting('test.org_a')::uuid, 'INV-900004', current_setting('test.cust_a')::uuid, 'X',
            date '2026-11-04', 'paid');
    raise exception 'FAIL: zero-total paid invoice inserted in Part 1';
  exception when check_violation then null;
  end;
  -- Many direct invoices share source_sales_order_id NULL.
  if (select count(*) from public.invoices
      where organization_id = current_setting('test.org_a')::uuid and source_sales_order_id is null) < 5 then
    raise exception 'FAIL: direct invoices limited by the source sales order uniqueness';
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- Invoices are never deleted, in any status, by any writer (postgres here).
-- The guard fires before the item cascade, so items and the
-- source_sales_order_id link survive, and the sales order still cannot be
-- invoiced again.
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
      ('direct draft',           'test.inv_draft',             'draft'),
      ('issued',                 'test.inv_issued',            'issued'),
      ('cancelled (draft)',      'test.inv_cancelled',         'cancelled'),
      ('cancelled (issued)',     'test.inv_issued_cancelled',  'cancelled'),
      ('converted draft',        'test.inv_conv2',             'draft'),
      ('converted issued',       'test.inv_conv',              'issued')
    ) as t (label, setting, expected_status)
  loop
    select inv.status, inv.source_sales_order_id into v_status, v_source
    from public.invoices inv where inv.id = current_setting(v_case.setting)::uuid;
    if v_status is distinct from v_case.expected_status then
      raise exception 'FAIL: test data: % is %, expected %', v_case.label, v_status, v_case.expected_status;
    end if;
    select count(*) into v_items from public.invoice_items
    where invoice_id = current_setting(v_case.setting)::uuid;

    begin
      delete from public.invoices where id = current_setting(v_case.setting)::uuid;
      raise exception 'FAIL: % invoice deleted', v_case.label;
    exception when object_not_in_prerequisite_state then
      if sqlerrm <> 'invoices cannot be deleted' then
        raise exception 'FAIL: % delete raised the wrong error: %', v_case.label, sqlerrm;
      end if;
    end;

    if not exists (select 1 from public.invoices where id = current_setting(v_case.setting)::uuid)
       or (select count(*) from public.invoice_items
           where invoice_id = current_setting(v_case.setting)::uuid) <> v_items
       or v_items = 0
       or (select source_sales_order_id from public.invoices
           where id = current_setting(v_case.setting)::uuid) is distinct from v_source then
      raise exception 'FAIL: failed delete of % changed the header, items or source link', v_case.label;
    end if;
  end loop;

  if (select source_sales_order_id from public.invoices where id = current_setting('test.inv_conv')::uuid)
       <> current_setting('test.so_conf')::uuid
     or (select source_sales_order_id from public.invoices where id = current_setting('test.inv_conv2')::uuid)
       <> current_setting('test.so_conf2')::uuid then
    raise exception 'FAIL: converted invoices lost their source sales order';
  end if;

  -- Bulk deletes fail too, and so does the organization cascade.
  begin
    delete from public.invoices where organization_id = current_setting('test.org_a')::uuid;
    raise exception 'FAIL: bulk delete of invoices succeeded';
  exception when object_not_in_prerequisite_state then null;
  end;
  begin
    delete from public.organizations where id = current_setting('test.org_a')::uuid;
    raise exception 'FAIL: organization delete cascaded through its invoices';
  exception when object_not_in_prerequisite_state then null;
  end;
  if (select count(*) from public.invoices where organization_id = current_setting('test.org_a')::uuid) < 10 then
    raise exception 'FAIL: invoices missing after rejected deletes';
  end if;

  -- UPDATE immutability is unchanged: still the "not a draft" rule.
  begin
    update public.invoices set notes = 'after delete attempt' where id = current_setting('test.inv1')::uuid;
    raise exception 'FAIL: issued invoice editable after delete attempts';
  exception when object_not_in_prerequisite_state then
    if sqlerrm <> 'invoice is not a draft' then
      raise exception 'FAIL: update raised the wrong error: %', sqlerrm;
    end if;
  end;
end $$;

-- Sales orders cannot be invoiced again: after delete attempts, and after
-- the invoice was cancelled.
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"c3000000-0000-4000-8000-00000000000a","role":"authenticated"}', true);
do $$
declare
  v_s   text;
  v_inv uuid;
begin
  foreach v_s in array array['test.so_conf', 'test.so_conf2'] loop
    begin
      perform public.create_invoice_from_sales_order(current_setting(v_s)::uuid, date '2026-11-07', null);
      raise exception 'FAIL: % invoiced again after a delete attempt', v_s;
    exception when unique_violation then null;
    end;
    if (select count(*) from public.invoices where source_sales_order_id = current_setting(v_s)::uuid) <> 1 then
      raise exception 'FAIL: % does not have exactly one invoice', v_s;
    end if;
  end loop;

  -- A cancelled invoice still consumes its sales order.
  v_inv := public.create_invoice_from_sales_order(current_setting('test.so_conf3')::uuid, date '2026-11-07', null);
  perform public.set_invoice_status(v_inv, 'issued');
  perform public.set_invoice_status(v_inv, 'cancelled');
  begin
    perform public.create_invoice_from_sales_order(current_setting('test.so_conf3')::uuid, date '2026-11-08', null);
    raise exception 'FAIL: sales order of a cancelled invoice invoiced again';
  exception when unique_violation then null;
  end;
  if (select count(*) from public.invoices where source_sales_order_id = current_setting('test.so_conf3')::uuid) <> 1 then
    raise exception 'FAIL: sales order of a cancelled invoice has more than one invoice';
  end if;

  if has_table_privilege('authenticated', 'public.invoices', 'delete') then
    raise exception 'FAIL: authenticated has DELETE on invoices';
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- An invoiced sales order cannot be cancelled (any invoice status, also a
-- cancelled invoice); it can still be completed. Owner A.
-- -----------------------------------------------------------------------------
do $$
declare
  v_s     text;
  v_so    uuid;
  v_inv   text;
begin
  -- so_conf: issued invoice; so_conf2: draft invoice; so_conf3: cancelled invoice.
  foreach v_s in array array['test.so_conf', 'test.so_conf2', 'test.so_conf3'] loop
    if (select status from public.sales_orders where id = current_setting(v_s)::uuid) <> 'confirmed'
       or not exists (select 1 from public.invoices where source_sales_order_id = current_setting(v_s)::uuid) then
      raise exception 'FAIL: test data: % is not a confirmed, invoiced sales order', v_s;
    end if;
    begin
      perform public.set_sales_order_status(current_setting(v_s)::uuid, 'cancelled');
      raise exception 'FAIL: invoiced sales order % cancelled', v_s;
    exception when object_not_in_prerequisite_state then
      if sqlerrm <> 'sales order has an invoice and cannot be cancelled' then
        raise exception 'FAIL: % cancel raised the wrong error: %', v_s, sqlerrm;
      end if;
    end;
    if (select status from public.sales_orders where id = current_setting(v_s)::uuid) <> 'confirmed' then
      raise exception 'FAIL: rejected cancel changed %', v_s;
    end if;
  end loop;

  -- It may still be completed; completed stays terminal.
  v_inv := (select to_jsonb(inv)::text from public.invoices inv
            where inv.source_sales_order_id = current_setting('test.so_conf2')::uuid);
  perform public.set_sales_order_status(current_setting('test.so_conf2')::uuid, 'completed');
  if (select status from public.sales_orders where id = current_setting('test.so_conf2')::uuid) <> 'completed' then
    raise exception 'FAIL: invoiced sales order could not be completed';
  end if;
  begin
    perform public.set_sales_order_status(current_setting('test.so_conf2')::uuid, 'cancelled');
    raise exception 'FAIL: completed invoiced sales order cancelled';
  exception when object_not_in_prerequisite_state then null;
  end;
  if (select to_jsonb(inv)::text from public.invoices inv
      where inv.source_sales_order_id = current_setting('test.so_conf2')::uuid) <> v_inv then
    raise exception 'FAIL: completing the sales order changed its invoice';
  end if;

  -- A confirmed sales order without an invoice can still be cancelled, and
  -- once cancelled it cannot be invoiced (cancel won the race).
  v_so := public.create_sales_order(current_setting('test.cust_a')::uuid, date '2026-11-02', null, null,
    jsonb_build_array(jsonb_build_object('product_id', current_setting('test.prod_a')::uuid, 'quantity', '1')));
  perform public.set_sales_order_status(v_so, 'confirmed');
  perform public.set_sales_order_status(v_so, 'cancelled');
  begin
    perform public.create_invoice_from_sales_order(v_so, date '2026-11-07', null);
    raise exception 'FAIL: cancelled sales order invoiced';
  exception when object_not_in_prerequisite_state then null;
  end;
end $$;
reset role;

-- The employee is refused by role first (42501), as before.
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"c3000000-0000-4000-8000-00000000000e","role":"authenticated"}', true);
do $$ begin
  begin
    perform public.set_sales_order_status(current_setting('test.so_conf')::uuid, 'cancelled');
    raise exception 'FAIL: employee cancelled an invoiced sales order';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- The guard holds for any writer (postgres here); other updates still work.
do $$ begin
  begin
    update public.sales_orders set status = 'cancelled' where id = current_setting('test.so_conf')::uuid;
    raise exception 'FAIL: privileged writer cancelled an invoiced sales order';
  exception when object_not_in_prerequisite_state then null;
  end;
  update public.sales_orders set status = 'completed' where id = current_setting('test.so_conf3')::uuid;
  if (select status from public.sales_orders where id = current_setting('test.so_conf3')::uuid) <> 'completed' then
    raise exception 'FAIL: privileged writer could not complete an invoiced sales order';
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- Owner B: tenant isolation
-- -----------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"c3000000-0000-4000-8000-00000000000b","role":"authenticated"}', true);

do $$
declare
  v_ia  uuid := current_setting('test.inv_draft')::uuid;   -- Organization A draft
  v_inv uuid;
  v_s1  text;
  v_s2  text;
  v_e1  text;
  v_e2  text;
  v_t   text;
begin
  if exists (select 1 from public.invoices where organization_id = current_setting('test.org_a')::uuid)
     or exists (select 1 from public.invoice_items where organization_id = current_setting('test.org_a')::uuid) then
    raise exception 'FAIL: user B can read Organization A invoices or items';
  end if;
  if public.get_invoice(current_setting('test.org_a')::uuid, v_ia) is not null
     or public.get_invoice(current_setting('test.org_b')::uuid, v_ia) is not null then
    raise exception 'FAIL: user B read Organization A invoice through get_invoice';
  end if;

  -- B converts B's own confirmed sales order; numbering is separate.
  v_inv := public.create_invoice_from_sales_order(current_setting('test.so_b')::uuid, date '2026-11-04', null);
  if (select invoice_number || '|' || grand_total::text || '|' || amount_due::text
      from public.invoices where id = v_inv) <> 'INV-000001|10.00|10.00' then
    raise exception 'FAIL: Organization B conversion or numbering wrong';
  end if;

  -- B cannot convert A's confirmed sales order: same as an unknown ID.
  begin
    perform public.create_invoice_from_sales_order(current_setting('test.so_conf')::uuid, date '2026-11-04', null);
    raise exception 'FAIL: user B converted Organization A sales order';
  exception when others then v_s1 := sqlstate; v_e1 := sqlerrm;
  end;
  begin
    perform public.create_invoice_from_sales_order(gen_random_uuid(), date '2026-11-04', null);
  exception when others then v_s2 := sqlstate; v_e2 := sqlerrm;
  end;
  if v_s1 <> 'P0002' or v_s1 <> v_s2 or v_e1 <> v_e2 then
    raise exception 'FAIL: other-tenant conversion (% %) differs from unknown (% %)', v_s1, v_e1, v_s2, v_e2;
  end if;

  -- B cannot use A's customer or product.
  begin
    perform public.create_invoice(current_setting('test.cust_a')::uuid, date '2026-11-04', null, null,
      jsonb_build_array(jsonb_build_object('product_id', current_setting('test.prod_b')::uuid, 'quantity', '1')));
    raise exception 'FAIL: user B used Organization A customer';
  exception when foreign_key_violation then null;
  end;
  begin
    perform public.update_invoice_draft(v_inv, current_setting('test.cust_b')::uuid, date '2026-11-04', null, null,
      jsonb_build_array(jsonb_build_object('product_id', current_setting('test.prod_a')::uuid, 'quantity', '1')));
    raise exception 'FAIL: user B used Organization A product';
  exception when foreign_key_violation then null;
  end;
  -- ... nor copy a line snapshot from A's invoice by its id.
  begin
    perform public.update_invoice_draft(v_inv, current_setting('test.cust_b')::uuid, date '2026-11-04', null, null,
      jsonb_build_array(jsonb_build_object(
        'id', (select id from public.invoice_items where invoice_id = v_inv limit 1),
        'product_id', current_setting('test.prod_b')::uuid, 'quantity', '1'),
      jsonb_build_object('id', 'c3000000-0000-4000-8000-0000000000ff',
        'product_id', current_setting('test.prod_b')::uuid, 'quantity', '1')));
    raise exception 'FAIL: user B referenced a foreign line id';
  exception when invalid_parameter_value then null;
  end;

  -- Update and status changes of A's invoice fail exactly like unknown IDs.
  begin
    perform public.update_invoice_draft(v_ia, current_setting('test.cust_b')::uuid, date '2026-11-04', null, null,
      jsonb_build_array(jsonb_build_object('product_id', current_setting('test.prod_b')::uuid, 'quantity', '1')));
    raise exception 'FAIL: user B updated Organization A invoice';
  exception when others then v_s1 := sqlstate; v_e1 := sqlerrm;
  end;
  begin
    perform public.update_invoice_draft(gen_random_uuid(), current_setting('test.cust_b')::uuid, date '2026-11-04', null, null,
      jsonb_build_array(jsonb_build_object('product_id', current_setting('test.prod_b')::uuid, 'quantity', '1')));
  exception when others then v_s2 := sqlstate; v_e2 := sqlerrm;
  end;
  if v_s1 <> 'P0002' or v_s1 <> v_s2 or v_e1 <> v_e2 then
    raise exception 'FAIL: other-tenant update (% %) differs from unknown (% %)', v_s1, v_e1, v_s2, v_e2;
  end if;

  foreach v_t in array array['issued', 'cancelled'] loop
    begin
      perform public.set_invoice_status(v_ia, v_t);
      raise exception 'FAIL: user B changed Organization A invoice status';
    exception when others then v_s1 := sqlstate; v_e1 := sqlerrm;
    end;
    begin
      perform public.set_invoice_status(gen_random_uuid(), v_t);
    exception when others then v_s2 := sqlstate; v_e2 := sqlerrm;
    end;
    if v_s1 <> 'P0002' or v_s1 <> v_s2 or v_e1 <> v_e2 then
      raise exception 'FAIL: other-tenant status change (% %) differs from unknown (% %)', v_s1, v_e1, v_s2, v_e2;
    end if;
  end loop;

  -- Cancelling A's invoiced sales order reveals nothing about its invoice:
  -- same as an unknown ID.
  begin
    perform public.set_sales_order_status(current_setting('test.so_conf')::uuid, 'cancelled');
    raise exception 'FAIL: user B cancelled Organization A sales order';
  exception when others then v_s1 := sqlstate; v_e1 := sqlerrm;
  end;
  begin
    perform public.set_sales_order_status(gen_random_uuid(), 'cancelled');
  exception when others then v_s2 := sqlstate; v_e2 := sqlerrm;
  end;
  if v_s1 <> 'P0002' or v_s1 <> v_s2 or v_e1 <> v_e2 then
    raise exception 'FAIL: other-tenant invoiced SO cancel (% %) differs from unknown (% %)', v_s1, v_e1, v_s2, v_e2;
  end if;

  -- B's own list holds only B's invoice.
  if (select count(*) from public.invoices) <> 1
     or exists (select 1 from public.invoices where source_sales_order_id = current_setting('test.so_conf')::uuid) then
    raise exception 'FAIL: user B sees invoices beyond their own';
  end if;
end $$;

reset role;

do $$ begin
  if (select status from public.invoices where id = current_setting('test.inv_draft')::uuid) <> 'draft'
     or (select notes from public.invoices where id = current_setting('test.inv_draft')::uuid) is not null
     or (select count(*) from public.invoices where source_sales_order_id = current_setting('test.so_conf')::uuid) <> 1 then
    raise exception 'FAIL: Organization A data changed by user B';
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- Disabled member: no access at all
-- -----------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"c3000000-0000-4000-8000-00000000000d","role":"authenticated"}', true);

do $$ begin
  if exists (select 1 from public.invoices) or exists (select 1 from public.invoice_items) then
    raise exception 'FAIL: disabled member can read invoices';
  end if;
  if public.get_invoice(current_setting('test.org_a')::uuid, current_setting('test.inv_draft')::uuid) is not null then
    raise exception 'FAIL: disabled member read an invoice through get_invoice';
  end if;
  begin
    perform public.create_invoice(current_setting('test.cust_a')::uuid, date '2026-11-04', null, null,
      jsonb_build_array(jsonb_build_object('product_id', current_setting('test.prod_a')::uuid, 'quantity', '1')));
    raise exception 'FAIL: disabled member created an invoice';
  exception when foreign_key_violation then null;
  end;
  begin
    perform public.create_invoice_from_sales_order(current_setting('test.so_conf')::uuid, date '2026-11-04', null);
    raise exception 'FAIL: disabled member converted a sales order';
  exception when no_data_found then null;
  end;
  begin
    perform public.update_invoice_draft(current_setting('test.inv_draft')::uuid, current_setting('test.cust_a')::uuid,
      date '2026-11-04', null, null,
      jsonb_build_array(jsonb_build_object('product_id', current_setting('test.prod_a')::uuid, 'quantity', '1')));
    raise exception 'FAIL: disabled member updated an invoice';
  exception when no_data_found then null;
  end;
  begin
    perform public.set_invoice_status(current_setting('test.inv_draft')::uuid, 'issued');
    raise exception 'FAIL: disabled member changed an invoice status';
  exception when no_data_found then null;
  end;
end $$;

reset role;

-- A manager disabled later loses access at once.
update public.organization_members set status = 'disabled'
where user_id = 'c3000000-0000-4000-8000-00000000000c';

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"c3000000-0000-4000-8000-00000000000c","role":"authenticated"}', true);

do $$ begin
  if exists (select 1 from public.invoices)
     or public.get_invoice(current_setting('test.org_a')::uuid, current_setting('test.inv_draft')::uuid) is not null then
    raise exception 'FAIL: newly disabled manager can still read invoices';
  end if;
  begin
    perform public.set_invoice_status(current_setting('test.inv_draft')::uuid, 'cancelled');
    raise exception 'FAIL: newly disabled manager changed an invoice status';
  exception when no_data_found then null;
  end;
  begin
    perform public.update_invoice_draft(current_setting('test.inv_draft')::uuid, current_setting('test.cust_a')::uuid,
      date '2026-11-04', null, null,
      jsonb_build_array(jsonb_build_object('product_id', current_setting('test.prod_a')::uuid, 'quantity', '1')));
    raise exception 'FAIL: newly disabled manager updated an invoice';
  exception when no_data_found then null;
  end;
  begin
    perform public.create_invoice(current_setting('test.cust_a')::uuid, date '2026-11-04', null, null,
      jsonb_build_array(jsonb_build_object('product_id', current_setting('test.prod_a')::uuid, 'quantity', '1')));
    raise exception 'FAIL: newly disabled manager created an invoice';
  exception when foreign_key_violation then null;
  end;
end $$;

reset role;

-- -----------------------------------------------------------------------------
-- Reserved payment transitions, simulating the future Payment module: drop
-- the Part 1 constraint inside this (rolled-back) transaction and move an
-- issued invoice as a system writer would. Kept last because it changes the
-- schema for the rest of the transaction.
-- -----------------------------------------------------------------------------
alter table public.invoices drop constraint invoices_no_payments_yet_check;

do $$
declare
  v_inv uuid := current_setting('test.inv_emp_issued')::uuid;   -- issued, 1998.00
begin
  -- The status must agree with the balance.
  begin
    update public.invoices set status = 'paid', amount_paid = 1, amount_due = grand_total - 1 where id = v_inv;
    raise exception 'FAIL: paid with an amount due accepted';
  exception when check_violation then null;
  end;
  begin
    update public.invoices set amount_paid = 1, amount_due = grand_total - 1 where id = v_inv;
    raise exception 'FAIL: issued invoice with a payment accepted';
  exception when check_violation then null;
  end;
  begin
    update public.invoices set status = 'partially_paid', amount_paid = grand_total + 1, amount_due = -1 where id = v_inv;
    raise exception 'FAIL: overpayment accepted';
  exception when check_violation then null;
  end;

  -- A positive paid invoice needs the full amount; partially_paid needs
  -- something paid and something due.
  begin
    update public.invoices set status = 'paid', amount_paid = grand_total - 1, amount_due = 0 where id = v_inv;
    raise exception 'FAIL: paid with amount_due 0 but not fully paid accepted';
  exception when check_violation then null;
  end;
  begin
    update public.invoices set status = 'paid' where id = v_inv;
    raise exception 'FAIL: positive invoice paid with nothing paid';
  exception when check_violation then null;
  end;
  begin
    update public.invoices set status = 'partially_paid' where id = v_inv;
    raise exception 'FAIL: partially_paid with nothing paid accepted';
  exception when check_violation then null;
  end;
  begin
    update public.invoices set status = 'partially_paid', amount_paid = grand_total, amount_due = 0 where id = v_inv;
    raise exception 'FAIL: partially_paid with nothing due accepted';
  exception when check_violation then null;
  end;

  update public.invoices set status = 'partially_paid', amount_paid = 500, amount_due = grand_total - 500 where id = v_inv;

  -- No refunds or credits in V1: an invoice with payments cannot be cancelled.
  begin
    update public.invoices set status = 'cancelled' where id = v_inv;
    raise exception 'FAIL: partially paid invoice cancelled';
  exception when object_not_in_prerequisite_state then null;
  end;
  -- Commercial content stays frozen while payments move.
  begin
    update public.invoices set notes = 'x', amount_paid = 600, amount_due = grand_total - 600 where id = v_inv;
    raise exception 'FAIL: partially paid invoice content changed';
  exception when object_not_in_prerequisite_state then null;
  end;

  update public.invoices set status = 'paid', amount_paid = grand_total, amount_due = 0 where id = v_inv;
  if (select status || '|' || amount_paid::text || '|' || amount_due::text from public.invoices where id = v_inv)
     <> 'paid|1998.00|0.00' then
    raise exception 'FAIL: simulated payment did not reach paid';
  end if;

  -- paid is terminal.
  begin
    update public.invoices set status = 'cancelled' where id = v_inv;
    raise exception 'FAIL: paid invoice cancelled';
  exception when object_not_in_prerequisite_state then null;
  end;
  begin
    update public.invoices set status = 'partially_paid', amount_paid = 1, amount_due = grand_total - 1 where id = v_inv;
    raise exception 'FAIL: paid invoice moved back to partially_paid';
  exception when object_not_in_prerequisite_state then null;
  end;
  begin
    delete from public.invoices where id = v_inv;
    raise exception 'FAIL: paid invoice deleted';
  exception when object_not_in_prerequisite_state then null;
  end;
end $$;

-- Zero-total invoice: settled with nothing paid. partially_paid is never
-- possible for it.
do $$
declare
  v_zero uuid := current_setting('test.inv_zero')::uuid;   -- issued, 0.00
begin
  begin
    update public.invoices set status = 'partially_paid' where id = v_zero;
    raise exception 'FAIL: zero-total invoice partially paid';
  exception when check_violation then null;
  end;
  begin
    update public.invoices set status = 'paid', amount_paid = 1, amount_due = -1 where id = v_zero;
    raise exception 'FAIL: zero-total invoice overpaid';
  exception when check_violation then null;
  end;
  update public.invoices set status = 'paid' where id = v_zero;
  if (select status || '|' || grand_total::text || '|' || amount_paid::text || '|' || amount_due::text
      from public.invoices where id = v_zero) <> 'paid|0.00|0.00|0.00' then
    raise exception 'FAIL: zero-total invoice not consistent with paid';
  end if;
end $$;

-- The user status RPC still cannot cancel a paid invoice.
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"c3000000-0000-4000-8000-00000000000a","role":"authenticated"}', true);
do $$ begin
  begin
    perform public.set_invoice_status(current_setting('test.inv_emp_issued')::uuid, 'cancelled');
    raise exception 'FAIL: owner cancelled a paid invoice';
  exception when object_not_in_prerequisite_state then null;
  end;
end $$;
reset role;

-- -----------------------------------------------------------------------------
-- Part 2 list RPC: grants, exact balances, snapshots, filters, pagination, RLS.
-- Payment statuses above are simulated in this rolled-back test only.
-- -----------------------------------------------------------------------------
do $$
declare v_fn text := 'public.list_invoices(uuid, text, text, uuid, integer, integer)';
begin
  if not exists (
    select 1 from pg_proc p join pg_language l on l.oid = p.prolang
    where p.oid = v_fn::regprocedure and not p.prosecdef
      and p.provolatile = 's' and l.lanname = 'sql'
      and p.proconfig @> array['search_path=""']
  ) or has_function_privilege('anon', v_fn, 'execute')
    or not has_function_privilege('authenticated', v_fn, 'execute') then
    raise exception 'FAIL: invoice list definition/grants';
  end if;
end $$;
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
do $$ begin
  begin
    perform public.list_invoices(current_setting('test.org_a')::uuid);
    raise exception 'FAIL: anon listed invoices';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"c3000000-0000-4000-8000-00000000000a","role":"authenticated"}', true);
do $$
declare
  v_org uuid := current_setting('test.org_a')::uuid;
  v_customer uuid;
  v_invoice uuid;
  v_expected uuid[];
  v_ids uuid[];
  v_page1 uuid[];
  v_page2 uuid[];
  v_count bigint;
  v_status text;
  v_row record;
begin
  insert into public.customers(organization_id, name) values (v_org, 'Wild 100% Under_score')
  returning id into v_customer;
  v_invoice := public.create_invoice(v_customer, date '2026-11-06', null, null,
    jsonb_build_array(jsonb_build_object('product_id', current_setting('test.prod_a')::uuid,
      'quantity', '1', 'unit_price', '9999999999999999.99')));
  perform set_config('test.inv_wild', v_invoice::text, true);
  -- List display/search uses the snapshot, even after master data changes.
  update public.customers set name = 'Changed master' where id = v_customer;

  select array_agg(id order by created_at desc, id desc) into v_expected
  from public.invoices where organization_id = v_org;
  select array_agg(l.id order by l.ordinality), max(l.total_count) into v_ids, v_count
  from public.list_invoices(v_org, null, null, null, 100, 0) with ordinality as l;
  if v_ids is distinct from v_expected or v_count <> cardinality(v_expected) then
    raise exception 'FAIL: invoice list ordering/count';
  end if;
  select * into v_row from public.list_invoices(v_org, 'under_score');
  if v_row.id is distinct from v_invoice or v_row.customer_name <> 'Wild 100% Under_score'
    or v_row.invoice_date <> date '2026-11-06' or v_row.due_date is not null
    or v_row.grand_total <> '9999999999999999.99' or v_row.amount_paid <> '0.00'
    or v_row.amount_due <> v_row.grand_total or pg_typeof(v_row.amount_due)::text <> 'text'
    or pg_typeof(v_row.amount_paid)::text <> 'text' or pg_typeof(v_row.grand_total)::text <> 'text' then
    raise exception 'FAIL: invoice list snapshot/exact balance/date';
  end if;
  if (select array_agg(id) from public.list_invoices(v_org, '%')) is distinct from array[v_invoice]
    or (select array_agg(id) from public.list_invoices(v_org, '_')) is distinct from array[v_invoice]
    or exists (select 1 from public.list_invoices(v_org, '\'))
    or exists (select 1 from public.list_invoices(v_org, 'no such invoice')) then
    raise exception 'FAIL: invoice list literal wildcard search';
  end if;
  if (select array_agg(id) from public.list_invoices(v_org,
       E'\u3000' || lower(v_row.invoice_number) || E'\u2028')) is distinct from array[v_invoice]
    or (select max(total_count) from public.list_invoices(v_org, E'\u2029')) <> v_count then
    raise exception 'FAIL: invoice list number search/Unicode trimming';
  end if;
  foreach v_status in array array['draft', 'issued', 'cancelled', 'partially_paid', 'paid'] loop
    if (select count(*) from public.list_invoices(v_org, null, v_status, null, 100)) <>
       (select count(*) from public.invoices where organization_id = v_org and status = v_status) then
      raise exception 'FAIL: invoice list status filter %', v_status;
    end if;
  end loop;
  if (select array_agg(id) from public.list_invoices(v_org, 'under', 'draft', v_customer))
       is distinct from array[v_invoice]
    or exists (select 1 from public.list_invoices(v_org, null, 'issued', v_customer))
    or exists (select 1 from public.list_invoices(v_org, null, 'bogus'))
    or exists (select 1 from public.list_invoices(v_org, null, null, current_setting('test.cust_b')::uuid))
    or exists (select 1 from public.list_invoices(v_org, null, null, gen_random_uuid())) then
    raise exception 'FAIL: invoice list combined/customer/status filters';
  end if;
  if not exists (select 1 from public.list_invoices(v_org, null, null, null, 100) l
    join public.sales_orders so on so.id = l.source_sales_order_id
    where l.id = current_setting('test.inv_conv')::uuid
      and l.source_sales_order_number = so.sales_order_number) then
    raise exception 'FAIL: invoice list source number';
  end if;
  select array_agg(l.id order by l.ordinality) into v_page1
  from public.list_invoices(v_org, null, null, null, 5, 0) with ordinality l;
  select array_agg(l.id order by l.ordinality) into v_page2
  from public.list_invoices(v_org, null, null, null, 5, 5) with ordinality l;
  if v_page1 || v_page2 is distinct from v_expected[1:10]
    or (select max(total_count) from public.list_invoices(v_org, null, null, null, 5, 5)) <> v_count
    or (select count(*) from public.list_invoices(v_org, null, null, null, 0, 0)) <> 1
    or (select count(*) from public.list_invoices(v_org, null, null, null, null, 0)) <> least(25, v_count)
    or (select count(*) from public.list_invoices(v_org, null, null, null, 1000, 0)) <> least(100, v_count)
    or (select array_agg(l.id order by l.ordinality) from public.list_invoices(v_org, null, null, null, 5, -1) with ordinality l)
       is distinct from v_page1
    or exists (select 1 from public.list_invoices(v_org, null, null, null, 25, 100000)) then
    raise exception 'FAIL: invoice list pagination/clamping';
  end if;
  if exists (select 1 from public.list_invoices(current_setting('test.org_b')::uuid))
    or exists (select 1 from public.list_invoices(null)) then
    raise exception 'FAIL: invoice list organization filter widened access';
  end if;
end $$;
reset role;

-- All active roles have the same list; disabled members see nothing.
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"c3000000-0000-4000-8000-00000000000e","role":"authenticated"}', true);
do $$ begin
  if (select max(total_count) from public.list_invoices(current_setting('test.org_a')::uuid))
    is distinct from (select count(*) from public.invoices where organization_id = current_setting('test.org_a')::uuid) then
    raise exception 'FAIL: employee invoice list';
  end if;
end $$;
reset role;
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"c3000000-0000-4000-8000-00000000000b","role":"authenticated"}', true);
do $$ begin
  if exists (select 1 from public.list_invoices(current_setting('test.org_a')::uuid))
    or exists (select 1 from public.list_invoices(current_setting('test.org_b')::uuid, null, null, current_setting('test.cust_a')::uuid))
    or exists (select 1 from public.list_invoices(current_setting('test.org_a')::uuid, 'INV', 'draft')) then
    raise exception 'FAIL: user B listed Organization A invoices';
  end if;
end $$;
reset role;
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"c3000000-0000-4000-8000-00000000000d","role":"authenticated"}', true);
do $$ begin
  if exists (select 1 from public.list_invoices(current_setting('test.org_a')::uuid)) then
    raise exception 'FAIL: disabled member listed invoices';
  end if;
end $$;
reset role;

select 'ALL INVOICE CHECKS PASSED' as result;

rollback;
