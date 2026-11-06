import { PageHeader, EmptyState, PageSkeleton } from "@/app/_components/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { requireTenant } from "@/lib/tenancy/context";
import { listCategories } from "@/lib/products/categories";
import { canCategory } from "@/lib/products/permissions";
import { StatusBadge } from "@/app/_components/status-badge";
import { TEXT_LINK } from "@/app/_components/styles";
import {
  AddCategoryForm,
  CategoryName,
  CategoryStatusButton,
} from "../_components/category-controls";

export const metadata: Metadata = { title: "Product categories · SME ERP" };

export default function CategoriesPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Link href="/products" className={TEXT_LINK}>
        ← Products
      </Link>
      <PageHeader title="Product categories" description="Organize your catalog with simple product categories." />
      <Suspense fallback={<PageSkeleton label="Loading categories…" />}>
        <CategoryList />
      </Suspense>
    </div>
  );
}

async function CategoryList() {
  const tenant = await requireTenant();
  const categories = await listCategories(tenant);
  const canCreate = canCategory(tenant.role, "create");
  const canRename = canCategory(tenant.role, "rename");
  const canChangeStatus = canCategory(tenant.role, "changeStatus");

  return (
    <div className="space-y-6">
      {canCreate ? (
        <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
          <AddCategoryForm />
        </div>
      ) : (
        <p className="text-sm text-zinc-500">
          Only owners and managers can add or change categories.
        </p>
      )}

      {categories.length === 0 ? (
        <EmptyState title="No categories yet" description="Add a category to start organizing your products." />
      ) : (
        <ul className="divide-y divide-zinc-200 rounded-xl border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-950">
          {categories.map((c) => (
            <li key={c.id} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
              <div className="min-w-0 flex-1 space-y-1">
                <CategoryName
                  // remount after a rename so the form starts closed
                  key={c.name}
                  categoryId={c.id}
                  name={c.name}
                  canRename={canRename}
                />
                <StatusBadge status={c.status} />
              </div>
              {canChangeStatus && (
                <CategoryStatusButton key={c.status} categoryId={c.id} status={c.status} />
              )}
            </li>
          ))}
        </ul>
      )}

      <p className="text-sm text-zinc-500">
        Inactive categories are not offered for new or edited products. Products
        already in an inactive category keep it.
      </p>
    </div>
  );
}
