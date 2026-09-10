"use client";
import Link from "next/link";
import { useConsoleRole } from "@/components/AppShell";
import { ConsoleHeader, DataPair } from "@/components/ConsoleUI";
import { SignalPreferences } from "@/design-system/react";
import { LanguageToggle, useT } from "@/lib/i18n";
export default function SettingsPage() {
  const { lang } = useT();
  const role = useConsoleRole();
  const tr = (fr: string, en: string) => (lang === "fr" ? fr : en);
  return (
    <section className="console-page">
      <ConsoleHeader
        eyebrow="PREFERENCES"
        title={tr("Votre poste de travail.", "Your workspace.")}
        description={tr(
          "Contraste, langue, mouvement. Vos préférences restent sur cet appareil.",
          "Contrast, language, motion. Your preferences stay on this device.",
        )}
      />
      <div className="console-two-columns">
        <section className="console-panel settings-panel">
          <div className="console-panel-heading">
            <h2>{tr("Apparence & mouvement", "Appearance & motion")}</h2>
          </div>
          <SignalPreferences lang={lang} />
          <p className="console-note">
            {tr(
              "La préférence système de réduction des animations est toujours respectée.",
              "Your system’s reduced-motion preference is always respected.",
            )}
          </p>
        </section>
        <section className="console-panel settings-panel">
          <div className="console-panel-heading">
            <h2>{tr("Langue de la console", "Console language")}</h2>
          </div>
          <LanguageToggle />
          <p className="console-note">
            {tr(
              "Français et anglais, même information.",
              "French and English, the same information.",
            )}
          </p>
        </section>
      </div>
      <section className="console-panel">
        <div className="console-panel-heading">
          <h2>{tr("Session & accès", "Session & access")}</h2>
        </div>
        <dl className="console-data-grid">
          <DataPair label={tr("Rôle", "Role")}>
            {role ?? tr("Non attribué", "Unassigned")}
          </DataPair>
          <DataPair label={tr("Isolation", "Isolation")}>Tenant / RLS</DataPair>
        </dl>
        <p className="console-note">
          {tr(
            "L’identité et les droits sont contrôlés côté serveur. Aucun jeton d’accès n’est enregistré dans les préférences.",
            "Identity and permissions are controlled by the server. Preferences do not store access tokens.",
          )}
        </p>
        {role === "admin" && (
          <Link className="btn btn-ghost" href="/admin">
            {tr(
              "Gérer les accès et fournisseurs",
              "Manage access and providers",
            )}{" "}
            ↗
          </Link>
        )}
      </section>
    </section>
  );
}
