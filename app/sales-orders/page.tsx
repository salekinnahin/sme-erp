import { PageHeader, FilterToolbar, DataTable, EmptyState as SharedEmptyState, PageSkeleton } from "@/app/_components/ui";
import type { Metadata } from "next";
import Form from "next/form";
import Link from "next/link";
import { Suspense } from "react";
import { requireTenant } from "@/lib/tenancy/context";
import { listSalesOrders } from "@/lib/sales-orders/sales-orders";
import { listCustomerOptions } from "@/lib/quotations/options";
import { customerOptionLabel } from "@/lib/quotations/form";
import { canSalesOrder } from "@/lib/sales-orders/permissions";
import {
  SALES_ORDER_SEARCH_MAX_LENGTH,
  parseSalesOrderListParams,
  salesOrderListHref,
} from "@/lib/sales-orders/list-params";
import { SALES_ORDER_STATUSES, SALES_ORDER_STATUS_LABELS } from "@/lib/sales-orders/validation";
import { formatCalendarDate, formatMoney } from "@/lib/format";
import { ListPagination } from "@/app/_components/list-pagination";
import { PRIMARY_LINK, SECONDARY_LINK, TEXT_LINK } from "@/app/_components/styles";
import { SalesOrderStatusBadge } from "./_components/sales-order-status-badge";

export const metadata: Metadata = { title: "Sales orders · SME ERP" };

const INPUT = "ui-input";
const LABEL = "ui-label";

export default function SalesOrdersPage({ searchParams }: PageProps<"/sales-orders">) {
  return (
    <Suspense fallback={<PageSkeleton label="Loading sales orders…" />}>
      <SalesOrderList searchParams={searchParams} />
    </Suspense>
  );
}

async function SalesOrderList({ searchParams }: Pick<PageProps<"/sales-orders">, "searchParams">) {
  const params = parseSalesOrderListParams(await searchParams);
  const tenant = await requireTenant();
  const [{ items, total, page, pageSize }, customers] = await Promise.all([
    listSalesOrders(tenant, params),
    // Same customer filter as the quotation list: all customers (also
    // inactive, since old orders reference them), plus the filtered one even
    // if it is beyond the cap.
    listCustomerOptions(tenant, {
      includeInactive: true,
      currentId: params.customer === "all" ? null : params.customer,
    }),
  ]);

  const canCreate = canSalesOrder(tenant.role, "create");
  const filtered = params.search !== "" || params.status !== "all" || params.customer !== "all";
  const currency = tenant.organization.currency;
  const customerKnown = customers.options.some((c) => c.id === params.customer);

  return (
    <div className="space-y-6">
      <PageHeader title="Sales orders" description="Manage customer orders from draft to completion." actions={<>

        {canCreate && (
          <Link href="/sales-orders/new" className={PRIMARY_LINK}>
            New sales order
          </Link>
        )}

      </>} />

      {/* GET form: search and filters run on the server via the URL. */}
      <FilterToolbar>
        <Form
          action="/sales-orders"
          role="search"
          className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_10rem_16rem_auto] lg:items-end"
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
              maxLength={SALES_ORDER_SEARCH_MAX_LENGTH}
              placeholder="Sales order number or customer name"
              className={`mt-1 ${INPUT}`}
            />
          </div>
          <div>
            <label htmlFor="status" className={LABEL}>
              Status
            </label>
            <select id="status" name="status" defaultValue={params.status} className={`mt-1 ${INPUT}`}>
              <option value="all">All statuses</option>
              {SALES_ORDER_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {SALES_ORDER_STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="customer" className={LABEL}>
              Customer
            </label>
            <select
              id="customer"
              name="customer"
              defaultValue={customerKnown ? params.customer : "all"}
              className={`mt-1 ${INPUT}`}
            >
              <option value="all">All customers</option>
              {customers.options.map((c) => (
                <option key={c.id} value={c.id}>
                  {customerOptionLabel(c)}
                </option>
              ))}
            </select>
          </div>
          <button type="submit" className={SECONDARY_LINK + " py-2"}>
            Apply
          </button>
        </Form>
        {filtered && <Link href="/sales-orders" className={TEXT_LINK + " mt-3 inline-block"}>Reset filters</Link>}
      </FilterToolbar>

      {items.length === 0 ? (
        <EmptyState
          filtered={filtered}
          pastEnd={total === null}
          canCreate={canCreate}
          firstPageHref={salesOrderListHref({ ...params, page: 1 })}
        />
      ) : (
        <>
          <DataTable label="Sales orders">
            <table className="min-w-full divide-y divide-zinc-200 text-sm dark:divide-zinc-800">
              <thead className="bg-zinc-50 text-left text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
                <tr>
                  <th scope="col" className="px-4 py-3 font-medium whitespace-nowrap">Sales order number</th>
                  <th scope="col" className="px-4 py-3 font-medium">Customer</th>
                  <th scope="col" className="px-4 py-3 font-medium whitespace-nowrap">Order date</th>
                  <th scope="col" className="px-4 py-3 font-medium whitespace-nowrap">Expected delivery</th>
                  <th scope="col" className="px-4 py-3 text-right font-medium whitespace-nowrap">Grand total</th>
                  <th scope="col" className="px-4 py-3 font-medium">Status</th>
                  <th scope="col" className="px-4 py-3 font-medium">Source</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                {items.map((so) => (
                  <tr key={so.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-900">
                    <td className="px-4 py-3 font-mono font-medium whitespace-nowrap">
                      <Link href={`/sales-orders/${so.id}`} className="hover:underline">
                        {so.salesOrderNumber}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <span className="font-medium">{so.customerName}</span>
                      {so.customerCompanyName && (
                        <span className="block text-xs text-zinc-500">{so.customerCompanyName}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-zinc-600 dark:text-zinc-400">
                      {formatCalendarDate(so.orderDate)}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-zinc-600 dark:text-zinc-400">
                      {so.expectedDeliveryDate ? formatCalendarDate(so.expectedDeliveryDate) : "—"}
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap tabular-nums">
                      {formatMoney(so.grandTotal, currency)}
                    </td>
                    <td className="px-4 py-3">
                      <SalesOrderStatusBadge status={so.status} />
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-zinc-600 dark:text-zinc-400">
                      {so.sourceQuotationNumber ? (
                        <span className="font-mono text-xs">{so.sourceQuotationNumber}</span>
                      ) : (
                        <span className="text-xs">Direct</span>
                      )}
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
            prevHref={page > 1 ? salesOrderListHref({ ...params, page: page - 1 }) : null}
            nextHref={
              total !== null && page * pageSize < total
                ? salesOrderListHref({ ...params, page: page + 1 })
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
    return <SharedEmptyState title="No sales orders on this page" description="Return to the first page to see the latest records.">
      <Link href={firstPageHref} className={TEXT_LINK}>Go to the first page</Link>
    </SharedEmptyState>;
  }
  if (filtered) {
    return <SharedEmptyState title="No sales orders match your search" description="Try another search or clear your filters.">
      <Link href="/sales-orders" className={TEXT_LINK}>Clear search and filters</Link>
    </SharedEmptyState>;
  }
  return <SharedEmptyState title="No sales orders yet" description="Create an order to start tracking customer fulfilment.">
    {canCreate && <Link href="/sales-orders/new" className={PRIMARY_LINK}>New sales order</Link>}
  </SharedEmptyState>;
}
