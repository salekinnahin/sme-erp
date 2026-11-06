"use client";

import { useEffect, useId, useReducer, useRef } from "react";
import type { OptionSearchResult } from "@/lib/quotations/form";
import {
  initialSelectorState,
  selectableOption,
  selectorKey,
  selectorReducer,
  type SelectorAction,
  type SelectorState,
} from "@/lib/quotations/selector-state";

const SEARCH_DELAY_MS = 250;

/**
 * A small searchable select (ARIA combobox). Results come from a
 * server-side search; nothing is loaded until the field is opened, and
 * each search returns a bounded page.
 *
 * Closed, the input shows the selected option's label. The selection is
 * owned by the parent (`selected` / `selectedId`), so a search, an empty
 * result or a failed request never clears it; only choosing another option
 * changes it.
 *
 * Race rules live in lib/quotations/selector-state.ts: each query change
 * invalidates earlier requests and results immediately (not when the
 * debounced request starts), and only results of the current query can be
 * highlighted or chosen, by keyboard or mouse.
 */
export function OptionSearch<T extends { id: string }>({
  id,
  selectedId,
  selected,
  optionLabel,
  optionDetail,
  placeholder,
  unknownLabel,
  emptyText,
  search,
  onSelect,
  invalid,
  describedBy,
}: {
  id: string;
  selectedId: string;
  /** The selected option, if known. */
  selected: T | undefined;
  optionLabel: (option: T) => string;
  optionDetail?: (option: T) => string;
  placeholder: string;
  /** Shown when an ID is selected but its record could not be loaded. */
  unknownLabel: string;
  emptyText: string;
  search: (query: string) => Promise<OptionSearchResult<T>>;
  onSelect: (option: T) => void;
  invalid?: boolean;
  describedBy?: string;
}) {
  const listId = useId();
  const [state, dispatch] = useReducer(
    selectorReducer as (s: SelectorState<T>, a: SelectorAction<T>) => SelectorState<T>,
    undefined,
    initialSelectorState<T>,
  );
  const { open, query, results, more, status, active } = state;
  /** Source of new generations; advanced synchronously on every query change. */
  const generation = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // On unmount: cancel a pending search. In-flight responses are dropped by
  // the generation check (and React ignores dispatches after unmount).
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  async function runSearch(text: string, gen: number) {
    let result: OptionSearchResult<T>;
    try {
      result = await search(text);
    } catch {
      result = { ok: false };
    }
    // Applied only if `gen` is still the current generation.
    dispatch({ type: "response", generation: gen, result });
  }

  /** Starts a new query: invalidates everything older at once, then debounces. */
  function startQuery(text: string, delay: number, type: "open" | "query") {
    const gen = ++generation.current;
    dispatch(type === "open" ? { type, generation: gen } : { type, generation: gen, query: text });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void runSearch(text, gen), delay);
  }

  function openList() {
    if (open) return;
    startQuery("", 0, "open");
  }

  function close() {
    if (timer.current) clearTimeout(timer.current);
    dispatch({ type: "close", generation: ++generation.current });
  }

  function choose(option: T) {
    onSelect(option);
    close();
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    const outcome = selectorKey(state, e.key);
    // Enter always: the search field never submits the surrounding form.
    if (outcome.preventDefault) e.preventDefault();
    if (outcome.open) openList();
    else if (outcome.close) close();
    else if (outcome.choose !== undefined) choose(outcome.choose);
    else if (outcome.action) dispatch(outcome.action);
  }

  const selectedText = selected ? optionLabel(selected) : selectedId ? unknownLabel : "";
  const optionId = (index: number) => `${listId}-option-${index}`;

  return (
    <div className="relative">
      <input
        id={id}
        type="text"
        role="combobox"
        autoComplete="off"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open && active >= 0 ? optionId(active) : undefined}
        aria-invalid={invalid ? true : undefined}
        aria-describedby={describedBy}
        placeholder={open ? "Type to search" : placeholder}
        value={open ? query : selectedText}
        onFocus={openList}
        onClick={openList}
        onBlur={close}
        onChange={(e) => startQuery(e.target.value, SEARCH_DELAY_MS, "query")}
        onKeyDown={onKeyDown}
        className="ui-input mt-1"
      />
      {open && (
        <div
          // Keep focus in the input while clicking a result, so blur does
          // not close the list before the click lands.
          onMouseDown={(e) => e.preventDefault()}
          className="option-dropdown"
        >
          <ul id={listId} role="listbox" className="max-h-72 overflow-auto py-1">
            {results.map((option, index) => {
              const detail = optionDetail?.(option);
              return (
                <li
                  key={option.id}
                  id={optionId(index)}
                  role="option"
                  aria-selected={option.id === selectedId}
                  onClick={() => {
                    // Only a result of the current query can be chosen.
                    const current = selectableOption(state, index);
                    if (current !== undefined) choose(current);
                  }}
                  onMouseEnter={() => dispatch({ type: "highlight", index })}
                  data-highlighted={index === active}
                  className="cursor-pointer text-sm"
                >
                  <span className="block">{optionLabel(option)}</span>
                  {detail && <span className="block text-xs text-zinc-500">{detail}</span>}
                </li>
              );
            })}
          </ul>
          <p role="status" className="px-3 text-xs text-zinc-500 empty:hidden [&:not(:empty)]:py-2">
            {status === "loading"
              ? "Searching…"
              : status === "error"
                ? "Search failed. Try again."
                : status === "done" && results.length === 0
                  ? emptyText
                  : status === "done" && more
                    ? "More results match. Type more to narrow the search."
                    : ""}
          </p>
        </div>
      )}
    </div>
  );
}
