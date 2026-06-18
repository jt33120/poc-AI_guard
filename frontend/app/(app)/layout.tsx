import { redirect } from "next/navigation";

import { AppShell } from "@/components/AppShell";
import { ClientScopeProvider } from "@/components/ClientScope";
import { getSession } from "@/lib/session";

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
