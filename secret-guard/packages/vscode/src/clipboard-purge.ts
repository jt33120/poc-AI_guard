import { redactAndRescan } from "@xsom/secret-guard-core";

// Metadata and the sanitized text only: the original content and the detected
// values never leave this function.
export type PurgeOutcome =
  | { readonly status: "empty" }
  | { readonly status: "clean" }
  | {
      readonly status: "purged";
      readonly content: string;
      readonly findings: number;
    }
  | {
      readonly status: "failed";
      readonly reason: "incomplete" | "residual";
      readonly findings: number;
    };

export interface PurgeFeedback {
  readonly text: string;
  readonly failed: boolean;
  readonly message?: string;
  // A check found secrets that a purge would remove cleanly.
  readonly offerPurge?: boolean;
}

/**
 * The clipboard as it may be pasted to an assistant. Only a complete scan whose
 * redacted text rescans clean produces a replacement; anything else leaves the
 * clipboard untouched and reports why.
 */
export function purgeClipboardText(content: string): PurgeOutcome {
  if (content.trim() === "") return { status: "empty" };
  const {
    initial,
    content: redacted,
    final,
  } = redactAndRescan({
    content,
    sourceKind: "clipboard",
  });
  const findings = initial.findings.length;
  if (!initial.complete)
    return { status: "failed", reason: "incomplete", findings };
  if (initial.decision === "ALLOW") return { status: "clean" };
  if (
    final.complete &&
    final.decision === "ALLOW" &&
    final.findings.length === 0
  )
    return { status: "purged", content: redacted, findings };
  return { status: "failed", reason: "residual", findings };
}

function detected(count: number): string {
  return count > 1
    ? `${String(count)} secrets détectés`
    : `${String(count)} secret détecté`;
}

function secrets(count: number): string {
  return count > 1
    ? `${String(count)} secrets masqués`
    : `${String(count)} secret masqué`;
}

const FAILURE_MESSAGES: Record<"incomplete" | "residual", string> = {
  incomplete:
    "Secret Guard n’a pas pu analyser tout le presse-papiers (plus de 1 Mio ou texte illisible). Il n’a pas été modifié : ne le collez pas tel quel.",
  residual:
    "Un secret subsiste après nettoyage. Le presse-papiers n’a pas été modifié : retirez la valeur à la main avant de le coller.",
};

export const PURGE_UNAVAILABLE: PurgeFeedback = {
  text: "$(error) Presse-papiers non expurgé",
  failed: true,
  message:
    "Le presse-papiers n’a pas pu être lu ou remplacé. Ne le collez pas tel quel.",
};

export function purgeFeedback(outcome: PurgeOutcome): PurgeFeedback {
  switch (outcome.status) {
    case "empty":
      return {
        text: "$(info) Presse-papiers vide ou non textuel",
        failed: false,
      };
    case "clean":
      return {
        text: "$(check) Presse-papiers sûr · aucun secret",
        failed: false,
      };
    case "purged":
      return {
        text: `$(check) Presse-papiers expurgé · ${secrets(outcome.findings)}`,
        failed: false,
      };
    case "failed":
      return {
        text: "$(error) Presse-papiers non expurgé",
        failed: true,
        message: FAILURE_MESSAGES[outcome.reason],
      };
  }
}

export const CHECK_UNAVAILABLE: PurgeFeedback = {
  text: "$(error) Presse-papiers non vérifié",
  failed: true,
  message:
    "Le presse-papiers n’a pas pu être lu. Ne le collez pas sans l’avoir vérifié.",
};

/** The same outcome, reported by a check that leaves the clipboard as is. */
export function checkFeedback(outcome: PurgeOutcome): PurgeFeedback {
  switch (outcome.status) {
    case "empty":
    case "clean":
      return purgeFeedback(outcome);
    case "purged":
      return {
        text: `$(warning) Presse-papiers · ${detected(outcome.findings)}`,
        failed: true,
        message: `Le presse-papiers contient ${detected(outcome.findings)}. Ne le collez pas tel quel : Expurger le remplace par une version masquée.`,
        offerPurge: true,
      };
    case "failed":
      return outcome.reason === "incomplete"
        ? {
            text: "$(error) Presse-papiers non vérifié en entier",
            failed: true,
            message:
              "Secret Guard n’a pas pu analyser tout le presse-papiers (plus de 1 Mio ou texte illisible). Ne le collez pas tel quel.",
          }
        : {
            text: `$(warning) Presse-papiers · ${detected(outcome.findings)}`,
            failed: true,
            message:
              "Le presse-papiers contient un secret que Secret Guard ne sait pas masquer. Retirez la valeur à la main avant de le coller.",
          };
  }
}
