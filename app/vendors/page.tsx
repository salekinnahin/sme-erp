import type { Metadata } from "next";
import Form from "next/form";
import Link from "next/link";
import { Suspense } from "react";
import { requireTenant } from "@/lib/tenancy/context";
import { listVendors } from "@/lib/vendors/vendors";
import { canVendor } from "@/lib/vendors/permissions";
import {
  VENDOR_SEARCH_MAX_LENGTH,
  parseVendorListParams,
  type VendorListParams,
  type VendorStatusFilter,
} from "@/lib/vendors/validation";
import { formatDate } from "@/lib/format";
import { ListPagination } from "@/app/_components/list-pagination";
import { StatusBadge } from "@/app/_components/status-badge";
import { PRIMARY_LINK, SECONDARY_LINK, TEXT_LINK } from "@/app/_components/styles";

export const metadata: Metadata = { title: "Vendors · SME ERP" };

const STATUS_OPTIONS: { value: VendorStatusFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
];

const INPUT =
  "block w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-zinc-900 shadow-sm outline-none focus:border-zinc-900 focus:ring-1 focus:ring-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:focus:border-zinc-300 dark:focus:ring-zinc-300";

export default function VendorsPage({ searchParams }: PageProps<"/vendors">) {
  return (
    <Suspense fallback={<p className="text-sm text-zinc-500">Loading vendors…</p>}>
      <VendorList searchParams={searchParams} />
    </Suspense>
  );
}

function listHref(params: VendorListParams): string {
  const query = new URLSearchParams();
  if (params.search) query.set("q", params.search);
  if (params.status !== "all") query.set("status", params.status);
  if (params.page > 1) query.set("page", String(params.page));
  const qs = query.toString();
  return qs ? `/vendors?${qs}` : "/vendors";
}

async function VendorList({
  searchParams,
}: Pick<PageProps<"/vendors">, "searchParams">) {
  const params = parseVendorListParams(await searchParams);
  const tenant = await requireTenant();
  const { items, total, page, pageSize } = await listVendors(tenant, params);

  const canCreate = canVendor(tenant.role, "create");
  const filtered = params.search !== "" || params.status !== "all";
  const tz = tenant.organization.timezone;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">Vendors</h1>
        {canCreate && (
          <Link href="/vendors/new" className={PRIMARY_LINK}>
            Add vendor
          </Link>
        )}
      </div>

      {/* GET form: search and filter run on the server via the URL. */}
      <Form
        action="/vendors"
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
            maxLength={VENDOR_SEARCH_MAX_LENGTH}
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
                  <th scope="col" className="px-4 py-3 font-medium">Vendor name</th>
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
                      <Link href={`/vendors/${c.id}`} className="hover:underline">
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
        <p>There are no vendors on this page.</p>
        <Link href={firstPageHref} className={TEXT_LINK}>
          Go to the first page
        </Link>
      </>
    );
  } else if (filtered) {
    body = (
      <>
        <p>No vendors match your search.</p>
        <Link href="/vendors" className={TEXT_LINK}>
          Clear search and filters
        </Link>
      </>
    );
  } else {
    body = (
      <>
        <p>No vendors yet.</p>
        {canCreate && (
          <Link href="/vendors/new" className={PRIMARY_LINK}>
            Add your first vendor
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
