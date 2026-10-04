"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ConsoleError,
  ConsoleHeader,
  ConsoleSkeleton,
  EmptyState,
} from "@/components/ConsoleUI";
import { apiGet } from "@/lib/client";
import { DeviceCoverage } from "@/components/developer/DeviceCoverage";
import { ExceptionList } from "@/components/developer/ExceptionList";
import { PolicyAssignments } from "@/components/developer/PolicyAssignments";
import { ConsoleIcon } from "@/components/ConsoleIcon";
import { useConsoleRole } from "@/components/AppShell";
import { useWorkspace } from "@/components/WorkspaceProvider";
import { useT } from "@/lib/i18n";

interface Device {
  id: string;
  name: string;
  platform: string;
  extension_version: string;
  mode: string;
  registered_at: string;
  last_seen_at: string;
  revoked_at: string | null;
  gateway_events: number;
  member_label?: string;
  team?: string;
  presence?: "recent" | "stale" | "revoked";
  assigned_policy_id?: string | null;
  assigned_policy_version?: number | null;
  assigned_policy_expires_at?: string | null;
  minimum_runner_version?: string | null;
  posture_received_at?: string | null;
  posture?: {
    outcome?: string;
    posture_reasons?: string[];
    policy_id?: string;
    policy_version?: number;
    runner_version?: string;
    queue_pending?: number;
    dropped?: number;
  } | null;
}
interface AuditEvent {
  id: number;
  device_id: string;
  event_id: string;
  source: "extension" | "gateway";
  received_at: string;
  payload: {
    kind: string;
    assistant: string;
    outcome: string;
    findings: number;
    rules?: string[];
    dropped?: number;
    request_id?: string;
  };
  prev_hash: string;
  entry_hash: string;
}
interface EventPage {
  events: AuditEvent[];
  next_before: number | null;
}
const OUTCOMES: Record<string, string> = {
  clean: "Aucune détection",
  redacted: "Nettoyé → XXX",
  blocked: "Bloqué",
  warned: "Averti",
  passed: "Passé",
  failed: "Échec",
  configured: "Configuré",
  unverified: "Non vérifié",
  upstream_accepted: "Accepté par le fournisseur",
  upstream_rejected: "Refusé par le fournisseur",
};

export type SecretGuardView = "overview" | "devices" | "activity" | "policies";
export function SecretGuardWorkspace({ view }: { view: SecretGuardView }) {
  const { lang } = useT();
  const role = useConsoleRole();
  const { identity } = useWorkspace();
  const preview = identity.preview;
  const tr = (fr: string, en: string) => lang === "fr" ? fr : en;
  const titles = {
    overview: ["Votre équipe, ses protections", "Your team and its protection"],
    devices: ["Postes de l’équipe", "Team workstations"],
    activity: ["Journal des protections", "Protection log"],
    policies: ["Politiques d’équipe", "Team policies"],
  };
  const [devices, setDevices] = useState<Device[]>([]);
  const [events, setEvents] = useState<EventPage>({
    events: [],
    next_before: null,
  });
  const [selected, setSelected] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [integrity, setIntegrity] = useState("");
  const generation = useRef(0);
  const refresh = useCallback(
    async (before?: number) => {
      const run = ++generation.current;
      setLoading(true);
      setError(null);
      const query = new URLSearchParams();
      if (selected) query.set("device_id", selected);
      if (before) query.set("before", String(before));
      try {
        const [inventory, journal] = await Promise.all([
          apiGet<Device[]>("v1/extensions/devices"),
          apiGet<EventPage>(`v1/extensions/events?${query}`),
        ]);
        if (run === generation.current) {
          setDevices(inventory);
          setEvents(journal);
        }
      } catch (err) {
        if (run === generation.current) setError(err);
      } finally {
        if (run === generation.current) setLoading(false);
      }
    },
    [selected],
  );
  useEffect(() => {
    const requestGeneration = generation;
    void refresh();
    const timer = setInterval(() => { if (!document.hidden) void refresh(); }, 30000);
    return () => {
      clearInterval(timer);
      requestGeneration.current++;
    };
  }, [refresh]);
  async function verify() {
    setIntegrity("Vérification en cours…");
    try {
      const result = await apiGet<{ valid: boolean }>("v1/extensions/verify");
      setIntegrity(
        result.valid
          ? "Chaînage du journal cohérent à cet instant. Ce n’est pas une attestation des postes."
          : "ALERTE : rupture du chaînage du journal.",
      );
    } catch {
      setIntegrity("Vérification indisponible. Aucun résultat confirmé.");
    }
  }
  function exportPage() {
    const url = URL.createObjectURL(
      new Blob(
        [
          JSON.stringify(
            {
              scope: "displayed_page_only",
              exported_at: new Date().toISOString(),
              ...events,
            },
            null,
            2,
          ),
        ],
        { type: "application/json" },
      ),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "xsom-extension-audit-page.json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <section className="console-page">
      <ConsoleHeader
        eyebrow="Dev Guard"
        title={titles[view][lang === "fr" ? 0 : 1]}
        description={tr("Le suivi des postes et des assistants IA de votre équipe de développement.", "Monitor your development team’s workstations and AI assistants.")}
        actions={
          <button
            className="btn btn-ghost"
            disabled={loading}
            onClick={() => void refresh()}
          >
            Actualiser
          </button>
        }
      />
      {error != null && (
        <ConsoleError error={error} retry={() => void refresh()} />
      )}
      {loading ? (
        <ConsoleSkeleton rows={4} />
      ) : (
        <>
          {(view === "overview" || view === "policies") && <section className="console-panel">
            <div className="console-panel-heading"><h2>{tr("Réglage sur mesure", "Custom rules")}</h2><Link className="btn btn-ghost" href="/extensions/reglage">{tr("Consulter le réglage", "View custom rules")}</Link></div>
            <p className="console-note">{tr("Les règles de votre entreprise, calibrées et signées par xSOM, sont vérifiées et appliquées localement par les postes à jour.", "Your organization's rules, calibrated and signed by xSOM, are verified and applied locally by up-to-date workstations.")}</p>
          </section>}
          {view === "overview" && <>
            <div className="workspace-secret-stats">
              <div><span>{tr("Postes enregistrés", "Registered workstations")}</span><strong>{error || preview ? "—" : devices.length}</strong><small>{preview ? tr("Inventaire réel non connecté", "Live inventory not connected") : tr("Inventaire de l’entreprise", "Organization inventory")}</small></div>
              <div><span>{tr("Trafic observé", "Observed traffic")}</span><strong>{error || preview ? "—" : devices.filter((d) => d.gateway_events > 0).length}</strong><small>{tr("Postes avec preuve passerelle", "Workstations with gateway evidence")}</small></div>
              <div><span>{tr("Événements chargés", "Loaded events")}</span><strong>{error || preview ? "—" : events.events.length}</strong><small>{tr("Dernière page du journal", "Latest log page")}</small></div>
            </div>
            {!devices.length && !error ? <section className="workspace-empty">
              <ConsoleIcon name="device" /><h2>{preview ? tr("Inventaire réel non connecté", "Live inventory not connected") : tr("Raccordez le premier poste de l’équipe", "Connect your team’s first workstation")}</h2>
              <p>{preview ? tr("Cet aperçu ne peut pas compter les extensions installées sur vos postes. Le suivi réel nécessite le raccordement de l’extension à votre entreprise et de la console à son service.", "This preview cannot count extensions installed on your workstations. Live tracking requires connecting the extension to your organization and the console to its service.") : tr("L’installation de l’extension ne l’inscrit pas automatiquement dans l’entreprise. Raccordez un poste pour retrouver ses événements et appliquer les politiques de votre équipe.", "Installing the extension does not automatically enroll it in the organization. Connect a workstation to view its events and apply team policies.")}</p>
              <Link href="/extensions/setup" className="btn btn-primary">{tr("Raccorder un poste", "Connect a workstation")}<ConsoleIcon name="arrow" /></Link>
            </section> : <><div className="workspace-section-heading"><h2>{tr("État de l’équipe", "Team status")}</h2><Link href="/extensions/devices">{tr("Voir tous les postes", "View all workstations")}</Link></div><DeviceCoverage devices={devices} /></>}
          </>}
          {view === "devices" && <section className="console-panel">
            <div className="console-panel-heading">
              <h2>Postes enregistrés</h2>
              <span className="console-count">{preview || error ? "—" : devices.length}</span>
            </div>
            {!devices.length && !error ? (
              <EmptyState
                title={preview ? "Inventaire réel non connecté" : "Aucun poste enregistré"}
                description={preview ? "Cet aperçu ne consulte pas les installations réelles. Une extension installée sur ce Mac peut donc ne pas être visible ici." : "Le premier poste apparaîtra après son raccordement depuis VS Code à cette entreprise."}
              />
            ) : (
              <ul className="risk-tool-list">
                {devices.map((device) => (
                  <li key={device.id}>
                    <div>
                      <strong>{device.name}</strong>
                      <span>{[device.member_label, device.team].filter(Boolean).join(" · ") || tr("Membre et équipe non renseignés", "Member and team not provided")}</span>
                      <span>
                        {device.platform} · v{device.extension_version} ·{" "}
                        {device.id}
                      </span>
                    </div>
                    <span>
                      {device.revoked_at
                        ? "Accès révoqué"
                        : device.gateway_events > 0
                          ? "Trafic observé"
                          : "Enregistré · trafic non attesté"}
                    </span>
                    <span className="workspace-presence" data-state={device.presence ?? "stale"}>{device.revoked_at ? tr("Révoqué", "Revoked") : device.presence === "recent" ? tr("Contact récent", "Recently seen") : tr("Pas vu récemment", "Not seen recently")}<br />
                      Dernier contact :{" "}
                      {new Date(device.last_seen_at).toLocaleString("fr-FR")}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <p className="console-note">
              Un contact récent n’atteste pas l’interception de tous les
              assistants. Inventaire limité aux 500 postes les plus récemment
              vus.
            </p>
            <DeviceCoverage devices={devices} />
          </section>}
          {view === "policies" && (role === "admin" ? <><PolicyAssignments devices={devices} /><ExceptionList /></> : <p className="console-note">{tr("Seul un administrateur peut publier et attribuer les politiques d’équipe.", "Only an administrator can publish and assign team policies.")}</p>)}
          {view === "activity" && <section className="console-panel">
            <div className="console-panel-heading">
              <h2>Journal des protections</h2>
              <label>
                Poste{" "}
                <select
                  aria-label="Poste"
                  value={selected}
                  onChange={(event) => setSelected(event.target.value)}
                >
                  <option value="">Tous les postes</option>
                  {devices.map((device) => (
                    <option key={device.id} value={device.id}>
                      {device.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="console-actions">
              <button className="btn btn-ghost" onClick={() => void verify()}>
                Vérifier le chaînage
              </button>
              <button
                className="btn btn-ghost"
                disabled={!events.events.length || Boolean(error)}
                onClick={exportPage}
              >
                Exporter cette page
              </button>
            </div>
            <p role="status">{integrity}</p>
            <div style={{ overflowX: "auto" }}>
              <table className="console-table">
                <caption>
                  100 événements maximum par page. Aucun prompt, secret ou
                  empreinte de valeur.
                </caption>
                <thead>
                  <tr>
                    <th>Date serveur</th>
                    <th>Poste</th>
                    <th>Source de preuve</th>
                    <th>Événement</th>
                    <th>Résultat</th>
                    <th>Détections</th>
                  </tr>
                </thead>
                <tbody>
                  {events.events.map((event) => (
                    <tr key={event.id}>
                      <td>
                        {new Date(event.received_at).toLocaleString("fr-FR")}
                      </td>
                      <td>
                        {devices.find((device) => device.id === event.device_id)
                          ?.name ?? event.device_id}
                      </td>
                      <td>
                        {event.source === "gateway"
                          ? "Observé par la passerelle"
                          : "Déclaré par l’extension"}
                      </td>
                      <td>
                        {event.payload.assistant} · {event.payload.kind}
                      </td>
                      <td>
                        {OUTCOMES[event.payload.outcome] ??
                          event.payload.outcome}
                      </td>
                      <td>
                        {event.payload.findings}
                        {event.payload.rules?.length
                          ? ` · ${event.payload.rules.join(", ")}`
                          : ""}
                        {event.payload.dropped
                          ? ` · ${event.payload.dropped} événements perdus localement`
                          : ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!events.events.length && !error && (
              <p className="console-note">
                Aucun événement reçu pour cette sélection.
              </p>
            )}
            {events.next_before && (
              <button
                className="btn btn-ghost"
                onClick={() => void refresh(events.next_before!)}
              >
                Événements plus anciens
              </button>
            )}
            <p className="console-note">
              « Nettoyé » atteste la transformation avant relais, pas la
              réception par Claude. « Accepté par le fournisseur » constate sa
              réponse HTTP, pas la fin de sa génération. L’audit asynchrone peut
              arriver en retard ou signaler des pertes.
            </p>
          </section>}
        </>
      )}
    </section>
  );
}
