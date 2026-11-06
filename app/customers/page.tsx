import { PageHeader, FilterToolbar, DataTable, EmptyState as SharedEmptyState, PageSkeleton } from "@/app/_components/ui";
import type { Metadata } from "next";
import Form from "next/form";
import Link from "next/link";
import { Suspense } from "react";
import { requireTenant } from "@/lib/tenancy/context";
import { listCustomers } from "@/lib/customers/customers";
import { canCustomer } from "@/lib/customers/permissions";
import {
  CUSTOMER_SEARCH_MAX_LENGTH,
  parseCustomerListParams,
  type CustomerListParams,
  type CustomerStatusFilter,
} from "@/lib/customers/validation";
import { formatDate } from "@/lib/format";
import { ListPagination } from "@/app/_components/list-pagination";
import { StatusBadge } from "@/app/_components/status-badge";
import { PRIMARY_LINK, SECONDARY_LINK, TEXT_LINK } from "@/app/_components/styles";

export const metadata: Metadata = { title: "Customers · SME ERP" };

const STATUS_OPTIONS: { value: CustomerStatusFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
];

const INPUT = "ui-input";

export default function CustomersPage({ searchParams }: PageProps<"/customers">) {
  return (
    <Suspense fallback={<PageSkeleton label="Loading customers…" />}>
      <CustomerList searchParams={searchParams} />
    </Suspense>
  );
}

function listHref(params: CustomerListParams): string {
  const query = new URLSearchParams();
  if (params.search) query.set("q", params.search);
  if (params.status !== "all") query.set("status", params.status);
  if (params.page > 1) query.set("page", String(params.page));
  const qs = query.toString();
  return qs ? `/customers?${qs}` : "/customers";
}

async function CustomerList({
  searchParams,
}: Pick<PageProps<"/customers">, "searchParams">) {
  const params = parseCustomerListParams(await searchParams);
  const tenant = await requireTenant();
  const { items, total, page, pageSize } = await listCustomers(tenant, params);

  const canCreate = canCustomer(tenant.role, "create");
  const filtered = params.search !== "" || params.status !== "all";
  const tz = tenant.organization.timezone;

  return (
    <div className="space-y-6">
      <PageHeader title="Customers" description="Manage your customer relationships and contact details." actions={<>

        {canCreate && (
          <Link href="/customers/new" className={PRIMARY_LINK}>
            Add customer
          </Link>
        )}

      </>} />

      {/* GET form: search and filter run on the server via the URL. */}
      <FilterToolbar>
        <Form
          action="/customers"
          role="search"
          className="flex flex-col gap-3 sm:flex-row sm:items-end"
        >
          <div className="flex-1">
            <label htmlFor="q" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Search
            </label>
            <input
              id="q"
              name="q"
              type="search"
              defaultValue={params.search}
              maxLength={CUSTOMER_SEARCH_MAX_LENGTH}
              placeholder="Name, company, phone or email"
              className={`mt-1 ${INPUT}`}
            />
          </div>
          <div className="sm:w-40">
            <label htmlFor="status" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Status
            </label>
            <select
              id="status"
              name="status"
              defaultValue={params.status}
              className={`mt-1 ${INPUT}`}
            >
              {STATUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <button type="submit" className={SECONDARY_LINK + " py-2"}>
            Apply
          </button>
        </Form>
        {filtered && <Link href="/customers" className={TEXT_LINK + " mt-3 inline-block"}>Reset filters</Link>}
      </FilterToolbar>

      {items.length === 0 ? (
        <EmptyState
          filtered={filtered}
          pastEnd={total === null}
          canCreate={canCreate}
          firstPageHref={listHref({ ...params, page: 1 })}
        />
      ) : (
        <>
          <DataTable label="Customers">
            <table className="min-w-full divide-y divide-zinc-200 text-sm dark:divide-zinc-800">
              <thead className="bg-zinc-50 text-left text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
                <tr>
                  <th scope="col" className="px-4 py-3 font-medium">Customer name</th>
                  <th scope="col" className="px-4 py-3 font-medium">Company</th>
                  <th scope="col" className="px-4 py-3 font-medium">Phone</th>
                  <th scope="col" className="px-4 py-3 font-medium">Email</th>
                  <th scope="col" className="px-4 py-3 font-medium">Status</th>
                  <th scope="col" className="px-4 py-3 font-medium whitespace-nowrap">Created</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                {items.map((c) => (
                  <tr key={c.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-900">
                    <td className="px-4 py-3 font-medium">
                      <Link href={`/customers/${c.id}`} className="hover:underline">
                        {c.name}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400">{c.companyName ?? "—"}</td>
                    <td className="px-4 py-3 whitespace-nowrap text-zinc-600 dark:text-zinc-400">{c.phone ?? "—"}</td>
                    <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400">{c.email ?? "—"}</td>
                    <td className="px-4 py-3"><StatusBadge status={c.status} /></td>
                    <td className="px-4 py-3 whitespace-nowrap text-zinc-600 dark:text-zinc-400">
                      {formatDate(c.createdAt, tz)}
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
  if (pastEnd) {
    return <SharedEmptyState title="No customers on this page" description="Return to the first page to see the latest records.">
      <Link href={firstPageHref} className={TEXT_LINK}>Go to the first page</Link>
    </SharedEmptyState>;
  }
  if (filtered) {
    return <SharedEmptyState title="No customers match your search" description="Try another search or clear your filters.">
      <Link href="/customers" className={TEXT_LINK}>Clear search and filters</Link>
    </SharedEmptyState>;
  }
  return <SharedEmptyState title="No customers yet" description="Keep customer contact and company details together.">
    {canCreate && <Link href="/customers/new" className={PRIMARY_LINK}>Add customer</Link>}
  </SharedEmptyState>;
}
