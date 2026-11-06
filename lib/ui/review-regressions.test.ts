import { readFileSync } from "node:fs";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { LogoutButton } from "@/app/_components/logout-button";

const form = vi.hoisted(() => ({ pending: false }));
vi.mock("react-dom", async (original) => ({ ...await original<typeof import("react-dom")>(), useFormStatus: () => ({ pending: form.pending }) }));
const css = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8");

describe("review presentation safeguards", () => {
  it("keeps compact filter labels in normal flow above their controls", () => {
    const labels = css.match(/\.filter-toolbar label\s*\{([^}]+)\}/)![1];
    expect(labels).toContain("display: block");
    expect(labels).toContain("font-size: 11px");
    expect(labels).not.toMatch(/absolute|clip|overflow:\s*hidden|width:\s*1px/);
    expect(css).toContain(".filter-toolbar form { align-items: flex-end; }");
  });
  it("bounds sticky rails only on desktop and disables sticking on short screens", () => {
    const desktop = css.match(/@media \(min-width: 1280px\) \{([\s\S]*?)\n\}/)![1];
    expect(desktop.match(/max-height: calc\(100dvh - 105px\); overflow-y: auto/g)).toHaveLength(2);
    expect(css).toMatch(/@media \(min-width: 1280px\) and \(max-height: 799px\)[\s\S]*?position: static; max-height: none; overflow: visible/);
  });
  it.each([false, true])("logout pending=%s disables repeat submits and announces progress", (pending) => {
    form.pending = pending;
    const html = renderToStaticMarkup(h(LogoutButton));
    expect(html).toContain(`aria-busy="${pending}"`);
    expect(html).toContain(`aria-disabled="${pending}"`);
    expect(html).toContain(`aria-label="${pending ? "Logging out…" : "Log out"}"`);
    expect(html.includes('disabled=""')).toBe(pending);
    expect(html).toContain(pending ? 'role="status" class="sr-only">Logging out…' : 'role="status" class="sr-only"></span>');
    expect(html.includes("logout-spinner")).toBe(pending);
  });
});
