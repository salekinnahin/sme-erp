import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { DataTable, EmptyState, MetadataItem, MetadataList, PageHeader, PageSkeleton, SectionCard } from "@/app/_components/ui";
import { ListPagination } from "@/app/_components/list-pagination";
import { StatusBadge } from "@/app/_components/status-badge";
import { SECONDARY_LINK, TEXT_LINK } from "@/app/_components/styles";
import { Alert } from "@/app/auth/_components/ui";
import { requireTenant } from "@/lib/tenancy/context";
import { getProductStock } from "@/lib/inventory/stock";
import { listStockMovements } from "@/lib/inventory/movements";
import { parseStockMovementParams } from "@/lib/inventory/list-params";
import { INVENTORY_MESSAGES } from "@/lib/inventory/messages";
import {
  formatMovementQuantity,
  formatStockQuantity,
  pageLinks,
  productStockHref,
  stockMovementTypeLabel,
  stockSourceTypeLabel,
  stockUnitLabel,
} from "@/lib/inventory/display";
import type { CurrentStockItem, InventoryPage, StockMovement } from "@/lib/inventory/types";
import { PRODUCT_TYPE_LABELS } from "@/lib/products/validation";
import { isUuid } from "@/lib/validation/fields";
import { formatCalendarDate } from "@/lib/format";

export const metadata: Metadata = { title: "Product stock · SME ERP" };

/**
 * Read-only stock view of one product (DECISIONS 037). The summary uses
 * CURRENT product master data and the ledger balance; the movement history
 * shows each movement's recorded SNAPSHOTS. No stock-writing action exists.
 */
export default function ProductStockPage({ params, searchParams }: PageProps<"/inventory/[productId]">) {
  return (
    <Suspense fallback={<PageSkeleton label="Loading product stock…" />}>
      <ProductStockDetail params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function ProductStockDetail({ params, searchParams }: Pick<PageProps<"/inventory/[productId]">, "params" | "searchParams">) {
  const [{ productId }, query] = await Promise.all([params, searchParams]);
  const tenant = await requireTenant();
  if (!isUuid(productId)) notFound();
  // The product filter is the route's (validated) ID, never a query parameter;
  // only the page number is read from the URL.
  const { page } = parseStockMovementParams({ page: query.page });

  const [stock, movements] = await Promise.all([
    // Null for unknown, other organizations' and non-stock products alike.
    getProductStock(tenant, productId),
    // A movement read failure is shown inline; the stock summary still renders.
    listStockMovements(tenant, { productId, page }).catch(() => null),
  ]);
  if (!stock) notFound();

  return (
    <div className="space-y-6">
      <Link href="/inventory" className={TEXT_LINK}>← Inventory</Link>
      <PageHeader
        title={stock.productName}
        description={<><span className="font-mono">{stock.sku}</span> · {PRODUCT_TYPE_LABELS[stock.productType]}</>}
        badge={<StatusBadge status={stock.productStatus} />}
        actions={<Link href={`/products/${stock.productId}`} className={SECONDARY_LINK}>View product</Link>}
      />

      {!stock.stockTracked && <TypeMismatchWarning stock={stock} />}

      <SectionCard title="Stock summary">
        <div className="grid gap-6 sm:grid-cols-[minmax(0,14rem)_1fr]">
          <div>
            <p className="metadata-label">Current stock</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums break-all">
              {formatStockQuantity(stock.quantity)} <span className="text-base font-medium text-muted">{stock.unit}</span>
            </p>
          </div>
          <MetadataList>
            <MetadataItem label="SKU"><span className="font-mono">{stock.sku}</span></MetadataItem>
            <MetadataItem label="Unit">{stockUnitLabel(stock.unit)}</MetadataItem>
            <MetadataItem label="Product type">{PRODUCT_TYPE_LABELS[stock.productType]}</MetadataItem>
            <MetadataItem label="Status">{stock.productStatus === "active" ? "Active" : "Inactive"}</MetadataItem>
          </MetadataList>
        </div>
        <p className="mt-4 text-xs text-muted">
          Stock changes only through recorded business documents, such as goods receipts.
        </p>
      </SectionCard>

      <MovementHistory productId={stock.productId} movements={movements} />
    </div>
  );
}

function TypeMismatchWarning({ stock }: { stock: CurrentStockItem }) {
  return (
    <section aria-labelledby="type-mismatch-heading" className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
      <h2 id="type-mismatch-heading" className="font-semibold">
        <span aria-hidden="true">⚠ </span>Inventory history mismatch
      </h2>
      <p className="mt-1">
        This product has stock movements but its current type is {PRODUCT_TYPE_LABELS[stock.productType]}.
        The historical stock balance is still shown so ledger data is not hidden.
      </p>
    </section>
  );
}

function MovementHistory({ productId, movements }: { productId: string; movements: InventoryPage<StockMovement> | null }) {
  return (
    <section className="min-w-0" aria-labelledby="movement-history-heading">
      <h2 id="movement-history-heading" className="mb-1 text-sm font-semibold">
        Movement history
        {movements?.total ? <span className="ml-1 text-xs font-normal text-muted">({movements.total})</span> : null}
      </h2>
      <p className="mb-3 text-xs text-muted">
        Permanent ledger entries, newest first. Product details are shown as recorded at the time of each movement.
      </p>
      {movements === null ? (
        <Alert kind="error">{INVENTORY_MESSAGES.movementsLoadFailed} Please refresh the page to try again.</Alert>
      ) : movements.items.length === 0 ? (
        movements.total === null ? (
          <EmptyState title="No movements on this page" description="Return to the first page to see the latest movements.">
            <Link href={productStockHref(productId)} className={TEXT_LINK}>Go to the first page</Link>
          </EmptyState>
        ) : (
          <EmptyState
            title="No stock movements yet"
            description="Stock movements will appear here when inventory transactions are recorded."
          />
        )
      ) : (
        <>
          <DataTable label="Stock movement history">
            <table className="receiving-table w-full text-left text-sm">
              <thead>
                <tr>
                  <th scope="col">Date</th>
                  <th scope="col">Movement</th>
                  <th scope="col" className="num emphasis">Quantity</th>
                  <th scope="col">Source</th>
                  <th scope="col">Reference</th>
                  <th scope="col">Recorded product</th>
                </tr>
              </thead>
              <tbody>
                {movements.items.map((movement) => <MovementRow key={movement.id} movement={movement} />)}
              </tbody>
            </table>
          </DataTable>
          <ListPagination
            page={movements.page}
            pageSize={movements.pageSize}
            shown={movements.items.length}
            total={movements.total ?? 0}
            {...pageLinks(movements.page, movements.pageSize, movements.total, (n) => productStockHref(productId, n))}
          />
        </>
      )}
    </section>
  );
}

function MovementRow({ movement }: { movement: StockMovement }) {
  const { source } = movement;
  return (
    <tr>
      <td data-label="Date" className="whitespace-nowrap">{formatCalendarDate(movement.occurredOn)}</td>
      <td data-label="Movement">{stockMovementTypeLabel(movement.type)}</td>
      {/* One wrapper per cell keeps value + unit together in the stacked mobile cards. */}
      <td data-label="Quantity" className="num emphasis remaining">
        <span>
          {formatMovementQuantity(movement.quantityDelta)}
          <span className="ml-1 text-xs font-normal text-muted">{movement.unit}</span>
          <span className="sr-only">{movement.direction === "in" ? " (stock in)" : " (stock out)"}</span>
        </span>
      </td>
      <td data-label="Source">{stockSourceTypeLabel(source.type)}</td>
      <td data-label="Reference" className="whitespace-nowrap">
        {/* href comes from the explicit source-type mapping in lib/inventory; the
            destination route enforces tenant access again. */}
        <Link href={source.href} className="font-mono">{source.documentNumber ?? "View source"}</Link>
      </td>
      <td data-label="Recorded product">
        <span className="min-w-0 break-words">
          <span className="block">{movement.productName}</span>
          <span className="block font-mono text-xs text-muted">{movement.sku}</span>
        </span>
      </td>
    </tr>
  );
}
