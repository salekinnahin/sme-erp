import { PageHeader, PageSkeleton } from "@/app/_components/ui";
import type { Metadata } from "next";
import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { requireTenant } from "@/lib/tenancy/context";
import { getProduct } from "@/lib/products/products";
import { listCategoryOptions } from "@/lib/products/categories";
import { canCategory, canProduct } from "@/lib/products/permissions";
import { plainDecimal } from "@/lib/format";
import { updateProductAction } from "../../actions";
import { ProductForm } from "../../_components/product-form";

export const metadata: Metadata = { title: "Edit product · SME ERP" };

export default function EditProductPage({
  params,
}: PageProps<"/products/[id]/edit">) {
  return (
    <div className="mx-auto max-w-3xl">
      <Suspense fallback={<PageSkeleton label="Loading…" />}>
        <EditProduct params={params} />
      </Suspense>
    </div>
  );
}

async function EditProduct({
  params,
}: Pick<PageProps<"/products/[id]/edit">, "params">) {
  const { id } = await params;
  const tenant = await requireTenant();
  const product = await getProduct(tenant, id);
  if (!product) notFound();
  if (!canProduct(tenant.role, "edit")) redirect(`/products/${product.id}`);

  // Active categories, plus the current one even if it is inactive or not
  // in the capped list (fetched by ID within the tenant).
  const categories = await listCategoryOptions(tenant, product.categoryId);

  return (
    <>
      <PageHeader title={<> Edit product </>} description="Set product details, classification and pricing." /><div className="mt-6">
        <ProductForm
          action={updateProductAction.bind(null, product.id)}
          categories={categories}
          currency={tenant.organization.currency}
          canManageCategories={canCategory(tenant.role, "create")}
          initialValues={{
            name: product.name,
            sku: product.sku,
            productType: product.productType,
            categoryId: product.categoryId ?? "",
            unit: product.unit,
            description: product.description ?? "",
            purchasePrice: product.purchasePrice ?? "",
            sellingPrice: product.sellingPrice ?? "",
            // numeric(18,3) reads back as e.g. "0.000"; show 0 as blank.
            reorderLevel:
              plainDecimal(product.reorderLevel) === "0"
                ? ""
                : plainDecimal(product.reorderLevel),
          }}
          submitLabel="Save changes"
          pendingText="Saving…"
          cancelHref={`/products/${product.id}`}
        />
      </div>
    </>
  );
}
