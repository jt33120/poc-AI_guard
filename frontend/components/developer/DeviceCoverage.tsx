"use client";

type DeviceCoverageProps = {
  devices: readonly {
    id: string;
    name: string;
    extension_version: string;
    revoked_at: string | null;
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
  }[];
};

const REASONS: Record<string, string> = {
  policy_missing: "politique absente",
  policy_expired_or_unknown: "politique expirée ou non vérifiée",
  hook_missing: "hook absent",
  hook_evidence_stale: "aucune invocation récente du hook",
  audit_events_dropped: "événements d’audit perdus",
  audit_queue_saturated: "file d’audit saturée",
  config_invalid: "configuration du hook invalide",
  hook_modified: "hook modifié",
  canary_failed: "test local du hook en échec",
};

function versionParts(value: string): number[] | undefined {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/u.exec(value);
  return match?.slice(1).map(Number);
}

function versionBefore(current: string, minimum: string): boolean {
  const left = versionParts(current);
  const right = versionParts(minimum);
  if (!left || !right) return true;
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index])
      return (left[index] ?? 0) < (right[index] ?? 0);
  }
  return false;
}

function stateFor(device: DeviceCoverageProps["devices"][number]): {
  label: string;
  reasons: string[];
} {
  const reasons = (device.posture?.posture_reasons ?? []).map(
    (reason) => REASONS[reason] ?? reason,
  );
  if (!device.assigned_policy_id) reasons.push("aucune politique attribuée");
  if (
    device.assigned_policy_id &&
    (device.posture?.policy_id !== device.assigned_policy_id ||
      device.posture?.policy_version !== device.assigned_policy_version)
  )
    reasons.push("version de politique en dérive");
  if (
    device.minimum_runner_version &&
    versionBefore(device.extension_version, device.minimum_runner_version)
  )
    reasons.push(
      `extension incompatible, version ${device.minimum_runner_version} requise`,
    );
  if (
    device.assigned_policy_expires_at &&
    Date.parse(device.assigned_policy_expires_at) <= Date.now()
  )
    reasons.push("politique attribuée expirée");
  if (
    !device.posture_received_at ||
    Date.now() - Date.parse(device.posture_received_at) > 15 * 60 * 1000
  )
    reasons.push("preuve de posture périmée");
  if ((device.posture?.queue_pending ?? 0) >= 1000)
    reasons.push("file d’audit saturée");
  if ((device.posture?.dropped ?? 0) > 0)
    reasons.push("événements d’audit perdus");
  const unique = [...new Set(reasons)];
  return {
    label:
      !device.revoked_at &&
      device.posture?.outcome === "configured" &&
      unique.length === 0
        ? "Contrôles récemment vérifiés"
        : "À vérifier",
    reasons: unique,
  };
}

export function DeviceCoverage({ devices }: DeviceCoverageProps) {
  const active = devices.filter((device) => !device.revoked_at).length;
  return (
    <aside aria-label="Couverture des postes">
      <p className="console-note">
        {active} poste{active > 1 ? "s" : ""} actif{active > 1 ? "s" : ""} sur{" "}
        {devices.length}. Une version installée ou un contact récent ne prouve
        pas qu’un assistant donné a été intercepté.
      </p>
      {devices.length > 0 && (
        <ul className="risk-tool-list">
          {devices.map((device) => {
            const state = stateFor(device);
            return (
              <li key={device.id}>
                <div>
                  <strong>{device.name}</strong>
                  <span>{state.label}</span>
                </div>
                <span>
                  {state.reasons.length
                    ? state.reasons.join(" · ")
                    : "Politique, hook et file d’audit cohérents sur la dernière déclaration."}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      <p className="console-note">
        Cette posture est déclarée par l’extension et peut être périmée. Le
        journal distingue les observations de la passerelle.
      </p>
    </aside>
  );
}
