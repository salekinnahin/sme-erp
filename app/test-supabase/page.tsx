import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";

// Temporary diagnostic page — remove once real auth is in place.
export default function TestSupabasePage() {
  return (
    <main className="mx-auto w-full max-w-2xl p-8 font-sans">
      <h1 className="mb-6 text-2xl font-semibold">Supabase connection test</h1>
      <Suspense fallback={<p className="text-zinc-500">Checking…</p>}>
        <SupabaseStatus />
      </Suspense>
    </main>
  );
}

async function SupabaseStatus() {
  let initialized = false;
  let initError: string | null = null;
  let user: unknown = null;
  let authError: string | null = null;

  try {
    const supabase = await createClient();
    initialized = true;

    const { data, error } = await supabase.auth.getUser();
    user = data.user;
    authError = error?.message ?? null;
  } catch (err) {
    initError = err instanceof Error ? err.message : String(err);
  }

  // "Auth session missing!" is expected until an auth flow exists.
  const sessionMissing = authError === "Auth session missing!";

  return (
    <div className="space-y-4">
      <Row label="Client initialized">
        <span className={initialized ? "text-green-600" : "text-red-600"}>
          {initialized ? "yes" : "no"}
        </span>
      </Row>

      {initError && (
        <Row label="Initialization error">
          <span className="text-red-600">{initError}</span>
        </Row>
      )}

      <Row label="user">
        <pre className="overflow-x-auto rounded bg-zinc-100 p-3 text-sm dark:bg-zinc-900">
          {JSON.stringify(user, null, 2)}
        </pre>
      </Row>

      {authError && (
        <Row label="Auth error">
          <span className={sessionMissing ? "text-amber-600" : "text-red-600"}>
            {authError}
          </span>
          {sessionMissing && (
            <p className="mt-1 text-sm text-zinc-500">
              Expected — no one is signed in yet. This is not a connection
              failure.
            </p>
          )}
        </Row>
      )}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-sm font-medium text-zinc-500">{label}</div>
      <div className="mt-1">{children}</div>
    </div>
  );
}
