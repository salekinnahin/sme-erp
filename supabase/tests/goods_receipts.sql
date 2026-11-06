-- Local postgres only, after 20261104200000; all fixtures roll back.
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
 ('a9000000-0000-4000-8000-000000000001','gr-owner@test.example'),
 ('a9000000-0000-4000-8000-000000000002','gr-other@test.example'),
 ('a9000000-0000-4000-8000-000000000003','gr-manager@test.example'),
 ('a9000000-0000-4000-8000-000000000004','gr-employee@test.example'),
 ('a9000000-0000-4000-8000-000000000005','gr-disabled@test.example');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"a9000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select set_config('test.gr_org',public.create_organization('Receiving A','BDT','Asia/Dhaka')::text,true);
select set_config('request.jwt.claims','{"sub":"a9000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select set_config('test.gr_other_org',public.create_organization('Receiving B','BDT','UTC')::text,true);
reset role;
insert into public.organization_members(organization_id,user_id,role,status) values
 (current_setting('test.gr_org')::uuid,'a9000000-0000-4000-8000-000000000003','manager','active'),
 (current_setting('test.gr_org')::uuid,'a9000000-0000-4000-8000-000000000004','employee','active'),
 (current_setting('test.gr_org')::uuid,'a9000000-0000-4000-8000-000000000005','employee','disabled');
do $$ declare o uuid; v uuid; p uuid; k text; t text; begin
 foreach k in array array['','other_'] loop
  o:=current_setting('test.gr_'||k||'org')::uuid;
  insert into public.vendors(organization_id,name) values(o,'Supplier') returning id into v;
  perform set_config('test.gr_'||k||'vendor',v::text,true);
  foreach t in array array['inventory','non_inventory','service'] loop
   insert into public.products(organization_id,name,sku,unit,description,product_type,purchase_price)
   values(o,t,t,'box','PO description',t,1) returning id into p;
   perform set_config('test.gr_'||k||t,p::text,true);
  end loop;
 end loop;
end $$;
create function pg_temp.po(k text, items jsonb) returns uuid language sql as $$
 select public.create_purchase_order(current_setting('test.gr_'||k||'vendor')::uuid,date '2026-11-06',null,null,items);
$$;
create function pg_temp.lines(k text) returns jsonb language sql as $$
 select jsonb_build_array(
  jsonb_build_object('product_id',current_setting('test.gr_'||k||'inventory'),'quantity','100'),
  jsonb_build_object('product_id',current_setting('test.gr_'||k||'non_inventory'),'quantity','50'),
  jsonb_build_object('product_id',current_setting('test.gr_'||k||'service'),'quantity','1'));
$$;
create function pg_temp.receive(po uuid, line uuid, q text) returns uuid language sql as $$
 select public.create_goods_receipt(po,date '2026-11-06',' received ',jsonb_build_array(jsonb_build_object('purchase_order_item_id',line,'received_quantity',q)));
$$;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"a9000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
do $$ declare po uuid; begin
 po:=pg_temp.po('other_',pg_temp.lines('other_'));
 perform public.set_purchase_order_status(po,'ordered');
 perform set_config('test.gr_other_po',po::text,true);
 perform set_config('test.gr_other_line',(select id::text from public.purchase_order_items where purchase_order_id=po order by sort_order limit 1),true);
 perform set_config('test.gr_other_receipt',pg_temp.receive(po,current_setting('test.gr_other_line')::uuid,'1')::text,true);
 if (select goods_receipt_number from public.goods_receipts where purchase_order_id=po)<>'GR-000001' then raise exception 'tenant numbering'; end if;
end $$;
select set_config('request.jwt.claims','{"sub":"a9000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
do $$ declare po uuid; line uuid; rid uuid; d jsonb; j jsonb; n bigint; x text; v_type text; begin
 po:=pg_temp.po('',pg_temp.lines(''));
 perform set_config('test.gr_po',po::text,true);
 select id into line from public.purchase_order_items where purchase_order_id=po and sort_order=1;
 perform set_config('test.gr_line',line::text,true);
 perform set_config('test.gr_line2',(select id::text from public.purchase_order_items where purchase_order_id=po and sort_order=2),true);
 perform set_config('test.gr_service_line',(select id::text from public.purchase_order_items where purchase_order_id=po and sort_order=3),true);
 perform pg_temp.expect_error(format('select pg_temp.receive(%L,%L,''1'')',po,line),'55000');
 -- Type is a real PO snapshot, retained when editing a kept line.
 select product_type into v_type from public.purchase_order_items where id=line;
 if v_type<>'inventory' then raise exception 'type snapshot'; end if;
 perform public.set_purchase_order_status(po,'ordered');
 -- All malformed/foreign inputs rollback header/items/counter.
 select count(*) into n from public.goods_receipts;
 foreach j in array array['null'::jsonb,'{}'::jsonb,'[]'::jsonb,'[null]'::jsonb,
  (select jsonb_agg(jsonb_build_object('purchase_order_item_id',line,'received_quantity','1')) from generate_series(1,101))] loop
  perform pg_temp.expect_error(format('select public.create_goods_receipt(%L,current_date,null,%L)',po,j),case when j='[null]' then 'GR001' else '22023' end);
 end loop;
 foreach x in array array['0','-1','NaN','1e2','1.0001','9999999999999999','Infinity',''] loop
  perform pg_temp.expect_error(format('select pg_temp.receive(%L,%L,%L)',po,line,x),'GR008');
 end loop;
 perform pg_temp.expect_error(format('select pg_temp.receive(%L,%L,''101'')',po,line),'GR003');
 perform pg_temp.expect_error(format('select pg_temp.receive(%L,%L,''1'')',po,current_setting('test.gr_service_line')),'GR002');
 perform pg_temp.expect_error(format('select pg_temp.receive(%L,%L,''1'')',po,current_setting('test.gr_other_line')),'GR001');
 perform pg_temp.expect_error(format('select pg_temp.receive(%L,%L,''1'')',po,gen_random_uuid()),'GR001');
 j:=jsonb_build_array(jsonb_build_object('purchase_order_item_id',line,'received_quantity','1'));
 perform pg_temp.expect_error(format('select public.create_goods_receipt(%L,current_date,null,%L)',po,j||j),'22023');
 perform pg_temp.expect_error(format('select public.create_goods_receipt(%L,null,null,%L)',po,j),'GR007');
 perform pg_temp.expect_error(format('select public.create_goods_receipt(%L,''infinity'',null,%L)',po,j),'GR007');
 perform pg_temp.expect_error(format('select public.create_goods_receipt(%L,''2026-02-30'',null,%L)',po,j),'22008');
 perform pg_temp.expect_error(format('select public.create_goods_receipt(%L,current_date,%L,%L)',po,repeat('x',2001),j),'22023');
 if (select count(*) from public.goods_receipts)<>n then raise exception 'failed receipt persisted'; end if;
 -- Forged snapshots/identity/product/status ignored.
 j:=jsonb_build_array(jsonb_build_object('purchase_order_item_id',line,'received_quantity','40','product_id',gen_random_uuid(),'product_name','FORGED','organization_id',gen_random_uuid(),'ordered_quantity_snapshot','999','sort_order',99));
 rid:=public.create_goods_receipt(po,date '2026-11-06',' received ',j);
 perform set_config('test.gr_receipt',rid::text,true);
 d:=public.get_goods_receipt(current_setting('test.gr_org')::uuid,rid);
 if d->>'goods_receipt_number'<>'GR-000001' or d->>'received_date'<>'2026-11-06' or d->>'notes'<>'received'
  or d->>'purchase_order_number'<>'PO-000001' or d#>>'{items,0,product_name}'<>'inventory'
  or d#>>'{items,0,ordered_quantity_snapshot}'<>'100.000' or d#>>'{items,0,received_quantity}'<>'40.000'
  or d#>>'{items,0,sort_order}'<>'1' or d->>'created_by'<>auth.uid()::text then raise exception 'receipt document %',d; end if;
 if (select remaining_quantity from public.get_purchase_order_receiving_summary(current_setting('test.gr_org')::uuid,po) where purchase_order_item_id=line)<>'60.000'
  or (select status from public.purchase_orders where id=po)<>'partially_received' then raise exception '40/60 partial'; end if;
 perform pg_temp.receive(po,line,'30');
 -- Cumulative 70 + 31 fails atomically, preserving both earlier receipts.
 select count(*) into n from public.goods_receipts;
 perform pg_temp.expect_error(format('select pg_temp.receive(%L,%L,''31'')',po,line),'GR003','over receiving');
 if (select count(*) from public.goods_receipts)<>n
   or (select sum(received_quantity) from public.goods_receipt_items where purchase_order_item_id=line)<>70
   or (select status from public.purchase_orders where id=po)<>'partially_received' then
   raise exception 'cumulative over-receive changed history';
 end if;
 if (select remaining_quantity from public.get_purchase_order_receiving_summary(current_setting('test.gr_org')::uuid,po) where purchase_order_item_id=line)<>'30.000' then raise exception '70/30'; end if;
 perform pg_temp.receive(po,line,'30');
 perform pg_temp.expect_error(format('select pg_temp.receive(%L,%L,''0.001'')',po,line),'GR004');
 if (select status from public.purchase_orders where id=po)<>'partially_received' then raise exception 'other line outstanding'; end if;
 perform pg_temp.receive(po,current_setting('test.gr_line2')::uuid,'50');
 if (select status from public.purchase_orders where id=po)<>'received' then raise exception 'service prevented completion'; end if;
 perform pg_temp.expect_error(format('select pg_temp.receive(%L,%L,''1'')',po,line),'55000');
 perform pg_temp.expect_error(format('select public.set_purchase_order_status(%L,''cancelled'')',po),'55000');
end $$;
-- Keep a draft across a product type change to prove the edit token preserves type.
do $$ declare po uuid; begin
 po:=pg_temp.po('',jsonb_build_array(jsonb_build_object('product_id',current_setting('test.gr_inventory'),'quantity','1')));
 perform set_config('test.gr_snapshot_po',po::text,true);
end $$;
reset role;
-- Master mutations cannot change receiving eligibility or receipt snapshots.
update public.products set name='Changed',description='Changed',unit='pcs',product_type='service',status='inactive'
 where id=current_setting('test.gr_inventory')::uuid;
set local role authenticated;
do $$ declare po uuid:=current_setting('test.gr_snapshot_po')::uuid; line uuid; rid uuid; d jsonb; begin
 select id into line from public.purchase_order_items where purchase_order_id=po;
 -- Fixed order date: pg_temp.receive() records 2026-11-06, and receiving
 -- before the order date is rejected (GR007) whatever the server's today is.
 perform public.update_purchase_order_draft(po,current_setting('test.gr_vendor')::uuid,date '2026-11-06',null,null,
  jsonb_build_array(jsonb_build_object('id',line,'product_id',current_setting('test.gr_inventory'),'quantity','1')));
 select id into line from public.purchase_order_items where purchase_order_id=po;
 if (select product_type from public.purchase_order_items where id=line)<>'inventory' then raise exception 'kept line type changed'; end if;
 perform public.set_purchase_order_status(po,'ordered');
 rid:=pg_temp.receive(po,line,'1');
 d:=public.get_goods_receipt(current_setting('test.gr_org')::uuid,rid);
 if d#>>'{items,0,product_type}'<>'inventory' or d#>>'{items,0,unit}'<>'box'
  or d#>>'{items,0,product_name}'<>'inventory' or d#>>'{items,0,description}'<>'PO description' then raise exception 'new receipt used current master %',d; end if;
end $$;
do $$ declare po uuid; a uuid; b uuid; s uuid; rid uuid; role_user uuid; begin
 -- New order snapshots the new master type, old completed PO remains inventory.
 if (select product_type from public.purchase_order_items where id=current_setting('test.gr_line')::uuid)<>'inventory'
  or public.get_goods_receipt(current_setting('test.gr_org')::uuid,current_setting('test.gr_receipt')::uuid)#>>'{items,0,unit}'<>'box' then raise exception 'historical snapshot changed'; end if;
 -- Two physical lines: A=100 B=50, receive A100+B10 then B40.
 po:=pg_temp.po('',jsonb_build_array(
  jsonb_build_object('product_id',current_setting('test.gr_non_inventory'),'quantity','100'),
  jsonb_build_object('product_id',current_setting('test.gr_non_inventory'),'quantity','50')));
 perform public.set_purchase_order_status(po,'ordered');
 select id into a from public.purchase_order_items where purchase_order_id=po and sort_order=1;
 select id into b from public.purchase_order_items where purchase_order_id=po and sort_order=2;
 rid:=public.create_goods_receipt(po,current_date,null,jsonb_build_array(
  jsonb_build_object('purchase_order_item_id',a,'received_quantity','100'),
  jsonb_build_object('purchase_order_item_id',b,'received_quantity','10')));
 if (select status from public.purchase_orders where id=po)<>'partially_received' then raise exception 'multi partial'; end if;
 perform pg_temp.expect_error(format('select public.set_purchase_order_status(%L,''cancelled'')',po),'55000');
 perform set_config('test.gr_partial',po::text,true);
 -- All active roles create receipts.
 foreach role_user in array array['a9000000-0000-4000-8000-000000000003'::uuid,'a9000000-0000-4000-8000-000000000004'::uuid] loop
  perform set_config('request.jwt.claims',jsonb_build_object('sub',role_user,'role','authenticated')::text,true);
  perform pg_temp.receive(po,b,'20');
 end loop;
 if (select status from public.purchase_orders where id=po)<>'received' then raise exception 'multi complete'; end if;
 perform set_config('request.jwt.claims','{"sub":"a9000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
 -- Cancellation with no receipt still allowed; service-only PO cannot produce
 -- an empty receipt or be automatically completed by a physical event.
 po:=pg_temp.po('',jsonb_build_array(jsonb_build_object('product_id',current_setting('test.gr_service'),'quantity','1')));
 perform public.set_purchase_order_status(po,'ordered');
 select id into s from public.purchase_order_items where purchase_order_id=po;
 perform pg_temp.expect_error(format('select pg_temp.receive(%L,%L,''1'')',po,s),'GR002');
 if (select status from public.purchase_orders where id=po)<>'ordered' then raise exception 'service-only status'; end if;
 perform public.set_purchase_order_status(po,'cancelled');
 perform pg_temp.expect_error(format('select pg_temp.receive(%L,%L,''1'')',po,s),'55000');
end $$;
reset role;
-- Dedicated ordered PO: direct writers, dates and the receipt-specific guard.
do $$ declare po uuid; begin
 po:=pg_temp.po('',jsonb_build_array(jsonb_build_object('product_id',current_setting('test.gr_non_inventory'),'quantity','100')));
 perform public.set_purchase_order_status(po,'ordered');
 perform set_config('test.gr_direct_po',po::text,true);
end $$;
reset role;
do $$ declare po uuid:=current_setting('test.gr_direct_po')::uuid; line uuid; rid uuid; s text; before_receipt jsonb; before_counter jsonb; begin
 select id into line from public.purchase_order_items where purchase_order_id=po;
 foreach s in array array['received','partially_received'] loop
  perform pg_temp.expect_error(format('update public.purchase_orders set status=%L where id=%L',s,po),'GR009',
   'purchase order receiving status does not match goods receipts');
 end loop;
 -- Database header guard covers privileged inserts as well as the RPC.
 perform pg_temp.expect_error(format('insert into public.goods_receipts(organization_id,goods_receipt_number,purchase_order_id,received_date,created_by) values(%L,''GR-888888'',%L,''2026-11-05'',%L)',
  current_setting('test.gr_org'),po,'a9000000-0000-4000-8000-000000000001'),'GR007');
 insert into public.goods_receipts(organization_id,goods_receipt_number,purchase_order_id,received_date,created_by)
 values(current_setting('test.gr_org')::uuid,'GR-888888',po,date '2026-11-06','a9000000-0000-4000-8000-000000000001') returning id into rid;
 -- Ordered + an unsealed receipt is a valid intermediate assembly state.
 -- Without the receipt-specific trigger this cancellation would be legal.
 if (select status from public.purchase_orders where id=po)<>'ordered' then raise exception 'guard fixture not ordered'; end if;
 perform pg_temp.expect_error(format('update public.purchase_orders set status=''cancelled'' where id=%L',po),'55000',
  'purchase order has goods receipts and cannot be cancelled');
 insert into public.goods_receipt_items(organization_id,goods_receipt_id,purchase_order_item_id,received_quantity,sort_order)
 values(current_setting('test.gr_org')::uuid,rid,line,70,1);
 update public.goods_receipts set sealed=true where id=rid;
 if (select status from public.purchase_orders where id=po)<>'partially_received' then raise exception 'privileged seal did not reconcile partial'; end if;
 foreach s in array array['received','ordered'] loop
  perform pg_temp.expect_error(format('update public.purchase_orders set status=%L where id=%L',s,po),'GR009');
 end loop;
 update public.purchase_orders set status='partially_received' where id=po;
 -- Exact requested regression: ordered 100, first receipt 70, second 31.
 before_receipt:=public.get_goods_receipt(current_setting('test.gr_org')::uuid,rid);
 select to_jsonb(c) into before_counter from public.document_number_counters c
   where organization_id=current_setting('test.gr_org')::uuid and document_type='goods_receipt';
 perform pg_temp.expect_error(format('select pg_temp.receive(%L,%L,''31'')',po,line),'GR003','over receiving');
 if (select count(*) from public.goods_receipts where purchase_order_id=po)<>1
   or (select count(*) from public.goods_receipt_items where purchase_order_id=po)<>1
   or public.get_goods_receipt(current_setting('test.gr_org')::uuid,rid) is distinct from before_receipt
   or (select to_jsonb(c) from public.document_number_counters c where organization_id=current_setting('test.gr_org')::uuid and document_type='goods_receipt') is distinct from before_counter
   or (select remaining_quantity from public.get_purchase_order_receiving_summary(current_setting('test.gr_org')::uuid,po) where purchase_order_item_id=line)<>'30.000'
   or (select status from public.purchase_orders where id=po)<>'partially_received' then
   raise exception '70 + 31 changed receipt, counter or summary';
 end if;

 -- Later date allowed, including future dates. No future-date restriction.
 perform public.create_goods_receipt(po,date '2026-11-07',null,jsonb_build_array(jsonb_build_object('purchase_order_item_id',line,'received_quantity','30')));
 if (select status from public.purchase_orders where id=po)<>'received' then raise exception 'later date completion'; end if;
 perform pg_temp.expect_error(format('update public.purchase_orders set status=''partially_received'' where id=%L',po),'GR009');
 update public.purchase_orders set status='received' where id=po;
end $$;
set local role authenticated;
-- RPC date guard, with no partial receipt or number persisted.
do $$ declare po uuid; line uuid; j jsonb; begin
 po:=pg_temp.po('',jsonb_build_array(jsonb_build_object('product_id',current_setting('test.gr_non_inventory'),'quantity','1')));
 perform public.set_purchase_order_status(po,'ordered');
 perform set_config('test.gr_empty_po',po::text,true);
 select id into line from public.purchase_order_items where purchase_order_id=po;
 j:=jsonb_build_array(jsonb_build_object('purchase_order_item_id',line,'received_quantity','1'));
 perform pg_temp.expect_error(format('select public.create_goods_receipt(%L,''2026-11-05'',null,%L)',po,j),'GR007');
 if exists(select 1 from public.goods_receipts where purchase_order_id=po) or (select status from public.purchase_orders where id=po)<>'ordered' then raise exception 'invalid date persisted'; end if;
end $$;
reset role;
-- Flush deferred events so TRUNCATE reaches our explicit guard.
set constraints goods_receipts_complete immediate;
set constraints goods_receipts_complete deferred;
-- Privileged immutability, FK, sealing, cancellation and lock structure.
do $$ declare q text; t text; r text; f record; rid uuid:=current_setting('test.gr_receipt')::uuid; begin
 foreach q in array array[
  format('update public.goods_receipts set notes=''changed'' where id=%L',rid),
  format('update public.goods_receipts set sealed=false where id=%L',rid),
  format('delete from public.goods_receipts where id=%L',rid),
  format('update public.goods_receipt_items set received_quantity=1 where goods_receipt_id=%L',rid),
  format('delete from public.goods_receipt_items where goods_receipt_id=%L',rid),
  format('insert into public.goods_receipt_items(organization_id,goods_receipt_id,purchase_order_item_id,received_quantity,sort_order) values(%L,%L,%L,1,99)',current_setting('test.gr_org'),rid,current_setting('test.gr_line')),
  format('delete from public.purchase_orders where id=%L',current_setting('test.gr_po')),
  format('update public.purchase_orders set status=''cancelled'' where id=%L',current_setting('test.gr_partial'))
 ] loop perform pg_temp.expect_error(q,'55000'); end loop;
 -- Organization deletion must not remove receipt history (FK or existing PO guard).
 begin
  delete from public.organizations where id=current_setting('test.gr_org')::uuid;
  raise exception 'organization deleted';
 exception when foreign_key_violation or sqlstate '55000' then null; end;
 if not exists(select 1 from public.goods_receipts where id=rid) then raise exception 'history deleted'; end if;
 -- CASCADE may reach another protected table: also verify each table owns
 -- its own enabled BEFORE STATEMENT TRUNCATE trigger.
 foreach t in array array['goods_receipts','goods_receipt_items','purchase_orders','purchase_order_items'] loop
  if not exists(select 1 from pg_trigger where tgrelid=('public.'||t)::regclass
    and tgfoid='public.immutable_purchase_documents_block_truncate()'::regprocedure
    and tgtype=34 and tgenabled='O') then raise exception 'missing truncate guard on %',t; end if;
 end loop;
 foreach t in array array['goods_receipts','goods_receipt_items'] loop
  perform pg_temp.expect_error('truncate public.'||t||' cascade','55000','immutable purchase documents cannot be truncated');
  if not (select relrowsecurity from pg_class where oid=('public.'||t)::regclass)
    or exists(select 1 from pg_policies where tablename=t and cmd<>'SELECT') then raise exception 'RLS'; end if;
  foreach r in array array['anon','authenticated'] loop
   if has_any_column_privilege(r,'public.'||t,'INSERT') or has_any_column_privilege(r,'public.'||t,'UPDATE')
    or has_table_privilege(r,'public.'||t,'DELETE,TRUNCATE') then raise exception 'direct grants'; end if;
  end loop;
 end loop;
 for f in select p.*,l.lanname from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_language l on l.oid=p.prolang
  where n.nspname='public' and (p.proname like '%goods_receipt%' or p.proname='get_purchase_order_receiving_summary') loop
  if not (f.proconfig @> array['search_path=""']) then raise exception 'search path %',f.proname; end if;
  if f.proname in ('get_goods_receipt','get_purchase_order_receiving_summary','list_goods_receipts') and (f.prosecdef or f.provolatile<>'s' or f.lanname<>'sql') then raise exception 'read definition'; end if;
  if has_function_privilege('anon',f.oid,'EXECUTE') then raise exception 'anon RPC'; end if;
  if f.proname not in ('get_goods_receipt','get_purchase_order_receiving_summary','list_goods_receipts','create_goods_receipt') and has_function_privilege('authenticated',f.oid,'EXECUTE') then raise exception 'helper grants'; end if;
 end loop;
 if (select prosrc from pg_proc where oid='public.create_goods_receipt(uuid,date,text,jsonb)'::regprocedure) !~* 'for update'
  or (select prosrc from pg_proc where oid='public.goods_receipt_items_enforce_rules()'::regprocedure) !~* 'for update'
  or not exists(select 1 from pg_trigger where tgname='goods_receipts_complete' and tgdeferrable and tginitdeferred) then raise exception 'locking/sealing structure'; end if;
end $$;
-- A privileged tool cannot commit a header without a sealed nonempty body.
do $$ begin
 begin
  insert into public.goods_receipts(organization_id,goods_receipt_number,purchase_order_id,received_date,created_by)
  values(current_setting('test.gr_org')::uuid,'GR-999999',current_setting('test.gr_empty_po')::uuid,current_date,'a9000000-0000-4000-8000-000000000001');
  set constraints goods_receipts_complete immediate;
  raise exception 'incomplete header accepted';
 exception when check_violation then null; end;
 if exists(select 1 from public.goods_receipts where goods_receipt_number='GR-999999') then raise exception 'incomplete header persisted'; end if;
end $$;
-- Unknown historical types fail closed. Simulate an old draft, order it, and
-- prove no inference from current product type occurs.
do $$ declare po uuid; begin
 insert into public.purchase_orders(organization_id,purchase_order_number,vendor_id,vendor_name,order_date,created_by)
 values(current_setting('test.gr_org')::uuid,'PO-999999',current_setting('test.gr_vendor')::uuid,'Legacy',current_date,'a9000000-0000-4000-8000-000000000001') returning id into po;
 insert into public.purchase_order_items(organization_id,purchase_order_id,product_id,product_name,sku,unit,quantity,unit_price,tax_amount,line_total,sort_order)
 values(current_setting('test.gr_org')::uuid,po,current_setting('test.gr_non_inventory')::uuid,'Legacy','L','pcs',1,1,0,1,1);
 update public.purchase_orders set status='ordered' where id=po;
 perform set_config('test.gr_legacy',po::text,true);
end $$;
set local role authenticated;
select pg_temp.expect_error(format('select pg_temp.receive(%L,%L,''1'')',current_setting('test.gr_legacy'),current_setting('test.gr_line')),'GR006');
-- Same-tenant but wrong PO line also fails.
do $$ declare po uuid; begin
 po:=pg_temp.po('',jsonb_build_array(jsonb_build_object('product_id',current_setting('test.gr_non_inventory'),'quantity','1')));
 perform public.set_purchase_order_status(po,'ordered');
 perform pg_temp.expect_error(format('select pg_temp.receive(%L,%L,''1'')',po,current_setting('test.gr_line')),'GR001');
 perform set_config('test.gr_open_po',po::text,true);
end $$;
-- All 100 accepted with deterministic receipt sort; exact fractional receipt.
do $$ declare po uuid; rid uuid; j jsonb; line uuid; begin
 po:=pg_temp.po('',(select jsonb_agg(jsonb_build_object('product_id',current_setting('test.gr_non_inventory'),'quantity','0.003')) from generate_series(1,100)));
 perform public.set_purchase_order_status(po,'ordered');
 select jsonb_agg(jsonb_build_object('purchase_order_item_id',id,'received_quantity','0.001') order by sort_order desc) into j
 from public.purchase_order_items where purchase_order_id=po;
 rid:=public.create_goods_receipt(po,current_date,null,j);
 if (select count(*) from public.goods_receipt_items where goods_receipt_id=rid)<>100
  or (select max(sort_order) from public.goods_receipt_items where goods_receipt_id=rid)<>100
  or exists(select 1 from public.get_purchase_order_receiving_summary(current_setting('test.gr_org')::uuid,po) where remaining_quantity<>'0.002') then raise exception '100 lines or exact quantities'; end if;
 -- A late failing line must roll back earlier inserted valid lines and status.
 select id into line from public.purchase_order_items where purchase_order_id=po order by sort_order limit 1;
 j:=jsonb_build_array(jsonb_build_object('purchase_order_item_id',line,'received_quantity','0.001'),jsonb_build_object('purchase_order_item_id',current_setting('test.gr_line'),'received_quantity','1'));
 perform pg_temp.expect_error(format('select public.create_goods_receipt(%L,current_date,null,%L)',po,j),'GR001');
 if exists(select 1 from public.get_purchase_order_receiving_summary(current_setting('test.gr_org')::uuid,po) where remaining_quantity<>'0.002') then raise exception 'late failure persisted items'; end if;
end $$;
-- -----------------------------------------------------------------------------
-- Part 2 list/history read (20261104220000_list_goods_receipts.sql).
-- -----------------------------------------------------------------------------
do $$ declare f record; begin
 select p.prosecdef, p.provolatile, p.proconfig, l.lanname, p.oid into f from pg_proc p join pg_language l on l.oid=p.prolang
 where p.oid='public.list_goods_receipts(uuid,text,uuid,integer,integer)'::regprocedure;
 if f.prosecdef or f.provolatile<>'s' or f.lanname<>'sql' or not (f.proconfig @> array['search_path=""']) then raise exception 'list definition'; end if;
 if has_function_privilege('anon',f.oid,'EXECUTE') or has_function_privilege('public',f.oid,'EXECUTE')
  or not has_function_privilege('authenticated',f.oid,'EXECUTE') then raise exception 'list grants'; end if;
end $$;
reset role;
insert into public.vendors(organization_id,name,company_name) values
 (current_setting('test.gr_org')::uuid,'Wild%_Card Supply','Ünïcode Traders'),
 (current_setting('test.gr_org')::uuid,'Wildx Card Supply','Plain Traders');
set local role authenticated;
do $$ declare o uuid:=current_setting('test.gr_org')::uuid; v uuid; v2 uuid; po uuid; po2 uuid; a uuid; b uuid; s uuid;
 r1 uuid; r2 uuid; r3 uuid; r4 uuid; n1 text; n2 text; ids uuid[]; rec record; total bigint; begin
 select id into v from public.vendors where organization_id=o and name='Wild%_Card Supply';
 select id into v2 from public.vendors where organization_id=o and name='Wildx Card Supply';
 -- The inventory fixture product was deactivated above; use active products.
 po:=public.create_purchase_order(v,date '2026-11-01',null,null,jsonb_build_array(
  jsonb_build_object('product_id',current_setting('test.gr_non_inventory'),'quantity','100'),
  jsonb_build_object('product_id',current_setting('test.gr_non_inventory'),'quantity','50'),
  jsonb_build_object('product_id',current_setting('test.gr_service'),'quantity','1')));
 perform public.set_purchase_order_status(po,'ordered');
 select id into a from public.purchase_order_items where purchase_order_id=po and sort_order=1;
 select id into b from public.purchase_order_items where purchase_order_id=po and sort_order=2;
 select id into s from public.purchase_order_items where purchase_order_id=po and sort_order=3;
 -- No receipts yet: empty history.
 if exists(select 1 from public.list_goods_receipts(o,null,po)) then raise exception 'history before receipt'; end if;
 -- A 100 -> 30, B 50 -> 20 (service never receivable), then two later receipts.
 r1:=public.create_goods_receipt(po,date '2026-11-06',null,jsonb_build_array(
  jsonb_build_object('purchase_order_item_id',a,'received_quantity','30'),
  jsonb_build_object('purchase_order_item_id',b,'received_quantity','20.5')));
 r2:=public.create_goods_receipt(po,date '2026-11-08',null,jsonb_build_array(jsonb_build_object('purchase_order_item_id',a,'received_quantity','0.125')));
 r3:=public.create_goods_receipt(po,date '2026-11-07',null,jsonb_build_array(jsonb_build_object('purchase_order_item_id',b,'received_quantity','1')));
 po2:=public.create_purchase_order(v2,date '2026-11-01',null,null,jsonb_build_array(jsonb_build_object('product_id',current_setting('test.gr_non_inventory'),'quantity','5')));
 perform public.set_purchase_order_status(po2,'ordered');
 r4:=public.create_goods_receipt(po2,date '2026-11-08',null,jsonb_build_array(jsonb_build_object('purchase_order_item_id',
  (select id from public.purchase_order_items where purchase_order_id=po2 and sort_order=1),'received_quantity','2')));
 -- History: only this PO, newest received date first, aggregates exact.
 select array_agg(l.id order by l.ord) into ids from public.list_goods_receipts(o,null,po,100,0) with ordinality as l(id,gn,poid,pon,vn,vc,rd,ic,rbn,ca,tc,ord);
 if ids is distinct from array[r2,r3,r1] then raise exception 'history order %',ids; end if;
 select * into rec from public.list_goods_receipts(o,null,po) where id=r1;
 if rec.item_count<>2 or rec.total_count<>3 or rec.purchase_order_id<>po
  or rec.vendor_name<>'Wild%_Card Supply' or rec.vendor_company_name<>'Ünïcode Traders' or rec.received_date<>'2026-11-06'
  or rec.received_by_name is not null or rec.purchase_order_number<>(select purchase_order_number from public.purchase_orders where id=po)
  then raise exception 'history row %',rec; end if;
 if (select item_count from public.list_goods_receipts(o,null,po) where id=r2)<>1 then raise exception 'single-line item count'; end if;
 -- Search: GR number, PO number, vendor name, vendor company, case-insensitive.
 select goods_receipt_number into n1 from public.goods_receipts where id=r1;
 if (select array_agg(id) from public.list_goods_receipts(o,lower(n1))) is distinct from array[r1] then raise exception 'GR search'; end if;
 select purchase_order_number into n2 from public.purchase_orders where id=po2;
 if (select array_agg(id) from public.list_goods_receipts(o,n2)) is distinct from array[r4] then raise exception 'PO search'; end if;
 if (select count(*) from public.list_goods_receipts(o,'WILD%_CARD')) <> 3 then raise exception 'vendor name search'; end if;
 if (select count(*) from public.list_goods_receipts(o,'Plain Traders')) <> 1 then raise exception 'vendor company search'; end if;
 -- Literal wildcards: '%' / '_' only match names containing them; 'd%_C' does not match 'dx C'.
 if (select count(*) from public.list_goods_receipts(o,'%'))<>3 or (select count(*) from public.list_goods_receipts(o,'_'))<>3
  or (select count(*) from public.list_goods_receipts(o,'Wildx_Card'))<>0 or (select count(*) from public.list_goods_receipts(o,'d%_C'))<>3
  then raise exception 'wildcard escaping'; end if;
 -- Unicode whitespace trimmed; blank search means no filter.
 if (select count(*) from public.list_goods_receipts(o,E'  Ünïcode　 '))<>3 then raise exception 'unicode trim'; end if;
 select count(*) into total from public.goods_receipts where organization_id=o and sealed;
 if (select count(*) from public.list_goods_receipts(o,E'    ',null,100))<>least(total,100)
  or (select max(total_count) from public.list_goods_receipts(o,E'   '))<>total then raise exception 'blank search'; end if;
 -- Pagination: 25 default, clamped limit/offset, stable pages, total before paging.
 if (select count(*) from public.list_goods_receipts(o))<>least(total,25)
  or (select count(*) from public.list_goods_receipts(o,null,null,0))<>1
  or (select count(*) from public.list_goods_receipts(o,null,null,-5))<>1
  or (select count(*) from public.list_goods_receipts(o,null,null,null))<>least(total,25)
  or (select count(*) from public.list_goods_receipts(o,null,null,1000))<>least(total,100)
  or (select array_agg(id) from public.list_goods_receipts(o,null,po,1,-3)) is distinct from array[r2]
  or (select array_agg(id) from public.list_goods_receipts(o,null,po,1,1)) is distinct from array[r3]
  or (select array_agg(id) from public.list_goods_receipts(o,null,po,2,2)) is distinct from array[r1]
  or (select max(total_count) from public.list_goods_receipts(o,null,po,1,1))<>3
  or exists(select 1 from public.list_goods_receipts(o,null,po,25,3)) then raise exception 'pagination'; end if;
 if (select array_agg(id) from public.list_goods_receipts(o,null,null,100)) is distinct from
    (select array_agg(id) from (select id from public.list_goods_receipts(o,null,null,100)) x) then raise exception 'stable order'; end if;
 -- Null/other-tenant arguments never widen reads.
 if exists(select 1 from public.list_goods_receipts(null))
  or exists(select 1 from public.list_goods_receipts(current_setting('test.gr_other_org')::uuid))
  or exists(select 1 from public.list_goods_receipts(o,null,current_setting('test.gr_other_po')::uuid)) then raise exception 'A list isolation'; end if;
 perform set_config('test.gr_list_po',po::text,true);
end $$;
-- -----------------------------------------------------------------------------
-- Received By snapshot (20261104230000_goods_receipt_received_by_snapshot.sql).
-- -----------------------------------------------------------------------------
reset role;
do $$ begin
 -- Every receipt so far was recorded while fixture profiles had no name: none invented.
 if exists(select 1 from public.goods_receipts where received_by_name is not null) then raise exception 'unnamed recorder got a name'; end if;
 -- Privacy: profiles keep exactly the own-row read policy; no new broad grant.
 if (select count(*) from pg_policies where schemaname='public' and tablename='profiles')<>1
  or (select qual from pg_policies where schemaname='public' and tablename='profiles') not like '%auth.uid()%'
  or has_table_privilege('authenticated','public.profiles','INSERT,UPDATE,DELETE')
  or has_function_privilege('authenticated','public.goods_receipts_snapshot_received_by()','EXECUTE') then raise exception 'profile privacy changed'; end if;
end $$;
update public.profiles set full_name=E'  Rahim Uddin ' where id='a9000000-0000-4000-8000-000000000001';
update public.profiles set full_name='Karim Ahmed' where id='a9000000-0000-4000-8000-000000000004';
update public.profiles set full_name='Other Tenant User' where id='a9000000-0000-4000-8000-000000000002';
insert into public.products(organization_id,name,sku,unit,product_type,purchase_price)
select current_setting('test.gr_org')::uuid,n,n,u,t,1 from (values('Bitumen','kg','inventory'),('Fuel','litre','non_inventory'),('Drum','pcs','inventory')) v(n,u,t);
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"a9000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
do $$ declare o uuid:=current_setting('test.gr_org')::uuid; po uuid; rid uuid; d jsonb; rec record; j jsonb; begin
 po:=public.create_purchase_order(current_setting('test.gr_vendor')::uuid,date '2026-11-01',null,null,
  (select jsonb_agg(jsonb_build_object('product_id',id,'quantity','100') order by name) from public.products where organization_id=o and name in ('Bitumen','Drum','Fuel')));
 perform public.set_purchase_order_status(po,'ordered');
 -- 20 kg + 5 litre + 10 pcs; forged recorder fields inside items are ignored.
 select jsonb_agg(jsonb_build_object('purchase_order_item_id',i.id,'received_quantity',case i.sort_order when 1 then '20' when 2 then '5' else '10' end,
   'received_by_name','FORGED','created_by','a9000000-0000-4000-8000-000000000002') order by i.sort_order) into j
 from public.purchase_order_items i where i.purchase_order_id=po;
 rid:=public.create_goods_receipt(po,date '2026-11-07',null,j);
 d:=public.get_goods_receipt(o,rid);
 if d->>'received_by_name' is distinct from 'Rahim Uddin' or d->>'created_by'<>auth.uid()::text then raise exception 'snapshot from recorder %',d; end if;
 select * into rec from public.list_goods_receipts(o,null,po);
 if rec.id<>rid or rec.item_count<>3 or rec.received_by_name<>'Rahim Uddin' or rec.total_count<>1 then raise exception 'history snapshot/item count %',rec; end if;
 if (select received_by_name from public.list_goods_receipts(o,null,null,100) where id=rid)<>'Rahim Uddin' then raise exception 'list snapshot'; end if;
 -- No mixed-unit quantity aggregate is returned any more.
 if pg_get_function_result('public.list_goods_receipts(uuid,text,uuid,integer,integer)'::regprocedure) ~ '(quantity|created_by)' then raise exception 'list still returns quantity/creator'; end if;
 -- Recorder name is not a search target.
 if exists(select 1 from public.list_goods_receipts(o,'Rahim Uddin')) then raise exception 'recorder name searchable'; end if;
 perform set_config('test.gr_named_po',po::text,true);
 perform set_config('test.gr_named_receipt',rid::text,true);
 perform set_config('test.gr_named_line',(select id::text from public.purchase_order_items where purchase_order_id=po and sort_order=1),true);
end $$;
-- Each recorder snapshots their own name; a recorder without a profile name stores NULL (no email fallback).
select set_config('request.jwt.claims','{"sub":"a9000000-0000-4000-8000-000000000004","role":"authenticated"}',true);
select set_config('test.gr_employee_receipt',pg_temp.receive(current_setting('test.gr_named_po')::uuid,current_setting('test.gr_named_line')::uuid,'1')::text,true);
select set_config('request.jwt.claims','{"sub":"a9000000-0000-4000-8000-000000000003","role":"authenticated"}',true);
select set_config('test.gr_unnamed_receipt',pg_temp.receive(current_setting('test.gr_named_po')::uuid,current_setting('test.gr_named_line')::uuid,'1')::text,true);
do $$ declare o uuid:=current_setting('test.gr_org')::uuid; begin
 if (public.get_goods_receipt(o,current_setting('test.gr_employee_receipt')::uuid)->>'received_by_name') is distinct from 'Karim Ahmed'
  or (public.get_goods_receipt(o,current_setting('test.gr_unnamed_receipt')::uuid)->>'received_by_name') is not null
  or (public.get_goods_receipt(o,current_setting('test.gr_unnamed_receipt')::uuid)->>'created_by')<>'a9000000-0000-4000-8000-000000000003'
  or (select array_agg(received_by_name order by received_date desc, id) from public.list_goods_receipts(o,null,current_setting('test.gr_named_po')::uuid))
     is distinct from (select array_agg(received_by_name order by received_date desc, id) from public.goods_receipts where purchase_order_id=current_setting('test.gr_named_po')::uuid)
  then raise exception 'per-recorder snapshots'; end if;
 -- The manager reads the employee's name only from the receipt, never the profile.
 if exists(select 1 from public.profiles where id in ('a9000000-0000-4000-8000-000000000001','a9000000-0000-4000-8000-000000000004')) then raise exception 'co-member profile readable'; end if;
 -- Direct API write of the snapshot is refused.
 perform pg_temp.expect_error(format('update public.goods_receipts set received_by_name=''X'' where id=%L',current_setting('test.gr_named_receipt')),'42501');
end $$;
-- Tenant B gets B's name and cannot read or influence A's.
select set_config('request.jwt.claims','{"sub":"a9000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
do $$ declare rid uuid; begin
 rid:=pg_temp.receive(current_setting('test.gr_other_po')::uuid,current_setting('test.gr_other_line')::uuid,'1');
 if public.get_goods_receipt(current_setting('test.gr_other_org')::uuid,rid)->>'received_by_name' is distinct from 'Other Tenant User'
  or public.get_goods_receipt(current_setting('test.gr_org')::uuid,current_setting('test.gr_named_receipt')::uuid) is not null
  or exists(select 1 from public.list_goods_receipts(current_setting('test.gr_org')::uuid,null,current_setting('test.gr_named_po')::uuid)) then raise exception 'B snapshot/isolation'; end if;
 -- B's later receipt must not be visible in A's history either.
 perform set_config('test.gr_other_receipt2',rid::text,true);
end $$;
reset role;
do $$ declare v text; begin
 -- Historical stability: renames, disabling and a privileged rewrite attempt leave the snapshot.
 update public.profiles set full_name='Rahim Renamed' where id='a9000000-0000-4000-8000-000000000001';
 update public.profiles set full_name=null where id='a9000000-0000-4000-8000-000000000004';
 update public.organization_members set status='disabled' where user_id='a9000000-0000-4000-8000-000000000004';
 perform pg_temp.expect_error(format('update public.goods_receipts set received_by_name=''Changed'' where id=%L',current_setting('test.gr_named_receipt')),'55000');
 perform pg_temp.expect_error(format('update public.goods_receipts set received_by_name=null, notes=''x'' where id=%L',current_setting('test.gr_employee_receipt')),'55000');
 if (select received_by_name from public.goods_receipts where id=current_setting('test.gr_named_receipt')::uuid)<>'Rahim Uddin'
  or (select received_by_name from public.goods_receipts where id=current_setting('test.gr_employee_receipt')::uuid)<>'Karim Ahmed'
  or (public.get_goods_receipt(current_setting('test.gr_org')::uuid,current_setting('test.gr_employee_receipt')::uuid)->>'received_by_name')<>'Karim Ahmed'
  or (select array_agg(received_by_name order by received_by_name) from public.list_goods_receipts(current_setting('test.gr_org')::uuid,null,current_setting('test.gr_named_po')::uuid))
     is distinct from array['Karim Ahmed','Rahim Uddin',null]
  then raise exception 'snapshot changed with profile/membership'; end if;
 update public.organization_members set status='active' where user_id='a9000000-0000-4000-8000-000000000004';
 -- A privileged insert cannot forge the name either (probe rolled back).
 begin
  insert into public.goods_receipts(organization_id,goods_receipt_number,purchase_order_id,received_date,created_by,received_by_name)
  values(current_setting('test.gr_org')::uuid,'GR-777777',current_setting('test.gr_named_po')::uuid,date '2026-11-09','a9000000-0000-4000-8000-000000000001','FORGED')
  returning received_by_name into v;
  if v is distinct from 'Rahim Renamed' then raise exception 'privileged forged name %',v; end if;
  raise exception 'rollback-probe';
 exception when raise_exception then
  if sqlerrm<>'rollback-probe' then raise; end if;
 end;
 if exists(select 1 from public.goods_receipts where goods_receipt_number='GR-777777') then raise exception 'probe persisted'; end if;
end $$;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"a9000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
-- Direct API mutations rejected even for owners.
select pg_temp.expect_error('insert into public.goods_receipts(id) values(gen_random_uuid())','42501');
select pg_temp.expect_error('update public.goods_receipts set notes=''x''','42501');
select pg_temp.expect_error('delete from public.goods_receipts','42501');
select pg_temp.expect_error('insert into public.goods_receipt_items(id) values(gen_random_uuid())','42501');
select pg_temp.expect_error('update public.goods_receipt_items set received_quantity=1','42501');
select pg_temp.expect_error('delete from public.goods_receipt_items','42501');
-- A cannot infer B and vice versa; null arguments never widen reads.
do $$ begin
 if public.get_goods_receipt(current_setting('test.gr_other_org')::uuid,current_setting('test.gr_other_receipt')::uuid) is not null
  or exists(select 1 from public.get_purchase_order_receiving_summary(current_setting('test.gr_other_org')::uuid,current_setting('test.gr_other_po')::uuid))
  or public.get_goods_receipt(null,current_setting('test.gr_receipt')::uuid) is not null
  or public.get_goods_receipt(current_setting('test.gr_org')::uuid,null) is not null then raise exception 'A read isolation'; end if;
 perform pg_temp.expect_error(format('select pg_temp.receive(%L,%L,''1'')',current_setting('test.gr_other_po'),current_setting('test.gr_other_line')),'P0002');
end $$;
select set_config('request.jwt.claims','{"sub":"a9000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
do $$ begin
 if exists(select 1 from public.goods_receipts where organization_id=current_setting('test.gr_org')::uuid)
  or exists(select 1 from public.goods_receipt_items where organization_id=current_setting('test.gr_org')::uuid)
  or public.get_goods_receipt(current_setting('test.gr_org')::uuid,current_setting('test.gr_receipt')::uuid) is not null
  or exists(select 1 from public.get_purchase_order_receiving_summary(current_setting('test.gr_org')::uuid,current_setting('test.gr_po')::uuid)) then raise exception 'B isolation'; end if;
 perform pg_temp.expect_error(format('select pg_temp.receive(%L,%L,''1'')',current_setting('test.gr_open_po'),current_setting('test.gr_line')),'P0002');
end $$;
reset role;
update public.organization_members set status='disabled' where user_id='a9000000-0000-4000-8000-000000000003';
set local role authenticated;
do $$ declare u uuid; begin
 foreach u in array array['a9000000-0000-4000-8000-000000000003'::uuid,'a9000000-0000-4000-8000-000000000005'::uuid] loop
  perform set_config('request.jwt.claims',jsonb_build_object('sub',u,'role','authenticated')::text,true);
  if exists(select 1 from public.goods_receipts) or exists(select 1 from public.goods_receipt_items)
    or exists(select 1 from public.get_purchase_order_receiving_summary(current_setting('test.gr_org')::uuid,current_setting('test.gr_po')::uuid))
    or public.get_goods_receipt(current_setting('test.gr_org')::uuid,current_setting('test.gr_receipt')::uuid) is not null then raise exception 'disabled visibility'; end if;
  perform pg_temp.expect_error(format('select pg_temp.receive(%L,%L,''1'')',current_setting('test.gr_open_po'),current_setting('test.gr_line')),'P0002');
 end loop;
end $$;
-- Part 2 list/history: other tenant and disabled members see no A receipts,
-- even with A's organization/PO IDs; B still sees only its own.
do $$ declare u uuid; begin
 foreach u in array array['a9000000-0000-4000-8000-000000000002'::uuid,'a9000000-0000-4000-8000-000000000003'::uuid,'a9000000-0000-4000-8000-000000000005'::uuid] loop
  perform set_config('request.jwt.claims',jsonb_build_object('sub',u,'role','authenticated')::text,true);
  if exists(select 1 from public.list_goods_receipts(current_setting('test.gr_org')::uuid))
   or exists(select 1 from public.list_goods_receipts(current_setting('test.gr_org')::uuid,'GR',current_setting('test.gr_list_po')::uuid)) then
   raise exception 'list isolation %',u;
  end if;
 end loop;
 perform set_config('request.jwt.claims','{"sub":"a9000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
 -- B's two receipts (Part 1 fixture and the Received By snapshot check), nothing of A's.
 if (select array_agg(id order by id) from public.list_goods_receipts(current_setting('test.gr_other_org')::uuid))
    is distinct from (select array_agg(x order by x) from unnest(array[current_setting('test.gr_other_receipt')::uuid,current_setting('test.gr_other_receipt2')::uuid]) x)
  or (select array_agg(id order by id) from public.list_goods_receipts(current_setting('test.gr_other_org')::uuid,null,current_setting('test.gr_other_po')::uuid))
    is distinct from (select array_agg(x order by x) from unnest(array[current_setting('test.gr_other_receipt')::uuid,current_setting('test.gr_other_receipt2')::uuid]) x)
  then raise exception 'B own list'; end if;
end $$;
reset role;
set local role anon;
select set_config('request.jwt.claims','{"role":"anon"}',true);
select pg_temp.expect_error('select * from public.goods_receipts','42501');
select pg_temp.expect_error('select * from public.goods_receipt_items','42501');
select pg_temp.expect_error('select public.create_goods_receipt(null,current_date,null,''[]'')','42501');
select pg_temp.expect_error('select public.get_goods_receipt(null,null)','42501');
select pg_temp.expect_error('select public.get_purchase_order_receiving_summary(null,null)','42501');
select pg_temp.expect_error('select * from public.list_goods_receipts(null)','42501');
reset role;
set constraints all immediate;
select 'ALL GOODS RECEIPT CHECKS PASSED' as result;
rollback;
