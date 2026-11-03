import type { Metadata } from "next";
import { Suspense } from "react";
import { requireTenant, type Role } from "@/lib/tenancy/context";
import { signOut } from "../auth/actions";
import { SubmitButton } from "../auth/_components/ui";

export const metadata: Metadata = { title: "Dashboard · SME ERP" };

const ROLE_LABELS: Record<Role, string> = {
  owner: "Owner",
  manager: "Manager",
  employee: "Employee",
};

export default function DashboardPage() {
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10 sm:px-8">
      <Suspense fallback={<p className="text-zinc-500">Loading…</p>}>
        <Dashboard />
      </Suspense>
    </main>
  );
}

async function Dashboard() {
  // Redirects to /auth/login (no user) or /onboarding/organization (no org).
  const { organization, role } = await requireTenant();

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">SME ERP</h1>
        <form action={signOut} className="w-auto">
          <SubmitButton pendingText="Signing out…">Log out</SubmitButton>
        </form>
      </header>
      <section className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-950">
        <p className="text-lg font-medium">Welcome to SME ERP</p>
        <dl className="mt-4 space-y-1 text-zinc-600 dark:text-zinc-400">
          <div>
            <dt className="inline font-medium">Organization: </dt>
            <dd className="inline">{organization.name}</dd>
          </div>
          <div>
            <dt className="inline font-medium">Role: </dt>
            <dd className="inline">{ROLE_LABELS[role]}</dd>
          </div>
        </dl>
      </section>
    </div>
  );
}
