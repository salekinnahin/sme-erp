import type { EmailOtpType } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

/**
 * Handles the link in Supabase's sign-up confirmation email.
 * Supports both the `token_hash` template (recommended for SSR) and the
 * default PKCE `code` redirect.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const code = searchParams.get("code");

  const supabase = await createClient();
  let ok = false;

  try {
    if (tokenHash && type) {
      const { error } = await supabase.auth.verifyOtp({
        type,
        token_hash: tokenHash,
      });
      ok = !error;
    } else if (code) {
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      ok = !error;
    }
  } catch {
    ok = false;
  }

  // next/navigation's redirect() keeps the session cookies set above.
  redirect(ok ? "/dashboard" : "/auth/login?message=confirmation_failed");
}
