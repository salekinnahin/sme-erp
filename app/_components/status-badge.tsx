/** Status shared by master-data records (customers, vendors). */
type RecordStatus = "active" | "inactive";

const STYLES: Record<RecordStatus, string> = {
  active:
    "bg-green-50 text-green-700 ring-green-600/20 dark:bg-green-950 dark:text-green-300 dark:ring-green-400/30",
  inactive:
    "bg-zinc-100 text-zinc-600 ring-zinc-500/20 dark:bg-zinc-800 dark:text-zinc-300 dark:ring-zinc-400/30",
};

const LABELS: Record<RecordStatus, string> = {
  active: "Active",
  inactive: "Inactive",
};

export function StatusBadge({ status }: { status: RecordStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${STYLES[status]}`}
    >
      {LABELS[status]}
    </span>
  );
}
