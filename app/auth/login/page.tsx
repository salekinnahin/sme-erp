import type { Metadata } from "next";
import { Suspense } from "react";
import { Alert, AuthCard } from "../_components/ui";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in · SME ERP" };

const NOTICES: Record<string, { kind: "error" | "success"; text: string }> = {
  confirmed: {
    kind: "success",
    text: "Your email is confirmed. You can now sign in.",
  },
  confirmation_failed: {
    kind: "error",
    text: "That confirmation link is invalid or has expired. Please sign up again or request a new link.",
  },
};

async function Notice({
  searchParams,
}: {
  searchParams: PageProps<"/auth/login">["searchParams"];
}) {
  const { message } = await searchParams;
  const notice = typeof message === "string" ? NOTICES[message] : undefined;
  return notice ? <Alert kind={notice.kind}>{notice.text}</Alert> : null;
}

export default function LoginPage({ searchParams }: PageProps<"/auth/login">) {
  return (
    <AuthCard title="Sign in" subtitle="Welcome back.">
      <LoginForm
        notice={
          <Suspense fallback={null}>
            <Notice searchParams={searchParams} />
          </Suspense>
        }
      />
    </AuthCard>
  );
}
