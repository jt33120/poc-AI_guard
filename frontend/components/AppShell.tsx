"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

import { Logo, Wordmark } from "@/components/brand";
import { LanguageToggle, type StrKey, useT } from "@/lib/i18n";

const LINKS: { href: string; key: StrKey }[] = [
  { href: "/home", key: "nav.home" },
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
  const links = role === "admin" ? [...LINKS, ADMIN_LINK] : LINKS;

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-white/10 bg-navy/80 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
          <div className="flex items-center gap-8">
            <Link href="/home" className="flex items-center gap-2.5">
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
                    className={`rounded-pill px-3.5 py-1.5 text-sm transition ${
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
          <div className="flex items-center gap-3">
            <LanguageToggle />
            <span className="badge badge-blue capitalize">{role ?? t("nav.norole")}</span>
            <button type="button" onClick={logout} className="btn btn-ghost px-4 py-1.5">
              {t("nav.signout")}
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
    </div>
  );
}
