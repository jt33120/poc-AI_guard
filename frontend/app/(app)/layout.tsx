import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AppShell } from "@/components/AppShell";
import { ClientScopeProvider } from "@/components/ClientScope";
import { getSession } from "@/lib/session";

// La console entière est derrière session. Elle n'a donc rien à faire dans un
// index : un robot n'y voit qu'une redirection vers `/login`, et l'arborescence des
// écrans privés n'a pas à être publiée. Statique, parce que rien n'y varie par
// langue : la balise ne dit pas un texte, elle dit une interdiction.
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }
  return (
    <AppShell role={session.role}>
      <ClientScopeProvider>{children}</ClientScopeProvider>
    </AppShell>
  );
}
