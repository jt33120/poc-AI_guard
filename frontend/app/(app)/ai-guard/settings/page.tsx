"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { ClientsManager } from "@/components/ClientsManager";
import {
  ConsoleError,
  ConsoleHeader,
  ConsoleSkeleton,
} from "@/components/ConsoleUI";
import { DlpSettings } from "@/components/DlpSettings";
import { ProviderCredentials } from "@/components/ProviderCredentials";
import { ReadTokens } from "@/components/ReadTokens";
import { VerdictBadge } from "@/design-system/react";
import { apiGet } from "@/lib/client";
import { useT } from "@/lib/i18n";
interface ServerRow {
  id: string;
  name: string;
  transport: string;
  enabled: boolean;
}
export default function AdminPage() {
  const { t, lang } = useT();
  const [servers, setServers] = useState<ServerRow[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    apiGet<ServerRow[]>("v1/servers")
      .then(setServers)
      .catch(setError)
      .finally(() => setLoading(false));
  }, []);
  return (
    <section className="console-page">
      <ConsoleHeader
        eyebrow="Agent Guard"
        title={lang === "fr" ? "Configuration des agents" : "Agent configuration"}
        description={
          lang === "fr"
            ? "Projets, fournisseurs et intégrations des agents de votre entreprise."
            : "Projects, providers and integrations for your organization’s agents."
        }
      />
      <nav
        className="console-anchor-nav"
        aria-label={
          lang === "fr"
            ? "Sections d’administration"
            : "Administration sections"
        }
      >
        <a href="#admin-access">{lang === "fr" ? "Accès" : "Access"}</a>
        <a href="#admin-clients">{lang === "fr" ? "Projets" : "Projects"}</a>
        <a href="#admin-dlp">DLP</a>
        <a href="#admin-providers">
          {lang === "fr" ? "Fournisseurs" : "Providers"}
        </a>
        <Link href="/policy">{lang === "fr" ? "Politiques" : "Policies"}</Link>
      </nav>
      <section className="console-panel">
        <div className="console-panel-heading">
          <h2>{t("admin.servers.title")}</h2>
          <span className="console-count">
            {loading || error ? "—" : servers.length}
          </span>
        </div>
        {error != null && <ConsoleError error={error} />}
        {loading ? (
          <ConsoleSkeleton rows={2} />
        ) : (
          <ul className="risk-tool-list">
            {servers.map((server) => (
              <li key={server.id}>
                <div>
                  <strong>{server.name}</strong>
                  <span>{server.transport}</span>
                </div>
                <VerdictBadge value={server.enabled ? "allow" : "deny"} />
                <span>
                  {server.enabled
                    ? lang === "fr"
                      ? "Activé"
                      : "Enabled"
                    : lang === "fr"
                      ? "Désactivé"
                      : "Disabled"}
                </span>
              </li>
            ))}
            {servers.length === 0 && !error && (
              <li className="console-note">{t("admin.servers.empty")}</li>
            )}
          </ul>
        )}
      </section>
      <div id="admin-access" className="console-two-columns admin-access">
        <section className="console-panel"><div className="console-panel-heading"><h2>{lang === "fr" ? "Jetons de connexion" : "Connection tokens"}</h2></div><p className="console-note"><Link href="/admin#admin-access">{lang === "fr" ? "Gérer les accès de l’entreprise" : "Manage organization access"}</Link></p></section>
        <ReadTokens />
      </div>
      <section id="admin-clients">
        <ClientsManager />
      </section>
      <section id="admin-dlp">
        <DlpSettings />
      </section>
      <section id="admin-providers">
        <ProviderCredentials />
      </section>
    </section>
  );
}
