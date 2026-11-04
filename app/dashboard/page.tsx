import type { Metadata } from "next";
import { Suspense } from "react";
import { requireTenant, type Role } from "@/lib/tenancy/context";
import { AppHeader } from "../_components/app-header";

export const metadata: Metadata = { title: "Dashboard · SME ERP" };

const ROLE_LABELS: Record<Role, string> = {
  owner: "Owner",
  manager: "Manager",
  employee: "Employee",
};

export default function DashboardPage() {
  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-8">
      <AppHeader />
      <div className="mt-8">
        <Suspense fallback={<p className="text-zinc-500">Loading…</p>}>
          <Dashboard />
        </Suspense>
      </div>
    </main>
  );
}

async function Dashboard() {
  // Redirects to /auth/login (no user) or /onboarding/organization (no org).
  const { organization, role } = await requireTenant();

  return (
    <div className="space-y-6">
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
