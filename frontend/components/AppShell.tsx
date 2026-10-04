"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useRef, useState } from "react";
import { Wordmark, XsomMark } from "@/components/brand";
import { ConsoleIcon } from "@/components/ConsoleIcon";
import { ConsoleSkeleton } from "@/components/ConsoleUI";
import { useWorkspace } from "@/components/WorkspaceProvider";
import { LanguageToggle, useT } from "@/lib/i18n";
import { SignalPreferences } from "@/design-system/react";
import { accessLabel, canOpenProduct, PRODUCTS, productForPage, type Product } from "@/lib/workspace";

const RoleContext = createContext<string | null>(null);
export const useConsoleRole = () => useContext(RoleContext);
const PRODUCT_LINKS = {
  secret_guard: [
    { href: "/extensions", fr: "Vue d’ensemble", en: "Overview", icon: "grid" },
    { href: "/extensions/devices", fr: "Postes de l’équipe", en: "Team workstations", icon: "device" },
    { href: "/extensions/activity", fr: "Journal des protections", en: "Protection log", icon: "activity" },
    { href: "/extensions/approvals", fr: "Approbations", en: "Approvals", icon: "check" },
    { href: "/extensions/policies", fr: "Politiques d’équipe", en: "Team policies", icon: "policy" },
    { href: "/extensions/connect", fr: "Relier un poste", en: "Link a workstation", icon: "connect", admin: true },
    { href: "/extensions/setup", fr: "Installation & aide", en: "Installation & help", icon: "connect" },
  ],
  ai_guard: [
    { href: "/ai-guard", fr: "Vue d’ensemble", en: "Overview", icon: "grid" },
    { href: "/inspector", fr: "Agents & outils", en: "Agents & tools", icon: "ai_guard" },
    { href: "/approvals", fr: "Approbations", en: "Approvals", icon: "check" },
    { href: "/audit", fr: "Journal d’audit", en: "Audit trail", icon: "audit" },
    { href: "/risk", fr: "Risques & intégrité", en: "Risk & integrity", icon: "activity" },
    { href: "/costs", fr: "Coûts & usage", en: "Cost & usage", icon: "costs" },
    { href: "/executive", fr: "Synthèse métier", en: "Business summary", icon: "grid" },
    { href: "/policy", fr: "Politiques", en: "Policies", icon: "policy", admin: true },
    { href: "/onboarding", fr: "Connecter un agent", en: "Connect an agent", icon: "connect", admin: true },
    { href: "/ai-guard/settings", fr: "Configuration", en: "Configuration", icon: "settings", admin: true },
  ],
};
const COMPANY_LINKS = [
  { href: "/xsom/regles", fr: "Atelier xSOM", en: "xSOM workshop", icon: "policy", admin: true },
  { href: "/subscriptions", fr: "Mes abonnements", en: "My subscriptions", icon: "subscriptions" },
  { href: "/admin", fr: "Accès & intégrations", en: "Access & integrations", icon: "team", admin: true },
  { href: "/settings", fr: "Réglages", en: "Settings", icon: "settings" },
];

export function AppShell({ role, children }: { role: string | null; children: React.ReactNode }) {
  const { lang, t } = useT();
  const tr = (fr: string, en: string) => lang === "fr" ? fr : en;
  const pathname = usePathname();
  const router = useRouter();
  const { identity, workspace, loading, error, reload } = useWorkspace();
  const [open, setOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [logoutError, setLogoutError] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const sidebar = useRef<HTMLElement>(null);
  const account = useRef<HTMLDetailsElement>(null);
  const product = productForPage(pathname);
  const subscription = workspace?.subscriptions.find((entry) => entry.product === product);
  const activeLink = [...PRODUCT_LINKS.secret_guard, ...PRODUCT_LINKS.ai_guard, ...COMPANY_LINKS].find((link) => pathname === link.href);
  const dogfooding = workspace?.subscriptions.some((entry) => entry.status === "internal");

  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (open) { setOpen(false); menuButton.current?.focus(); }
        if (account.current?.open) { account.current.open = false; account.current.querySelector("summary")?.focus(); }
      }
      if (open && event.key === "Tab") {
        const elements = [menuButton.current, ...Array.from(sidebar.current?.querySelectorAll<HTMLElement>("a[href], button:not([disabled])") ?? [])].filter((el): el is HTMLElement => !!el);
        const index = elements.indexOf(document.activeElement as HTMLElement);
        if (event.shiftKey && index <= 0) { event.preventDefault(); elements.at(-1)?.focus(); }
        else if (!event.shiftKey && index === elements.length - 1) { event.preventDefault(); elements[0]?.focus(); }
      }
    };
    window.addEventListener("keydown", close);
    if (open) sidebar.current?.querySelector<HTMLElement>("a")?.focus();
    return () => window.removeEventListener("keydown", close);
  }, [open]);

  async function logout() {
    setLeaving(true);
    setLogoutError(false);
    try {
      const response = await fetch("/api/auth/logout", { method: "POST" });
      if (!response.ok) throw new Error("logout");
      router.push("/login");
      router.refresh();
    } catch { setLogoutError(true); setLeaving(false); }
  }
  const navigate = () => { setOpen(false); if (account.current) account.current.open = false; };

  function productNavigation(id: Product) {
    const entry = PRODUCTS[id];
    const access = workspace?.subscriptions.find((item) => item.product === id);
    const locked = !loading && !canOpenProduct(access);
    return <div className="workspace-product-nav" data-product={id} data-selected={product === id} key={id}>
      <Link href={entry.href} className="workspace-product-switch" onClick={navigate} aria-current={pathname === entry.href ? "page" : undefined}>
        <span className="workspace-product-mark"><ConsoleIcon name={id} /></span>
        <span><strong>{entry.name}</strong><small>{entry[lang]}</small></span>
        <ConsoleIcon name={locked ? "lock" : "chevron"} className="workspace-product-indicator" />
        {locked && <span className="sr-only">{accessLabel(access?.status, lang)}</span>}
      </Link>
      {product === id && <nav className="workspace-product-links" aria-label={entry.name}>
        {PRODUCT_LINKS[id].filter((link) => !("admin" in link) || role === "admin").map((link) =>
          <Link key={link.href} href={link.href} aria-current={pathname === link.href ? "page" : undefined} onClick={navigate}>
            <ConsoleIcon name={locked ? "lock" : link.icon} /><span>{link[lang]}</span>
          </Link>,
        )}
      </nav>}
    </div>;
  }

  return <RoleContext.Provider value={role}>
    <div className="console-shell workspace-shell" data-product={product ?? "company"}>
      <a className="console-skip" href="#console-main">{tr("Aller au contenu", "Skip to content")}</a>
      <header className="console-topbar">
        <Link href="/home" className="console-brand" onClick={navigate}><XsomMark className="console-mark" /><Wordmark /></Link>
        <div className="console-breadcrumb"><span>{product ? PRODUCTS[product].name : tr("Mon entreprise", "My organization")}</span><ConsoleIcon name="chevron" /><strong>{activeLink?.[lang] ?? tr("Vue d’ensemble", "Overview")}</strong></div>
        <div className="console-topbar-actions">
          <div className="workspace-organization"><span>{tr("Entreprise suivie", "Organization")}</span><strong>{workspace?.organization.name ?? (loading ? "…" : tr("Indisponible", "Unavailable"))}</strong>{dogfooding && <small>Dogfooding</small>}</div>
          <details className="workspace-account" ref={account}>
            <summary aria-label={tr("Mon compte", "My account")}><span className="workspace-avatar">{identity.email?.slice(0, 1).toUpperCase() ?? "?"}</span><ConsoleIcon name="chevron" /></summary>
            <div className="workspace-account-panel">
              <strong>{identity.email ?? tr("Compte connecté", "Signed-in account")}</strong>
              <span>{role === "admin" ? tr("Administrateur", "Administrator") : role === "operator" ? tr("Opérateur", "Operator") : tr("Lecture seule", "Read-only")}</span>
              <LanguageToggle />
              <SignalPreferences lang={lang} />
              <Link href="/subscriptions" onClick={navigate}>{tr("Mes abonnements", "My subscriptions")}</Link>
              <Link href="/settings" onClick={navigate}>{tr("Réglages du compte", "Account settings")}</Link>
              {identity.preview ? <p>{tr("Identité de démonstration locale", "Local demonstration identity")}</p> : <button type="button" onClick={logout} disabled={leaving}>{leaving ? t("common.loading") : t("nav.signout")}</button>}
              {logoutError && <p role="alert">{tr("Déconnexion impossible. Réessayez.", "Could not sign out. Try again.")}</p>}
            </div>
          </details>
          <button ref={menuButton} type="button" className="console-menu workspace-menu" aria-label={open ? tr("Fermer le menu", "Close menu") : tr("Ouvrir le menu", "Open menu")} aria-controls="console-navigation" aria-expanded={open} onClick={() => setOpen(!open)}><ConsoleIcon name={open ? "close" : "menu"} /></button>
        </div>
      </header>
      <aside ref={sidebar} className="console-sidebar" data-open={open} id="console-navigation" aria-label={tr("Navigation principale", "Main navigation")}>
        <nav className="workspace-home-nav" aria-label={tr("Accueil entreprise", "Organization home")}><Link href="/home" aria-current={pathname === "/home" ? "page" : undefined} onClick={navigate}><ConsoleIcon name="home" />{tr("Vue d’ensemble", "Overview")}</Link></nav>
        <div className="workspace-nav-label">{tr("Vos produits", "Your products")}</div>
        {productNavigation("secret_guard")}
        {productNavigation("ai_guard")}
        <div className="console-sidebar-bottom">
          <div className="workspace-nav-label">{tr("Entreprise", "Organization")}</div>
          <nav aria-label={tr("Gestion de l’entreprise", "Organization management")}>{COMPANY_LINKS.filter((link) => !link.admin || role === "admin").map((link) => <Link key={link.href} href={link.href} aria-current={pathname === link.href ? "page" : undefined} onClick={navigate}><ConsoleIcon name={link.icon} />{link[lang]}</Link>)}</nav>
          <div className="workspace-sidebar-foot"><span className="workspace-avatar">{workspace?.organization.name.slice(0, 1).toUpperCase() ?? "—"}</span><span><strong>{workspace?.organization.name ?? tr("Votre entreprise", "Your organization")}</strong><small>{dogfooding ? tr("Usage interne · Dogfooding", "Internal use · Dogfooding") : tr("Espace de travail", "Workspace")}</small></span></div>
        </div>
      </aside>
      {open && <button type="button" className="console-nav-backdrop" aria-label={tr("Fermer la navigation", "Close navigation")} tabIndex={-1} onClick={() => { setOpen(false); menuButton.current?.focus(); }} />}
      <main id="console-main" className="console-canvas" tabIndex={-1}>
        {identity.preview && <div className="workspace-preview-note"><span>{tr("Aperçu local", "Local preview")}</span>{tr("Données de démonstration. Aucune connexion au compte de production.", "Demonstration data. Not connected to the production account.")}</div>}
        {product && loading ? <ConsoleSkeleton rows={3} /> : product && !canOpenProduct(subscription) ?
          <section className="workspace-locked"><span className="workspace-product-mark" data-product={product}><ConsoleIcon name="lock" /></span><p>{PRODUCTS[product].name}</p><h1>{error ? tr("Les accès sont indisponibles", "Access information is unavailable") : accessLabel(subscription?.status, lang)}</h1><p>{error ? tr("Impossible de vérifier les droits de votre entreprise. Réessayez pour ouvrir cet espace.", "We could not verify your organization’s access. Try again to open this workspace.") : tr("Cet espace nécessite un accès à ce produit pour votre entreprise. Retrouvez son état dans Mes abonnements.", "Your organization needs access to this product to open this workspace. View its status in My subscriptions.")}</p><div className="console-actions"><Link className="btn btn-primary" href={`/subscriptions#${product}`}>{tr("Voir mes abonnements", "View my subscriptions")}</Link>{error != null && <button className="btn btn-ghost" onClick={reload}>{tr("Réessayer", "Retry")}</button>}</div><small>{tr("L’extension Secret Guard Local reste disponible gratuitement.", "The Secret Guard Local extension remains available for free.")}</small></section>
          : children}
      </main>
    </div>
  </RoleContext.Provider>;
}
