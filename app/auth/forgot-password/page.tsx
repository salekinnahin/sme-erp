import type { Metadata } from "next";
import Link from "next/link";
import { AuthCard } from "../_components/ui";

export const metadata: Metadata = { title: "Reset password · SME ERP" };

// Placeholder — password reset will be implemented in a later task.
export default function ForgotPasswordPage() {
  return (
    <AuthCard title="Reset password">
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        Password reset is not available yet. Please contact your administrator
        for help accessing your account.
      </p>
      <Link
        href="/auth/login"
        className="mt-6 block text-center text-sm font-medium text-zinc-900 underline dark:text-zinc-50"
      >
        Back to sign in
      </Link>
    </AuthCard>
  );
}
