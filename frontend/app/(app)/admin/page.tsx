"use client";
import Link from "next/link";
import { ApiKeys } from "@/components/ApiKeys";
import { ConsoleHeader } from "@/components/ConsoleUI";
import { ConsoleIcon } from "@/components/ConsoleIcon";
import { useConsoleRole } from "@/components/AppShell";
import { useT } from "@/lib/i18n";

export default function AdminPage() {
  const { lang } = useT();
  const role = useConsoleRole();
  const tr = (fr: string, en: string) => lang === "fr" ? fr : en;
  return <section className="console-page">
    <ConsoleHeader title={tr("Accès & intégrations", "Access & integrations")} description={tr("Les accès de connexion de votre entreprise. Créez un jeton dédié à chaque poste ou agent raccordé.", "Your organization’s connection access. Create a dedicated token for each connected workstation or agent.")} />
    {role === "admin" ? <section id="admin-access"><ApiKeys /></section> : <p className="console-note">{tr("Un administrateur gère les accès de l’entreprise.", "An administrator manages organization access.")}</p>}
    <div className="workspace-products-grid">
      <section className="workspace-step" data-product="secret_guard"><ConsoleIcon name="secret_guard" /><h2>Dev Guard</h2><p>{tr("Retrouvez les règles d’équipe et l’état des postes dans l’espace des développeurs.", "Find team policies and workstation status in the developer workspace.")}</p><Link href="/extensions/policies">{tr("Gérer les politiques d’équipe", "Manage team policies")}</Link></section>
      <section className="workspace-step" data-product="ai_guard"><ConsoleIcon name="ai_guard" /><h2>Agent Guard</h2><p>{tr("Configurez les projets, les fournisseurs et les intégrations de vos agents en production.", "Configure projects, providers and integrations for your production agents.")}</p><Link href="/ai-guard/settings">{tr("Configurer les agents", "Configure agents")}</Link></section>
    </div>
  </section>;
}
