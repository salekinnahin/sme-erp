"use client";

import { useEffect } from "react";

/**
 * Fallback for errors while loading the user's organization (e.g. a
 * transient database failure in requireTenant()). It renders no tenant data
 * and does not redirect, so access stays fail-closed. Raw error details are
 * never shown; in production Next.js only forwards a digest anyway.
 */
export function TenantLoadError({
  error,
  retry,
}: {
  error: unknown;
  retry: () => void;
}) {
  useEffect(() => {
    // Digest only: it matches the server log entry without exposing details.
    const digest =
      error instanceof Error && "digest" in error ? error.digest : undefined;
    console.error("Failed to load organization", { digest });
  }, [error]);

  return (
    <main className="flex flex-1 items-center justify-center bg-zinc-50 px-4 py-12 dark:bg-black">
      <div
        role="alert"
        className="w-full max-w-sm rounded-xl border border-zinc-200 bg-white p-6 text-center shadow-sm sm:p-8 dark:border-zinc-800 dark:bg-zinc-950"
      >
        <p className="text-zinc-700 dark:text-zinc-300">
          Something went wrong while loading your organization. Please try
          again.
        </p>
        <button
          type="button"
          onClick={() => retry()}
          className="mt-6 w-full rounded-md bg-zinc-900 px-4 py-2 font-medium text-white transition hover:bg-zinc-700 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
        >
          Retry
        </button>
      </div>
    </main>
  );
}
