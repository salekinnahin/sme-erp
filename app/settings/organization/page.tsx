import { PageHeader, SectionCard, PageSkeleton } from "@/app/_components/ui";
import type { Metadata } from "next";
import { Suspense } from "react";
import { requireTenant } from "@/lib/tenancy/context";
import { getOrganizationBranding } from "@/lib/organizations/branding";
import { canBranding } from "@/lib/organizations/permissions";
import { formatDateTime } from "@/lib/format";
import { LogoSettings } from "./logo-settings";

export const metadata: Metadata = { title: "Organization settings · SME ERP" };

export default function OrganizationSettingsPage() {
  return (
    <Suspense fallback={<PageSkeleton label="Loading…" />}>
      <OrganizationSettings />
    </Suspense>
  );
}

async function OrganizationSettings() {
  const tenant = await requireTenant();
  const branding = await getOrganizationBranding(tenant);
  const canManage = canBranding(tenant.role, "manage");

  return (
    <div className="max-w-5xl space-y-6">
      <PageHeader title="Organization settings" description="Manage the company identity shown in your workspace and on printed business documents." />

      <SectionCard title="Company logo">
        <LogoSettings
          logoUrl={branding.logoUrl}
          logoUpdatedLabel={
            branding.logoUpdatedAt ? formatDateTime(branding.logoUpdatedAt, tenant.organization.timezone) : null
          }
          organizationName={branding.name}
          canManage={canManage}
        />
      </SectionCard>

      <SectionCard title="Company details">
        <dl className="mt-4 grid gap-x-6 gap-y-3 text-sm sm:grid-cols-[10rem_1fr]">
          <Detail label="Name" value={branding.name} />
          <Detail label="Address" value={branding.address} multiline />
          <Detail label="Phone" value={branding.phone} />
          <Detail label="Email" value={branding.email} />
          <Detail label="Tax number" value={branding.taxNumber} />
          <Detail label="Currency" value={tenant.organization.currency} />
          <Detail label="Time zone" value={tenant.organization.timezone} />
        </dl>
      </SectionCard>
    </div>
  );
}

function Detail({ label, value, multiline }: { label: string; value: string | null; multiline?: boolean }) {
  return (
    <>
      <dt className="font-medium text-zinc-600 dark:text-zinc-400">{label}</dt>
      <dd className={`break-words ${multiline ? "whitespace-pre-line" : ""}`}>{value ?? "—"}</dd>
    </>
  );
}
