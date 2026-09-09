/**
 * Le porteur des diagrammes de menace (`L4`).
 *
 * Chaque menace a son schéma : pas une icône, le **mécanisme**. Par où l'attaque
 * entre, ce qui circule, ce qui casse. Autant de figures distinctes que de menaces,
 * bâties sur une grammaire unique pour qu'elles forment un système, pas une collection.
 *
 * **Pourquoi le SVG est incorporé et non servi en `<img>`.** Un fichier séparé est
 * isolé du document : il ne voit aucune variable CSS de la page. Or ces figures doivent
 * basculer avec la bande, sombre ou claire, en lisant `--diag-*`. Un fichier séparé
 * aurait figé ses couleurs, et la section change justement de fond.
 *
 * **Pourquoi les marqueurs sont déclarés à part.** Une flèche SVG passe par un
 * `<marker id="...">`, et un identifiant doit être unique dans le document. Un `<defs>`
 * répété dans chaque `<svg>` produirait autant de doublons d'identifiant, du HTML
 * invalide, et un rendu qui dépend de l'ordre du document. `DiagrammeDefs` les pose
 * **une fois** pour la page ; les figures s'y réfèrent par `url(#fx)`.
 *
 * **Sur `dangerouslySetInnerHTML`.** Le corps vient de `lib/schemas.ts`, un fichier du
 * dépôt, jamais d'une entrée de visiteur. Et il n'est pas cru sur parole :
 * `tests/test_schemas_menaces.py` analyse chaque figure et fait échouer la
 * construction si elle contient autre chose que la grammaire autorisée, une couleur
 * écrite en dur, un script, ou une géométrie qui sort du cadre. Le garde est le
 * contrat ; ce composant ne fait que rendre ce que le garde a laissé passer.
 */

/**
 * Les deux têtes de flèche, posées une seule fois pour toute la page.
 *
 * `overflow-hidden` et une taille nulle plutôt que `display:none` : un `<defs>` dans
 * un conteneur non rendu est ignoré par certains moteurs, et les flèches
 * disparaîtraient sans qu'aucun test ne le voie.
 */
export function DiagrammeDefs() {
  return (
    <svg
      width="0"
      height="0"
      aria-hidden="true"
      focusable="false"
      className="absolute"
    >
      <defs>
        <marker
          id="fx"
          viewBox="0 0 8 8"
          refX="7"
          refY="4"
          markerWidth="5"
          markerHeight="5"
          orient="auto-start-reverse"
        >
          <path className="mk" d="M0 1 L7 4 L0 7 z" />
        </marker>
        <marker
          id="ax"
          viewBox="0 0 8 8"
          refX="7"
          refY="4"
          markerWidth="5.5"
          markerHeight="5.5"
          orient="auto-start-reverse"
        >
          <path className="mk mk--hot" d="M0 1 L7 4 L0 7 z" />
        </marker>
      </defs>
    </svg>
  );
}

/**
 * Une figure.
 *
 * `role="img"` et non un `<figure>` : le nom accessible est le `<title>` que la figure
 * porte en première position, et un lecteur d'écran annonce alors une image nommée
 * plutôt qu'un groupe de formes anonymes.
 */
export function Diagramme({
  corps,
  ouvert = false,
}: {
  corps: string;
  ouvert?: boolean;
}) {
  return (
    <svg
      viewBox="0 0 200 112"
      className={ouvert ? "diag diag--grand" : "diag"}
      role="img"
      preserveAspectRatio="xMidYMid meet"
      dangerouslySetInnerHTML={{ __html: corps }}
    />
  );
}
