-- =============================================================================
-- list_sales_orders: search, filters and pagination for the sales order list.
--
-- Sales Order Management Part 2. Same shape as list_quotations():
--
--   * SECURITY INVOKER, so the sales_orders (and quotations) RLS policies
--     apply: a caller only ever gets rows from organizations where they are
--     an active member, whatever p_organization_id they pass.
--     p_organization_id is an extra filter that never widens access.
--   * p_search        case-insensitive substring of the sales order number or
--                     the customer name SNAPSHOT (the name on the document,
--                     not the customer's current name). LIKE wildcards are
--                     literal. Trimmed with the shared whitespace set and
--                     capped at 100 code points.
--   * p_status        one of the four statuses, or NULL for all.
--   * p_customer_id   a customer ID, or NULL for all.
--   * p_limit         clamped to 1..100.
--   * total_count     rows matching the filters, before limit/offset.
--   * grand_total is returned as text so clients never parse it as floating
--     point.
--   * source_quotation_number: the number of the quotation the order was
--     converted from (same organization, read under RLS), or NULL for a
--     direct order. One primary-key lookup per returned row (at most 100).
--   * Order: newest first (created_at desc), id as tie-breaker, so pages are
--     deterministic. Served by sales_orders_org_created_idx /
--     sales_orders_org_status_created_idx.
--
-- Requires 20261104130000_sales_orders.sql and
-- 20261104100000_restore_whitespace_line_separators.sql (trim_whitespace).
-- Creates one function only; no table, constraint, policy or row is touched.
-- =============================================================================

create or replace function public.list_sales_orders(
  p_organization_id  uuid,
  p_search           text default null,
  p_status           text default null,
  p_customer_id      uuid default null,
  p_limit            integer default 25,
  p_offset           integer default 0
)
returns table (
  id                       uuid,
  sales_order_number       text,
  customer_id              uuid,
  customer_name            text,
  customer_company_name    text,
  order_date               date,
  expected_delivery_date   date,
  status                   text,
  grand_total              text,
  source_quotation_id      uuid,
  source_quotation_number  text,
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
      so.id,
      so.organization_id,
      so.sales_order_number,
      so.customer_id,
      so.customer_name,
      so.customer_company_name,
      so.order_date,
      so.expected_delivery_date,
      so.status,
      so.grand_total,
      so.source_quotation_id,
      so.created_at,
      count(*) over () as total_count
    from public.sales_orders so
    cross join patterns pt
    where so.organization_id = p_organization_id
      and (p_status is null or so.status = p_status)
      and (p_customer_id is null or so.customer_id = p_customer_id)
      and (
        pt.text_pattern is null
        or so.sales_order_number ilike pt.text_pattern
        or so.customer_name ilike pt.text_pattern
      )
    order by so.created_at desc, so.id desc
    limit least(greatest(coalesce(p_limit, 25), 1), 100)
    offset greatest(coalesce(p_offset, 0), 0)
  )
  select
    p.id,
    p.sales_order_number,
    p.customer_id,
    p.customer_name,
    p.customer_company_name,
    p.order_date,
    p.expected_delivery_date,
    p.status,
    p.grand_total::text,
    p.source_quotation_id,
    q.quotation_number,
    p.created_at,
    p.total_count
  from page p
  left join public.quotations q
    on q.organization_id = p.organization_id
   and q.id = p.source_quotation_id
  order by p.created_at desc, p.id desc;
$$;

revoke all on function public.list_sales_orders(uuid, text, text, uuid, integer, integer) from public, anon;
grant execute on function public.list_sales_orders(uuid, text, text, uuid, integer, integer) to authenticated;
