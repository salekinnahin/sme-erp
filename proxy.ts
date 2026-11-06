import { NextResponse, type NextRequest } from "next/server";
import { updateSession, withSessionCookies } from "@/lib/supabase/proxy";

// Organization membership is checked server-side by the pages themselves
// (lib/tenancy/context.ts), not here.
const PROTECTED_PREFIXES = [
  "/dashboard",
  "/onboarding",
  "/customers",
  "/vendors",
  "/products",
  "/quotations",
  "/sales-orders",
  "/invoices",
  "/purchase-orders",
];
const GUEST_ONLY_PATHS = ["/auth/login", "/auth/sign-up"];

function matches(pathname: string, prefix: string) {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

export async function proxy(request: NextRequest) {
  const { response, user } = await updateSession(request);
  const { pathname } = request.nextUrl;

  const redirectTo = (path: string) =>
    withSessionCookies(
      response,
      NextResponse.redirect(new URL(path, request.url)),
    );

  // Optimistic routing only — pages re-check auth server-side with getUser().
  if (!user && PROTECTED_PREFIXES.some((p) => matches(pathname, p))) {
    return redirectTo("/auth/login");
  }

  if (user && GUEST_ONLY_PATHS.some((p) => matches(pathname, p))) {
    return redirectTo("/dashboard");
  }

  if (pathname === "/") {
    return redirectTo(user ? "/dashboard" : "/auth/login");
  }

  return response;
}

export const config = {
  matcher: [
    // Run on everything except static assets and image optimisation.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
