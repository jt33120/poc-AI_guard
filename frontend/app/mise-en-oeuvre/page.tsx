import Link from "next/link";

import { ShieldMark } from "@/components/brand";
import { LanguageToggle } from "@/lib/i18n";
import { mcpConfig, snippet } from "@/lib/integration";
import { pageMetadata, serverT } from "@/lib/lang";

export function generateMetadata() {
  return pageMetadata("mise.kicker", { descriptionKey: "mise.lede" });
}

const DEMO_MAILTO = "mailto:julian.talou@xsom.fr?subject=xSOM%20AI%20Guard%20%3A%20demo";

/**
 * Les valeurs fictives des extraits publics.
 *
 * Un jeton visible sur une page publique doit **se voir** comme fictif : un
 * paramètre qui ressemble à un vrai jeton finit collé tel quel, et le premier appel
 * échoue sans que personne comprenne pourquoi.
 */
const JETON_FICTIF = "<votre-jeton-de-passerelle>";
const API_FICTIVE = "https://api.votre-deploiement.example";

/** Une voie d'entrée : ce qu'elle garantit, et ce qu'on colle. */
function Voie({
  numero,
  titre,
  garantie,
  corps,
  note,
  code,
  langue,
}: {
  numero: number;
  titre: string;
  garantie: string;
  corps: string;
  note?: string;
  code: string;
  langue: string;
}) {
  const { t } = serverT();
  return (
    <section className="border-t border-white/10 py-10">
      <div className="grid gap-x-6 gap-y-4 sm:grid-cols-[3rem_1fr]">
        <span className="font-mono text-sm text-brand">{String(numero).padStart(2, "0")}</span>
        <div className="min-w-0">
          <h2 className="font-display text-xl font-bold sm:text-2xl">{titre}</h2>
          <p className="mt-1.5 font-mono text-[11px] uppercase tracking-wider text-brand-bright">
            {t("mise.garantie")} : {garantie}
          </p>
          <p className="muted mt-3 max-w-2xl text-sm leading-relaxed">{corps}</p>
          {note && (
            <p className="mt-3 max-w-2xl border-l-2 border-white/20 pl-3 text-sm leading-relaxed text-white/60">
              {note}
            </p>
          )}

          <p className="label mt-6 text-white/40">
            {t("mise.livre")} · {langue}
          </p>
          {/* `overflow-x-auto` plutôt qu'un retour à la ligne : un extrait recassé
              n'est plus copiable, et c'est sa seule fonction. */}
          <pre className="mt-2 overflow-x-auto rounded border border-white/10 bg-black/30 p-4 font-mono text-[11px] leading-relaxed text-white/75">
            {code}
          </pre>
        </div>
      </div>
    </section>
  );
}

/**
 * `/mise-en-oeuvre` (`L9`) — les trois voies, dans l'ordre décroissant de garantie.
 *
 * L'ordre est le propos. Les trois n'offrent pas la même chose, et la différence
 * n'est pas un détail d'intégration : elle décide si une action refusée peut malgré
 * tout avoir lieu. Une page qui les présenterait comme équivalentes vendrait la voie
 * coopérative au prix de la contraignante.
 *
 * Les extraits viennent de `lib/integration.ts`, partagé avec l'assistant
 * d'intégration : ce sont **les mêmes** que ceux qu'un client reçoit après avoir créé
 * son jeton. Une page publique qui enseignerait autre chose enseignerait ce qui ne
 * marche pas — et un test compare les deux rendus pour les mêmes entrées.
 */
export default function MiseEnOeuvrePage() {
  const { t } = serverT();
  return (
    <main className="relative">
      <header className="sticky top-0 z-30 border-b border-white/10 bg-navy/70 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-6">
          <Link href="/" className="flex items-center gap-2.5">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-brand/15 text-brand-bright ring-1 ring-brand/30">
              <ShieldMark className="h-5 w-5" />
            </span>
            <span className="text-[15px] font-bold tracking-tight">
              xSOM <span className="font-medium text-white/50">AI Guard</span>
            </span>
          </Link>
          <div className="flex items-center gap-3">
            <LanguageToggle />
            <a href={DEMO_MAILTO} className="btn btn-primary px-4 py-1.5">
              {t("land.nav.demo")}
            </a>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-5xl px-6 py-16">
        <span className="label text-brand-bright">{t("mise.kicker")}</span>
        <h1 className="mt-2 max-w-3xl font-display text-2xl font-bold sm:text-4xl">
          {t("mise.title")}
        </h1>
        <p className="muted mt-4 max-w-2xl text-base leading-relaxed">{t("mise.lede")}</p>

        <div className="mt-10">
          <Voie
            numero={1}
            titre={t("mise.mcp.t")}
            garantie={t("mise.mcp.g")}
            corps={t("mise.mcp.b")}
            note={t("mise.mcp.note")}
            code={mcpConfig(JETON_FICTIF)}
            langue="JSON"
          />
          <Voie
            numero={2}
            titre={t("mise.http.t")}
            garantie={t("mise.http.g")}
            corps={t("mise.http.b")}
            code={snippet("http", JETON_FICTIF, API_FICTIVE)}
            langue="Python"
          />
          <Voie
            numero={3}
            titre={t("mise.proxy.t")}
            garantie={t("mise.proxy.g")}
            corps={t("mise.proxy.b")}
            code={snippet("openai", JETON_FICTIF, API_FICTIVE)}
            langue="Python"
          />
        </div>

        <div className="border-t border-white/10 pt-8">
          <p className="muted max-w-2xl text-sm leading-relaxed">{t("mise.jeton")}</p>
          <p className="muted mt-3 max-w-2xl text-sm leading-relaxed">{t("mise.identique")}</p>
        </div>
      </div>
    </main>
  );
}
