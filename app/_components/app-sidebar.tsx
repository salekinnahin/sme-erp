import Link from "next/link";
import { isActiveRoute, visibleNavigation } from "@/lib/ui/navigation";
import { Icon } from "./icon";
import { OrganizationAvatar } from "./organization-avatar";

export type WorkspaceIdentity = { organizationName: string; logoUrl: string | null; email: string; role: string };

/** One navigation registry and renderer shared by the fixed sidebar and mobile drawer. */
export function AppSidebar({ pathname, identity, onNavigate, signOutControl }: { pathname: string; identity: WorkspaceIdentity; onNavigate?: () => void; signOutControl: React.ReactNode }) {
  const groups = visibleNavigation();
  return <div className="sidebar-content">
    <Link href="/dashboard" className="product-mark" onClick={onNavigate}>
      <span className="product-symbol">s</span>
      <span>SME ERP<span className="product-caption">Business workspace</span>
      </span>
    </Link>
    <div className="organization-context">
      <OrganizationAvatar name={identity.organizationName} logoUrl={identity.logoUrl} />
      <div className="min-w-0">
        <p className="truncate font-semibold" title={identity.organizationName}>{identity.organizationName}</p>
        <p className="text-xs text-muted">Organization workspace</p>
      </div>
    </div>
    <nav aria-label="Main navigation" className="sidebar-nav">{groups.map((group) => <div key={group.label} className={group.label === "Settings" ? "nav-group nav-settings" : "nav-group"}>
      <p className="nav-group-label">{group.label}</p>{group.items.map((item) => <Link key={item.href} href={item.href} onClick={onNavigate} aria-current={isActiveRoute(pathname, item.href) ? "page" : undefined} className="nav-link">
        <Icon name={item.icon} />
        <span>{item.label}</span>
      </Link>)}</div>)}</nav>
    <div className="sidebar-account">
      <span className="user-avatar">{identity.email.slice(0, 1).toUpperCase() || "U"}</span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium" title={identity.email}>{identity.email || "Your account"}</p>
        <p className="text-xs capitalize text-muted">{identity.role}</p>
      </div>{signOutControl}</div>
  </div>;
}
