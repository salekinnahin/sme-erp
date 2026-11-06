-- Purchase Order Part 1. Run locally as postgres after 20261104180000.
-- Simulates API roles/JWTs; all fixtures and temporary helpers roll back.
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

insert into auth.users (id, email) values
 ('a8000000-0000-4000-8000-000000000001','po-owner@test.example'),
 ('a8000000-0000-4000-8000-000000000002','po-manager@test.example'),
 ('a8000000-0000-4000-8000-000000000003','po-employee@test.example'),
 ('a8000000-0000-4000-8000-000000000004','po-disabled@test.example'),
 ('a8000000-0000-4000-8000-000000000005','po-other@test.example');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"a8000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select set_config('test.po_org_a',public.create_organization('Purchasing A','BDT','UTC')::text,true);
select set_config('request.jwt.claims','{"sub":"a8000000-0000-4000-8000-000000000005","role":"authenticated"}',true);
select set_config('test.po_org_b',public.create_organization('Purchasing B','USD','UTC')::text,true);
reset role;
insert into public.organization_members (organization_id,user_id,role,status) values
 (current_setting('test.po_org_a')::uuid,'a8000000-0000-4000-8000-000000000002','manager','active'),
 (current_setting('test.po_org_a')::uuid,'a8000000-0000-4000-8000-000000000003','employee','active'),
 (current_setting('test.po_org_a')::uuid,'a8000000-0000-4000-8000-000000000004','employee','disabled');

-- Privileged fixtures; operations below use authenticated, never service role.
do $$
declare o uuid; v uuid; p uuid; k text;
begin
 foreach k in array array['a','b'] loop
  o := current_setting('test.po_org_'||k)::uuid;
  insert into public.vendors (organization_id,name,company_name,phone,email,address,tax_number)
  values (o,'Supplier '||k,'Supply Co','+8801711000000','vendor@test.example','Dhaka','TAX-1') returning id into v;
  perform set_config('test.po_vendor_'||k,v::text,true);
  insert into public.products (organization_id,name,sku,description,unit,product_type,purchase_price,selling_price)
  values (o,'Widget '||k,'PO-'||k,'Recorded description','box','inventory',12.50,999) returning id into p;
  perform set_config('test.po_product_'||k,p::text,true);
 end loop;
 insert into public.vendors (organization_id,name,status) values (current_setting('test.po_org_a')::uuid,'Inactive vendor','inactive') returning id into v;
 perform set_config('test.po_inactive_vendor',v::text,true);
 insert into public.products (organization_id,name,sku,unit,product_type,status,purchase_price)
 values (current_setting('test.po_org_a')::uuid,'Inactive','PO-inactive','pcs','inventory','inactive',1) returning id into p;
 perform set_config('test.po_inactive_product',p::text,true);
 insert into public.products (organization_id,name,sku,unit,product_type,selling_price)
 values (current_setting('test.po_org_a')::uuid,'Service','PO-service','hour','service',500) returning id into p;
 perform set_config('test.po_service',p::text,true);
 insert into public.products (organization_id,name,sku,description,unit,product_type,purchase_price)
 values (current_setting('test.po_org_a')::uuid,'Noninventory','PO-noninventory','B description','pcs','non_inventory',2) returning id into p;
 perform set_config('test.po_noninventory',p::text,true);
end $$;

-- Helpers make assertions concise, not privileged: SECURITY INVOKER.
create function pg_temp.po_create(v uuid, items jsonb) returns uuid language sql as $$
 select public.create_purchase_order(v,date '2026-11-06',null,'PO notes',items);
$$;
create function pg_temp.po_items(p uuid) returns jsonb language sql as $$
 select jsonb_build_array(jsonb_build_object('product_id',p,'quantity','3','tax_rate','7.5'));
$$;
create function pg_temp.po_edit(po uuid, v uuid, items jsonb) returns void language sql as $$
 select public.update_purchase_order_draft(po,v,date '2026-11-06',null,'Edited notes',items);
$$;

-- Definitions, grants, fixed paths, RLS and no stock dependency.
do $$
declare f record; t text; r text;
begin
 foreach t in array array['purchase_orders','purchase_order_items'] loop
  if not (select relrowsecurity from pg_class where oid=('public.'||t)::regclass)
    or exists(select 1 from pg_policies where schemaname='public' and tablename=t and cmd <> 'SELECT') then
   raise exception 'FAIL: RLS %',t;
  end if;
  foreach r in array array['anon','authenticated'] loop
   if has_any_column_privilege(r,'public.'||t,'INSERT') or has_any_column_privilege(r,'public.'||t,'UPDATE')
     or has_table_privilege(r,'public.'||t,'DELETE,TRUNCATE') then raise exception 'FAIL: direct write grants % %',r,t; end if;
  end loop;
 end loop;
 for f in select p.*,l.lanname from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_language l on l.oid=p.prolang
   where n.nspname='public' and (p.proname like '%purchase_order%' ) loop
  if not (f.proconfig @> array['search_path=""']) then raise exception 'FAIL: search path %',f.proname; end if;
  if f.proname in ('create_purchase_order','update_purchase_order_draft','set_purchase_order_status','get_purchase_order','list_purchase_orders') then
   if not has_function_privilege('authenticated',f.oid,'EXECUTE') or has_function_privilege('anon',f.oid,'EXECUTE') then raise exception 'FAIL: RPC grants'; end if;
   if f.proname in ('get_purchase_order','list_purchase_orders') then
    if f.prosecdef or f.provolatile <> 's' or f.lanname <> 'sql' then raise exception 'FAIL: read definition'; end if;
   elsif not f.prosecdef then raise exception 'FAIL: write definition'; end if;
  elsif has_function_privilege('authenticated',f.oid,'EXECUTE') or has_function_privilege('anon',f.oid,'EXECUTE') then
   raise exception 'FAIL: internal helper grants %',f.proname;
  end if;
  -- Inventory is not implemented yet. Prove structurally that none of these
  -- functions depends on stock, quantity balances, reservations or receiving writes.
  if f.prosrc ~* '(stock_movements|stock_on_hand|reserved_quantity|available_quantity|insert into.*goods_receiv)' then
   raise exception 'FAIL: stock mutation dependency %',f.proname;
  end if;
 end loop;
 if to_regclass('public.stock_movements') is not null then raise exception 'Update stock regression to compare the implemented ledger'; end if;
end $$;

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"a8000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
-- Creation, exact defaults and forged values ignored.
do $$
declare po uuid; d jsonb; i jsonb; v uuid:=current_setting('test.po_vendor_a')::uuid; p uuid:=current_setting('test.po_product_a')::uuid;
begin
 i:=pg_temp.po_items(p);
 i:=jsonb_set(i,'{0}',i->0 || '{"organization_id":"ffffffff-ffff-ffff-ffff-ffffffffffff","status":"received","product_name":"FORGED","unit":"FORGED","unit_price_override":"1","tax_amount":"999","line_total":"999","grand_total":"999","created_by":"ffffffff-ffff-ffff-ffff-ffffffffffff"}'::jsonb);
 po:=pg_temp.po_create(v,i);
 perform set_config('test.po_main',po::text,true);
 d:=public.get_purchase_order(current_setting('test.po_org_a')::uuid,po);
 if d->>'purchase_order_number' <> 'PO-000001' or d->>'vendor_name' <> 'Supplier a' or d->>'vendor_tax_number' <> 'TAX-1'
  or d->>'status' <> 'draft' or d->>'subtotal' <> '37.50' or d->>'tax_total' <> '2.81' or d->>'grand_total' <> '40.31'
  or d#>>'{items,0,unit_price}' <> '12.50' or d#>>'{items,0,quantity}' <> '3.000'
  or d#>>'{items,0,product_name}' <> 'Widget a' or d#>>'{items,0,unit}' <> 'box' then raise exception 'FAIL: create/defaults/snapshots %',d; end if;
 if not exists(select 1 from public.purchase_orders where id=po and organization_id=current_setting('test.po_org_a')::uuid and created_by=auth.uid()) then raise exception 'FAIL: identity'; end if;
 perform set_config('test.po_line',d#>>'{items,0,id}',true);
 -- All product types, service explicit price, deterministic sort, discount/tax rounding.
 po:=pg_temp.po_create(v,jsonb_build_array(
  jsonb_build_object('product_id',p,'quantity','2.5','unit_price','90','discount_amount','10','tax_rate','15'),
  jsonb_build_object('product_id',current_setting('test.po_service'),'quantity','1','unit_price','124.99','tax_rate','10'),
  jsonb_build_object('product_id',current_setting('test.po_noninventory'),'quantity','1')));
 d:=public.get_purchase_order(current_setting('test.po_org_a')::uuid,po);
 if d->>'subtotal' <> '351.99' or d->>'discount_total' <> '10.00' or d->>'tax_total' <> '44.75' or d->>'grand_total' <> '386.74'
  or d#>>'{items,2,sort_order}' <> '3' then raise exception 'FAIL: calculations/order %',d; end if;
 perform set_config('test.po_other',po::text,true);
 -- 100 accepted, zero and 101 rejected below.
 perform pg_temp.po_create(v,(select jsonb_agg(jsonb_build_object('product_id',p,'quantity','1')) from generate_series(1,100)));
end $$;

-- Invalid references, counts, dates, line tokens, numerical inputs; failures
-- are atomic and consume no numbers.
do $$
declare v uuid:=current_setting('test.po_vendor_a')::uuid; p uuid:=current_setting('test.po_product_a')::uuid; n bigint; s text; j jsonb; x text; code text;
begin
 select count(*) into n from public.purchase_orders;
 foreach x in array array[current_setting('test.po_vendor_b'),current_setting('test.po_inactive_vendor'),gen_random_uuid()::text] loop
  perform pg_temp.expect_error(format('select pg_temp.po_create(%L,pg_temp.po_items(%L))',x,p),'23503');
 end loop;
 foreach x in array array[current_setting('test.po_product_b'),current_setting('test.po_inactive_product'),gen_random_uuid()::text] loop
  perform pg_temp.expect_error(format('select pg_temp.po_create(%L,pg_temp.po_items(%L))',v,x),'23503');
 end loop;
 perform pg_temp.expect_error(format('select pg_temp.po_create(%L,pg_temp.po_items(%L))',v,current_setting('test.po_service')),'22023');
 foreach j in array array['null'::jsonb,'{}'::jsonb,'[]'::jsonb,'[null]'::jsonb,'[{}]'::jsonb,
  (select jsonb_agg(jsonb_build_object('product_id',p,'quantity','1')) from generate_series(1,101))] loop
  perform pg_temp.expect_error(format('select pg_temp.po_create(%L,%L)',v,j),'22023');
 end loop;
 foreach j in array array[
  '{"quantity":"0"}'::jsonb,'{"quantity":"-1"}'::jsonb,'{"quantity":"NaN"}'::jsonb,'{"quantity":"1e2"}'::jsonb,'{"quantity":"1.0001"}'::jsonb,
  '{"unit_price":"-1"}'::jsonb,'{"unit_price":"1.001"}'::jsonb,'{"unit_price":"NaN"}'::jsonb,
  '{"discount_amount":"9999"}'::jsonb,'{"discount_amount":"-1"}'::jsonb,'{"tax_rate":"101"}'::jsonb,
  '{"tax_rate":"-1"}'::jsonb,'{"description":123}'::jsonb,jsonb_build_object('description',repeat('x',2001)),
  jsonb_build_object('id',current_setting('test.po_line')),jsonb_build_object('id',123)] loop
  perform pg_temp.expect_error(format('select pg_temp.po_create(%L,%L)',v,jsonb_build_array(pg_temp.po_items(p)->0 || j)),'22023');
 end loop;
 perform pg_temp.expect_error(format('select pg_temp.po_create(%L,%L)',v,jsonb_build_array(jsonb_build_object('product_id',p,'quantity','999999999999999','unit_price','9999999999999999.99'))),'22003');
 foreach s in array array['null','''infinity''::date','''2026-02-30''::date'] loop
  code:=case when s like '%02-30%' then '22008' else '22023' end;
  perform pg_temp.expect_error(format('select public.create_purchase_order(%L,%s,null,null,%L)',v,s,pg_temp.po_items(p)),code);
 end loop;
 perform pg_temp.expect_error(format('select public.create_purchase_order(%L,''2026-11-06'',''2026-11-05'',null,%L)',v,pg_temp.po_items(p)),'22023');
 perform pg_temp.expect_error(format('select public.create_purchase_order(%L,''2026-11-06'',null,%L,%L)',v,repeat('x',2001),pg_temp.po_items(p)),'22023');
 if (select count(*) from public.purchase_orders) <> n then raise exception 'FAIL: failed create persisted'; end if;
 s:=pg_temp.po_create(v,pg_temp.po_items(p))::text;
 if (select purchase_order_number from public.purchase_orders where id=s::uuid) <> 'PO-000004' then raise exception 'FAIL: number consumed by failed create'; end if;
end $$;

-- API tables are read-only, even for owners, on all protected columns.
do $$
declare s text; po uuid:=current_setting('test.po_main')::uuid;
begin
 foreach s in array array[
  'insert into public.purchase_orders (organization_id,purchase_order_number,vendor_id,vendor_name,order_date,status,created_by,grand_total) values (gen_random_uuid(),''PO-999999'',gen_random_uuid(),''forged'',current_date,''received'',auth.uid(),999)',
  'update public.purchase_orders set organization_id=gen_random_uuid()',
  'update public.purchase_orders set purchase_order_number=''PO-999999''',
  'update public.purchase_orders set created_by=auth.uid(),created_at=now()',
  'update public.purchase_orders set status=''ordered''',
  'update public.purchase_orders set grand_total=999',
  'update public.purchase_orders set vendor_name=''forged''',
  'delete from public.purchase_orders',
  'insert into public.purchase_order_items (purchase_order_id) values (gen_random_uuid())',
  'update public.purchase_order_items set product_name=''forged'',unit_price=0',
  'delete from public.purchase_order_items',
  'select public.purchase_order_replace_items(gen_random_uuid(),gen_random_uuid(),''[]'')',
  'select public.next_document_number(gen_random_uuid(),''purchase_order'')'] loop
  perform pg_temp.expect_error(s,'42501');
 end loop;
end $$;
reset role;

-- Master-data edits/deactivation cannot change stored documents.
update public.vendors set name='Renamed supplier',status='inactive' where id=current_setting('test.po_vendor_a')::uuid;
update public.products set name='Renamed widget',sku='PO-NEW',description='Current description',unit='pcs',purchase_price=88,status='inactive' where id=current_setting('test.po_product_a')::uuid;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"a8000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
do $$
declare po uuid:=current_setting('test.po_main')::uuid; v uuid:=current_setting('test.po_vendor_a')::uuid; p uuid:=current_setting('test.po_product_a')::uuid; d jsonb; j jsonb; x text; before_doc jsonb;
begin
 j:=jsonb_build_array(jsonb_build_object('id',current_setting('test.po_line'),'product_id',p,'quantity','4','tax_rate','7.5'));
 perform pg_temp.po_edit(po,v,j);
 d:=public.get_purchase_order(current_setting('test.po_org_a')::uuid,po);
 if d->>'vendor_name' <> 'Supplier a' or d#>>'{items,0,product_name}' <> 'Widget a' or d#>>'{items,0,unit}' <> 'box'
  or d#>>'{items,0,description}' <> 'Recorded description' or d#>>'{items,0,unit_price}' <> '12.50'
  or d#>>'{items,0,id}' = current_setting('test.po_line') then raise exception 'FAIL: kept inactive references/defaults %',d; end if;
 perform set_config('test.po_line',d#>>'{items,0,id}',true);
 before_doc:=d;
 -- Each rejected edit leaves header, lines, IDs and amounts unchanged.
 foreach x in array array[gen_random_uuid()::text,
   (select id::text from public.purchase_order_items where purchase_order_id=current_setting('test.po_other')::uuid limit 1),
   current_setting('test.po_main')] loop
  perform pg_temp.expect_error(format('select pg_temp.po_edit(%L,%L,%L)',po,v,jsonb_build_array(jsonb_build_object('id',x,'product_id',p,'quantity','1'))),'22023');
 end loop;
 j:=jsonb_build_array(jsonb_build_object('id',current_setting('test.po_line'),'product_id',p,'quantity','1'));
 perform pg_temp.expect_error(format('select pg_temp.po_edit(%L,%L,%L)',po,v,j||j),'22023');
 perform pg_temp.expect_error(format('select pg_temp.po_edit(%L,%L,pg_temp.po_items(%L))',po,v,p),'23503');
 perform pg_temp.expect_error(format('select pg_temp.po_edit(%L,%L,pg_temp.po_items(%L))',po,current_setting('test.po_inactive_vendor'),current_setting('test.po_noninventory')),'23503');
 perform pg_temp.expect_error(format('select pg_temp.po_edit(%L,%L,pg_temp.po_items(%L))',po,current_setting('test.po_vendor_b'),current_setting('test.po_noninventory')),'23503');
 perform pg_temp.expect_error(format('select pg_temp.po_edit(%L,%L,%L)',po,v,jsonb_build_array(jsonb_build_object('id',current_setting('test.po_line'),'product_id',current_setting('test.po_inactive_product'),'quantity','1'))),'23503');
 if public.get_purchase_order(current_setting('test.po_org_a')::uuid,po) <> before_doc then raise exception 'FAIL: rejected edit changed document'; end if;
 -- Full A -> B -> A in one unsaved edit. The original line token survives
 -- both selections; it is consumed only by the final save. A is inactive and
 -- its current master values differ from every recorded snapshot value.
 j:=jsonb_build_array(jsonb_build_object(
  'id',d#>>'{items,0,id}','product_id',current_setting('test.po_noninventory'),
  'description','B description','unit_price','2.00',
  'quantity',d#>>'{items,0,quantity}','discount_amount',d#>>'{items,0,discount_amount}',
  'tax_rate',d#>>'{items,0,tax_rate}'));
 if (select unit from public.products where id=current_setting('test.po_noninventory')::uuid) = d#>>'{items,0,unit}' then
  raise exception 'FAIL: B must have a different unit';
 end if;
 -- Re-select original A: omit B's overrides to request the recorded defaults.
 j:=jsonb_set(j,'{0}',((j->0) - 'description' - 'unit_price') || jsonb_build_object('product_id',p));
 if j#>>'{0,id}' is distinct from d#>>'{items,0,id}' then raise exception 'FAIL: restoration lost reference token'; end if;
 perform pg_temp.po_edit(po,v,j);
 d:=public.get_purchase_order(current_setting('test.po_org_a')::uuid,po);
 if ((d#>'{items,0}') - 'id') is distinct from ((before_doc#>'{items,0}') - 'id')
  or d#>>'{items,0,product_name}' <> 'Widget a' or d#>>'{items,0,sku}' <> 'PO-a'
  or d#>>'{items,0,description}' <> 'Recorded description' or d#>>'{items,0,unit}' <> 'box'
  or d#>>'{items,0,unit_price}' <> '12.50' then
  raise exception 'FAIL: A -> B -> inactive A did not restore recorded values/amounts %',d;
 end if;
 perform set_config('test.po_line',d#>>'{items,0,id}',true);
end $$;
reset role;
-- Active alternate vendor and changed product get fresh snapshots/defaults.
do $$ declare v uuid; begin
 insert into public.vendors (organization_id,name) values(current_setting('test.po_org_a')::uuid,'Fresh vendor') returning id into v;
 perform set_config('test.po_vendor_new',v::text,true);
end $$;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"a8000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
do $$
declare d jsonb; po uuid:=current_setting('test.po_other')::uuid;
begin
 perform pg_temp.po_edit(po,current_setting('test.po_vendor_new')::uuid,
 jsonb_build_array(jsonb_build_object('id',(select id from public.purchase_order_items where purchase_order_id=po order by sort_order limit 1),'product_id',current_setting('test.po_noninventory'),'quantity','2')));
 d:=public.get_purchase_order(current_setting('test.po_org_a')::uuid,po);
 if d->>'vendor_name' <> 'Fresh vendor' or d#>>'{items,0,product_name}' <> 'Noninventory' or d#>>'{items,0,unit_price}' <> '2.00' then raise exception 'FAIL: new selection snapshot'; end if;
end $$;

-- Employee orders/edits/creates, but cannot cancel. Reserved targets refuse
-- every role (including owner), with no-op/terminal/unknown targets rejected.
select set_config('request.jwt.claims','{"sub":"a8000000-0000-4000-8000-000000000003","role":"authenticated"}',true);
do $$
declare po uuid; target text; role_user uuid;
begin
 po:=pg_temp.po_create(current_setting('test.po_vendor_new')::uuid,pg_temp.po_items(current_setting('test.po_noninventory')::uuid));
 perform pg_temp.po_edit(po,current_setting('test.po_vendor_new')::uuid,pg_temp.po_items(current_setting('test.po_noninventory')::uuid));
 perform pg_temp.expect_error(format('select public.set_purchase_order_status(%L,''cancelled'')',po),'42501');
 perform public.set_purchase_order_status(po,'ordered');
 perform set_config('test.po_ordered',po::text,true);
 perform pg_temp.expect_error(format('select public.set_purchase_order_status(%L,''cancelled'')',po),'42501');
 perform pg_temp.expect_error(format('select public.set_purchase_order_status(%L,''ordered'')',po),'55000');
 foreach role_user in array array['a8000000-0000-4000-8000-000000000001'::uuid,'a8000000-0000-4000-8000-000000000002'::uuid,'a8000000-0000-4000-8000-000000000003'::uuid] loop
  perform set_config('request.jwt.claims',jsonb_build_object('sub',role_user,'role','authenticated')::text,true);
  foreach target in array array['partially_received','received'] loop
   perform pg_temp.expect_error(format('select public.set_purchase_order_status(%L,%L)',po,target),'42501');
  end loop;
 end loop;
 perform pg_temp.expect_error(format('select public.set_purchase_order_status(%L,''draft'')',po),'22023');
 perform pg_temp.expect_error(format('select public.set_purchase_order_status(%L,''unknown'')',po),'22023');
 perform pg_temp.expect_error(format('select pg_temp.po_edit(%L,%L,pg_temp.po_items(%L))',po,current_setting('test.po_vendor_new'),current_setting('test.po_noninventory')),'55000');
end $$;
select set_config('request.jwt.claims','{"sub":"a8000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
do $$ declare po uuid; begin
 -- Manager orders, cancels ordered and cancels draft.
 po:=pg_temp.po_create(current_setting('test.po_vendor_new')::uuid,pg_temp.po_items(current_setting('test.po_noninventory')::uuid));
 perform public.set_purchase_order_status(po,'ordered');
 perform public.set_purchase_order_status(po,'cancelled');
 perform set_config('test.po_cancelled',po::text,true);
 perform pg_temp.expect_error(format('select public.set_purchase_order_status(%L,''ordered'')',po),'55000');
 po:=pg_temp.po_create(current_setting('test.po_vendor_new')::uuid,pg_temp.po_items(current_setting('test.po_noninventory')::uuid));
 perform public.set_purchase_order_status(po,'cancelled');
end $$;
select set_config('request.jwt.claims','{"sub":"a8000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
do $$ declare po uuid; begin
 po:=pg_temp.po_create(current_setting('test.po_vendor_new')::uuid,pg_temp.po_items(current_setting('test.po_noninventory')::uuid));
 perform public.set_purchase_order_status(po,'ordered');
 perform public.set_purchase_order_status(po,'cancelled');
 po:=pg_temp.po_create(current_setting('test.po_vendor_new')::uuid,pg_temp.po_items(current_setting('test.po_noninventory')::uuid));
 perform public.set_purchase_order_status(po,'cancelled');
end $$;
reset role;

-- Even privileged writers cannot change commercial content after ordering
-- or delete any purchase order. Whole-row comparison covers future columns.
do $$
declare po uuid:=current_setting('test.po_ordered')::uuid; s text; v_target uuid; before_items jsonb;
begin
 foreach s in array array[
  'vendor_id=gen_random_uuid()', 'vendor_name=''changed''', 'vendor_company_name=''changed''', 'vendor_phone=''changed''',
  'vendor_email=''changed''','vendor_address=''changed''','vendor_tax_number=''changed''',
  'order_date=current_date+1','expected_delivery_date=current_date+2','notes=''changed''',
  'subtotal=subtotal+1','discount_total=discount_total+1','tax_total=tax_total+1','grand_total=grand_total+1',
  'organization_id=gen_random_uuid()','purchase_order_number=''PO-999999''','created_by=gen_random_uuid()','created_at=now()+interval ''1 second'''] loop
  perform pg_temp.expect_error(format('update public.purchase_orders set %s where id=%L',s,po),'55000');
 end loop;
 perform pg_temp.expect_error(format('update public.purchase_order_items set quantity=2 where purchase_order_id=%L',po),'55000');
 perform pg_temp.expect_error(format('delete from public.purchase_order_items where purchase_order_id=%L',po),'55000');
 perform pg_temp.expect_error(format('insert into public.purchase_order_items(organization_id,purchase_order_id,product_id) values (%L,%L,%L)',current_setting('test.po_org_a'),po,current_setting('test.po_noninventory')),'55000');
 for v_target in select p.id from public.purchase_orders p loop
  perform pg_temp.expect_error(format('delete from public.purchase_orders where id=%L',v_target),'55000');
 end loop;
 perform pg_temp.expect_error('delete from public.purchase_orders','55000');
 perform pg_temp.expect_error(format('delete from public.organizations where id=%L',current_setting('test.po_org_a')),'55000');
 -- Composite references hold for privileged tools too.
 perform pg_temp.expect_error(format('update public.purchase_orders set vendor_id=%L where id=%L',current_setting('test.po_vendor_b'),current_setting('test.po_main')),'23503');
 perform pg_temp.expect_error(format('update public.purchase_order_items set product_id=%L where purchase_order_id=%L',current_setting('test.po_product_b'),current_setting('test.po_main')),'23503');
 perform pg_temp.expect_error(format('update public.purchase_order_items set organization_id=%L where purchase_order_id=%L',current_setting('test.po_org_b'),current_setting('test.po_main')),'23503');
 -- Reserved receiving transitions are legal for a future trusted module,
 -- but remain immutable and terminal as specified. No receiving RPC exists.
 update public.purchase_orders set status='partially_received' where id=po;
 select jsonb_agg(to_jsonb(i) order by i.id) into before_items
 from public.purchase_order_items i where purchase_order_id=po;
 if before_items is null then raise exception 'FAIL: partially received fixture has no items'; end if;
 begin
  delete from public.purchase_orders where id=po;
  raise exception 'FAIL: partially received purchase order deleted';
 exception when sqlstate '55000' then
  if sqlerrm <> 'purchase orders cannot be deleted' then raise; end if;
 end;
 if not exists(select 1 from public.purchase_orders where id=po and status='partially_received')
  or (select jsonb_agg(to_jsonb(i) order by i.id) from public.purchase_order_items i where purchase_order_id=po) is distinct from before_items then
  raise exception 'FAIL: rejected partially received delete changed order/items';
 end if;
 update public.purchase_orders set status='received' where id=po;
 perform pg_temp.expect_error(format('update public.purchase_orders set status=''cancelled'' where id=%L',po),'55000');
 perform pg_temp.expect_error(format('delete from public.purchase_orders where id=%L',po),'55000');
end $$;

-- Tenant B can use only B references, receives an independent PO-000001,
-- and cannot read/edit/change A or pass B line IDs into A edits.
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"a8000000-0000-4000-8000-000000000005","role":"authenticated"}',true);
do $$
declare po uuid; d jsonb; id uuid; code text;
begin
 if exists(select 1 from public.purchase_orders where organization_id=current_setting('test.po_org_a')::uuid)
  or exists(select 1 from public.purchase_order_items where organization_id=current_setting('test.po_org_a')::uuid)
  or public.get_purchase_order(current_setting('test.po_org_a')::uuid,current_setting('test.po_main')::uuid) is not null then raise exception 'FAIL: tenant read isolation'; end if;
 po:=pg_temp.po_create(current_setting('test.po_vendor_b')::uuid,pg_temp.po_items(current_setting('test.po_product_b')::uuid));
 d:=public.get_purchase_order(current_setting('test.po_org_b')::uuid,po);
 if d->>'purchase_order_number' <> 'PO-000001' then raise exception 'FAIL: tenant counter'; end if;
 perform set_config('test.po_line_b',d#>>'{items,0,id}',true);
 foreach id in array array[current_setting('test.po_main')::uuid,gen_random_uuid(),null::uuid] loop
  perform pg_temp.expect_error(format('select pg_temp.po_edit(%L,%L,pg_temp.po_items(%L))',id,current_setting('test.po_vendor_b'),current_setting('test.po_product_b')),'P0002');
  perform pg_temp.expect_error(format('select public.set_purchase_order_status(%L,''ordered'')',id),'P0002');
 end loop;
 perform pg_temp.expect_error(format('select pg_temp.po_create(%L,pg_temp.po_items(%L))',current_setting('test.po_vendor_a'),current_setting('test.po_product_b')),'23503');
 perform pg_temp.expect_error(format('select pg_temp.po_create(%L,pg_temp.po_items(%L))',current_setting('test.po_vendor_b'),current_setting('test.po_product_a')),'23503');
 if public.get_purchase_order(null,po) is not null or public.get_purchase_order(current_setting('test.po_org_b')::uuid,null) is not null then raise exception 'FAIL: null reads'; end if;
end $$;
select set_config('request.jwt.claims','{"sub":"a8000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select pg_temp.expect_error(format('select pg_temp.po_edit(%L,%L,%L)',current_setting('test.po_main'),current_setting('test.po_vendor_a'),
 jsonb_build_array(jsonb_build_object('id',current_setting('test.po_line_b'),'product_id',current_setting('test.po_product_a'),'quantity','1'))),'22023');
reset role;
update public.organization_members set status='disabled' where user_id='a8000000-0000-4000-8000-000000000002';
set local role authenticated;
do $$ declare u uuid; begin
 foreach u in array array['a8000000-0000-4000-8000-000000000004'::uuid,'a8000000-0000-4000-8000-000000000002'::uuid] loop
  perform set_config('request.jwt.claims',jsonb_build_object('sub',u,'role','authenticated')::text,true);
  if exists(select 1 from public.purchase_orders) or exists(select 1 from public.purchase_order_items)
   or public.get_purchase_order(current_setting('test.po_org_a')::uuid,current_setting('test.po_main')::uuid) is not null then raise exception 'FAIL: disabled membership'; end if;
  perform pg_temp.expect_error(format('select pg_temp.po_create(%L,pg_temp.po_items(%L))',current_setting('test.po_vendor_new'),current_setting('test.po_noninventory')),'23503');
  perform pg_temp.expect_error(format('select pg_temp.po_edit(%L,%L,pg_temp.po_items(%L))',current_setting('test.po_main'),current_setting('test.po_vendor_new'),current_setting('test.po_noninventory')),'P0002');
  perform pg_temp.expect_error(format('select public.set_purchase_order_status(%L,''ordered'')',current_setting('test.po_main')),'P0002');
 end loop;
end $$;
reset role;
set local role anon;
select set_config('request.jwt.claims','{"role":"anon"}',true);
select pg_temp.expect_error('select * from public.purchase_orders','42501');
select pg_temp.expect_error('select * from public.purchase_order_items','42501');
select pg_temp.expect_error('select public.create_purchase_order(null,current_date,null,null,''[]'')','42501');
select pg_temp.expect_error('select public.update_purchase_order_draft(null,null,current_date,null,null,''[]'')','42501');
select pg_temp.expect_error('select public.set_purchase_order_status(null,''ordered'')','42501');
select pg_temp.expect_error('select public.get_purchase_order(null,null)','42501');
select pg_temp.expect_error(format('select public.list_purchase_orders(%L)',current_setting('test.po_org_a')),'42501');
reset role;

-- -----------------------------------------------------------------------------
-- Part 2 list RPC: definition, snapshots, search, filters, pagination, RLS.
-- -----------------------------------------------------------------------------
do $$
declare v_fn text := 'public.list_purchase_orders(uuid, text, text, uuid, integer, integer)';
begin
 if not exists (select 1 from pg_proc p join pg_language l on l.oid=p.prolang
   where p.oid=v_fn::regprocedure and not p.prosecdef and p.provolatile='s' and l.lanname='sql'
     and p.proconfig @> array['search_path=""'])
  or has_function_privilege('anon',v_fn,'execute') or not has_function_privilege('authenticated',v_fn,'execute') then
  raise exception 'FAIL: purchase order list definition/grants';
 end if;
end $$;
do $$ declare v uuid; begin
 insert into public.vendors (organization_id,name,company_name)
 values (current_setting('test.po_org_a')::uuid,'Wild 100% Under_score','Bulk Traders Ltd') returning id into v;
 perform set_config('test.po_vendor_wild',v::text,true);
end $$;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"a8000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
do $$
declare
 v_org uuid:=current_setting('test.po_org_a')::uuid; v_vendor uuid:=current_setting('test.po_vendor_wild')::uuid;
 v_po uuid; v_po2 uuid; v_expected uuid[]; v_ids uuid[]; v_page1 uuid[]; v_page2 uuid[]; v_count bigint; v_status text; v_row record;
begin
 v_po:=public.create_purchase_order(v_vendor,date '2026-11-06',date '2026-11-20',null,
  jsonb_build_array(jsonb_build_object('product_id',current_setting('test.po_noninventory'),'quantity','1','unit_price','9999999999999999.99')));
 v_po2:=pg_temp.po_create(v_vendor,pg_temp.po_items(current_setting('test.po_noninventory')::uuid));
 perform public.set_purchase_order_status(v_po2,'ordered');

 select array_agg(id order by created_at desc, id desc) into v_expected from public.purchase_orders where organization_id=v_org;
 select array_agg(l.id order by l.ordinality), max(l.total_count) into v_ids, v_count
 from public.list_purchase_orders(v_org,null,null,null,100,0) with ordinality as l;
 if v_ids is distinct from v_expected or v_count <> cardinality(v_expected) or v_count < 11 then
  raise exception 'FAIL: purchase order list ordering/count';
 end if;

 select * into v_row from public.list_purchase_orders(v_org,'under_score','draft');
 if v_row.id is distinct from v_po or v_row.vendor_name <> 'Wild 100% Under_score' or v_row.vendor_company_name <> 'Bulk Traders Ltd'
  or v_row.vendor_id <> v_vendor or v_row.order_date <> date '2026-11-06' or v_row.expected_delivery_date <> date '2026-11-20'
  or v_row.status <> 'draft' or v_row.grand_total <> '9999999999999999.99' or pg_typeof(v_row.grand_total)::text <> 'text' then
  raise exception 'FAIL: purchase order list row %', row_to_json(v_row);
 end if;
 -- Literal wildcards; company snapshot; PO number; Unicode trim.
 if (select array_agg(id order by id) from public.list_purchase_orders(v_org,'%')) is distinct from (select array_agg(x order by x) from unnest(array[v_po,v_po2]) x)
  or (select array_agg(id order by id) from public.list_purchase_orders(v_org,'_')) is distinct from (select array_agg(x order by x) from unnest(array[v_po,v_po2]) x)
  or exists (select 1 from public.list_purchase_orders(v_org,'\'))
  or exists (select 1 from public.list_purchase_orders(v_org,'no such order'))
  or (select count(*) from public.list_purchase_orders(v_org,'bulk TRADERS')) <> 2 then
  raise exception 'FAIL: purchase order list literal/company search';
 end if;
 select purchase_order_number into v_status from public.purchase_orders where id=v_po;
 if (select array_agg(id) from public.list_purchase_orders(v_org,chr(12288)||lower(v_status)||chr(8232))) is distinct from array[v_po]
  or (select max(total_count) from public.list_purchase_orders(v_org,chr(8233))) <> v_count
  or (select max(total_count) from public.list_purchase_orders(v_org,'')) <> v_count then
  raise exception 'FAIL: purchase order list number search/Unicode trimming';
 end if;
 -- Vendor master renamed/deactivated earlier: list uses the snapshot only.
 if exists (select 1 from public.list_purchase_orders(v_org,'Renamed supplier'))
  or not exists (select 1 from public.list_purchase_orders(v_org,'Supplier a')) then
  raise exception 'FAIL: purchase order list must search snapshots';
 end if;
 -- Strict status filter.
 foreach v_status in array array['draft','ordered','partially_received','received','cancelled'] loop
  if (select count(*) from public.list_purchase_orders(v_org,null,v_status,null,100)) <>
     (select count(*) from public.purchase_orders where organization_id=v_org and status=v_status) then
   raise exception 'FAIL: purchase order list status filter %',v_status;
  end if;
 end loop;
 if exists (select 1 from public.list_purchase_orders(v_org,null,'bogus'))
  or exists (select 1 from public.list_purchase_orders(v_org,null,'DRAFT'))
  or exists (select 1 from public.list_purchase_orders(v_org,null,' draft')) then
  raise exception 'FAIL: purchase order list status filter is not strict';
 end if;
 -- Vendor filter is tenant-safe and combines with status.
 if (select array_agg(id) from public.list_purchase_orders(v_org,null,'ordered',v_vendor)) is distinct from array[v_po2]
  or (select count(*) from public.list_purchase_orders(v_org,null,null,v_vendor)) <> 2
  or exists (select 1 from public.list_purchase_orders(v_org,null,null,current_setting('test.po_vendor_b')::uuid))
  or exists (select 1 from public.list_purchase_orders(v_org,null,null,gen_random_uuid())) then
  raise exception 'FAIL: purchase order list vendor filter';
 end if;
 -- Pagination and clamping.
 select array_agg(l.id order by l.ordinality) into v_page1 from public.list_purchase_orders(v_org,null,null,null,5,0) with ordinality l;
 select array_agg(l.id order by l.ordinality) into v_page2 from public.list_purchase_orders(v_org,null,null,null,5,5) with ordinality l;
 if v_page1 || v_page2 is distinct from v_expected[1:10]
  or (select max(total_count) from public.list_purchase_orders(v_org,null,null,null,5,5)) <> v_count
  or (select count(*) from public.list_purchase_orders(v_org,null,null,null,0,0)) <> 1
  or (select count(*) from public.list_purchase_orders(v_org,null,null,null,null,0)) <> least(25,v_count)
  or (select count(*) from public.list_purchase_orders(v_org,null,null,null,1000,0)) <> least(100,v_count)
  or (select array_agg(l.id order by l.ordinality) from public.list_purchase_orders(v_org,null,null,null,5,-1) with ordinality l) is distinct from v_page1
  or exists (select 1 from public.list_purchase_orders(v_org,null,null,null,25,100000)) then
  raise exception 'FAIL: purchase order list pagination/clamping';
 end if;
 if exists (select 1 from public.list_purchase_orders(current_setting('test.po_org_b')::uuid))
  or exists (select 1 from public.list_purchase_orders(null)) then
  raise exception 'FAIL: purchase order list organization filter widened access';
 end if;
end $$;
-- Employee: same list. Tenant B: only its own. Disabled members: nothing.
select set_config('request.jwt.claims','{"sub":"a8000000-0000-4000-8000-000000000003","role":"authenticated"}',true);
do $$ begin
 if (select max(total_count) from public.list_purchase_orders(current_setting('test.po_org_a')::uuid))
   is distinct from (select count(*) from public.purchase_orders where organization_id=current_setting('test.po_org_a')::uuid) then
  raise exception 'FAIL: employee purchase order list';
 end if;
end $$;
select set_config('request.jwt.claims','{"sub":"a8000000-0000-4000-8000-000000000005","role":"authenticated"}',true);
do $$ begin
 if exists (select 1 from public.list_purchase_orders(current_setting('test.po_org_a')::uuid))
  or exists (select 1 from public.list_purchase_orders(current_setting('test.po_org_a')::uuid,'PO','draft'))
  or exists (select 1 from public.list_purchase_orders(current_setting('test.po_org_b')::uuid,null,null,current_setting('test.po_vendor_a')::uuid))
  or (select array_agg(purchase_order_number) from public.list_purchase_orders(current_setting('test.po_org_b')::uuid)) is distinct from array['PO-000001'] then
  raise exception 'FAIL: tenant B purchase order list isolation';
 end if;
end $$;
do $$ declare u uuid; begin
 foreach u in array array['a8000000-0000-4000-8000-000000000004'::uuid,'a8000000-0000-4000-8000-000000000002'::uuid] loop
  perform set_config('request.jwt.claims',jsonb_build_object('sub',u,'role','authenticated')::text,true);
  if exists (select 1 from public.list_purchase_orders(current_setting('test.po_org_a')::uuid)) then
   raise exception 'FAIL: disabled member listed purchase orders';
  end if;
 end loop;
end $$;
reset role;
select 'ALL PURCHASE ORDER CHECKS PASSED' as result;
rollback;
