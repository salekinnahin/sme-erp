-- Goods Receiving Part 1. Apply after 20261104190000_list_purchase_orders.sql.
-- No stock ledger or UI. Every receive/cancel path serializes on the PO row.
-- Historical product types are intentionally UNKNOWN, never guessed from master.
alter table public.purchase_order_items add column product_type text
  check (product_type in ('inventory', 'non_inventory', 'service'));
comment on column public.purchase_order_items.product_type is
  'Historical snapshot; NULL on pre-migration lines requires explicit reconciliation before receiving.';
alter table public.purchase_order_items add constraint purchase_order_items_receipt_source_key
  unique (organization_id, purchase_order_id, id, product_id);

create or replace function public.purchase_order_replace_items(
  p_purchase_order_id   uuid,
  p_organization_id  uuid,
  p_items            jsonb
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_old            jsonb;
  v_used           text[] := '{}';
  v_item           jsonb;
  v_index          bigint;
  v_line_id        text;
  v_old_line       jsonb;
  v_kept           boolean;
  v_product_id     uuid;
  v_product        record;
  v_name           text;
  v_sku            text;
  v_unit           text;
  v_product_type   text;
  v_default_price  numeric;
  v_default_desc   text;
  v_quantity       numeric;
  v_unit_price     numeric;
  v_discount       numeric;
  v_tax_rate       numeric;
  v_description    text;
  v_gross          numeric;
  v_tax            numeric;
begin
  if p_items is null or pg_catalog.jsonb_typeof(p_items) <> 'array' then
    raise exception 'items must be a JSON array' using errcode = '22023';
  end if;
  if pg_catalog.jsonb_array_length(p_items) < 1 then
    raise exception 'a purchase order needs at least one item' using errcode = '22023';
  end if;
  if pg_catalog.jsonb_array_length(p_items) > 100 then
    raise exception 'a purchase order can have at most 100 items' using errcode = '22023';
  end if;

  -- The current lines of this order, keyed by id, before they are replaced.
  select coalesce(pg_catalog.jsonb_object_agg(i.id::text, pg_catalog.jsonb_build_object(
           'product_id',   i.product_id,
           'product_type', i.product_type,
           'product_name', i.product_name,
           'sku',          i.sku,
           'unit',         i.unit,
           'description',  i.description,
           'unit_price',   i.unit_price::text)), '{}'::jsonb)
  into v_old
  from public.purchase_order_items i
  where i.purchase_order_id = p_purchase_order_id
    and i.organization_id = p_organization_id;

  delete from public.purchase_order_items i
  where i.purchase_order_id = p_purchase_order_id
    and i.organization_id = p_organization_id;

  for v_item, v_index in
    select e.value, e.ordinality
    from pg_catalog.jsonb_array_elements(p_items) with ordinality as e (value, ordinality)
  loop
    if pg_catalog.jsonb_typeof(v_item) <> 'object' then
      raise exception 'item %: must be an object', v_index using errcode = '22023';
    end if;

    if coalesce(v_item ->> 'product_id', '')
       !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'item %: product is required', v_index using errcode = '22023';
    end if;
    v_product_id := (v_item ->> 'product_id')::uuid;

    -- Existing line reference (only lines of this order).
    v_kept := false;
    if coalesce(pg_catalog.jsonb_typeof(v_item -> 'id'), 'null') <> 'null' then
      v_line_id := lower(v_item ->> 'id');
      if pg_catalog.jsonb_typeof(v_item -> 'id') <> 'string'
         or not (v_old ? v_line_id)
         or v_line_id = any (v_used) then
        raise exception 'item %: line not found', v_index using errcode = '22023';
      end if;
      v_used := v_used || v_line_id;
      v_old_line := v_old -> v_line_id;
      v_kept := (v_old_line ->> 'product_id')::uuid = v_product_id;
    end if;

    if v_kept then
      v_product_type  := v_old_line ->> 'product_type';
      v_name          := v_old_line ->> 'product_name';
      v_sku           := v_old_line ->> 'sku';
      v_unit          := v_old_line ->> 'unit';
      v_default_price := (v_old_line ->> 'unit_price')::numeric;
      v_default_desc  := v_old_line ->> 'description';
    else
      -- New selection. Unknown and other-tenant products look the same.
      select p.name, p.sku, p.description, p.unit, p.purchase_price, p.status, p.product_type
      into v_product
      from public.products p
      where p.id = v_product_id
        and p.organization_id = p_organization_id;

      if not found then
        raise exception 'item %: product not found', v_index using errcode = '23503';
      end if;
      if v_product.status <> 'active' then
        raise exception 'item %: product is inactive', v_index using errcode = '23503';
      end if;

      v_product_type  := v_product.product_type;
      v_name          := v_product.name;
      v_sku           := v_product.sku;
      v_unit          := v_product.unit;
      v_default_price := v_product.purchase_price;
      v_default_desc  := v_product.description;
    end if;

    v_quantity := public.quotation_parse_decimal(v_item -> 'quantity', 15, 3);
    if v_quantity is null or v_quantity <= 0 then
      raise exception 'item %: quantity must be greater than 0 with at most 3 decimals', v_index
        using errcode = '22023';
    end if;

    if coalesce(pg_catalog.jsonb_typeof(v_item -> 'unit_price'), 'null') = 'null' then
      v_unit_price := v_default_price;
      if v_unit_price is null then
        raise exception 'item %: unit price is required (the product has no purchase price)', v_index
          using errcode = '22023';
      end if;
    else
      v_unit_price := public.quotation_parse_decimal(v_item -> 'unit_price', 16, 2);
      if v_unit_price is null then
        raise exception 'item %: invalid unit price', v_index using errcode = '22023';
      end if;
    end if;

    if coalesce(pg_catalog.jsonb_typeof(v_item -> 'discount_amount'), 'null') = 'null' then
      v_discount := 0;
    else
      v_discount := public.quotation_parse_decimal(v_item -> 'discount_amount', 16, 2);
      if v_discount is null then
        raise exception 'item %: invalid discount', v_index using errcode = '22023';
      end if;
    end if;

    if coalesce(pg_catalog.jsonb_typeof(v_item -> 'tax_rate'), 'null') = 'null' then
      v_tax_rate := 0;
    else
      v_tax_rate := public.quotation_parse_decimal(v_item -> 'tax_rate', 3, 2);
      if v_tax_rate is null or v_tax_rate > 100 then
        raise exception 'item %: tax rate must be between 0 and 100', v_index using errcode = '22023';
      end if;
    end if;

    if v_item ? 'description' then
      case pg_catalog.jsonb_typeof(v_item -> 'description')
        when 'null' then
          v_description := null;
        when 'string' then
          v_description := nullif(public.trim_whitespace(v_item ->> 'description'), '');
        else
          raise exception 'item %: invalid description', v_index using errcode = '22023';
      end case;
      if char_length(v_description) > 2000 then
        raise exception 'item %: description is too long', v_index using errcode = '22023';
      end if;
    else
      v_description := v_default_desc;
    end if;

    v_gross := round(v_quantity * v_unit_price, 2);
    if v_discount > v_gross then
      raise exception 'item %: discount cannot exceed the line amount', v_index using errcode = '22023';
    end if;
    v_tax := round((v_gross - v_discount) * v_tax_rate * 0.01, 2);

    -- Overflow of numeric(18,2) raises 22003 here.
    insert into public.purchase_order_items (
      organization_id, purchase_order_id, product_id,
      product_name, sku, description, unit, product_type,
      quantity, unit_price, discount_amount, tax_rate, tax_amount, line_total,
      sort_order
    ) values (
      p_organization_id, p_purchase_order_id, v_product_id,
      v_name, v_sku, v_description, v_unit, v_product_type,
      v_quantity, v_unit_price, v_discount, v_tax_rate, v_tax,
      v_gross - v_discount + v_tax,
      v_index
    );
  end loop;

  perform public.purchase_order_recompute_totals(p_purchase_order_id, p_organization_id);
end;
$$;

revoke all on function public.purchase_order_replace_items(uuid, uuid, jsonb) from public, anon, authenticated;

alter table public.document_number_counters drop constraint document_number_counters_type_check;
alter table public.document_number_counters add constraint document_number_counters_type_check
  check (document_type in ('quotation','sales_order','invoice','purchase_order','goods_receipt'));

create table public.goods_receipts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  goods_receipt_number text not null check (goods_receipt_number ~ '^GR-[0-9]{6,}$'),
  purchase_order_id uuid not null,
  received_date date not null check (isfinite(received_date)),
  notes text check (notes is null or (char_length(notes) between 1 and 2000 and public.text_is_trimmed(notes))),
  -- Retain actor identity: receipt history also blocks deletion of its Auth user.
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Internal assembly state, never exposed as an editable draft. Deferred
  -- constraint requires sealing with at least one item before commit.
  sealed boolean not null default false,
  unique (organization_id, id),
  unique (organization_id, id, purchase_order_id),
  unique (organization_id, goods_receipt_number),
  foreign key (organization_id, purchase_order_id)
    references public.purchase_orders(organization_id, id)
);
create index goods_receipts_org_po_idx on public.goods_receipts(organization_id, purchase_order_id);
create index goods_receipts_org_date_idx on public.goods_receipts(organization_id, received_date, id);
create index goods_receipts_created_by_idx on public.goods_receipts(created_by);

create table public.goods_receipt_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  goods_receipt_id uuid not null,
  -- Redundant PO key makes receipt/line/PO consistency declarative.
  purchase_order_id uuid not null,
  purchase_order_item_id uuid not null,
  product_id uuid not null,
  product_name text not null,
  sku text not null,
  description text,
  unit text not null,
  product_type text not null check (product_type in ('inventory','non_inventory')),
  ordered_quantity_snapshot numeric(18,3) not null check (ordered_quantity_snapshot > 0 and ordered_quantity_snapshot <> 'NaN'::numeric),
  received_quantity numeric(18,3) not null check (received_quantity > 0 and received_quantity <> 'NaN'::numeric and received_quantity <= ordered_quantity_snapshot),
  sort_order integer not null check (sort_order between 1 and 100),
  created_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, goods_receipt_id, purchase_order_item_id),
  unique (organization_id, goods_receipt_id, sort_order),
  foreign key (organization_id, goods_receipt_id, purchase_order_id)
    references public.goods_receipts(organization_id, id, purchase_order_id),
  foreign key (organization_id, purchase_order_id, purchase_order_item_id, product_id)
    references public.purchase_order_items(organization_id, purchase_order_id, id, product_id)
);
create index goods_receipt_items_org_source_idx on public.goods_receipt_items(organization_id, purchase_order_item_id);
create index goods_receipt_items_org_product_idx on public.goods_receipt_items(organization_id, product_id);

alter table public.goods_receipts enable row level security;
alter table public.goods_receipt_items enable row level security;
revoke all on public.goods_receipts, public.goods_receipt_items from public, anon, authenticated;
grant select on public.goods_receipts, public.goods_receipt_items to authenticated;
create policy goods_receipts_member_read on public.goods_receipts for select to authenticated
  using (public.is_org_member(organization_id));
create policy goods_receipt_items_member_read on public.goods_receipt_items for select to authenticated
  using (public.is_org_member(organization_id));

-- The shared read path includes services/unknown historical types with an
-- explicit receivable flag. NULL type blocks receiving the entire legacy PO.
create function public.get_purchase_order_receiving_summary(p_organization_id uuid, p_purchase_order_id uuid)
returns table (
  purchase_order_item_id uuid, product_id uuid, product_name text, sku text,
  description text, unit text, product_type text, receivable boolean,
  ordered_quantity text, received_quantity text, remaining_quantity text, sort_order integer
)
language sql stable security invoker set search_path = '' as $$
  select i.id, i.product_id, i.product_name, i.sku, i.description, i.unit, i.product_type,
    coalesce(i.product_type in ('inventory','non_inventory'), false),
    i.quantity::text, coalesce(sum(r.received_quantity), 0)::numeric(18,3)::text,
    (i.quantity - coalesce(sum(r.received_quantity), 0))::numeric(18,3)::text, i.sort_order
  from public.purchase_order_items i
  join public.purchase_orders p on p.organization_id=i.organization_id and p.id=i.purchase_order_id
  left join public.goods_receipt_items r on r.organization_id=i.organization_id and r.purchase_order_item_id=i.id
    and exists(select 1 from public.goods_receipts h where h.organization_id=r.organization_id and h.id=r.goods_receipt_id and h.sealed)
  where i.organization_id=p_organization_id and i.purchase_order_id=p_purchase_order_id
  group by i.id
  order by i.sort_order, i.id;
$$;
revoke all on function public.get_purchase_order_receiving_summary(uuid,uuid) from public, anon;
grant execute on function public.get_purchase_order_receiving_summary(uuid,uuid) to authenticated;

-- A single sealed-receipt summary drives direct-write validation and sealing.
create function public.purchase_order_receiving_status(p_org uuid, p_po uuid)
returns text language sql stable set search_path = '' as $$
  select case
    when coalesce(bool_or(s.receivable and s.received_quantity::numeric>0),false) then
      case when bool_or(s.product_type is null or (s.receivable and s.remaining_quantity::numeric>0))
        then 'partially_received' else 'received' end
    else 'ordered' end
  from public.get_purchase_order_receiving_summary(p_org,p_po) s;
$$;

create function public.purchase_orders_check_receiving_status() returns trigger
language plpgsql set search_path = '' as $$
declare v_expected text;
begin
  v_expected := public.purchase_order_receiving_status(new.organization_id,new.id);
  if (new.status in ('partially_received','received') or v_expected<>'ordered')
     and new.status<>v_expected then
    raise exception 'purchase order receiving status does not match goods receipts' using errcode='GR009';
  end if;
  return new;
end $$;
-- Alphabetically after the specific cancellation guard, before lifecycle rules.
create trigger purchase_orders_check_receiving_status before insert or update on public.purchase_orders
for each row execute function public.purchase_orders_check_receiving_status();

create function public.goods_receipts_validate_header() returns trigger
language plpgsql set search_path = '' as $$
declare p record;
begin
  select * into p from public.purchase_orders where organization_id=new.organization_id and id=new.purchase_order_id for update;
  if not found then raise exception 'purchase order not found' using errcode='23503'; end if;
  if p.status not in ('ordered','partially_received') then
    raise exception 'purchase order no longer receivable' using errcode='55000';
  end if;
  if new.received_date is null or not isfinite(new.received_date) or new.received_date<p.order_date then
    raise exception 'received date must be on or after purchase order date' using errcode='GR007';
  end if;
  if exists(select 1 from public.purchase_order_items where organization_id=p.organization_id and purchase_order_id=p.id and product_type is null) then
    raise exception 'historical product type requires reconciliation' using errcode='GR006';
  end if;
  if new.sealed then raise exception 'goods receipt must be assembled before sealing' using errcode='23514'; end if;
  return new;
end $$;
create trigger goods_receipts_validate_header before insert on public.goods_receipts
for each row execute function public.goods_receipts_validate_header();

create function public.goods_receipts_reconcile_status() returns trigger
language plpgsql set search_path = '' as $$
begin
  if not exists(select 1 from public.goods_receipt_items where goods_receipt_id=new.id) then
    raise exception 'goods receipt must be complete' using errcode='23514';
  end if;
  -- Always write a PO version, even partial -> partial, for concurrent writers.
  update public.purchase_orders set status=public.purchase_order_receiving_status(new.organization_id,new.purchase_order_id)
    where organization_id=new.organization_id and id=new.purchase_order_id;
  return null;
end $$;
create trigger goods_receipts_reconcile_status after update on public.goods_receipts
for each row when (not old.sealed and new.sealed) execute function public.goods_receipts_reconcile_status();

create function public.immutable_purchase_documents_block_truncate() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'immutable purchase documents cannot be truncated' using errcode='55000';
end $$;
create trigger goods_receipts_block_truncate before truncate on public.goods_receipts
for each statement execute function public.immutable_purchase_documents_block_truncate();
create trigger goods_receipt_items_block_truncate before truncate on public.goods_receipt_items
for each statement execute function public.immutable_purchase_documents_block_truncate();
create trigger purchase_orders_block_truncate before truncate on public.purchase_orders
for each statement execute function public.immutable_purchase_documents_block_truncate();
create trigger purchase_order_items_block_truncate before truncate on public.purchase_order_items
for each statement execute function public.immutable_purchase_documents_block_truncate();
revoke all on function public.purchase_order_receiving_status(uuid,uuid), public.purchase_orders_check_receiving_status(),
  public.goods_receipts_validate_header(), public.goods_receipts_reconcile_status(),
  public.immutable_purchase_documents_block_truncate() from public, anon, authenticated;

create function public.goods_receipts_enforce_immutable() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op='UPDATE' and not old.sealed and new.sealed
     and (to_jsonb(new)-'sealed') is not distinct from (to_jsonb(old)-'sealed') then
    return new;
  end if;
  raise exception 'goods receipt is immutable' using errcode='55000';
end $$;
create trigger goods_receipts_immutable before update or delete on public.goods_receipts
for each row execute function public.goods_receipts_enforce_immutable();

-- Also protects privileged inserts: lock the common PO, require unsealed
-- receipt, derive snapshots, reject services/foreign lines and over-receiving.
create function public.goods_receipt_items_enforce_rules() returns trigger
language plpgsql set search_path = '' as $$
declare h record; p record; i record; v_received numeric;
begin
  if tg_op <> 'INSERT' then
    raise exception 'goods receipt is immutable' using errcode='55000';
  end if;
  select * into h from public.goods_receipts where id=new.goods_receipt_id and organization_id=new.organization_id;
  if not found then raise exception 'receipt not found' using errcode='23503'; end if;
  select * into p from public.purchase_orders where id=h.purchase_order_id and organization_id=h.organization_id for update;
  -- Re-read after locking to cover concurrent sealing by trusted tooling.
  select * into h from public.goods_receipts where id=new.goods_receipt_id and organization_id=new.organization_id for update;
  if h.sealed then raise exception 'goods receipt is immutable' using errcode='55000'; end if;
  if p.status not in ('ordered','partially_received') then
    raise exception 'purchase order no longer receivable' using errcode='55000';
  end if;
  select * into i from public.purchase_order_items
    where id=new.purchase_order_item_id and organization_id=h.organization_id and purchase_order_id=h.purchase_order_id;
  if not found then raise exception 'receipt line not found in purchase order' using errcode='GR001'; end if;
  if i.product_type is null then raise exception 'historical product type requires reconciliation' using errcode='GR006'; end if;
  if i.product_type='service' then raise exception 'service cannot be received' using errcode='GR002'; end if;
  select coalesce(sum(received_quantity),0) into v_received from public.goods_receipt_items
    where organization_id=h.organization_id and purchase_order_item_id=i.id;
  if v_received >= i.quantity then raise exception 'quantity already fully received' using errcode='GR004'; end if;
  if new.received_quantity > i.quantity-v_received then raise exception 'over receiving' using errcode='GR003'; end if;
  new.purchase_order_id := h.purchase_order_id;
  new.product_id := i.product_id;
  new.product_name := i.product_name;
  new.sku := i.sku;
  new.description := i.description;
  new.unit := i.unit;
  new.product_type := i.product_type;
  new.ordered_quantity_snapshot := i.quantity;
  return new;
end $$;
create trigger goods_receipt_items_rules before insert or update or delete on public.goods_receipt_items
for each row execute function public.goods_receipt_items_enforce_rules();

create function public.goods_receipts_require_complete() returns trigger
language plpgsql set search_path = '' as $$
begin
  if not exists(select 1 from public.goods_receipts h where h.id=new.id and h.sealed
    and exists(select 1 from public.goods_receipt_items i where i.goods_receipt_id=h.id)) then
    raise exception 'goods receipt must be complete' using errcode='23514';
  end if;
  return null;
end $$;
create constraint trigger goods_receipts_complete after insert or update on public.goods_receipts
  deferrable initially deferred for each row execute function public.goods_receipts_require_complete();

create function public.purchase_orders_block_received_cancel() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.status='cancelled' and exists(select 1 from public.goods_receipts r
    where r.organization_id=old.organization_id and r.purchase_order_id=old.id) then
    raise exception 'purchase order has goods receipts and cannot be cancelled' using errcode='55000';
  end if;
  return new;
end $$;
create trigger purchase_orders_block_received_cancel before update on public.purchase_orders
for each row execute function public.purchase_orders_block_received_cancel();

create function public.create_goods_receipt(p_purchase_order_id uuid, p_received_date date, p_notes text, p_items jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := (select auth.uid()); v_org uuid; v_status text; v_notes text;
  v_id uuid; v_seq bigint; v_item jsonb; v_line uuid; v_used uuid[] := '{}';
  v_quantity numeric; v_index integer := 0;
begin
  if v_user is null then raise exception 'not authenticated' using errcode='42501'; end if;
  -- Authorization BEFORE locking; missing/foreign/disabled are indistinguishable.
  select p.organization_id into v_org from public.purchase_orders p
  where p.id=p_purchase_order_id and public.has_org_role(p.organization_id,array['owner','manager','employee']);
  if not found then raise exception 'purchase order not found' using errcode='P0002'; end if;
  if p_received_date is null or not isfinite(p_received_date) then
    raise exception 'invalid received date' using errcode='GR007';
  end if;
  v_notes := nullif(public.trim_whitespace(coalesce(p_notes,'')),'');
  if char_length(v_notes)>2000 then raise exception 'notes are too long' using errcode='22023'; end if;
  if p_items is null or jsonb_typeof(p_items)<>'array' then
    raise exception 'items must be an array' using errcode='22023';
  end if;
  if jsonb_array_length(p_items) not between 1 and 100 then
    raise exception 'receipt requires 1 to 100 items' using errcode='22023';
  end if;
  for v_item in select value from jsonb_array_elements(p_items) loop
    if jsonb_typeof(v_item)<>'object' or jsonb_typeof(v_item->'purchase_order_item_id') is distinct from 'string'
      or coalesce(v_item->>'purchase_order_item_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'receipt line not found in purchase order' using errcode='GR001';
    end if;
    v_line := (v_item->>'purchase_order_item_id')::uuid;
    if v_line=any(v_used) then raise exception 'duplicate receipt line' using errcode='22023'; end if;
    v_used := array_append(v_used,v_line);
    v_quantity := public.quotation_parse_decimal(v_item->'received_quantity',15,3);
    if v_quantity is null or v_quantity<=0 then raise exception 'invalid received quantity' using errcode='GR008'; end if;
  end loop;
  select p.status into v_status from public.purchase_orders p
  where p.id=p_purchase_order_id and p.organization_id=v_org
    and public.has_org_role(p.organization_id,array['owner','manager','employee']) for update;
  if not found then raise exception 'purchase order not found' using errcode='P0002'; end if;
  if v_status not in ('ordered','partially_received') then
    raise exception 'purchase order no longer receivable' using errcode='55000';
  end if;
  if exists(select 1 from public.purchase_order_items where purchase_order_id=p_purchase_order_id and product_type is null) then
    raise exception 'historical product type requires reconciliation' using errcode='GR006';
  end if;
  v_seq := public.next_document_number(v_org,'goods_receipt');
  insert into public.goods_receipts(organization_id,goods_receipt_number,purchase_order_id,received_date,notes,created_by)
  values(v_org,'GR-'||lpad(v_seq::text,greatest(6,length(v_seq::text)),'0'),p_purchase_order_id,p_received_date,v_notes,v_user)
  returning id into v_id;
  for v_item in select value from jsonb_array_elements(p_items) loop
    v_index := v_index+1;
    v_line := (v_item->>'purchase_order_item_id')::uuid;
    v_quantity := public.quotation_parse_decimal(v_item->'received_quantity',15,3);
    -- Trigger resolves and snapshots the authorized PO line, ignoring forgeries.
    insert into public.goods_receipt_items(organization_id,goods_receipt_id,purchase_order_item_id,received_quantity,sort_order)
    values(v_org,v_id,v_line,v_quantity,v_index);
  end loop;
  update public.goods_receipts set sealed=true where id=v_id;
  return v_id;
end $$;

create function public.get_goods_receipt(p_organization_id uuid, p_goods_receipt_id uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'id',h.id,'organization_id',h.organization_id,'goods_receipt_number',h.goods_receipt_number,
    'purchase_order_id',h.purchase_order_id,'purchase_order_number',p.purchase_order_number,
    'received_date',h.received_date,'notes',h.notes,'created_by',h.created_by,
    'created_at',h.created_at,'updated_at',h.updated_at,
    'items',coalesce((select jsonb_agg(jsonb_build_object(
      'id',i.id,'purchase_order_item_id',i.purchase_order_item_id,'product_id',i.product_id,
      'product_name',i.product_name,'sku',i.sku,'description',i.description,'unit',i.unit,'product_type',i.product_type,
      'ordered_quantity_snapshot',i.ordered_quantity_snapshot::text,'received_quantity',i.received_quantity::text,
      'sort_order',i.sort_order,'created_at',i.created_at
    ) order by i.sort_order,i.id) from public.goods_receipt_items i
      where i.organization_id=h.organization_id and i.goods_receipt_id=h.id),'[]'::jsonb)
  ) from public.goods_receipts h join public.purchase_orders p on p.organization_id=h.organization_id and p.id=h.purchase_order_id
  where h.organization_id=p_organization_id and h.id=p_goods_receipt_id and h.sealed;
$$;
revoke all on function public.create_goods_receipt(uuid,date,text,jsonb) from public, anon;
grant execute on function public.create_goods_receipt(uuid,date,text,jsonb) to authenticated;
revoke all on function public.get_goods_receipt(uuid,uuid) from public, anon;
grant execute on function public.get_goods_receipt(uuid,uuid) to authenticated;
revoke all on function public.goods_receipts_enforce_immutable(), public.goods_receipt_items_enforce_rules(),
  public.goods_receipts_require_complete(), public.purchase_orders_block_received_cancel() from public, anon, authenticated;
