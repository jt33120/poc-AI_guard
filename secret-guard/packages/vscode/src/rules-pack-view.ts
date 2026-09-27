// The xSOM custom tuning as the developer sees it: one state, a few words.
// No checkbox and no editable rule: the tuning is a service done with xSOM.

import type { RulesPackRefusal } from "@xsom/developer-guard-runner";
import type { RulesPackSnapshot } from "./rules-pack-sync.js";

export type RulesPackViewState =
  | "none"
  | "active"
  | "expired"
  | "rejected"
  | "no_authority_key"
  | "sync_error";

export type RulesPackTone = "ok" | "info" | "warn" | "danger";

export interface RulesPackView {
  readonly state: RulesPackViewState;
  readonly tone: RulesPackTone;
  /** One line for the status tooltip. */
  readonly line: string;
  /** Title and explanation for the protection centre. */
  readonly title: string;
  readonly detail: string;
  /** Local users only: a discreet way to ask xSOM for a tuning. */
  readonly offerRequest: boolean;
  /** Posture fields (contract §7); never any detected value. */
  readonly packId?: string;
  readonly version?: number;
  readonly digest?: string;
  readonly reason?: "rules_pack_rejected" | "rules_pack_expired";
}

const REFUSALS: Record<RulesPackRefusal | "sync_failed", string> = {
  no_authority_key: "version non officielle",
  malformed_envelope: "format invalide",
  unknown_key: "signataire inconnu",
  invalid_signature: "signature invalide",
  invalid_pack: "réglage incohérent",
  tenant_mismatch: "destiné à une autre organisation",
  tenant_unknown: "poste non enrôlé",
  version_downgrade: "version plus ancienne",
  version_conflict: "version en conflit",
  too_large: "taille excessive",
  unreadable: "fichier illisible",
  sync_failed: "synchronisation impossible",
};

export function refusalLabel(reason: RulesPackRefusal | "sync_failed"): string {
  return REFUSALS[reason];
}

/** « 01/09/2027 », in UTC like the signed timestamp. */
export function shortDate(iso: string): string {
  const [year, month, day] = iso.slice(0, 10).split("-");
  return `${day ?? ""}/${month ?? ""}/${year ?? ""}`;
}

function rules(count: number): string {
  return `${String(count)} règle${count > 1 ? "s" : ""}`;
}

export function rulesPackView(snapshot: RulesPackSnapshot): RulesPackView {
  const { applied, lastSync } = snapshot;
  const lastRefusal =
    lastSync?.outcome === "rejected" || lastSync?.outcome === "error"
      ? lastSync.reason
      : undefined;

  if (applied.status === "applied") {
    const { pack } = applied;
    const identity = {
      packId: pack.packId,
      version: pack.version,
      digest: applied.digest,
    };
    const head = `Réglage xSOM · v${String(pack.version)} · ${rules(pack.detectorCount)}`;
    const date = shortDate(pack.expiresAt);
    if (applied.expired)
      return {
        state: "expired",
        tone: "warn",
        line: `${head} · expiré le ${date}`,
        title: "Réglage sur mesure expiré",
        detail: `Le réglage v${String(pack.version)} a expiré le ${date}. Il reste appliqué : il ne fait qu’ajouter des protections. Contactez xSOM pour le renouveler.`,
        offerRequest: false,
        reason: "rules_pack_expired",
        ...identity,
      };
    // One short line: the validity date, or what went wrong with the last
    // update (the protection centre gives the reason).
    const status =
      lastRefusal === undefined
        ? `jusqu’au ${date}`
        : lastRefusal === "sync_failed"
          ? "hors ligne"
          : "mise à jour refusée";
    return {
      state: "active",
      tone: lastRefusal === undefined ? "ok" : "warn",
      line: `${head} · ${status}`,
      title: "Réglage sur mesure xSOM",
      detail: `${rules(pack.detectorCount)} calibrées et signées par xSOM pour votre organisation, appliquées sur ce poste en plus des règles intégrées. Valable jusqu’au ${date}.${lastRefusal === undefined ? "" : ` Dernière mise à jour non appliquée : ${REFUSALS[lastRefusal]} ; la version vérifiée reste active.`}`,
      offerRequest: false,
      ...(lastSync?.outcome === "rejected"
        ? { reason: "rules_pack_rejected" as const }
        : {}),
      ...identity,
    };
  }

  if (snapshot.authorityKeys === 0)
    return {
      state: "no_authority_key",
      // A pack was served or stored, and this build could not accept it.
      ...(applied.status === "rejected" || lastSync?.outcome === "rejected"
        ? { reason: "rules_pack_rejected" as const }
        : {}),
      tone: "warn",
      line: "Réglage indisponible : version non officielle",
      title: "Réglage sur mesure indisponible",
      detail:
        "Cette version de l’extension ne contient pas la clé d’autorité xSOM : aucun réglage ne peut être vérifié, donc aucun n’est appliqué. Les règles intégrées protègent ce poste. Installez la version officielle.",
      offerRequest: false,
    };

  const refusal =
    applied.status === "rejected"
      ? applied.reason
      : lastSync?.outcome === "rejected"
        ? lastSync.reason
        : undefined;
  if (refusal !== undefined && refusal !== "sync_failed")
    return {
      state: "rejected",
      tone: "danger",
      line: `Réglage refusé : ${REFUSALS[refusal]}`,
      title: "Réglage sur mesure refusé",
      detail: `Le réglage reçu n’a pas été appliqué (${REFUSALS[refusal]}). Les règles intégrées continuent de protéger ce poste. Prévenez votre administrateur xSOM.`,
      offerRequest: false,
      reason: "rules_pack_rejected",
    };

  if (lastSync?.outcome === "error")
    return {
      state: "sync_error",
      tone: "warn",
      line: "Réglage xSOM : synchronisation impossible",
      title: "Réglage sur mesure non synchronisé",
      detail:
        "Le réglage de votre organisation n’a pas pu être téléchargé. Les règles intégrées continuent de protéger ce poste ; nouvelle tentative automatique.",
      offerRequest: false,
    };

  return {
    state: "none",
    tone: "info",
    line: "Aucun réglage sur mesure",
    title: "Aucun réglage sur mesure",
    detail: snapshot.enrolled
      ? "Votre organisation n’a pas encore de réglage xSOM : les règles intégrées protègent ce poste."
      : "Les règles intégrées protègent ce poste. Avec l’édition Équipe, xSOM calibre et signe des règles pour vos propres données : identifiants clients, noms de projets, serveurs internes.",
    offerRequest: !snapshot.enrolled,
  };
}
