-- =============================================================================
-- Align list_customers() search trimming with the shared whitespace set.
--
-- Follow-up to 20261104020000_customers.sql (already applied remotely, so it
-- is not edited). list_customers() trimmed the search term with btrim(),
-- which strips only ASCII spaces. A search padded with other whitespace from
-- the shared set (docs/DECISIONS.md 014), e.g. U+00A0 or U+3000, kept the
-- padding and matched nothing. A whitespace-only search such as U+00A0
-- filtered by that character instead of listing everything.
--
-- The only change: btrim(...) becomes public.trim_whitespace(...), the
-- helper from 20261104030000_harden_customer_validation.sql. This matches
-- list_vendors() (20261104050000_vendors.sql) and lib/validation/text.ts
-- trimText(), which the app already applies to the search before calling.
--
-- Unchanged: signature, return columns, SECURITY INVOKER (RLS applies),
-- the 100-character cap, wildcard escaping, phone-digit matching, filters,
-- ordering, limit/offset clamping and grants (restated below). No table,
-- constraint or row is touched.
--
-- Requires 20261104030000_harden_customer_validation.sql (the helper).
-- =============================================================================

create or replace function public.list_customers(
  p_organization_id  uuid,
  p_search           text default null,
  p_status           text default null,
  p_limit            integer default 25,
  p_offset           integer default 0
)
returns table (
  id            uuid,
  name          text,
  company_name  text,
  phone         text,
  email         text,
  status        text,
  created_at    timestamptz,
  total_count   bigint
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
        as text_pattern,
      case
        when t.value ~ '^\+?[0-9() .-]+$'
         and char_length(regexp_replace(t.value, '[^0-9]', '', 'g')) >= 3
        then '%' || regexp_replace(t.value, '[^0-9]', '', 'g') || '%'
      end as digits_pattern
    from term t
  )
  select
    c.id,
    c.name,
    c.company_name,
    c.phone,
    c.email,
    c.status,
    c.created_at,
    count(*) over () as total_count
  from public.customers c
  cross join patterns p
  where c.organization_id = p_organization_id
    and (p_status is null or c.status = p_status)
    and (
      p.text_pattern is null
      or c.name ilike p.text_pattern
      or c.company_name ilike p.text_pattern
      or c.email ilike p.text_pattern
      or c.phone ilike p.text_pattern
      or (p.digits_pattern is not null
          and regexp_replace(coalesce(c.phone, ''), '[^0-9]', '', 'g') like p.digits_pattern)
    )
  order by c.created_at desc, c.id desc
  limit least(greatest(coalesce(p_limit, 25), 1), 100)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

revoke all on function public.list_customers(uuid, text, text, integer, integer) from public, anon;
grant execute on function public.list_customers(uuid, text, text, integer, integer) to authenticated;
