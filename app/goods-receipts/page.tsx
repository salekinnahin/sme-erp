import { DataTable, EmptyState, FilterToolbar, PageHeader, PageSkeleton } from "@/app/_components/ui";
import type { Metadata } from "next";
import Form from "next/form";
import Link from "next/link";
import { Suspense } from "react";
import { requireTenant } from "@/lib/tenancy/context";
import { listGoodsReceipts } from "@/lib/goods-receipts/goods-receipts";
import {
  GOODS_RECEIPT_SEARCH_MAX_LENGTH,
  goodsReceiptListHref,
  parseGoodsReceiptListParams,
} from "@/lib/goods-receipts/list-params";
import { receivedByDisplay } from "@/lib/goods-receipts/receiving";
import { formatCalendarDate, formatDate } from "@/lib/format";
import { ListPagination } from "@/app/_components/list-pagination";
import { SECONDARY_LINK, TEXT_LINK } from "@/app/_components/styles";

export const metadata: Metadata = { title: "Goods receipts · SME ERP" };

export default function GoodsReceiptsPage({ searchParams }: PageProps<"/goods-receipts">) {
  return (
    <Suspense fallback={<PageSkeleton label="Loading goods receipts…" />}>
      <GoodsReceiptList searchParams={searchParams} />
    </Suspense>
  );
}

async function GoodsReceiptList({ searchParams }: Pick<PageProps<"/goods-receipts">, "searchParams">) {
  const params = parseGoodsReceiptListParams(await searchParams);
  const tenant = await requireTenant();
  const { items, total, page, pageSize } = await listGoodsReceipts(tenant, params);
  const filtered = params.search !== "";
  const tz = tenant.organization.timezone;

  return (
    <div className="space-y-6">
      {/* Receipts always start from a purchase order, so there is no "New" button here. */}
      <PageHeader
        title="Goods receipts"
        description="Deliveries received against purchase orders. Record a receipt from an ordered purchase order."
        actions={<Link href="/purchase-orders" className={SECONDARY_LINK}>Purchase orders</Link>}
      />

      <FilterToolbar>
        <Form action="/goods-receipts" role="search" className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
          <div>
            <label htmlFor="q" className="ui-label">Search</label>
            <input
              id="q" name="q" type="search" defaultValue={params.search}
              maxLength={GOODS_RECEIPT_SEARCH_MAX_LENGTH}
              placeholder="GR number, PO number or vendor"
              className="ui-input mt-1"
            />
          </div>
          <button type="submit" className={SECONDARY_LINK + " py-2"}>Search</button>
        </Form>
        {filtered && <Link href="/goods-receipts" className={TEXT_LINK + " mt-3 inline-block"}>Reset search</Link>}
      </FilterToolbar>

      {items.length === 0 ? (
        total === null ? (
          <EmptyState title="No goods receipts on this page" description="Return to the first page to see the latest records.">
            <Link href={goodsReceiptListHref({ ...params, page: 1 })} className={TEXT_LINK}>Go to the first page</Link>
          </EmptyState>
        ) : filtered ? (
          <EmptyState title="No goods receipts match your search" description="Try another GR number, PO number or vendor.">
            <Link href="/goods-receipts" className={TEXT_LINK}>Clear search and filters</Link>
          </EmptyState>
        ) : (
          <EmptyState title="No goods receipts yet" description="Open an ordered purchase order and choose Receive goods when a delivery arrives.">
            <Link href="/purchase-orders?status=ordered" className={TEXT_LINK}>View ordered purchase orders</Link>
          </EmptyState>
        )
      ) : (
        <>
          <DataTable label="Goods receipts">
            <table className="min-w-full text-left text-sm">
              <thead>
                <tr>
                  <th scope="col" className="px-4">GR number</th>
                  <th scope="col" className="px-4">Purchase order</th>
                  <th scope="col" className="px-4">Vendor</th>
                  <th scope="col" className="px-4">Received date</th>
                  <th scope="col" className="px-4 text-right">Items</th>
                  <th scope="col" className="px-4">Received by</th>
                  <th scope="col" className="px-4">Created</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {items.map((r) => (
                  <tr key={r.id}>
                    <td className="px-4 font-mono font-medium whitespace-nowrap">
                      <Link href={`/goods-receipts/${r.id}`}>{r.goodsReceiptNumber}</Link>
                    </td>
                    <td className="px-4 font-mono whitespace-nowrap">
                      <Link href={`/purchase-orders/${r.purchaseOrderId}`}>{r.purchaseOrderNumber}</Link>
                    </td>
                    <td className="px-4">
                      <span className="font-medium">{r.vendorName}</span>
                      {r.vendorCompanyName && <span className="block text-xs text-muted">{r.vendorCompanyName}</span>}
                    </td>
                    <td className="px-4 whitespace-nowrap">{formatCalendarDate(r.receivedDate)}</td>
                    <td className="px-4 text-right tabular-nums">{r.itemCount}</td>
                    <td className="px-4 whitespace-nowrap text-muted">{receivedByDisplay(r.receivedByName)}</td>
                    <td className="px-4 whitespace-nowrap text-muted">{formatDate(r.createdAt, tz)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </DataTable>
          <ListPagination
            page={page}
            pageSize={pageSize}
            shown={items.length}
            total={total ?? 0}
            prevHref={page > 1 ? goodsReceiptListHref({ ...params, page: page - 1 }) : null}
            nextHref={total !== null && page * pageSize < total ? goodsReceiptListHref({ ...params, page: page + 1 }) : null}
          />
        </>
      )}
    </div>
  );
}
