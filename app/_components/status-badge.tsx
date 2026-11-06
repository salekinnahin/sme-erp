import { RECORD_TONES, type BadgeTone } from "@/lib/ui/status";
export type { BadgeTone } from "@/lib/ui/status";

export function Badge({ tone, children }: { tone: BadgeTone; children: React.ReactNode }) {
  return <span className={`status-badge status-${tone}`}>{children}</span>;
}
export function StatusBadge({ status }: { status: "active" | "inactive" }) {
  return <Badge tone={RECORD_TONES[status]}>{status === "active" ? "Active" : "Inactive"}</Badge>;
}
