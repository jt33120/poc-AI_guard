"use client";
import type { ReactNode } from "react";
import { useT } from "@/lib/i18n";

export function ConsoleHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description: string;
  actions?: ReactNode;
}) {
  return (
    <header className="console-page-header">
      <div>
        {eyebrow && <p className="console-kicker">{eyebrow}</p>}
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {actions && <div className="console-actions">{actions}</div>}
    </header>
  );
}
export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="console-empty">
      <span className="console-empty-rule" aria-hidden="true" />
      <h2>{title}</h2>
      <p>{description}</p>
      {action}
    </div>
  );
}
export function ConsoleError({
  error,
  retry,
}: {
  error: unknown;
  retry?: () => void;
}) {
  const { lang } = useT();
  const s = String(error);
  const denied = s.includes("403"),
    auth = s.includes("401"),
    conflict = s.includes("409");
  const message =
    lang === "fr"
      ? denied
        ? "Votre rôle ne permet pas cette action."
        : auth
          ? "Votre session a expiré. Reconnectez-vous."
          : conflict
            ? "Cette action a déjà changé d’état. Actualisez la file."
            : "Le service n’a pas répondu. Les données affichées ne sont pas actualisées."
      : denied
        ? "Your role does not allow this action."
        : auth
          ? "Your session expired. Sign in again."
          : conflict
            ? "This action has already changed state. Refresh the queue."
            : "The service did not respond. Displayed data is not up to date.";
  return (
    <div className="console-error" role="alert">
      <div>
        <strong>
          {lang === "fr" ? "Action interrompue" : "Action interrupted"}
        </strong>
        <p>{message}</p>
      </div>
      {retry && (
        <button type="button" className="btn btn-ghost" onClick={retry}>
          {lang === "fr" ? "Réessayer" : "Try again"}
        </button>
      )}
    </div>
  );
}
export function ConsoleSkeleton({ rows = 4 }: { rows?: number }) {
  const { t } = useT();
  return (
    <div
      className="console-skeleton"
      role="status"
      aria-label={t("common.loading")}
    >
      <span className="sr-only">{t("common.loading")}</span>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i}>
          <span />
          <span />
          <span />
        </div>
      ))}
    </div>
  );
}
export function DataPair({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="console-data-pair">
      <dt>{label}</dt>
      <dd>{children ?? "—"}</dd>
    </div>
  );
}
export function localTime(value: string | null | undefined, lang: "fr" | "en") {
  if (!value || Number.isNaN(Date.parse(value))) return "—";
  return new Intl.DateTimeFormat(lang === "fr" ? "fr-FR" : "en-GB", {
    dateStyle: "short",
    timeStyle: "medium",
  }).format(new Date(value));
}
