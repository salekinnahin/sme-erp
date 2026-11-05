-- =============================================================================
-- Quotations (Phase 4, Part 1): database, numbering, calculations, status
-- model and security. No UI.
--
-- Design (docs/DECISIONS.md 017, 018; docs/DATA_MODEL.md § quotations):
--
--   * Clients can only READ quotations and quotation_items (RLS on active
--     membership). There is no INSERT, UPDATE or DELETE privilege. Every write
--     goes through three SECURITY DEFINER functions:
--       create_quotation()        header + items in one transaction
--       update_quotation_draft()  header + full item replacement, draft only
--       set_quotation_status()    role- and transition-checked status change
--     They derive organization_id, created_by, the quotation number, the
--     customer and product snapshots, every line amount and every total.
--     Nothing the browser sends for those is trusted, or even accepted.
--
--   * Triggers enforce the document rules underneath the functions, so a
--     future write path cannot bypass them either:
--       - identity columns (organization_id, quotation_number, created_at,
--         created_by) never change; created_by may only become NULL (auth
--         user deleted, ON DELETE SET NULL)
--       - status changes follow the V1 transition table only
--       - once a quotation is not 'draft', nothing but its status may change,
--         and its items cannot be inserted, updated or deleted
--
--   * Tenant safety does not depend on RLS for references. Composite foreign
--     keys (organization_id, …) tie a quotation to a customer of the same
--     organization and an item to a quotation and a product of the same
--     organization. Foreign-key checks bypass RLS, so plain id foreign keys
--     would let one tenant reference (and probe) another tenant's rows.
--     This needs unique (organization_id, id) on customers and products,
--     added below (additive; existing rows already satisfy it, since id is
--     the primary key).
--
--   * Numbering: one counter row per (organization, document type) in
--     document_number_counters, incremented with INSERT … ON CONFLICT DO
--     UPDATE … RETURNING. The row lock serializes concurrent creates in the
--     same organization, and a rolled-back create also rolls back its
--     increment, so numbers have no gaps from failed creates. No MAX + 1, no
--     non-transactional sequences.
--
--   * Money is numeric(18,2), quantity numeric(18,3), tax rate numeric(5,2).
--     Line calculation (all values are non-negative; round() on numeric
--     rounds half away from zero, i.e. half up here):
--       gross      = round(quantity * unit_price, 2)
--       taxable    = gross - discount_amount        (discount <= gross)
--       tax_amount = round(taxable * tax_rate * 0.01, 2)
--       line_total = taxable + tax_amount
--     "* 0.01" instead of "/ 100": numeric multiplication is exact, while
--     numeric division may round to a limited scale first (double rounding).
--     Totals: subtotal = sum(gross), discount_total = sum(discount),
--     tax_total = sum(tax_amount), grand_total = subtotal - discount_total
--     + tax_total. CHECK constraints keep every item row consistent with
--     this formula; the functions compute header totals from the stored items.
--     lib/quotations/calculations.ts implements the same rules on decimal
--     strings with BigInt. Keep the two in sync.
--
-- Version 1 permissions:
--   owner, manager, employee  view, create, edit draft, mark sent
--   owner, manager            accept, reject, expire, cancel
--
-- Validation mirrors lib/quotations/validation.ts. Keep the two in sync.
--
-- Requires 20261104030000_harden_customer_validation.sql (text helpers),
-- 20261104020000_customers.sql (has_org_role) and 20261104070000_products.sql.
-- Changes to existing objects: adds unique (organization_id, id) to
-- customers and products. No existing column, row, policy or function is
-- changed.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Targets for the composite same-organization foreign keys
-- -----------------------------------------------------------------------------
alter table public.customers
  add constraint customers_org_id_key unique (organization_id, id);

alter table public.products
  add constraint products_org_id_key unique (organization_id, id);

-- -----------------------------------------------------------------------------
-- document_number_counters: per-organization document numbering
--
-- Internal. No client privileges and no policies; only the SECURITY DEFINER
-- functions (running as the table owner) read or write it.
-- -----------------------------------------------------------------------------
create table public.document_number_counters (
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  document_type    text not null,
  last_value       bigint not null,
  updated_at       timestamptz not null default now(),

  constraint document_number_counters_pkey
    primary key (organization_id, document_type),

  -- Extend this list when sales orders, invoices, … get numbers.
  constraint document_number_counters_type_check
    check (document_type in ('quotation')),

  constraint document_number_counters_value_check
    check (last_value >= 1)
);

revoke all on table public.document_number_counters from anon, authenticated;
alter table public.document_number_counters enable row level security;
-- Deliberately no policies: clients have no access at all.

-- Next number for (organization, document type). Concurrency safe: the
-- upsert takes a row lock on the counter, which is held until the calling
-- transaction ends, so two creates in the same organization get different
-- numbers, and a rollback releases the number again.
create or replace function public.next_document_number(
  p_organization_id  uuid,
  p_document_type    text
)
returns bigint
language sql
volatile
set search_path = ''
as $$
  insert into public.document_number_counters as c
    (organization_id, document_type, last_value)
  values (p_organization_id, p_document_type, 1)
  on conflict (organization_id, document_type)
  do update set last_value = c.last_value + 1, updated_at = now()
  returning c.last_value;
$$;

revoke all on function public.next_document_number(uuid, text) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- Status transitions (V1). The single source of truth in SQL; the TypeScript
-- twin is QUOTATION_TRANSITIONS in lib/quotations/validation.ts.
-- accepted, rejected, expired and cancelled are terminal.
-- -----------------------------------------------------------------------------
create or replace function public.quotation_status_transition_allowed(
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
    ('draft', 'sent'),
    ('draft', 'cancelled'),
    ('sent',  'accepted'),
    ('sent',  'rejected'),
    ('sent',  'expired'),
    ('sent',  'cancelled')
  );
$$;

revoke all on function public.quotation_status_transition_allowed(text, text) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- quotations
-- -----------------------------------------------------------------------------
create table public.quotations (
  id                     uuid primary key default gen_random_uuid(),
  organization_id        uuid not null references public.organizations (id) on delete cascade,
  quotation_number       text not null,
  customer_id            uuid not null,

  -- Customer snapshot, copied from customers by the database.
  customer_name          text not null,
  customer_company_name  text,
  customer_phone         text,
  customer_email         text,
  customer_address       text,
  customer_tax_number    text,

  quotation_date         date not null,
  expiry_date            date,
  status                 text not null default 'draft',
  notes                  text,

  -- Computed by the database from the items.
  subtotal               numeric(18, 2) not null default 0,
  discount_total         numeric(18, 2) not null default 0,
  tax_total              numeric(18, 2) not null default 0,
  grand_total            numeric(18, 2) not null default 0,

  created_by             uuid references auth.users (id) on delete set null,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),

  -- Target of the quotation_items composite foreign key.
  constraint quotations_org_id_key
    unique (organization_id, id),

  constraint quotations_org_number_key
    unique (organization_id, quotation_number),

  -- The customer must belong to the quotation's organization.
  constraint quotations_customer_fkey
    foreign key (organization_id, customer_id)
    references public.customers (organization_id, id),

  constraint quotations_status_check
    check (status in ('draft', 'sent', 'accepted', 'rejected', 'expired', 'cancelled')),

  constraint quotations_number_check
    check (quotation_number ~ '^QT-[0-9]{6,}$'),

  constraint quotations_customer_name_check
    check (char_length(customer_name) between 1 and 200),

  -- date accepts 'infinity'; a document date must be a real day.
  constraint quotations_dates_check
    check (isfinite(quotation_date)
           and (expiry_date is null
                or (isfinite(expiry_date) and expiry_date >= quotation_date))),

  constraint quotations_notes_check
    check (notes is null or (
      char_length(notes) between 1 and 2000
      and public.text_is_trimmed(notes))),

  constraint quotations_totals_check
    check (subtotal >= 0 and subtotal <> 'NaN'::numeric
           and discount_total >= 0 and discount_total <= subtotal
           and tax_total >= 0 and tax_total <> 'NaN'::numeric
           and grand_total = subtotal - discount_total + tax_total)
);

-- List queries: newest first within an organization (also serves lookups by
-- organization_id alone, e.g. the FK cascade).
create index quotations_org_created_idx
  on public.quotations (organization_id, created_at desc, id desc);

create index quotations_org_status_created_idx
  on public.quotations (organization_id, status, created_at desc, id desc);

create index quotations_org_date_idx
  on public.quotations (organization_id, quotation_date desc);

-- Customer filter, and the composite foreign key.
create index quotations_org_customer_idx
  on public.quotations (organization_id, customer_id);

create index quotations_created_by_idx
  on public.quotations (created_by);

create trigger quotations_set_updated_at
  before update on public.quotations
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- quotation_items
-- -----------------------------------------------------------------------------
create table public.quotation_items (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  quotation_id     uuid not null,
  product_id       uuid not null,

  -- Product snapshot, copied from products by the database.
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

  -- The quotation must belong to the item's organization.
  constraint quotation_items_quotation_fkey
    foreign key (organization_id, quotation_id)
    references public.quotations (organization_id, id)
    on delete cascade,

  -- The product must belong to the item's organization.
  constraint quotation_items_product_fkey
    foreign key (organization_id, product_id)
    references public.products (organization_id, id),

  constraint quotation_items_product_name_check
    check (char_length(product_name) between 1 and 200),

  constraint quotation_items_sku_check
    check (char_length(sku) between 1 and 100),

  constraint quotation_items_unit_check
    check (char_length(unit) between 1 and 50),

  constraint quotation_items_description_check
    check (description is null or (
      char_length(description) between 1 and 2000
      and public.text_is_trimmed(description))),

  constraint quotation_items_sort_order_check
    check (sort_order between 1 and 100),

  -- numeric accepts 'NaN' (and NaN >= 0 is true), so exclude it explicitly.
  constraint quotation_items_quantity_check
    check (quantity > 0 and quantity <> 'NaN'::numeric),

  constraint quotation_items_unit_price_check
    check (unit_price >= 0 and unit_price <> 'NaN'::numeric),

  constraint quotation_items_tax_rate_check
    check (tax_rate >= 0 and tax_rate <= 100),

  -- The line is internally consistent with the calculation model.
  constraint quotation_items_amounts_check
    check (discount_amount >= 0
           and discount_amount <= round(quantity * unit_price, 2)
           and tax_amount = round((round(quantity * unit_price, 2) - discount_amount)
                                  * tax_rate * 0.01, 2)
           and line_total = round(quantity * unit_price, 2) - discount_amount + tax_amount)
);

-- Items of a quotation in order; also the composite FK to quotations.
create unique index quotation_items_quotation_sort_key
  on public.quotation_items (organization_id, quotation_id, sort_order);

-- Composite FK to products.
create index quotation_items_org_product_idx
  on public.quotation_items (organization_id, product_id);

create trigger quotation_items_set_updated_at
  before update on public.quotation_items
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- Privileges and RLS: read-only for clients.
-- Supabase grants ALL on new public tables to API roles by default, so start
-- from nothing.
-- -----------------------------------------------------------------------------
revoke all on table public.quotations, public.quotation_items from anon, authenticated;
grant select on table public.quotations, public.quotation_items to authenticated;

alter table public.quotations enable row level security;
alter table public.quotation_items enable row level security;

create policy "quotations: read as active member"
  on public.quotations for select
  to authenticated
  using (public.is_org_member(organization_id));

create policy "quotation_items: read as active member"
  on public.quotation_items for select
  to authenticated
  using (public.is_org_member(organization_id));

-- There are deliberately no INSERT, UPDATE or DELETE policies or privileges.

-- -----------------------------------------------------------------------------
-- Document rules (triggers). They run for every writer, including the
-- SECURITY DEFINER functions.
-- -----------------------------------------------------------------------------
create or replace function public.quotations_enforce_rules()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.organization_id is distinct from old.organization_id
     or new.quotation_number is distinct from old.quotation_number
     or new.created_at is distinct from old.created_at
     or (new.created_by is distinct from old.created_by and new.created_by is not null)
  then
    raise exception 'quotation identity cannot change' using errcode = '55000';
  end if;

  if new.status is distinct from old.status
     and not public.quotation_status_transition_allowed(old.status, new.status)
  then
    raise exception 'invalid quotation status transition from % to %', old.status, new.status
      using errcode = '55000';
  end if;

  -- After draft, only the status may change. Comparing whole rows (minus
  -- status and bookkeeping columns) keeps future columns immutable too.
  if old.status <> 'draft'
     and (to_jsonb(new) - 'status' - 'updated_at' - 'created_by')
         is distinct from
         (to_jsonb(old) - 'status' - 'updated_at' - 'created_by')
  then
    raise exception 'quotation is not a draft' using errcode = '55000';
  end if;

  return new;
end;
$$;

revoke all on function public.quotations_enforce_rules() from public, anon, authenticated;

create trigger quotations_enforce_rules
  before update on public.quotations
  for each row execute function public.quotations_enforce_rules();

-- Items may only be written while their quotation is a draft. A missing
-- parent is let through: for INSERT the foreign key rejects it, and for
-- DELETE it means the quotation itself is being deleted (organization
-- deletion cascade).
create or replace function public.quotation_items_enforce_draft()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_status text;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    select q.status into v_status from public.quotations q where q.id = old.quotation_id;
    if found and v_status <> 'draft' then
      raise exception 'quotation is not a draft' using errcode = '55000';
    end if;
  end if;

  if tg_op in ('INSERT', 'UPDATE') then
    select q.status into v_status from public.quotations q where q.id = new.quotation_id;
    if found and v_status <> 'draft' then
      raise exception 'quotation is not a draft' using errcode = '55000';
    end if;
    return new;
  end if;

  return old;
end;
$$;

revoke all on function public.quotation_items_enforce_draft() from public, anon, authenticated;

create trigger quotation_items_enforce_draft
  before insert or update or delete on public.quotation_items
  for each row execute function public.quotation_items_enforce_draft();

-- -----------------------------------------------------------------------------
-- Internal helpers (no client EXECUTE)
-- -----------------------------------------------------------------------------

-- A non-negative decimal from a JSON string or number, with at most
-- p_integer_digits digits before and p_scale digits after the point. NULL if
-- the value is missing or malformed. Extra decimals are rejected, never
-- rounded (same as lib/validation/decimal.ts).
create or replace function public.quotation_parse_decimal(
  p_value           jsonb,
  p_integer_digits  integer,
  p_scale           integer
)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select case
    when v.t ~ ('^[0-9]{1,' || p_integer_digits || '}(\.[0-9]{1,' || p_scale || '})?$')
      then v.t::numeric
  end
  from (
    select case pg_catalog.jsonb_typeof(p_value)
      when 'string' then p_value #>> '{}'
      when 'number' then p_value::text
    end as t
  ) v;
$$;

revoke all on function public.quotation_parse_decimal(jsonb, integer, integer) from public, anon, authenticated;

-- Validates the header input and returns the normalized notes.
create or replace function public.quotation_normalize_header(
  p_quotation_date  date,
  p_expiry_date     date,
  p_notes           text
)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_notes text := nullif(public.trim_whitespace(coalesce(p_notes, '')), '');
begin
  if p_quotation_date is null or not isfinite(p_quotation_date) then
    raise exception 'quotation date is required' using errcode = '22023';
  end if;
  if p_expiry_date is not null
     and (not isfinite(p_expiry_date) or p_expiry_date < p_quotation_date) then
    raise exception 'expiry date must be on or after the quotation date' using errcode = '22023';
  end if;
  if char_length(v_notes) > 2000 then
    raise exception 'notes are too long' using errcode = '22023';
  end if;
  return v_notes;
end;
$$;

revoke all on function public.quotation_normalize_header(date, date, text) from public, anon, authenticated;

-- Replaces all items of a draft quotation with p_items and recomputes the
-- header totals from the stored items.
--
-- p_items is a JSON array of 1..100 objects:
--   product_id       uuid, required. Active product of p_organization_id.
--   quantity         decimal string or number, > 0, at most 3 decimals.
--   unit_price       optional; missing or null = the product's selling price.
--   discount_amount  optional, default 0; at most 2 decimals; <= gross.
--   tax_rate         optional, default 0; 0..100, at most 2 decimals.
--   description      optional; key missing = the product's description;
--                    present = that text (trimmed; empty or null = none).
-- Any other key (product_name, sku, unit, totals, …) is ignored: snapshots
-- and amounts always come from the database.
create or replace function public.quotation_replace_items(
  p_quotation_id     uuid,
  p_organization_id  uuid,
  p_items            jsonb
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_item         jsonb;
  v_index        bigint;
  v_product_id   uuid;
  v_product      record;
  v_quantity     numeric;
  v_unit_price   numeric;
  v_discount     numeric;
  v_tax_rate     numeric;
  v_description  text;
  v_gross        numeric;
  v_tax          numeric;
begin
  if p_items is null or pg_catalog.jsonb_typeof(p_items) <> 'array' then
    raise exception 'items must be a JSON array' using errcode = '22023';
  end if;
  if pg_catalog.jsonb_array_length(p_items) < 1 then
    raise exception 'a quotation needs at least one item' using errcode = '22023';
  end if;
  if pg_catalog.jsonb_array_length(p_items) > 100 then
    raise exception 'a quotation can have at most 100 items' using errcode = '22023';
  end if;

  delete from public.quotation_items i
  where i.quotation_id = p_quotation_id
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

    -- Snapshot source. Unknown and other-tenant products look the same.
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

    v_quantity := public.quotation_parse_decimal(v_item -> 'quantity', 15, 3);
    if v_quantity is null or v_quantity <= 0 then
      raise exception 'item %: quantity must be greater than 0 with at most 3 decimals', v_index
        using errcode = '22023';
    end if;

    if coalesce(pg_catalog.jsonb_typeof(v_item -> 'unit_price'), 'null') = 'null' then
      v_unit_price := v_product.selling_price;
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
      v_description := v_product.description;
    end if;

    v_gross := round(v_quantity * v_unit_price, 2);
    if v_discount > v_gross then
      raise exception 'item %: discount cannot exceed the line amount', v_index using errcode = '22023';
    end if;
    v_tax := round((v_gross - v_discount) * v_tax_rate * 0.01, 2);

    -- Overflow of numeric(18,2) raises 22003 here.
    insert into public.quotation_items (
      organization_id, quotation_id, product_id,
      product_name, sku, description, unit,
      quantity, unit_price, discount_amount, tax_rate, tax_amount, line_total,
      sort_order
    ) values (
      p_organization_id, p_quotation_id, v_product_id,
      v_product.name, v_product.sku, v_description, v_product.unit,
      v_quantity, v_unit_price, v_discount, v_tax_rate, v_tax,
      v_gross - v_discount + v_tax,
      v_index
    );
  end loop;

  -- Totals always come from the stored items.
  update public.quotations q
  set subtotal       = t.subtotal,
      discount_total = t.discount_total,
      tax_total      = t.tax_total,
      grand_total    = t.subtotal - t.discount_total + t.tax_total
  from (
    select coalesce(sum(round(i.quantity * i.unit_price, 2)), 0) as subtotal,
           coalesce(sum(i.discount_amount), 0)                   as discount_total,
           coalesce(sum(i.tax_amount), 0)                        as tax_total
    from public.quotation_items i
    where i.quotation_id = p_quotation_id
      and i.organization_id = p_organization_id
  ) t
  where q.id = p_quotation_id
    and q.organization_id = p_organization_id;
end;
$$;

revoke all on function public.quotation_replace_items(uuid, uuid, jsonb) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- create_quotation: header + items, atomically. Any active member.
--
-- The organization is the customer's organization, and only if the caller is
-- an active member of it. Unknown customers, other tenants' customers and
-- customers of an organization where the caller's membership is disabled
-- all fail the same way.
--
-- Errors (SQLSTATE):
--   42501  not authenticated
--   23503  customer / product not found (any tenant) or inactive
--   22023  invalid input (dates, notes, items, quantities, prices, …)
--   22003  an amount exceeds numeric(18,2)
-- Returns the new quotation's id.
-- -----------------------------------------------------------------------------
create or replace function public.create_quotation(
  p_customer_id     uuid,
  p_quotation_date  date,
  p_expiry_date     date,
  p_notes           text,
  p_items           jsonb
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

  -- Every V1 role may create quotations; an active membership is enough.
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

  v_notes := public.quotation_normalize_header(p_quotation_date, p_expiry_date, p_notes);

  v_seq := public.next_document_number(v_customer.organization_id, 'quotation');

  insert into public.quotations (
    organization_id, quotation_number, customer_id,
    customer_name, customer_company_name, customer_phone, customer_email,
    customer_address, customer_tax_number,
    quotation_date, expiry_date, status, notes, created_by
  ) values (
    v_customer.organization_id,
    'QT-' || lpad(v_seq::text, greatest(6, length(v_seq::text)), '0'),
    p_customer_id,
    v_customer.name, v_customer.company_name, v_customer.phone, v_customer.email,
    v_customer.address, v_customer.tax_number,
    p_quotation_date, p_expiry_date, 'draft', v_notes, v_user_id
  )
  returning id into v_id;

  perform public.quotation_replace_items(v_id, v_customer.organization_id, p_items);

  return v_id;
end;
$$;

revoke all on function public.create_quotation(uuid, date, date, text, jsonb) from public, anon;
grant execute on function public.create_quotation(uuid, date, date, text, jsonb) to authenticated;

-- -----------------------------------------------------------------------------
-- update_quotation_draft: header + full item replacement. Any active member,
-- draft only. The customer and product snapshots are taken again from the
-- current master data.
--
-- Order of checks:
--   1. caller is authenticated                                   else 42501
--   2. authorization-scoped lookup through the caller's active
--      membership, without a row lock. Missing, other tenant,
--      disabled member                                           -> P0002
--   3. customer of the same organization and active              else 23503
--   4. header input                                              else 22023
--   5. lock the (authorized) quotation row; must be draft        else 55000
--   6. write header, replace items, recompute totals
-- -----------------------------------------------------------------------------
create or replace function public.update_quotation_draft(
  p_quotation_id    uuid,
  p_customer_id     uuid,
  p_quotation_date  date,
  p_expiry_date     date,
  p_notes           text,
  p_items           jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id   uuid := (select auth.uid());
  v_org_id    uuid;
  v_status    text;
  v_customer  record;
  v_notes     text;
begin
  if v_user_id is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  select q.organization_id into v_org_id
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

  v_notes := public.quotation_normalize_header(p_quotation_date, p_expiry_date, p_notes);

  -- Authorized row only; waits for a concurrent status change and then sees
  -- its result.
  select q.status into v_status
  from public.quotations q
  where q.id = p_quotation_id
    and q.organization_id = v_org_id
  for update;

  if v_status is distinct from 'draft' then
    raise exception 'quotation is not a draft' using errcode = '55000';
  end if;

  update public.quotations q
  set customer_id           = p_customer_id,
      customer_name         = v_customer.name,
      customer_company_name = v_customer.company_name,
      customer_phone        = v_customer.phone,
      customer_email        = v_customer.email,
      customer_address      = v_customer.address,
      customer_tax_number   = v_customer.tax_number,
      quotation_date        = p_quotation_date,
      expiry_date           = p_expiry_date,
      notes                 = v_notes
  where q.id = p_quotation_id
    and q.organization_id = v_org_id;

  perform public.quotation_replace_items(p_quotation_id, v_org_id, p_items);
end;
$$;

revoke all on function public.update_quotation_draft(uuid, uuid, date, date, text, jsonb) from public, anon;
grant execute on function public.update_quotation_draft(uuid, uuid, date, date, text, jsonb) to authenticated;

-- -----------------------------------------------------------------------------
-- set_quotation_status: the only way to change a quotation's status.
--
--   sent                                  any active member (from draft)
--   accepted, rejected, expired, cancelled  owner or manager
--
-- Order of checks:
--   1. caller is authenticated                                   else 42501
--   2. target status is one of the above                         else 22023
--   3. authorization-scoped lookup through the caller's active
--      membership, without a row lock. Missing, other tenant,
--      disabled member                                           -> P0002
--   4. role allowed for the target status                        else 42501
--   5. lock the row, re-checking the role in the same query, so a
--      row the caller may not change is never locked or waited on
--   6. transition allowed from the locked (current) status       else 55000
--      (the trigger checks it again on UPDATE)
-- -----------------------------------------------------------------------------
create or replace function public.set_quotation_status(
  p_quotation_id  uuid,
  p_status        text
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
     or p_status not in ('sent', 'accepted', 'rejected', 'expired', 'cancelled') then
    raise exception 'invalid quotation status' using errcode = '22023';
  end if;

  v_roles := case when p_status = 'sent'
                  then array['owner', 'manager', 'employee']
                  else array['owner', 'manager'] end;

  select m.role into v_role
  from public.quotations q
  join public.organization_members m
    on m.organization_id = q.organization_id
  where q.id = p_quotation_id
    and m.user_id = v_user_id
    and m.status = 'active';

  if not found then
    raise exception 'quotation not found' using errcode = 'P0002';
  end if;

  if not (v_role = any (v_roles)) then
    raise exception 'not allowed to change quotation status to %', p_status
      using errcode = '42501';
  end if;

  -- Lock only a row the caller is authorized for (the role predicate is
  -- evaluated before the lock), then check the transition on the current
  -- status. Repeating the current status is not a transition.
  select q.status into v_current
  from public.quotations q
  where q.id = p_quotation_id
    and public.has_org_role(q.organization_id, v_roles)
  for update;

  if not found then
    -- The membership changed between the lookup and the lock.
    raise exception 'quotation not found' using errcode = 'P0002';
  end if;

  if not public.quotation_status_transition_allowed(v_current, p_status) then
    raise exception 'invalid quotation status transition from % to %', v_current, p_status
      using errcode = '55000';
  end if;

  update public.quotations q
  set status = p_status
  where q.id = p_quotation_id;
end;
$$;

revoke all on function public.set_quotation_status(uuid, text) from public, anon;
grant execute on function public.set_quotation_status(uuid, text) to authenticated;
