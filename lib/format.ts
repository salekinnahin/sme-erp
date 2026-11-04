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

function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/**
 * Formats a decimal string from the database (e.g. numeric(18,2) as text) as
 * an amount in the organization's base currency: "BDT 1,250.50". Works on
 * the string, so large values are never rounded through floating point.
 */
export function formatMoney(amount: string, currency: string): string {
  const [intPart, fracPart = ""] = amount.split(".");
  return `${currency} ${groupThousands(intPart)}.${fracPart.padEnd(2, "0").slice(0, 2)}`;
}

/** Formats a decimal string quantity without trailing zeros: "5.000" -> "5". */
export function formatQuantity(quantity: string): string {
  const [intPart, fracPart = ""] = quantity.split(".");
  const frac = fracPart.replace(/0+$/, "");
  return frac ? `${groupThousands(intPart)}.${frac}` : groupThousands(intPart);
}

/** A decimal string without trailing fractional zeros, for form inputs. */
export function plainDecimal(value: string): string {
  return value.includes(".") ? value.replace(/\.?0+$/, "") : value;
}
