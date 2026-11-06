import { isValidElement, type ReactElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppFrame } from "@/app/_components/app-frame";
import { AppTopbar } from "@/app/_components/app-topbar";
import { AppSidebar } from "@/app/_components/app-sidebar";

type Effect = { deps?: readonly unknown[]; setup: () => void | (() => void); cleanup?: () => void; pending: boolean };
// A small hook driver for this component's event/effect lifecycle in Node.
// Native focus containment and CSS viewport behavior still need browser checks.
const hooks = vi.hoisted(() => ({
  refs: [] as { current: unknown }[], states: [] as unknown[], effects: [] as Effect[],
  refIndex: 0, stateIndex: 0, effectIndex: 0, pathname: "/invoices",
}));
vi.mock("next/navigation", () => ({ usePathname: () => hooks.pathname }));
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useRef: (value: unknown) => hooks.refs[hooks.refIndex++] ?? (hooks.refs[hooks.refIndex - 1] = { current: value }),
  useState: (initial: unknown) => {
    const i = hooks.stateIndex++;
    if (!(i in hooks.states)) hooks.states[i] = initial;
    return [hooks.states[i], (value: unknown) => { hooks.states[i] = value; }];
  },
  useEffect: (setup: Effect["setup"], deps?: readonly unknown[]) => {
    const i = hooks.effectIndex++;
    const previous = hooks.effects[i];
    const changed = !previous || !deps || deps.some((dep, n) => !Object.is(dep, previous.deps?.[n]));
    hooks.effects[i] = { ...previous, setup, deps, pending: changed || previous?.pending === true };
  },
}));

const identity = { organizationName: "Acme", logoUrl: null, email: "user@example.test", role: "owner" };
let tree: ReactNode;
let desktop: boolean;
let resized: (() => void) | undefined;
const focus = vi.fn();
const trigger = { isConnected: true, focus };
const body = { style: { overflow: "auto" } };
const root = { style: { overflow: "scroll" } };
const dialog = {
  open: false,
  showModal: vi.fn(() => { dialog.open = true; }),
  close: vi.fn(() => {
    if (!dialog.open) return;
    dialog.open = false;
    find<{ onClose: () => void }>(tree, "dialog")!.props.onClose();
  }),
};
function find<P>(node: ReactNode, type: unknown): ReactElement<P> | undefined {
  for (const child of Array.isArray(node) ? node : [node]) {
    if (!isValidElement<{ children?: ReactNode }>(child)) continue;
    if (child.type === type) return child as ReactElement<P>;
    const found = find<P>(child.props.children, type);
    if (found) return found;
  }
}
function renderFrame() {
  hooks.refIndex = hooks.stateIndex = hooks.effectIndex = 0;
  const previousStates = [...hooks.states];
  tree = AppFrame({ identity, signOutControl: null, children: "Content" });
  if (previousStates.length && previousStates.some((value, i) => !Object.is(value, hooks.states[i]))) {
    hooks.refIndex = hooks.stateIndex = hooks.effectIndex = 0;
    tree = AppFrame({ identity, signOutControl: null, children: "Content" });
  }
  hooks.refs[0].current = dialog;
  for (const effect of hooks.effects) {
    if (!effect.pending) continue;
    effect.cleanup?.();
    effect.cleanup = effect.setup() || undefined;
    effect.pending = false;
  }
}
function openMenu() {
  find<{ onOpenMenu: () => void }>(tree, AppTopbar)!.props.onOpenMenu();
  renderFrame();
}
function expanded() { return find<{ menuOpen: boolean }>(tree, AppTopbar)!.props.menuOpen; }
beforeEach(() => {
  vi.clearAllMocks();
  hooks.refs = []; hooks.states = []; hooks.effects = []; hooks.pathname = "/invoices";
  dialog.open = false; desktop = false; resized = undefined;
  body.style.overflow = "auto"; root.style.overflow = "scroll";
  vi.stubGlobal("document", { body, documentElement: root, activeElement: trigger });
  vi.stubGlobal("window", { matchMedia: () => ({
    get matches() { return desktop; },
    addEventListener: (_event: string, handler: () => void) => { resized = handler; },
    removeEventListener: () => { resized = undefined; },
  }) });
  renderFrame();
});
afterEach(() => {
  hooks.effects.forEach((effect) => effect.cleanup?.());
  vi.unstubAllGlobals();
});

describe("mobile navigation lifecycle", () => {
  it("locks page scroll while open and Escape restores overflow and trigger focus", () => {
    expect(expanded()).toBe(false);
    openMenu();
    expect(expanded()).toBe(true);
    expect(dialog.showModal).toHaveBeenCalledTimes(1);
    expect(body.style.overflow).toBe("hidden");
    expect(root.style.overflow).toBe("hidden");
    const preventDefault = vi.fn();
    find<{ onCancel: (event: { preventDefault: () => void }) => void }>(tree, "dialog")!.props.onCancel({ preventDefault });
    renderFrame();
    expect(preventDefault).toHaveBeenCalled();
    expect(expanded()).toBe(false);
    expect(body.style.overflow).toBe("auto");
    expect(root.style.overflow).toBe("scroll");
    expect(focus).toHaveBeenCalledTimes(1);
  });
  it("navigation and external route changes close and unlock the drawer", () => {
    openMenu();
    const drawer = find<{ children: ReactNode }>(tree, "dialog")!;
    find<{ onNavigate: () => void }>(drawer.props.children, AppSidebar)!.props.onNavigate();
    renderFrame();
    expect(expanded()).toBe(false);
    expect(body.style.overflow).toBe("auto");
    expect(focus).not.toHaveBeenCalled();
    openMenu();
    hooks.pathname = "/customers";
    renderFrame(); renderFrame();
    expect(expanded()).toBe(false);
    expect(dialog.open).toBe(false);
    expect(root.style.overflow).toBe("scroll");
  });
  it("resizing to desktop closes, unlocks and avoids focusing the hidden trigger", () => {
    openMenu();
    desktop = true;
    resized!(); renderFrame();
    expect(expanded()).toBe(false);
    expect(body.style.overflow).toBe("auto");
    expect(focus).not.toHaveBeenCalled();
    find<{ onOpenMenu: () => void }>(tree, AppTopbar)!.props.onOpenMenu();
    expect(dialog.showModal).toHaveBeenCalledTimes(1);
    desktop = false;
    openMenu();
    expect(expanded()).toBe(true);
  });
  it("unlocks when navigation removes the dialog for a shell-free print route", () => {
    openMenu();
    hooks.pathname = "/invoices/fixture/print";
    // A removed native dialog may never dispatch onClose to React.
    dialog.open = false;
    renderFrame();
    expect(find(tree, AppTopbar)).toBeUndefined();
    expect(body.style.overflow).toBe("auto");
    expect(root.style.overflow).toBe("scroll");
    hooks.pathname = "/invoices";
    renderFrame();
    expect(expanded()).toBe(false);
  });
  it("unmount cleanup restores the original scroll styles and removes the resize listener", () => {
    openMenu();
    hooks.effects.forEach((effect) => effect.cleanup?.());
    expect(body.style.overflow).toBe("auto");
    expect(root.style.overflow).toBe("scroll");
    expect(resized).toBeUndefined();
  });
});
