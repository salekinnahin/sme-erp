import { Icon } from "./icon";
import type { WorkspaceIdentity } from "./app-sidebar";

export function AppTopbar({ identity, section, menuOpen, onOpenMenu }: { identity: WorkspaceIdentity; section: string; menuOpen: boolean; onOpenMenu: () => void }) {
  return <header className="app-topbar">
    <div className="flex min-w-0 items-center gap-3">
      <button type="button" className="icon-button mobile-menu-trigger" aria-label="Open navigation" aria-haspopup="dialog" aria-controls="mobile-navigation" aria-expanded={menuOpen} onClick={onOpenMenu}>
        <Icon name="menu" />
      </button>
      <span className="hidden truncate text-muted sm:block">Workspace</span>
      <span aria-hidden="true" className="hidden text-zinc-300 sm:block">/</span>
      <span className="truncate font-medium">{section}</span>
    </div>
    <div className="flex min-w-0 items-center gap-3">
      <span className="max-w-36 truncate text-xs text-muted sm:max-w-64" title={identity.organizationName}>{identity.organizationName}</span>
      <span className="user-avatar" title={`${identity.email} · ${identity.role}`}>{identity.email.slice(0, 1).toUpperCase() || "U"}</span>
    </div>
  </header>;
}
