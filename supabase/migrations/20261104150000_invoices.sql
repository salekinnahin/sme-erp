-- =============================================================================
-- Invoices (Phase 4, Invoice Management Part 1): database, numbering,
-- calculations, status model, sales order conversion and security. No UI,
-- no payments.
--
-- Same shape as sales orders (docs/DECISIONS.md 017, 018, 020, 022, 023;
-- docs/DATA_MODEL.md § invoices):
--
--   * Clients can only READ invoices and invoice_items (RLS on active
--     membership). There is no INSERT, UPDATE or DELETE privilege. Every write
--     goes through four SECURITY DEFINER functions:
--       create_invoice()                    direct create, header + items
--       create_invoice_from_sales_order()   confirmed sales order -> draft invoice
--       update_invoice_draft()              header + item replacement, draft
--       set_invoice_status()                role- and transition-checked
--     They derive organization_id, created_by, the number,
--     source_sales_order_id, every snapshot, every line amount, every total,
--     amount_paid and amount_due.
--
--   * Triggers enforce the document rules underneath the functions, for every
--     writer:
--       - identity columns (organization_id, invoice_number,
--         source_sales_order_id, created_at, created_by) never change;
--         created_by may only become NULL (auth user deleted)
--       - status changes follow the lifecycle table only (an invoice with
--         payments has no path to cancelled)
--       - once an invoice is not 'draft', nothing but status, amount_paid
--         and amount_due may change, and its items cannot be inserted,
--         updated or deleted
--       - an invoice is never deleted, in any status
--
--   * Balance: amount_due = grand_total - amount_paid (CHECK). The status
--     must agree with the balance (CHECK); 'paid' means amount_due = 0 and
--     amount_paid = grand_total, zero-total invoices included. In Part 1
--     there are no payments: invoices_no_payments_yet_check pins
--     amount_paid = 0 and forbids 'partially_paid' and 'paid' for any writer.
--
--   * A sales order with an invoice cannot be cancelled (trigger
--     sales_orders_block_invoiced_cancel); it may still be completed. The Payment module's
--     migration drops that one constraint and moves the status from its own
--     SECURITY DEFINER function.
--
--   * Composite foreign keys (organization_id, …) tie an invoice to a
--     customer and a source sales order of the same organization, and an
--     item to an invoice and a product of the same organization.
--
--   * Numbering: next_document_number(org, 'invoice') -> INV-000001, …
--     (per-organization counter row, transactional, no MAX + 1).
--
--   * Conversion: one confirmed sales order -> at most one invoice ever,
--     enforced by unique (organization_id, source_sales_order_id). Direct
--     invoices have source_sales_order_id NULL and are unaffected. Conversion
--     copies the sales order's snapshots and stored amounts; it does not
--     re-read customers or products, so a customer or product deactivated
--     after confirmation does not block it. The sales order is not modified.
--
--   * Draft edits re-snapshot only what changes (same rule as sales orders):
--       - same customer_id: snapshot kept (customer may be inactive); a
--         different customer must be active and is snapshotted fresh
--       - an item may carry "id" = an existing line of this invoice, as an
--         edit/reference token for this save only. Same product_id: the
--         line's snapshot, price and description are kept as defaults (the
--         product may be inactive). Anything else is a new selection.
--
--   * Calculation model: identical to quotations (DECISIONS 018).
--
-- Version 1 permissions:
--   owner, manager, employee  view, create, convert, edit draft, issue
--   owner, manager            cancel
--   nobody (API)              partially_paid, paid (reserved for payments)
--
-- Validation mirrors lib/invoices/validation.ts. Keep the two in sync.
--
-- Requires 20261104130000_sales_orders.sql (sales_orders, its
-- (organization_id, id) key), 20261104090000_quotations.sql
-- (document_number_counters, next_document_number, quotation_parse_decimal),
-- 20261104100000_restore_whitespace_line_separators.sql (trim_whitespace,
-- text_is_trimmed) and 20261104020000_customers.sql (has_org_role).
-- Changes to existing objects: widens document_number_counters_type_check to
-- allow 'invoice' (existing rows are 'quotation' / 'sales_order' and still
-- pass), and adds the trigger sales_orders_block_invoiced_cancel on
-- sales_orders. No existing column, row, policy or function is changed.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Numbering: allow the new document type
-- -----------------------------------------------------------------------------
alter table public.document_number_counters
  drop constraint document_number_counters_type_check;

alter table public.document_number_counters
  add constraint document_number_counters_type_check
  check (document_type in ('quotation', 'sales_order', 'invoice'));

-- -----------------------------------------------------------------------------
-- Status lifecycle. The TypeScript twin is INVOICE_TRANSITIONS in
-- lib/invoices/validation.ts.
--
--   user transitions (set_invoice_status):
--     draft  -> issued | cancelled
--     issued -> cancelled
--   system transitions (reserved for the future Payment module; not reachable
--   in Part 1 because invoices_no_payments_yet_check pins amount_paid = 0):
--     issued         -> partially_paid | paid
--     partially_paid -> paid
--
-- paid and cancelled are terminal.
-- -----------------------------------------------------------------------------
create or replace function public.invoice_status_transition_allowed(
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
    ('draft',          'issued'),
    ('draft',          'cancelled'),
    ('issued',         'cancelled'),
    ('issued',         'partially_paid'),
    ('issued',         'paid'),
    ('partially_paid', 'paid')
  );
$$;

revoke all on function public.invoice_status_transition_allowed(text, text) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- invoices
-- -----------------------------------------------------------------------------
create table public.invoices (
  id                      uuid primary key default gen_random_uuid(),
  organization_id         uuid not null references public.organizations (id) on delete cascade,
  invoice_number          text not null,
  customer_id             uuid not null,

  -- The confirmed sales order this invoice was converted from; NULL when
  -- created directly. Set only by create_invoice_from_sales_order(); never
  -- changes.
  source_sales_order_id   uuid,

  -- Customer snapshot (from customers, or from the source sales order).
  customer_name           text not null,
  customer_company_name   text,
  customer_phone          text,
  customer_email          text,
  customer_address        text,
  customer_tax_number     text,

  invoice_date            date not null,
  due_date                date,
  status                  text not null default 'draft',
  notes                   text,

  -- Computed by the database from the items.
  subtotal                numeric(18, 2) not null default 0,
  discount_total          numeric(18, 2) not null default 0,
  tax_total               numeric(18, 2) not null default 0,
  grand_total             numeric(18, 2) not null default 0,

  -- Reserved for the Payment module. Part 1: always 0 / grand_total.
  amount_paid             numeric(18, 2) not null default 0,
  amount_due              numeric(18, 2) not null default 0,

  created_by              uuid references auth.users (id) on delete set null,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),

  -- Target of the invoice_items composite foreign key.
  constraint invoices_org_id_key
    unique (organization_id, id),

  constraint invoices_org_number_key
    unique (organization_id, invoice_number),

  -- One invoice per sales order, ever (a cancelled invoice still counts).
  -- NULLs are distinct, so direct invoices are not limited. Also serves the
  -- FK below.
  constraint invoices_source_sales_order_key
    unique (organization_id, source_sales_order_id),

  constraint invoices_customer_fkey
    foreign key (organization_id, customer_id)
    references public.customers (organization_id, id),

  -- MATCH SIMPLE: not checked when source_sales_order_id is NULL.
  constraint invoices_source_sales_order_fkey
    foreign key (organization_id, source_sales_order_id)
    references public.sales_orders (organization_id, id),

  constraint invoices_status_check
    check (status in ('draft', 'issued', 'partially_paid', 'paid', 'cancelled')),

  constraint invoices_number_check
    check (invoice_number ~ '^INV-[0-9]{6,}$'),

  constraint invoices_customer_name_check
    check (char_length(customer_name) between 1 and 200),

  constraint invoices_dates_check
    check (isfinite(invoice_date)
           and (due_date is null
                or (isfinite(due_date) and due_date >= invoice_date))),

  constraint invoices_notes_check
    check (notes is null or (
      char_length(notes) between 1 and 2000
      and public.text_is_trimmed(notes))),

  constraint invoices_totals_check
    check (subtotal >= 0 and subtotal <> 'NaN'::numeric
           and discount_total >= 0 and discount_total <= subtotal
           and tax_total >= 0 and tax_total <> 'NaN'::numeric
           and grand_total = subtotal - discount_total + tax_total),

  -- Durable: no overpayment (AGENTS.md), due is always derived.
  constraint invoices_balance_check
    check (amount_paid >= 0 and amount_paid <> 'NaN'::numeric
           and amount_paid <= grand_total
           and amount_due = grand_total - amount_paid),

  -- Durable: the status agrees with the balance. paid = settled: nothing due
  -- and the whole total paid, which includes a zero-total invoice (0 / 0).
  -- Only the payment statuses may carry a payment, so a draft, issued or
  -- cancelled invoice has none.
  constraint invoices_status_balance_check
    check (case status
             when 'paid'           then amount_paid = grand_total and amount_due = 0
             when 'partially_paid' then amount_paid > 0 and amount_due > 0
             else amount_paid = 0
           end),

  -- Part 1 only: there is no Payment module yet, so no payment state at all:
  -- nothing paid and no payment status (also not a zero-total 'paid'). The
  -- Payment migration drops this constraint (and nothing else).
  constraint invoices_no_payments_yet_check
    check (amount_paid = 0 and status not in ('partially_paid', 'paid'))
);

create index invoices_org_created_idx
  on public.invoices (organization_id, created_at desc, id desc);

create index invoices_org_status_created_idx
  on public.invoices (organization_id, status, created_at desc, id desc);

create index invoices_org_date_idx
  on public.invoices (organization_id, invoice_date desc);

create index invoices_org_due_date_idx
  on public.invoices (organization_id, due_date);

create index invoices_org_customer_idx
  on public.invoices (organization_id, customer_id);

create index invoices_created_by_idx
  on public.invoices (created_by);

create trigger invoices_set_updated_at
  before update on public.invoices
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- invoice_items
-- -----------------------------------------------------------------------------
create table public.invoice_items (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  invoice_id       uuid not null,
  product_id       uuid not null,

  -- Product snapshot (from products, the source sales order, or a kept line).
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

  constraint invoice_items_invoice_fkey
    foreign key (organization_id, invoice_id)
    references public.invoices (organization_id, id)
    on delete cascade,

  constraint invoice_items_product_fkey
    foreign key (organization_id, product_id)
    references public.products (organization_id, id),

  constraint invoice_items_product_name_check
    check (char_length(product_name) between 1 and 200),

  constraint invoice_items_sku_check
    check (char_length(sku) between 1 and 100),

  constraint invoice_items_unit_check
    check (char_length(unit) between 1 and 50),

  constraint invoice_items_description_check
    check (description is null or (
      char_length(description) between 1 and 2000
      and public.text_is_trimmed(description))),

  constraint invoice_items_sort_order_check
    check (sort_order between 1 and 100),

  constraint invoice_items_quantity_check
    check (quantity > 0 and quantity <> 'NaN'::numeric),

  constraint invoice_items_unit_price_check
    check (unit_price >= 0 and unit_price <> 'NaN'::numeric),

  constraint invoice_items_tax_rate_check
    check (tax_rate >= 0 and tax_rate <= 100),

  -- Same calculation model as quotation_items_amounts_check.
  constraint invoice_items_amounts_check
    check (discount_amount >= 0
           and discount_amount <= round(quantity * unit_price, 2)
           and tax_amount = round((round(quantity * unit_price, 2) - discount_amount)
                                  * tax_rate * 0.01, 2)
           and line_total = round(quantity * unit_price, 2) - discount_amount + tax_amount)
);

create unique index invoice_items_invoice_sort_key
  on public.invoice_items (organization_id, invoice_id, sort_order);

create index invoice_items_org_product_idx
  on public.invoice_items (organization_id, product_id);

create trigger invoice_items_set_updated_at
  before update on public.invoice_items
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- Privileges and RLS: read-only for clients.
-- -----------------------------------------------------------------------------
revoke all on table public.invoices, public.invoice_items from anon, authenticated;
grant select on table public.invoices, public.invoice_items to authenticated;

alter table public.invoices enable row level security;
alter table public.invoice_items enable row level security;

create policy "invoices: read as active member"
  on public.invoices for select
  to authenticated
  using (public.is_org_member(organization_id));

create policy "invoice_items: read as active member"
  on public.invoice_items for select
  to authenticated
  using (public.is_org_member(organization_id));

-- There are deliberately no INSERT, UPDATE or DELETE policies or privileges.

-- -----------------------------------------------------------------------------
-- Document rules (triggers), for every writer.
-- -----------------------------------------------------------------------------
create or replace function public.invoices_enforce_rules()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Invoices are never hard-deleted, whatever their status. This runs before
  -- the item cascade starts, so a delete cannot remove an invoice, its items
  -- or its source_sales_order_id link (which would allow invoicing the sales
  -- order again). It also blocks the organizations ON DELETE CASCADE: an
  -- organization purge, if ever needed, must be an explicit workflow.
  if tg_op = 'DELETE' then
    raise exception 'invoices cannot be deleted' using errcode = '55000';
  end if;

  if new.organization_id is distinct from old.organization_id
     or new.invoice_number is distinct from old.invoice_number
     or new.source_sales_order_id is distinct from old.source_sales_order_id
     or new.created_at is distinct from old.created_at
     or (new.created_by is distinct from old.created_by and new.created_by is not null)
  then
    raise exception 'invoice identity cannot change' using errcode = '55000';
  end if;

  -- No refunds or credits in V1, so an invoice with payments can never be
  -- cancelled: partially_paid and paid have no transition to cancelled, and
  -- invoices_status_balance_check forbids payments on an issued invoice.
  if new.status is distinct from old.status
     and not public.invoice_status_transition_allowed(old.status, new.status)
  then
    raise exception 'invalid invoice status transition from % to %', old.status, new.status
      using errcode = '55000';
  end if;

  -- After draft, only status and the payment balance may change (whole-row
  -- comparison covers future columns too). The balance columns are further
  -- constrained by the CHECKs on the table.
  if old.status <> 'draft'
     and (to_jsonb(new) - 'status' - 'amount_paid' - 'amount_due' - 'updated_at' - 'created_by')
         is distinct from
         (to_jsonb(old) - 'status' - 'amount_paid' - 'amount_due' - 'updated_at' - 'created_by')
  then
    raise exception 'invoice is not a draft' using errcode = '55000';
  end if;

  return new;
end;
$$;

revoke all on function public.invoices_enforce_rules() from public, anon, authenticated;

create trigger invoices_enforce_rules
  before update or delete on public.invoices
  for each row execute function public.invoices_enforce_rules();

-- Items may only be written while their invoice is a draft. A missing parent
-- is let through (INSERT: the FK rejects it; DELETE: cascade from the
-- invoice, which the header trigger blocks anyway).
create or replace function public.invoice_items_enforce_draft()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_status text;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    select inv.status into v_status from public.invoices inv where inv.id = old.invoice_id;
    if found and v_status <> 'draft' then
      raise exception 'invoice is not a draft' using errcode = '55000';
    end if;
  end if;

  if tg_op in ('INSERT', 'UPDATE') then
    select inv.status into v_status from public.invoices inv where inv.id = new.invoice_id;
    if found and v_status <> 'draft' then
      raise exception 'invoice is not a draft' using errcode = '55000';
    end if;
    return new;
  end if;

  return old;
end;
$$;

revoke all on function public.invoice_items_enforce_draft() from public, anon, authenticated;

create trigger invoice_items_enforce_draft
  before insert or update or delete on public.invoice_items
  for each row execute function public.invoice_items_enforce_draft();

-- -----------------------------------------------------------------------------
-- A sales order that has produced an invoice cannot be cancelled (it may
-- still be completed). Any invoice counts, also a cancelled one: the order
-- stays consumed (one invoice per sales order, ever).
--
-- A trigger, so it holds for set_sales_order_status() and every other
-- writer. Tenant-safe: it looks only at invoices of the order's own
-- organization, and set_sales_order_status() reaches the UPDATE only after
-- its authorization-scoped lookup and role check, so callers of another
-- tenant still get P0002 and learn nothing about invoices.
--
-- Concurrency with create_invoice_from_sales_order(), which holds the sales
-- order row FOR SHARE until it commits:
--   - conversion first: the cancel's FOR UPDATE / UPDATE waits for the
--     conversion to commit; this trigger then sees the committed invoice
--     (new statement snapshot under READ COMMITTED) and rejects (55000)
--   - cancel first: the conversion's FOR SHARE waits for the cancel to
--     commit, then reads status 'cancelled' and rejects (55000)
-- -----------------------------------------------------------------------------
create or replace function public.sales_orders_block_invoiced_cancel()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'cancelled'
     and old.status is distinct from 'cancelled'
     and exists (
       select 1 from public.invoices inv
       where inv.organization_id = old.organization_id
         and inv.source_sales_order_id = old.id
     )
  then
    raise exception 'sales order has an invoice and cannot be cancelled' using errcode = '55000';
  end if;
  return new;
end;
$$;

revoke all on function public.sales_orders_block_invoiced_cancel() from public, anon, authenticated;

create trigger sales_orders_block_invoiced_cancel
  before update of status on public.sales_orders
  for each row execute function public.sales_orders_block_invoiced_cancel();

-- -----------------------------------------------------------------------------
-- Internal helpers (no client EXECUTE)
-- -----------------------------------------------------------------------------

-- Validates the header input and returns the normalized notes.
create or replace function public.invoice_normalize_header(
  p_invoice_date  date,
  p_due_date      date,
  p_notes         text
)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_notes text := nullif(public.trim_whitespace(coalesce(p_notes, '')), '');
begin
  if p_invoice_date is null or not isfinite(p_invoice_date) then
    raise exception 'invoice date is required' using errcode = '22023';
  end if;
  if p_due_date is not null
     and (not isfinite(p_due_date) or p_due_date < p_invoice_date) then
    raise exception 'due date must be on or after the invoice date' using errcode = '22023';
  end if;
  if char_length(v_notes) > 2000 then
    raise exception 'notes are too long' using errcode = '22023';
  end if;
  return v_notes;
end;
$$;

revoke all on function public.invoice_normalize_header(date, date, text) from public, anon, authenticated;

-- Replaces all items of a draft invoice with p_items and recomputes the
-- header totals and balance from the stored items.
--
-- p_items is a JSON array of 1..100 objects (same contract as
-- sales_order_replace_items):
--   id               optional; an existing line of THIS invoice, at most once.
--                    An edit/reference token for this save only: the items
--                    are deleted and re-inserted, so row IDs change. With the
--                    same product_id as that line, the line's product
--                    snapshot is kept and its unit price and description are
--                    the defaults (product need not be active). Unknown or
--                    repeated ids are rejected (22023).
--   product_id       uuid, required.
--   quantity         decimal string or number, > 0, at most 3 decimals.
--   unit_price       optional; missing or null = default price (see id).
--   discount_amount  optional, default 0; at most 2 decimals; <= gross.
--   tax_rate         optional, default 0; 0..100, at most 2 decimals.
--   description      optional; key missing = default description; present =
--                    that text (trimmed; empty or null = none).
-- Any other key is ignored: snapshots and amounts come from the database.
create or replace function public.invoice_replace_items(
  p_invoice_id       uuid,
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
    raise exception 'an invoice needs at least one item' using errcode = '22023';
  end if;
  if pg_catalog.jsonb_array_length(p_items) > 100 then
    raise exception 'an invoice can have at most 100 items' using errcode = '22023';
  end if;

  -- The current lines of this invoice, keyed by id, before they are replaced.
  select coalesce(pg_catalog.jsonb_object_agg(i.id::text, pg_catalog.jsonb_build_object(
           'product_id',   i.product_id,
           'product_name', i.product_name,
           'sku',          i.sku,
           'unit',         i.unit,
           'description',  i.description,
           'unit_price',   i.unit_price::text)), '{}'::jsonb)
  into v_old
  from public.invoice_items i
  where i.invoice_id = p_invoice_id
    and i.organization_id = p_organization_id;

  delete from public.invoice_items i
  where i.invoice_id = p_invoice_id
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

    -- Existing line reference (only lines of this invoice).
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
    insert into public.invoice_items (
      organization_id, invoice_id, product_id,
      product_name, sku, description, unit,
      quantity, unit_price, discount_amount, tax_rate, tax_amount, line_total,
      sort_order
    ) values (
      p_organization_id, p_invoice_id, v_product_id,
      v_name, v_sku, v_description, v_unit,
      v_quantity, v_unit_price, v_discount, v_tax_rate, v_tax,
      v_gross - v_discount + v_tax,
      v_index
    );
  end loop;

  perform public.invoice_recompute_totals(p_invoice_id, p_organization_id);
end;
$$;

-- Totals always come from the stored items; amount_due follows grand_total.
-- Only called on drafts, where amount_paid is 0 (invoices_status_balance_check).
create or replace function public.invoice_recompute_totals(
  p_invoice_id       uuid,
  p_organization_id  uuid
)
returns void
language sql
set search_path = ''
as $$
  update public.invoices inv
  set subtotal       = t.subtotal,
      discount_total = t.discount_total,
      tax_total      = t.tax_total,
      grand_total    = t.subtotal - t.discount_total + t.tax_total,
      amount_due     = t.subtotal - t.discount_total + t.tax_total - inv.amount_paid
  from (
    select coalesce(sum(round(i.quantity * i.unit_price, 2)), 0) as subtotal,
           coalesce(sum(i.discount_amount), 0)                   as discount_total,
           coalesce(sum(i.tax_amount), 0)                        as tax_total
    from public.invoice_items i
    where i.invoice_id = p_invoice_id
      and i.organization_id = p_organization_id
  ) t
  where inv.id = p_invoice_id
    and inv.organization_id = p_organization_id;
$$;

revoke all on function public.invoice_recompute_totals(uuid, uuid) from public, anon, authenticated;
revoke all on function public.invoice_replace_items(uuid, uuid, jsonb) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- create_invoice: direct create, header + items, atomically. Any active
-- member. The organization is the customer's organization, and only if the
-- caller is an active member of it; the customer must be active.
-- amount_paid = 0 and amount_due = grand_total.
--
-- Errors (SQLSTATE):
--   42501  not authenticated
--   23503  customer / product not found (any tenant) or inactive
--   22023  invalid input (dates, notes, items, quantities, prices, …)
--   22003  an amount exceeds numeric(18,2)
-- Returns the new invoice's id.
-- -----------------------------------------------------------------------------
create or replace function public.create_invoice(
  p_customer_id   uuid,
  p_invoice_date  date,
  p_due_date      date,
  p_notes         text,
  p_items         jsonb
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

  v_notes := public.invoice_normalize_header(p_invoice_date, p_due_date, p_notes);

  v_seq := public.next_document_number(v_customer.organization_id, 'invoice');

  insert into public.invoices (
    organization_id, invoice_number, customer_id, source_sales_order_id,
    customer_name, customer_company_name, customer_phone, customer_email,
    customer_address, customer_tax_number,
    invoice_date, due_date, status, notes, amount_paid, created_by
  ) values (
    v_customer.organization_id,
    'INV-' || lpad(v_seq::text, greatest(6, length(v_seq::text)), '0'),
    p_customer_id, null,
    v_customer.name, v_customer.company_name, v_customer.phone, v_customer.email,
    v_customer.address, v_customer.tax_number,
    p_invoice_date, p_due_date, 'draft', v_notes, 0, v_user_id
  )
  returning id into v_id;

  perform public.invoice_replace_items(v_id, v_customer.organization_id, p_items);

  return v_id;
end;
$$;

revoke all on function public.create_invoice(uuid, date, date, text, jsonb) from public, anon;
grant execute on function public.create_invoice(uuid, date, date, text, jsonb) to authenticated;

-- -----------------------------------------------------------------------------
-- create_invoice_from_sales_order: confirmed sales order -> draft invoice.
-- Any active member.
--
-- Copies the sales order's customer reference and snapshot, notes, and every
-- line (product reference, snapshot, quantity, price, discount, tax rate,
-- amounts, order) as stored on the sales order. Customers and products are
-- not re-read, so later renames, price changes or deactivation do not
-- matter. The sales order itself is not modified.
--
-- Order of checks:
--   1. caller is authenticated                                   else 42501
--   2. sales order found through the caller's active membership,
--      without a lock. Missing, other tenant, disabled member    -> P0002
--   3. header input (invoice date, due date)                     else 22023
--   4. lock the (authorized) sales order row FOR SHARE: a
--      concurrent status change (FOR UPDATE) waits until this
--      transaction ends, and this one sees its result. Status
--      must be 'confirmed'                                       else 55000
--   5. not invoiced before                                       else 23505
--      (unique (organization_id, source_sales_order_id) is the
--      final guard under concurrency: a second concurrent
--      conversion waits on the counter row and then fails with
--      23505, rolling back its number)
--   6. number, header, items, totals; totals must equal the
--      sales order's; amount_paid = 0, amount_due = grand_total
-- -----------------------------------------------------------------------------
create or replace function public.create_invoice_from_sales_order(
  p_sales_order_id  uuid,
  p_invoice_date    date,
  p_due_date        date default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id     uuid := (select auth.uid());
  v_org_id      uuid;
  v_order       record;
  v_notes       text;
  v_seq         bigint;
  v_id          uuid;
  v_constraint  text;
  v_totals      record;
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

  -- Authorized row only.
  select so.id, so.organization_id, so.status, so.customer_id,
         so.customer_name, so.customer_company_name, so.customer_phone, so.customer_email,
         so.customer_address, so.customer_tax_number, so.notes,
         so.subtotal, so.discount_total, so.tax_total, so.grand_total
  into v_order
  from public.sales_orders so
  where so.id = p_sales_order_id
    and so.organization_id = v_org_id
  for share;

  if v_order.status is distinct from 'confirmed' then
    raise exception 'only a confirmed sales order can be invoiced (status is %)', v_order.status
      using errcode = '55000';
  end if;

  v_notes := public.invoice_normalize_header(p_invoice_date, p_due_date, v_order.notes);

  if exists (
    select 1 from public.invoices inv
    where inv.organization_id = v_order.organization_id
      and inv.source_sales_order_id = v_order.id
  ) then
    raise exception 'sales order has already been invoiced' using errcode = '23505';
  end if;

  v_seq := public.next_document_number(v_order.organization_id, 'invoice');

  begin
    insert into public.invoices (
      organization_id, invoice_number, customer_id, source_sales_order_id,
      customer_name, customer_company_name, customer_phone, customer_email,
      customer_address, customer_tax_number,
      invoice_date, due_date, status, notes, amount_paid, created_by
    ) values (
      v_order.organization_id,
      'INV-' || lpad(v_seq::text, greatest(6, length(v_seq::text)), '0'),
      v_order.customer_id, v_order.id,
      v_order.customer_name, v_order.customer_company_name, v_order.customer_phone,
      v_order.customer_email, v_order.customer_address, v_order.customer_tax_number,
      p_invoice_date, p_due_date, 'draft', v_notes, 0, v_user_id
    )
    returning id into v_id;
  exception when unique_violation then
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint = 'invoices_source_sales_order_key' then
      raise exception 'sales order has already been invoiced' using errcode = '23505';
    end if;
    raise;
  end;

  insert into public.invoice_items (
    organization_id, invoice_id, product_id,
    product_name, sku, description, unit,
    quantity, unit_price, discount_amount, tax_rate, tax_amount, line_total,
    sort_order
  )
  select i.organization_id, v_id, i.product_id,
         i.product_name, i.sku, i.description, i.unit,
         i.quantity, i.unit_price, i.discount_amount, i.tax_rate, i.tax_amount, i.line_total,
         i.sort_order
  from public.sales_order_items i
  where i.sales_order_id = v_order.id
    and i.organization_id = v_order.organization_id
  order by i.sort_order, i.id;

  if not found then
    raise exception 'sales order has no items' using errcode = '22023';
  end if;

  perform public.invoice_recompute_totals(v_id, v_order.organization_id);

  -- The items carry the sales order's amounts (and the CHECK constraints
  -- prove each line), so the recomputed totals must equal the order's.
  select inv.subtotal, inv.discount_total, inv.tax_total, inv.grand_total
  into v_totals
  from public.invoices inv
  where inv.id = v_id;

  if (v_totals.subtotal, v_totals.discount_total, v_totals.tax_total, v_totals.grand_total)
     is distinct from
     (v_order.subtotal, v_order.discount_total, v_order.tax_total, v_order.grand_total)
  then
    raise exception 'sales order totals are inconsistent with its items' using errcode = '23514';
  end if;

  return v_id;
end;
$$;

revoke all on function public.create_invoice_from_sales_order(uuid, date, date) from public, anon;
grant execute on function public.create_invoice_from_sales_order(uuid, date, date) to authenticated;

-- -----------------------------------------------------------------------------
-- update_invoice_draft: header + full item replacement. Any active member,
-- draft only. Works the same for direct and converted invoices; the source
-- sales order is never touched.
--
-- Order of checks:
--   1. caller is authenticated                                   else 42501
--   2. authorization-scoped lookup through the caller's active
--      membership, without a row lock. Missing, other tenant,
--      disabled member                                           -> P0002
--   3. header input                                              else 22023
--   4. lock the (authorized) invoice row; must be draft          else 55000
--   5. customer: unchanged -> snapshot kept; changed -> same
--      organization and active, fresh snapshot                   else 23503
--   6. write header, replace items, recompute totals and balance
-- -----------------------------------------------------------------------------
create or replace function public.update_invoice_draft(
  p_invoice_id    uuid,
  p_customer_id   uuid,
  p_invoice_date  date,
  p_due_date      date,
  p_notes         text,
  p_items         jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id   uuid := (select auth.uid());
  v_org_id    uuid;
  v_current   record;
  v_customer  record;
  v_notes     text;
begin
  if v_user_id is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  select inv.organization_id into v_org_id
  from public.invoices inv
  join public.organization_members m
    on m.organization_id = inv.organization_id
   and m.user_id = v_user_id
   and m.status = 'active'
   and m.role in ('owner', 'manager', 'employee')
  where inv.id = p_invoice_id;

  if not found then
    raise exception 'invoice not found' using errcode = 'P0002';
  end if;

  v_notes := public.invoice_normalize_header(p_invoice_date, p_due_date, p_notes);

  -- Authorized row only; waits for a concurrent change and then sees it.
  select inv.status, inv.customer_id into v_current
  from public.invoices inv
  where inv.id = p_invoice_id
    and inv.organization_id = v_org_id
  for update;

  if v_current.status is distinct from 'draft' then
    raise exception 'invoice is not a draft' using errcode = '55000';
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

    update public.invoices inv
    set customer_id           = p_customer_id,
        customer_name         = v_customer.name,
        customer_company_name = v_customer.company_name,
        customer_phone        = v_customer.phone,
        customer_email        = v_customer.email,
        customer_address      = v_customer.address,
        customer_tax_number   = v_customer.tax_number
    where inv.id = p_invoice_id
      and inv.organization_id = v_org_id;
  end if;

  update public.invoices inv
  set invoice_date = p_invoice_date,
      due_date     = p_due_date,
      notes        = v_notes
  where inv.id = p_invoice_id
    and inv.organization_id = v_org_id;

  perform public.invoice_replace_items(p_invoice_id, v_org_id, p_items);
end;
$$;

revoke all on function public.update_invoice_draft(uuid, uuid, date, date, text, jsonb) from public, anon;
grant execute on function public.update_invoice_draft(uuid, uuid, date, date, text, jsonb) to authenticated;

-- -----------------------------------------------------------------------------
-- set_invoice_status: the only user path to change an invoice's status.
--
--   issued     any active member (from draft)
--   cancelled  owner or manager (from draft or issued)
--   partially_paid, paid   never: reserved for the Payment module (42501)
--
-- Order of checks (same as set_sales_order_status):
--   1. caller is authenticated                                   else 42501
--   2. target is not a payment status                            else 42501
--   3. target status is issued or cancelled                      else 22023
--   4. authorization-scoped lookup, no lock. Missing, other
--      tenant, disabled member                                   -> P0002
--   5. role allowed for the target status                        else 42501
--   6. lock the row with the role re-checked in the same query
--   7. transition allowed from the locked status                 else 55000
-- -----------------------------------------------------------------------------
create or replace function public.set_invoice_status(
  p_invoice_id  uuid,
  p_status      text
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

  if p_status in ('partially_paid', 'paid') then
    raise exception 'invoice status % is set by payments only', p_status using errcode = '42501';
  end if;

  if p_status is null
     or p_status not in ('issued', 'cancelled') then
    raise exception 'invalid invoice status' using errcode = '22023';
  end if;

  v_roles := case when p_status = 'issued'
                  then array['owner', 'manager', 'employee']
                  else array['owner', 'manager'] end;

  select m.role into v_role
  from public.invoices inv
  join public.organization_members m
    on m.organization_id = inv.organization_id
  where inv.id = p_invoice_id
    and m.user_id = v_user_id
    and m.status = 'active';

  if not found then
    raise exception 'invoice not found' using errcode = 'P0002';
  end if;

  if not (v_role = any (v_roles)) then
    raise exception 'not allowed to change invoice status to %', p_status
      using errcode = '42501';
  end if;

  select inv.status into v_current
  from public.invoices inv
  where inv.id = p_invoice_id
    and public.has_org_role(inv.organization_id, v_roles)
  for update;

  if not found then
    raise exception 'invoice not found' using errcode = 'P0002';
  end if;

  if not public.invoice_status_transition_allowed(v_current, p_status) then
    raise exception 'invalid invoice status transition from % to %', v_current, p_status
      using errcode = '55000';
  end if;

  update public.invoices inv
  set status = p_status
  where inv.id = p_invoice_id;
end;
$$;

revoke all on function public.set_invoice_status(uuid, text) from public, anon;
grant execute on function public.set_invoice_status(uuid, text) to authenticated;

-- -----------------------------------------------------------------------------
-- get_invoice: one invoice with its items, read in ONE statement (DECISIONS
-- 020). SECURITY INVOKER, so RLS applies; p_organization_id is an extra
-- filter that never widens access. NULL when not visible. Money, quantities
-- and rates are JSON strings. source_sales_order_number is the source sales
-- order's number (same organization, also under RLS).
-- -----------------------------------------------------------------------------
create or replace function public.get_invoice(
  p_organization_id  uuid,
  p_invoice_id       uuid
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'id',                         inv.id,
    'invoice_number',             inv.invoice_number,
    'customer_id',                inv.customer_id,
    'source_sales_order_id',      inv.source_sales_order_id,
    'source_sales_order_number',  (
      select so.sales_order_number from public.sales_orders so
      where so.organization_id = inv.organization_id
        and so.id = inv.source_sales_order_id),
    'customer_name',              inv.customer_name,
    'customer_company_name',      inv.customer_company_name,
    'customer_phone',             inv.customer_phone,
    'customer_email',             inv.customer_email,
    'customer_address',           inv.customer_address,
    'customer_tax_number',        inv.customer_tax_number,
    'invoice_date',               inv.invoice_date,
    'due_date',                   inv.due_date,
    'status',                     inv.status,
    'notes',                      inv.notes,
    'subtotal',                   inv.subtotal::text,
    'discount_total',             inv.discount_total::text,
    'tax_total',                  inv.tax_total::text,
    'grand_total',                inv.grand_total::text,
    'amount_paid',                inv.amount_paid::text,
    'amount_due',                 inv.amount_due::text,
    'created_at',                 inv.created_at,
    'updated_at',                 inv.updated_at,
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
      from public.invoice_items i
      where i.organization_id = inv.organization_id
        and i.invoice_id = inv.id
    ), '[]'::jsonb)
  )
  from public.invoices inv
  where inv.id = p_invoice_id
    and inv.organization_id = p_organization_id;
$$;

revoke all on function public.get_invoice(uuid, uuid) from public, anon;
grant execute on function public.get_invoice(uuid, uuid) to authenticated;
