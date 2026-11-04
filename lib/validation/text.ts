/**
 * Text rules shared with the database (docs/DECISIONS.md 014). The SQL twins
 * are public.trim_whitespace(), public.text_is_trimmed() and
 * public.text_has_whitespace() in
 * supabase/migrations/20261104030000_harden_customer_validation.sql.
 * Keep the two in sync.
 *
 * Whitespace is one explicit set, not JavaScript's trim()/\s or
 * PostgreSQL's [[:space:]] (they disagree, e.g. on U+00A0 and U+0085):
 * the Unicode White_Space property plus U+FEFF.
 *
 * Length is counted in Unicode code points, like PostgreSQL char_length(),
 * not in UTF-16 code units like String.length.
 */

const WHITESPACE_CHARS =
  "\\t-\\r \\u0085\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff";

const EDGE_WHITESPACE_RE = new RegExp(
  `^[${WHITESPACE_CHARS}]+|[${WHITESPACE_CHARS}]+$`,
  "g",
);
const WHITESPACE_RE = new RegExp(`[${WHITESPACE_CHARS}]`);

/** Removes leading and trailing whitespace. */
export function trimText(value: string): string {
  return value.replace(EDGE_WHITESPACE_RE, "");
}

/** True if the value contains whitespace anywhere. */
export function hasWhitespace(value: string): boolean {
  return WHITESPACE_RE.test(value);
}

/** Number of Unicode code points (matches PostgreSQL char_length()). */
export function charLength(value: string): number {
  return Array.from(value).length;
}

/** The first `max` code points of the value. Never splits a surrogate pair. */
export function truncateChars(value: string, max: number): string {
  return Array.from(value).slice(0, max).join("");
}
