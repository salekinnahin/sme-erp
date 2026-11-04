import Link from "next/link";
import { signOut } from "@/app/auth/actions";
import { SubmitButton } from "@/app/auth/_components/ui";

const NAV_LINKS = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/customers", label: "Customers" },
  { href: "/vendors", label: "Vendors" },
] as const;

/** Minimal header with navigation for signed-in pages. */
export function AppHeader() {
  return (
    <header className="flex flex-wrap items-center justify-between gap-4 border-b border-zinc-200 pb-4 dark:border-zinc-800">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <Link href="/dashboard" className="text-xl font-semibold">
          SME ERP
        </Link>
        <nav aria-label="Main" className="flex gap-4 text-sm">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50"
            >
              {link.label}
            </Link>
          ))}
        </nav>
      </div>
      <form action={signOut} className="w-auto">
        <SubmitButton pendingText="Signing out…">Log out</SubmitButton>
      </form>
    </header>
  );
}
