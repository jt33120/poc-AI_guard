/**
 * Les diagrammes de menace, un par rang du classement (`L4`).
 *
 * Chaque valeur est le contenu INTÉRIEUR d'un `<svg viewBox="0 0 200 112">` que
 * `components/Diagramme.tsx` fournit. La figure montre le **mécanisme** de la menace :
 * par où l'attaque entre, ce qui circule, ce qui casse. Ce n'est pas une icône de
 * catégorie, et c'est toute la différence entre « il y a un danger dans les données »
 * et « un document lu par l'agent porte des ordres cachés qu'il exécute ».
 *
 * **La grammaire est petite exprès.** Neuf classes, une liste d'éléments, un cadre
 * fixe. Vingt-trois figures dessinées séparément ne forment un système que si elles
 * parlent la même langue ; un vocabulaire libre aurait donné vingt-trois styles.
 * `tests/test_schemas_menaces.py` la fait respecter, et c'est ce garde qui autorise le
 * rendu en ligne : aucune couleur écrite en dur, aucune géométrie hors cadre, aucune
 * étiquette qui en recouvre une autre, aucun script.
 *
 * **Pourquoi aucune figure n'écrit sa couleur.** C'est le défaut qui ne se voit pas :
 * une figure teintée en dur est parfaite sur la bande où on l'a dessinée et devient
 * illisible sur l'autre. La couleur vient des classes, donc des jetons, donc du
 * contexte — la section a déjà basculé une fois de sombre à clair.
 *
 * Ces figures ont été dessinées puis reprises : la première passe s'est fait refuser
 * vingt lignes sur vingt-trois, et pas sur des détails. Le contrôle du rang 1 relevait
 * que le dessin « annonce un même canal mais fait arriver l'injection sur un fil
 * séparé », soit l'exact inverse de la menace. Un SVG valide peut raconter le
 * contraire de ce qu'il illustre, et rien d'automatique ne le voit.
 */

export const SCHEMAS: Record<number, string> = {
  1: `
    <title>Un ordre caché dans une page lue emprunte le même canal que vos ordres et s'exécute.</title>
    <rect class="d" x="56" y="44" width="20" height="28" rx="2"/>
    <rect class="n" x="6" y="46" width="44" height="24" rx="2"/>
    <rect class="n n--hot" x="92" y="46" width="44" height="24" rx="2"/>
    <rect class="n" x="150" y="46" width="44" height="24" rx="2"/>
    <rect class="n n--hot" x="40" y="82" width="52" height="24" rx="2"/>
    <line class="f" x1="50" y1="58" x2="66" y2="58"/>
    <path class="a a-move" d="M66 82 L66 62" marker-end="url(#ax)"/>
    <line class="a" x1="66" y1="58" x2="90" y2="58" marker-end="url(#ax)"/>
    <line class="a" x1="136" y1="58" x2="148" y2="58" marker-end="url(#ax)"/>
    <text class="t t--hot" x="66" y="39" text-anchor="middle">même canal</text>
    <text class="t" x="28" y="61" text-anchor="middle">Vous</text>
    <text class="t t--hot" x="114" y="61" text-anchor="middle">Agent</text>
    <text class="t" x="172" y="61" text-anchor="middle">Outils</text>
    <text class="t t--hot" x="66" y="97" text-anchor="middle">Page web</text>
  `,
  2: `
    <title>L'agent garde des droits inutiles à sa tâche : son dérapage les atteint tous.</title>
    <rect class="d" x="98" y="40" width="100" height="36" rx="2"/>
    <rect class="n" x="4" y="46" width="36" height="24" rx="2"/>
    <text class="t" x="22" y="61" text-anchor="middle">Agent</text>
    <line class="f" x1="40" y1="58" x2="52" y2="58" marker-end="url(#fx)"/>
    <rect class="n" x="54" y="46" width="40" height="24" rx="2"/>
    <text class="t" x="74" y="61" text-anchor="middle">Lecture</text>
    <rect class="n n--hot" x="102" y="46" width="44" height="24" rx="2"/>
    <text class="t t--hot" x="124" y="61" text-anchor="middle">Effacer</text>
    <rect class="n n--hot" x="150" y="46" width="44" height="24" rx="2"/>
    <text class="t t--hot" x="172" y="61" text-anchor="middle">Virement</text>
    <path class="a a-move" d="M22 46 L22 26 L172 26 L172 38" marker-end="url(#ax)"/>
    <text class="t" x="74" y="84" text-anchor="middle">besoin réel</text>
    <text class="t" x="148" y="84" text-anchor="middle">droits accordés</text>
  `,
  3: `
    <title>L'accès direct est bloqué au périmètre ; l'agent détourné le franchit.</title>
    <rect class="d" x="124" y="8" width="70" height="96" rx="3"/>
    <text class="t" x="159" y="20" text-anchor="middle">Périmètre</text>
    <rect class="n" x="6" y="46" width="52" height="24" rx="2"/>
    <text class="t" x="32" y="61" text-anchor="middle">Attaquant</text>
    <rect class="n n--hot" x="72" y="46" width="46" height="24" rx="2"/>
    <text class="t t--hot" x="95" y="61" text-anchor="middle">Agent</text>
    <rect class="n" x="140" y="46" width="48" height="24" rx="2"/>
    <text class="t" x="164" y="61" text-anchor="middle">Fonds</text>
    <line class="a a-move" x1="58" y1="58" x2="70" y2="58" marker-end="url(#ax)"/>
    <line class="f" x1="118" y1="58" x2="138" y2="58" marker-end="url(#fx)"/>
    <text class="t" x="129" y="40" text-anchor="middle">appel autorisé</text>
    <path class="a" d="M32 70 L32 92 L120 92" marker-end="url(#ax)"/>
    <line class="x" x1="124" y1="84" x2="124" y2="100"/>
    <text class="t t--hot" x="120" y="87" text-anchor="end">accès bloqué</text>
  `,
  4: `
    <title>Une donnée interne collée dans un chatbot public se disperse et ne revient jamais.</title>
    <rect class="d" x="6" y="32" width="64" height="46" rx="2"/>
    <text class="t" x="10" y="43" text-anchor="start">Interne</text>
    <rect class="n" x="12" y="46" width="52" height="24" rx="2"/>
    <text class="t" x="38" y="61" text-anchor="middle">Données</text>
    <path class="a a-move" d="M52 46 L52 24 L106 24 L106 46" marker-end="url(#ax)"/>
    <text class="t t--hot" x="79" y="20" text-anchor="middle">copier-coller</text>
    <rect class="n n--hot" x="80" y="46" width="52" height="24" rx="2"/>
    <text class="t t--hot" x="106" y="61" text-anchor="middle">Chatbot</text>
    <line class="f" x1="132" y1="58" x2="145" y2="58" marker-end="url(#fx)"/>
    <path class="f" d="M132 58 L140 58 L140 94 L145 94" marker-end="url(#fx)"/>
    <rect class="n" x="146" y="46" width="46" height="24" rx="2"/>
    <text class="t" x="169" y="61" text-anchor="middle">Tiers</text>
    <rect class="n" x="146" y="82" width="46" height="24" rx="2"/>
    <text class="t" x="169" y="97" text-anchor="middle">Journaux</text>
  `,
  5: `
    <title>Sans filtre, le texte du modèle franchit la frontière et devient commande exécutée.</title>
    <rect class="n" x="6" y="46" width="44" height="24" rx="2"/>
    <text class="t" x="28" y="61" text-anchor="middle">Modèle</text>
    <path class="f" d="M50 58 L88 58"/>
    <text class="t" x="69" y="53" text-anchor="middle">texte</text>
    <line class="d" x1="88" y1="20" x2="88" y2="96"/>
    <line class="x" x1="88" y1="48" x2="88" y2="68"/>
    <text class="t t--hot" x="124" y="52" text-anchor="middle">commande</text>
    <path class="a" d="M88 58 L100 58 L100 26 L148 26" marker-end="url(#ax)"/>
    <path class="a a-move" d="M88 58 L148 58" marker-end="url(#ax)"/>
    <path class="a" d="M88 58 L100 58 L100 90 L148 90" marker-end="url(#ax)"/>
    <rect class="n n--hot" x="148" y="14" width="46" height="24" rx="2"/>
    <text class="t t--hot" x="171" y="29" text-anchor="middle">Base SQL</text>
    <rect class="n n--hot" x="148" y="46" width="46" height="24" rx="2"/>
    <text class="t t--hot" x="171" y="61" text-anchor="middle">Terminal</text>
    <rect class="n n--hot" x="148" y="78" width="46" height="24" rx="2"/>
    <text class="t t--hot" x="171" y="93" text-anchor="middle">Page web</text>
  `,
  6: `
    <title>La fiche validée est réécrite hors contrôle : le modèle lit la v2 et rappelle l'outil.</title>
    <rect class="d" x="68" y="34" width="64" height="40" rx="2"/>
    <text class="t" x="100" y="43" text-anchor="middle">contrôle</text>
    <rect class="n" x="6" y="46" width="52" height="24" rx="2"/>
    <text class="t" x="32" y="61" text-anchor="middle">Serveur</text>
    <rect class="n" x="72" y="46" width="56" height="24" rx="2"/>
    <text class="t" x="100" y="61" text-anchor="middle">v1 validée</text>
    <rect class="n" x="150" y="46" width="44" height="24" rx="2"/>
    <text class="t" x="172" y="61" text-anchor="middle">Modèle</text>
    <rect class="n n--hot" x="72" y="84" width="56" height="24" rx="2"/>
    <text class="t t--hot" x="100" y="99" text-anchor="middle">v2 piégée</text>
    <line class="f" x1="58" y1="58" x2="71" y2="58" marker-end="url(#fx)"/>
    <line class="f" x1="128" y1="58" x2="141" y2="58" marker-end="url(#fx)"/>
    <line class="x" x1="143" y1="51" x2="143" y2="65"/>
    <line class="a a-move" x1="100" y1="70" x2="100" y2="84" marker-end="url(#ax)"/>
    <path class="a" d="M128 96 L164 96 L164 70" marker-end="url(#ax)"/>
    <path class="a" d="M180 46 L180 26 L32 26 L32 46" marker-end="url(#ax)"/>
  `,
  7: `
    <title>L'agent agit sous l'identité de l'humain : le journal ne distingue plus qui a agi.</title>
    <rect class="d" x="4" y="40" width="104" height="36" rx="3"/>
    <rect class="n" x="8" y="46" width="44" height="24" rx="2"/>
    <text class="t" x="30" y="61" text-anchor="middle">Humain</text>
    <rect class="n" x="60" y="46" width="44" height="24" rx="2"/>
    <text class="t" x="82" y="61" text-anchor="middle">Agent</text>
    <text class="t" x="56" y="84" text-anchor="middle">même identité</text>
    <line class="a a-move" x1="108" y1="58" x2="122" y2="58" marker-end="url(#ax)"/>
    <rect class="d" x="124" y="24" width="70" height="68" rx="3"/>
    <text class="t" x="159" y="20" text-anchor="middle">Journal</text>
    <rect class="n n--hot" x="130" y="30" width="58" height="24" rx="2"/>
    <text class="t t--hot" x="159" y="45" text-anchor="middle">moi@corp</text>
    <rect class="n n--hot" x="130" y="62" width="58" height="24" rx="2"/>
    <text class="t t--hot" x="159" y="77" text-anchor="middle">moi@corp</text>
    <polyline class="f" points="186,24 186,10 56,10 56,40" marker-end="url(#fx)"/>
    <line class="x" x1="112" y1="1" x2="112" y2="19"/>
  `,
  8: `
    <title>Dans une seule invite, l'ordre de l'attaquant efface les règles et pilote les actions.</title>
    <rect class="n" x="6" y="46" width="44" height="24" rx="2"/>
    <text class="t" x="28" y="61" text-anchor="middle">Règles</text>
    <line class="a" x1="50" y1="58" x2="64" y2="58" marker-end="url(#ax)"/>
    <line class="x" x1="57" y1="48" x2="57" y2="68"/>
    <rect class="n n--hot" x="64" y="46" width="48" height="24" rx="2"/>
    <text class="t t--hot" x="88" y="61" text-anchor="middle">Modèle</text>
    <line class="a" x1="112" y1="58" x2="128" y2="58" marker-end="url(#ax)"/>
    <rect class="n n--hot" x="128" y="46" width="48" height="24" rx="2"/>
    <text class="t t--hot" x="152" y="61" text-anchor="middle">Actions</text>
    <rect class="n n--hot" x="64" y="82" width="48" height="24" rx="2"/>
    <text class="t t--hot" x="88" y="97" text-anchor="middle">Attaquant</text>
    <line class="a a-move" x1="88" y1="82" x2="88" y2="70" marker-end="url(#ax)"/>
    <text class="t t--hot" x="156" y="83" text-anchor="middle">Invite unique</text>
  `,
  9: `
    <title>Une invite pousse le modèle à livrer ses consignes et la clé écrite dedans.</title>
    <rect class="d" x="60" y="38" width="76" height="44" rx="2"/>
    <text class="t" x="98" y="33" text-anchor="middle">périmètre</text>
    <rect class="n" x="10" y="46" width="44" height="24" rx="2"/>
    <text class="t" x="32" y="61" text-anchor="middle">Invite</text>
    <line class="a" x1="54" y1="58" x2="76" y2="58" marker-end="url(#ax)"/>
    <rect class="n n--hot" x="76" y="46" width="48" height="24" rx="2"/>
    <text class="t" x="100" y="61" text-anchor="middle">Modèle</text>
    <text class="t t--hot" x="94" y="80" text-anchor="end">clé API</text>
    <path class="a a-move" d="M100 70 L100 98 L136 98" marker-end="url(#ax)"/>
    <text class="t t--hot" x="94" y="94" text-anchor="end">le secret sort</text>
    <rect class="n" x="136" y="86" width="48" height="24" rx="2"/>
    <text class="t" x="160" y="101" text-anchor="middle">Tiers</text>
  `,
  10: `
    <title>Un clic accepte la suggestion sans relecture : la faille passe en production.</title>
    <rect class="n" x="6" y="46" width="44" height="24" rx="2"/>
    <text class="t" x="28" y="61" text-anchor="middle">Copilot</text>
    <text class="t" x="28" y="80" text-anchor="middle">50/jour</text>
    <rect class="n" x="37" y="14" width="52" height="24" rx="2"/>
    <text class="t" x="63" y="29" text-anchor="middle">relecture</text>
    <line class="f" x1="63" y1="56" x2="63" y2="40" marker-end="url(#fx)"/>
    <line class="x" x1="53" y1="48" x2="73" y2="48"/>
    <line class="f" x1="50" y1="58" x2="74" y2="58" marker-end="url(#fx)"/>
    <rect class="n n--hot" x="76" y="46" width="48" height="24" rx="2"/>
    <text class="t t--hot" x="100" y="61" text-anchor="middle">Un clic</text>
    <line class="a a-move" x1="124" y1="58" x2="146" y2="58" marker-end="url(#ax)"/>
    <text class="t t--hot" x="135" y="80" text-anchor="middle">faille</text>
    <rect class="n n--hot" x="148" y="46" width="46" height="24" rx="2"/>
    <text class="t t--hot" x="171" y="61" text-anchor="middle">En prod</text>
  `,
  11: `
    <title>Le faux file jusqu'à la décision sans qu'aucun contrôle ne se déclenche.</title>
    <rect class="n n--hot" x="4" y="46" width="68" height="24" rx="2"/>
    <text class="t t--hot" x="38" y="61" text-anchor="middle">Hallucination</text>
    <rect class="n n--hot" x="142" y="46" width="52" height="24" rx="2"/>
    <text class="t t--hot" x="168" y="61" text-anchor="middle">Décision</text>
    <line class="a a-move" x1="74" y1="58" x2="140" y2="58" marker-end="url(#ax)"/>
    <text class="t t--hot" x="107" y="40" text-anchor="middle">aucun contrôle</text>
    <polyline class="f" points="90,58 90,78 50,78 50,84"/>
    <line class="x" x1="82" y1="68" x2="98" y2="68"/>
    <polyline class="f" points="122,58 122,78 150,78 150,84"/>
    <line class="x" x1="114" y1="68" x2="130" y2="68"/>
    <rect class="n" x="16" y="84" width="68" height="24" rx="2"/>
    <text class="t" x="50" y="100" text-anchor="middle">Vérification</text>
    <rect class="n" x="128" y="84" width="44" height="24" rx="2"/>
    <text class="t" x="150" y="100" text-anchor="middle">Source</text>
  `,
  12: `
    <title>La fiche annoncée n'est qu'une part du paquet livré : le reste entre non déclaré.</title>
    <rect class="n" x="6" y="46" width="44" height="24" rx="2"/>
    <text class="t" x="28" y="61" text-anchor="middle">Dépôt</text>
    <line class="f" x1="50" y1="58" x2="60" y2="58" marker-end="url(#fx)"/>
    <rect class="d" x="62" y="40" width="72" height="40" rx="2"/>
    <text class="t" x="98" y="36" text-anchor="middle">paquet livré</text>
    <rect class="n" x="68" y="46" width="44" height="24" rx="2"/>
    <text class="t" x="90" y="61" text-anchor="middle">la fiche</text>
    <polyline class="f" points="28,70 28,88 98,88 98,82" marker-end="url(#fx)"/>
    <text class="t t--hot" x="98" y="77" text-anchor="middle">non déclaré</text>
    <line class="a a-move" x1="136" y1="58" x2="150" y2="58" marker-end="url(#ax)"/>
    <line class="x" x1="143" y1="49" x2="143" y2="67"/>
    <rect class="n n--hot" x="152" y="46" width="42" height="24" rx="2"/>
    <text class="t t--hot" x="173" y="61" text-anchor="middle">Agent</text>
  `,
  13: `
    <title>Une seule note empoisonnée écrite dans la mémoire, relue à chaque réveil de session.</title>
    <rect class="d" x="22" y="40" width="156" height="36" rx="2"/>
    <rect class="n n--hot" x="20" y="8" width="60" height="24" rx="2"/>
    <text class="t t--hot" x="50" y="23" text-anchor="middle">note piégée</text>
    <line class="a" x1="50" y1="32" x2="50" y2="46" marker-end="url(#ax)"/>
    <rect class="n n--hot" x="28" y="46" width="44" height="24" rx="2"/>
    <text class="t t--hot" x="50" y="61" text-anchor="middle">Jour 1</text>
    <rect class="n" x="78" y="46" width="44" height="24" rx="2"/>
    <text class="t" x="100" y="61" text-anchor="middle">Jour 2</text>
    <rect class="n" x="128" y="46" width="44" height="24" rx="2"/>
    <text class="t" x="150" y="61" text-anchor="middle">Jour 30</text>
    <rect class="n n--hot" x="40" y="84" width="120" height="24" rx="2"/>
    <text class="t t--hot" x="100" y="99" text-anchor="middle">Mémoire gardée</text>
    <line class="f" x1="50" y1="70" x2="50" y2="84" marker-end="url(#fx)"/>
    <line class="a" x1="100" y1="84" x2="100" y2="70" marker-end="url(#ax)"/>
    <line class="a a-move" x1="150" y1="84" x2="150" y2="70" marker-end="url(#ax)"/>
  `,
  14: `
    <title>Une boucle agent-modèle sans frein relance sans fin et franchit le plafond de coût.</title>
    <rect class="n" x="24" y="46" width="48" height="24" rx="2"/>
    <text class="t" x="48" y="61" text-anchor="middle">Agent</text>
    <path class="f" d="M48 46 V36 H116 V46" marker-end="url(#fx)"/>
    <rect class="n n--hot" x="92" y="46" width="48" height="24" rx="2"/>
    <text class="t t--hot" x="116" y="61" text-anchor="middle">Modèle</text>
    <path class="a" d="M116 70 V80 H48 V70" marker-end="url(#ax)"/>
    <text class="t t--hot" x="82" y="94" text-anchor="middle">relance sans fin</text>
    <line class="d" x1="170" y1="34" x2="170" y2="82"/>
    <text class="t" x="170" y="28" text-anchor="middle">plafond</text>
    <line class="a a-move" x1="140" y1="58" x2="182" y2="58" marker-end="url(#ax)"/>
    <text class="t t--hot" x="155" y="52" text-anchor="middle">coût</text>
  `,
  15: `
    <title>Un fait truqué glissé parmi les sources dort dans le modèle et fausse la réponse.</title>
    <rect class="n" x="14" y="14" width="48" height="24" rx="2"/>
    <text class="t" x="38" y="30" text-anchor="middle">Sources</text>
    <rect class="n" x="14" y="46" width="48" height="24" rx="2"/>
    <text class="t" x="38" y="61" text-anchor="middle">Corpus</text>
    <rect class="n n--hot" x="76" y="46" width="48" height="24" rx="2"/>
    <text class="t" x="92" y="61" text-anchor="middle">Modèle</text>
    <rect class="n" x="140" y="46" width="48" height="24" rx="2"/>
    <line class="f" x1="26" y1="38" x2="26" y2="44" marker-end="url(#fx)"/>
    <line class="f" x1="38" y1="38" x2="38" y2="44" marker-end="url(#fx)"/>
    <line class="a" x1="50" y1="38" x2="50" y2="44" marker-end="url(#ax)"/>
    <line class="a a-move" x1="62" y1="58" x2="72" y2="58" marker-end="url(#ax)"/>
    <circle class="a" cx="113" cy="58" r="4"/>
    <line class="d" x1="132" y1="44" x2="132" y2="72"/>
    <text class="t" x="132" y="40" text-anchor="middle">plus tard</text>
    <line class="a" x1="124" y1="58" x2="136" y2="58" marker-end="url(#ax)"/>
    <text class="t t--hot" x="69" y="80" text-anchor="middle">fait truqué</text>
    <text class="t t--hot" x="164" y="80" text-anchor="middle">Réponse fausse</text>
  `,
  16: `
    <title>Index vectoriel partagé : la requête de B, sans filtre de tenant, lit la partition de A.</title>
    <text class="t" x="157" y="8" text-anchor="middle">Index vectoriel</text>
    <rect class="d" x="122" y="12" width="70" height="64" rx="2"/>
    <rect class="n n--hot" x="128" y="16" width="58" height="24" rx="2"/>
    <text class="t t--hot" x="157" y="32" text-anchor="middle">Tenant A</text>
    <rect class="n" x="128" y="46" width="58" height="24" rx="2"/>
    <text class="t" x="157" y="61" text-anchor="middle">Tenant B</text>
    <rect class="n" x="6" y="46" width="48" height="24" rx="2"/>
    <text class="t" x="30" y="61" text-anchor="middle">Client B</text>
    <rect class="n" x="64" y="46" width="48" height="24" rx="2"/>
    <text class="t" x="88" y="61" text-anchor="middle">Requête</text>
    <text class="t t--hot" x="88" y="80" text-anchor="middle">sans filtre</text>
    <line class="f" x1="54" y1="58" x2="62" y2="58" marker-end="url(#fx)"/>
    <line class="f" x1="112" y1="58" x2="126" y2="58" marker-end="url(#fx)"/>
    <line class="a" x1="168" y1="50" x2="168" y2="32" marker-end="url(#ax)"/>
    <line class="x" x1="158" y1="43" x2="178" y2="43"/>
    <path class="a a-move" d="M128 28 L30 28 L30 44" marker-end="url(#ax)"/>
  `,
  17: `
    <title>Le mandat n'est vérifié qu'au premier agent : la suite agit sans donneur d'ordre.</title>
    <text class="t" x="57" y="36" text-anchor="middle">mandat vérifié</text>
    <rect class="d" x="4" y="40" width="106" height="36" rx="2"/>
    <rect class="n" x="8" y="46" width="44" height="24" rx="2"/>
    <text class="t" x="30" y="61" text-anchor="middle">Humain</text>
    <line class="f" x1="52" y1="58" x2="60" y2="58" marker-end="url(#fx)"/>
    <rect class="n" x="62" y="46" width="44" height="24" rx="2"/>
    <text class="t" x="84" y="61" text-anchor="middle">Agent 1</text>
    <line class="a" x1="106" y1="58" x2="137" y2="58" marker-end="url(#ax)"/>
    <rect class="n n--hot" x="140" y="46" width="44" height="24" rx="2"/>
    <text class="t t--hot" x="162" y="61" text-anchor="middle">Agent n</text>
    <path class="a a-move" d="M162 70 L162 88 L124 88" marker-end="url(#ax)"/>
    <line class="x" x1="120" y1="79" x2="120" y2="97"/>
    <text class="t t--hot" x="150" y="106" text-anchor="middle">au nom de qui ?</text>
  `,
  18: `
    <title>Nourri de votre projet et d'un collègue, le mail ciblé franchit le filtre humain.</title>
    <rect class="n" x="8" y="8" width="48" height="24" rx="2"/>
    <text class="t" x="32" y="25" text-anchor="middle">projet</text>
    <rect class="n" x="8" y="80" width="48" height="24" rx="2"/>
    <text class="t" x="32" y="97" text-anchor="middle">collègue</text>
    <line class="f" x1="32" y1="32" x2="32" y2="46" marker-end="url(#fx)"/>
    <line class="f" x1="32" y1="80" x2="32" y2="70" marker-end="url(#fx)"/>
    <rect class="n" x="8" y="46" width="52" height="24" rx="2"/>
    <text class="t" x="34" y="61" text-anchor="middle">attaquant</text>
    <line class="d" x1="128" y1="16" x2="128" y2="96"/>
    <path class="a" d="M48 46 V34 H124" marker-end="url(#ax)"/>
    <text class="t" x="88" y="29" text-anchor="middle">générique</text>
    <line class="x" x1="128" y1="27" x2="128" y2="41"/>
    <line class="a a-move" x1="60" y1="58" x2="146" y2="58" marker-end="url(#ax)"/>
    <rect class="n n--hot" x="146" y="46" width="46" height="24" rx="2"/>
    <text class="t t--hot" x="169" y="61" text-anchor="middle">vous</text>
    <text class="t" x="128" y="105" text-anchor="middle">filtre humain</text>
  `,
  19: `
    <title>Un attaquant clone la voix du dirigeant ; le contre-appel n'a pas lieu.</title>
    <rect class="n" x="76" y="8" width="48" height="24" rx="2"/>
    <text class="t" x="100" y="23" text-anchor="middle">Dirigeant</text>
    <path class="a a-move" d="M76 20 H30 V44" marker-end="url(#ax)"/>
    <text class="t t--hot" x="40" y="16" text-anchor="middle">voix clonée</text>
    <line class="d" x1="100" y1="46" x2="100" y2="32"/>
    <line class="x" x1="90" y1="39" x2="110" y2="39"/>
    <text class="t t--hot" x="112" y="42" text-anchor="start">contre-appel</text>
    <rect class="n n--hot" x="6" y="46" width="48" height="24" rx="2"/>
    <text class="t t--hot" x="30" y="61" text-anchor="middle">Attaquant</text>
    <line class="a" x1="54" y1="58" x2="72" y2="58" marker-end="url(#ax)"/>
    <rect class="n" x="76" y="46" width="48" height="24" rx="2"/>
    <text class="t" x="100" y="61" text-anchor="middle">Comptable</text>
    <line class="f" x1="124" y1="58" x2="136" y2="58" marker-end="url(#fx)"/>
    <rect class="n n--hot" x="140" y="46" width="48" height="24" rx="2"/>
    <text class="t t--hot" x="164" y="61" text-anchor="middle">Virement</text>
  `,
  20: `
    <title>Même consigne : le modèle passe de v1 à v2 sans signal ; l'attendu cède à la dérive.</title>
    <line class="d" x1="8" y1="39" x2="186" y2="39"/>
    <rect class="n" x="8" y="8" width="50" height="24" rx="2"/>
    <text class="t" x="33" y="23" text-anchor="middle">Consigne</text>
    <line class="f" x1="58" y1="20" x2="68" y2="20" marker-end="url(#fx)"/>
    <rect class="n" x="70" y="8" width="56" height="24" rx="2"/>
    <text class="t" x="98" y="23" text-anchor="middle">Modèle v1</text>
    <line class="f" x1="126" y1="20" x2="136" y2="20" marker-end="url(#fx)"/>
    <line class="x" x1="131" y1="13" x2="131" y2="27"/>
    <rect class="n" x="138" y="8" width="48" height="24" rx="2"/>
    <text class="t" x="162" y="23" text-anchor="middle">Attendu</text>
    <line class="a a-move" x1="98" y1="32" x2="98" y2="44" marker-end="url(#ax)"/>
    <rect class="n" x="8" y="46" width="50" height="24" rx="2"/>
    <text class="t" x="33" y="61" text-anchor="middle">Consigne</text>
    <line class="f" x1="58" y1="58" x2="68" y2="58" marker-end="url(#fx)"/>
    <rect class="n n--hot" x="70" y="46" width="56" height="24" rx="2"/>
    <text class="t t--hot" x="98" y="61" text-anchor="middle">Modèle v2</text>
    <line class="a" x1="126" y1="58" x2="136" y2="58" marker-end="url(#ax)"/>
    <rect class="n n--hot" x="138" y="46" width="48" height="24" rx="2"/>
    <text class="t t--hot" x="162" y="61" text-anchor="middle">Dérive</text>
  `,
  21: `
    <title>Interrogé des milliers de fois, le modèle livre de quoi entraîner une copie.</title>
    <rect class="n" x="6" y="46" width="48" height="24" rx="2"/>
    <rect class="n n--hot" x="80" y="46" width="40" height="24" rx="2"/>
    <rect class="n n--hot" x="148" y="46" width="44" height="24" rx="2"/>
    <text class="t" x="30" y="61" text-anchor="middle">Attaquant</text>
    <text class="t t--hot" x="100" y="61" text-anchor="middle">Modèle</text>
    <text class="t t--hot" x="170" y="61" text-anchor="middle">Copie</text>
    <line class="a" x1="56" y1="51" x2="78" y2="51" marker-end="url(#ax)"/>
    <line class="a" x1="56" y1="58" x2="78" y2="58" marker-end="url(#ax)"/>
    <line class="a" x1="56" y1="65" x2="78" y2="65" marker-end="url(#ax)"/>
    <text class="t t--hot" x="67" y="42" text-anchor="middle">10 000 appels</text>
    <path class="f" d="M100 70 L100 82 L40 82 L40 70" marker-end="url(#fx)"/>
    <path class="a a-move" d="M18 70 L18 98 L170 98 L170 70" marker-end="url(#ax)"/>
    <text class="t t--hot" x="94" y="94" text-anchor="middle">réentraînement</text>
  `,
  22: `
    <title>Le moteur IA réécrit le code à chaque diffusion : aucune signature connue ne colle.</title>
    <rect class="n n--hot" x="6" y="46" width="48" height="24" rx="2"/>
    <text class="t t--hot" x="30" y="61" text-anchor="middle">Moteur IA</text>
    <text class="t t--hot" x="30" y="32" text-anchor="middle">réécrit ×3</text>
    <rect class="n" x="66" y="10" width="38" height="24" rx="2"/>
    <text class="t" x="85" y="25" text-anchor="middle">v1</text>
    <rect class="n" x="66" y="46" width="38" height="24" rx="2"/>
    <text class="t" x="85" y="61" text-anchor="middle">v2</text>
    <rect class="n" x="66" y="82" width="38" height="24" rx="2"/>
    <text class="t" x="85" y="97" text-anchor="middle">v3</text>
    <rect class="n" x="142" y="46" width="52" height="24" rx="2"/>
    <text class="t" x="168" y="61" text-anchor="middle">Signatures</text>
    <path class="a" d="M54 58 L60 58 L60 22 L64 22" marker-end="url(#ax)"/>
    <path class="a" d="M54 58 L60 58 L60 94 L64 94" marker-end="url(#ax)"/>
    <line class="a a-move" x1="54" y1="58" x2="64" y2="58" marker-end="url(#ax)"/>
    <line class="a" x1="104" y1="22" x2="188" y2="22" marker-end="url(#ax)"/>
    <line class="a" x1="104" y1="58" x2="133" y2="58" marker-end="url(#ax)"/>
    <line class="a" x1="104" y1="94" x2="188" y2="94" marker-end="url(#ax)"/>
    <line class="x" x1="136" y1="47" x2="136" y2="69"/>
  `,
  23: `
    <title>Deux entrées quasi identiques, deux verdicts opposés : l'évasion adversariale.</title>
    <rect class="n" x="6" y="12" width="38" height="24" rx="2"/>
    <text class="t" x="25" y="27" text-anchor="middle">Entrée</text>
    <rect class="n" x="6" y="80" width="38" height="24" rx="2"/>
    <text class="t" x="25" y="95" text-anchor="middle">Copie</text>
    <rect class="n" x="64" y="46" width="38" height="24" rx="2"/>
    <text class="t" x="83" y="61" text-anchor="middle">Modèle</text>
    <rect class="n n--hot" x="134" y="12" width="60" height="24" rx="2"/>
    <text class="t t--hot" x="164" y="27" text-anchor="middle">Sans danger</text>
    <rect class="n" x="134" y="80" width="60" height="24" rx="2"/>
    <text class="t" x="164" y="95" text-anchor="middle">Dangereux</text>
    <line class="f" x1="44" y1="24" x2="62" y2="50" marker-end="url(#fx)"/>
    <line class="f" x1="44" y1="92" x2="62" y2="66" marker-end="url(#fx)"/>
    <line class="f" x1="102" y1="48" x2="132" y2="90" marker-end="url(#fx)"/>
    <line class="f" x1="102" y1="68" x2="132" y2="26" marker-end="url(#fx)"/>
    <line class="d" x1="164" y1="38" x2="164" y2="78"/>
    <line class="x" x1="154" y1="58" x2="174" y2="58"/>
    <line class="a a-move" x1="16" y1="38" x2="16" y2="78" marker-end="url(#ax)"/>
    <text class="t t--hot" x="22" y="61" text-anchor="start">+ bruit</text>
  `,
};
