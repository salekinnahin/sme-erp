import type { Metadata } from "next";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getTenant, requireUser } from "@/lib/tenancy/context";
import {
  DEFAULT_CURRENCY,
  DEFAULT_TIMEZONE,
  currencyOptions,
  timezoneOptions,
} from "@/lib/organizations/validation";
import { signOut } from "@/app/auth/actions";
import { AuthCard } from "@/app/auth/_components/ui";
import { OrganizationForm } from "./organization-form";

export const metadata: Metadata = { title: "Set up your organization · SME ERP" };

export default function OrganizationOnboardingPage() {
  return (
    <AuthCard
      title="Set up your organization"
      subtitle="Tell us about your business. You can change these details later."
    >
      <Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}>
        <Onboarding />
      </Suspense>
    </AuthCard>
  );
}

async function Onboarding() {
  // Server-side guards; the proxy redirect is only optimistic.
  await requireUser();
  if (await getTenant()) redirect("/dashboard");

  return (
    <>
      <OrganizationForm
        currencies={currencyOptions()}
        timezones={timezoneOptions()}
        defaultCurrency={DEFAULT_CURRENCY}
        defaultTimezone={DEFAULT_TIMEZONE}
      />
      <form action={signOut} className="mt-4 text-center">
        <button
          type="submit"
          className="text-sm text-zinc-500 underline hover:text-zinc-900 dark:hover:text-zinc-50"
        >
          Sign out
        </button>
      </form>
    </>
  );
}
