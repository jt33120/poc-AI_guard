/**
 * La version que le bouton de téléchargement livre : celle de la dernière release
 * GitHub, puisque le lien pointe sur `releases/latest`. Relue au plus une fois par
 * heure ; si GitHub ne répond pas, ou répond autre chose qu'une release Secret Guard,
 * la page affiche la dernière version connue plutôt qu'un numéro inventé.
 */
export interface SecretGuardRelease {
  readonly version: string;
  readonly notes: string;
}

const RELEASES_API = "https://api.github.com/repos/jt33120/poc-AI_guard/releases/latest";
const KNOWN: SecretGuardRelease = {
  version: "0.6.1",
  notes: "https://github.com/jt33120/poc-AI_guard/releases/tag/secret-guard-v0.6.1",
};

export async function latestSecretGuardRelease(): Promise<SecretGuardRelease> {
  if (process.env.E2E_TEST_MODE === "1") return KNOWN;
  try {
    const response = await fetch(RELEASES_API, {
      headers: { Accept: "application/vnd.github+json" },
      next: { revalidate: 3600 },
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) return KNOWN;
    const body = (await response.json()) as { tag_name?: unknown; html_url?: unknown };
    const tag = typeof body.tag_name === "string" ? /^secret-guard-v(\d+\.\d+\.\d+)$/.exec(body.tag_name) : null;
    const notes = typeof body.html_url === "string" && body.html_url.startsWith("https://github.com/jt33120/poc-AI_guard/releases/") ? body.html_url : null;
    return tag && notes ? { version: tag[1], notes } : KNOWN;
  } catch {
    return KNOWN;
  }
}
