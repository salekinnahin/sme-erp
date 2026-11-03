import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { connection } from "next/server";

/**
 * Supabase client for use in Server Components, Server Functions and
 * Route Handlers. Create a new client per request — never share one
 * across requests.
 */
export async function createClient() {
  // Auth state is per-user, so anything using this client must render at
  // request time. `connection()` stops prerendering (including the runtime
  // prefetch pass, where cookies() resolves) before supabase-js reads the
  // clock via Date.now() for token-expiry checks. In Server Functions and
  // Route Handlers it resolves immediately.
  await connection();
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // `setAll` was called from a Server Component, where cookies are
            // read-only. This is safe to ignore as long as session refresh is
            // handled elsewhere (e.g. in a proxy / Server Function).
          }
        },
      },
    },
  );
}
