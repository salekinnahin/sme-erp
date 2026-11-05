import type { OptionSearchResult } from "./form";

/**
 * State machine of the shared searchable selector (quotation and sales order forms)
 * (app/_components/option-search.tsx). Pure and client-safe, so
 * the race rules are unit-tested without a browser.
 *
 * Every query (opening the list, each keystroke, closing) gets a new,
 * higher generation, at once, before the debounced request starts. A
 * response is applied only if it carries the current generation; anything
 * older (slow, out of order, failed) is dropped. Results are kept with the
 * generation that produced them, and an option can be highlighted or
 * chosen only while that generation is still the current one.
 *
 * The selected value is not part of this state: the parent owns it, and
 * nothing here can clear it. Only choosing an option changes it.
 */

export type SelectorStatus = "idle" | "loading" | "done" | "error";

export type SelectorState<T> = {
  open: boolean;
  query: string;
  /** Generation of the current query. */
  generation: number;
  results: T[];
  /** Generation that produced `results` (-1: none). */
  resultsGeneration: number;
  more: boolean;
  status: SelectorStatus;
  /** Highlighted result, -1 for none. */
  active: number;
};

export type SelectorAction<T> =
  | { type: "open"; generation: number }
  | { type: "query"; generation: number; query: string }
  | { type: "close"; generation: number }
  | { type: "response"; generation: number; result: OptionSearchResult<T> }
  | { type: "move"; delta: 1 | -1 }
  | { type: "highlight"; index: number };

export function initialSelectorState<T>(): SelectorState<T> {
  return {
    open: false,
    query: "",
    generation: 0,
    results: [],
    resultsGeneration: -1,
    more: false,
    status: "idle",
    active: -1,
  };
}

/** A new query: everything shown so far is invalid at once. */
function restart<T>(state: SelectorState<T>, generation: number, query: string): SelectorState<T> {
  return {
    ...state,
    open: true,
    query,
    generation,
    results: [],
    resultsGeneration: -1,
    more: false,
    status: "loading",
    active: -1,
  };
}

/** True if the shown results belong to the current query. */
export function resultsAreCurrent<T>(state: SelectorState<T>): boolean {
  return state.open && state.status === "done" && state.resultsGeneration === state.generation;
}

/** The option at `index` if it may be chosen now, else undefined. */
export function selectableOption<T>(state: SelectorState<T>, index: number): T | undefined {
  if (!resultsAreCurrent(state) || index < 0) return undefined;
  return state.results[index];
}

export function selectorReducer<T>(state: SelectorState<T>, action: SelectorAction<T>): SelectorState<T> {
  switch (action.type) {
    case "open":
      if (state.open) return state;
      return restart(state, action.generation, "");
    case "query":
      return restart(state, action.generation, action.query);
    case "close":
      return { ...initialSelectorState<T>(), generation: action.generation };
    case "response": {
      // Stale: an older query, or the list was closed meanwhile.
      if (!state.open || action.generation !== state.generation) return state;
      const { result } = action;
      return {
        ...state,
        results: result.ok ? result.options : [],
        resultsGeneration: action.generation,
        more: result.ok ? result.more : false,
        status: result.ok ? "done" : "error",
        active: -1,
      };
    }
    case "move": {
      if (!resultsAreCurrent(state) || state.results.length === 0) return state;
      const last = state.results.length - 1;
      const active =
        action.delta > 0 ? Math.min(state.active + 1, last) : Math.max(state.active - 1, 0);
      return active === state.active ? state : { ...state, active };
    }
    case "highlight":
      if (!selectableOption(state, action.index)) return state;
      return action.index === state.active ? state : { ...state, active: action.index };
  }
}

export type SelectorKeyOutcome<T> = {
  /** Always true for Enter, so the search field never submits the form. */
  preventDefault: boolean;
  /** Open the list (ArrowDown while closed). */
  open?: true;
  close?: true;
  action?: SelectorAction<T>;
  /** The option to choose; only ever a result of the current query. */
  choose?: T;
};

/** What a key press in the search field does. */
export function selectorKey<T>(state: SelectorState<T>, key: string): SelectorKeyOutcome<T> {
  switch (key) {
    case "ArrowDown":
      return state.open
        ? { preventDefault: true, action: { type: "move", delta: 1 } }
        : { preventDefault: true, open: true };
    case "ArrowUp":
      return { preventDefault: true, action: { type: "move", delta: -1 } };
    case "Enter": {
      const choose = selectableOption(state, state.active);
      return choose === undefined ? { preventDefault: true } : { preventDefault: true, choose };
    }
    case "Escape":
      return state.open ? { preventDefault: true, close: true } : { preventDefault: false };
    default:
      return { preventDefault: false };
  }
}
