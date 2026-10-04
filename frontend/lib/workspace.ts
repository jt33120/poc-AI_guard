export type Product = "secret_guard" | "ai_guard";
export type AccessStatus = "active" | "trial" | "internal" | "not_subscribed" | "suspended" | "expired" | "unconfigured";
export interface Subscription {
  product: Product;
  status: AccessStatus;
  edition: string | null;
  seats: number | null;
  ends_at: string | null;
}
export interface Workspace {
  organization: { id: string; name: string };
  subscriptions: Subscription[];
}
export interface ConsoleIdentity {
  email: string | null;
  role: string | null;
  preview: boolean;
}

export const PRODUCTS = {
  secret_guard: { name: "Dev Guard", href: "/extensions", fr: "Postes & équipes de développement", en: "Workstations & development teams" },
  ai_guard: { name: "Agent Guard", href: "/ai-guard", fr: "Agents en production", en: "Production agents" },
} as const;

export function canOpenProduct(subscription: Subscription | undefined): boolean {
  return !!subscription && ["active", "trial", "internal"].includes(subscription.status) &&
    (!subscription.ends_at || Date.parse(subscription.ends_at) > Date.now());
}

export function productForPage(path: string): Product | null {
  if (path === "/extensions" || path.startsWith("/extensions/")) return "secret_guard";
  return ["/ai-guard", "/inspector", "/approvals", "/audit", "/risk", "/costs", "/executive", "/policy", "/onboarding"].some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`),
  ) ? "ai_guard" : null;
}

/** Console-only product boundaries. Execution and safety controls stay in the gateway. */
export function productForApi(path: string, query: URLSearchParams): Product | "either" | null {
  if (/^v1\/(extensions|developer-policies)(\/|$)/.test(path)) return "secret_guard";
  if (/^v1\/approvals(\/|$)/.test(path)) {
    const product = query.get("product");
    return product === "secret_guard" || product === "ai_guard" ? product : "either";
  }
  if (/^v1\/(tools|agents|clients|audit|policy|usage|trust|dlp|servers|read-tokens|credentials|supervision)(\/|$)/.test(path)) return "ai_guard";
  return null;
}

export function accessLabel(status: AccessStatus | undefined, lang: "fr" | "en"): string {
  const labels: Record<AccessStatus, [string, string]> = {
    active: ["Abonnement actif", "Active subscription"],
    trial: ["En découverte", "Trial access"],
    internal: ["Accès interne", "Internal access"],
    not_subscribed: ["Non souscrit", "Not subscribed"],
    suspended: ["Accès suspendu", "Access suspended"],
    expired: ["Accès expiré", "Access expired"],
    unconfigured: ["À configurer", "To be configured"],
  };
  return status ? labels[status][lang === "fr" ? 0 : 1] : (lang === "fr" ? "Statut indisponible" : "Status unavailable");
}

export function isWorkspace(value: unknown): value is Workspace {
  if (!value || typeof value !== "object") return false;
  const data = value as Partial<Workspace>;
  const statuses = ["active", "trial", "internal", "not_subscribed", "suspended", "expired", "unconfigured"];
  return typeof data.organization?.id === "string" && typeof data.organization?.name === "string" &&
    Array.isArray(data.subscriptions) && data.subscriptions.length === 2 &&
    ["secret_guard", "ai_guard"].every((product) => data.subscriptions?.filter((s) => s.product === product).length === 1) &&
    data.subscriptions.every((s) => statuses.includes(s.status) &&
      (s.edition === null || typeof s.edition === "string") &&
      (s.seats === null || (Number.isInteger(s.seats) && s.seats > 0)) &&
      (s.ends_at === null || (typeof s.ends_at === "string" && Number.isFinite(Date.parse(s.ends_at)))));
}
