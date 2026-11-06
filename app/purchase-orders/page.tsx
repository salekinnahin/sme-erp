import { PageHeader, FilterToolbar, DataTable, EmptyState as SharedEmptyState, PageSkeleton } from "@/app/_components/ui";
import type { Metadata } from "next";
import Form from "next/form";
import Link from "next/link";
import { Suspense } from "react";
import { requireTenant } from "@/lib/tenancy/context";
import { listPurchaseOrders } from "@/lib/purchase-orders/purchase-orders";
import { listVendorFilterOptions } from "@/lib/purchase-orders/options";
import { vendorOptionLabel } from "@/lib/purchase-orders/form";
import { canPurchaseOrder } from "@/lib/purchase-orders/permissions";
import {
  PURCHASE_ORDER_SEARCH_MAX_LENGTH,
  parsePurchaseOrderListParams,
  purchaseOrderListHref,
} from "@/lib/purchase-orders/list-params";
import { PURCHASE_ORDER_STATUSES, PURCHASE_ORDER_STATUS_LABELS } from "@/lib/purchase-orders/validation";
import { formatCalendarDate, formatDate, formatMoney } from "@/lib/format";
import { ListPagination } from "@/app/_components/list-pagination";
import { PRIMARY_LINK, SECONDARY_LINK, TEXT_LINK } from "@/app/_components/styles";
import { PurchaseOrderStatusBadge } from "./_components/purchase-order-status-badge";

export const metadata: Metadata = { title: "Purchase orders · SME ERP" };

const INPUT = "ui-input";
const LABEL = "ui-label";

export default function PurchaseOrdersPage({ searchParams }: PageProps<"/purchase-orders">) {
  return (
    <Suspense fallback={<PageSkeleton label="Loading purchase orders…" />}>
      <PurchaseOrderList searchParams={searchParams} />
    </Suspense>
  );
}

async function PurchaseOrderList({ searchParams }: Pick<PageProps<"/purchase-orders">, "searchParams">) {
  const params = parsePurchaseOrderListParams(await searchParams);
  const tenant = await requireTenant();
  const [{ items, total, page, pageSize }, vendors] = await Promise.all([
    listPurchaseOrders(tenant, params),
    // All vendors (also inactive, since old orders reference them), capped,
    // plus the filtered one even if it is beyond the cap.
    listVendorFilterOptions(tenant, { currentId: params.vendor === "all" ? null : params.vendor }),
  ]);

  const canCreate = canPurchaseOrder(tenant.role, "create");
  const filtered = params.search !== "" || params.status !== "all" || params.vendor !== "all";
  const currency = tenant.organization.currency;
  const tz = tenant.organization.timezone;
  const vendorKnown = vendors.options.some((v) => v.id === params.vendor);

  return (
    <div className="space-y-6">
      <PageHeader title="Purchase orders" description="Manage orders placed with your suppliers." actions={<>

        {canCreate && (
          <Link href="/purchase-orders/new" className={PRIMARY_LINK}>
            New purchase order
          </Link>
        )}

      </>} />

      {/* GET form: search and filters run on the server via the URL. */}
      <FilterToolbar>
        <Form
          action="/purchase-orders"
          role="search"
          className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_12rem_16rem_auto] lg:items-end"
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
              maxLength={PURCHASE_ORDER_SEARCH_MAX_LENGTH}
              placeholder="PO number or vendor name"
              className={`mt-1 ${INPUT}`}
            />
          </div>
          <div>
            <label htmlFor="status" className={LABEL}>
              Status
            </label>
            <select id="status" name="status" defaultValue={params.status} className={`mt-1 ${INPUT}`}>
              <option value="all">All statuses</option>
              {PURCHASE_ORDER_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {PURCHASE_ORDER_STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="vendor" className={LABEL}>
              Vendor
            </label>
            <select
              id="vendor"
              name="vendor"
              defaultValue={vendorKnown ? params.vendor : "all"}
              className={`mt-1 ${INPUT}`}
            >
              <option value="all">All vendors</option>
              {vendors.options.map((v) => (
                <option key={v.id} value={v.id}>
                  {vendorOptionLabel(v)}
                </option>
              ))}
            </select>
          </div>
          <button type="submit" className={SECONDARY_LINK + " py-2"}>
            Apply
          </button>
        </Form>
        {filtered && <Link href="/purchase-orders" className={TEXT_LINK + " mt-3 inline-block"}>Reset filters</Link>}
      </FilterToolbar>

      {items.length === 0 ? (
        <EmptyState
          filtered={filtered}
          pastEnd={total === null}
          canCreate={canCreate}
          firstPageHref={purchaseOrderListHref({ ...params, page: 1 })}
        />
      ) : (
        <>
          <DataTable label="Purchase orders">
            <table className="min-w-full divide-y divide-zinc-200 text-sm dark:divide-zinc-800">
              <thead className="bg-zinc-50 text-left text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
                <tr>
                  <th scope="col" className="px-4 py-3 font-medium whitespace-nowrap">PO number</th>
                  <th scope="col" className="px-4 py-3 font-medium">Vendor</th>
                  <th scope="col" className="px-4 py-3 font-medium whitespace-nowrap">Order date</th>
                  <th scope="col" className="px-4 py-3 font-medium whitespace-nowrap">Expected delivery</th>
                  <th scope="col" className="px-4 py-3 text-right font-medium whitespace-nowrap">Grand total</th>
                  <th scope="col" className="px-4 py-3 font-medium">Status</th>
                  <th scope="col" className="px-4 py-3 font-medium">Created</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                {items.map((po) => (
                  <tr key={po.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-900">
                    <td className="px-4 py-3 font-mono font-medium whitespace-nowrap">
                      <Link href={`/purchase-orders/${po.id}`} className="hover:underline">
                        {po.purchaseOrderNumber}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <span className="font-medium">{po.vendorName}</span>
                      {po.vendorCompanyName && (
                        <span className="block text-xs text-zinc-500">{po.vendorCompanyName}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-zinc-600 dark:text-zinc-400">
                      {formatCalendarDate(po.orderDate)}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-zinc-600 dark:text-zinc-400">
                      {po.expectedDeliveryDate ? formatCalendarDate(po.expectedDeliveryDate) : "—"}
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap tabular-nums">
                      {formatMoney(po.grandTotal, currency)}
                    </td>
                    <td className="px-4 py-3">
                      <PurchaseOrderStatusBadge status={po.status} />
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-zinc-600 dark:text-zinc-400">
                      {formatDate(po.createdAt, tz)}
                    </td>
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
            prevHref={page > 1 ? purchaseOrderListHref({ ...params, page: page - 1 }) : null}
            nextHref={
              total !== null && page * pageSize < total
                ? purchaseOrderListHref({ ...params, page: page + 1 })
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
  if (pastEnd) {
    return <SharedEmptyState title="No purchase orders on this page" description="Return to the first page to see the latest records.">
      <Link href={firstPageHref} className={TEXT_LINK}>Go to the first page</Link>
    </SharedEmptyState>;
  }
  if (filtered) {
    return <SharedEmptyState title="No purchase orders match your search" description="Try another search or clear your filters.">
      <Link href="/purchase-orders" className={TEXT_LINK}>Clear search and filters</Link>
    </SharedEmptyState>;
  }
  return <SharedEmptyState title="No purchase orders yet" description="Create your first purchase order to start tracking supplier orders.">
    {canCreate && <Link href="/purchase-orders/new" className={PRIMARY_LINK}>New purchase order</Link>}
  </SharedEmptyState>;
}
