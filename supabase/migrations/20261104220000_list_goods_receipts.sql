-- =============================================================================
-- list_goods_receipts: Goods Receiving Part 2 list and purchase order history.
--
-- Apply after 20261104210000_organization_branding.sql (and therefore after
-- 20261104200000_goods_receipts.sql). Creates one read function only; no
-- table, constraint, policy, trigger or row is touched, and no Part 1 rule
-- changes.
--
--   * SECURITY INVOKER: the goods_receipts / goods_receipt_items /
--     purchase_orders RLS policies apply, so a caller only gets rows of
--     organizations where they are an ACTIVE member (disabled members and
--     other tenants get nothing). p_organization_id is an extra filter that
--     never widens access.
--   * Only sealed receipts (complete physical events) are listed.
--   * p_search          case-insensitive substring of the GR number, the
--                       source PO number, or the PO's vendor name / company
--                       name SNAPSHOT. LIKE wildcards are literal. Trimmed
--                       with the shared Unicode whitespace set, capped at
--                       100 code points.
--   * p_purchase_order_id  optional; one PO's receipt history. Compared
--                       together with the organization filter, so another
--                       tenant's PO ID matches nothing.
--   * p_limit           clamped to 1..100 (NULL: 25); p_offset >= 0.
--   * item_count / total_received_quantity are aggregated here (no browser
--     aggregation, no N+1). Quantities are text so clients never parse them
--     as floating point.
--   * Order: received date (newest first), then created_at, then id, so
--     pages are deterministic. total_count counts matches before paging.
-- =============================================================================

create or replace function public.list_goods_receipts(
  p_organization_id    uuid,
  p_search             text default null,
  p_purchase_order_id  uuid default null,
  p_limit              integer default 25,
  p_offset             integer default 0
)
returns table (
  id                       uuid,
  goods_receipt_number     text,
  purchase_order_id        uuid,
  purchase_order_number    text,
  vendor_name              text,
  vendor_company_name      text,
  received_date            date,
  item_count               integer,
  total_received_quantity  text,
  created_by               uuid,
  created_at               timestamptz,
  total_count              bigint
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
      po.vendor_name, po.vendor_company_name, h.received_date, h.created_by,
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
    s.item_count, s.total_received_quantity,
    pg.created_by, pg.created_at, pg.total_count
  from page pg
  cross join lateral (
    select
      count(*)::integer as item_count,
      coalesce(sum(i.received_quantity), 0.000)::text as total_received_quantity
    from public.goods_receipt_items i
    where i.organization_id = pg.organization_id
      and i.goods_receipt_id = pg.id
  ) s
  order by pg.received_date desc, pg.created_at desc, pg.id desc;
$$;

revoke all on function public.list_goods_receipts(uuid, text, uuid, integer, integer) from public, anon;
grant execute on function public.list_goods_receipts(uuid, text, uuid, integer, integer) to authenticated;
