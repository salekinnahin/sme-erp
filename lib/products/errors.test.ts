import { afterEach, describe, expect, it, vi } from "vitest";
import { writeFailure } from "./errors";

afterEach(() => vi.restoreAllMocks());

describe("product write failure mapping", () => {
  it("maps the stock ledger type lock to a dedicated reason", () => {
    expect(writeFailure("updateProduct", { code: "ST002", message: "private details" })).toBe("type_locked");
    expect(writeFailure("updateProduct", { code: "ST003", message: "private details" })).toBe("type_locked_open_po");
  });

  it("keeps the existing mappings", () => {
    expect(writeFailure("x", { code: "23505" })).toBe("duplicate");
    expect(writeFailure("x", { code: "23503" })).toBe("invalid_category");
    expect(writeFailure("x", { code: "23514" })).toBe("invalid");
    expect(writeFailure("x", { code: "42501" })).toBe("forbidden");
    expect(writeFailure("x", { code: "P0002" })).toBe("not_found");
  });

  it("does not treat other stock errors as a type lock", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(writeFailure("x", { code: "ST001" })).toBe("failed");
    expect(writeFailure("x", { code: "ST004" })).toBe("failed");
    expect(writeFailure("x", { code: "ST005" })).toBe("failed");
    expect(writeFailure("x", { code: "55000" })).toBe("failed");
  });
});
