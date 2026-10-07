/**
 * Un seul déploiement, trois adresses publiques. Chaque adresse montre son site :
 * - `ai.xsom.fr` : le site des offres IA (accueil, produits, menaces) ;
 * - `fleet.xsom.fr` : la page de xSOM Fleet ;
 * - `guard.xsom.fr` : Secret Guard. La console et la liaison des postes y restent
 *   servies, car l'extension publiée propose cette adresse par défaut.
 *
 * Toute autre adresse (localhost, prévisualisations Vercel) sert toutes les pages
 * telles quelles, pour le développement et les tests.
 */

export type Site = "ai" | "fleet" | "guard";

export const SITE_ORIGINS: Record<Site, string> = {
  ai: "https://ai.xsom.fr",
  fleet: "https://fleet.xsom.fr",
  guard: "https://guard.xsom.fr",
};

/** La page servie à la racine de chaque site. */
const SITE_HOME: Record<Site, string> = { ai: "/", fleet: "/fleet", guard: "/secret-guard" };

const LEGAL = ["/mentions-legales", "/confidentialite", "/cookies", "/conditions-utilisation"];

/** Pages publiques propres au site des offres IA. */
const AI_PAGES = ["/produits", "/menaces"];

export type SiteRoute =
  | { kind: "next" }
  | { kind: "rewrite"; path: string }
  | { kind: "redirect"; url: string };

const under = (path: string, prefixes: readonly string[]) =>
  prefixes.some((p) => path === p || path.startsWith(`${p}/`));

/** Le site d'une adresse (en-tête `Host`, port éventuel compris), ou `null`. */
export function siteForHost(hostname: string): Site | null {
  const host = hostname.split(",")[0].trim().toLowerCase().replace(/:\d+$/, "");
  const site = (Object.keys(SITE_ORIGINS) as Site[]).find((s) => host === `${s}.xsom.fr`);
  return site ?? null;
}

/** Le site qui possède une page publique, ou `null` si la page est commune. */
function ownerOf(path: string): Site | null {
  if (path === "/" || under(path, AI_PAGES)) return "ai";
  if (under(path, ["/fleet"])) return "fleet";
  if (under(path, ["/secret-guard"])) return "guard";
  return null;
}

/**
 * Décide du sort d'une requête selon l'adresse. Les pages légales sont communes. Une
 * page publique demandée sur la mauvaise adresse est redirigée vers la bonne, avec sa
 * requête. La racine de `fleet` et de `guard` affiche leur page sans changer d'URL.
 */
export function routeForSite(site: Site | null, path: string, search: string): SiteRoute {
  if (site === null || under(path, LEGAL)) return { kind: "next" };
  if (path === "/" && site !== "ai") return { kind: "rewrite", path: SITE_HOME[site] };
  if (site !== "ai" && path === SITE_HOME[site]) return { kind: "redirect", url: `${SITE_ORIGINS[site]}/${search}` };
  const owner = ownerOf(path);
  if (owner !== null && owner !== site) {
    const target = path === SITE_HOME[owner] ? "/" : path;
    return { kind: "redirect", url: `${SITE_ORIGINS[owner]}${target}${search}` };
  }
  // `fleet` ne sert que sa page : la console, la connexion et le reste vivent sur `ai`.
  // Un fichier public (une image, un média) est servi tel quel.
  const isFile = /\.[a-z0-9]+$/i.test(path);
  if (site === "fleet" && owner === null && !isFile) return { kind: "redirect", url: `${SITE_ORIGINS.ai}${path}${search}` };
  return { kind: "next" };
}
