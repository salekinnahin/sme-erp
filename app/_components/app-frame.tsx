"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { activeNavItem, isDocumentPrintRoute } from "@/lib/ui/navigation";
import { AppSidebar, type WorkspaceIdentity } from "./app-sidebar";
import { AppTopbar } from "./app-topbar";
import { Icon } from "./icon";
import { PageContainer } from "./ui";

export function AppFrame({ children, identity, signOutControl }: { children: React.ReactNode; identity: WorkspaceIdentity; signOutControl: React.ReactNode }) {
  const pathname = usePathname();
  const drawer = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const returnFocus = useRef(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const [seenPathname, setSeenPathname] = useState(pathname);
  // A print route removes the dialog before its close event can reach React.
  // Reset on navigation as well, so neither expanded state nor scroll lock
  // can survive that unmount (including Back/Forward navigation).
  if (seenPathname !== pathname) {
    setSeenPathname(pathname);
    setMenuOpen(false);
  }
  function closeDrawer(restoreFocus = true) {
    returnFocus.current = restoreFocus;
    drawer.current?.close();
  }
  function onDrawerClose() {
    setMenuOpen(false);
    if (returnFocus.current && !window.matchMedia("(min-width: 1024px)").matches && trigger.current?.isConnected) {
      trigger.current.focus();
    }
  }
  useEffect(() => {
    const media = window.matchMedia("(min-width: 1024px)");
    const closeOnDesktop = () => {
      if (media.matches) {
        returnFocus.current = false;
        drawer.current?.close();
      }
    };
    media.addEventListener("change", closeOnDesktop);
    return () => media.removeEventListener("change", closeOnDesktop);
  }, []);
  useEffect(() => {
    returnFocus.current = false;
    drawer.current?.close();
  }, [pathname]);
  useEffect(() => {
    if (!menuOpen) return;
    const bodyOverflow = document.body.style.overflow;
    const rootOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = bodyOverflow;
      document.documentElement.style.overflow = rootOverflow;
    };
  }, [menuOpen]);
  // Screen preview and browser print both bypass all workspace chrome and spacing.
  if (isDocumentPrintRoute(pathname)) return <div className="document-print-frame">{children}</div>;
  return <div className="app-shell">
    <a href="#main-content" className="skip-link">Skip to content</a>
    <aside className="desktop-sidebar">
      <AppSidebar pathname={pathname} identity={identity} signOutControl={signOutControl} />
    </aside>
    <dialog ref={drawer} id="mobile-navigation" aria-label="Workspace navigation" className="mobile-navigation" onClose={onDrawerClose} onCancel={(event) => { event.preventDefault(); closeDrawer(); }}>
      <button type="button" className="drawer-close icon-button" aria-label="Close navigation" onClick={() => closeDrawer()}>
        <Icon name="close" />
      </button>
      <AppSidebar pathname={pathname} identity={identity} signOutControl={signOutControl} onNavigate={() => closeDrawer(false)} />
    </dialog>
    <div className="app-main">
      <AppTopbar identity={identity} section={activeNavItem(pathname)?.label ?? "Workspace"} menuOpen={menuOpen} onOpenMenu={() => {
        if (window.matchMedia("(min-width: 1024px)").matches || drawer.current?.open) return;
        trigger.current = document.activeElement as HTMLElement;
        returnFocus.current = true;
        drawer.current?.showModal();
        setMenuOpen(true);
      }} />
      <main id="main-content" tabIndex={-1}>
        <PageContainer>{children}</PageContainer>
      </main>
    </div>
  </div>;
}
