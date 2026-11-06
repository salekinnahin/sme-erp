import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { requireTenant } from "@/lib/tenancy/context";
import { AppLayout } from "@/app/_components/app-layout";
import { PageHeader, PageSkeleton, SectionCard } from "@/app/_components/ui";
import { Icon } from "@/app/_components/icon";
import { visibleNavigation } from "@/lib/ui/navigation";
import { Badge } from "@/app/_components/status-badge";

export const metadata: Metadata = { title: "Dashboard · SME ERP" };

export default function DashboardPage() {
  return <AppLayout>
    <Suspense fallback={<PageSkeleton />}>
      <Dashboard />
    </Suspense>
  </AppLayout>;
}
async function Dashboard() {
  const { organization, role } = await requireTenant();
  return <div className="space-y-7">
    <PageHeader title="Dashboard" description="Your workspace for everyday business operations." />
    <SectionCard>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="mb-2 text-xs text-muted">YOUR ORGANIZATION</p>
          <h2 className="text-xl font-semibold tracking-tight">{organization.name}</h2>
          <p className="mt-2 text-sm text-muted">Keep sales, purchases and business records connected.</p>
        </div>
        <Badge tone="blue">
          <span className="capitalize">{role}</span> access</Badge>
      </div>
    </SectionCard>
    <div className="space-y-7">{visibleNavigation().filter((group) => !["Overview", "Settings"].includes(group.label)).map((group) => <section key={group.label}>
      <h2 className="mb-3 text-xs font-semibold text-muted">{group.label}</h2>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{group.items.map((item) => <Link className="quick-link" key={item.href} href={item.href}>
        <Icon name={item.icon} />
        <div className="flex-1">
          <p className="text-sm font-semibold">{item.label}</p>
          <p className="mt-1 text-xs text-muted">Open {item.label.toLowerCase()}</p>
        </div>
        <Icon name="arrow" className="text-zinc-400" />
      </Link>)}</div>
    </section>)}</div>
  </div>;
}
