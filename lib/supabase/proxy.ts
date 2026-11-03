import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { User } from "@supabase/supabase-js";

/**
 * Refreshes the Supabase auth session for the incoming request.
 *
 * Returns the response to continue with (carrying any refreshed auth
 * cookies) and the authenticated user, if any. If you build a different
 * response (e.g. a redirect), pass it through `withSessionCookies` so the
 * refreshed cookies are not lost.
 */
export async function updateSession(
  request: NextRequest,
): Promise<{ response: NextResponse; user: User | null }> {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          // Make refreshed cookies visible to Server Components in this request…
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next({ request });
          // …and send them back to the browser.
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
          // Prevent CDNs from caching responses that carry auth cookies.
          Object.entries(headers).forEach(([key, value]) =>
            response.headers.set(key, value),
          );
        },
      },
    },
  );

  // Do not run code between createServerClient and getUser(): getUser()
  // validates the token with the Supabase Auth server and refreshes it
  // if it has expired.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return { response, user };
}

/** Copies auth cookies and cache headers from `source` onto `target`. */
export function withSessionCookies(
  source: NextResponse,
  target: NextResponse,
): NextResponse {
  source.cookies.getAll().forEach((cookie) => target.cookies.set(cookie));
  ["cache-control", "expires", "pragma"].forEach((key) => {
    const value = source.headers.get(key);
    if (value) target.headers.set(key, value);
  });
  return target;
}
