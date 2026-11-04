/** Formats an ISO timestamp as a date in the organization's time zone. */
export function formatDate(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeZone,
  }).format(new Date(iso));
}

/** Formats an ISO timestamp as date and time in the organization's time zone. */
export function formatDateTime(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone,
  }).format(new Date(iso));
}
