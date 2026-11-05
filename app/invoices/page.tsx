import type { Metadata } from "next";
import Form from "next/form";
import Link from "next/link";
import { Suspense } from "react";
import { requireTenant } from "@/lib/tenancy/context";
import { listInvoices } from "@/lib/invoices/invoices";
import { listCustomerOptions } from "@/lib/quotations/options";
import { customerOptionLabel } from "@/lib/quotations/form";
import { canInvoice } from "@/lib/invoices/permissions";
import {
  INVOICE_SEARCH_MAX_LENGTH,
  parseInvoiceListParams,
  invoiceListHref,
  sourceSalesOrderHref,
} from "@/lib/invoices/list-params";
import { INVOICE_STATUSES, INVOICE_STATUS_LABELS } from "@/lib/invoices/validation";
import { formatCalendarDate, formatMoney } from "@/lib/format";
import { ListPagination } from "@/app/_components/list-pagination";
import { PRIMARY_LINK, SECONDARY_LINK, TEXT_LINK } from "@/app/_components/styles";
import { InvoiceStatusBadge } from "./_components/invoice-status-badge";

export const metadata: Metadata = { title: "Invoices · SME ERP" };

const INPUT =
  "block w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-zinc-900 shadow-sm outline-none focus:border-zinc-900 focus:ring-1 focus:ring-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:focus:border-zinc-300 dark:focus:ring-zinc-300";
const LABEL = "block text-sm font-medium text-zinc-700 dark:text-zinc-300";

export default function InvoicesPage({ searchParams }: PageProps<"/invoices">) {
  return (
    <Suspense fallback={<p className="text-sm text-zinc-500">Loading invoices…</p>}>
      <InvoiceList searchParams={searchParams} />
    </Suspense>
  );
}

async function InvoiceList({ searchParams }: Pick<PageProps<"/invoices">, "searchParams">) {
  const params = parseInvoiceListParams(await searchParams);
  const tenant = await requireTenant();
  const [{ items, total, page, pageSize }, customers] = await Promise.all([
    listInvoices(tenant, params),
    // Same customer filter as the quotation list: all customers (also
    // inactive, since old orders reference them), plus the filtered one even
    // if it is beyond the cap.
    listCustomerOptions(tenant, {
      includeInactive: true,
      currentId: params.customer === "all" ? null : params.customer,
    }),
  ]);

  const canCreate = canInvoice(tenant.role, "create");
  const filtered = params.search !== "" || params.status !== "all" || params.customer !== "all";
  const currency = tenant.organization.currency;
  const customerKnown = customers.options.some((c) => c.id === params.customer);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">Invoices</h1>
        {canCreate && (
          <Link href="/invoices/new" className={PRIMARY_LINK}>
            New invoice
          </Link>
        )}
      </div>

      {/* GET form: search and filters run on the server via the URL. */}
      <Form
        action="/invoices"
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
            maxLength={INVOICE_SEARCH_MAX_LENGTH}
            placeholder="Invoice number or customer name"
            className={`mt-1 ${INPUT}`}
          />
        </div>
        <div>
          <label htmlFor="status" className={LABEL}>
            Status
          </label>
          <select id="status" name="status" defaultValue={params.status} className={`mt-1 ${INPUT}`}>
            <option value="all">All statuses</option>
            {INVOICE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {INVOICE_STATUS_LABELS[s]}
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
          firstPageHref={invoiceListHref({ ...params, page: 1 })}
        />
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
            <table className="min-w-full divide-y divide-zinc-200 text-sm dark:divide-zinc-800">
              <thead className="bg-zinc-50 text-left text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
                <tr>
                  <th scope="col" className="px-4 py-3 font-medium whitespace-nowrap">Invoice number</th>
                  <th scope="col" className="px-4 py-3 font-medium">Customer</th>
                  <th scope="col" className="px-4 py-3 font-medium whitespace-nowrap">Invoice date</th>
                  <th scope="col" className="px-4 py-3 font-medium whitespace-nowrap">Due date</th>
                  <th scope="col" className="px-4 py-3 text-right font-medium whitespace-nowrap">Grand total</th>
                  <th scope="col" className="px-4 py-3 text-right font-medium whitespace-nowrap">Amount paid</th>
                  <th scope="col" className="px-4 py-3 text-right font-medium whitespace-nowrap">Amount due</th>
                  <th scope="col" className="px-4 py-3 font-medium">Status</th>
                  <th scope="col" className="px-4 py-3 font-medium">Source</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                {items.map((so) => {
                  const sourceHref = sourceSalesOrderHref(so.sourceSalesOrderId, so.sourceSalesOrderNumber);
                  return (
                    <tr key={so.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-900">
                      <td className="px-4 py-3 font-mono font-medium whitespace-nowrap">
                        <Link href={`/invoices/${so.id}`} className="hover:underline">
                          {so.invoiceNumber}
                        </Link>
                      </td>
                      <td className="px-4 py-3">
                        <span className="font-medium">{so.customerName}</span>
                        {so.customerCompanyName && (
                          <span className="block text-xs text-zinc-500">{so.customerCompanyName}</span>
                        )}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-zinc-600 dark:text-zinc-400">
                        {formatCalendarDate(so.invoiceDate)}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-zinc-600 dark:text-zinc-400">
                        {so.dueDate ? formatCalendarDate(so.dueDate) : "—"}
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap tabular-nums">
                        {formatMoney(so.grandTotal, currency)}
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap tabular-nums">{formatMoney(so.amountPaid, currency)}</td>
                      <td className="px-4 py-3 text-right whitespace-nowrap tabular-nums">{formatMoney(so.amountDue, currency)}</td>
                      <td className="px-4 py-3">
                        <InvoiceStatusBadge status={so.status} />
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-zinc-600 dark:text-zinc-400">
                        {sourceHref ? (
                          <Link href={sourceHref} className="font-mono text-xs hover:underline">
                            {so.sourceSalesOrderNumber}
                          </Link>
                        ) : so.sourceSalesOrderNumber ? (
                          <span className="font-mono text-xs">{so.sourceSalesOrderNumber}</span>
                        ) : (
                          <span className="text-xs">Direct</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <ListPagination
            page={page}
            pageSize={pageSize}
            shown={items.length}
            total={total ?? 0}
            prevHref={page > 1 ? invoiceListHref({ ...params, page: page - 1 }) : null}
            nextHref={
              total !== null && page * pageSize < total
                ? invoiceListHref({ ...params, page: page + 1 })
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
        <p>There are no invoices on this page.</p>
        <Link href={firstPageHref} className={TEXT_LINK}>
          Go to the first page
        </Link>
      </>
    );
  } else if (filtered) {
    body = (
      <>
        <p>No invoices match your search.</p>
        <Link href="/invoices" className={TEXT_LINK}>
          Clear search and filters
        </Link>
      </>
    );
  } else {
    body = (
      <>
        <p>No invoices yet.</p>
        {canCreate && (
          <Link href="/invoices/new" className={PRIMARY_LINK}>
            Create your first invoice
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
