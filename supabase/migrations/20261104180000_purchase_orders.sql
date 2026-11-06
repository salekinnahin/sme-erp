-- Purchase Order Management – Part 1. Requires all migrations through
-- 20261104170000_organization_features.sql. Reuses the quotation decimal parser,
-- transactional document counter, membership/role and text helpers.
-- API writes: create_purchase_order, update_purchase_order_draft,
-- set_purchase_order_status only. Receiving statuses are reserved for future
-- Goods Receiving; purchase orders NEVER mutate stock. No UI or receiving here.
-- Vendor snapshots replace customer snapshots; defaults use purchase_price.
-- Items are replaced on draft save: IDs are temporary edit tokens.
-- No hard delete in any state; organization cascades intentionally fail.

alter table public.vendors
  add constraint vendors_org_id_key unique (organization_id, id);

alter table public.document_number_counters
  drop constraint document_number_counters_type_check;

alter table public.document_number_counters
  add constraint document_number_counters_type_check
  check (document_type in ('quotation', 'sales_order', 'invoice', 'purchase_order'));

-- -----------------------------------------------------------------------------
-- Status transitions (V1). The TypeScript twin is PURCHASE_ORDER_TRANSITIONS in
-- lib/purchase-orders/validation.ts. received and cancelled are terminal; receiving transitions are system-only.
-- -----------------------------------------------------------------------------
create or replace function public.purchase_order_status_transition_allowed(
  p_from  text,
  p_to    text
)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select (p_from, p_to) in (
    ('draft', 'ordered'),
    ('draft', 'cancelled'),
    ('ordered', 'cancelled'),
    ('ordered', 'partially_received'),
    ('ordered', 'received'),
    ('partially_received', 'received')
  );
$$;

revoke all on function public.purchase_order_status_transition_allowed(text, text) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- purchase_orders
-- -----------------------------------------------------------------------------
create table public.purchase_orders (
  id                      uuid primary key default gen_random_uuid(),
  organization_id         uuid not null references public.organizations (id) on delete cascade,
  purchase_order_number      text not null,
  vendor_id             uuid not null,

  -- Vendor snapshot copied at creation or vendor change.
  vendor_name           text not null,
  vendor_company_name   text,
  vendor_phone          text,
  vendor_email          text,
  vendor_address        text,
  vendor_tax_number     text,

  order_date              date not null,
  expected_delivery_date  date,
  status                  text not null default 'draft',
  notes                   text,

  -- Computed by the database from the items.
  subtotal                numeric(18, 2) not null default 0,
  discount_total          numeric(18, 2) not null default 0,
  tax_total               numeric(18, 2) not null default 0,
  grand_total             numeric(18, 2) not null default 0,

  created_by              uuid references auth.users (id) on delete set null,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),

  -- Target of the purchase_order_items composite foreign key.
  constraint purchase_orders_org_id_key
    unique (organization_id, id),

  constraint purchase_orders_org_number_key
    unique (organization_id, purchase_order_number),

  constraint purchase_orders_vendor_fkey
    foreign key (organization_id, vendor_id)
    references public.vendors (organization_id, id),

  constraint purchase_orders_status_check
    check (status in ('draft', 'ordered', 'partially_received', 'received', 'cancelled')),

  constraint purchase_orders_number_check
    check (purchase_order_number ~ '^PO-[0-9]{6,}$'),

  constraint purchase_orders_vendor_name_check
    check (char_length(vendor_name) between 1 and 200),

  constraint purchase_orders_dates_check
    check (isfinite(order_date)
           and (expected_delivery_date is null
                or (isfinite(expected_delivery_date)
                    and expected_delivery_date >= order_date))),

  constraint purchase_orders_notes_check
    check (notes is null or (
      char_length(notes) between 1 and 2000
      and public.text_is_trimmed(notes))),

  constraint purchase_orders_totals_check
    check (subtotal >= 0 and subtotal <> 'NaN'::numeric
           and discount_total >= 0 and discount_total <= subtotal
           and tax_total >= 0 and tax_total <> 'NaN'::numeric
           and grand_total = subtotal - discount_total + tax_total)
);

create index purchase_orders_org_created_idx
  on public.purchase_orders (organization_id, created_at desc, id desc);

create index purchase_orders_org_status_created_idx
  on public.purchase_orders (organization_id, status, created_at desc, id desc);

create index purchase_orders_org_date_idx
  on public.purchase_orders (organization_id, order_date desc);

create index purchase_orders_org_vendor_idx
  on public.purchase_orders (organization_id, vendor_id);

create index purchase_orders_created_by_idx
  on public.purchase_orders (created_by);

create trigger purchase_orders_set_updated_at
  before update on public.purchase_orders
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- purchase_order_items
-- -----------------------------------------------------------------------------
create table public.purchase_order_items (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  purchase_order_id   uuid not null,
  product_id       uuid not null,

  -- Product snapshot from master data or a kept draft line.
  product_name     text not null,
  sku              text not null,
  description      text,
  unit             text not null,

  quantity         numeric(18, 3) not null,
  unit_price       numeric(18, 2) not null,
  discount_amount  numeric(18, 2) not null default 0,
  tax_rate         numeric(5, 2) not null default 0,
  tax_amount       numeric(18, 2) not null,
  line_total       numeric(18, 2) not null,

  sort_order       integer not null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  constraint purchase_order_items_purchase_order_fkey
    foreign key (organization_id, purchase_order_id)
    references public.purchase_orders (organization_id, id)
    on delete cascade,

  constraint purchase_order_items_product_fkey
    foreign key (organization_id, product_id)
    references public.products (organization_id, id),

  constraint purchase_order_items_product_name_check
    check (char_length(product_name) between 1 and 200),

  constraint purchase_order_items_sku_check
    check (char_length(sku) between 1 and 100),

  constraint purchase_order_items_unit_check
    check (char_length(unit) between 1 and 50),

  constraint purchase_order_items_description_check
    check (description is null or (
      char_length(description) between 1 and 2000
      and public.text_is_trimmed(description))),

  constraint purchase_order_items_sort_order_check
    check (sort_order between 1 and 100),

  constraint purchase_order_items_quantity_check
    check (quantity > 0 and quantity <> 'NaN'::numeric),

  constraint purchase_order_items_unit_price_check
    check (unit_price >= 0 and unit_price <> 'NaN'::numeric),

  constraint purchase_order_items_tax_rate_check
    check (tax_rate >= 0 and tax_rate <= 100),

  -- Same calculation model as quotation_items_amounts_check.
  constraint purchase_order_items_amounts_check
    check (discount_amount >= 0
           and discount_amount <= round(quantity * unit_price, 2)
           and tax_amount = round((round(quantity * unit_price, 2) - discount_amount)
                                  * tax_rate * 0.01, 2)
           and line_total = round(quantity * unit_price, 2) - discount_amount + tax_amount)
);

create unique index purchase_order_items_order_sort_key
  on public.purchase_order_items (organization_id, purchase_order_id, sort_order);

create index purchase_order_items_org_product_idx
  on public.purchase_order_items (organization_id, product_id);

create trigger purchase_order_items_set_updated_at
  before update on public.purchase_order_items
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- Privileges and RLS: read-only for clients.
-- -----------------------------------------------------------------------------
revoke all on table public.purchase_orders, public.purchase_order_items from public, anon, authenticated;
grant select on table public.purchase_orders, public.purchase_order_items to authenticated;

alter table public.purchase_orders enable row level security;
alter table public.purchase_order_items enable row level security;

create policy "purchase_orders: read as active member"
  on public.purchase_orders for select
  to authenticated
  using (public.is_org_member(organization_id));

create policy "purchase_order_items: read as active member"
  on public.purchase_order_items for select
  to authenticated
  using (public.is_org_member(organization_id));

-- There are deliberately no INSERT, UPDATE or DELETE policies or privileges.

-- -----------------------------------------------------------------------------
-- Document rules (triggers), for every writer.
-- -----------------------------------------------------------------------------
create or replace function public.purchase_orders_enforce_rules()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Purchase orders are never hard-deleted, whatever their status (V1). This
  -- runs before the item cascade starts, so a delete cannot remove an order,
  -- its items, or its history. It also blocks the organizations ON DELETE CASCADE:
  -- an organization purge, if ever needed, must be an explicit workflow.
  if tg_op = 'DELETE' then
    raise exception 'purchase orders cannot be deleted' using errcode = '55000';
  end if;

  if new.organization_id is distinct from old.organization_id
     or new.purchase_order_number is distinct from old.purchase_order_number
     or new.created_at is distinct from old.created_at
     or (new.created_by is distinct from old.created_by and new.created_by is not null)
  then
    raise exception 'purchase order identity cannot change' using errcode = '55000';
  end if;

  if new.status is distinct from old.status
     and not public.purchase_order_status_transition_allowed(old.status, new.status)
  then
    raise exception 'invalid purchase order status transition from % to %', old.status, new.status
      using errcode = '55000';
  end if;

  -- After draft, only the status may change (whole-row comparison covers
  -- future columns too).
  if old.status <> 'draft'
     and (to_jsonb(new) - 'status' - 'updated_at' - 'created_by')
         is distinct from
         (to_jsonb(old) - 'status' - 'updated_at' - 'created_by')
  then
    raise exception 'purchase order is not a draft' using errcode = '55000';
  end if;

  return new;
end;
$$;

revoke all on function public.purchase_orders_enforce_rules() from public, anon, authenticated;

create trigger purchase_orders_enforce_rules
  before update or delete on public.purchase_orders
  for each row execute function public.purchase_orders_enforce_rules();

-- Items may only be written while their order is a draft. A missing parent
-- is let through (INSERT: the FK rejects it; DELETE: cascade from the order).
create or replace function public.purchase_order_items_enforce_draft()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_status text;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    select so.status into v_status from public.purchase_orders so where so.id = old.purchase_order_id for update;
    if found and v_status <> 'draft' then
      raise exception 'purchase order is not a draft' using errcode = '55000';
    end if;
  end if;

  if tg_op in ('INSERT', 'UPDATE') then
    select so.status into v_status from public.purchase_orders so where so.id = new.purchase_order_id for update;
    if found and v_status <> 'draft' then
      raise exception 'purchase order is not a draft' using errcode = '55000';
    end if;
    return new;
  end if;

  return old;
end;
$$;

revoke all on function public.purchase_order_items_enforce_draft() from public, anon, authenticated;

create trigger purchase_order_items_enforce_draft
  before insert or update or delete on public.purchase_order_items
  for each row execute function public.purchase_order_items_enforce_draft();

-- -----------------------------------------------------------------------------
-- Internal helpers (no client EXECUTE)
-- -----------------------------------------------------------------------------

-- Validates the header input and returns the normalized notes.
create or replace function public.purchase_order_normalize_header(
  p_order_date              date,
  p_expected_delivery_date  date,
  p_notes                   text
)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_notes text := nullif(public.trim_whitespace(coalesce(p_notes, '')), '');
begin
  if p_order_date is null or not isfinite(p_order_date) then
    raise exception 'order date is required' using errcode = '22023';
  end if;
  if p_expected_delivery_date is not null
     and (not isfinite(p_expected_delivery_date) or p_expected_delivery_date < p_order_date) then
    raise exception 'expected delivery date must be on or after the order date' using errcode = '22023';
  end if;
  if char_length(v_notes) > 2000 then
    raise exception 'notes are too long' using errcode = '22023';
  end if;
  return v_notes;
end;
$$;

revoke all on function public.purchase_order_normalize_header(date, date, text) from public, anon, authenticated;

-- Replaces all items of a draft purchase order with p_items and recomputes the
-- header totals from the stored items.
--
-- p_items is a JSON array of 1..100 objects:
--   id               optional; an existing line of THIS order, at most once.
--                    With the same product_id as that line, the line's
--                    product snapshot is kept and its unit price and
--                    description are the defaults (product need not be
--                    active). Unknown or repeated ids are rejected (22023).
--   product_id       uuid, required.
--   quantity         decimal string or number, > 0, at most 3 decimals.
--   unit_price       optional; missing or null = default price (see id).
--   discount_amount  optional, default 0; at most 2 decimals; <= gross.
--   tax_rate         optional, default 0; 0..100, at most 2 decimals.
--   description      optional; key missing = default description; present =
--                    that text (trimmed; empty or null = none).
-- Any other key is ignored: snapshots and amounts come from the database.
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
      v_name          := v_old_line ->> 'product_name';
      v_sku           := v_old_line ->> 'sku';
      v_unit          := v_old_line ->> 'unit';
      v_default_price := (v_old_line ->> 'unit_price')::numeric;
      v_default_desc  := v_old_line ->> 'description';
    else
      -- New selection. Unknown and other-tenant products look the same.
      select p.name, p.sku, p.description, p.unit, p.purchase_price, p.status
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
      product_name, sku, description, unit,
      quantity, unit_price, discount_amount, tax_rate, tax_amount, line_total,
      sort_order
    ) values (
      p_organization_id, p_purchase_order_id, v_product_id,
      v_name, v_sku, v_description, v_unit,
      v_quantity, v_unit_price, v_discount, v_tax_rate, v_tax,
      v_gross - v_discount + v_tax,
      v_index
    );
  end loop;

  perform public.purchase_order_recompute_totals(p_purchase_order_id, p_organization_id);
end;
$$;

-- Totals always come from the stored items.
create or replace function public.purchase_order_recompute_totals(
  p_purchase_order_id   uuid,
  p_organization_id  uuid
)
returns void
language sql
set search_path = ''
as $$
  update public.purchase_orders so
  set subtotal       = t.subtotal,
      discount_total = t.discount_total,
      tax_total      = t.tax_total,
      grand_total    = t.subtotal - t.discount_total + t.tax_total
  from (
    select coalesce(sum(round(i.quantity * i.unit_price, 2)), 0) as subtotal,
           coalesce(sum(i.discount_amount), 0)                   as discount_total,
           coalesce(sum(i.tax_amount), 0)                        as tax_total
    from public.purchase_order_items i
    where i.purchase_order_id = p_purchase_order_id
      and i.organization_id = p_organization_id
  ) t
  where so.id = p_purchase_order_id
    and so.organization_id = p_organization_id;
$$;

revoke all on function public.purchase_order_recompute_totals(uuid, uuid) from public, anon, authenticated;
revoke all on function public.purchase_order_replace_items(uuid, uuid, jsonb) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- create_purchase_order: direct create, header + items, atomically. Any active
-- member. The organization is the vendor's organization, and only if the
-- caller is an active member of it; the vendor must be active.
--
-- Errors (SQLSTATE):
--   42501  not authenticated
--   23503  vendor / product not found (any tenant) or inactive
--   22023  invalid input (dates, notes, items, quantities, prices, …)
--   22003  an amount exceeds numeric(18,2)
-- Returns the new purchase order's id.
-- -----------------------------------------------------------------------------
create or replace function public.create_purchase_order(
  p_vendor_id             uuid,
  p_order_date              date,
  p_expected_delivery_date  date,
  p_notes                   text,
  p_items                   jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id   uuid := (select auth.uid());
  v_vendor  record;
  v_notes     text;
  v_seq       bigint;
  v_id        uuid;
begin
  if v_user_id is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  select c.organization_id, c.name, c.company_name, c.phone, c.email,
         c.address, c.tax_number, c.status
  into v_vendor
  from public.vendors c
  join public.organization_members m
    on m.organization_id = c.organization_id
   and m.user_id = v_user_id
   and m.status = 'active'
   and m.role in ('owner', 'manager', 'employee')
  where c.id = p_vendor_id;

  if not found then
    raise exception 'vendor not found' using errcode = '23503';
  end if;
  if v_vendor.status <> 'active' then
    raise exception 'vendor is inactive' using errcode = '23503';
  end if;

  v_notes := public.purchase_order_normalize_header(p_order_date, p_expected_delivery_date, p_notes);

  v_seq := public.next_document_number(v_vendor.organization_id, 'purchase_order');

  insert into public.purchase_orders (
    organization_id, purchase_order_number, vendor_id,
    vendor_name, vendor_company_name, vendor_phone, vendor_email,
    vendor_address, vendor_tax_number,
    order_date, expected_delivery_date, status, notes, created_by
  ) values (
    v_vendor.organization_id,
    'PO-' || lpad(v_seq::text, greatest(6, length(v_seq::text)), '0'),
    p_vendor_id,
    v_vendor.name, v_vendor.company_name, v_vendor.phone, v_vendor.email,
    v_vendor.address, v_vendor.tax_number,
    p_order_date, p_expected_delivery_date, 'draft', v_notes, v_user_id
  )
  returning id into v_id;

  perform public.purchase_order_replace_items(v_id, v_vendor.organization_id, p_items);

  return v_id;
end;
$$;

revoke all on function public.create_purchase_order(uuid, date, date, text, jsonb) from public, anon;
grant execute on function public.create_purchase_order(uuid, date, date, text, jsonb) to authenticated;

-- -----------------------------------------------------------------------------
-- update_purchase_order_draft: header + full item replacement. Any active
-- member, draft only. No other document is changed.
--
-- Order of checks:
--   1. caller is authenticated                                   else 42501
--   2. authorization-scoped lookup through the caller's active
--      membership, without a row lock. Missing, other tenant,
--      disabled member                                           -> P0002
--   3. header input                                              else 22023
--   4. lock the (authorized) order row; must be draft            else 55000
--   5. vendor: unchanged -> snapshot kept; changed -> same
--      organization and active, fresh snapshot                   else 23503
--   6. write header, replace items, recompute totals
-- -----------------------------------------------------------------------------
create or replace function public.update_purchase_order_draft(
  p_purchase_order_id          uuid,
  p_vendor_id             uuid,
  p_order_date              date,
  p_expected_delivery_date  date,
  p_notes                   text,
  p_items                   jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id      uuid := (select auth.uid());
  v_org_id       uuid;
  v_current      record;
  v_vendor     record;
  v_notes        text;
begin
  if v_user_id is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  select so.organization_id into v_org_id
  from public.purchase_orders so
  join public.organization_members m
    on m.organization_id = so.organization_id
   and m.user_id = v_user_id
   and m.status = 'active'
   and m.role in ('owner', 'manager', 'employee')
  where so.id = p_purchase_order_id;

  if not found then
    raise exception 'purchase order not found' using errcode = 'P0002';
  end if;

  v_notes := public.purchase_order_normalize_header(p_order_date, p_expected_delivery_date, p_notes);

  -- Authorized row only; waits for a concurrent change and then sees it.
  select so.status, so.vendor_id into v_current
  from public.purchase_orders so
  where so.id = p_purchase_order_id
    and so.organization_id = v_org_id
  for update;

  if v_current.status is distinct from 'draft' then
    raise exception 'purchase order is not a draft' using errcode = '55000';
  end if;

  if p_vendor_id is distinct from v_current.vendor_id then
    select c.name, c.company_name, c.phone, c.email, c.address, c.tax_number, c.status
    into v_vendor
    from public.vendors c
    where c.id = p_vendor_id
      and c.organization_id = v_org_id;

    if not found then
      raise exception 'vendor not found' using errcode = '23503';
    end if;
    if v_vendor.status <> 'active' then
      raise exception 'vendor is inactive' using errcode = '23503';
    end if;

    update public.purchase_orders so
    set vendor_id           = p_vendor_id,
        vendor_name         = v_vendor.name,
        vendor_company_name = v_vendor.company_name,
        vendor_phone        = v_vendor.phone,
        vendor_email        = v_vendor.email,
        vendor_address      = v_vendor.address,
        vendor_tax_number   = v_vendor.tax_number
    where so.id = p_purchase_order_id
      and so.organization_id = v_org_id;
  end if;

  update public.purchase_orders so
  set order_date             = p_order_date,
      expected_delivery_date = p_expected_delivery_date,
      notes                  = v_notes
  where so.id = p_purchase_order_id
    and so.organization_id = v_org_id;

  perform public.purchase_order_replace_items(p_purchase_order_id, v_org_id, p_items);
end;
$$;

revoke all on function public.update_purchase_order_draft(uuid, uuid, date, date, text, jsonb) from public, anon;
grant execute on function public.update_purchase_order_draft(uuid, uuid, date, date, text, jsonb) to authenticated;

-- -----------------------------------------------------------------------------
-- set_purchase_order_status: the only way to change a purchase order's status.
--
--   ordered    any active member (from draft)
--   cancelled  owner or manager (from draft or ordered)
--   partially_received / received  reserved for future Goods Receiving
--
-- Order of checks (same as set_quotation_status):
--   1. caller is authenticated                                   else 42501
--   2. target status is one of the above                         else 22023
--   3. authorization-scoped lookup, no lock. Missing, other
--      tenant, disabled member                                   -> P0002
--   4. role allowed for the target status                        else 42501
--   5. lock the row with the role re-checked in the same query
--   6. transition allowed from the locked status                 else 55000
-- -----------------------------------------------------------------------------
create or replace function public.set_purchase_order_status(
  p_purchase_order_id  uuid,
  p_status          text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id  uuid := (select auth.uid());
  v_role     text;
  v_roles    text[];
  v_current  text;
begin
  if v_user_id is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  if p_status is null
     or p_status not in ('ordered', 'cancelled', 'partially_received', 'received') then
    raise exception 'invalid purchase order status' using errcode = '22023';
  end if;

  if p_status in ('partially_received', 'received') then
    raise exception 'purchase order receiving status is system controlled' using errcode = '42501';
  end if;

  v_roles := case when p_status = 'ordered'
                  then array['owner', 'manager', 'employee']
                  else array['owner', 'manager'] end;

  select m.role into v_role
  from public.purchase_orders so
  join public.organization_members m
    on m.organization_id = so.organization_id
  where so.id = p_purchase_order_id
    and m.user_id = v_user_id
    and m.status = 'active';

  if not found then
    raise exception 'purchase order not found' using errcode = 'P0002';
  end if;

  if not (v_role = any (v_roles)) then
    raise exception 'not allowed to change purchase order status to %', p_status
      using errcode = '42501';
  end if;

  select so.status into v_current
  from public.purchase_orders so
  where so.id = p_purchase_order_id
    and public.has_org_role(so.organization_id, v_roles)
  for update;

  if not found then
    raise exception 'purchase order not found' using errcode = 'P0002';
  end if;

  if not public.purchase_order_status_transition_allowed(v_current, p_status) then
    raise exception 'invalid purchase order status transition from % to %', v_current, p_status
      using errcode = '55000';
  end if;

  update public.purchase_orders so
  set status = p_status
  where so.id = p_purchase_order_id;
end;
$$;

revoke all on function public.set_purchase_order_status(uuid, text) from public, anon;
grant execute on function public.set_purchase_order_status(uuid, text) to authenticated;

-- -----------------------------------------------------------------------------
-- get_purchase_order: one purchase order with its items, read in ONE statement
-- (DECISIONS 020). SECURITY INVOKER, so RLS applies; p_organization_id is an
-- extra filter that never widens access. NULL when not visible. Money,
-- quantities and rates are JSON strings.
-- -----------------------------------------------------------------------------
create or replace function public.get_purchase_order(
  p_organization_id  uuid,
  p_purchase_order_id   uuid
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'id',                      so.id,
    'purchase_order_number',      so.purchase_order_number,
    'vendor_id',             so.vendor_id,
    'vendor_name',           so.vendor_name,
    'vendor_company_name',   so.vendor_company_name,
    'vendor_phone',          so.vendor_phone,
    'vendor_email',          so.vendor_email,
    'vendor_address',        so.vendor_address,
    'vendor_tax_number',     so.vendor_tax_number,
    'order_date',              so.order_date,
    'expected_delivery_date',  so.expected_delivery_date,
    'status',                  so.status,
    'notes',                   so.notes,
    'subtotal',                so.subtotal::text,
    'discount_total',          so.discount_total::text,
    'tax_total',               so.tax_total::text,
    'grand_total',             so.grand_total::text,
    'created_at',              so.created_at,
    'updated_at',              so.updated_at,
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
      from public.purchase_order_items i
      where i.organization_id = so.organization_id
        and i.purchase_order_id = so.id
    ), '[]'::jsonb)
  )
  from public.purchase_orders so
  where so.id = p_purchase_order_id
    and so.organization_id = p_organization_id;
$$;

revoke all on function public.get_purchase_order(uuid, uuid) from public, anon;
grant execute on function public.get_purchase_order(uuid, uuid) to authenticated;
