import Link from "next/link";
import { Wordmark, XsomMark } from "@/components/brand";
import { GuardNav } from "@/components/GuardNav";
import { GuardFooter } from "@/components/GuardFooter";
import "@/app/guard-landing.css";
import "@/app/guard-home.css";
import "@/app/guard-footer.css";

const documents = {
  "mentions-legales": {
    title: "Mentions légales",
    sections: [
      ["Éditeur", "xSOM AI Studio est édité par XSOM CONSULTING, société par actions simplifiée au capital de 6 000 €. Siège social : 2 allée Pierre Latécoère, 33120 Arcachon, France. SIREN : 498 029 289. SIRET : 498 029 289 00036. RCS Bordeaux : 498 029 289. TVA intracommunautaire : FR80 498 029 289."],
      ["Publication et contact", "Directeur de la publication : Julian Talou. Contact : julian.talou@xsom.fr. Téléphone : +33 (0)6 23 02 40 31."],
      ["Hébergement", "Le site est hébergé par Vercel Inc., 440 N Barranca Ave #4133, Covina, CA 91723, États-Unis. Téléphone publié par Vercel : +1 559 288 7060. Informations complémentaires : vercel.com/legal."],
      ["Propriété intellectuelle", "Les marques, textes et créations graphiques restent soumis aux droits de leurs titulaires. Les composants open source sont soumis aux licences indiquées dans leurs dépôts respectifs. La présentation d’un outil sur ce site ne modifie pas sa licence."],
    ],
  },
  confidentialite: {
    title: "Politique de confidentialité",
    draft: "Informations à compléter avant publication : durées de conservation, localisation des services et garanties applicables aux éventuels transferts hors Espace économique européen. Cette page ne constitue pas encore une politique finalisée.",
    sections: [
      ["Responsable et périmètre", "XSOM CONSULTING est le responsable des traitements liés à ce site. Contact pour les données personnelles : julian.talou@xsom.fr, ou par courrier au 2 allée Pierre Latécoère, 33120 Arcachon. Cette page distingue la consultation du site, les échanges par email et l’accès aux services avec un compte."],
      ["Consultation du site", "L’hébergement implique le traitement de données techniques de connexion, notamment l’adresse IP et les informations de requête. Elles servent au fonctionnement et à la sécurité du site. Le navigateur mémorise également vos choix de langue et d’affichage. Consultez la page Cookies et préférences pour leur détail."],
      ["Contact", "Si vous nous écrivez, nous recevons votre adresse email et les informations que vous choisissez d’inclure dans votre message afin de répondre à votre demande. Évitez de transmettre des secrets, mots de passe ou données sensibles. Les échanges préparant une prestation relèvent des mesures précontractuelles prises à votre demande ; les autres demandes sont traitées pour notre intérêt légitime à répondre aux sollicitations."],
      ["Comptes et services", "La création d’un compte et la connexion utilisent Supabase pour l’authentification. L’adresse email, les informations du compte et les éléments nécessaires à la session sont traités pour fournir l’accès au service. Les fonctionnalités de la console peuvent également traiter des données d’usage et des événements de sécurité. La consultation du site vitrine ne nécessite pas la création d’un compte."],
      ["Destinataires et conservation", "Les personnes habilitées chez xSOM et les prestataires nécessaires au service peuvent traiter les données correspondant à leurs missions, notamment Vercel pour l’hébergement et Supabase pour l’authentification. Les durées effectives de conservation et de sauvegarde, les autres prestataires de la console et les régions de traitement restent à documenter. Nous ne présentons donc pas ce service comme ne conservant aucune donnée."],
      ["Vos droits", "Selon le traitement et sa base légale, vous pouvez demander l’accès, la rectification, l’effacement, la limitation, l’opposition et la portabilité de vos données. Écrivez à julian.talou@xsom.fr en précisant votre demande. Vous pouvez également saisir la CNIL sur cnil.fr. Les données nécessaires au fonctionnement du compte conditionnent l’accès aux services authentifiés."],
    ],
  },
  cookies: {
    title: "Cookies et préférences",
    sections: [
      ["Langue", "Le cookie xsom_lang mémorise la langue choisie pendant un an. Il permet au serveur d’afficher directement le site dans cette langue."],
      ["Affichage", "La clé xsom-signal-preferences du stockage local conserve vos réglages d’affichage et de réduction des animations dans ce navigateur. Ces préférences restent présentes jusqu’à leur modification ou à l’effacement des données du site."],
      ["Connexion", "Les services authentifiés utilisent des cookies de session pour reconnaître votre connexion et protéger l’accès à votre compte. Leur durée dépend de la configuration du service d’authentification. Ils ne sont pas des cookies publicitaires."],
      ["Vos réglages", "Vous pouvez ajuster l’affichage depuis le footer, changer la langue dans le menu et effacer les cookies et données du site dans les paramètres de votre navigateur. L’effacement peut réinitialiser vos préférences et vous déconnecter. Aucun outil de publicité ou de mesure d’audience n’est intégré dans la version du site examinée pour cette page."],
    ],
  },
  "conditions-utilisation": {
    title: "Conditions d’utilisation",
    sections: [
      ["Objet du site", "xSOM AI Studio présente des outils et des prestations de conseil autour des usages de l’intelligence artificielle et de leur sécurité. Les contenus pédagogiques et les illustrations facilitent la compréhension ; ils ne constituent pas un audit de votre environnement ni une garantie de protection exhaustive."],
      ["Utilisation des services", "Utilisez le site et ses services dans le respect du droit applicable et des droits des tiers. Ne tentez pas d’accéder à des données ou systèmes sans autorisation. Vous êtes responsable des informations que vous transmettez et de la confidentialité de vos identifiants."],
      ["Produits et prestations", "Les logiciels open source sont régis par leurs licences respectives. Les offres payantes, licences, abonnements et missions de conseil font l’objet de documents contractuels précisant leur périmètre, prix, support et conditions applicables avant souscription. Ces conditions d’utilisation du site ne remplacent pas ces contrats et ne constituent pas des conditions générales de vente."],
      ["Disponibilité et liens externes", "Le site peut évoluer ou être interrompu pour maintenance. Les liens vers des sites tiers conduisent vers des services soumis à leurs propres conditions et politiques de confidentialité. Signalez toute erreur ou difficulté à julian.talou@xsom.fr."],
    ],
  },
} as const;

export type LegalDocument = keyof typeof documents;
export function legalTitle(document: LegalDocument) { return documents[document].title; }
export function LegalPage({ document }: { document: LegalDocument }) {
  const copy = documents[document];
  return <main className="guard-landing guard-home">
    <header className="guard-header"><div className="guard-wrap guard-header__inner"><Link href="/" className="brand"><XsomMark /><Wordmark /></Link><GuardNav /></div></header>
    <article className="guard-wrap studio-legal" lang="fr">
      <p className="guard-kicker">xSOM AI Studio · Informations légales</p>
      <h1>{copy.title}</h1><p>Version du 26 septembre 2026 · Document en français</p>
      {"draft" in copy && <p className="studio-legal__draft">{copy.draft}</p>}
      {copy.sections.map(([title, body]) => <section key={title}><h2>{title}</h2><p>{body}</p></section>)}
      <section><h2>Liens utiles</h2><p><a href="mailto:julian.talou@xsom.fr">Contacter xSOM</a> · <a href="https://www.cnil.fr/fr/plaintes">Saisir la CNIL</a> · <a href="https://vercel.com/legal">Informations Vercel</a></p></section>
    </article>
    <GuardFooter />
  </main>;
}
