-- =============================================================================
-- Products and product categories: the third tenant-owned master-data module.
--
-- Follows the customers / vendors pattern (docs/DECISIONS.md 013, 014, 016;
-- docs/ARCHITECTURE.md § Tenant-Owned Module Pattern):
--
--   * Integrity lives in table CHECK constraints built on the shared text
--     helpers public.text_is_trimmed() (one explicit whitespace set) and
--     char_length() (code points).
--   * RLS scopes every row to an organization where the caller is an ACTIVE
--     member (public.is_org_member).
--   * Column-level privileges: INSERT the editable fields plus
--     organization_id; UPDATE the editable fields only. status, created_by,
--     created_at and organization_id can never be changed by a client.
--     No DELETE: products and categories are deactivated, never deleted.
--   * Deactivate / reactivate goes through set_product_status() and
--     set_product_category_status(), SECURITY DEFINER functions that
--     authorize before they lock anything.
--   * Search and pagination go through list_products(), SECURITY INVOKER.
--
-- Product-specific rules:
--   * SKU is required and unique per organization, case-insensitively
--     (unique index on lower(sku)). The SKU is stored as typed.
--   * Category names are unique per organization, case-insensitively.
--   * A product's category must belong to the same organization. This is a
--     composite foreign key (organization_id, category_id), so it holds for
--     every write path and never depends on RLS.
--   * Prices are numeric(18,2), non-negative, optional, in the organization's
--     base currency. There is no per-product currency.
--   * reorder_level is numeric(18,3), non-negative, and must be 0 unless the
--     product type is 'inventory'. There is NO stock quantity column: stock
--     will be derived from stock movements (DECISIONS 007).
--
-- Version 1 permissions:
--   owner, manager, employee  view, create, edit products and categories
--   owner, manager            deactivate, reactivate products and categories
--
-- Validation mirrors lib/products/validation.ts. Keep the two in sync.
--
-- Requires 20261104030000_harden_customer_validation.sql (text helpers) and
-- 20261104020000_customers.sql (public.has_org_role). Creates new objects
-- only; no existing table, function or row is changed.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- product_categories
-- -----------------------------------------------------------------------------
create table public.product_categories (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  name             text not null,
  status           text not null default 'active',
  -- Defaults to the calling user. Clients cannot set or change it.
  created_by       uuid default auth.uid() references auth.users (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  constraint product_categories_status_check
    check (status in ('active', 'inactive')),

  constraint product_categories_name_check
    check (char_length(name) between 1 and 100
           and public.text_is_trimmed(name)),

  -- Target of the products composite foreign key (same-organization rule).
  constraint product_categories_org_id_key
    unique (organization_id, id)
);

-- One name per organization, ignoring case. Also serves name-ordered lists.
create unique index product_categories_org_name_key
  on public.product_categories (organization_id, lower(name));

create index product_categories_created_by_idx
  on public.product_categories (created_by);

create trigger product_categories_set_updated_at
  before update on public.product_categories
  for each row execute function public.set_updated_at();

revoke all on table public.product_categories from anon, authenticated;
grant select on table public.product_categories to authenticated;
grant insert (organization_id, name) on table public.product_categories to authenticated;
grant update (name) on table public.product_categories to authenticated;

alter table public.product_categories enable row level security;

create policy "product_categories: read as active member"
  on public.product_categories for select
  to authenticated
  using (public.is_org_member(organization_id));

create policy "product_categories: insert as active member"
  on public.product_categories for insert
  to authenticated
  with check (
    public.is_org_member(organization_id)
    and created_by = (select auth.uid())
  );

create policy "product_categories: update as active member"
  on public.product_categories for update
  to authenticated
  using (public.is_org_member(organization_id))
  with check (public.is_org_member(organization_id));

-- -----------------------------------------------------------------------------
-- products
-- -----------------------------------------------------------------------------
create table public.products (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  name             text not null,
  sku              text not null,
  category_id      uuid,
  product_type     text not null,
  unit             text not null,
  description      text,
  purchase_price   numeric(18, 2),
  selling_price    numeric(18, 2),
  reorder_level    numeric(18, 3) not null default 0,
  status           text not null default 'active',
  created_by       uuid default auth.uid() references auth.users (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  -- The category must belong to the product's organization. MATCH SIMPLE:
  -- a NULL category_id is not checked.
  constraint products_category_fkey
    foreign key (organization_id, category_id)
    references public.product_categories (organization_id, id),

  constraint products_status_check
    check (status in ('active', 'inactive')),

  constraint products_product_type_check
    check (product_type in ('inventory', 'non_inventory', 'service')),

  -- Predefined units (lib/products/validation.ts PRODUCT_UNITS).
  constraint products_unit_check
    check (unit in ('pcs', 'unit', 'kg', 'g', 'litre', 'ml', 'box', 'pack',
                    'set', 'hour', 'day', 'service')),

  constraint products_name_check
    check (char_length(name) between 1 and 200
           and public.text_is_trimmed(name)),

  constraint products_sku_check
    check (char_length(sku) between 1 and 100
           and public.text_is_trimmed(sku)),

  constraint products_description_check
    check (description is null or (
      char_length(description) between 1 and 2000
      and public.text_is_trimmed(description))),

  -- numeric accepts 'NaN', and NaN >= 0 is true in PostgreSQL, so exclude
  -- it explicitly. Infinity does not fit numeric(p, s).
  constraint products_purchase_price_check
    check (purchase_price is null or (
      purchase_price >= 0 and purchase_price <> 'NaN'::numeric)),

  constraint products_selling_price_check
    check (selling_price is null or (
      selling_price >= 0 and selling_price <> 'NaN'::numeric)),

  constraint products_reorder_level_check
    check (reorder_level >= 0 and reorder_level <> 'NaN'::numeric),

  -- Only inventory products have a reorder level.
  constraint products_reorder_level_type_check
    check (product_type = 'inventory' or reorder_level = 0)
);

-- SKU is unique per organization, ignoring case. Also serves SKU lookups.
create unique index products_org_sku_key
  on public.products (organization_id, lower(sku));

-- List queries: newest first within an organization. Also serves lookups by
-- organization_id alone (leftmost column), e.g. the FK cascade.
create index products_org_created_idx
  on public.products (organization_id, created_at desc, id desc);

-- Status filter within an organization.
create index products_org_status_created_idx
  on public.products (organization_id, status, created_at desc, id desc);

-- Category filter, and the composite foreign key.
create index products_org_category_idx
  on public.products (organization_id, category_id);

create index products_created_by_idx
  on public.products (created_by);

create trigger products_set_updated_at
  before update on public.products
  for each row execute function public.set_updated_at();

revoke all on table public.products from anon, authenticated;

grant select on table public.products to authenticated;

grant insert (organization_id, name, sku, category_id, product_type, unit, description,
              purchase_price, selling_price, reorder_level)
  on table public.products to authenticated;

grant update (name, sku, category_id, product_type, unit, description,
              purchase_price, selling_price, reorder_level)
  on table public.products to authenticated;

alter table public.products enable row level security;

create policy "products: read as active member"
  on public.products for select
  to authenticated
  using (public.is_org_member(organization_id));

create policy "products: insert as active member"
  on public.products for insert
  to authenticated
  with check (
    public.is_org_member(organization_id)
    and created_by = (select auth.uid())
  );

create policy "products: update as active member"
  on public.products for update
  to authenticated
  using (public.is_org_member(organization_id))
  with check (public.is_org_member(organization_id));

-- There is deliberately no DELETE policy or privilege on either table.

-- -----------------------------------------------------------------------------
-- set_product_status: deactivate / reactivate (owner or manager only)
--
-- Same order of checks as set_vendor_status:
--   1. caller is authenticated                          else 42501
--   2. status is valid                                  else 22023
--   3. authorization-scoped lookup through the CALLER's active membership,
--      without a row lock. Missing, other tenant, disabled member -> P0002
--   4. role is owner or manager                         else 42501
--   5. UPDATE, which re-checks the role and takes the row lock itself.
-- -----------------------------------------------------------------------------
create or replace function public.set_product_status(
  p_product_id  uuid,
  p_status      text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_role    text;
begin
  if v_user_id is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  if p_status is null or p_status not in ('active', 'inactive') then
    raise exception 'invalid product status' using errcode = '22023';
  end if;

  select m.role into v_role
  from public.products p
  join public.organization_members m
    on m.organization_id = p.organization_id
  where p.id = p_product_id
    and m.user_id = v_user_id
    and m.status = 'active';

  if not found then
    raise exception 'product not found' using errcode = 'P0002';
  end if;

  if v_role not in ('owner', 'manager') then
    raise exception 'not allowed to change product status' using errcode = '42501';
  end if;

  update public.products p
  set status = p_status
  where p.id = p_product_id
    and p.status <> p_status
    and public.has_org_role(p.organization_id, array['owner', 'manager']);
end;
$$;

revoke all on function public.set_product_status(uuid, text) from public, anon;
grant execute on function public.set_product_status(uuid, text) to authenticated;

-- -----------------------------------------------------------------------------
-- set_product_category_status: same rules as set_product_status.
-- Deactivating a category does not change its products.
-- -----------------------------------------------------------------------------
create or replace function public.set_product_category_status(
  p_category_id  uuid,
  p_status       text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_role    text;
begin
  if v_user_id is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  if p_status is null or p_status not in ('active', 'inactive') then
    raise exception 'invalid category status' using errcode = '22023';
  end if;

  select m.role into v_role
  from public.product_categories c
  join public.organization_members m
    on m.organization_id = c.organization_id
  where c.id = p_category_id
    and m.user_id = v_user_id
    and m.status = 'active';

  if not found then
    raise exception 'category not found' using errcode = 'P0002';
  end if;

  if v_role not in ('owner', 'manager') then
    raise exception 'not allowed to change category status' using errcode = '42501';
  end if;

  update public.product_categories c
  set status = p_status
  where c.id = p_category_id
    and c.status <> p_status
    and public.has_org_role(c.organization_id, array['owner', 'manager']);
end;
$$;

revoke all on function public.set_product_category_status(uuid, text) from public, anon;
grant execute on function public.set_product_category_status(uuid, text) to authenticated;

-- -----------------------------------------------------------------------------
-- list_products: search, filters and pagination in one query.
--
-- SECURITY INVOKER, so the products and product_categories RLS policies still
-- apply: a caller only ever gets rows from organizations where they are an
-- active member, whatever p_organization_id they pass.
--
--   p_search        case-insensitive substring of name, SKU or category name.
--                   LIKE wildcards are literal. Trimmed with the shared
--                   whitespace set and capped at 100 code points.
--   p_status        'active', 'inactive' or NULL for all.
--   p_product_type  'inventory', 'non_inventory', 'service' or NULL for all.
--   p_category_id   a category ID or NULL for all.
--   p_limit         clamped to 1..100.
--   total_count     rows matching the filters, before limit/offset.
-- Prices are returned as text so clients never parse them as floating point.
-- Order: newest first, id as tie-breaker (deterministic pages).
-- -----------------------------------------------------------------------------
create or replace function public.list_products(
  p_organization_id  uuid,
  p_search           text default null,
  p_status           text default null,
  p_product_type     text default null,
  p_category_id      uuid default null,
  p_limit            integer default 25,
  p_offset           integer default 0
)
returns table (
  id              uuid,
  name            text,
  sku             text,
  category_id     uuid,
  category_name   text,
  product_type    text,
  unit            text,
  purchase_price  text,
  selling_price   text,
  status          text,
  created_at      timestamptz,
  total_count     bigint
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
    p.id,
    p.name,
    p.sku,
    p.category_id,
    c.name,
    p.product_type,
    p.unit,
    p.purchase_price::text,
    p.selling_price::text,
    p.status,
    p.created_at,
    count(*) over () as total_count
  from public.products p
  left join public.product_categories c
    on c.organization_id = p.organization_id
   and c.id = p.category_id
  cross join patterns pt
  where p.organization_id = p_organization_id
    and (p_status is null or p.status = p_status)
    and (p_product_type is null or p.product_type = p_product_type)
    and (p_category_id is null or p.category_id = p_category_id)
    and (
      pt.text_pattern is null
      or p.name ilike pt.text_pattern
      or p.sku ilike pt.text_pattern
      or c.name ilike pt.text_pattern
    )
  order by p.created_at desc, p.id desc
  limit least(greatest(coalesce(p_limit, 25), 1), 100)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

revoke all on function public.list_products(uuid, text, text, text, uuid, integer, integer) from public, anon;
grant execute on function public.list_products(uuid, text, text, text, uuid, integer, integer) to authenticated;
