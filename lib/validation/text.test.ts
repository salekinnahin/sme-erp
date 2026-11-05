import { describe, expect, it } from "vitest";
import { charLength, hasWhitespace, trimText, truncateChars } from "./text";

// The shared whitespace set (docs/DECISIONS.md 014). Mirrors the SQL helpers
// in supabase/migrations/20261104030000_harden_customer_validation.sql.
const WHITESPACE = [
  "\t", "\n", "\u000b", "\f", "\r", " ",
  "\u0085", " ", " ",
  " ", " ", " ", " ", " ", " ",
  " ", " ", " ", " ", " ",
  " ", " ", " ", " ", "　", "﻿",
];

const hex = (c: string) => `U+${c.codePointAt(0)!.toString(16).padStart(4, "0").toUpperCase()}`;

describe("trimText", () => {
  it.each(WHITESPACE.map((c) => [hex(c), c]))("trims %s at both edges", (_, c) => {
    expect(trimText(`${c}${c}abc${c}`)).toBe("abc");
  });

  it("trims mixed whitespace including U+00A0, U+0085, U+2003, U+FEFF", () => {
    expect(trimText(" \u0085 \t\nName ﻿\r\n")).toBe("Name");
  });

  it("keeps inner whitespace", () => {
    expect(trimText("  a b c d  ")).toBe("a b c d");
  });

  it("turns whitespace-only values into an empty string", () => {
    expect(trimText("  ")).toBe("");
    expect(trimText("\u0085")).toBe("");
    expect(trimText("  ﻿")).toBe("");
  });

  it("differs from String.prototype.trim() on U+0085", () => {
    // JS trim() does not treat U+0085 as whitespace; the shared set does.
    expect("\u0085a\u0085".trim()).toBe("\u0085a\u0085");
    expect(trimText("\u0085a\u0085")).toBe("a");
  });

  it("does not treat zero-width characters as whitespace", () => {
    expect(trimText("​a​")).toBe("​a​");
    expect(trimText("‍a")).toBe("‍a");
  });
});

describe("hasWhitespace", () => {
  it.each(WHITESPACE.map((c) => [hex(c), c]))("detects %s anywhere", (_, c) => {
    expect(hasWhitespace(`a${c}b`)).toBe(true);
    expect(hasWhitespace(`${c}ab`)).toBe(true);
    expect(hasWhitespace(`ab${c}`)).toBe(true);
  });

  it("is false for text without whitespace", () => {
    expect(hasWhitespace("a@example.com")).toBe(false);
    expect(hasWhitespace("বাংলা")).toBe(false);
    expect(hasWhitespace("a​b")).toBe(false);
    expect(hasWhitespace("")).toBe(false);
  });
});

// Regression: U+2028 / U+2029 were once lost from the SQL helpers because a
// literal copy of them was stripped by an editor. Escapes only here, and the
// SQL suites check the same cases (migration
// 20261104100000_restore_whitespace_line_separators.sql).
describe("U+2028 LINE SEPARATOR and U+2029 PARAGRAPH SEPARATOR", () => {
  it("are trimmed at the start and end", () => {
    expect(trimText("\u2028Acme\u2029")).toBe("Acme");
    expect(trimText("\u2029Acme\u2028")).toBe("Acme");
  });

  it("make a value of only them empty", () => {
    expect(trimText("\u2028")).toBe("");
    expect(trimText("\u2029")).toBe("");
    expect(trimText("\u2028\u2029")).toBe("");
  });

  it("are kept inside a value and detected as whitespace", () => {
    expect(trimText("A\u2028B")).toBe("A\u2028B");
    expect(hasWhitespace("a\u2028b")).toBe(true);
    expect(hasWhitespace("a\u2029b")).toBe(true);
  });

  it("do not make U+200B (zero width space) whitespace", () => {
    expect(trimText("\u200bAcme\u200b")).toBe("\u200bAcme\u200b");
    expect(hasWhitespace("a\u200bb")).toBe(false);
  });
});

describe("charLength (Unicode code points)", () => {
  it("counts ASCII", () => {
    expect(charLength("")).toBe(0);
    expect(charLength("Acme Ltd")).toBe(8);
  });

  it("counts an emoji as one code point (String.length says 2)", () => {
    expect("😀".length).toBe(2);
    expect(charLength("😀")).toBe(1);
    expect(charLength("😀".repeat(200))).toBe(200);
  });

  it("counts each code point of a ZWJ emoji sequence", () => {
    // man + ZWJ + woman + ZWJ + girl
    expect(charLength("👨‍👩‍👧")).toBe(5);
  });

  it("counts Bengali text", () => {
    expect(charLength("বাংলা")).toBe(5);
    expect(charLength("ঢাকা ট্রেডার্স")).toBe(14);
  });

  it("counts combining characters separately (no normalization)", () => {
    expect(charLength("é")).toBe(2);
    expect(charLength("é")).toBe(1);
  });
});

describe("truncateChars", () => {
  it("never splits a surrogate pair", () => {
    expect(truncateChars("😀😀😀", 2)).toBe("😀😀");
    expect(truncateChars("ab", 5)).toBe("ab");
  });
});
