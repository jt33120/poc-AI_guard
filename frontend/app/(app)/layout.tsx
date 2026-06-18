import { redirect } from "next/navigation";

import { AgentScopeProvider } from "@/components/AgentScope";
import { AppShell } from "@/components/AppShell";
import { getSession } from "@/lib/session";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }
  return (
    <AppShell role={session.role}>
      <AgentScopeProvider>{children}</AgentScopeProvider>
    </AppShell>
  );
}
