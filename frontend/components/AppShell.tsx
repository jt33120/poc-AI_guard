"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useState } from "react";
import { Wordmark, XsomMark } from "@/components/brand";
import { SignalPreferences } from "@/design-system/react";
import { LanguageToggle, useT } from "@/lib/i18n";

const RoleContext = createContext<string | null>(null);
export const useConsoleRole = () => useContext(RoleContext);
const LINKS = [
  { href: "/home", fr: "Vue d’ensemble", en: "Overview", code: "01" },
  { href: "/inspector", fr: "Inspecteur", en: "Inspector", code: "02" },
  { href: "/approvals", fr: "Approbations", en: "Approvals", code: "03" },
  { href: "/audit", fr: "Journal d’audit", en: "Audit trail", code: "04" },
  {
    href: "/risk",
    fr: "Risque & intégrité",
    en: "Risk & integrity",
    code: "05",
  },
  { href: "/costs", fr: "Coûts & usage", en: "Cost & usage", code: "06" },
  { href: "/executive", fr: "Synthèse", en: "Executive", code: "07" },
];
const ADMIN_LINKS = [
  { href: "/policy", fr: "Policies", en: "Policies", code: "08" },
  {
    href: "/onboarding",
    fr: "Connecter un agent",
    en: "Connect an agent",
    code: "09",
  },
  { href: "/admin", fr: "Administration", en: "Administration", code: "10" },
];

export function AppShell({
  role,
  children,
}: {
  role: string | null;
  children: React.ReactNode;
}) {
  const { t, lang } = useT();
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [logoutError, setLogoutError] = useState(false);
  const links = role === "admin" ? [...LINKS, ...ADMIN_LINKS] : LINKS;
  const active = links.find((link) => pathname.startsWith(link.href));
  useEffect(() => {
    const close = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, []);
  async function logout() {
    setLeaving(true);
    setLogoutError(false);
    try {
      const response = await fetch("/api/auth/logout", { method: "POST" });
      if (!response.ok) throw new Error("logout");
      router.push("/login");
      router.refresh();
    } catch {
      setLogoutError(true);
      setLeaving(false);
    }
  }
  return (
    <RoleContext.Provider value={role}>
      <div className="console-shell">
        <a className="console-skip" href="#console-main">
          {lang === "fr" ? "Aller au contenu" : "Skip to content"}
        </a>
        <header className="console-topbar">
          <Link
            href="/home"
            className="console-brand"
            onClick={() => setOpen(false)}
          >
            <XsomMark className="console-mark" />
            <Wordmark />
          </Link>
          <div className="console-breadcrumb">
            <span>Control plane</span>
            <span aria-hidden="true">/</span>
            <strong>
              {active?.[lang] ?? (lang === "fr" ? "Réglages" : "Settings")}
            </strong>
          </div>
          <div className="console-topbar-actions">
            <LanguageToggle />
            <span className="console-role">{role ?? t("nav.norole")}</span>
            <button
              type="button"
              className="console-menu btn btn-ghost"
              aria-label="Menu"
              aria-controls="console-navigation"
              aria-expanded={open}
              onClick={() => setOpen(!open)}
            >
              {open ? "×" : "☰"}
            </button>
          </div>
        </header>
        <aside
          className="console-sidebar"
          data-open={open}
          id="console-navigation"
        >
          <div className="console-sidebar-head">
            <span className="console-kicker">AI OPERATIONS</span>
            <span className="console-sidebar-line" />
          </div>
          <nav
            aria-label={lang === "fr" ? "Console principale" : "Main console"}
          >
            {links.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                aria-current={
                  pathname.startsWith(link.href) ? "page" : undefined
                }
                onClick={() => setOpen(false)}
              >
                <span className="console-nav-code" aria-hidden="true">
                  {link.code}
                </span>
                <span>{link[lang]}</span>
              </Link>
            ))}
          </nav>
          <div className="console-sidebar-bottom">
            <Link
              className="console-settings-link"
              href="/settings"
              onClick={() => setOpen(false)}
              aria-current={pathname === "/settings" ? "page" : undefined}
            >
              {lang === "fr" ? "Réglages" : "Settings"}
              <span aria-hidden="true">↗</span>
            </Link>
            <SignalPreferences lang={lang} />
            <button
              type="button"
              disabled={leaving}
              onClick={logout}
              className="btn btn-ghost console-logout"
            >
              {leaving ? t("common.loading") : t("nav.signout")}
            </button>
            {logoutError && (
              <p role="alert" className="console-error-text">
                {lang === "fr"
                  ? "Déconnexion impossible. Réessayez."
                  : "Could not sign out. Try again."}
              </p>
            )}
            <a className="console-house" href="https://www.xsom.fr">
              xSOM Consulting <span aria-hidden="true">↗</span>
            </a>
          </div>
        </aside>
        {open && (
          <button
            type="button"
            className="console-nav-backdrop"
            aria-label={lang === "fr" ? "Fermer le menu" : "Close menu"}
            onClick={() => setOpen(false)}
          />
        )}
        <main id="console-main" className="console-canvas" tabIndex={-1}>
          {children}
        </main>
      </div>
    </RoleContext.Provider>
  );
}
