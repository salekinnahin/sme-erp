-- =============================================================================
-- Sales Orders (Phase 4, Part 1): database, numbering, calculations, status
-- model, quotation conversion and security. No UI.
--
-- Same shape as quotations (docs/DECISIONS.md 017, 018, 020, 022;
-- docs/DATA_MODEL.md § sales_orders):
--
--   * Clients can only READ sales_orders and sales_order_items (RLS on active
--     membership). There is no INSERT, UPDATE or DELETE privilege. Every write
--     goes through four SECURITY DEFINER functions:
--       create_sales_order()                 direct create, header + items
--       create_sales_order_from_quotation()  accepted quotation -> draft order
--       update_sales_order_draft()           header + item replacement, draft
--       set_sales_order_status()             role- and transition-checked
--     They derive organization_id, created_by, the number, source_quotation_id,
--     every snapshot, every line amount and every total.
--
--   * Triggers enforce the document rules underneath the functions, for every
--     writer:
--       - identity columns (organization_id, sales_order_number,
--         source_quotation_id, created_at, created_by) never change;
--         created_by may only become NULL (auth user deleted)
--       - status changes follow the V1 transition table only
--       - once an order is not 'draft', nothing but its status may change,
--         and its items cannot be inserted, updated or deleted
--       - an order is never deleted, in any status (so its items and its
--         source_quotation_id link cannot be removed by a cascade either)
--
--   * Composite foreign keys (organization_id, …) tie an order to a customer
--     and a source quotation of the same organization, and an item to an
--     order and a product of the same organization.
--
--   * Numbering: next_document_number(org, 'sales_order') -> SO-000001, …
--     (per-organization counter row, transactional, no MAX + 1).
--
--   * Conversion: one accepted quotation -> at most one sales order, enforced
--     by unique (organization_id, source_quotation_id). Directly created
--     orders have source_quotation_id NULL and are unaffected (NULLs are
--     distinct). Conversion copies the quotation's snapshots and stored
--     amounts; it does not re-read customers or products, so a customer or
--     product deactivated after acceptance does not block it.
--
--   * Draft edits re-snapshot only what changes:
--       - same customer_id as before: the customer snapshot is kept (the
--         customer need not be active); a different customer must be active
--         and is snapshotted from current master data
--       - an item may carry "id" = an existing line of this order. If its
--         product_id is unchanged, that line's product snapshot (name, SKU,
--         unit) is kept and its unit price and description are the defaults;
--         the product need not be active. Any other item is a new selection:
--         active product, snapshot and defaults from current master data
--
--   * Calculation model: identical to quotations (DECISIONS 018).
--
-- Version 1 permissions:
--   owner, manager, employee  view, create, convert, edit draft, confirm
--   owner, manager            complete, cancel
--
-- Validation mirrors lib/sales-orders/validation.ts. Keep the two in sync.
--
-- Requires 20261104090000_quotations.sql (document_number_counters,
-- next_document_number, quotation_parse_decimal, quotations),
-- 20261104100000_restore_whitespace_line_separators.sql (trim_whitespace,
-- text_is_trimmed) and 20261104020000_customers.sql (has_org_role).
-- Changes to existing objects: widens document_number_counters_type_check to
-- allow 'sales_order' (existing rows are all 'quotation' and still pass).
-- No existing column, row, policy or function is changed.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Numbering: allow the new document type
-- -----------------------------------------------------------------------------
alter table public.document_number_counters
  drop constraint document_number_counters_type_check;

alter table public.document_number_counters
  add constraint document_number_counters_type_check
  check (document_type in ('quotation', 'sales_order'));

-- -----------------------------------------------------------------------------
-- Status transitions (V1). The TypeScript twin is SALES_ORDER_TRANSITIONS in
-- lib/sales-orders/validation.ts. completed and cancelled are terminal.
-- -----------------------------------------------------------------------------
create or replace function public.sales_order_status_transition_allowed(
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
    ('draft',     'confirmed'),
    ('draft',     'cancelled'),
    ('confirmed', 'completed'),
    ('confirmed', 'cancelled')
  );
$$;

revoke all on function public.sales_order_status_transition_allowed(text, text) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- sales_orders
-- -----------------------------------------------------------------------------
create table public.sales_orders (
  id                      uuid primary key default gen_random_uuid(),
  organization_id         uuid not null references public.organizations (id) on delete cascade,
  sales_order_number      text not null,
  customer_id             uuid not null,

  -- The accepted quotation this order was converted from; NULL when created
  -- directly. Set only by create_sales_order_from_quotation(); never changes.
  source_quotation_id     uuid,

  -- Customer snapshot (from customers, or from the source quotation).
  customer_name           text not null,
  customer_company_name   text,
  customer_phone          text,
  customer_email          text,
  customer_address        text,
  customer_tax_number     text,

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

  -- Target of the sales_order_items composite foreign key.
  constraint sales_orders_org_id_key
    unique (organization_id, id),

  constraint sales_orders_org_number_key
    unique (organization_id, sales_order_number),

  -- One sales order per quotation. NULLs are distinct, so direct orders
  -- (source_quotation_id NULL) are not limited. Also serves the FK below.
  constraint sales_orders_source_quotation_key
    unique (organization_id, source_quotation_id),

  constraint sales_orders_customer_fkey
    foreign key (organization_id, customer_id)
    references public.customers (organization_id, id),

  -- The source quotation must belong to the order's organization. MATCH
  -- SIMPLE: not checked when source_quotation_id is NULL.
  constraint sales_orders_source_quotation_fkey
    foreign key (organization_id, source_quotation_id)
    references public.quotations (organization_id, id),

  constraint sales_orders_status_check
    check (status in ('draft', 'confirmed', 'completed', 'cancelled')),

  constraint sales_orders_number_check
    check (sales_order_number ~ '^SO-[0-9]{6,}$'),

  constraint sales_orders_customer_name_check
    check (char_length(customer_name) between 1 and 200),

  constraint sales_orders_dates_check
    check (isfinite(order_date)
           and (expected_delivery_date is null
                or (isfinite(expected_delivery_date)
                    and expected_delivery_date >= order_date))),

  constraint sales_orders_notes_check
    check (notes is null or (
      char_length(notes) between 1 and 2000
      and public.text_is_trimmed(notes))),

  constraint sales_orders_totals_check
    check (subtotal >= 0 and subtotal <> 'NaN'::numeric
           and discount_total >= 0 and discount_total <= subtotal
           and tax_total >= 0 and tax_total <> 'NaN'::numeric
           and grand_total = subtotal - discount_total + tax_total)
);

create index sales_orders_org_created_idx
  on public.sales_orders (organization_id, created_at desc, id desc);

create index sales_orders_org_status_created_idx
  on public.sales_orders (organization_id, status, created_at desc, id desc);

create index sales_orders_org_date_idx
  on public.sales_orders (organization_id, order_date desc);

create index sales_orders_org_customer_idx
  on public.sales_orders (organization_id, customer_id);

create index sales_orders_created_by_idx
  on public.sales_orders (created_by);

create trigger sales_orders_set_updated_at
  before update on public.sales_orders
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- sales_order_items
-- -----------------------------------------------------------------------------
create table public.sales_order_items (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  sales_order_id   uuid not null,
  product_id       uuid not null,

  -- Product snapshot (from products, the source quotation, or a kept line).
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

  constraint sales_order_items_sales_order_fkey
    foreign key (organization_id, sales_order_id)
    references public.sales_orders (organization_id, id)
    on delete cascade,

  constraint sales_order_items_product_fkey
    foreign key (organization_id, product_id)
    references public.products (organization_id, id),

  constraint sales_order_items_product_name_check
    check (char_length(product_name) between 1 and 200),

  constraint sales_order_items_sku_check
    check (char_length(sku) between 1 and 100),

  constraint sales_order_items_unit_check
    check (char_length(unit) between 1 and 50),

  constraint sales_order_items_description_check
    check (description is null or (
      char_length(description) between 1 and 2000
      and public.text_is_trimmed(description))),

  constraint sales_order_items_sort_order_check
    check (sort_order between 1 and 100),

  constraint sales_order_items_quantity_check
    check (quantity > 0 and quantity <> 'NaN'::numeric),

  constraint sales_order_items_unit_price_check
    check (unit_price >= 0 and unit_price <> 'NaN'::numeric),

  constraint sales_order_items_tax_rate_check
    check (tax_rate >= 0 and tax_rate <= 100),

  -- Same calculation model as quotation_items_amounts_check.
  constraint sales_order_items_amounts_check
    check (discount_amount >= 0
           and discount_amount <= round(quantity * unit_price, 2)
           and tax_amount = round((round(quantity * unit_price, 2) - discount_amount)
                                  * tax_rate * 0.01, 2)
           and line_total = round(quantity * unit_price, 2) - discount_amount + tax_amount)
);

create unique index sales_order_items_order_sort_key
  on public.sales_order_items (organization_id, sales_order_id, sort_order);

create index sales_order_items_org_product_idx
  on public.sales_order_items (organization_id, product_id);

create trigger sales_order_items_set_updated_at
  before update on public.sales_order_items
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- Privileges and RLS: read-only for clients.
-- -----------------------------------------------------------------------------
revoke all on table public.sales_orders, public.sales_order_items from anon, authenticated;
grant select on table public.sales_orders, public.sales_order_items to authenticated;

alter table public.sales_orders enable row level security;
alter table public.sales_order_items enable row level security;

create policy "sales_orders: read as active member"
  on public.sales_orders for select
  to authenticated
  using (public.is_org_member(organization_id));

create policy "sales_order_items: read as active member"
  on public.sales_order_items for select
  to authenticated
  using (public.is_org_member(organization_id));

-- There are deliberately no INSERT, UPDATE or DELETE policies or privileges.

-- -----------------------------------------------------------------------------
-- Document rules (triggers), for every writer.
-- -----------------------------------------------------------------------------
create or replace function public.sales_orders_enforce_rules()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Sales orders are never hard-deleted, whatever their status (V1). This
  -- runs before the item cascade starts, so a delete cannot remove an order,
  -- its items, or its source_quotation_id link (which would allow converting
  -- the quotation again). It also blocks the organizations ON DELETE CASCADE:
  -- an organization purge, if ever needed, must be an explicit workflow.
  if tg_op = 'DELETE' then
    raise exception 'sales orders cannot be deleted' using errcode = '55000';
  end if;

  if new.organization_id is distinct from old.organization_id
     or new.sales_order_number is distinct from old.sales_order_number
     or new.source_quotation_id is distinct from old.source_quotation_id
     or new.created_at is distinct from old.created_at
     or (new.created_by is distinct from old.created_by and new.created_by is not null)
  then
    raise exception 'sales order identity cannot change' using errcode = '55000';
  end if;

  if new.status is distinct from old.status
     and not public.sales_order_status_transition_allowed(old.status, new.status)
  then
    raise exception 'invalid sales order status transition from % to %', old.status, new.status
      using errcode = '55000';
  end if;

  -- After draft, only the status may change (whole-row comparison covers
  -- future columns too).
  if old.status <> 'draft'
     and (to_jsonb(new) - 'status' - 'updated_at' - 'created_by')
         is distinct from
         (to_jsonb(old) - 'status' - 'updated_at' - 'created_by')
  then
    raise exception 'sales order is not a draft' using errcode = '55000';
  end if;

  return new;
end;
$$;

revoke all on function public.sales_orders_enforce_rules() from public, anon, authenticated;

create trigger sales_orders_enforce_rules
  before update or delete on public.sales_orders
  for each row execute function public.sales_orders_enforce_rules();

-- Items may only be written while their order is a draft. A missing parent
-- is let through (INSERT: the FK rejects it; DELETE: cascade from the order).
create or replace function public.sales_order_items_enforce_draft()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_status text;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    select so.status into v_status from public.sales_orders so where so.id = old.sales_order_id;
    if found and v_status <> 'draft' then
      raise exception 'sales order is not a draft' using errcode = '55000';
    end if;
  end if;

  if tg_op in ('INSERT', 'UPDATE') then
    select so.status into v_status from public.sales_orders so where so.id = new.sales_order_id;
    if found and v_status <> 'draft' then
      raise exception 'sales order is not a draft' using errcode = '55000';
    end if;
    return new;
  end if;

  return old;
end;
$$;

revoke all on function public.sales_order_items_enforce_draft() from public, anon, authenticated;

create trigger sales_order_items_enforce_draft
  before insert or update or delete on public.sales_order_items
  for each row execute function public.sales_order_items_enforce_draft();

-- -----------------------------------------------------------------------------
-- Internal helpers (no client EXECUTE)
-- -----------------------------------------------------------------------------

-- Validates the header input and returns the normalized notes.
create or replace function public.sales_order_normalize_header(
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

revoke all on function public.sales_order_normalize_header(date, date, text) from public, anon, authenticated;

-- Replaces all items of a draft sales order with p_items and recomputes the
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
create or replace function public.sales_order_replace_items(
  p_sales_order_id   uuid,
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
    raise exception 'a sales order needs at least one item' using errcode = '22023';
  end if;
  if pg_catalog.jsonb_array_length(p_items) > 100 then
    raise exception 'a sales order can have at most 100 items' using errcode = '22023';
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
  from public.sales_order_items i
  where i.sales_order_id = p_sales_order_id
    and i.organization_id = p_organization_id;

  delete from public.sales_order_items i
  where i.sales_order_id = p_sales_order_id
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
      select p.name, p.sku, p.description, p.unit, p.selling_price, p.status
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
      v_default_price := v_product.selling_price;
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
        raise exception 'item %: unit price is required (the product has no selling price)', v_index
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
    insert into public.sales_order_items (
      organization_id, sales_order_id, product_id,
      product_name, sku, description, unit,
      quantity, unit_price, discount_amount, tax_rate, tax_amount, line_total,
      sort_order
    ) values (
      p_organization_id, p_sales_order_id, v_product_id,
      v_name, v_sku, v_description, v_unit,
      v_quantity, v_unit_price, v_discount, v_tax_rate, v_tax,
      v_gross - v_discount + v_tax,
      v_index
    );
  end loop;

  perform public.sales_order_recompute_totals(p_sales_order_id, p_organization_id);
end;
$$;

-- Totals always come from the stored items.
create or replace function public.sales_order_recompute_totals(
  p_sales_order_id   uuid,
  p_organization_id  uuid
)
returns void
language sql
set search_path = ''
as $$
  update public.sales_orders so
  set subtotal       = t.subtotal,
      discount_total = t.discount_total,
      tax_total      = t.tax_total,
      grand_total    = t.subtotal - t.discount_total + t.tax_total
  from (
    select coalesce(sum(round(i.quantity * i.unit_price, 2)), 0) as subtotal,
           coalesce(sum(i.discount_amount), 0)                   as discount_total,
           coalesce(sum(i.tax_amount), 0)                        as tax_total
    from public.sales_order_items i
    where i.sales_order_id = p_sales_order_id
      and i.organization_id = p_organization_id
  ) t
  where so.id = p_sales_order_id
    and so.organization_id = p_organization_id;
$$;

revoke all on function public.sales_order_recompute_totals(uuid, uuid) from public, anon, authenticated;
revoke all on function public.sales_order_replace_items(uuid, uuid, jsonb) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- create_sales_order: direct create, header + items, atomically. Any active
-- member. The organization is the customer's organization, and only if the
-- caller is an active member of it; the customer must be active.
--
-- Errors (SQLSTATE):
--   42501  not authenticated
--   23503  customer / product not found (any tenant) or inactive
--   22023  invalid input (dates, notes, items, quantities, prices, …)
--   22003  an amount exceeds numeric(18,2)
-- Returns the new sales order's id.
-- -----------------------------------------------------------------------------
create or replace function public.create_sales_order(
  p_customer_id             uuid,
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
  v_customer  record;
  v_notes     text;
  v_seq       bigint;
  v_id        uuid;
begin
  if v_user_id is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  select c.organization_id, c.name, c.company_name, c.phone, c.email,
         c.address, c.tax_number, c.status
  into v_customer
  from public.customers c
  join public.organization_members m
    on m.organization_id = c.organization_id
   and m.user_id = v_user_id
   and m.status = 'active'
   and m.role in ('owner', 'manager', 'employee')
  where c.id = p_customer_id;

  if not found then
    raise exception 'customer not found' using errcode = '23503';
  end if;
  if v_customer.status <> 'active' then
    raise exception 'customer is inactive' using errcode = '23503';
  end if;

  v_notes := public.sales_order_normalize_header(p_order_date, p_expected_delivery_date, p_notes);

  v_seq := public.next_document_number(v_customer.organization_id, 'sales_order');

  insert into public.sales_orders (
    organization_id, sales_order_number, customer_id, source_quotation_id,
    customer_name, customer_company_name, customer_phone, customer_email,
    customer_address, customer_tax_number,
    order_date, expected_delivery_date, status, notes, created_by
  ) values (
    v_customer.organization_id,
    'SO-' || lpad(v_seq::text, greatest(6, length(v_seq::text)), '0'),
    p_customer_id, null,
    v_customer.name, v_customer.company_name, v_customer.phone, v_customer.email,
    v_customer.address, v_customer.tax_number,
    p_order_date, p_expected_delivery_date, 'draft', v_notes, v_user_id
  )
  returning id into v_id;

  perform public.sales_order_replace_items(v_id, v_customer.organization_id, p_items);

  return v_id;
end;
$$;

revoke all on function public.create_sales_order(uuid, date, date, text, jsonb) from public, anon;
grant execute on function public.create_sales_order(uuid, date, date, text, jsonb) to authenticated;

-- -----------------------------------------------------------------------------
-- create_sales_order_from_quotation: accepted quotation -> draft sales order.
-- Any active member.
--
-- Copies the quotation's customer reference and snapshot, notes, and every
-- line (product reference, snapshot, quantity, price, discount, tax rate,
-- amounts, order) as stored on the quotation. Customers and products are not
-- re-read, so later renames, price changes or deactivation do not matter.
-- The quotation itself is not modified.
--
-- Order of checks:
--   1. caller is authenticated                                   else 42501
--   2. quotation found through the caller's active membership.
--      Missing, other tenant, disabled member                    -> P0002
--   3. quotation status is 'accepted'                            else 55000
--   4. header input (order date, expected delivery date)         else 22023
--   5. not converted before                                      else 23505
--      (unique (organization_id, source_quotation_id) is the final guard
--      under concurrency: a second concurrent conversion waits for the
--      first and then fails with 23505, rolling back its number)
--   6. number, header, items, totals; totals must equal the quotation's
-- -----------------------------------------------------------------------------
create or replace function public.create_sales_order_from_quotation(
  p_quotation_id            uuid,
  p_order_date              date,
  p_expected_delivery_date  date default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id     uuid := (select auth.uid());
  v_quote       record;
  v_notes       text;
  v_seq         bigint;
  v_id          uuid;
  v_constraint  text;
  v_totals      record;
begin
  if v_user_id is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  select q.id, q.organization_id, q.status, q.customer_id,
         q.customer_name, q.customer_company_name, q.customer_phone, q.customer_email,
         q.customer_address, q.customer_tax_number, q.notes,
         q.subtotal, q.discount_total, q.tax_total, q.grand_total
  into v_quote
  from public.quotations q
  join public.organization_members m
    on m.organization_id = q.organization_id
   and m.user_id = v_user_id
   and m.status = 'active'
   and m.role in ('owner', 'manager', 'employee')
  where q.id = p_quotation_id;

  if not found then
    raise exception 'quotation not found' using errcode = 'P0002';
  end if;

  -- accepted is terminal, so the status read here cannot change afterwards.
  if v_quote.status <> 'accepted' then
    raise exception 'only an accepted quotation can be converted (status is %)', v_quote.status
      using errcode = '55000';
  end if;

  v_notes := public.sales_order_normalize_header(p_order_date, p_expected_delivery_date, v_quote.notes);

  if exists (
    select 1 from public.sales_orders so
    where so.organization_id = v_quote.organization_id
      and so.source_quotation_id = v_quote.id
  ) then
    raise exception 'quotation has already been converted to a sales order' using errcode = '23505';
  end if;

  v_seq := public.next_document_number(v_quote.organization_id, 'sales_order');

  begin
    insert into public.sales_orders (
      organization_id, sales_order_number, customer_id, source_quotation_id,
      customer_name, customer_company_name, customer_phone, customer_email,
      customer_address, customer_tax_number,
      order_date, expected_delivery_date, status, notes, created_by
    ) values (
      v_quote.organization_id,
      'SO-' || lpad(v_seq::text, greatest(6, length(v_seq::text)), '0'),
      v_quote.customer_id, v_quote.id,
      v_quote.customer_name, v_quote.customer_company_name, v_quote.customer_phone,
      v_quote.customer_email, v_quote.customer_address, v_quote.customer_tax_number,
      p_order_date, p_expected_delivery_date, 'draft', v_notes, v_user_id
    )
    returning id into v_id;
  exception when unique_violation then
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint = 'sales_orders_source_quotation_key' then
      raise exception 'quotation has already been converted to a sales order' using errcode = '23505';
    end if;
    raise;
  end;

  insert into public.sales_order_items (
    organization_id, sales_order_id, product_id,
    product_name, sku, description, unit,
    quantity, unit_price, discount_amount, tax_rate, tax_amount, line_total,
    sort_order
  )
  select i.organization_id, v_id, i.product_id,
         i.product_name, i.sku, i.description, i.unit,
         i.quantity, i.unit_price, i.discount_amount, i.tax_rate, i.tax_amount, i.line_total,
         i.sort_order
  from public.quotation_items i
  where i.quotation_id = v_quote.id
    and i.organization_id = v_quote.organization_id
  order by i.sort_order, i.id;

  if not found then
    raise exception 'quotation has no items' using errcode = '22023';
  end if;

  perform public.sales_order_recompute_totals(v_id, v_quote.organization_id);

  -- The items carry the quotation's amounts (and the CHECK constraints prove
  -- each line), so the recomputed totals must equal the quotation's.
  select so.subtotal, so.discount_total, so.tax_total, so.grand_total
  into v_totals
  from public.sales_orders so
  where so.id = v_id;

  if (v_totals.subtotal, v_totals.discount_total, v_totals.tax_total, v_totals.grand_total)
     is distinct from
     (v_quote.subtotal, v_quote.discount_total, v_quote.tax_total, v_quote.grand_total)
  then
    raise exception 'quotation totals are inconsistent with its items' using errcode = '23514';
  end if;

  return v_id;
end;
$$;

revoke all on function public.create_sales_order_from_quotation(uuid, date, date) from public, anon;
grant execute on function public.create_sales_order_from_quotation(uuid, date, date) to authenticated;

-- -----------------------------------------------------------------------------
-- update_sales_order_draft: header + full item replacement. Any active
-- member, draft only. Works the same for direct and converted orders; the
-- source quotation is never touched.
--
-- Order of checks:
--   1. caller is authenticated                                   else 42501
--   2. authorization-scoped lookup through the caller's active
--      membership, without a row lock. Missing, other tenant,
--      disabled member                                           -> P0002
--   3. header input                                              else 22023
--   4. lock the (authorized) order row; must be draft            else 55000
--   5. customer: unchanged -> snapshot kept; changed -> same
--      organization and active, fresh snapshot                   else 23503
--   6. write header, replace items, recompute totals
-- -----------------------------------------------------------------------------
create or replace function public.update_sales_order_draft(
  p_sales_order_id          uuid,
  p_customer_id             uuid,
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
  v_customer     record;
  v_notes        text;
begin
  if v_user_id is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  select so.organization_id into v_org_id
  from public.sales_orders so
  join public.organization_members m
    on m.organization_id = so.organization_id
   and m.user_id = v_user_id
   and m.status = 'active'
   and m.role in ('owner', 'manager', 'employee')
  where so.id = p_sales_order_id;

  if not found then
    raise exception 'sales order not found' using errcode = 'P0002';
  end if;

  v_notes := public.sales_order_normalize_header(p_order_date, p_expected_delivery_date, p_notes);

  -- Authorized row only; waits for a concurrent change and then sees it.
  select so.status, so.customer_id into v_current
  from public.sales_orders so
  where so.id = p_sales_order_id
    and so.organization_id = v_org_id
  for update;

  if v_current.status is distinct from 'draft' then
    raise exception 'sales order is not a draft' using errcode = '55000';
  end if;

  if p_customer_id is distinct from v_current.customer_id then
    select c.name, c.company_name, c.phone, c.email, c.address, c.tax_number, c.status
    into v_customer
    from public.customers c
    where c.id = p_customer_id
      and c.organization_id = v_org_id;

    if not found then
      raise exception 'customer not found' using errcode = '23503';
    end if;
    if v_customer.status <> 'active' then
      raise exception 'customer is inactive' using errcode = '23503';
    end if;

    update public.sales_orders so
    set customer_id           = p_customer_id,
        customer_name         = v_customer.name,
        customer_company_name = v_customer.company_name,
        customer_phone        = v_customer.phone,
        customer_email        = v_customer.email,
        customer_address      = v_customer.address,
        customer_tax_number   = v_customer.tax_number
    where so.id = p_sales_order_id
      and so.organization_id = v_org_id;
  end if;

  update public.sales_orders so
  set order_date             = p_order_date,
      expected_delivery_date = p_expected_delivery_date,
      notes                  = v_notes
  where so.id = p_sales_order_id
    and so.organization_id = v_org_id;

  perform public.sales_order_replace_items(p_sales_order_id, v_org_id, p_items);
end;
$$;

revoke all on function public.update_sales_order_draft(uuid, uuid, date, date, text, jsonb) from public, anon;
grant execute on function public.update_sales_order_draft(uuid, uuid, date, date, text, jsonb) to authenticated;

-- -----------------------------------------------------------------------------
-- set_sales_order_status: the only way to change a sales order's status.
--
--   confirmed             any active member (from draft)
--   completed, cancelled  owner or manager
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
create or replace function public.set_sales_order_status(
  p_sales_order_id  uuid,
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
     or p_status not in ('confirmed', 'completed', 'cancelled') then
    raise exception 'invalid sales order status' using errcode = '22023';
  end if;

  v_roles := case when p_status = 'confirmed'
                  then array['owner', 'manager', 'employee']
                  else array['owner', 'manager'] end;

  select m.role into v_role
  from public.sales_orders so
  join public.organization_members m
    on m.organization_id = so.organization_id
  where so.id = p_sales_order_id
    and m.user_id = v_user_id
    and m.status = 'active';

  if not found then
    raise exception 'sales order not found' using errcode = 'P0002';
  end if;

  if not (v_role = any (v_roles)) then
    raise exception 'not allowed to change sales order status to %', p_status
      using errcode = '42501';
  end if;

  select so.status into v_current
  from public.sales_orders so
  where so.id = p_sales_order_id
    and public.has_org_role(so.organization_id, v_roles)
  for update;

  if not found then
    raise exception 'sales order not found' using errcode = 'P0002';
  end if;

  if not public.sales_order_status_transition_allowed(v_current, p_status) then
    raise exception 'invalid sales order status transition from % to %', v_current, p_status
      using errcode = '55000';
  end if;

  update public.sales_orders so
  set status = p_status
  where so.id = p_sales_order_id;
end;
$$;

revoke all on function public.set_sales_order_status(uuid, text) from public, anon;
grant execute on function public.set_sales_order_status(uuid, text) to authenticated;

-- -----------------------------------------------------------------------------
-- get_sales_order: one sales order with its items, read in ONE statement
-- (DECISIONS 020). SECURITY INVOKER, so RLS applies; p_organization_id is an
-- extra filter that never widens access. NULL when not visible. Money,
-- quantities and rates are JSON strings. source_quotation_number is the
-- source quotation's number (same organization, also under RLS).
-- -----------------------------------------------------------------------------
create or replace function public.get_sales_order(
  p_organization_id  uuid,
  p_sales_order_id   uuid
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'id',                      so.id,
    'sales_order_number',      so.sales_order_number,
    'customer_id',             so.customer_id,
    'source_quotation_id',     so.source_quotation_id,
    'source_quotation_number', (
      select q.quotation_number from public.quotations q
      where q.organization_id = so.organization_id
        and q.id = so.source_quotation_id),
    'customer_name',           so.customer_name,
    'customer_company_name',   so.customer_company_name,
    'customer_phone',          so.customer_phone,
    'customer_email',          so.customer_email,
    'customer_address',        so.customer_address,
    'customer_tax_number',     so.customer_tax_number,
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
      from public.sales_order_items i
      where i.organization_id = so.organization_id
        and i.sales_order_id = so.id
    ), '[]'::jsonb)
  )
  from public.sales_orders so
  where so.id = p_sales_order_id
    and so.organization_id = p_organization_id;
$$;

revoke all on function public.get_sales_order(uuid, uuid) from public, anon;
grant execute on function public.get_sales_order(uuid, uuid) to authenticated;
