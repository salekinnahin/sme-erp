import { describe, expect, it } from "vitest";
import type { OptionSearchResult } from "./form";
import {
  initialSelectorState,
  resultsAreCurrent,
  selectableOption,
  selectorKey,
  selectorReducer,
  type SelectorAction,
  type SelectorState,
} from "./selector-state";

// Regression tests for the searchable selector's request race. The harness
// mirrors option-search.tsx: a generation counter advanced synchronously on
// every query change, the reducer as the only state, selectorKey() for keys
// and selectableOption() for clicks. The parent's selected value is modeled
// separately and changes only through `choose`.

type Opt = { id: string; name: string };
const A1 = { id: "a1", name: "Alpha one" };
const A2 = { id: "a2", name: "Alpha two" };
const B1 = { id: "b1", name: "Beta one" };
const ok = (options: Opt[], more = false): OptionSearchResult<Opt> => ({ ok: true, options, more });

function harness(initialSelected: string | null = null) {
  let state: SelectorState<Opt> = initialSelectorState<Opt>();
  let gen = 0;
  let selected = initialSelected;
  const dispatch = (a: SelectorAction<Opt>) => (state = selectorReducer(state, a));
  const choose = (o: Opt) => {
    selected = o.id;
    dispatch({ type: "close", generation: ++gen });
  };
  return {
    get state() {
      return state;
    },
    get selected() {
      return selected;
    },
    /** Focus: opens with an empty query; returns the request's generation. */
    open() {
      const g = ++gen;
      dispatch({ type: "open", generation: g });
      return g;
    },
    /** A keystroke: new generation at once (the request starts after the debounce). */
    type(query: string) {
      const g = ++gen;
      dispatch({ type: "query", generation: g, query });
      return g;
    },
    respond(generation: number, result: OptionSearchResult<Opt>) {
      dispatch({ type: "response", generation, result });
    },
    key(key: string) {
      const outcome = selectorKey(state, key);
      if (outcome.open) this.open();
      else if (outcome.close) dispatch({ type: "close", generation: ++gen });
      else if (outcome.choose !== undefined) choose(outcome.choose);
      else if (outcome.action) dispatch(outcome.action);
      return outcome;
    },
    /** A mouse click on the rendered option at `index`. */
    click(index: number) {
      const option = selectableOption(state, index);
      if (option !== undefined) choose(option);
      return option;
    },
    hover(index: number) {
      dispatch({ type: "highlight", index });
    },
  };
}

describe("selector request race", () => {
  it("never shows or selects results of a query the user has already changed", () => {
    const h = harness();
    h.open();
    // 1. Query A: its request is in flight.
    const genA = h.type("Al");
    // 2. The user types B before B's debounced request has even started.
    h.type("Be");
    expect(h.state.status).toBe("loading");
    expect(h.state.active).toBe(-1);

    // 3. A's response arrives late.
    h.respond(genA, ok([A1, A2]));
    // 4. Not displayed as current results, not selectable.
    expect(h.state.results).toEqual([]);
    expect(resultsAreCurrent(h.state)).toBe(false);
    expect(h.state.status).toBe("loading");

    // 5. ArrowDown + Enter select nothing (and Enter still blocks submit).
    h.key("ArrowDown");
    expect(h.state.active).toBe(-1);
    const enter = h.key("Enter");
    expect(enter.preventDefault).toBe(true);
    expect(enter.choose).toBeUndefined();
    expect(h.click(0)).toBeUndefined();
    expect(h.selected).toBeNull();
    expect(h.state.open).toBe(true);
  });

  it("lets the current query's results be chosen normally once they arrive", () => {
    const h = harness();
    h.open();
    const genA = h.type("Al");
    const genB = h.type("Be");
    h.respond(genA, ok([A1, A2]));
    // 6. B's response arrives.
    h.respond(genB, ok([B1]));
    // 7. B is selectable.
    expect(h.state.results).toEqual([B1]);
    expect(resultsAreCurrent(h.state)).toBe(true);
    h.key("ArrowDown");
    expect(h.state.active).toBe(0);
    expect(h.key("Enter").choose).toEqual(B1);
    expect(h.selected).toBe("b1");
    expect(h.state.open).toBe(false);
  });

  it("resets the highlighted option and clears shown results as soon as the query changes", () => {
    const h = harness();
    const g = h.open();
    h.respond(g, ok([A1, A2]));
    h.key("ArrowDown");
    h.key("ArrowDown");
    expect(h.state.active).toBe(1);

    h.type("A"); // before any debounce or request
    expect(h.state.active).toBe(-1);
    expect(h.state.results).toEqual([]);
    expect(h.key("Enter").choose).toBeUndefined();
  });

  it("blocks mouse selection and hover of stale results", () => {
    const h = harness();
    const g = h.open();
    h.respond(g, ok([A1, A2]));
    // The list is still rendered with A's rows when the keystroke happens;
    // a click on a row index that A used must not choose anything.
    h.type("Be");
    h.hover(0);
    expect(h.state.active).toBe(-1);
    expect(h.click(0)).toBeUndefined();
    expect(h.click(1)).toBeUndefined();
    expect(h.selected).toBeNull();
  });

  it("keeps the existing selection when the query changes, results go stale or fail", () => {
    const h = harness("current-customer");
    const g0 = h.open();
    const gA = h.type("x");
    h.type("xy");
    h.respond(g0, ok([A1]));
    h.respond(gA, { ok: false });
    h.key("Escape");
    expect(h.state.open).toBe(false);
    expect(h.selected).toBe("current-customer");
  });

  it("ignores a stale failed request: it does not replace newer results", () => {
    const h = harness();
    h.open();
    const genA = h.type("Al");
    const genB = h.type("Be");
    h.respond(genB, ok([B1]));
    h.respond(genA, { ok: false });
    expect(h.state.status).toBe("done");
    expect(h.state.results).toEqual([B1]);
    expect(selectableOption(h.state, 0)).toEqual(B1);
  });

  it("ignores a stale failed request while the newer one is still loading", () => {
    const h = harness();
    h.open();
    const genA = h.type("Al");
    h.type("Be");
    h.respond(genA, { ok: false });
    expect(h.state.status).toBe("loading");
  });

  it("stays safe with out-of-order responses (newest wins, older ones dropped)", () => {
    const h = harness();
    const g0 = h.open();
    const g1 = h.type("A");
    const g2 = h.type("Al");
    const g3 = h.type("Alp");
    h.respond(g3, ok([A1]));
    h.respond(g1, ok([A2, B1]));
    h.respond(g0, ok([B1]));
    h.respond(g2, { ok: false });
    expect(h.state.results).toEqual([A1]);
    expect(h.state.query).toBe("Alp");
    expect(h.state.status).toBe("done");
    h.key("ArrowDown");
    h.key("ArrowDown"); // clamped to the last current result
    expect(h.key("Enter").choose).toEqual(A1);
  });

  it("drops a response that arrives after the list was closed", () => {
    const h = harness();
    const g = h.open();
    h.key("Escape");
    h.respond(g, ok([A1]));
    expect(h.state.open).toBe(false);
    expect(h.state.results).toEqual([]);
    expect(selectableOption(h.state, 0)).toBeUndefined();
  });

  it("drops a response from before a close and reopen", () => {
    const h = harness();
    const gOld = h.type("Al");
    h.key("Escape");
    h.open();
    h.respond(gOld, ok([A1]));
    expect(h.state.results).toEqual([]);
    expect(h.state.status).toBe("loading");
  });
});

describe("selector states (unchanged behavior)", () => {
  it("shows loading, then results with a 'more' flag, then the empty state", () => {
    const h = harness();
    const g = h.open();
    expect(h.state).toMatchObject({ open: true, query: "", status: "loading" });
    h.respond(g, ok([A1], true));
    expect(h.state).toMatchObject({ status: "done", more: true, results: [A1] });
    const g2 = h.type("zzz");
    h.respond(g2, ok([]));
    expect(h.state).toMatchObject({ status: "done", results: [], more: false });
    expect(h.key("Enter").choose).toBeUndefined();
  });

  it("shows the error state for the current query's failure", () => {
    const h = harness();
    const g = h.open();
    h.respond(g, { ok: false });
    expect(h.state).toMatchObject({ status: "error", results: [] });
  });

  it("ArrowDown opens a closed list; Escape closes it; other keys pass through", () => {
    const h = harness();
    expect(h.key("ArrowDown")).toMatchObject({ preventDefault: true, open: true });
    expect(h.state.open).toBe(true);
    expect(h.key("a").preventDefault).toBe(false);
    expect(h.key("Escape")).toMatchObject({ preventDefault: true, close: true });
    expect(h.state.open).toBe(false);
    expect(h.key("Escape").preventDefault).toBe(false);
  });

  it("Enter never submits the form, open or closed", () => {
    const h = harness();
    expect(h.key("Enter").preventDefault).toBe(true);
    h.open();
    expect(h.key("Enter").preventDefault).toBe(true);
  });

  it("ArrowUp stops at the first result; hover highlights a current result", () => {
    const h = harness();
    const g = h.open();
    h.respond(g, ok([A1, A2]));
    h.hover(1);
    expect(h.state.active).toBe(1);
    h.key("ArrowUp");
    h.key("ArrowUp");
    expect(h.state.active).toBe(0);
    expect(h.click(1)).toEqual(A2);
    expect(h.selected).toBe("a2");
  });

  it("opening an already open list does not restart it", () => {
    const state = selectorReducer(initialSelectorState<Opt>(), { type: "open", generation: 1 });
    expect(selectorReducer(state, { type: "open", generation: 2 })).toBe(state);
  });
});
