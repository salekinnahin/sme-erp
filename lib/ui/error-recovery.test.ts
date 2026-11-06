import { createElement as h, isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import RootError from "@/app/error";
import { TenantLoadError } from "@/app/_components/tenant-load-error";

function findRetry(node: ReactNode): (() => void) | undefined {
  if (!isValidElement<{ children?: ReactNode; onClick?: () => void }>(node)) return;
  if (node.type === "button") return node.props.onClick;
  for (const child of Array.isArray(node.props.children) ? node.props.children : [node.props.children]) {
    const found = findRetry(child);
    if (found) return found;
  }
}

describe("root error recovery", () => {
  it("wires Next 16.4's server-data retry directly into the existing safe presentation", () => {
    const retry = vi.fn();
    const error = new Error("private database details");
    const boundary = RootError({ error, retry });
    expect(boundary.type).toBe(TenantLoadError);
    expect(boundary.props.retry).toBe(retry);
    const html = renderToStaticMarkup(h(RootError, { error, retry }));
    expect(html).toContain("Retry");
    expect(html).not.toContain(error.message);
  });
  it("invokes the supplied recovery callback from Retry", () => {
    const retry = vi.fn();
    // Static rendering supplies the hook dispatcher without mounting effects.
    function Probe() {
      const ui = TenantLoadError({ error: new Error("private"), retry });
      findRetry(ui)!();
      return ui;
    }
    renderToStaticMarkup(h(Probe));
    expect(retry).toHaveBeenCalledTimes(1);
  });
});
