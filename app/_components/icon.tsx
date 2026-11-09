import type { NavIcon } from "@/lib/ui/navigation";

const PATHS: Record<NavIcon | "menu" | "close" | "arrow" | "empty" | "logout", string> = {
  overview: "M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z",
  customers: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M15 3a4 4 0 0 1 0 8 M22 21v-2a4 4 0 0 0-3-3.87 M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0",
  quotation: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6 M8 13h8 M8 17h5",
  order: "M9 5H5v16h14V5h-4 M9 3h6v4H9z M8 12h8 M8 16h6",
  invoice: "M5 3h14v19l-3-2-4 2-4-2-3 2z M9 7h6 M9 11h6 M9 15h3",
  vendors: "M3 21V8l9-5 9 5v13H3z M9 21v-8h6v8 M7 9h.01 M17 9h.01",
  purchase: "M3 3h2l3 12h11l3-8H6 M10 20h.01 M18 20h.01",
  receipt: "M3 9l9-5 9 5v11H3z M3 9h18 M8 14h8 M8 17h5",
  stock: "M4 20h16 M6 20V10h4v10 M14 20V4h4v16",
  products: "M12 3l9 5v9l-9 5-9-5V8z M3 8l9 5 9-5 M12 13v9 M7.5 5.5l9 5",
  settings: "M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1z M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0",
  menu: "M4 6h16 M4 12h16 M4 18h16",
  close: "M6 6l12 12 M6 18L18 6",
  arrow: "M5 12h14 M14 7l5 5-5 5",
  empty: "M4 7l3-4h10l3 4v14H4z M4 7h16 M9 11h6",
  logout: "M9 4H4v16h5 M10 12h11 M17 8l4 4-4 4",
};

export function Icon({ name, className = "" }: { name: keyof typeof PATHS; className?: string }) {
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className={`size-[18px] shrink-0 ${className}`}>
    <path d={PATHS[name]} />
  </svg>;
}
