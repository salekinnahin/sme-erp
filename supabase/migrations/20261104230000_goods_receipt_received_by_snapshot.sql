-- =============================================================================
-- Goods receipt "Received By" name snapshot (DECISIONS 032).
--
-- Apply after 20261104220000_list_goods_receipts.sql. Earlier migrations are
-- unchanged. No quantity, status, locking, sealing, cancellation, service-line
-- or permission rule changes.
--
--   * goods_receipts.received_by_name: the recorder's display name at the time
--     of receiving. Derived in the database from profiles.full_name of
--     created_by (the authenticated recorder, auth.uid() in
--     create_goods_receipt()). Any supplied value is overwritten, also for
--     privileged inserts; the browser never sends it.
--   * Snapshot, not a live join: later profile changes, membership disabling
--     or removal do not change existing receipts. The existing immutability
--     trigger compares the whole row, so the column is immutable after
--     insert, even for privileged writers. API roles have no write grants.
--   * Staged/nullable: profiles.full_name is optional (users created without
--     signup metadata have none). Such receipts store NULL ("Name not
--     recorded" in the UI) rather than an invented name or the email.
--     Existing receipts are NOT backfilled: a current profile name is not
--     evidence of the name at receiving time, and backfilling would require
--     disabling the immutability trigger.
--   * Privacy: no profile policy or grant changes. Members still read only
--     their own profile; they see only the name stored on each receipt.
--   * Reads: get_goods_receipt() and list_goods_receipts() return the stored
--     snapshot. list_goods_receipts() drops the mixed-unit total quantity and
--     the raw creator ID (display uses the snapshot and item count). Its
--     return type changes, so it is dropped and recreated with the same
--     invoker/RLS/search/paging/order behavior and grants.
-- =============================================================================

alter table public.goods_receipts
  add column received_by_name text
  check (received_by_name is null
    or (char_length(received_by_name) between 1 and 200 and public.text_is_trimmed(received_by_name)));

comment on column public.goods_receipts.received_by_name is
  'Recorder display name snapshot from profiles.full_name at creation. Immutable; NULL when no trusted name existed.';

-- Runs for every insert path (RPC and privileged tooling) and ignores any
-- supplied value. SECURITY INVOKER: the definer RPC (and privileged tools)
-- can read profiles; API roles cannot insert receipts at all.
-- Scalar subquery: profiles.id is the primary key, so at most one row; no
-- profile or no usable name yields NULL (never an email fallback).
-- Apply this whole file as one script; running only part of it (for example
-- a highlighted selection in the SQL Editor) executes the body outside its
-- $$ quotes and fails with: syntax error at or near "select".
create function public.goods_receipts_snapshot_received_by() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.received_by_name := (
    select nullif(public.trim_whitespace(left(p.full_name, 200)), '')
    from public.profiles p
    where p.id = new.created_by
  );
  return new;
end $$;

-- Alphabetically before goods_receipts_validate_header; independent of it.
create trigger goods_receipts_snapshot_received_by before insert on public.goods_receipts
for each row execute function public.goods_receipts_snapshot_received_by();

revoke all on function public.goods_receipts_snapshot_received_by() from public, anon, authenticated;

-- Same document as 20261104200000, plus the stored received_by_name.
create or replace function public.get_goods_receipt(p_organization_id uuid, p_goods_receipt_id uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'id',h.id,'organization_id',h.organization_id,'goods_receipt_number',h.goods_receipt_number,
    'purchase_order_id',h.purchase_order_id,'purchase_order_number',p.purchase_order_number,
    'received_date',h.received_date,'notes',h.notes,'created_by',h.created_by,
    'received_by_name',h.received_by_name,
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
revoke all on function public.get_goods_receipt(uuid,uuid) from public, anon;
grant execute on function public.get_goods_receipt(uuid,uuid) to authenticated;

drop function public.list_goods_receipts(uuid, text, uuid, integer, integer);

-- Same filters, search (GR number, PO number, vendor snapshot only), paging
-- and order as 20261104220000. Item count = number of receipt lines.
create function public.list_goods_receipts(
  p_organization_id    uuid,
  p_search             text default null,
  p_purchase_order_id  uuid default null,
  p_limit              integer default 25,
  p_offset             integer default 0
)
returns table (
  id                     uuid,
  goods_receipt_number   text,
  purchase_order_id      uuid,
  purchase_order_number  text,
  vendor_name            text,
  vendor_company_name    text,
  received_date          date,
  item_count             integer,
  received_by_name       text,
  created_at             timestamptz,
  total_count            bigint
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
  page as (
    select
      h.id, h.goods_receipt_number, h.purchase_order_id, po.purchase_order_number,
      po.vendor_name, po.vendor_company_name, h.received_date, h.received_by_name,
      h.created_at, h.organization_id,
      count(*) over () as total_count
    from public.goods_receipts h
    join public.purchase_orders po
      on po.organization_id = h.organization_id and po.id = h.purchase_order_id
    cross join patterns pt
    where h.organization_id = p_organization_id
      and h.sealed
      and (p_purchase_order_id is null or h.purchase_order_id = p_purchase_order_id)
      and (
        pt.text_pattern is null
        or h.goods_receipt_number ilike pt.text_pattern
        or po.purchase_order_number ilike pt.text_pattern
        or po.vendor_name ilike pt.text_pattern
        or po.vendor_company_name ilike pt.text_pattern
      )
    order by h.received_date desc, h.created_at desc, h.id desc
    limit least(greatest(coalesce(p_limit, 25), 1), 100)
    offset greatest(coalesce(p_offset, 0), 0)
  )
  select
    pg.id, pg.goods_receipt_number, pg.purchase_order_id, pg.purchase_order_number,
    pg.vendor_name, pg.vendor_company_name, pg.received_date,
    (select count(*)::integer from public.goods_receipt_items i
      where i.organization_id = pg.organization_id and i.goods_receipt_id = pg.id),
    pg.received_by_name, pg.created_at, pg.total_count
  from page pg
  order by pg.received_date desc, pg.created_at desc, pg.id desc;
$$;

revoke all on function public.list_goods_receipts(uuid, text, uuid, integer, integer) from public, anon;
grant execute on function public.list_goods_receipts(uuid, text, uuid, integer, integer) to authenticated;
