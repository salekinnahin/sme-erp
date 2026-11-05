-- =============================================================================
-- get_quotation: one quotation with its items, read in ONE statement.
--
-- Reading the header and the items with two separate requests can return a
-- mixed document when a draft is saved in between (old totals with new
-- items, or the reverse). This function builds the whole document in a
-- single SQL statement, so header and items come from the same snapshot.
--
--   * SECURITY INVOKER: the quotations and quotation_items RLS policies
--     apply. A caller only sees quotations of organizations where they are
--     an active member; there is no privileged read path.
--   * p_organization_id is an extra filter (the app passes the tenant from
--     requireTenant()), like list_products(). It never widens access.
--   * Returns NULL when the quotation does not exist, belongs to another
--     tenant, or the caller's membership is disabled: the cases look the same.
--   * Money, quantities and rates are returned as TEXT inside the JSON, so
--     clients never parse them as floating point. Items are ordered by
--     sort_order, then id.
--
-- Requires 20261104090000_quotations.sql. Creates one function only.
-- =============================================================================

create or replace function public.get_quotation(
  p_organization_id  uuid,
  p_quotation_id     uuid
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'id',                    q.id,
    'quotation_number',      q.quotation_number,
    'customer_id',           q.customer_id,
    'customer_name',         q.customer_name,
    'customer_company_name', q.customer_company_name,
    'customer_phone',        q.customer_phone,
    'customer_email',        q.customer_email,
    'customer_address',      q.customer_address,
    'customer_tax_number',   q.customer_tax_number,
    'quotation_date',        q.quotation_date,
    'expiry_date',           q.expiry_date,
    'status',                q.status,
    'notes',                 q.notes,
    'subtotal',              q.subtotal::text,
    'discount_total',        q.discount_total::text,
    'tax_total',             q.tax_total::text,
    'grand_total',           q.grand_total::text,
    'created_at',            q.created_at,
    'updated_at',            q.updated_at,
    'items', coalesce((
      select pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'id',              i.id,
          'product_id',      i.product_id,
          'product_name',    i.product_name,
          'sku',             i.sku,
          'description',     i.description,
          'unit',            i.unit,
          'quantity',        i.quantity::text,
          'unit_price',      i.unit_price::text,
          'discount_amount', i.discount_amount::text,
          'tax_rate',        i.tax_rate::text,
          'tax_amount',      i.tax_amount::text,
          'line_total',      i.line_total::text,
          'sort_order',      i.sort_order
        )
        order by i.sort_order, i.id
      )
      from public.quotation_items i
      where i.organization_id = q.organization_id
        and i.quotation_id = q.id
    ), '[]'::jsonb)
  )
  from public.quotations q
  where q.id = p_quotation_id
    and q.organization_id = p_organization_id;
$$;

revoke all on function public.get_quotation(uuid, uuid) from public, anon;
grant execute on function public.get_quotation(uuid, uuid) to authenticated;
