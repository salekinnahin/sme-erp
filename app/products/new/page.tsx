import { PageHeader, PageSkeleton } from "@/app/_components/ui";
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
    <div className="mx-auto max-w-3xl">
      <PageHeader title={<> New product </>} description="Set product details, classification and pricing." /><div className="mt-6">
        <Suspense fallback={<PageSkeleton label="Loading…" />}>
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
