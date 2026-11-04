-- =============================================================================
-- Product categories: only owners and managers may create or rename them.
--
-- 20261104070000_products.sql let any active member insert and update
-- product_categories. The Version 1 rule is:
--   owner, manager  create, rename, deactivate / reactivate categories
--   employee        view categories and choose active ones for products
--
-- This migration replaces the INSERT and UPDATE policies on
-- product_categories with role-checked ones (public.has_org_role, active
-- members only). The column privileges stay as they were (INSERT
-- organization_id, name; UPDATE name), so RLS is what limits the roles.
-- An employee's INSERT fails with 42501; an employee's UPDATE matches no rows.
-- Status changes already go through set_product_category_status(), which
-- allows only owners and managers. Products are not affected: every active
-- member still creates and edits products and assigns categories to them.
--
-- Requires 20261104070000_products.sql. Changes policies only; no table,
-- column, function or row is changed.
-- =============================================================================

drop policy "product_categories: insert as active member" on public.product_categories;
drop policy "product_categories: update as active member" on public.product_categories;

create policy "product_categories: insert as owner or manager"
  on public.product_categories for insert
  to authenticated
  with check (
    public.has_org_role(organization_id, array['owner', 'manager'])
    and created_by = (select auth.uid())
  );

create policy "product_categories: update as owner or manager"
  on public.product_categories for update
  to authenticated
  using (public.has_org_role(organization_id, array['owner', 'manager']))
  with check (public.has_org_role(organization_id, array['owner', 'manager']));
