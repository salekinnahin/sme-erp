import { PageHeader, SectionCard, MetadataList, MetadataItem, PageSkeleton } from "@/app/_components/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { requireTenant } from "@/lib/tenancy/context";
import { getProduct } from "@/lib/products/products";
import { canProduct } from "@/lib/products/permissions";
import {
  PRODUCT_TYPE_LABELS,
  PRODUCT_UNIT_LABELS,
  hasReorderLevel,
} from "@/lib/products/validation";
import { formatDateTime, formatMoney, formatQuantity } from "@/lib/format";
import { StatusActions } from "../_components/status-actions";
import { StatusBadge } from "@/app/_components/status-badge";
import { SECONDARY_LINK, TEXT_LINK } from "@/app/_components/styles";

export const metadata: Metadata = { title: "Product · SME ERP" };

export default function ProductPage({ params }: PageProps<"/products/[id]">) {
  return (
    <Suspense fallback={<PageSkeleton label="Loading…" />}>
      <ProductDetail params={params} />
    </Suspense>
  );
}

async function ProductDetail({
  params,
}: Pick<PageProps<"/products/[id]">, "params">) {
  const { id } = await params;
  const tenant = await requireTenant();
  // Null for malformed IDs, unknown IDs and other organizations' products.
  const product = await getProduct(tenant, id);
  if (!product) notFound();

  const tz = tenant.organization.timezone;
  const currency = tenant.organization.currency;
  const canEdit = canProduct(tenant.role, "edit");
  const canChangeStatus = canProduct(tenant.role, "changeStatus");

  return (
    <div className="space-y-6">
      <Link href="/products" className={TEXT_LINK}>
        ← Products
      </Link>

      <PageHeader title={product.name} description={product.sku} badge={<StatusBadge status={product.status} />} actions={<>
        {canEdit && (
          <Link href={`/products/${product.id}/edit`} className={SECONDARY_LINK}>
            Edit
          </Link>
        )}
        {canChangeStatus && (
          // key resets the confirmation step after the status changes
          <StatusActions
            key={product.status}
            productId={product.id}
            productName={product.name}
            status={product.status}
          />
        )}
      </>} />

      {product.status === "inactive" && (
        <p className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300">
          This product is inactive. Its details are kept, and it won&apos;t be
          offered for new transactions.
        </p>
      )}

      <SectionCard title="Product details"><MetadataList>
        <MetadataItem label="Product name">{product.name}</MetadataItem>
        <MetadataItem label="SKU">{product.sku}</MetadataItem>
        <MetadataItem label="Product type">{PRODUCT_TYPE_LABELS[product.productType]}</MetadataItem>
        <MetadataItem label="Category">{product.categoryName}</MetadataItem>
        <MetadataItem label="Unit">{PRODUCT_UNIT_LABELS[product.unit]}</MetadataItem>
        <MetadataItem label="Status">{product.status === "active" ? "Active" : "Inactive"}</MetadataItem>
        <MetadataItem label="Purchase price">
          {product.purchasePrice !== null && formatMoney(product.purchasePrice, currency)}
        </MetadataItem>
        <MetadataItem label="Selling price">
          {product.sellingPrice !== null && formatMoney(product.sellingPrice, currency)}
        </MetadataItem>
        {hasReorderLevel(product.productType) && (
          <MetadataItem label="Reorder level">
            {`${formatQuantity(product.reorderLevel)} ${product.unit}`}
          </MetadataItem>
        )}
        <MetadataItem label="Description" wide>
          {product.description}
        </MetadataItem>
        <MetadataItem label="Created">{formatDateTime(product.createdAt, tz)}</MetadataItem>
        <MetadataItem label="Last updated">{formatDateTime(product.updatedAt, tz)}</MetadataItem>
      </MetadataList></SectionCard>
    </div>
  );
}
