-- =============================================================================
-- Products and product categories: tenant isolation, role permissions,
-- SKU rules and data integrity.
--
-- How to run: paste this into the Supabase SQL Editor (it runs as `postgres`)
-- after applying the migrations up to
-- 20261104080000_restrict_product_category_writes.sql.
-- Everything runs in one transaction that is ROLLED BACK at the end, so no
-- data is left behind. Run it separately from the other suites.
--
-- Same structure as vendors.sql (docs/DECISIONS.md 013, 014, 016). It
-- simulates real API users by switching to the `authenticated` role and
-- setting the JWT claims that auth.uid() reads.
--
-- Users
--   A  owner of Organization A        M  manager of Organization A
--   E  employee of Organization A     D  disabled member of Organization A
--   B  owner of Organization B
--
-- Success: the last result shows 'ALL PRODUCT CHECKS PASSED'.
-- Failure: it stops with an error that starts with 'FAIL:'.
-- =============================================================================

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('f0000000-0000-4000-8000-00000000000a', 'products-test-a@example.com', '{"full_name":"Owner A"}'),
  ('f0000000-0000-4000-8000-00000000000b', 'products-test-b@example.com', '{"full_name":"Owner B"}'),
  ('f0000000-0000-4000-8000-00000000000c', 'products-test-m@example.com', '{"full_name":"Manager A"}'),
  ('f0000000-0000-4000-8000-00000000000d', 'products-test-d@example.com', '{"full_name":"Disabled A"}'),
  ('f0000000-0000-4000-8000-00000000000e', 'products-test-e@example.com', '{"full_name":"Employee A"}');

-- -----------------------------------------------------------------------------
-- Organizations A and B, created the same way the app does
-- -----------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"f0000000-0000-4000-8000-00000000000a","role":"authenticated"}', true);
select set_config('test.org_a', public.create_organization('Products Org A', 'BDT', 'Asia/Dhaka')::text, true);
reset role;

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"f0000000-0000-4000-8000-00000000000b","role":"authenticated"}', true);
select set_config('test.org_b', public.create_organization('Products Org B', 'USD', 'UTC')::text, true);
reset role;

-- Extra members of Organization A (no invitation flow yet).
insert into public.organization_members (organization_id, user_id, role, status) values
  (current_setting('test.org_a')::uuid, 'f0000000-0000-4000-8000-00000000000c', 'manager',  'active'),
  (current_setting('test.org_a')::uuid, 'f0000000-0000-4000-8000-00000000000e', 'employee', 'active'),
  (current_setting('test.org_a')::uuid, 'f0000000-0000-4000-8000-00000000000d', 'employee', 'disabled');

-- -----------------------------------------------------------------------------
-- anon: no access
-- -----------------------------------------------------------------------------
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);

do $$ begin
  begin
    perform 1 from public.products;
    raise exception 'FAIL: anon could select products';
  exception when insufficient_privilege then null;
  end;
  begin
    perform 1 from public.product_categories;
    raise exception 'FAIL: anon could select product categories';
  exception when insufficient_privilege then null;
  end;
  begin
    perform * from public.list_products(current_setting('test.org_a')::uuid);
    raise exception 'FAIL: anon could call list_products';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.set_product_status(gen_random_uuid(), 'inactive');
    raise exception 'FAIL: anon could call set_product_status';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.set_product_category_status(gen_random_uuid(), 'inactive');
    raise exception 'FAIL: anon could call set_product_category_status';
  exception when insufficient_privilege then null;
  end;
end $$;

reset role;

-- -----------------------------------------------------------------------------
-- Owner A: categories
-- -----------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"f0000000-0000-4000-8000-00000000000a","role":"authenticated"}', true);

do $$
declare
  v_org_a uuid := current_setting('test.org_a')::uuid;
  v_id    uuid;
begin
  insert into public.product_categories (organization_id, name)
  values (v_org_a, 'Electronics')
  returning id into v_id;
  perform set_config('test.cat_a', v_id::text, true);

  if not exists (
    select 1 from public.product_categories
    where id = v_id and status = 'active'
      and created_by = 'f0000000-0000-4000-8000-00000000000a'
  ) then
    raise exception 'FAIL: owner cannot read category, or defaults are wrong';
  end if;

  insert into public.product_categories (organization_id, name)
  values (v_org_a, 'Furniture')
  returning id into v_id;
  perform set_config('test.cat_furniture', v_id::text, true);

  -- Duplicate names are rejected, ignoring case
  begin
    insert into public.product_categories (organization_id, name) values (v_org_a, 'Electronics');
    raise exception 'FAIL: duplicate category name accepted';
  exception when unique_violation then null;
  end;
  begin
    insert into public.product_categories (organization_id, name) values (v_org_a, 'eLECTRONICS');
    raise exception 'FAIL: duplicate category name with different case accepted';
  exception when unique_violation then null;
  end;
  begin
    update public.product_categories set name = 'electronics' where id = v_id;
    raise exception 'FAIL: rename to an existing category name (other case) accepted';
  exception when unique_violation then null;
  end;

  -- Name rules
  begin
    insert into public.product_categories (organization_id, name) values (v_org_a, '');
    raise exception 'FAIL: empty category name accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.product_categories (organization_id, name) values (v_org_a, E'  ');
    raise exception 'FAIL: NBSP-only category name accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.product_categories (organization_id, name) values (v_org_a, E'Tools ');
    raise exception 'FAIL: category name with trailing U+2003 accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.product_categories (organization_id, name) values (v_org_a, repeat(E'\U0001F600', 101));
    raise exception 'FAIL: 101-emoji category name accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.product_categories (organization_id, name) values (v_org_a, repeat(E'\U0001F600', 100));
    raise exception 'rollback accepted rows' using errcode = 'U0001';
  exception when sqlstate 'U0001' then null;
  end;

  -- Protected columns
  begin
    insert into public.product_categories (organization_id, name, status) values (v_org_a, 'X', 'inactive');
    raise exception 'FAIL: client set category status on insert';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.product_categories set status = 'inactive' where id = v_id;
    raise exception 'FAIL: client updated category status directly';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.product_categories set organization_id = current_setting('test.org_b')::uuid where id = v_id;
    raise exception 'FAIL: client moved a category to another organization';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.product_categories where id = v_id;
    raise exception 'FAIL: client deleted a category';
  exception when insufficient_privilege then null;
  end;

  -- Status
  begin
    perform public.set_product_category_status(v_id, 'archived');
    raise exception 'FAIL: invalid category status accepted';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.set_product_category_status(gen_random_uuid(), 'inactive');
    raise exception 'FAIL: unknown category id did not raise not-found';
  exception when no_data_found then null;
  end;
  perform public.set_product_category_status(v_id, 'inactive');
  if (select status from public.product_categories where id = v_id) <> 'inactive' then
    raise exception 'FAIL: owner could not deactivate a category';
  end if;
  perform public.set_product_category_status(v_id, 'active');
  if (select status from public.product_categories where id = v_id) <> 'active' then
    raise exception 'FAIL: owner could not reactivate a category';
  end if;
end $$;

reset role;

-- -----------------------------------------------------------------------------
-- Owner A: products
-- -----------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"f0000000-0000-4000-8000-00000000000a","role":"authenticated"}', true);

do $$
declare
  v_org_a uuid := current_setting('test.org_a')::uuid;
  v_org_b uuid := current_setting('test.org_b')::uuid;
  v_cat   uuid := current_setting('test.cat_a')::uuid;
  v_id    uuid;
  v_n     integer;
begin
  insert into public.products (organization_id, name, sku, category_id, product_type, unit,
                               description, purchase_price, selling_price, reorder_level)
  values (v_org_a, 'Laptop', 'SKU-001', v_cat, 'inventory', 'pcs',
          'Line 1
Line 2', 1000.50, 1200, 5)
  returning id into v_id;
  perform set_config('test.product_a', v_id::text, true);

  if not exists (
    select 1 from public.products
    where id = v_id and organization_id = v_org_a and status = 'active'
      and created_by = 'f0000000-0000-4000-8000-00000000000a'
      and purchase_price = 1000.50 and selling_price = 1200.00 and reorder_level = 5
  ) then
    raise exception 'FAIL: owner cannot read Product A, or defaults are wrong';
  end if;

  update public.products set description = 'Updated' where id = v_id;
  get diagnostics v_n = row_count;
  if v_n <> 1 or (select description from public.products where id = v_id) is distinct from 'Updated' then
    raise exception 'FAIL: owner cannot update Product A';
  end if;

  -- reorder_level defaults to 0; prices are optional
  insert into public.products (organization_id, name, sku, product_type, unit)
  values (v_org_a, 'Installation', 'SRV-INSTALL', 'service', 'hour')
  returning id into v_id;
  if (select reorder_level from public.products where id = v_id) <> 0
     or (select purchase_price from public.products where id = v_id) is not null then
    raise exception 'FAIL: service defaults are wrong';
  end if;

  -- SKU: unique per organization, ignoring case
  begin
    insert into public.products (organization_id, name, sku, product_type, unit)
    values (v_org_a, 'Laptop copy', 'SKU-001', 'inventory', 'pcs');
    raise exception 'FAIL: duplicate SKU accepted';
  exception when unique_violation then null;
  end;
  begin
    insert into public.products (organization_id, name, sku, product_type, unit)
    values (v_org_a, 'Laptop copy', 'sku-001', 'inventory', 'pcs');
    raise exception 'FAIL: duplicate SKU with different case accepted';
  exception when unique_violation then null;
  end;
  begin
    update public.products set sku = 'Sku-001' where id = v_id;
    raise exception 'FAIL: SKU changed to an existing SKU (other case)';
  exception when unique_violation then null;
  end;

  -- SKU rules
  begin
    insert into public.products (organization_id, name, sku, product_type, unit)
    values (v_org_a, 'X', '', 'inventory', 'pcs');
    raise exception 'FAIL: empty SKU accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.products (organization_id, name, sku, product_type, unit)
    values (v_org_a, 'X', null, 'inventory', 'pcs');
    raise exception 'FAIL: null SKU accepted';
  exception when not_null_violation then null;
  end;
  begin
    insert into public.products (organization_id, name, sku, product_type, unit)
    values (v_org_a, 'X', E' SKU-9', 'inventory', 'pcs');
    raise exception 'FAIL: SKU with leading NBSP accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.products (organization_id, name, sku, product_type, unit)
    values (v_org_a, 'X', E'SKU-9\u0085', 'inventory', 'pcs');
    raise exception 'FAIL: SKU with trailing U+0085 accepted';
  exception when check_violation then null;
  end;
  -- U+2028 / U+2029 are whitespace (migration 20261104100000_restore_whitespace_line_separators.sql).
  begin
    insert into public.products (organization_id, name, sku, description, product_type, unit)
    values (v_org_a, 'X', E'\u2028SKU-9', null, 'inventory', 'pcs');
    raise exception 'FAIL: SKU with leading U+2028 accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.products (organization_id, name, sku, description, product_type, unit)
    values (v_org_a, 'X', E'SKU-9\u2029', null, 'inventory', 'pcs');
    raise exception 'FAIL: SKU with trailing U+2029 accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.products (organization_id, name, sku, description, product_type, unit)
    values (v_org_a, 'X', E'\u2028', null, 'inventory', 'pcs');
    raise exception 'FAIL: U+2028-only SKU accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.products (organization_id, name, sku, description, product_type, unit)
    values (v_org_a, 'X', E'\u2029', null, 'inventory', 'pcs');
    raise exception 'FAIL: U+2029-only SKU accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.products (organization_id, name, sku, description, product_type, unit)
    values (v_org_a, E'\u2029Laptop', 'SKU-LS', null, 'inventory', 'pcs');
    raise exception 'FAIL: product name with leading U+2029 accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.products (organization_id, name, sku, description, product_type, unit)
    values (v_org_a, E'\u2028', 'SKU-LS', null, 'inventory', 'pcs');
    raise exception 'FAIL: U+2028-only product name accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.products (organization_id, name, sku, description, product_type, unit)
    values (v_org_a, 'X', 'SKU-LS', E'Desc\u2028', 'inventory', 'pcs');
    raise exception 'FAIL: description with trailing U+2028 accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.product_categories (organization_id, name) values (v_org_a, E'\u2028');
    raise exception 'FAIL: U+2028-only category name accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.product_categories (organization_id, name) values (v_org_a, E'Tools\u2029');
    raise exception 'FAIL: category name with trailing U+2029 accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.products (organization_id, name, sku, product_type, unit)
    values (v_org_a, 'X', E'﻿', 'inventory', 'pcs');
    raise exception 'FAIL: U+FEFF-only SKU accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.products (organization_id, name, sku, product_type, unit)
    values (v_org_a, 'X', repeat(E'\U0001F600', 101), 'inventory', 'pcs');
    raise exception 'FAIL: 101-emoji SKU accepted';
  exception when check_violation then null;
  end;

  -- Name and description rules (code points, shared whitespace set)
  begin
    insert into public.products (organization_id, name, sku, product_type, unit)
    values (v_org_a, E' ', 'SKU-X1', 'inventory', 'pcs');
    raise exception 'FAIL: U+2003-only product name accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.products (organization_id, name, sku, product_type, unit)
    values (v_org_a, E'Chair\t', 'SKU-X1', 'inventory', 'pcs');
    raise exception 'FAIL: product name with trailing tab accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.products (organization_id, name, sku, product_type, unit)
    values (v_org_a, repeat(E'\U0001F600', 201), 'SKU-X1', 'inventory', 'pcs');
    raise exception 'FAIL: 201-emoji product name accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.products (organization_id, name, sku, product_type, unit, description)
    values (v_org_a, 'X', 'SKU-X1', 'inventory', 'pcs', repeat(E'\U0001F600', 2001));
    raise exception 'FAIL: 2001-emoji description accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.products (organization_id, name, sku, product_type, unit, description)
    values (v_org_a, 'X', 'SKU-X1', 'inventory', 'pcs', '');
    raise exception 'FAIL: empty-string description accepted (must be NULL)';
  exception when check_violation then null;
  end;
  -- Limits are inclusive; inner whitespace is fine
  begin
    insert into public.products (organization_id, name, sku, product_type, unit, description)
    values (v_org_a, repeat(E'\U0001F600', 200), repeat(E'\U0001F600', 100), 'inventory', 'pcs',
            repeat(E'\U0001F600', 2000));
    insert into public.products (organization_id, name, sku, product_type, unit)
    values (v_org_a, E'Inner Space', E'SKU 42', 'inventory', 'pcs');
    raise exception 'rollback accepted rows' using errcode = 'U0001';
  exception when sqlstate 'U0001' then null;
  end;

  -- Product type and unit
  begin
    insert into public.products (organization_id, name, sku, product_type, unit)
    values (v_org_a, 'X', 'SKU-X1', 'goods', 'pcs');
    raise exception 'FAIL: unknown product type accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.products (organization_id, name, sku, product_type, unit)
    values (v_org_a, 'X', 'SKU-X1', 'inventory', 'dozen');
    raise exception 'FAIL: unknown unit accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.products (organization_id, name, sku, product_type, unit)
    values (v_org_a, 'X', 'SKU-X1', 'inventory', 'PCS');
    raise exception 'FAIL: unit with wrong case accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.products (organization_id, name, sku, unit)
    values (v_org_a, 'X', 'SKU-X1', 'pcs');
    raise exception 'FAIL: missing product type accepted';
  exception when not_null_violation then null;
  end;

  -- Prices: non-negative, NaN and Infinity rejected
  begin
    insert into public.products (organization_id, name, sku, product_type, unit, purchase_price)
    values (v_org_a, 'X', 'SKU-X1', 'inventory', 'pcs', -0.01);
    raise exception 'FAIL: negative purchase price accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.products (organization_id, name, sku, product_type, unit, selling_price)
    values (v_org_a, 'X', 'SKU-X1', 'inventory', 'pcs', -1);
    raise exception 'FAIL: negative selling price accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.products (organization_id, name, sku, product_type, unit, selling_price)
    values (v_org_a, 'X', 'SKU-X1', 'inventory', 'pcs', 'NaN');
    raise exception 'FAIL: NaN selling price accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.products (organization_id, name, sku, product_type, unit, purchase_price)
    values (v_org_a, 'X', 'SKU-X1', 'inventory', 'pcs', 'NaN');
    raise exception 'FAIL: NaN purchase price accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.products (organization_id, name, sku, product_type, unit, selling_price)
    values (v_org_a, 'X', 'SKU-X1', 'inventory', 'pcs', 'Infinity');
    raise exception 'FAIL: Infinity selling price accepted';
  exception when numeric_value_out_of_range then null;
  end;
  begin
    insert into public.products (organization_id, name, sku, product_type, unit, selling_price)
    values (v_org_a, 'X', 'SKU-X1', 'inventory', 'pcs', 10000000000000000);
    raise exception 'FAIL: price over numeric(18,2) accepted';
  exception when numeric_value_out_of_range then null;
  end;
  -- Zero and the largest numeric(18,2) value are accepted
  begin
    insert into public.products (organization_id, name, sku, product_type, unit, purchase_price, selling_price)
    values (v_org_a, 'X', 'SKU-X1', 'inventory', 'pcs', 0, 9999999999999999.99);
    raise exception 'rollback accepted rows' using errcode = 'U0001';
  exception when sqlstate 'U0001' then null;
  end;

  -- Reorder level: non-negative, and only inventory products may have one
  begin
    insert into public.products (organization_id, name, sku, product_type, unit, reorder_level)
    values (v_org_a, 'X', 'SKU-X1', 'inventory', 'pcs', -1);
    raise exception 'FAIL: negative reorder level accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.products (organization_id, name, sku, product_type, unit, reorder_level)
    values (v_org_a, 'X', 'SKU-X1', 'inventory', 'pcs', 'NaN');
    raise exception 'FAIL: NaN reorder level accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.products (organization_id, name, sku, product_type, unit, reorder_level)
    values (v_org_a, 'X', 'SKU-X1', 'inventory', 'pcs', null);
    raise exception 'FAIL: null reorder level accepted';
  exception when not_null_violation then null;
  end;
  begin
    insert into public.products (organization_id, name, sku, product_type, unit, reorder_level)
    values (v_org_a, 'X', 'SKU-X1', 'service', 'hour', 3);
    raise exception 'FAIL: service with a reorder level accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.products (organization_id, name, sku, product_type, unit, reorder_level)
    values (v_org_a, 'X', 'SKU-X1', 'non_inventory', 'pcs', 0.5);
    raise exception 'FAIL: non-inventory product with a reorder level accepted';
  exception when check_violation then null;
  end;
  -- Fractional reorder levels are fine for inventory (e.g. kg)
  begin
    insert into public.products (organization_id, name, sku, product_type, unit, reorder_level)
    values (v_org_a, 'Rice', 'SKU-X1', 'inventory', 'kg', 2.5);
    raise exception 'rollback accepted rows' using errcode = 'U0001';
  exception when sqlstate 'U0001' then null;
  end;

  -- Type changes are allowed (no stock yet), but a non-inventory type needs
  -- reorder_level = 0
  v_id := current_setting('test.product_a')::uuid;
  begin
    update public.products set product_type = 'service' where id = v_id;
    raise exception 'FAIL: changed to service while reorder level is 5';
  exception when check_violation then null;
  end;
  update public.products set product_type = 'non_inventory', reorder_level = 0 where id = v_id;
  update public.products set product_type = 'inventory', reorder_level = 5 where id = v_id;
  if (select product_type from public.products where id = v_id) <> 'inventory' then
    raise exception 'FAIL: product type could not be changed back to inventory';
  end if;

  -- A category of another organization or an unknown category is rejected
  -- the same way (composite foreign key)
  begin
    insert into public.products (organization_id, name, sku, product_type, unit, category_id)
    values (v_org_a, 'X', 'SKU-X1', 'inventory', 'pcs', gen_random_uuid());
    raise exception 'FAIL: unknown category accepted';
  exception when foreign_key_violation then null;
  end;
  update public.products set category_id = null where id = v_id;
  update public.products set category_id = v_cat where id = v_id;

  -- Protected columns
  begin
    insert into public.products (organization_id, name, sku, product_type, unit, status)
    values (v_org_a, 'X', 'SKU-X1', 'inventory', 'pcs', 'inactive');
    raise exception 'FAIL: client set product status on insert';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.products (organization_id, name, sku, product_type, unit, created_by)
    values (v_org_a, 'X', 'SKU-X1', 'inventory', 'pcs', 'f0000000-0000-4000-8000-00000000000b');
    raise exception 'FAIL: client set created_by on insert';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.products set status = 'inactive' where id = v_id;
    raise exception 'FAIL: client updated product status directly';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.products set organization_id = v_org_b where id = v_id;
    raise exception 'FAIL: client moved a product to another organization';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.products set created_by = null where id = v_id;
    raise exception 'FAIL: client changed created_by';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.products set created_at = now() - interval '1 day' where id = v_id;
    raise exception 'FAIL: client changed created_at';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.products where id = v_id;
    raise exception 'FAIL: client deleted a product';
  exception when insufficient_privilege then null;
  end;

  -- Deactivate / reactivate
  begin
    perform public.set_product_status(v_id, 'archived');
    raise exception 'FAIL: invalid product status accepted';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.set_product_status(gen_random_uuid(), 'inactive');
    raise exception 'FAIL: unknown product id did not raise not-found';
  exception when no_data_found then null;
  end;
  perform public.set_product_status(v_id, 'inactive');
  if (select status from public.products where id = v_id) <> 'inactive' then
    raise exception 'FAIL: owner could not deactivate Product A';
  end if;
  -- Inactive products stay editable in Version 1
  update public.products set description = 'Edited while inactive' where id = v_id;
  if (select description from public.products where id = v_id) is distinct from 'Edited while inactive' then
    raise exception 'FAIL: inactive product is not editable';
  end if;
  perform public.set_product_status(v_id, 'inactive'); -- repeat is a no-op
  perform public.set_product_status(v_id, 'active');
  if (select status from public.products where id = v_id) <> 'active' then
    raise exception 'FAIL: owner could not reactivate Product A';
  end if;

  -- Search fixtures
  insert into public.products (organization_id, name, sku, product_type, unit)
  values (v_org_a, '100% Cotton', 'COT-100', 'non_inventory', 'pcs');
  insert into public.products (organization_id, name, sku, product_type, unit)
  values (v_org_a, 'Under_Score', 'US-1', 'inventory', 'pcs');
  insert into public.products (organization_id, name, sku, product_type, unit, category_id)
  values (v_org_a, 'Old Chair', 'CHAIR-OLD', 'inventory', 'pcs',
          current_setting('test.cat_furniture')::uuid)
  returning id into v_id;
  perform public.set_product_status(v_id, 'inactive');
end $$;

reset role;

-- -----------------------------------------------------------------------------
-- Manager M: create, edit, change product and category status
-- -----------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"f0000000-0000-4000-8000-00000000000c","role":"authenticated"}', true);

do $$
declare
  v_org_a uuid := current_setting('test.org_a')::uuid;
  v_prod  uuid := current_setting('test.product_a')::uuid;
  v_id    uuid;
begin
  insert into public.products (organization_id, name, sku, product_type, unit)
  values (v_org_a, 'Manager Product', 'MGR-1', 'non_inventory', 'box')
  returning id into v_id;
  if (select created_by from public.products where id = v_id) is distinct from 'f0000000-0000-4000-8000-00000000000c' then
    raise exception 'FAIL: created_by is not the manager';
  end if;
  update public.products set selling_price = 1250.75 where id = v_prod;
  if (select selling_price from public.products where id = v_prod) <> 1250.75 then
    raise exception 'FAIL: manager cannot edit Product A';
  end if;
  update public.products set selling_price = 1200 where id = v_prod;

  perform public.set_product_status(v_prod, 'inactive');
  if (select status from public.products where id = v_prod) <> 'inactive' then
    raise exception 'FAIL: manager could not deactivate Product A';
  end if;
  perform public.set_product_status(v_prod, 'active');
  if (select status from public.products where id = v_prod) <> 'active' then
    raise exception 'FAIL: manager could not reactivate Product A';
  end if;

  insert into public.product_categories (organization_id, name)
  values (v_org_a, 'Manager Category')
  returning id into v_id;
  perform public.set_product_category_status(v_id, 'inactive');
  if (select status from public.product_categories where id = v_id) <> 'inactive' then
    raise exception 'FAIL: manager could not deactivate a category';
  end if;
  perform public.set_product_category_status(v_id, 'active');
  if (select status from public.product_categories where id = v_id) <> 'active' then
    raise exception 'FAIL: manager could not reactivate a category';
  end if;
  update public.product_categories set name = 'Manager Cat' where id = v_id;
  if (select name from public.product_categories where id = v_id) <> 'Manager Cat' then
    raise exception 'FAIL: manager cannot rename a category';
  end if;

  -- Furniture (Old Chair's category) becomes inactive; the employee checks
  -- below confirm the product keeps it
  perform public.set_product_category_status(current_setting('test.cat_furniture')::uuid, 'inactive');
end $$;

reset role;

-- -----------------------------------------------------------------------------
-- Employee E: create, read, edit products and use categories; cannot
-- create, rename, deactivate or reactivate categories, or change product status
-- -----------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"f0000000-0000-4000-8000-00000000000e","role":"authenticated"}', true);

do $$
declare
  v_org_a uuid := current_setting('test.org_a')::uuid;
  v_prod  uuid := current_setting('test.product_a')::uuid;
  v_cat   uuid := current_setting('test.cat_a')::uuid;
  v_old   uuid;
  v_id    uuid;
  v_n     integer;
begin
  insert into public.products (organization_id, name, sku, product_type, unit)
  values (v_org_a, 'Employee Product', 'EMP-1', 'service', 'service')
  returning id into v_id;
  if not exists (select 1 from public.products where id = v_prod) then
    raise exception 'FAIL: employee cannot read Product A';
  end if;
  update public.products set description = 'Edited by employee' where id = v_prod;
  if (select description from public.products where id = v_prod) is distinct from 'Edited by employee' then
    raise exception 'FAIL: employee cannot edit Product A';
  end if;

  -- Categories: read and assign, but no create or rename
  -- (20261104080000_restrict_product_category_writes.sql)
  if (select count(*) from public.product_categories) <> 3 then
    raise exception 'FAIL: employee cannot read the categories';
  end if;
  update public.products
  set category_id = (select id from public.product_categories where name = 'Manager Cat')
  where id = v_id;
  if (select category_id from public.products where id = v_id) is null then
    raise exception 'FAIL: employee cannot assign an active category to a product';
  end if;
  begin
    insert into public.product_categories (organization_id, name)
    values (v_org_a, 'Employee Category');
    raise exception 'FAIL: employee created a category';
  exception when insufficient_privilege then null;
  end;
  update public.product_categories set name = 'Renamed by employee' where id = v_cat;
  get diagnostics v_n = row_count;
  if v_n <> 0 or (select name from public.product_categories where id = v_cat) <> 'Electronics' then
    raise exception 'FAIL: employee renamed a category';
  end if;

  -- An unrelated edit keeps an existing inactive category, whether the
  -- category_id is left out or written back unchanged
  select id into v_old from public.products where name = 'Old Chair';
  update public.products set description = 'Edited by employee' where id = v_old;
  update public.products
  set description = 'Edited again', category_id = current_setting('test.cat_furniture')::uuid
  where id = v_old;
  if (select category_id from public.products where id = v_old)
       is distinct from current_setting('test.cat_furniture')::uuid then
    raise exception 'FAIL: an edit lost the inactive current category';
  end if;

  begin
    perform public.set_product_status(v_prod, 'inactive');
    raise exception 'FAIL: employee deactivated Product A';
  exception when insufficient_privilege then null;
  end;
  if (select status from public.products where id = v_prod) <> 'active' then
    raise exception 'FAIL: employee changed Product A status';
  end if;

  begin
    perform public.set_product_status(v_old, 'active');
    raise exception 'FAIL: employee reactivated a product';
  exception when insufficient_privilege then null;
  end;
  if (select status from public.products where id = v_old) <> 'inactive' then
    raise exception 'FAIL: employee changed Old Chair status';
  end if;

  begin
    perform public.set_product_category_status(v_cat, 'inactive');
    raise exception 'FAIL: employee deactivated a category';
  exception when insufficient_privilege then null;
  end;
  if (select status from public.product_categories where id = v_cat) <> 'active' then
    raise exception 'FAIL: employee changed category status';
  end if;
end $$;

reset role;

-- -----------------------------------------------------------------------------
-- Disabled member D of Organization A: no access at all
-- -----------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"f0000000-0000-4000-8000-00000000000d","role":"authenticated"}', true);

do $$
declare
  v_org_a uuid := current_setting('test.org_a')::uuid;
  v_prod  uuid := current_setting('test.product_a')::uuid;
  v_cat   uuid := current_setting('test.cat_a')::uuid;
  v_n     integer;
begin
  if exists (select 1 from public.products) then
    raise exception 'FAIL: disabled member can read products';
  end if;
  if exists (select 1 from public.product_categories) then
    raise exception 'FAIL: disabled member can read categories';
  end if;
  if exists (select 1 from public.list_products(v_org_a)) then
    raise exception 'FAIL: disabled member can list products';
  end if;
  begin
    insert into public.products (organization_id, name, sku, product_type, unit)
    values (v_org_a, 'Disabled Created', 'DIS-1', 'inventory', 'pcs');
    raise exception 'FAIL: disabled member created a product';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.product_categories (organization_id, name) values (v_org_a, 'Disabled Cat');
    raise exception 'FAIL: disabled member created a category';
  exception when insufficient_privilege then null;
  end;
  update public.products set name = 'Hacked' where id = v_prod;
  get diagnostics v_n = row_count;
  if v_n <> 0 then
    raise exception 'FAIL: disabled member updated a product';
  end if;
  update public.product_categories set name = 'Hacked' where id = v_cat;
  get diagnostics v_n = row_count;
  if v_n <> 0 then
    raise exception 'FAIL: disabled member renamed a category';
  end if;
  begin
    perform public.set_product_status(v_prod, 'inactive');
    raise exception 'FAIL: disabled member changed product status';
  exception when no_data_found then null;
  end;
  begin
    perform public.set_product_category_status(v_cat, 'inactive');
    raise exception 'FAIL: disabled member changed category status';
  exception when no_data_found then null;
  end;
end $$;

reset role;

-- -----------------------------------------------------------------------------
-- Owner B: same SKU and category name allowed in another organization; no
-- way to reach Organization A's products or categories
-- -----------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"f0000000-0000-4000-8000-00000000000b","role":"authenticated"}', true);

do $$
declare
  v_org_a  uuid := current_setting('test.org_a')::uuid;
  v_org_b  uuid := current_setting('test.org_b')::uuid;
  v_prod   uuid := current_setting('test.product_a')::uuid;
  v_cat    uuid := current_setting('test.cat_a')::uuid;
  v_cat_b  uuid;
  v_prod_b uuid;
  v_n      integer;
  v_status      text;
  v_err_other   text;
  v_err_unknown text;
begin
  -- Same category name and SKU as Organization A: allowed
  insert into public.product_categories (organization_id, name)
  values (v_org_b, 'Electronics')
  returning id into v_cat_b;
  insert into public.products (organization_id, name, sku, product_type, unit, category_id)
  values (v_org_b, 'Laptop B', 'SKU-001', 'inventory', 'pcs', v_cat_b)
  returning id into v_prod_b;

  -- Read
  if exists (select 1 from public.products where id = v_prod)
     or exists (select 1 from public.products where organization_id = v_org_a) then
    raise exception 'FAIL: user B can read Organization A products';
  end if;
  if exists (select 1 from public.product_categories where organization_id = v_org_a) then
    raise exception 'FAIL: user B can read Organization A categories';
  end if;
  if (select count(*) from public.products) <> 1
     or (select count(*) from public.product_categories) <> 1 then
    raise exception 'FAIL: user B sees rows outside Organization B';
  end if;

  -- Update
  update public.products set name = 'Hacked' where id = v_prod;
  get diagnostics v_n = row_count;
  if v_n <> 0 then
    raise exception 'FAIL: user B updated Product A';
  end if;
  update public.product_categories set name = 'Hacked' where id = v_cat;
  get diagnostics v_n = row_count;
  if v_n <> 0 then
    raise exception 'FAIL: user B renamed an Organization A category';
  end if;

  -- Organization A's category cannot be attached to B's products, and the
  -- error is the same as for an unknown category ID
  begin
    insert into public.products (organization_id, name, sku, product_type, unit, category_id)
    values (v_org_b, 'X', 'SKU-X2', 'inventory', 'pcs', v_cat);
    raise exception 'FAIL: user B used an Organization A category';
  exception when foreign_key_violation then null;
  end;
  begin
    update public.products set category_id = v_cat where id = v_prod_b;
    raise exception 'FAIL: user B moved a product into an Organization A category';
  exception when foreign_key_violation then null;
  end;

  -- Status changes: other-tenant and unknown IDs fail identically
  foreach v_status in array array['inactive', 'active'] loop
    begin
      perform public.set_product_status(v_prod, v_status);
      raise exception 'FAIL: user B changed Product A status';
    exception when others then
      v_err_other := sqlstate || ': ' || sqlerrm;
    end;
    begin
      perform public.set_product_status(gen_random_uuid(), v_status);
      raise exception 'FAIL: unknown product id did not raise';
    exception when others then
      v_err_unknown := sqlstate || ': ' || sqlerrm;
    end;
    if v_err_other is distinct from v_err_unknown or v_err_other <> 'P0002: product not found' then
      raise exception 'FAIL: other-tenant (%) and unknown (%) product IDs fail differently',
        v_err_other, v_err_unknown;
    end if;

    begin
      perform public.set_product_category_status(v_cat, v_status);
      raise exception 'FAIL: user B changed an Organization A category status';
    exception when others then
      v_err_other := sqlstate || ': ' || sqlerrm;
    end;
    begin
      perform public.set_product_category_status(gen_random_uuid(), v_status);
      raise exception 'FAIL: unknown category id did not raise';
    exception when others then
      v_err_unknown := sqlstate || ': ' || sqlerrm;
    end;
    if v_err_other is distinct from v_err_unknown or v_err_other <> 'P0002: category not found' then
      raise exception 'FAIL: other-tenant (%) and unknown (%) category IDs fail differently',
        v_err_other, v_err_unknown;
    end if;
  end loop;

  -- A product ID is not a category ID and vice versa
  begin
    perform public.set_product_category_status(v_prod_b, 'inactive');
    raise exception 'FAIL: set_product_category_status accepted a product id';
  exception when no_data_found then null;
  end;

  -- Authorization happens before any row lock
  if pg_get_functiondef('public.set_product_status(uuid, text)'::regprocedure)
       ~* 'for[[:space:]]+(no[[:space:]]+key[[:space:]]+)?(update|share)'
     or pg_get_functiondef('public.set_product_category_status(uuid, text)'::regprocedure)
       ~* 'for[[:space:]]+(no[[:space:]]+key[[:space:]]+)?(update|share)' then
    raise exception 'FAIL: a status function takes an explicit row lock';
  end if;

  -- Create under Organization A's ID
  begin
    insert into public.products (organization_id, name, sku, product_type, unit)
    values (v_org_a, 'Planted by B', 'PLANT-1', 'inventory', 'pcs');
    raise exception 'FAIL: user B created a product in Organization A';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.product_categories (organization_id, name) values (v_org_a, 'Planted by B');
    raise exception 'FAIL: user B created a category in Organization A';
  exception when insufficient_privilege then null;
  end;

  -- Delete
  begin
    delete from public.products where id = v_prod;
    raise exception 'FAIL: user B deleted Product A';
  exception when insufficient_privilege then null;
  end;

  -- list_products with Organization A's ID returns nothing, whatever the
  -- search, filter or page
  if exists (select 1 from public.list_products(v_org_a))
     or exists (select 1 from public.list_products(v_org_a, 'Laptop', 'active', 'inventory', null, 100, 0))
     or exists (select 1 from public.list_products(v_org_a, null, null, null, v_cat, 100, 0))
     or exists (select 1 from public.list_products(v_org_a, 'SKU-001', null, null, null, 100, 0)) then
    raise exception 'FAIL: user B listed Organization A products';
  end if;

  -- Own list: only B's product
  if (select count(*) from public.list_products(v_org_b, 'sku-001', null, null, null, 100, 0)) <> 1
     or exists (select 1 from public.list_products(v_org_b, 'laptop', null, null, null, 100, 0) where name <> 'Laptop B') then
    raise exception 'FAIL: user B search returned rows outside Organization B';
  end if;
  if (select max(total_count) from public.list_products(v_org_b, null, null, null, null, 100000, 0)) <> 1 then
    raise exception 'FAIL: total_count for user B is not 1';
  end if;
end $$;

reset role;

-- -----------------------------------------------------------------------------
-- Owner A: data untouched; search, filters and pagination stay in Org A
-- -----------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"f0000000-0000-4000-8000-00000000000a","role":"authenticated"}', true);

do $$
declare
  v_org_a uuid := current_setting('test.org_a')::uuid;
  v_org_b uuid := current_setting('test.org_b')::uuid;
  v_prod  uuid := current_setting('test.product_a')::uuid;
  v_cat   uuid := current_setting('test.cat_a')::uuid;
  v_total bigint;
begin
  if (select name from public.products where id = v_prod) is distinct from 'Laptop'
     or (select status from public.products where id = v_prod) <> 'active'
     or (select category_id from public.products where id = v_prod) is distinct from v_cat then
    raise exception 'FAIL: Product A was modified by another tenant';
  end if;
  if (select name from public.product_categories where id = v_cat) <> 'Electronics' then
    raise exception 'FAIL: an Organization A category was modified by another tenant';
  end if;
  if exists (select 1 from public.products where organization_id = v_org_b)
     or exists (select 1 from public.product_categories where organization_id = v_org_b)
     or exists (select 1 from public.list_products(v_org_b)) then
    raise exception 'FAIL: user A can read Organization B data';
  end if;
  if exists (select 1 from public.products where name = 'Planted by B') then
    raise exception 'FAIL: a product planted by user B exists in Organization A';
  end if;
  if (select count(*) from public.product_categories) <> 3 then
    raise exception 'FAIL: expected 3 categories in Org A, got %', (select count(*) from public.product_categories);
  end if;

  -- Org A: Laptop (inventory, Electronics), Installation (service),
  -- 100% Cotton (non_inventory), Under_Score (inventory), Old Chair
  -- (inventory, Furniture, inactive), Manager Product (non_inventory),
  -- Employee Product (service)
  select max(total_count) into v_total from public.list_products(v_org_a);
  if v_total <> 7 then
    raise exception 'FAIL: expected 7 products in Org A, got %', v_total;
  end if;

  -- Prices come back as exact text, category name is joined
  if not exists (
    select 1 from public.list_products(v_org_a, 'laptop', null, null, null, 100, 0)
    where purchase_price = '1000.50' and selling_price = '1200.00'
      and category_name = 'Electronics' and sku = 'SKU-001'
  ) then
    raise exception 'FAIL: list_products returned wrong prices or category';
  end if;
  if exists (
    select 1 from public.list_products(v_org_a, 'Installation', null, null, null, 100, 0)
    where purchase_price is not null or selling_price is not null or category_name is not null
  ) then
    raise exception 'FAIL: missing prices or category are not NULL';
  end if;

  -- Search by name, SKU (partial, case-insensitive) and category name
  if (select count(*) from public.list_products(v_org_a, 'LAPTOP', null, null, null, 100, 0)) <> 1 then
    raise exception 'FAIL: search by name failed';
  end if;
  if (select count(*) from public.list_products(v_org_a, 'sku-0', null, null, null, 100, 0)) <> 1 then
    raise exception 'FAIL: partial SKU search failed';
  end if;
  if (select count(*) from public.list_products(v_org_a, 'srv-install', null, null, null, 100, 0)) <> 1 then
    raise exception 'FAIL: exact SKU search (other case) failed';
  end if;
  if (select count(*) from public.list_products(v_org_a, 'electr', null, null, null, 100, 0)) <> 1
     or (select count(*) from public.list_products(v_org_a, 'furniture', null, null, null, 100, 0)) <> 1 then
    raise exception 'FAIL: search by category name failed';
  end if;

  -- LIKE wildcards are literal
  if (select count(*) from public.list_products(v_org_a, '%', null, null, null, 100, 0)) <> 1 then
    raise exception 'FAIL: %% in search is treated as a wildcard';
  end if;
  if (select count(*) from public.list_products(v_org_a, '_', null, null, null, 100, 0)) <> 1 then
    raise exception 'FAIL: _ in search is treated as a wildcard';
  end if;

  -- Search is trimmed with the shared whitespace set; whitespace-only lists all
  if (select count(*) from public.list_products(v_org_a, E' Laptop　', null, null, null, 100, 0)) <> 1
     or (select count(*) from public.list_products(v_org_a, E'﻿sku-001\u0085', null, null, null, 100, 0)) <> 1 then
    raise exception 'FAIL: list_products does not trim Unicode whitespace in the search';
  end if;
  if (select coalesce(max(total_count), 0) from public.list_products(v_org_a, E' ', null, null, null, 100, 0)) <> 7 then
    raise exception 'FAIL: a whitespace-only search does not list everything';
  end if;

  -- Filters
  if (select count(*) from public.list_products(v_org_a, null, 'inactive', null, null, 100, 0)) <> 1
     or (select count(*) from public.list_products(v_org_a, null, 'active', null, null, 100, 0)) <> 6 then
    raise exception 'FAIL: status filter failed';
  end if;
  if (select count(*) from public.list_products(v_org_a, null, null, 'inventory', null, 100, 0)) <> 3
     or (select count(*) from public.list_products(v_org_a, null, null, 'non_inventory', null, 100, 0)) <> 2
     or (select count(*) from public.list_products(v_org_a, null, null, 'service', null, 100, 0)) <> 2 then
    raise exception 'FAIL: product type filter failed';
  end if;
  if (select count(*) from public.list_products(v_org_a, null, null, null, v_cat, 100, 0)) <> 1 then
    raise exception 'FAIL: category filter failed';
  end if;
  if (select count(*) from public.list_products(v_org_a, null, 'active', 'inventory', null, 100, 0)) <> 2
     or (select count(*) from public.list_products(v_org_a, 'chair', 'active', null, null, 100, 0)) <> 0 then
    raise exception 'FAIL: combined filters failed';
  end if;

  -- Pagination: pages are disjoint, total_count is stable, limit is clamped
  if (select count(*) from public.list_products(v_org_a, null, null, null, null, 4, 0)) <> 4
     or (select count(*) from public.list_products(v_org_a, null, null, null, null, 4, 4)) <> 3 then
    raise exception 'FAIL: pagination returned wrong page sizes';
  end if;
  if exists (
    select id from public.list_products(v_org_a, null, null, null, null, 4, 0)
    intersect
    select id from public.list_products(v_org_a, null, null, null, null, 4, 4)
  ) then
    raise exception 'FAIL: pages overlap';
  end if;
  if (select max(total_count) from public.list_products(v_org_a, null, null, null, null, 4, 4)) <> 7 then
    raise exception 'FAIL: total_count changes between pages';
  end if;
  if (select count(*) from public.list_products(v_org_a, null, null, null, null, 0, -5)) <> 1 then
    raise exception 'FAIL: limit/offset are not clamped';
  end if;
  if exists (select 1 from public.list_products(v_org_a, null, null, null, null, 100, 100000)) then
    raise exception 'FAIL: pagination past the end returned rows';
  end if;

  -- The largest price survives as exact text (no floating point)
  begin
    update public.products set selling_price = 9999999999999999.99 where id = v_prod;
    if (select selling_price from public.list_products(v_org_a, 'laptop', null, null, null, 100, 0))
         <> '9999999999999999.99' then
      raise exception 'FAIL: large price not returned exactly';
    end if;
    raise exception 'rollback' using errcode = 'U0001';
  exception when sqlstate 'U0001' then null;
  end;
end $$;

reset role;

-- A member who is disabled later loses access at once.
update public.organization_members
set status = 'disabled'
where organization_id = current_setting('test.org_a')::uuid
  and user_id = 'f0000000-0000-4000-8000-00000000000c';

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"f0000000-0000-4000-8000-00000000000c","role":"authenticated"}', true);

do $$
declare
  v_org_a uuid := current_setting('test.org_a')::uuid;
  v_prod  uuid := current_setting('test.product_a')::uuid;
  v_cat   uuid := current_setting('test.cat_a')::uuid;
  v_n     integer;
begin
  if exists (select 1 from public.products) or exists (select 1 from public.product_categories) then
    raise exception 'FAIL: newly disabled manager can still read products or categories';
  end if;
  if exists (select 1 from public.list_products(v_org_a)) then
    raise exception 'FAIL: newly disabled manager can still list products';
  end if;
  update public.products set description = 'After disable' where id = v_prod;
  get diagnostics v_n = row_count;
  if v_n <> 0 then
    raise exception 'FAIL: newly disabled manager updated a product';
  end if;
  begin
    insert into public.products (organization_id, name, sku, product_type, unit)
    values (v_org_a, 'After disable', 'AFTER-1', 'inventory', 'pcs');
    raise exception 'FAIL: newly disabled manager created a product';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.set_product_status(v_prod, 'inactive');
    raise exception 'FAIL: newly disabled manager changed product status';
  exception when no_data_found then null;
  end;
  begin
    perform public.set_product_category_status(v_cat, 'inactive');
    raise exception 'FAIL: newly disabled manager changed category status';
  exception when no_data_found then null;
  end;
end $$;

reset role;

select 'ALL PRODUCT CHECKS PASSED' as result;

rollback;
