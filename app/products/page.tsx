import type { Metadata } from "next";
import Form from "next/form";
import Link from "next/link";
import { Suspense } from "react";
import { requireTenant } from "@/lib/tenancy/context";
import { listProducts } from "@/lib/products/products";
import { listCategories } from "@/lib/products/categories";
import { canProduct } from "@/lib/products/permissions";
import {
  PRODUCT_SEARCH_MAX_LENGTH,
  PRODUCT_TYPES,
  PRODUCT_TYPE_LABELS,
  parseProductListParams,
  type ProductListParams,
  type ProductStatusFilter,
} from "@/lib/products/validation";
import { formatMoney } from "@/lib/format";
import { ListPagination } from "@/app/_components/list-pagination";
import { StatusBadge } from "@/app/_components/status-badge";
import { PRIMARY_LINK, SECONDARY_LINK, TEXT_LINK } from "@/app/_components/styles";

export const metadata: Metadata = { title: "Products · SME ERP" };

const STATUS_OPTIONS: { value: ProductStatusFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
];

const INPUT =
  "block w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-zinc-900 shadow-sm outline-none focus:border-zinc-900 focus:ring-1 focus:ring-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:focus:border-zinc-300 dark:focus:ring-zinc-300";
const LABEL = "block text-sm font-medium text-zinc-700 dark:text-zinc-300";

export default function ProductsPage({ searchParams }: PageProps<"/products">) {
  return (
    <Suspense fallback={<p className="text-sm text-zinc-500">Loading products…</p>}>
      <ProductList searchParams={searchParams} />
    </Suspense>
  );
}

function listHref(params: ProductListParams): string {
  const query = new URLSearchParams();
  if (params.search) query.set("q", params.search);
  if (params.status !== "all") query.set("status", params.status);
  if (params.type !== "all") query.set("type", params.type);
  if (params.category !== "all") query.set("category", params.category);
  if (params.page > 1) query.set("page", String(params.page));
  const qs = query.toString();
  return qs ? `/products?${qs}` : "/products";
}

async function ProductList({
  searchParams,
}: Pick<PageProps<"/products">, "searchParams">) {
  const params = parseProductListParams(await searchParams);
  const tenant = await requireTenant();
  const [{ items, total, page, pageSize }, categories] = await Promise.all([
    listProducts(tenant, params),
    listCategories(tenant),
  ]);

  const canCreate = canProduct(tenant.role, "create");
  const filtered =
    params.search !== "" ||
    params.status !== "all" ||
    params.type !== "all" ||
    params.category !== "all";
  const currency = tenant.organization.currency;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">Products</h1>
        <div className="flex flex-wrap items-center gap-2">
          <Link href="/products/categories" className={SECONDARY_LINK + " py-2"}>
            Categories
          </Link>
          {canCreate && (
            <Link href="/products/new" className={PRIMARY_LINK}>
              Add product
            </Link>
          )}
        </div>
      </div>

      {/* GET form: search and filters run on the server via the URL. */}
      <Form
        action="/products"
        role="search"
        className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_9rem_10rem_11rem_auto] lg:items-end"
      >
        <div className="sm:col-span-2 lg:col-span-1">
          <label htmlFor="q" className={LABEL}>
            Search
          </label>
          <input
            id="q"
            name="q"
            type="search"
            defaultValue={params.search}
            maxLength={PRODUCT_SEARCH_MAX_LENGTH}
            placeholder="Name, SKU or category"
            className={`mt-1 ${INPUT}`}
          />
        </div>
        <div>
          <label htmlFor="status" className={LABEL}>
            Status
          </label>
          <select id="status" name="status" defaultValue={params.status} className={`mt-1 ${INPUT}`}>
            {STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="type" className={LABEL}>
            Type
          </label>
          <select id="type" name="type" defaultValue={params.type} className={`mt-1 ${INPUT}`}>
            <option value="all">All types</option>
            {PRODUCT_TYPES.map((t) => (
              <option key={t} value={t}>
                {PRODUCT_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="category" className={LABEL}>
            Category
          </label>
          <select
            id="category"
            name="category"
            defaultValue={params.category}
            className={`mt-1 ${INPUT}`}
          >
            <option value="all">All categories</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.status === "inactive" ? `${c.name} (inactive)` : c.name}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" className={SECONDARY_LINK + " py-2"}>
          Apply
        </button>
      </Form>

      {items.length === 0 ? (
        <EmptyState
          filtered={filtered}
          pastEnd={total === null}
          canCreate={canCreate}
          firstPageHref={listHref({ ...params, page: 1 })}
        />
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
            <table className="min-w-full divide-y divide-zinc-200 text-sm dark:divide-zinc-800">
              <thead className="bg-zinc-50 text-left text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
                <tr>
                  <th scope="col" className="px-4 py-3 font-medium">Product name</th>
                  <th scope="col" className="px-4 py-3 font-medium">SKU</th>
                  <th scope="col" className="px-4 py-3 font-medium">Category</th>
                  <th scope="col" className="px-4 py-3 font-medium">Type</th>
                  <th scope="col" className="px-4 py-3 font-medium">Unit</th>
                  <th scope="col" className="px-4 py-3 text-right font-medium whitespace-nowrap">Purchase price</th>
                  <th scope="col" className="px-4 py-3 text-right font-medium whitespace-nowrap">Selling price</th>
                  <th scope="col" className="px-4 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                {items.map((p) => (
                  <tr key={p.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-900">
                    <td className="px-4 py-3 font-medium">
                      <Link href={`/products/${p.id}`} className="hover:underline">
                        {p.name}
                      </Link>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-zinc-700 dark:text-zinc-300">{p.sku}</td>
                    <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400">{p.categoryName ?? "—"}</td>
                    <td className="px-4 py-3 whitespace-nowrap text-zinc-600 dark:text-zinc-400">
                      {PRODUCT_TYPE_LABELS[p.productType]}
                    </td>
                    <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400">{p.unit}</td>
                    <td className="px-4 py-3 text-right whitespace-nowrap tabular-nums text-zinc-600 dark:text-zinc-400">
                      {p.purchasePrice !== null ? formatMoney(p.purchasePrice, currency) : "—"}
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap tabular-nums text-zinc-600 dark:text-zinc-400">
                      {p.sellingPrice !== null ? formatMoney(p.sellingPrice, currency) : "—"}
                    </td>
                    <td className="px-4 py-3"><StatusBadge status={p.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ListPagination
            page={page}
            pageSize={pageSize}
            shown={items.length}
            total={total ?? 0}
            prevHref={page > 1 ? listHref({ ...params, page: page - 1 }) : null}
            nextHref={
              total !== null && page * pageSize < total
                ? listHref({ ...params, page: page + 1 })
                : null
            }
          />
        </>
      )}
    </div>
  );
}

function EmptyState({
  filtered,
  pastEnd,
  canCreate,
  firstPageHref,
}: {
  filtered: boolean;
  pastEnd: boolean;
  canCreate: boolean;
  firstPageHref: string;
}) {
  let body: React.ReactNode;
  if (pastEnd) {
    body = (
      <>
        <p>There are no products on this page.</p>
        <Link href={firstPageHref} className={TEXT_LINK}>
          Go to the first page
        </Link>
      </>
    );
  } else if (filtered) {
    body = (
      <>
        <p>No products match your search.</p>
        <Link href="/products" className={TEXT_LINK}>
          Clear search and filters
        </Link>
      </>
    );
  } else {
    body = (
      <>
        <p>No products yet.</p>
        {canCreate && (
          <Link href="/products/new" className={PRIMARY_LINK}>
            Add your first product
          </Link>
        )}
      </>
    );
  }
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-zinc-300 bg-white p-10 text-center text-zinc-600 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-400">
      {body}
    </div>
  );
}
