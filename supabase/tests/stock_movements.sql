-- Stock movement ledger (Inventory Part 1). Run as local postgres (or in the
-- SQL Editor) after 20261104240000_stock_movements.sql. All fixtures roll back.
begin;
create function pg_temp.expect_error(q text, code text, message text default null) returns void language plpgsql as $$
begin
 begin execute q; exception when others then
  if sqlstate=code and (message is null or sqlerrm=message) then return; end if;
  raise exception 'expected %, got %: % [%]',code,sqlstate,sqlerrm,q;
 end;
 raise exception 'expected error % [%]',code,q;
end $$;
insert into auth.users(id,email) values
 ('b1000000-0000-4000-8000-000000000001','sm-owner@test.example'),
 ('b1000000-0000-4000-8000-000000000002','sm-other@test.example'),
 ('b1000000-0000-4000-8000-000000000003','sm-manager@test.example'),
 ('b1000000-0000-4000-8000-000000000004','sm-employee@test.example'),
 ('b1000000-0000-4000-8000-000000000005','sm-disabled@test.example');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"b1000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select set_config('test.sm_org',public.create_organization('Stock A','BDT','Asia/Dhaka')::text,true);
select set_config('request.jwt.claims','{"sub":"b1000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select set_config('test.sm_other_org',public.create_organization('Stock B','BDT','UTC')::text,true);
reset role;
insert into public.organization_members(organization_id,user_id,role,status) values
 (current_setting('test.sm_org')::uuid,'b1000000-0000-4000-8000-000000000003','manager','active'),
 (current_setting('test.sm_org')::uuid,'b1000000-0000-4000-8000-000000000004','employee','active'),
 (current_setting('test.sm_org')::uuid,'b1000000-0000-4000-8000-000000000005','employee','disabled');
-- Fixture products (privileged). Keys become test.sm_<key>.
do $$ declare o uuid:=current_setting('test.sm_org')::uuid; b uuid:=current_setting('test.sm_other_org')::uuid; p uuid; r record; begin
 for r in select * from (values
   ('inv_a','Inventory A','INV-A','box','inventory','active'),
   ('inv_b','Inventory B','INV-B','kg','inventory','active'),
   ('non_c','Non-inventory C','NON-C','pcs','non_inventory','active'),
   ('svc_d','Service D','SVC-D','hour','service','active'),
   ('partial','Partial P','PART-P','pcs','inventory','active'),
   ('zero','Zero Stock','ZERO-1','pcs','inventory','active'),
   ('dormant','Dormant Stock','DORM-1','pcs','inventory','inactive'),
   ('exact','Exact E','EXACT-E','g','inventory','active'),
   ('flip_in','Flip In','FLIP-IN','pcs','inventory','active'),
   ('flip_out','Flip Out','FLIP-OUT','pcs','non_inventory','active'),
   ('wild','Wild%Card_x','WILD-1','pcs','inventory','active'),
   ('retype','Retype R','RET-R','pcs','inventory','active'),
   ('pair_x','Pair X','PAIR-X','pcs','inventory','active'),
   ('pair_y','Pair Y','PAIR-Y','pcs','inventory','active'),
   ('cancel_z','Cancel Z','CAN-Z','pcs','inventory','active')) v(k,name,sku,unit,t,status) loop
  insert into public.products(organization_id,name,sku,unit,product_type,purchase_price,selling_price,status)
  values(o,r.name,r.sku,r.unit,r.t,1,2,r.status) returning id into p;
  perform set_config('test.sm_'||r.k,p::text,true);
 end loop;
 insert into public.products(organization_id,name,sku,unit,product_type,purchase_price) values(b,'Inventory X','INV-X','box','inventory',1) returning id into p;
 perform set_config('test.sm_other_inv',p::text,true);
 insert into public.vendors(organization_id,name) values(o,'Supplier A') returning id into p;
 perform set_config('test.sm_vendor',p::text,true);
 insert into public.vendors(organization_id,name) values(b,'Supplier B') returning id into p;
 perform set_config('test.sm_other_vendor',p::text,true);
end $$;
create function pg_temp.po(items jsonb, k text default '') returns uuid language plpgsql as $$
declare v uuid; begin
 v:=public.create_purchase_order(current_setting('test.sm_'||k||'vendor')::uuid,date '2026-11-01',null,null,items);
 perform public.set_purchase_order_status(v,'ordered');
 return v;
end $$;
create function pg_temp.item(k text, q text) returns jsonb language sql as $$
 select jsonb_build_object('product_id',current_setting('test.sm_'||k),'quantity',q);
$$;
create function pg_temp.line(po uuid, n integer) returns uuid language sql as $$
 select id from public.purchase_order_items where purchase_order_id=po and sort_order=n;
$$;
create function pg_temp.rl(line uuid, q text) returns jsonb language sql as $$
 select jsonb_build_object('purchase_order_item_id',line,'received_quantity',q);
$$;
create function pg_temp.receive(po uuid, lines jsonb, d date default date '2026-11-05') returns uuid language sql as $$
 select public.create_goods_receipt(po,d,null,lines);
$$;
create function pg_temp.stock(k text) returns text language sql as $$
 select current_quantity from public.list_current_stock(current_setting('test.sm_org')::uuid,null,current_setting('test.sm_'||k)::uuid);
$$;
create function pg_temp.movements(k text default null) returns bigint language sql as $$
 select count(*) from public.stock_movements where organization_id=current_setting('test.sm_org')::uuid
  and (k is null or product_id=current_setting('test.sm_'||k)::uuid);
$$;
-- Forged values would each violate a CHECK (evaluated before the unique key),
-- so a 23505 proves the trigger re-derived quantity, snapshots and date first.
create function pg_temp.raw_insert(org text, line text, src text default 'goods_receipt') returns text language sql as $$
 select format('insert into public.stock_movements(organization_id,product_id,movement_type,quantity_delta,source_type,source_id,source_line_id,'
  'product_name_snapshot,sku_snapshot,unit_snapshot,occurred_on) values(%L,%L,''goods_receipt'',-5,%L,gen_random_uuid(),%L,'''','''','''',''infinity'')',
  org,current_setting('test.sm_inv_a'),src,line);
$$;

-- Structure: RLS, grants, keys, read definitions, no product balance, no write RPC.
do $$ declare r text; f record; begin
 if not (select relrowsecurity from pg_class where oid='public.stock_movements'::regclass)
  or (select count(*) from pg_policies where schemaname='public' and tablename='stock_movements')<>1
  or exists(select 1 from pg_policies where schemaname='public' and tablename='stock_movements' and (cmd<>'SELECT' or roles<>'{authenticated}'))
  then raise exception 'FAIL: RLS'; end if;
 foreach r in array array['anon','authenticated','service_role'] loop
  if has_any_column_privilege(r,'public.stock_movements','INSERT') or has_any_column_privilege(r,'public.stock_movements','UPDATE')
   or has_table_privilege(r,'public.stock_movements','DELETE') or has_table_privilege(r,'public.stock_movements','TRUNCATE')
   then raise exception 'FAIL: direct write grants %',r; end if;
 end loop;
 if has_table_privilege('anon','public.stock_movements','SELECT') or not has_table_privilege('authenticated','public.stock_movements','SELECT')
  then raise exception 'FAIL: read grants'; end if;
 if exists(select 1 from information_schema.columns where table_schema='public' and table_name='products'
   and column_name ~* '(quantity|stock|on_hand|balance)') then raise exception 'FAIL: mutable product stock column'; end if;
 if (select data_type||':'||numeric_precision||','||numeric_scale from information_schema.columns
   where table_schema='public' and table_name='stock_movements' and column_name='quantity_delta')<>'numeric:18,3'
  then raise exception 'FAIL: quantity type'; end if;
 if not exists(select 1 from pg_constraint where conrelid='public.stock_movements'::regclass and contype='u'
   and pg_get_constraintdef(oid)='UNIQUE (organization_id, source_type, source_line_id)') then raise exception 'FAIL: idempotency key'; end if;
 if not exists(select 1 from pg_constraint where conrelid='public.stock_movements'::regclass and contype='f'
   and confrelid='public.products'::regclass and pg_get_constraintdef(oid) like 'FOREIGN KEY (organization_id, product_id) REFERENCES products(organization_id, id)%')
  or not exists(select 1 from pg_constraint where conrelid='public.stock_movements'::regclass and contype='f'
   and confrelid='public.goods_receipt_items'::regclass
   and pg_get_constraintdef(oid) like 'FOREIGN KEY (organization_id, goods_receipt_id, goods_receipt_item_id, product_id) REFERENCES goods_receipt_items(organization_id, goods_receipt_id, id, product_id)%')
  then raise exception 'FAIL: tenant-safe foreign keys'; end if;
 for f in select p.*,l.lanname from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_language l on l.oid=p.prolang
   where n.nspname='public' and p.proname like '%stock%' loop
  if not (f.proconfig @> array['search_path=""']) then raise exception 'FAIL: search path %',f.proname; end if;
  if has_function_privilege('anon',f.oid,'EXECUTE') then raise exception 'FAIL: anon execute %',f.proname; end if;
  if f.proname in ('list_current_stock','list_stock_movements') then
   if f.prosecdef or f.provolatile<>'s' or f.lanname<>'sql' or not has_function_privilege('authenticated',f.oid,'EXECUTE')
    then raise exception 'FAIL: read definition %',f.proname; end if;
  elsif has_function_privilege('authenticated',f.oid,'EXECUTE') or has_function_privilege('service_role',f.oid,'EXECUTE') then
   raise exception 'FAIL: helper grants %',f.proname;
  end if;
 end loop;
 -- Only the two reads are callable by API roles; no generic movement writer.
 if (select array_agg(p.proname::text order by p.proname) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname like '%stock%' and has_function_privilege('authenticated',p.oid,'EXECUTE'))
   is distinct from array['list_current_stock','list_stock_movements'] then raise exception 'FAIL: exposed stock functions'; end if;
 -- Posting is a definer AFTER-seal trigger, enabled, ordered before PO reconciliation.
 if not exists(select 1 from pg_trigger where tgrelid='public.goods_receipts'::regclass and tgname='goods_receipts_post_stock_movements' and tgenabled='O')
  or not (select prosecdef from pg_proc where oid='public.goods_receipts_post_stock_movements()'::regprocedure)
  or (select array_agg(tgname::text order by tgname) from pg_trigger where tgrelid='public.goods_receipts'::regclass and tgname in ('goods_receipts_post_stock_movements','goods_receipts_reconcile_status'))
     <> array['goods_receipts_post_stock_movements','goods_receipts_reconcile_status']
  then raise exception 'FAIL: posting trigger'; end if;
 if (select count(*) from pg_trigger where tgrelid='public.stock_movements'::regclass and tgenabled='O'
   and tgname in ('stock_movements_derive_from_source','stock_movements_immutable','stock_movements_block_truncate'))<>3
  then raise exception 'FAIL: ledger guards'; end if;
 -- Product type guard: enabled, definer, fires only on product_type changes,
 -- requires READ COMMITTED; stock posting reads the product FOR SHARE.
 if not exists(select 1 from pg_trigger t where t.tgrelid='public.products'::regclass and t.tgname='products_guard_type_change'
   and t.tgenabled='O' and t.tgattr::text=(select attnum::text from pg_attribute where attrelid='public.products'::regclass and attname='product_type'))
  or not (select prosecdef from pg_proc where oid='public.products_guard_type_change()'::regprocedure)
  or (select prosrc from pg_proc where oid='public.products_guard_type_change()'::regprocedure) !~* '<> ''read committed'''
  or (select prosrc from pg_proc where oid='public.stock_movements_derive_from_source()'::regprocedure) !~* 'for share;'
  then raise exception 'FAIL: product type guard'; end if;
 -- Ordering check: enabled definer trigger on purchase_orders.status (draft -> ordered only).
 if not exists(select 1 from pg_trigger t where t.tgrelid='public.purchase_orders'::regclass and t.tgname='purchase_orders_validate_inventory_types'
   and t.tgenabled='O' and t.tgattr::text=(select attnum::text from pg_attribute where attrelid='public.purchase_orders'::regclass and attname='status')
   and pg_get_triggerdef(t.oid) ~ '\(\(old.status = ''draft''::text\) AND \(new.status = ''ordered''::text\)\)')
  or not (select prosecdef from pg_proc where oid='public.purchase_orders_validate_inventory_types()'::regprocedure)
  or has_function_privilege('authenticated','public.purchase_orders_validate_inventory_types()','EXECUTE')
  or (select prosrc from pg_proc where oid='public.purchase_orders_validate_inventory_types()'::regprocedure) !~* 'for share of p'
  then raise exception 'FAIL: ordering check'; end if;
end $$;

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"b1000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
-- Multi-line receipt: Inventory A 10, Inventory B 5, Non-inventory C 7 -> exactly 2 movements.
do $$ declare o uuid:=current_setting('test.sm_org')::uuid; po uuid; rid uuid; m record; before_products jsonb; begin
 select jsonb_agg(to_jsonb(p) order by p.id) into before_products from public.products p where p.organization_id=o;
 po:=pg_temp.po(jsonb_build_array(pg_temp.item('inv_a','100'),pg_temp.item('inv_b','5'),pg_temp.item('non_c','7'),pg_temp.item('svc_d','1')));
 if pg_temp.movements()<>0 then raise exception 'FAIL: purchase order moved stock'; end if;
 rid:=pg_temp.receive(po,jsonb_build_array(pg_temp.rl(pg_temp.line(po,1),'10'),pg_temp.rl(pg_temp.line(po,2),'5'),pg_temp.rl(pg_temp.line(po,3),'7')));
 if (select count(*) from public.stock_movements where source_id=rid)<>2 or pg_temp.movements()<>2
  or pg_temp.movements('non_c')<>0 or pg_temp.movements('svc_d')<>0 then raise exception 'FAIL: movement count'; end if;
 select * into m from public.stock_movements where source_id=rid and product_id=current_setting('test.sm_inv_a')::uuid;
 if m.organization_id<>o or m.movement_type<>'goods_receipt' or m.source_type<>'goods_receipt' or m.quantity_delta::text<>'10.000'
  or m.source_line_id is distinct from (select id from public.goods_receipt_items where goods_receipt_id=rid and sort_order=1)
  or m.goods_receipt_id<>rid or m.goods_receipt_item_id<>m.source_line_id
  or m.product_name_snapshot<>'Inventory A' or m.sku_snapshot<>'INV-A' or m.unit_snapshot<>'box'
  or m.occurred_on<>date '2026-11-05' or m.created_at<>now() then raise exception 'FAIL: inventory A movement %',to_jsonb(m); end if;
 select * into m from public.stock_movements where source_id=rid and product_id=current_setting('test.sm_inv_b')::uuid;
 if m.quantity_delta::text<>'5.000' or m.unit_snapshot<>'kg' or m.sku_snapshot<>'INV-B' then raise exception 'FAIL: inventory B movement'; end if;
 -- Every movement equals its immutable source line.
 if exists(select 1 from public.stock_movements s join public.goods_receipt_items i on i.organization_id=s.organization_id and i.id=s.source_line_id
   where s.organization_id=o and (s.quantity_delta<>i.received_quantity or s.product_id<>i.product_id or i.product_type<>'inventory'))
  then raise exception 'FAIL: movement differs from source line'; end if;
 if pg_temp.stock('inv_a')<>'10.000' or pg_temp.stock('inv_b')<>'5.000' then raise exception 'FAIL: current stock'; end if;
 -- Receiving never writes products (no quantity, price, status or timestamp change).
 if (select jsonb_agg(to_jsonb(p) order by p.id) from public.products p where p.organization_id=o) is distinct from before_products
  then raise exception 'FAIL: products changed by receiving'; end if;
 perform set_config('test.sm_po_multi',po::text,true);
 perform set_config('test.sm_receipt_multi',rid::text,true);
end $$;

-- Partial receipts 30 + 20 (= 50), rejected over-receive, final 50 (= 100).
do $$ declare po uuid; l uuid; n bigint; begin
 po:=pg_temp.po(jsonb_build_array(pg_temp.item('partial','100')));
 l:=pg_temp.line(po,1);
 perform pg_temp.receive(po,jsonb_build_array(pg_temp.rl(l,'30')),date '2026-11-02');
 if pg_temp.stock('partial')<>'30.000' then raise exception 'FAIL: first partial'; end if;
 perform pg_temp.receive(po,jsonb_build_array(pg_temp.rl(l,'20')),date '2026-11-03');
 if pg_temp.stock('partial')<>'50.000' or pg_temp.movements('partial')<>2 then raise exception 'FAIL: second partial'; end if;
 n:=pg_temp.movements();
 perform pg_temp.expect_error(format('select pg_temp.receive(%L,%L)',po,jsonb_build_array(pg_temp.rl(l,'50.001'))),'GR003');
 if pg_temp.movements()<>n or pg_temp.stock('partial')<>'50.000' then raise exception 'FAIL: over-receive moved stock'; end if;
 perform pg_temp.receive(po,jsonb_build_array(pg_temp.rl(l,'50')),date '2026-11-04');
 if pg_temp.stock('partial')<>'100.000' or pg_temp.movements('partial')<>3
  or (select status from public.purchase_orders where id=po)<>'received'
  or (select array_agg(quantity_delta::text order by occurred_on) from public.stock_movements where product_id=current_setting('test.sm_partial')::uuid)
     <>array['30.000','20.000','50.000'] then raise exception 'FAIL: final receipt'; end if;
 perform pg_temp.expect_error(format('select pg_temp.receive(%L,%L)',po,jsonb_build_array(pg_temp.rl(l,'0.001'))),'55000');
 if pg_temp.movements()<>n+1 then raise exception 'FAIL: rejected receipt after completion moved stock'; end if;
end $$;

-- Rollback: a receipt that fails (or whose transaction aborts) leaves no movement.
do $$ declare o uuid:=current_setting('test.sm_org')::uuid; po uuid; rid uuid; n bigint; nr bigint; begin
 po:=pg_temp.po(jsonb_build_array(pg_temp.item('inv_b','10'),pg_temp.item('inv_a','5')));
 n:=pg_temp.movements(); select count(*) into nr from public.goods_receipts where organization_id=o;
 begin
  rid:=pg_temp.receive(po,jsonb_build_array(pg_temp.rl(pg_temp.line(po,1),'4')));
  if (select count(*) from public.stock_movements where source_id=rid)<>1 then raise exception 'FAIL: posting not in receipt transaction'; end if;
  raise exception 'forced-failure';
 exception when raise_exception then
  if sqlerrm<>'forced-failure' then raise; end if;
 end;
 if pg_temp.movements()<>n or exists(select 1 from public.goods_receipts where id=rid)
  or exists(select 1 from public.stock_movements where source_id=rid) then raise exception 'FAIL: aborted receipt left stock'; end if;
 -- Late line failure: valid first line, over-received second line.
 perform pg_temp.expect_error(format('select pg_temp.receive(%L,%L)',po,
  jsonb_build_array(pg_temp.rl(pg_temp.line(po,1),'4'),pg_temp.rl(pg_temp.line(po,2),'5.001'))),'GR003');
 if pg_temp.movements()<>n or (select count(*) from public.goods_receipts where organization_id=o)<>nr
  or (select status from public.purchase_orders where id=po)<>'ordered' then raise exception 'FAIL: failed receipt left stock'; end if;
end $$;

-- Exact decimals and a future-dated receipt (counted immediately).
do $$ declare po uuid; rid uuid; begin
 po:=pg_temp.po(jsonb_build_array(
  jsonb_build_object('product_id',current_setting('test.sm_exact'),'quantity','999999999999999.999','unit_price','0'),
  jsonb_build_object('product_id',current_setting('test.sm_exact'),'quantity','999999999999999.999','unit_price','0'),
  jsonb_build_object('product_id',current_setting('test.sm_exact'),'quantity','0.001','unit_price','0')));
 rid:=pg_temp.receive(po,jsonb_build_array(pg_temp.rl(pg_temp.line(po,1),'999999999999999.999'),pg_temp.rl(pg_temp.line(po,3),'0.001')),current_date+30);
 if (select array_agg(quantity_delta::text order by quantity_delta) from public.stock_movements where source_id=rid)<>array['0.001','999999999999999.999']
  or exists(select 1 from public.stock_movements where source_id=rid and occurred_on<>current_date+30)
  then raise exception 'FAIL: exact quantities/future date'; end if;
 if pg_temp.stock('exact')<>'1000000000000000.000' then raise exception 'FAIL: future-dated stock %',pg_temp.stock('exact'); end if;
 -- Balance beyond numeric(18,3) is still read exactly (no cast overflow, no float).
 perform pg_temp.receive(po,jsonb_build_array(pg_temp.rl(pg_temp.line(po,2),'999999999999999.999')));
 if pg_temp.stock('exact')<>'1999999999999999.999' then raise exception 'FAIL: large balance %',pg_temp.stock('exact'); end if;
 if (select quantity_delta from public.list_stock_movements(current_setting('test.sm_org')::uuid,current_setting('test.sm_exact')::uuid) order by quantity_delta limit 1)<>'0.001'
  then raise exception 'FAIL: exact history text'; end if;
end $$;

-- Eligibility uses the receipt line's snapshot (a non_inventory line never posts,
-- whatever the master says), and an open inventory PO line keeps the master
-- inventory, also for privileged writers (DECISIONS 035).
do $$ declare po uuid; begin
 po:=pg_temp.po(jsonb_build_array(pg_temp.item('flip_in','3'),pg_temp.item('flip_out','4')));
 perform set_config('test.sm_flip_po',po::text,true);
end $$;
reset role;
do $$ declare t text; begin
 foreach t in array array['non_inventory','service'] loop
  perform pg_temp.expect_error(format('update public.products set product_type=%L where id=%L',t,current_setting('test.sm_flip_in')),'ST003',
   'product is on an open inventory purchase order; its type must stay inventory');
 end loop;
 if (select product_type from public.products where id=current_setting('test.sm_flip_in')::uuid)<>'inventory' then raise exception 'FAIL: privileged retype applied'; end if;
end $$;
-- A non_inventory PO line creates no inventory lock.
update public.products set product_type='inventory' where id=current_setting('test.sm_flip_out')::uuid;
set local role authenticated;
do $$ declare po uuid:=current_setting('test.sm_flip_po')::uuid; rid uuid; begin
 rid:=pg_temp.receive(po,jsonb_build_array(pg_temp.rl(pg_temp.line(po,1),'3'),pg_temp.rl(pg_temp.line(po,2),'4')));
 if pg_temp.movements('flip_in')<>1 or pg_temp.movements('flip_out')<>0
  or (select quantity_delta::text from public.stock_movements where source_id=rid)<>'3.000' then raise exception 'FAIL: snapshot type eligibility'; end if;
end $$;

-- Historical snapshots survive master changes; current stock shows current master data.
reset role;
do $$ declare before_ledger jsonb; begin
 select jsonb_agg(to_jsonb(m) order by m.id) into before_ledger from public.stock_movements m where m.organization_id=current_setting('test.sm_org')::uuid;
 perform set_config('test.sm_ledger_before',before_ledger::text,true);
end $$;
update public.products set name='Inventory A Renamed', sku='INV-A2', unit='pcs', status='inactive', purchase_price=99, selling_price=199
 where id=current_setting('test.sm_inv_a')::uuid;
-- Privileged type changes of a product with movements are rejected too (DECISIONS 034).
do $$ declare p uuid:=current_setting('test.sm_inv_b')::uuid; t text; begin
 foreach t in array array['service','non_inventory'] loop
  perform pg_temp.expect_error(format('update public.products set product_type=%L where id=%L',t,p),'ST002',
   'product type cannot change after stock movements exist');
 end loop;
 if (select product_type from public.products where id=p)<>'inventory' then raise exception 'FAIL: privileged type change applied'; end if;
end $$;
set local role authenticated;
do $$ declare o uuid:=current_setting('test.sm_org')::uuid; r record; begin
 if (select jsonb_agg(to_jsonb(m) order by m.id) from public.stock_movements m where m.organization_id=o)::text<>current_setting('test.sm_ledger_before')
  then raise exception 'FAIL: master change altered ledger'; end if;
 select * into r from public.list_stock_movements(o,current_setting('test.sm_inv_a')::uuid);
 if r.product_name_snapshot<>'Inventory A' or r.sku_snapshot<>'INV-A' or r.unit_snapshot<>'box' or r.quantity_delta<>'10.000' or r.total_count<>1
  then raise exception 'FAIL: history snapshot %',to_jsonb(r); end if;
 select * into r from public.list_current_stock(o,null,current_setting('test.sm_inv_a')::uuid);
 if r.product_name<>'Inventory A Renamed' or r.sku<>'INV-A2' or r.unit<>'pcs' or r.product_status<>'inactive' or r.current_quantity<>'10.000'
  then raise exception 'FAIL: current stock master data %',to_jsonb(r); end if;
 end $$;

-- Reader defense: intentionally constructed legacy / privileged-invalid data
-- (stock under a non-inventory product) stays visible with its actual type.
-- The guard is bypassed only inside a rolled-back subtransaction, which also
-- releases its table lock immediately.
reset role;
do $$ declare o uuid:=current_setting('test.sm_org')::uuid; p uuid:=current_setting('test.sm_flip_in')::uuid; r record; begin
 begin
  alter table public.products disable trigger products_guard_type_change;
  update public.products set product_type='non_inventory' where id=p;
  alter table public.products enable trigger products_guard_type_change;
  select * into r from public.list_current_stock(o,null,p);
  if r.product_id is distinct from p or r.product_type is distinct from 'non_inventory' or r.current_quantity is distinct from '3.000'
   or not exists(select 1 from public.list_current_stock(o,null,null,100) where product_id=p)
   then raise exception 'FAIL: legacy stock hidden %',to_jsonb(r); end if;
  raise exception 'rollback-probe';
 exception when raise_exception then
  if sqlerrm<>'rollback-probe' then raise; end if;
 end;
 if (select product_type from public.products where id=p)<>'inventory'
  or not exists(select 1 from pg_trigger where tgname='products_guard_type_change' and tgenabled='O') then raise exception 'FAIL: legacy probe leaked'; end if;
end $$;
set local role authenticated;

-- Product type lock through the normal product update path (authenticated owner).
do $$ declare o uuid:=current_setting('test.sm_org')::uuid; b uuid:=current_setting('test.sm_inv_b')::uuid;
 before_ledger jsonb; before_stock text; t text; k text; begin
 -- No movements: type changes stay allowed (and are restored for later checks).
 foreach k in array array['zero','svc_d','non_c'] loop
  foreach t in array array['non_inventory','service','inventory'] loop
   update public.products set product_type=t where id=current_setting('test.sm_'||k)::uuid;
   if (select product_type from public.products where id=current_setting('test.sm_'||k)::uuid)<>t then raise exception 'FAIL: % -> % blocked',k,t; end if;
  end loop;
 end loop;
 update public.products set product_type='service' where id=current_setting('test.sm_svc_d')::uuid;
 update public.products set product_type='non_inventory' where id=current_setting('test.sm_non_c')::uuid;
 -- non_c has goods receipts (non_inventory lines) but no movement: not locked.
 if not exists(select 1 from public.goods_receipt_items where product_id=current_setting('test.sm_non_c')::uuid) or pg_temp.movements('non_c')<>0
  then raise exception 'FAIL: non-inventory receipt fixture'; end if;
 -- One movement: every type change is rejected and nothing changes.
 select jsonb_agg(to_jsonb(m) order by m.id) into before_ledger from public.stock_movements m where m.organization_id=o;
 before_stock:=pg_temp.stock('inv_b');
 foreach t in array array['service','non_inventory'] loop
  perform pg_temp.expect_error(format('update public.products set product_type=%L where id=%L',t,b),'ST002');
  perform pg_temp.expect_error(format('update public.products set product_type=%L, name=''Should not apply'' where id=%L',t,current_setting('test.sm_inv_a')),'ST002');
 end loop;
 if (select product_type from public.products where id=b)<>'inventory' or (select name from public.products where id=current_setting('test.sm_inv_a')::uuid)<>'Inventory A Renamed'
  then raise exception 'FAIL: rejected type change applied'; end if;
 -- Other fields stay editable: name, SKU, description, prices, unit, status; same type is a no-op.
 update public.products set name='Inventory B2', sku='INV-B2', description='New', purchase_price=3, selling_price=4, unit='g', product_type='inventory' where id=b;
 perform public.set_product_status(b,'inactive');
 if (select status from public.products where id=b)<>'inactive' then raise exception 'FAIL: deactivate'; end if;
 perform public.set_product_status(b,'active');
 if (select name||'|'||sku||'|'||unit||'|'||status||'|'||product_type from public.products where id=b)<>'Inventory B2|INV-B2|g|active|inventory'
  then raise exception 'FAIL: permitted edits'; end if;
 -- History snapshots and the balance are untouched.
 if (select jsonb_agg(to_jsonb(m) order by m.id) from public.stock_movements m where m.organization_id=o) is distinct from before_ledger
  or pg_temp.stock('inv_b')<>before_stock
  or (select product_name_snapshot||'|'||sku_snapshot||'|'||unit_snapshot from public.list_stock_movements(o,b))<>'Inventory B|INV-B|kg'
  or (select product_name||'|'||sku||'|'||unit from public.list_current_stock(o,null,b))<>'Inventory B2|INV-B2|g'
  then raise exception 'FAIL: lock side effects'; end if;
end $$;

-- Open inventory procurement (Rule A) and stock-posting compatibility (Rule C).
do $$ declare r uuid:=current_setting('test.sm_retype')::uuid; po uuid; t text; d text; msg text; begin
 -- A draft inventory PO does not lock the type. Mixed PO: inventory, non_inventory and service lines.
 po:=public.create_purchase_order(current_setting('test.sm_vendor')::uuid,date '2026-11-01',null,null,
  jsonb_build_array(pg_temp.item('retype','10'),pg_temp.item('non_c','1'),pg_temp.item('svc_d','1')));
 perform set_config('test.sm_retype_po',po::text,true);
 -- Ordering (DECISIONS 036) is refused while the inventory-snapshot product is no
 -- longer inventory; the PO stays a draft, snapshots untouched, line identified.
 foreach t in array array['service','non_inventory'] loop
  update public.products set product_type=t where id=r;
  if (select product_type from public.products where id=r)<>t then raise exception 'FAIL: draft PO locked type'; end if;
  begin
   perform public.set_purchase_order_status(po,'ordered');
   raise exception 'FAIL: ordering accepted with % product',t;
  exception when sqlstate 'ST006' then
   get stacked diagnostics d = pg_exception_detail, msg = message_text;
   if d<>'lines: 1' or msg<>'inventory products changed type since the purchase order lines were recorded' then raise exception 'FAIL: ST006 detail % %',d,msg; end if;
  end;
  if (select status from public.purchase_orders where id=po)<>'draft'
   or (select array_agg(product_type order by sort_order) from public.purchase_order_items where purchase_order_id=po)<>array['inventory','non_inventory','service']
   then raise exception 'FAIL: rejected ordering changed PO'; end if;
 end loop;
 -- Restoring the product allows ordering without touching the lines. Current types
 -- of non_inventory/service lines are not checked (retyped here, restored below).
 update public.products set product_type='inventory' where id=r;
 update public.products set product_type='service' where id=current_setting('test.sm_non_c')::uuid;
 update public.products set product_type='non_inventory' where id=current_setting('test.sm_svc_d')::uuid;
 perform public.set_purchase_order_status(po,'ordered');
 if (select status from public.purchase_orders where id=po)<>'ordered' then raise exception 'FAIL: repaired ordering'; end if;
 update public.products set product_type='non_inventory' where id=current_setting('test.sm_non_c')::uuid;
 update public.products set product_type='service' where id=current_setting('test.sm_svc_d')::uuid;
 -- Ordered inventory PO: leaving inventory is rejected (API path).
 foreach t in array array['service','non_inventory'] loop
  perform pg_temp.expect_error(format('update public.products set product_type=%L where id=%L',t,r),'ST003');
 end loop;
end $$;

reset role;
-- Privileged draft -> ordered cannot bypass the ordering check.
do $$ declare po uuid; z uuid:=current_setting('test.sm_zero')::uuid; begin
 po:=public.create_purchase_order(current_setting('test.sm_vendor')::uuid,date '2026-11-01',null,null,jsonb_build_array(pg_temp.item('zero','1')));
 update public.products set product_type='non_inventory' where id=z;
 perform pg_temp.expect_error(format('update public.purchase_orders set status=''ordered'' where id=%L',po),'ST006');
 if (select status from public.purchase_orders where id=po)<>'draft' then raise exception 'FAIL: privileged ordering applied'; end if;
 update public.products set product_type='inventory' where id=z;
 update public.purchase_orders set status='ordered' where id=po;
 update public.purchase_orders set status='cancelled' where id=po;
end $$;
-- Stock posting still refuses a non-inventory product. That state can no longer
-- arise through the guards, so it is constructed inside a rolled-back
-- subtransaction (guard bypassed briefly; the table lock is released with it).
do $$ declare o uuid:=current_setting('test.sm_org')::uuid; r uuid:=current_setting('test.sm_retype')::uuid;
 po uuid:=current_setting('test.sm_retype_po')::uuid; n bigint; nr bigint; begin
 begin
  alter table public.products disable trigger products_guard_type_change;
  update public.products set product_type='service' where id=r;
  alter table public.products enable trigger products_guard_type_change;
  n:=pg_temp.movements(); select count(*) into nr from public.goods_receipts where organization_id=o;
  perform pg_temp.expect_error(format('select pg_temp.receive(%L,%L)',po,jsonb_build_array(pg_temp.rl(pg_temp.line(po,1),'4'))),'ST004','product is no longer classified as inventory');
  if pg_temp.movements()<>n or (select count(*) from public.goods_receipts where organization_id=o)<>nr
   or (select status from public.purchase_orders where id=po)<>'ordered' or exists(select 1 from public.stock_movements where product_id=r)
   then raise exception 'FAIL: rejected posting left data'; end if;
  raise exception 'rollback-probe';
 exception when raise_exception then
  if sqlerrm<>'rollback-probe' then raise; end if;
 end;
 if (select product_type from public.products where id=r)<>'inventory' then raise exception 'FAIL: posting probe leaked'; end if;
end $$;
set local role authenticated;
do $$ declare r uuid:=current_setting('test.sm_retype')::uuid; po uuid:=current_setting('test.sm_retype_po')::uuid;
 y uuid:=current_setting('test.sm_pair_y')::uuid; z uuid:=current_setting('test.sm_cancel_z')::uuid;
 pp uuid; pc uuid; t text; begin
 -- First receipt succeeds once the product is inventory again.
 perform pg_temp.receive(po,jsonb_build_array(pg_temp.rl(pg_temp.line(po,1),'4')));
 if pg_temp.stock('retype')<>'4.000' or (select status from public.purchase_orders where id=po)<>'partially_received' then raise exception 'FAIL: repaired receipt'; end if;
 -- Now the movement locks it permanently (ST002 is reported before ST003).
 foreach t in array array['service','non_inventory'] loop
  perform pg_temp.expect_error(format('update public.products set product_type=%L where id=%L',t,r),'ST002');
 end loop;
 -- Partially received PO: an unreceived inventory line (no movement yet) still locks.
 pp:=pg_temp.po(jsonb_build_array(pg_temp.item('pair_x','5'),pg_temp.item('pair_y','5')));
 perform pg_temp.receive(pp,jsonb_build_array(pg_temp.rl(pg_temp.line(pp,1),'5')));
 if (select status from public.purchase_orders where id=pp)<>'partially_received' or pg_temp.movements('pair_y')<>0 then raise exception 'FAIL: partial fixture'; end if;
 perform pg_temp.expect_error(format('update public.products set product_type=''service'' where id=%L',y),'ST003');
 -- Other fields stay editable on a PO-locked product.
 update public.products set name='Pair Y2', sku='PAIR-Y2', description='Edited', purchase_price=7, unit='box' where id=y;
 perform public.set_product_status(y,'inactive');
 perform public.set_product_status(y,'active');
 if (select name||'|'||sku||'|'||unit||'|'||status||'|'||product_type from public.products where id=y)<>'Pair Y2|PAIR-Y2|box|active|inventory'
  then raise exception 'FAIL: PO-locked product edits'; end if;
 -- Ordered locks; cancelled (no movements) no longer locks.
 pc:=pg_temp.po(jsonb_build_array(pg_temp.item('cancel_z','2')));
 perform pg_temp.expect_error(format('update public.products set product_type=''service'' where id=%L',z),'ST003');
 perform public.set_purchase_order_status(pc,'cancelled');
 foreach t in array array['service','non_inventory','inventory'] loop
  update public.products set product_type=t where id=z;
 end loop;
 if (select product_type from public.products where id=z)<>'inventory' then raise exception 'FAIL: cancelled PO locked type'; end if;
end $$;

-- Current stock: zero stock, type rules, search, paging and order.
do $$ declare o uuid:=current_setting('test.sm_org')::uuid; ids uuid[]; total bigint; begin
 if pg_temp.stock('zero')<>'0.000' or pg_temp.stock('dormant')<>'0.000' or pg_temp.stock('flip_out')<>'0.000'
  or (select product_status from public.list_current_stock(o,null,current_setting('test.sm_dormant')::uuid))<>'inactive'
  or pg_temp.stock('flip_in')<>'3.000' then raise exception 'FAIL: zero/retyped stock'; end if;
 if exists(select 1 from public.list_current_stock(o,null,null,100) where product_id in
   (current_setting('test.sm_non_c')::uuid,current_setting('test.sm_svc_d')::uuid)) then raise exception 'FAIL: non-stock product listed'; end if;
 if exists(select 1 from public.list_current_stock(o,null,null,100) s join public.products p on p.id=s.product_id
   where p.product_type<>'inventory' and not exists(select 1 from public.stock_movements m where m.product_id=p.id))
  then raise exception 'FAIL: type filter'; end if;
 select array_agg(product_id), max(total_count) into ids, total from public.list_current_stock(o,null,null,100);
 if ids is distinct from (select array_agg(p.id order by p.name,p.id) from public.products p where p.organization_id=o
    and (p.product_type='inventory' or exists(select 1 from public.stock_movements m where m.organization_id=o and m.product_id=p.id)))
  or total<>13 then raise exception 'FAIL: list order/total % %',ids,total; end if;
 if (select count(*) from public.list_current_stock(o))<>13 or (select count(*) from public.list_current_stock(o,null,null,0))<>1
  or (select count(*) from public.list_current_stock(o,null,null,1000))<>13
  or (select array_agg(product_id) from public.list_current_stock(o,null,null,3,-5)) is distinct from ids[1:3]
  or (select array_agg(product_id) from public.list_current_stock(o,null,null,3,3)) is distinct from ids[4:6]
  or (select max(total_count) from public.list_current_stock(o,null,null,3,3))<>13 then raise exception 'FAIL: paging'; end if;
 if (select count(*) from public.list_current_stock(o,'inv-a2'))<>1 or (select count(*) from public.list_current_stock(o,'RENAMED'))<>1
  or (select product_id from public.list_current_stock(o,'%'))<>current_setting('test.sm_wild')::uuid
  or (select product_id from public.list_current_stock(o,'_x'))<>current_setting('test.sm_wild')::uuid
  or (select count(*) from public.list_current_stock(o,'d%_'))<>0
  or (select count(*) from public.list_current_stock(o,E'　\tzero stock '))<>1
  or (select count(*) from public.list_current_stock(o,E'  　 '))<>13 then raise exception 'FAIL: search'; end if;
 if exists(select 1 from public.list_current_stock(null)) or exists(select 1 from public.list_current_stock(o,null,gen_random_uuid()))
  then raise exception 'FAIL: null/unknown arguments'; end if;
end $$;

-- Movement history: newest first, filters, GR number, paging.
do $$ declare o uuid:=current_setting('test.sm_org')::uuid; ids uuid[]; r record; begin
 select array_agg(movement_id) into ids from public.list_stock_movements(o,null,null,100);
 if ids is distinct from (select array_agg(id order by occurred_on desc, created_at desc, id desc) from public.stock_movements where organization_id=o)
  or (select max(total_count) from public.list_stock_movements(o))<>pg_temp.movements() then raise exception 'FAIL: history order'; end if;
 if exists(select 1 from public.list_stock_movements(o,null,null,100) s join public.goods_receipts h on h.id=s.source_id
   where s.source_document_number is distinct from h.goods_receipt_number or s.source_type<>'goods_receipt' or s.movement_type<>'goods_receipt')
  then raise exception 'FAIL: source document'; end if;
 select * into r from public.list_stock_movements(o,current_setting('test.sm_inv_b')::uuid);
 if r.source_id<>current_setting('test.sm_receipt_multi')::uuid or r.source_document_number<>'GR-000001' or r.quantity_delta<>'5.000'
  or r.occurred_on<>date '2026-11-05' then raise exception 'FAIL: history row %',to_jsonb(r); end if;
 if (select count(*) from public.list_stock_movements(o,current_setting('test.sm_partial')::uuid))<>3
  or (select array_agg(occurred_on order by occurred_on desc) from public.list_stock_movements(o,current_setting('test.sm_partial')::uuid))
     is distinct from (select array_agg(occurred_on) from public.list_stock_movements(o,current_setting('test.sm_partial')::uuid))
  or (select count(*) from public.list_stock_movements(o,null,'goods_receipt',100))<>pg_temp.movements()
  or exists(select 1 from public.list_stock_movements(o,null,'sale_dispatch'))
  or (select count(*) from public.list_stock_movements(o,null,null,0))<>1
  or (select array_agg(movement_id) from public.list_stock_movements(o,null,null,2,-1)) is distinct from ids[1:2]
  or (select array_agg(movement_id) from public.list_stock_movements(o,null,null,2,2)) is distinct from ids[3:4]
  or exists(select 1 from public.list_stock_movements(null)) or exists(select 1 from public.list_stock_movements(o,gen_random_uuid()))
  then raise exception 'FAIL: history filters/paging'; end if;
end $$;

-- Idempotency, privileged paths and immutability (as postgres).
reset role;
do $$ declare o uuid:=current_setting('test.sm_org')::uuid; b uuid:=current_setting('test.sm_other_org')::uuid;
 rid uuid:=current_setting('test.sm_receipt_multi')::uuid; po uuid:=current_setting('test.sm_po_multi')::uuid; n bigint; l text; nl text; hid uuid; iid uuid; begin
 n:=pg_temp.movements();
 -- Generation/backfill rerun is a no-op; resealing is impossible.
 if public.post_goods_receipt_stock_movements(o,rid)<>0 then raise exception 'FAIL: repeated generation inserted'; end if;
 perform public.post_goods_receipt_stock_movements(h.organization_id,h.id) from public.goods_receipts h where h.organization_id=o and h.sealed;
 if pg_temp.movements()<>n or pg_temp.stock('inv_a')<>'10.000' then raise exception 'FAIL: repeated generation doubled stock'; end if;
 perform pg_temp.expect_error(format('update public.goods_receipts set sealed=true where id=%L',rid),'55000');
 -- Direct privileged inserts: duplicate line, non-inventory line, other tenant, unknown line, unsupported source.
 select id::text into l from public.goods_receipt_items where goods_receipt_id=rid and sort_order=1;
 select id::text into nl from public.goods_receipt_items where goods_receipt_id=rid and sort_order=3;
 perform pg_temp.expect_error(pg_temp.raw_insert(o::text,l),'23505');
 perform pg_temp.expect_error(pg_temp.raw_insert(o::text,nl),'ST001');
 perform pg_temp.expect_error(pg_temp.raw_insert(b::text,l),'23503','stock movement source not found');
 perform pg_temp.expect_error(pg_temp.raw_insert(o::text,gen_random_uuid()::text),'23503');
 perform pg_temp.expect_error(pg_temp.raw_insert(o::text,l,'sale_dispatch'),'22023');
 perform pg_temp.expect_error(format('insert into public.stock_movements(organization_id,source_type,source_line_id,goods_receipt_item_id) values(%L,''goods_receipt'',%L,%L)',o,l,l),'428C9');
 -- An unsealed (assembling) receipt line cannot move stock (probe rolled back).
 begin
  insert into public.goods_receipts(organization_id,goods_receipt_number,purchase_order_id,received_date,created_by)
  values(o,'GR-990001',po,date '2026-11-06','b1000000-0000-4000-8000-000000000001') returning id into hid;
  insert into public.goods_receipt_items(organization_id,goods_receipt_id,purchase_order_item_id,received_quantity,sort_order)
  values(o,hid,pg_temp.line(po,1),'1',1) returning id into iid;
  perform pg_temp.expect_error(pg_temp.raw_insert(o::text,iid::text),'55000');
  if public.post_goods_receipt_stock_movements(o,hid)<>0 then raise exception 'FAIL: unsealed receipt posted'; end if;
  raise exception 'rollback-probe';
 exception when raise_exception then
  if sqlerrm<>'rollback-probe' then raise; end if;
 end;
 if pg_temp.movements()<>n then raise exception 'FAIL: privileged probes changed ledger'; end if;
 -- Trusted tooling that assembles and seals a valid receipt still posts stock.
 insert into public.goods_receipts(organization_id,goods_receipt_number,purchase_order_id,received_date,created_by)
 values(o,'GR-990002',po,date '2026-11-07','b1000000-0000-4000-8000-000000000001') returning id into hid;
 insert into public.goods_receipt_items(organization_id,goods_receipt_id,purchase_order_item_id,received_quantity,sort_order)
 values(o,hid,pg_temp.line(po,1),'2',1);
 if exists(select 1 from public.stock_movements where source_id=hid) then raise exception 'FAIL: posted before sealing'; end if;
 update public.goods_receipts set sealed=true where id=hid;
 if (select count(*) from public.stock_movements where source_id=hid)<>1 or pg_temp.stock('inv_a')<>'12.000'
  or (select status from public.purchase_orders where id=po)<>'partially_received' then raise exception 'FAIL: privileged seal posting'; end if;
 n:=pg_temp.movements();
 -- Ledger rows are immutable, even for privileged writers.
 perform pg_temp.expect_error(format('update public.stock_movements set quantity_delta=1 where source_id=%L',hid),'55000','stock movements are immutable');
 perform pg_temp.expect_error(format('update public.stock_movements set product_name_snapshot=''x'' where organization_id=%L',o),'55000');
 perform pg_temp.expect_error(format('delete from public.stock_movements where source_id=%L',hid),'55000','stock movements are immutable');
 perform pg_temp.expect_error('truncate public.stock_movements','55000','stock movements are immutable');
 perform pg_temp.expect_error('truncate public.goods_receipt_items cascade','55000');
 perform pg_temp.expect_error('truncate public.products cascade','55000');
 -- Referenced products/receipts/organizations cannot be removed from under the ledger.
 perform pg_temp.expect_error(format('delete from public.products where id=%L',current_setting('test.sm_partial')),'23503');
 perform pg_temp.expect_error(format('delete from public.organizations where id=%L',o),'55000');
 if pg_temp.movements()<>n then raise exception 'FAIL: guards changed ledger'; end if;
 -- Products still never carry a balance after all of the above.
 if exists(select 1 from information_schema.columns where table_schema='public' and table_name='products'
   and column_name ~* '(quantity|stock|on_hand|balance)') then raise exception 'FAIL: product stock column'; end if;
end $$;

-- Tenant B: own movements only; no access to A's ledger, stock or products.
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"b1000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
do $$ declare a uuid:=current_setting('test.sm_org')::uuid; b uuid:=current_setting('test.sm_other_org')::uuid; po uuid; rid uuid; r record; begin
 po:=pg_temp.po(jsonb_build_array(pg_temp.item('other_inv','5')),'other_');
 rid:=pg_temp.receive(po,jsonb_build_array(pg_temp.rl(pg_temp.line(po,1),'2')));
 if (select count(*) from public.stock_movements)<>1 or exists(select 1 from public.stock_movements where organization_id<>b)
  then raise exception 'FAIL: B ledger visibility'; end if;
 select * into r from public.list_stock_movements(b);
 if r.source_id<>rid or r.source_document_number<>'GR-000001' or r.quantity_delta<>'2.000' or r.total_count<>1 then raise exception 'FAIL: B history'; end if;
 if (select current_quantity from public.list_current_stock(b))<>'2.000' or (select count(*) from public.list_current_stock(b))<>1 then raise exception 'FAIL: B stock'; end if;
 if exists(select 1 from public.list_current_stock(a)) or exists(select 1 from public.list_stock_movements(a))
  or exists(select 1 from public.list_current_stock(b,null,current_setting('test.sm_inv_a')::uuid))
  or exists(select 1 from public.list_stock_movements(b,current_setting('test.sm_inv_a')::uuid))
  or exists(select 1 from public.list_current_stock(a,null,current_setting('test.sm_inv_a')::uuid))
  then raise exception 'FAIL: B reads A'; end if;
 -- B cannot retype A's product (RLS: no row) and its own stocked product is locked.
 update public.products set product_type='service' where id=current_setting('test.sm_inv_a')::uuid;
 perform pg_temp.expect_error(format('update public.products set product_type=''service'' where id=%L',current_setting('test.sm_other_inv')),'ST002');
 -- B cannot change the status of A's purchase orders (ordering check never reached).
 perform pg_temp.expect_error(format('select public.set_purchase_order_status(%L,''cancelled'')',current_setting('test.sm_retype_po')),'P0002');
 -- B cannot write the ledger or move A's stock through A's documents.
 perform pg_temp.expect_error(pg_temp.raw_insert(b::text,(select id::text from public.goods_receipt_items limit 1)),'42501');
 perform pg_temp.expect_error(format('select pg_temp.receive(%L,%L)',current_setting('test.sm_po_multi'),
  jsonb_build_array(pg_temp.rl(pg_temp.line(current_setting('test.sm_po_multi')::uuid,1),'1'))),'P0002');
end $$;

-- All active A roles read the same ledger; nobody writes it directly.
do $$ declare u uuid; n bigint; begin
 foreach u in array array['b1000000-0000-4000-8000-000000000001'::uuid,'b1000000-0000-4000-8000-000000000003'::uuid,'b1000000-0000-4000-8000-000000000004'::uuid] loop
  perform set_config('request.jwt.claims',jsonb_build_object('sub',u,'role','authenticated')::text,true);
  select count(*) into n from public.stock_movements;
  if n<>pg_temp.movements() or n=0 or (select max(total_count) from public.list_stock_movements(current_setting('test.sm_org')::uuid))<>n
   or (select max(total_count) from public.list_current_stock(current_setting('test.sm_org')::uuid))<>13
   or (select product_type from public.products where id=current_setting('test.sm_inv_a')::uuid)<>'inventory' then raise exception 'FAIL: role read %',u; end if;
  perform pg_temp.expect_error(pg_temp.raw_insert(current_setting('test.sm_org'),(select id::text from public.goods_receipt_items limit 1)),'42501');
  perform pg_temp.expect_error('update public.stock_movements set quantity_delta=1','42501');
  perform pg_temp.expect_error('delete from public.stock_movements','42501');
  perform pg_temp.expect_error('truncate public.stock_movements','42501');
  perform pg_temp.expect_error(format('select public.post_goods_receipt_stock_movements(%L,%L)',current_setting('test.sm_org'),current_setting('test.sm_receipt_multi')),'42501');
 end loop;
end $$;

-- Disabled members (initially disabled, and after disabling) see nothing.
reset role;
update public.organization_members set status='disabled' where user_id='b1000000-0000-4000-8000-000000000003';
set local role authenticated;
do $$ declare u uuid; begin
 foreach u in array array['b1000000-0000-4000-8000-000000000003'::uuid,'b1000000-0000-4000-8000-000000000005'::uuid] loop
  perform set_config('request.jwt.claims',jsonb_build_object('sub',u,'role','authenticated')::text,true);
  if exists(select 1 from public.stock_movements) or exists(select 1 from public.list_current_stock(current_setting('test.sm_org')::uuid))
   or exists(select 1 from public.list_stock_movements(current_setting('test.sm_org')::uuid))
   or exists(select 1 from public.list_stock_movements(current_setting('test.sm_org')::uuid,current_setting('test.sm_inv_a')::uuid))
   then raise exception 'FAIL: disabled visibility %',u; end if;
 end loop;
end $$;
reset role;
set local role anon;
select set_config('request.jwt.claims','{"role":"anon"}',true);
select pg_temp.expect_error('select * from public.stock_movements','42501');
select pg_temp.expect_error('select * from public.list_current_stock(null)','42501');
select pg_temp.expect_error('select * from public.list_stock_movements(null)','42501');
reset role;
set constraints all immediate;
select 'ALL STOCK MOVEMENT CHECKS PASSED' as result;
rollback;
