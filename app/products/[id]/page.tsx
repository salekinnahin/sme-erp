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
    <Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}>
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

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold break-all">{product.name}</h1>
            <StatusBadge status={product.status} />
          </div>
          <p className="mt-1 font-mono text-sm text-zinc-600 dark:text-zinc-400">
            {product.sku}
          </p>
        </div>
        <div className="flex flex-wrap items-start gap-2">
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
        </div>
      </div>

      {product.status === "inactive" && (
        <p className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300">
          This product is inactive. Its details are kept, and it won&apos;t be
          offered for new transactions.
        </p>
      )}

      <dl className="grid gap-x-6 gap-y-4 rounded-xl border border-zinc-200 bg-white p-6 sm:grid-cols-2 dark:border-zinc-800 dark:bg-zinc-950">
        <Item label="Product name">{product.name}</Item>
        <Item label="SKU">{product.sku}</Item>
        <Item label="Product type">{PRODUCT_TYPE_LABELS[product.productType]}</Item>
        <Item label="Category">{product.categoryName}</Item>
        <Item label="Unit">{PRODUCT_UNIT_LABELS[product.unit]}</Item>
        <Item label="Status">{product.status === "active" ? "Active" : "Inactive"}</Item>
        <Item label="Purchase price">
          {product.purchasePrice !== null && formatMoney(product.purchasePrice, currency)}
        </Item>
        <Item label="Selling price">
          {product.sellingPrice !== null && formatMoney(product.sellingPrice, currency)}
        </Item>
        {hasReorderLevel(product.productType) && (
          <Item label="Reorder level">
            {`${formatQuantity(product.reorderLevel)} ${product.unit}`}
          </Item>
        )}
        <Item label="Description" wide>
          {product.description}
        </Item>
        <Item label="Created">{formatDateTime(product.createdAt, tz)}</Item>
        <Item label="Last updated">{formatDateTime(product.updatedAt, tz)}</Item>
      </dl>
    </div>
  );
}

function Item({
  label,
  wide,
  children,
}: {
  label: string;
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={wide ? "sm:col-span-2" : undefined}>
      <dt className="text-sm font-medium text-zinc-500 dark:text-zinc-400">{label}</dt>
      <dd className="mt-1 whitespace-pre-line break-words text-zinc-900 dark:text-zinc-50">
        {children || <span className="text-zinc-400">—</span>}
      </dd>
    </div>
  );
}
