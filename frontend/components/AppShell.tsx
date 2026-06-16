"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";

import { Logo, Wordmark } from "@/components/brand";
import { LanguageToggle, type StrKey, useT } from "@/lib/i18n";

const LINKS: { href: string; key: StrKey }[] = [
  { href: "/home", key: "nav.home" },
  { href: "/executive", key: "nav.exec" },
  { href: "/inspector", key: "nav.inspector" },
  { href: "/approvals", key: "nav.approvals" },
  { href: "/audit", key: "nav.audit" },
];
const ADMIN_LINK: { href: string; key: StrKey } = { href: "/admin", key: "nav.admin" };

export function AppShell({
  role,
  children,
}: {
  role: string | null;
  children: React.ReactNode;
}) {
  const { t } = useT();
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const links = role === "admin" ? [...LINKS, ADMIN_LINK] : LINKS;

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-white/10 bg-navy/80 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-6">
            <Link href="/home" className="flex items-center gap-2.5" onClick={() => setOpen(false)}>
              <Logo />
              <Wordmark className="text-[15px]" />
            </Link>
            <nav className="hidden items-center gap-1 md:flex">
              {links.map((link) => {
                const active = pathname.startsWith(link.href);
                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    className={`rounded-pill px-3 py-1.5 text-sm transition ${
                      active
                        ? "bg-white/10 text-white"
                        : "text-white/55 hover:bg-white/[0.05] hover:text-white"
                    }`}
                  >
                    {t(link.key)}
                  </Link>
                );
              })}
            </nav>
          </div>
          <div className="flex items-center gap-2 sm:gap-3">
            <LanguageToggle />
            <span className="badge badge-blue hidden capitalize sm:inline-flex">
              {role ?? t("nav.norole")}
            </span>
            <button
              type="button"
              onClick={logout}
              className="btn btn-ghost hidden px-4 py-1.5 md:inline-flex"
            >
              {t("nav.signout")}
            </button>
            {/* Mobile menu toggle */}
            <button
              type="button"
              aria-label="Menu"
              aria-expanded={open}
              onClick={() => setOpen((v) => !v)}
              className="grid h-9 w-9 place-items-center rounded-xl border border-white/15 bg-white/[0.04] text-white md:hidden"
            >
              <svg
                viewBox="0 0 24 24"
                className="h-5 w-5"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                aria-hidden="true"
              >
                {open ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
              </svg>
            </button>
          </div>
        </div>

        {/* Mobile dropdown menu */}
        {open ? (
          <nav className="border-t border-white/10 bg-navy/95 px-4 py-3 md:hidden">
            <div className="flex flex-col gap-1">
              {links.map((link) => {
                const active = pathname.startsWith(link.href);
                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    onClick={() => setOpen(false)}
                    className={`rounded-xl px-3 py-2.5 text-sm transition ${
                      active ? "bg-white/10 text-white" : "text-white/70 hover:bg-white/[0.05]"
                    }`}
                  >
                    {t(link.key)}
                  </Link>
                );
              })}
            </div>
            <div className="mt-3 flex items-center justify-between border-t border-white/10 pt-3">
              <span className="badge badge-blue capitalize">{role ?? t("nav.norole")}</span>
              <button type="button" onClick={logout} className="btn btn-ghost px-4 py-1.5">
                {t("nav.signout")}
              </button>
            </div>
          </nav>
        ) : null}
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">{children}</main>
    </div>
  );
}
