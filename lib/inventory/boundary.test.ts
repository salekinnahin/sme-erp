import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}) }));

import * as movements from "./movements";
import * as stock from "./stock";
import { canViewInventory } from "./permissions";

const dir = __dirname;
const sources = readdirSync(dir)
  .filter((file) => file.endsWith(".ts") && !file.endsWith(".test.ts"))
  .map((file) => ({ file, text: readFileSync(join(dir, file), "utf8") }));

describe("inventory domain boundary", () => {
  it("exposes read functions only (no arbitrary stock mutation API)", () => {
    const exported = [...Object.keys(stock), ...Object.keys(movements)];
    expect(exported.filter((name) => /create|insert|update|delete|adjust|record|post|add|remove|set/i.test(name))).toEqual([]);
    expect(exported).toEqual(expect.arrayContaining(["listCurrentStock", "getProductStock", "listStockMovements"]));
  });

  it("never writes tables or calls anything but the two read RPCs", () => {
    for (const { file, text } of sources) {
      expect(text, file).not.toMatch(/\.(insert|update|upsert|delete)\(/);
      expect(text, file).not.toMatch(/\.from\(/);
      for (const [, name] of text.matchAll(/\.rpc\("([^"]+)"/g)) {
        expect(["list_current_stock", "list_stock_movements"], file).toContain(name);
      }
    }
  });

  it("never converts quantities to JavaScript numbers", () => {
    for (const { file, text } of sources) {
      expect(text, file).not.toMatch(/(parseFloat|Number\((row\.)?(current_quantity|quantity|quantity_delta)|\+row\.)/);
    }
  });

  it("lets every active role read and no other role", () => {
    for (const role of ["owner", "manager", "employee"]) expect(canViewInventory(role)).toBe(true);
    for (const role of ["", "guest", "admin", null, undefined]) expect(canViewInventory(role)).toBe(false);
  });
});
