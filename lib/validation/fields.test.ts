import { describe, expect, it } from "vitest";
import {
  EMAIL_MAX_LENGTH,
  PHONE_MAX_LENGTH,
  isUuid,
  isValidEmail,
  isValidPhone,
  normalizeEmail,
  optionalText,
  tooLongMessage,
} from "./fields";

describe("optionalText", () => {
  it("trims with the shared whitespace set", () => {
    expect(optionalText("  Road 1  ")).toBe("Road 1");
  });

  it("turns empty and whitespace-only values into null", () => {
    expect(optionalText("")).toBeNull();
    expect(optionalText("   ")).toBeNull();
    expect(optionalText(" \u0085 ﻿")).toBeNull();
  });
});

describe("normalizeEmail", () => {
  it("trims and lowercases", () => {
    expect(normalizeEmail("  A@Example.COM \u0085")).toBe("a@example.com");
  });

  it("returns null for blank input", () => {
    expect(normalizeEmail(" ﻿ ")).toBeNull();
  });
});

describe("isValidEmail", () => {
  it("accepts simple addresses", () => {
    expect(isValidEmail("a@example.com")).toBe(true);
    expect(isValidEmail("first.last+tag@sub.example.co")).toBe(true);
  });

  it.each([
    ["no @", "not-an-email"],
    ["no dot in domain", "a@example"],
    ["two @", "a@b@example.com"],
    ["space", "a b@example.com"],
    ["tab", "a\tb@example.com"],
    ["U+00A0", "a b@example.com"],
    ["U+0085", "a\u0085b@example.com"],
    ["U+2003", "a@exa mple.com"],
    ["U+FEFF", "a@example.com﻿"],
  ])("rejects %s", (_, email) => {
    expect(isValidEmail(email)).toBe(false);
  });

  it("limits length to 320 code points", () => {
    const domain = "@example.com";
    const at = "a".repeat(EMAIL_MAX_LENGTH - domain.length) + domain;
    expect(isValidEmail(at)).toBe(true);
    expect(isValidEmail("a" + at)).toBe(false);
  });
});

describe("isValidPhone", () => {
  it.each(["+880 1711-000000", "(02) 9123.456", "017110000"])("accepts %s", (phone) => {
    expect(isValidPhone(phone)).toBe(true);
  });

  it.each([
    ["letters", "call me"],
    ["no digits", "+()-"],
    ["fewer than 6 digits", "12345"],
    ["plus not first", "1+23456"],
    ["inner NBSP", "+880 1711000000"],
    ["inner tab", "+880\t1711000000"],
  ])("rejects %s", (_, phone) => {
    expect(isValidPhone(phone)).toBe(false);
  });

  it("limits length to 50", () => {
    expect(isValidPhone("1".repeat(PHONE_MAX_LENGTH))).toBe(true);
    expect(isValidPhone("1".repeat(PHONE_MAX_LENGTH + 1))).toBe(false);
  });
});

describe("tooLongMessage", () => {
  it("names the limit", () => {
    expect(tooLongMessage(200)).toBe("Use at most 200 characters.");
  });
});

describe("isUuid", () => {
  it("accepts UUIDs and rejects anything else", () => {
    expect(isUuid("aaaaaaaa-0000-4000-8000-000000000001")).toBe(true);
    expect(isUuid("not-a-uuid")).toBe(false);
    expect(isUuid("aaaaaaaa-0000-4000-8000-000000000001 ")).toBe(false);
  });
});
