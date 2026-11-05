/** Status shared by master-data records (customers, vendors, products, categories). */
type RecordStatus = "active" | "inactive";

export type BadgeTone = "green" | "zinc" | "blue" | "amber" | "red";

const TONES: Record<BadgeTone, string> = {
  green:
    "bg-green-50 text-green-700 ring-green-600/20 dark:bg-green-950 dark:text-green-300 dark:ring-green-400/30",
  zinc:
    "bg-zinc-100 text-zinc-600 ring-zinc-500/20 dark:bg-zinc-800 dark:text-zinc-300 dark:ring-zinc-400/30",
  blue:
    "bg-blue-50 text-blue-700 ring-blue-600/20 dark:bg-blue-950 dark:text-blue-300 dark:ring-blue-400/30",
  amber:
    "bg-amber-50 text-amber-800 ring-amber-600/20 dark:bg-amber-950 dark:text-amber-300 dark:ring-amber-400/30",
  red:
    "bg-red-50 text-red-700 ring-red-600/20 dark:bg-red-950 dark:text-red-300 dark:ring-red-400/30",
};

/** A small rounded status label. Modules map their statuses to a tone. */
export function Badge({ tone, children }: { tone: BadgeTone; children: React.ReactNode }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset ${TONES[tone]}`}
    >
      {children}
    </span>
  );
}

const RECORD_TONES: Record<RecordStatus, BadgeTone> = {
  active: "green",
  inactive: "zinc",
};

const LABELS: Record<RecordStatus, string> = {
  active: "Active",
  inactive: "Inactive",
};

export function StatusBadge({ status }: { status: RecordStatus }) {
  return <Badge tone={RECORD_TONES[status]}>{LABELS[status]}</Badge>;
}
