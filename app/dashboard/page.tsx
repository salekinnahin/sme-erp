import type { Metadata } from "next";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "../auth/actions";
import { SubmitButton } from "../auth/_components/ui";

export const metadata: Metadata = { title: "Dashboard · SME ERP" };

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
  const supabase = await createClient();
  // getUser() validates the session with Supabase Auth — never trust
  // getSession() alone for authorization on the server.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/auth/login");

  const fullName =
    typeof user.user_metadata?.full_name === "string"
      ? user.user_metadata.full_name
      : null;

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">SME ERP</h1>
        <form action={signOut} className="w-auto">
          <SubmitButton pendingText="Signing out…">Log out</SubmitButton>
        </form>
      </header>
      <section className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-950">
        <p className="text-lg">Welcome, {fullName || user.email}</p>
        <p className="mt-2 text-zinc-500">Authentication is working.</p>
      </section>
    </div>
  );
}
