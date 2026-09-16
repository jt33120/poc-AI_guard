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
  upstream_accepted: "Accepté par le fournisseur",
  upstream_rejected: "Refusé par le fournisseur",
};

export default function ExtensionsPage() {
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
    return () => {
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
        eyebrow="11 / EXTENSION VS CODE"
        title="Les postes. Les faits. Les preuves."
        description="Inventaire Secret Guard et audit sans valeurs sensibles. Les déclarations locales restent distinctes des observations de la passerelle."
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
      <section className="console-panel">
        <h2>Raccorder un poste</h2>
        <p>
          Créez un jeton de passerelle dédié, nommé pour ce poste, dans{" "}
          <Link href="/admin#admin-access">Administration → Accès</Link>. Puis
          ouvrez « Secret Guard: Raccorder ce poste à xSOM » dans VS Code.
        </p>
        <p className="console-note">
          Claude conserve sa connexion et son abonnement. Aucun remplacement de
          clé Claude. Seules les nouvelles sessions raccordées passent par le
          nettoyage xSOM. Le prompt original reste visible dans le champ ; il
          transite par votre passerelle, mais n’est pas conservé dans cet audit.
        </p>
      </section>
      {error != null && (
        <ConsoleError error={error} retry={() => void refresh()} />
      )}
      {loading ? (
        <ConsoleSkeleton rows={4} />
      ) : (
        <>
          <section className="console-panel">
            <div className="console-panel-heading">
              <h2>Postes enregistrés</h2>
              <span className="console-count">{devices.length}</span>
            </div>
            {!devices.length && !error ? (
              <EmptyState
                title="Aucun poste enregistré"
                description="Le premier poste apparaîtra après son raccordement depuis VS Code."
              />
            ) : (
              <ul className="risk-tool-list">
                {devices.map((device) => (
                  <li key={device.id}>
                    <div>
                      <strong>{device.name}</strong>
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
                    <span>
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
          </section>
          <section className="console-panel">
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
          </section>
        </>
      )}
    </section>
  );
}
