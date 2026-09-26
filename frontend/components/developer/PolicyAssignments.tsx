"use client";

import { useEffect, useMemo, useState } from "react";
import { apiGet, apiSend, apiSendVoid } from "@/lib/client";

type Device = { id: string; name: string; revoked_at: string | null };
type Policy = {
  policy_id: string;
  version: number;
  expires_at: string;
  revoked_at: string | null;
  key_id: string;
};

function template(): string {
  const now = new Date();
  const expires = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  return JSON.stringify(
    {
      schemaVersion: 1,
      policyId: "team-default",
      version: 1,
      issuedAt: new Date(now.getTime() - 60_000).toISOString(),
      expiresAt: expires.toISOString(),
      defaults: { unknownAction: "deny" },
      rules: [
        {
          id: "allow-read",
          effect: "allow",
          match: { actionClasses: ["read"] },
        },
        {
          id: "approval-publish",
          effect: "require_approval",
          match: { actionClasses: ["publish", "deploy"] },
        },
      ],
    },
    null,
    2,
  );
}

export function PolicyAssignments({ devices }: { devices: readonly Device[] }) {
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [body, setBody] = useState(template);
  const [selectedPolicy, setSelectedPolicy] = useState("");
  const [selectedDevice, setSelectedDevice] = useState("");
  const [message, setMessage] = useState("");
  const activeDevices = useMemo(
    () => devices.filter((device) => !device.revoked_at),
    [devices],
  );
  const reload = async () => {
    const list = await apiGet<Policy[]>("v1/developer-policies");
    setPolicies(list.filter((policy) => !policy.revoked_at));
  };
  useEffect(() => {
    void reload().catch(() =>
      setMessage("Lecture des politiques indisponible."),
    );
  }, []);
  async function publish() {
    try {
      const parsed = JSON.parse(body) as { policyId?: unknown };
      if (typeof parsed.policyId !== "string" || !parsed.policyId)
        throw new Error("Identifiant de politique manquant.");
      await apiSend(
        `v1/developer-policies/${encodeURIComponent(parsed.policyId)}`,
        "PUT",
        parsed,
      );
      await reload();
      setSelectedPolicy(parsed.policyId);
      setMessage("Politique signée et publiée.");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "La politique est invalide ou le signeur n’est pas configuré.",
      );
    }
  }
  async function assign() {
    if (!selectedPolicy || !selectedDevice) return;
    try {
      await apiSendVoid(
        `v1/developer-policies/${encodeURIComponent(selectedPolicy)}/assign/${encodeURIComponent(selectedDevice)}`,
        "POST",
      );
      setMessage(
        "Politique attribuée. Le poste la récupérera à son prochain raccordement.",
      );
    } catch {
      setMessage(
        "Attribution impossible : vérifiez vos droits et l’état du poste.",
      );
    }
  }
  return (
    <section
      className="console-panel"
      aria-labelledby="developer-policies-title"
    >
      <div className="console-panel-heading">
        <h2 id="developer-policies-title">Politiques Secret Guard</h2>
        <span className="console-count">{policies.length}</span>
      </div>
      <p className="console-note">
        Une politique est signée côté serveur. Le runner refuse une signature,
        une clé épinglée ou une durée de validité incohérente. Les règles ne
        transportent ni prompt ni secret.
      </p>
      <label>
        Politique JSON{" "}
        <textarea
          aria-label="Politique JSON"
          value={body}
          onChange={(event) => setBody(event.target.value)}
          rows={12}
          style={{ width: "100%", fontFamily: "var(--font-mono, monospace)" }}
        />
      </label>
      <div className="console-actions">
        <button className="btn btn-ghost" onClick={() => void publish()}>
          Publier la politique
        </button>
      </div>
      <div className="console-actions">
        <label>
          Politique{" "}
          <select
            aria-label="Politique à attribuer"
            value={selectedPolicy}
            onChange={(event) => setSelectedPolicy(event.target.value)}
          >
            <option value="">Choisir</option>
            {policies.map((policy) => (
              <option value={policy.policy_id} key={policy.policy_id}>
                {policy.policy_id} · v{policy.version}
              </option>
            ))}
          </select>
        </label>
        <label>
          Poste{" "}
          <select
            aria-label="Poste à attribuer"
            value={selectedDevice}
            onChange={(event) => setSelectedDevice(event.target.value)}
          >
            <option value="">Choisir</option>
            {activeDevices.map((device) => (
              <option value={device.id} key={device.id}>
                {device.name}
              </option>
            ))}
          </select>
        </label>
        <button
          className="btn btn-ghost"
          disabled={!selectedPolicy || !selectedDevice}
          onClick={() => void assign()}
        >
          Attribuer
        </button>
      </div>
      <p role="status">{message}</p>
    </section>
  );
}
