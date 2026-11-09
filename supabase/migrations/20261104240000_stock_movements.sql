-- =============================================================================
-- Inventory Part 1: immutable stock movement ledger (DECISIONS 033).
--
-- Apply after 20261104230000_goods_receipt_received_by_snapshot.sql. Earlier
-- migrations are unchanged. Apply this whole file as one script: its function
-- bodies are $$-quoted and only parse when the file is executed intact.
--
--   * public.stock_movements is the ONLY source of truth for stock. Current
--     stock = SUM(quantity_delta) per product. No products.quantity / stock /
--     balance column exists or is added; products rows are never written here.
--   * Signed quantity_delta numeric(18,3): stock-in > 0, future stock-out < 0.
--     The only movement/source type implemented now is 'goods_receipt'
--     (positive). Future types extend the CHECK lists in a new migration.
--   * A sealed Goods Receipt line whose immutable product_type snapshot is
--     'inventory' produces exactly one movement (+received_quantity).
--     'non_inventory' lines never move stock; services are never receivable.
--     The CURRENT products.product_type is never consulted for this.
--   * Generation happens in the database when a receipt is sealed (the single
--     false -> true transition), in the same transaction as the receipt and
--     the PO status reconciliation: any failure rolls everything back. This
--     covers create_goods_receipt() and privileged/trusted tooling alike.
--   * Idempotency: UNIQUE (organization_id, source_type, source_line_id). One
--     receipt line can never move stock twice, whatever runs twice.
--   * Snapshots: product name, SKU and unit are copied from the receipt line
--     (itself a PO snapshot), never from the live product.
--   * occurred_on (date) = the receipt's received_date (business date);
--     created_at = database insertion time. Current stock does NOT filter by
--     occurred_on: recording a receipt acknowledges possession, so future-dated
--     receipts count immediately.
--   * Immutable: no UPDATE / DELETE / TRUNCATE (also for privileged writers);
--     corrections will be compensating movements in a future phase. API roles
--     have SELECT only, under active-membership RLS; no write grants and no
--     generic create-movement RPC.
--   * Product type guard: immutable once the product has a movement (ST002);
--     cannot leave inventory while on an open inventory PO line (ST003).
--     Stock posting rejects a product that is no longer inventory (ST004).
--     Ordering a PO (draft -> ordered) rejects inventory-snapshot lines whose
--     product is no longer inventory (ST006).
--     All other product fields stay editable.
--   * No aggregate ">= 0" constraint: Goods Receipts only add stock. Negative
--     stock prevention belongs to future stock-out operations, which must
--     check availability transactionally.
--   * Backfill: every existing sealed inventory receipt line receives exactly
--     one movement, then the migration verifies the ledger against the
--     receipts and aborts on any mismatch.
-- =============================================================================

-- Composite target so a movement can only reference a receipt line together
-- with its own organization, receipt and product.
alter table public.goods_receipt_items
  add constraint goods_receipt_items_stock_source_key
  unique (organization_id, goods_receipt_id, id, product_id);

create table public.stock_movements (
  id                     uuid primary key default gen_random_uuid(),
  organization_id        uuid not null references public.organizations (id),
  product_id             uuid not null,
  movement_type          text not null,
  quantity_delta         numeric(18, 3) not null,
  source_type            text not null,
  source_id              uuid not null,
  source_line_id         uuid not null,
  -- Typed copies of the generic source keys, used only by the tenant-safe
  -- foreign key below. NULL for other source types (MATCH SIMPLE: unchecked).
  goods_receipt_id       uuid generated always as
    (case when source_type = 'goods_receipt' then source_id end) stored,
  goods_receipt_item_id  uuid generated always as
    (case when source_type = 'goods_receipt' then source_line_id end) stored,
  product_name_snapshot  text not null,
  sku_snapshot           text not null,
  unit_snapshot          text not null,
  occurred_on            date not null,
  created_at             timestamptz not null default now(),

  constraint stock_movements_movement_type_check
    check (movement_type in ('goods_receipt')),
  constraint stock_movements_source_type_check
    check (source_type in ('goods_receipt')),
  -- Allowed (movement type, source type) pairs.
  constraint stock_movements_type_source_check
    check ((movement_type, source_type) in (('goods_receipt', 'goods_receipt'))),
  -- numeric accepts NaN, which compares greater than every number.
  constraint stock_movements_quantity_check
    check (quantity_delta <> 0 and quantity_delta <> 'NaN'::numeric),
  -- Inbound movement types are strictly positive.
  constraint stock_movements_direction_check
    check (movement_type not in ('goods_receipt') or quantity_delta > 0),
  constraint stock_movements_snapshot_check
    check (char_length(product_name_snapshot) > 0
       and char_length(sku_snapshot) > 0
       and char_length(unit_snapshot) > 0),
  constraint stock_movements_occurred_on_check
    check (isfinite(occurred_on)),
  -- Idempotency: one movement per source line, whatever runs twice.
  constraint stock_movements_source_line_key
    unique (organization_id, source_type, source_line_id),
  constraint stock_movements_product_fkey
    foreign key (organization_id, product_id)
    references public.products (organization_id, id),
  constraint stock_movements_goods_receipt_item_fkey
    foreign key (organization_id, goods_receipt_id, goods_receipt_item_id, product_id)
    references public.goods_receipt_items (organization_id, goods_receipt_id, id, product_id)
);

comment on table public.stock_movements is
  'Immutable stock ledger. Current stock = SUM(quantity_delta) per product. Written only by trusted database processing.';
comment on column public.stock_movements.occurred_on is
  'Business date of the movement (goods receipt: received_date). Not used to filter current stock.';

-- History per product and per organization (newest first), current-stock
-- aggregation (leftmost columns), and source lookups.
create index stock_movements_org_product_idx
  on public.stock_movements (organization_id, product_id, occurred_on desc, created_at desc, id desc);
create index stock_movements_org_occurred_idx
  on public.stock_movements (organization_id, occurred_on desc, created_at desc, id desc);
create index stock_movements_org_source_idx
  on public.stock_movements (organization_id, source_type, source_id);

alter table public.stock_movements enable row level security;
revoke all on table public.stock_movements from public, anon, authenticated, service_role;
grant select on table public.stock_movements to authenticated, service_role;

create policy stock_movements_member_read on public.stock_movements
  for select to authenticated
  using (public.is_org_member(organization_id));

-- -----------------------------------------------------------------------------
-- Every insert path (trusted generation, backfill, privileged tooling): the
-- movement is derived from its sealed source line in the same organization.
-- Supplied product, quantity, type, snapshots and dates are overwritten.
-- -----------------------------------------------------------------------------
create function public.stock_movements_derive_from_source() returns trigger
language plpgsql set search_path = '' as $$
declare r record; v_current_type text;
begin
  if new.source_type is distinct from 'goods_receipt' then
    raise exception 'unsupported stock movement source' using errcode = '22023';
  end if;
  select i.goods_receipt_id, i.product_id, i.product_name, i.sku, i.unit, i.product_type,
         i.received_quantity, h.received_date, h.sealed
    into r
    from public.goods_receipt_items i
    join public.goods_receipts h on h.organization_id = i.organization_id and h.id = i.goods_receipt_id
   where i.organization_id = new.organization_id and i.id = new.source_line_id;
  if not found then
    raise exception 'stock movement source not found' using errcode = '23503';
  end if;
  if not r.sealed then
    raise exception 'goods receipt must be sealed before it moves stock' using errcode = '55000';
  end if;
  if r.product_type is distinct from 'inventory' then
    raise exception 'only inventory goods receipt lines move stock' using errcode = 'ST001';
  end if;
  -- Compatibility check (the receipt snapshot still decides eligibility):
  -- stock is never posted under a product that is no longer inventory. The
  -- whole receipt rolls back instead; nothing is skipped or converted.
  -- FOR SHARE conflicts with a product UPDATE, so this and a concurrent type
  -- change serialize: if the change holds the row, this waits and re-reads
  -- the committed type; if this holds it, the change waits and then sees
  -- the movement (see products_guard_type_change).
  select p.product_type into v_current_type
    from public.products p
   where p.organization_id = new.organization_id and p.id = r.product_id
   for share;
  if v_current_type is distinct from 'inventory' then
    raise exception 'product is no longer classified as inventory' using errcode = 'ST004';
  end if;
  new.movement_type := 'goods_receipt';
  new.source_id := r.goods_receipt_id;
  new.product_id := r.product_id;
  new.quantity_delta := r.received_quantity;
  new.product_name_snapshot := r.product_name;
  new.sku_snapshot := r.sku;
  new.unit_snapshot := r.unit;
  new.occurred_on := r.received_date;
  new.created_at := now();
  return new;
end $$;

create trigger stock_movements_derive_from_source before insert on public.stock_movements
for each row execute function public.stock_movements_derive_from_source();

-- Ledger rows are never edited or removed, including by privileged writers.
create function public.stock_movements_block_changes() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'stock movements are immutable' using errcode = '55000';
end $$;

create trigger stock_movements_immutable before update or delete on public.stock_movements
for each row execute function public.stock_movements_block_changes();
create trigger stock_movements_block_truncate before truncate on public.stock_movements
for each statement execute function public.stock_movements_block_changes();

-- -----------------------------------------------------------------------------
-- Generation for one sealed receipt: one movement per inventory line, by the
-- receipt line's own snapshot type. ON CONFLICT makes repeated calls (and the
-- backfill below) no-ops for lines that already moved stock.
-- -----------------------------------------------------------------------------
create function public.post_goods_receipt_stock_movements(p_organization_id uuid, p_goods_receipt_id uuid)
returns integer language plpgsql set search_path = '' as $$
declare v_count integer;
begin
  insert into public.stock_movements (
    organization_id, product_id, movement_type, quantity_delta,
    source_type, source_id, source_line_id,
    product_name_snapshot, sku_snapshot, unit_snapshot, occurred_on
  )
  select i.organization_id, i.product_id, 'goods_receipt', i.received_quantity,
         'goods_receipt', i.goods_receipt_id, i.id,
         i.product_name, i.sku, i.unit, h.received_date
    from public.goods_receipt_items i
    join public.goods_receipts h on h.organization_id = i.organization_id and h.id = i.goods_receipt_id
   where i.organization_id = p_organization_id
     and i.goods_receipt_id = p_goods_receipt_id
     and h.sealed
     and i.product_type = 'inventory'
   order by i.sort_order, i.id
  on conflict (organization_id, source_type, source_line_id) do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- Fires once per receipt (sealing is the only permitted header update, and
-- only false -> true). Alphabetically before goods_receipts_reconcile_status,
-- so stock is posted, then the PO status reconciled, in one transaction.
-- SECURITY DEFINER: whoever may seal a receipt never needs ledger grants.
create function public.goods_receipts_post_stock_movements() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform public.post_goods_receipt_stock_movements(new.organization_id, new.id);
  return null;
end $$;

create trigger goods_receipts_post_stock_movements after update on public.goods_receipts
for each row when (not old.sealed and new.sealed)
execute function public.goods_receipts_post_stock_movements();

-- -----------------------------------------------------------------------------
-- Product type guard (DECISIONS 034, 035). Applies to every writer: API
-- column updates (the product edit form), privileged tooling.
--
--   Rule B  a product with any stock movement can never change type (ST002).
--   Rule A  while the product is on an inventory-snapshot line of an
--           ordered / partially_received PO, it cannot change AWAY from
--           inventory (ST003). Draft and cancelled (and received) POs do not
--           lock. Changing TO inventory is allowed, which repairs a product
--           retyped while its PO was still a draft.
--   Isolation  only READ COMMITTED (the Supabase API and SQL Editor default,
--           ST005). Each check below then reads with a fresh snapshot taken
--           after this UPDATE obtained the product row lock, so it sees a
--           receipt that held the row (FOR SHARE in stock posting) and
--           committed. A REPEATABLE READ / SERIALIZABLE snapshot could predate
--           that commit, and a lock-only conflict raises no error there.
--
-- Lock order: receiving locks the PO row, then the product row (FOR SHARE,
-- stock posting). This trigger runs after the UPDATE locked only the product
-- row and takes no further locks (plain reads), so the two paths cannot
-- deadlock. Read-only: no recursion. SECURITY DEFINER so the checks never
-- depend on the updater's RLS view of the ledger or purchase orders.
-- -----------------------------------------------------------------------------
create function public.products_guard_type_change() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'product type changes require read committed isolation' using errcode = 'ST005';
  end if;
  if exists (select 1 from public.stock_movements m
              where m.organization_id = old.organization_id and m.product_id = old.id) then
    raise exception 'product type cannot change after stock movements exist' using errcode = 'ST002';
  end if;
  if new.product_type <> 'inventory' and exists (
       select 1
         from public.purchase_order_items i
         join public.purchase_orders po on po.organization_id = i.organization_id and po.id = i.purchase_order_id
        where i.organization_id = old.organization_id and i.product_id = old.id
          and i.product_type = 'inventory'
          and po.status in ('ordered', 'partially_received')) then
    raise exception 'product is on an open inventory purchase order; its type must stay inventory' using errcode = 'ST003';
  end if;
  return new;
end $$;

create trigger products_guard_type_change before update of product_type on public.products
for each row when (old.product_type is distinct from new.product_type)
execute function public.products_guard_type_change();

-- -----------------------------------------------------------------------------
-- Ordering check (DECISIONS 036). On draft -> ordered, every line whose
-- product_type SNAPSHOT is 'inventory' must still point to a product whose
-- CURRENT type is 'inventory', otherwise the order is rejected (ST006) and
-- stays a draft. Snapshots are never rewritten; non_inventory and service
-- lines are not checked. A product retyped while the PO was a draft must be
-- restored first; the PO lines need no change.
--
-- Covers the status RPC and privileged updates (API roles have no PO write
-- grant). Runs after purchase_orders_enforce_rules (name order), so invalid
-- transitions keep their existing error.
--
-- Products are read FOR SHARE (in id order) while the UPDATE already holds
-- the PO row: the same PO -> product order as receiving and stock posting.
-- A concurrent type change holds only the product row and never locks POs,
-- so there is no inversion. If the type change holds the row, this waits
-- and then reads the committed type; if this holds it, the type change
-- waits and then sees the ordered PO (ST003). Under REPEATABLE READ /
-- SERIALIZABLE, locking a row changed after the snapshot raises 40001.
-- -----------------------------------------------------------------------------
create function public.purchase_orders_validate_inventory_types() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_line record; v_lines integer[] := '{}';
begin
  -- Lock EVERY inventory-snapshot line's product, then test the type of the
  -- locked row. A type filter inside the locking query would be evaluated on
  -- the old snapshot first: a row being retyped concurrently would be
  -- filtered out before it is locked and never re-read after the wait.
  for v_line in
    select i.sort_order, p.product_type
      from public.purchase_order_items i
      join public.products p on p.organization_id = i.organization_id and p.id = i.product_id
     where i.organization_id = new.organization_id
       and i.purchase_order_id = new.id
       and i.product_type = 'inventory'
     order by p.id
       for share of p
  loop
    if v_line.product_type <> 'inventory' then
      v_lines := v_lines || v_line.sort_order;
    end if;
  end loop;
  if cardinality(v_lines) > 0 then
    raise exception 'inventory products changed type since the purchase order lines were recorded'
      using errcode = 'ST006',
            detail = 'lines: ' || array_to_string(array(select unnest(v_lines) order by 1), ',');
  end if;
  return new;
end $$;

create trigger purchase_orders_validate_inventory_types before update of status on public.purchase_orders
for each row when (old.status = 'draft' and new.status = 'ordered')
execute function public.purchase_orders_validate_inventory_types();

revoke all on function public.purchase_orders_validate_inventory_types() from public, anon, authenticated, service_role;

revoke all on function public.stock_movements_derive_from_source(),
  public.stock_movements_block_changes(),
  public.post_goods_receipt_stock_movements(uuid, uuid),
  public.goods_receipts_post_stock_movements(),
  public.products_guard_type_change()
  from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Backfill existing sealed receipts. The sealing trigger already exists, so a
-- receipt sealed concurrently is handled by the trigger; receipts sealed
-- before this point are committed and visible here. The unique key plus
-- ON CONFLICT DO NOTHING means no line can be posted twice.
-- -----------------------------------------------------------------------------
do $$
declare v_receipt record; v_missing bigint; v_extra bigint; v_mismatch bigint;
begin
  for v_receipt in
    select h.organization_id, h.id from public.goods_receipts h
     where h.sealed order by h.organization_id, h.created_at, h.id
  loop
    perform public.post_goods_receipt_stock_movements(v_receipt.organization_id, v_receipt.id);
  end loop;

  -- Verify: every sealed inventory line has exactly one movement that matches
  -- it, and nothing else is in the ledger.
  select count(*) into v_missing
    from public.goods_receipt_items i
    join public.goods_receipts h on h.organization_id = i.organization_id and h.id = i.goods_receipt_id
   where h.sealed and i.product_type = 'inventory'
     and not exists (select 1 from public.stock_movements m
                      where m.organization_id = i.organization_id and m.source_type = 'goods_receipt'
                        and m.source_line_id = i.id);
  select count(*) into v_extra
    from public.stock_movements m
   where not exists (select 1 from public.goods_receipt_items i
                       join public.goods_receipts h on h.organization_id = i.organization_id and h.id = i.goods_receipt_id
                      where m.source_type = 'goods_receipt' and i.organization_id = m.organization_id
                        and i.id = m.source_line_id and h.sealed and i.product_type = 'inventory');
  select count(*) into v_mismatch
    from public.stock_movements m
    join public.goods_receipt_items i on i.organization_id = m.organization_id and i.id = m.source_line_id
    join public.goods_receipts h on h.organization_id = i.organization_id and h.id = i.goods_receipt_id
   where m.source_type = 'goods_receipt'
     and (m.quantity_delta <> i.received_quantity or m.product_id <> i.product_id
       or m.source_id <> i.goods_receipt_id or m.occurred_on <> h.received_date
       or m.product_name_snapshot <> i.product_name or m.sku_snapshot <> i.sku
       or m.unit_snapshot <> i.unit);
  if v_missing <> 0 or v_extra <> 0 or v_mismatch <> 0 then
    raise exception 'stock movement backfill verification failed: % missing, % unexpected, % mismatched',
      v_missing, v_extra, v_mismatch using errcode = '23514';
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- list_current_stock: current quantity per stock-bearing product.
--
--   * SECURITY INVOKER: products and stock_movements RLS apply (active
--     members only); p_organization_id is an extra filter that never widens.
--   * Rows: every product whose CURRENT type is 'inventory' (active and
--     inactive, zero when it has no movements), plus any product that has
--     movements but a non-inventory current type (legacy or
--     privileged-invalid data; the guards prevent it otherwise), so ledger
--     quantity is never hidden. product_type is returned so a UI can flag it.
--   * Display values (name, SKU, unit, status) are CURRENT product master
--     data; the balance is grouped by the stable product_id. Movement
--     history keeps the snapshots.
--   * current_quantity = SUM(quantity_delta) as exact text (scale 3), no
--     occurred_on filter.
--   * p_search: case-insensitive substring of name or SKU; literal LIKE
--     wildcards; shared Unicode trim; capped at 100 code points.
--   * p_product_id: optional single product. p_limit 1..100 (NULL: 25),
--     p_offset >= 0. Order: name, then id. total_count before paging.
-- -----------------------------------------------------------------------------
create function public.list_current_stock(
  p_organization_id  uuid,
  p_search           text default null,
  p_product_id       uuid default null,
  p_limit            integer default 25,
  p_offset           integer default 0
)
returns table (
  product_id        uuid,
  product_name      text,
  sku               text,
  unit              text,
  product_type      text,
  product_status    text,
  current_quantity  text,
  total_count       bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  with term as (
    select nullif(public.trim_whitespace(left(coalesce(p_search, ''), 100)), '') as value
  ),
  patterns as (
    select
      '%' || replace(replace(replace(t.value, '\', '\\'), '%', '\%'), '_', '\_') || '%'
        as text_pattern
    from term t
  ),
  balances as (
    select m.product_id, sum(m.quantity_delta) as quantity
    from public.stock_movements m
    where m.organization_id = p_organization_id
      and (p_product_id is null or m.product_id = p_product_id)
    group by m.product_id
  )
  select
    p.id, p.name, p.sku, p.unit, p.product_type, p.status,
    coalesce(b.quantity, 0.000::numeric(18, 3))::text,
    count(*) over ()
  from public.products p
  left join balances b on b.product_id = p.id
  cross join patterns pt
  where p.organization_id = p_organization_id
    and (p.product_type = 'inventory' or b.product_id is not null)
    and (p_product_id is null or p.id = p_product_id)
    and (
      pt.text_pattern is null
      or p.name ilike pt.text_pattern
      or p.sku ilike pt.text_pattern
    )
  order by p.name, p.id
  limit least(greatest(coalesce(p_limit, 25), 1), 100)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

revoke all on function public.list_current_stock(uuid, text, uuid, integer, integer) from public, anon;
grant execute on function public.list_current_stock(uuid, text, uuid, integer, integer) to authenticated;

-- -----------------------------------------------------------------------------
-- list_stock_movements: ledger history, newest first.
--
--   * SECURITY INVOKER, RLS + explicit organization filter (as above).
--   * Product display values are the movement SNAPSHOTS.
--   * p_product_id / p_source_type: optional exact filters (an unknown or
--     other-tenant value matches nothing).
--   * source_document_number: the GR number for goods receipt sources, from
--     the same query (no N+1).
--   * Order: occurred_on desc, created_at desc, id desc. p_limit 1..100
--     (NULL: 25), p_offset >= 0. total_count before paging.
-- -----------------------------------------------------------------------------
create function public.list_stock_movements(
  p_organization_id  uuid,
  p_product_id       uuid default null,
  p_source_type      text default null,
  p_limit            integer default 25,
  p_offset           integer default 0
)
returns table (
  movement_id             uuid,
  product_id              uuid,
  product_name_snapshot   text,
  sku_snapshot            text,
  unit_snapshot           text,
  movement_type           text,
  quantity_delta          text,
  source_type             text,
  source_id               uuid,
  source_line_id          uuid,
  source_document_number  text,
  occurred_on             date,
  created_at              timestamptz,
  total_count             bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    m.id, m.product_id, m.product_name_snapshot, m.sku_snapshot, m.unit_snapshot,
    m.movement_type, m.quantity_delta::text,
    m.source_type, m.source_id, m.source_line_id,
    h.goods_receipt_number,
    m.occurred_on, m.created_at,
    count(*) over ()
  from public.stock_movements m
  left join public.goods_receipts h
    on m.source_type = 'goods_receipt'
   and h.organization_id = m.organization_id
   and h.id = m.source_id
  where m.organization_id = p_organization_id
    and (p_product_id is null or m.product_id = p_product_id)
    and (p_source_type is null or m.source_type = p_source_type)
  order by m.occurred_on desc, m.created_at desc, m.id desc
  limit least(greatest(coalesce(p_limit, 25), 1), 100)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

revoke all on function public.list_stock_movements(uuid, uuid, text, integer, integer) from public, anon;
grant execute on function public.list_stock_movements(uuid, uuid, text, integer, integer) to authenticated;
