import Link from "next/link";
import { SECONDARY_LINK } from "./styles";

/** Previous / Next links and a "Showing x–y of n" summary for list pages. */
export function ListPagination({
  page,
  pageSize,
  shown,
  total,
  prevHref,
  nextHref,
}: {
  page: number;
  pageSize: number;
  shown: number;
  total: number;
  prevHref: string | null;
  nextHref: string | null;
}) {
  const from = (page - 1) * pageSize + 1;
  const to = from + shown - 1;
  return (
    <nav
      aria-label="Pagination"
      className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4 text-xs text-muted"
    >
      <p>
        Showing {from}–{to} of {total}
      </p>
      <div className="flex gap-2">
        {prevHref ? (
          <Link href={prevHref} className={SECONDARY_LINK}>
            Previous
          </Link>
        ) : (
          <span aria-disabled="true" className={`${SECONDARY_LINK} pointer-events-none opacity-50`}>
            Previous
          </span>
        )}
        {nextHref ? (
          <Link href={nextHref} className={SECONDARY_LINK}>
            Next
          </Link>
        ) : (
          <span aria-disabled="true" className={`${SECONDARY_LINK} pointer-events-none opacity-50`}>
            Next
          </span>
        )}
      </div>
    </nav>
  );
}
