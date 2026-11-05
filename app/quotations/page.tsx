import type { Metadata } from "next";
import Form from "next/form";
import Link from "next/link";
import { Suspense } from "react";
import { requireTenant } from "@/lib/tenancy/context";
import { listQuotations } from "@/lib/quotations/quotations";
import { listCustomerOptions } from "@/lib/quotations/options";
import { customerOptionLabel } from "@/lib/quotations/form";
import { canQuotation } from "@/lib/quotations/permissions";
import {
  QUOTATION_SEARCH_MAX_LENGTH,
  QUOTATION_STATUSES,
  QUOTATION_STATUS_LABELS,
  parseQuotationListParams,
  quotationListHref,
} from "@/lib/quotations/validation";
import { formatCalendarDate, formatMoney } from "@/lib/format";
import { ListPagination } from "@/app/_components/list-pagination";
import { PRIMARY_LINK, SECONDARY_LINK, TEXT_LINK } from "@/app/_components/styles";
import { QuotationStatusBadge } from "./_components/quotation-status-badge";

export const metadata: Metadata = { title: "Quotations · SME ERP" };

const INPUT =
  "block w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-zinc-900 shadow-sm outline-none focus:border-zinc-900 focus:ring-1 focus:ring-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:focus:border-zinc-300 dark:focus:ring-zinc-300";
const LABEL = "block text-sm font-medium text-zinc-700 dark:text-zinc-300";

export default function QuotationsPage({ searchParams }: PageProps<"/quotations">) {
  return (
    <Suspense fallback={<p className="text-sm text-zinc-500">Loading quotations…</p>}>
      <QuotationList searchParams={searchParams} />
    </Suspense>
  );
}

async function QuotationList({ searchParams }: Pick<PageProps<"/quotations">, "searchParams">) {
  const params = parseQuotationListParams(await searchParams);
  const tenant = await requireTenant();
  const [{ items, total, page, pageSize }, customers] = await Promise.all([
    listQuotations(tenant, params),
    // All customers (also inactive, since old quotations reference them),
    // plus the filtered one even if it is beyond the cap.
    listCustomerOptions(tenant, {
      includeInactive: true,
      currentId: params.customer === "all" ? null : params.customer,
    }),
  ]);

  const canCreate = canQuotation(tenant.role, "create");
  const filtered = params.search !== "" || params.status !== "all" || params.customer !== "all";
  const currency = tenant.organization.currency;
  // A customer filter for an ID that is not one of this tenant's customers
  // is ignored by the select (it shows "All customers") and matches nothing.
  const customerKnown = customers.options.some((c) => c.id === params.customer);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">Quotations</h1>
        {canCreate && (
          <Link href="/quotations/new" className={PRIMARY_LINK}>
            New quotation
          </Link>
        )}
      </div>

      {/* GET form: search and filters run on the server via the URL. */}
      <Form
        action="/quotations"
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
            maxLength={QUOTATION_SEARCH_MAX_LENGTH}
            placeholder="Quotation number or customer name"
            className={`mt-1 ${INPUT}`}
          />
        </div>
        <div>
          <label htmlFor="status" className={LABEL}>
            Status
          </label>
          <select id="status" name="status" defaultValue={params.status} className={`mt-1 ${INPUT}`}>
            <option value="all">All statuses</option>
            {QUOTATION_STATUSES.map((s) => (
              <option key={s} value={s}>
                {QUOTATION_STATUS_LABELS[s]}
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

      {items.length === 0 ? (
        <EmptyState
          filtered={filtered}
          pastEnd={total === null}
          canCreate={canCreate}
          firstPageHref={quotationListHref({ ...params, page: 1 })}
        />
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
            <table className="min-w-full divide-y divide-zinc-200 text-sm dark:divide-zinc-800">
              <thead className="bg-zinc-50 text-left text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
                <tr>
                  <th scope="col" className="px-4 py-3 font-medium whitespace-nowrap">Quotation number</th>
                  <th scope="col" className="px-4 py-3 font-medium">Customer</th>
                  <th scope="col" className="px-4 py-3 font-medium whitespace-nowrap">Quotation date</th>
                  <th scope="col" className="px-4 py-3 font-medium whitespace-nowrap">Expiry date</th>
                  <th scope="col" className="px-4 py-3 text-right font-medium whitespace-nowrap">Grand total</th>
                  <th scope="col" className="px-4 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                {items.map((q) => (
                  <tr key={q.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-900">
                    <td className="px-4 py-3 font-mono font-medium whitespace-nowrap">
                      <Link href={`/quotations/${q.id}`} className="hover:underline">
                        {q.quotationNumber}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <span className="font-medium">{q.customerName}</span>
                      {q.customerCompanyName && (
                        <span className="block text-xs text-zinc-500">{q.customerCompanyName}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-zinc-600 dark:text-zinc-400">
                      {formatCalendarDate(q.quotationDate)}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-zinc-600 dark:text-zinc-400">
                      {q.expiryDate ? formatCalendarDate(q.expiryDate) : "—"}
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap tabular-nums">
                      {formatMoney(q.grandTotal, currency)}
                    </td>
                    <td className="px-4 py-3">
                      <QuotationStatusBadge status={q.status} />
                    </td>
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
            prevHref={page > 1 ? quotationListHref({ ...params, page: page - 1 }) : null}
            nextHref={
              total !== null && page * pageSize < total
                ? quotationListHref({ ...params, page: page + 1 })
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
        <p>There are no quotations on this page.</p>
        <Link href={firstPageHref} className={TEXT_LINK}>
          Go to the first page
        </Link>
      </>
    );
  } else if (filtered) {
    body = (
      <>
        <p>No quotations match your search.</p>
        <Link href="/quotations" className={TEXT_LINK}>
          Clear search and filters
        </Link>
      </>
    );
  } else {
    body = (
      <>
        <p>No quotations yet.</p>
        {canCreate && (
          <Link href="/quotations/new" className={PRIMARY_LINK}>
            Create your first quotation
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
