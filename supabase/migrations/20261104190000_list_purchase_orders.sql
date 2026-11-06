-- =============================================================================
-- list_purchase_orders: search, filters and pagination for the PO list.
--
-- Purchase Order Management Part 2. Same shape as list_invoices():
--
--   * SECURITY INVOKER, so the purchase_orders RLS policy applies: a caller
--     only ever gets rows from organizations where they are an active
--     member, whatever p_organization_id they pass. p_organization_id is an
--     extra filter that never widens access.
--   * p_search        case-insensitive substring of the PO number, or of the
--                     vendor name / company name SNAPSHOT (the names on the
--                     document, not the vendor's current names). LIKE
--                     wildcards are literal. Trimmed with the shared
--                     whitespace set and capped at 100 code points.
--   * p_status        one of the five statuses (exact match), or NULL for
--                     all. Any other value matches nothing.
--   * p_vendor_id     a vendor ID, or NULL for all. Compared together with
--                     the organization filter, so another tenant's vendor ID
--                     matches nothing.
--   * p_limit         clamped to 1..100 (NULL: 25).
--   * total_count     rows matching the filters, before limit/offset.
--   * grand_total is returned as text so clients never parse it as floating
--     point.
--   * Order: newest first (created_at desc), id as tie-breaker, so pages are
--     deterministic. Served by purchase_orders_org_created_idx /
--     purchase_orders_org_status_created_idx.
--
-- Requires 20261104180000_purchase_orders.sql and
-- 20261104100000_restore_whitespace_line_separators.sql (trim_whitespace).
-- Creates one function only; no table, constraint, policy or row is touched.
-- =============================================================================

create or replace function public.list_purchase_orders(
  p_organization_id  uuid,
  p_search           text default null,
  p_status           text default null,
  p_vendor_id        uuid default null,
  p_limit            integer default 25,
  p_offset           integer default 0
)
returns table (
  id                      uuid,
  purchase_order_number   text,
  vendor_id               uuid,
  vendor_name             text,
  vendor_company_name     text,
  order_date              date,
  expected_delivery_date  date,
  status                  text,
  grand_total             text,
  created_at              timestamptz,
  total_count             bigint
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
  )
  select
    po.id,
    po.purchase_order_number,
    po.vendor_id,
    po.vendor_name,
    po.vendor_company_name,
    po.order_date,
    po.expected_delivery_date,
    po.status,
    po.grand_total::text,
    po.created_at,
    count(*) over () as total_count
  from public.purchase_orders po
  cross join patterns pt
  where po.organization_id = p_organization_id
    and (p_status is null or po.status = p_status)
    and (p_vendor_id is null or po.vendor_id = p_vendor_id)
    and (
      pt.text_pattern is null
      or po.purchase_order_number ilike pt.text_pattern
      or po.vendor_name ilike pt.text_pattern
      or po.vendor_company_name ilike pt.text_pattern
    )
  order by po.created_at desc, po.id desc
  limit least(greatest(coalesce(p_limit, 25), 1), 100)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

revoke all on function public.list_purchase_orders(uuid, text, text, uuid, integer, integer) from public, anon;
grant execute on function public.list_purchase_orders(uuid, text, text, uuid, integer, integer) to authenticated;
