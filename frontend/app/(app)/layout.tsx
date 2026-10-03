import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AppShell } from "@/components/AppShell";
import { ClientScopeProvider } from "@/components/ClientScope";
import { getSession } from "@/lib/session";
import { WorkspaceProvider } from "@/components/WorkspaceProvider";
import { config } from "@/lib/config";
import "../workspace-console.css";

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
    <WorkspaceProvider identity={{ role: session.role, email: session.email, preview: config.localPreview }}>
      <AppShell role={session.role}>
        <ClientScopeProvider>{children}</ClientScopeProvider>
      </AppShell>
    </WorkspaceProvider>
  );
}
