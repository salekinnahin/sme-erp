import { Suspense } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

// The proxy normally redirects `/` before this renders; this is the
// server-side fallback.
export default function Home() {
  return (
    <Suspense fallback={null}>
      <RedirectByAuth />
    </Suspense>
  );
}

async function RedirectByAuth(): Promise<never> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  redirect(user ? "/dashboard" : "/auth/login");
}
