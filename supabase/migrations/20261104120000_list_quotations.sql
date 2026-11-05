-- =============================================================================
-- list_quotations: search, filters and pagination for the quotation list.
--
-- Quotation Management Part 2. Same shape as list_products():
--
--   * SECURITY INVOKER, so the quotations RLS policy applies: a caller only
--     ever gets rows from organizations where they are an active member,
--     whatever p_organization_id they pass. p_organization_id is an extra
--     filter that never widens access.
--   * p_search        case-insensitive substring of the quotation number or
--                     the customer name SNAPSHOT (the name on the document,
--                     not the customer's current name). LIKE wildcards are
--                     literal. Trimmed with the shared whitespace set and
--                     capped at 100 code points.
--   * p_status        one of the six statuses, or NULL for all.
--   * p_customer_id   a customer ID, or NULL for all.
--   * p_limit         clamped to 1..100.
--   * total_count     rows matching the filters, before limit/offset.
--   * grand_total is returned as text so clients never parse it as floating
--     point.
--   * Order: newest first (created_at desc), id as tie-breaker, so pages are
--     deterministic. Numbers are not used for ordering (DECISIONS 017).
--     Served by quotations_org_created_idx / quotations_org_status_created_idx.
--
-- Requires 20261104090000_quotations.sql and
-- 20261104100000_restore_whitespace_line_separators.sql (trim_whitespace).
-- Creates one function only; no table, constraint or row is touched.
-- =============================================================================

create or replace function public.list_quotations(
  p_organization_id  uuid,
  p_search           text default null,
  p_status           text default null,
  p_customer_id      uuid default null,
  p_limit            integer default 25,
  p_offset           integer default 0
)
returns table (
  id                     uuid,
  quotation_number       text,
  customer_id            uuid,
  customer_name          text,
  customer_company_name  text,
  quotation_date         date,
  expiry_date            date,
  status                 text,
  grand_total            text,
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
  )
  select
    q.id,
    q.quotation_number,
    q.customer_id,
    q.customer_name,
    q.customer_company_name,
    q.quotation_date,
    q.expiry_date,
    q.status,
    q.grand_total::text,
    q.created_at,
    count(*) over () as total_count
  from public.quotations q
  cross join patterns pt
  where q.organization_id = p_organization_id
    and (p_status is null or q.status = p_status)
    and (p_customer_id is null or q.customer_id = p_customer_id)
    and (
      pt.text_pattern is null
      or q.quotation_number ilike pt.text_pattern
      or q.customer_name ilike pt.text_pattern
    )
  order by q.created_at desc, q.id desc
  limit least(greatest(coalesce(p_limit, 25), 1), 100)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

revoke all on function public.list_quotations(uuid, text, text, uuid, integer, integer) from public, anon;
grant execute on function public.list_quotations(uuid, text, text, uuid, integer, integer) to authenticated;
