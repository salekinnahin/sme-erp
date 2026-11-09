import { DataTable, EmptyState, FilterToolbar, PageHeader, PageSkeleton } from "@/app/_components/ui";
import type { Metadata } from "next";
import Form from "next/form";
import Link from "next/link";
import { Suspense } from "react";
import { requireTenant } from "@/lib/tenancy/context";
import { listCurrentStock } from "@/lib/inventory/stock";
import { INVENTORY_SEARCH_MAX_LENGTH, parseCurrentStockParams } from "@/lib/inventory/list-params";
import {
  STOCK_TYPE_MISMATCH_MESSAGE,
  currentStockListHref,
  formatStockQuantity,
  pageLinks,
  productStockHref,
} from "@/lib/inventory/display";
import type { CurrentStockItem } from "@/lib/inventory/types";
import { PRODUCT_TYPE_LABELS } from "@/lib/products/validation";
import { ListPagination } from "@/app/_components/list-pagination";
import { Badge, StatusBadge } from "@/app/_components/status-badge";
import { SECONDARY_LINK, TEXT_LINK } from "@/app/_components/styles";

export const metadata: Metadata = { title: "Inventory · SME ERP" };

/**
 * Read-only current stock (DECISIONS 037). Stock changes only through business
 * documents (goods receipts today), so there is no create/adjust action here.
 * Rows use CURRENT product master data; balances come from the ledger.
 */
export default function InventoryPage({ searchParams }: PageProps<"/inventory">) {
  return (
    <Suspense fallback={<PageSkeleton label="Loading inventory…" />}>
      <CurrentStockList searchParams={searchParams} />
    </Suspense>
  );
}

async function CurrentStockList({ searchParams }: Pick<PageProps<"/inventory">, "searchParams">) {
  // Only search and page are read from the URL; the organization is the session tenant's.
  const params = parseCurrentStockParams(await searchParams);
  const tenant = await requireTenant();
  const { items, total, page, pageSize } = await listCurrentStock(tenant, params);
  const filtered = params.search !== "";
  const hasMismatch = items.some((item) => !item.stockTracked);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Inventory"
        description="View current stock balances and movement history."
        actions={<Link href="/products" className={SECONDARY_LINK}>Products</Link>}
      />

      {/* GET form: search runs on the server via the URL. */}
      <FilterToolbar>
        <Form action="/inventory" role="search" className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
          <div>
            <label htmlFor="q" className="ui-label">Search</label>
            <input
              id="q" name="q" type="search" defaultValue={params.search}
              maxLength={INVENTORY_SEARCH_MAX_LENGTH}
              placeholder="Product name or SKU"
              className="ui-input mt-1"
            />
          </div>
          <button type="submit" className={SECONDARY_LINK + " py-2"}>Search</button>
        </Form>
        {filtered && <Link href="/inventory" className={TEXT_LINK + " mt-3 inline-block"}>Reset search</Link>}
      </FilterToolbar>

      {items.length === 0 ? (
        total === null ? (
          <EmptyState title="No products on this page" description="Return to the first page to see current stock.">
            <Link href={currentStockListHref({ ...params, page: 1 })} className={TEXT_LINK}>Go to the first page</Link>
          </EmptyState>
        ) : filtered ? (
          <EmptyState title="No products match your search" description="Try another product name or SKU.">
            <Link href="/inventory" className={TEXT_LINK}>Clear search</Link>
          </EmptyState>
        ) : (
          <EmptyState
            title="No inventory products yet"
            description="Products with the Inventory type appear here, with their stock from recorded goods receipts."
          >
            <Link href="/products" className={TEXT_LINK}>View products</Link>
          </EmptyState>
        )
      ) : (
        <>
          {hasMismatch && (
            <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              <span aria-hidden="true">⚠ </span>
              Some products below have stock history but are no longer classified as inventory. Their recorded
              balances are still shown.
            </p>
          )}
          <DataTable label="Current stock">
            <table className="receiving-table w-full text-left text-sm">
              <thead>
                <tr>
                  <th scope="col">Product</th>
                  <th scope="col">SKU</th>
                  <th scope="col">Unit</th>
                  <th scope="col">Type</th>
                  <th scope="col">Status</th>
                  <th scope="col" className="num emphasis">Current stock</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => <CurrentStockRow key={item.productId} item={item} />)}
              </tbody>
            </table>
          </DataTable>
          <ListPagination
            page={page}
            pageSize={pageSize}
            shown={items.length}
            total={total ?? 0}
            {...pageLinks(page, pageSize, total, (n) => currentStockListHref({ ...params, page: n }))}
          />
        </>
      )}
    </div>
  );
}

function CurrentStockRow({ item }: { item: CurrentStockItem }) {
  return (
    <tr>
      <td data-label="Product" className="font-medium">
        <Link href={productStockHref(item.productId)} className="hover:underline">{item.productName}</Link>
      </td>
      {/* Short SKUs stay on one line; long ones may wrap so Current stock stays visible at tablet width. */}
      <td data-label="SKU" className="font-mono text-xs md:min-w-24">{item.sku}</td>
      <td data-label="Unit" className="text-muted">{item.unit}</td>
      <td data-label="Type">
        <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
          {PRODUCT_TYPE_LABELS[item.productType]}
          {!item.stockTracked && <TypeMismatchBadge />}
        </span>
      </td>
      <td data-label="Status"><StatusBadge status={item.productStatus} /></td>
      <td data-label="Current stock" className="num emphasis remaining">{formatStockQuantity(item.quantity)}</td>
    </tr>
  );
}

function TypeMismatchBadge() {
  return (
    <span title={STOCK_TYPE_MISMATCH_MESSAGE}>
      <Badge tone="amber"><span aria-hidden="true">⚠</span> Stock history exists</Badge>
      <span className="sr-only"> {STOCK_TYPE_MISMATCH_MESSAGE}</span>
    </span>
  );
}
