import type { Metadata } from "next";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { requireTenant } from "@/lib/tenancy/context";
import { canCategory, canProduct } from "@/lib/products/permissions";
import { listCategoryOptions } from "@/lib/products/categories";
import { createProductAction } from "../actions";
import { ProductForm } from "../_components/product-form";

export const metadata: Metadata = { title: "New product · SME ERP" };

export default function NewProductPage() {
  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-2xl font-semibold">New product</h1>
      <div className="mt-6 rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-950">
        <Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}>
          <NewProduct />
        </Suspense>
      </div>
    </div>
  );
}

async function NewProduct() {
  const tenant = await requireTenant();
  if (!canProduct(tenant.role, "create")) redirect("/products");
  const categories = await listCategoryOptions(tenant, null);

  return (
    <ProductForm
      action={createProductAction}
      categories={categories}
      currency={tenant.organization.currency}
      canManageCategories={canCategory(tenant.role, "create")}
      submitLabel="Create product"
      pendingText="Creating…"
      cancelHref="/products"
    />
  );
}
