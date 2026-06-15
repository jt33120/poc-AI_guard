"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

const BASE_LINKS = [
  { href: "/inspector", label: "Inspector" },
  { href: "/approvals", label: "Approvals" },
  { href: "/audit", label: "Audit" },
];

export function AppShell({
  role,
  children,
}: {
  role: string | null;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const links = role === "admin" ? [...BASE_LINKS, { href: "/admin", label: "Admin" }] : BASE_LINKS;

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <div className="min-h-screen">
      <header className="flex items-center justify-between border-b bg-white px-6 py-3">
        <div className="flex items-center gap-6">
          <span className="font-bold">xSOM AI Guard</span>
          <nav className="flex gap-4">
            {links.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={pathname.startsWith(link.href) ? "font-semibold" : "text-slate-600"}
              >
                {link.label}
              </Link>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-3 text-sm text-slate-600">
          <span>{role ?? "no role"}</span>
          <button
            type="button"
            onClick={logout}
            className="rounded border border-slate-300 px-3 py-1 hover:bg-slate-100"
          >
            Sign out
          </button>
        </div>
      </header>
      <main className="mx-auto max-w-5xl p-6">{children}</main>
    </div>
  );
}
