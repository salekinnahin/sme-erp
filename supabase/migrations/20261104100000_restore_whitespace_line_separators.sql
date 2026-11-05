-- =============================================================================
-- Shared whitespace helpers: make sure U+2028 and U+2029 are whitespace.
--
-- The shared whitespace set (docs/DECISIONS.md 014, 019) is
--   U+0009-U+000D, U+0020, U+0085, U+00A0, U+1680, U+2000-U+200A,
--   U+2028, U+2029, U+202F, U+205F, U+3000, U+FEFF
-- and matches lib/validation/text.ts. U+200B (zero width space) is NOT in it.
--
-- 20261104030000_harden_customer_validation.sql wrote this set with literal
-- characters. A local copy of that file lost the literal U+2028 / U+2029
-- (editors treat them as line breaks), so a database created from that copy
-- treats them as ordinary characters: a value made only of U+2028 passes the
-- "required" checks, and edge U+2028 / U+2029 are not trimmed. This
-- migration redefines the three helpers so every database ends up with the
-- full set, whatever copy of 030000 it ran. It is idempotent: on a database
-- that already has the full set, nothing changes in behavior.
--
-- The set is written with \uXXXX regular-expression escapes only (ASCII),
-- so it cannot be lost to an editor again.
--
-- Same signatures, attributes and grants (CREATE OR REPLACE keeps grants), so
-- every CHECK constraint, function and policy that uses them picks up the
-- fix at once. Backward compatible: the set only grows, so values that were
-- trimmed before still are, except values that start or end with
-- U+2028 / U+2029.
--
-- Existing data: PostgreSQL does not re-check existing rows when a function
-- used by a CHECK constraint changes. The block at the end counts rows that
-- the corrected rules would reject and raises a WARNING per column. No row
-- is modified; fix flagged rows by hand (trim them) in a follow-up.
--
-- Requires 20261104030000_harden_customer_validation.sql. Changes three
-- function bodies only; no table, constraint, policy or row is changed.
-- =============================================================================

create or replace function public.trim_whitespace(p_value text)
returns text
language sql
immutable
strict
parallel safe
set search_path = ''
as $$
  select pg_catalog.regexp_replace(
    p_value,
    '^[\u0009-\u000d\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+'
    || '|[\u0009-\u000d\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+$',
    '',
    'g'
  );
$$;

create or replace function public.text_is_trimmed(p_value text)
returns boolean
language sql
immutable
strict
parallel safe
set search_path = ''
as $$
  select p_value <> '' and p_value = public.trim_whitespace(p_value);
$$;

create or replace function public.text_has_whitespace(p_value text)
returns boolean
language sql
immutable
strict
parallel safe
set search_path = ''
as $$
  select p_value ~ '[\u0009-\u000d\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]';
$$;

-- -----------------------------------------------------------------------------
-- Report existing rows that the corrected rules would reject (no changes).
-- -----------------------------------------------------------------------------
do $$
declare
  v_check record;
  v_count bigint;
begin
  for v_check in
    select * from (values
      ('customers', 'name', false), ('customers', 'company_name', false),
      ('customers', 'phone', false), ('customers', 'address', false),
      ('customers', 'tax_number', false), ('customers', 'notes', false),
      ('customers', 'email', true),
      ('vendors', 'name', false), ('vendors', 'company_name', false),
      ('vendors', 'phone', false), ('vendors', 'address', false),
      ('vendors', 'tax_number', false), ('vendors', 'notes', false),
      ('vendors', 'email', true),
      ('product_categories', 'name', false),
      ('products', 'name', false), ('products', 'sku', false),
      ('products', 'description', false),
      ('quotations', 'notes', false),
      ('quotation_items', 'description', false)
    ) as t (table_name, column_name, no_whitespace)
  loop
    execute format(
      'select count(*) from public.%I where %I is not null and %s',
      v_check.table_name, v_check.column_name,
      case when v_check.no_whitespace
        then format('public.text_has_whitespace(%I)', v_check.column_name)
        else format('not public.text_is_trimmed(%I)', v_check.column_name)
      end)
    into v_count;
    if v_count > 0 then
      raise warning '% row(s) in public.% have % values that start or end with whitespace (or contain it, for email); trim them',
        v_count, v_check.table_name, v_check.column_name;
    end if;
  end loop;
end $$;
