/**
 * Le texte des deux écrans « Règles sur mesure » : la lecture du client et l'atelier de
 * l'opérateur xSOM. Les messages d'erreur traduisent les codes du contrat
 * (`secret-guard/contracts/RULES-PACK.md` §2 et §3) en français simple ; un code inconnu
 * reste affiché tel quel plutôt que d'être passé sous silence.
 */

import { XSOM_CONTACT_EMAIL } from "@/components/guard-copy";
import type { Lang } from "@/lib/strings";

import type { Action, Category, DeviceState, PackError } from "./types";

const FR = {
  tenant: {
    eyebrow: "11 / EXTENSION VS CODE · RÉGLAGE SUR MESURE",
    title: "Réglage sur mesure",
    description:
      "Des règles calibrées par xSOM sur vos propres données et signées, que les postes Secret Guard Grand Compte compatibles vérifient puis appliquent hors ligne. Vous les lisez ; xSOM les ajuste à votre demande.",
    back: "← Postes et journal",
    refresh: "Actualiser",
    ask: "Demander un ajustement à xSOM",
    askFirst: "Demander un réglage à xSOM",
    operatorLink: "Atelier opérateur xSOM →",
    emptyTitle: "Aucun réglage sur mesure pour l’instant",
    emptyBody:
      "Le réglage fait partie de Secret Guard Grand Compte : xSOM calibre des détecteurs sur vos identifiants clients, noms de projets et formats internes, et les signe ; un poste en Secret Guard 0.7 ou plus récent les applique sans réseau. Les règles intégrées restent actives dans tous les cas.",
    status: "État du réglage",
    version: "Version",
    validity: "Valide jusqu’au",
    issuer: "Émis et signé par",
    digest: "Empreinte du paquet",
    key: "Clé d’autorité",
    published: "Publié le",
    expired: "Expiré : un poste l’applique encore et le signale",
    revoked: "Retiré de la distribution",
    active: "En distribution",
    chainOk: "Historique des publications chaîné et intact.",
    chainBroken: "ALERTE : l’historique des publications ne se vérifie plus.",
    signatureNote:
      "Un poste n’accepte que la clé d’autorité xSOM intégrée à son extension : un paquet modifié ou signé ailleurs y est refusé.",
    coverage: "Postes",
    upToDate: "à jour",
    behind: "en retard",
    refused: "refusé",
    coverageLine: "{up} / {total} postes à jour",
    coverageNone:
      "Aucun poste enregistré. Les postes récupèrent le réglage à leur prochaine synchronisation.",
    coverageNote:
      "Déclaré par l’extension : « à jour » signifie que le poste rapporte l’empreinte de la version publiée. Un poste dont l’extension ne prend pas encore en charge le réglage sur mesure reste « en retard ».",
    applied: "Appliqué : v{v}",
    notApplied: "Aucune version rapportée",
    expiredOnDevice: "signalé expiré",
    detectors: "Détecteurs",
    detectorsNote:
      "Un réglage n’ajoute que des protections : il ne désactive ni n’affaiblit aucune règle intégrée.",
    colLabel: "Détecteur",
    colCategory: "Catégorie",
    colAction: "Action",
    colMatch: "Reconnaissance",
    termsDetail: "{n} terme(s) confidentiel(s), jamais transmis en clair",
    patternHidden: "Motif réservé aux administrateurs",
    caseInsensitive: "sans casse",
    entropy: "entropie ≥ {v}",
    context: "près de : {k} (± {w} caractères)",
    tests: "{p} test(s) positif(s) et {n} négatif(s) vérifiés avant signature",
    history: "Historique",
    historyPublished: "Version {v} publiée",
    historyRevoked: "Version {v} retirée",
    mailSubject: "Secret Guard Grand Compte · ajustement du réglage sur mesure",
    mailBody:
      "Bonjour,\n\nNous souhaitons ajuster notre réglage sur mesure{version}.\n\nDétecteur concerné :\nCe qui devrait être détecté (exemple synthétique, jamais une vraie donnée) :\nCe qui ne devrait pas l’être :\n\nMerci.",
  },
  operator: {
    eyebrow: "XSOM · ATELIER DES RÈGLES",
    title: "Composer, éprouver, signer",
    description:
      "Réservé aux opérateurs xSOM. Les termes saisis en clair servent au calcul des empreintes puis sont oubliés ; le texte d’essai n’est ni conservé ni journalisé.",
    forbiddenTitle: "Réservé aux opérateurs xSOM",
    forbiddenBody:
      "Le réglage sur mesure est une prestation xSOM : il est composé et signé par xSOM. Un administrateur client le consulte depuis Extension VS Code → Réglage sur mesure.",
    tenant: "Client",
    chooseTenant: "Choisir un client",
    noTenants: "Aucun client.",
    current: "Version publiée :",
    none: "aucune",
    signingMissing:
      "Clé de signature xSOM absente sur ce serveur : l’essai fonctionne, la publication est fermée.",
    packId: "Identifiant du paquet",
    validity: "Validité (jours)",
    detectors: "Détecteurs",
    addPattern: "Ajouter un motif",
    addTerms: "Ajouter des termes",
    remove: "Retirer",
    id: "Identifiant",
    label: "Libellé affiché",
    category: "Catégorie",
    action: "Action",
    pattern: "Motif",
    patternHelp:
      "Sous-ensemble sûr : littéraux, classes […], \\d \\w \\s, groupes (?:…), quantificateurs bornés {n,m} ou ?. Au moins trois caractères fixes, ou un contexte.",
    caseInsensitive: "Ignorer la casse",
    entropy: "Entropie minimale (bits par caractère)",
    terms: "Termes confidentiels, un par ligne",
    termsHelp: "Jamais conservés : seules leurs empreintes salées sont signées.",
    termsKeep: "Laisser vide pour conserver les {n} terme(s) déjà publiés.",
    keywords: "Mots-clés de contexte (séparés par des virgules)",
    window: "Fenêtre (caractères)",
    tests: "Tests du paquet",
    positives: "Doit être détecté",
    negatives: "Ne doit rien déclencher",
    addPositive: "Ajouter un positif",
    addNegative: "Ajouter un négatif",
    testDetector: "Détecteur attendu",
    testText: "Texte synthétique",
    sample: "Essai libre",
    sampleHelp: "Texte synthétique, jamais conservé. Les détections s’affichent en direct.",
    checking: "Vérification…",
    valid: "Paquet valide : prêt à signer en version {v}.",
    detections: "{n} détection(s) sur l’essai",
    truncated: "Seules les 1 000 premières détections sont affichées.",
    noDetection: "Aucune détection sur l’essai.",
    publish: "Signer et publier la version {v}",
    confirmTitle: "Signer la version {v} pour {tenant} ?",
    confirmBody:
      "La signature est définitive et tracée. Les postes du client récupèrent cette version à leur prochaine synchronisation ; les termes saisis seront effacés de ce formulaire.",
    confirm: "Signer et publier",
    cancel: "Annuler",
    publishing: "Signature…",
    published: "Version {v} signée et publiée pour {tenant} · empreinte {d}",
    conflict: "Une autre version a été publiée entre-temps. Rechargez le client.",
    unavailable: "Publication indisponible : clé de signature ou moteur de vérification absent.",
    rejected: "La plateforme a refusé de signer ce paquet. Relancez l’essai.",
    malformed:
      "Composition mal formée : identifiants en minuscules (a-z, 0-9, . _ -), libellés remplis, mots-clés simples.",
    failed: "Le service n’a pas répondu. Rien n’a été publié.",
    rateLimited: "Trop d’essais en une minute : nouvel essai automatique dans quelques secondes.",
    incomplete: "À compléter : {fields}.",
    removeDetector: "Retirer le détecteur {n}",
    removeTest: "Retirer le test {n}",
    coverage: "{up} / {total} postes à jour · {behind} en retard · {refused} refusé(s)",
  },
  categories: {
    credential: "Identifiant d’accès",
    customer_data: "Donnée client",
    personal_data: "Donnée personnelle",
    internal_infra: "Infrastructure interne",
    project: "Projet confidentiel",
  } satisfies Record<Category, string>,
  actions: { block: "Bloquer", warn: "Avertir" } satisfies Record<Action, string>,
  states: {
    up_to_date: "À jour",
    behind: "En retard",
    refused: "Refusé par le poste",
  } satisfies Record<DeviceState, string>,
  types: { pattern: "Motif", terms: "Termes" },
  fields: {
    id: "identifiant",
    label: "libellé",
    pattern: "motif",
    keywords: "mots-clés",
    window: "fenêtre",
    entropy: "entropie",
  },
  codes: {
    schema: "Le paquet ne respecte pas le format du contrat.",
    duplicate_detector: "Deux détecteurs portent le même identifiant.",
    validity_window: "La date d’expiration doit suivre la date d’émission.",
    too_many_digests: "Trop d’empreintes : 20 000 termes au plus sur l’ensemble du paquet.",
    invalid_pattern: "Le motif du détecteur « {d} » est refusé : {r}",
    unknown_test_detector: "Un test positif vise un détecteur qui n’existe pas.",
    missing_positive: "Le détecteur « {d} » n’a aucun test positif.",
    positive_not_detected: "Le test positif n° {t} n’est pas détecté par « {d} ».",
    negative_detected: "Le test négatif n° {t} déclenche « {d} ».",
    term_empty: "Un terme de « {d} » ne contient aucune lettre ni aucun chiffre.",
    term_too_many_words: "Un terme de « {d} » dépasse quatre mots.",
    terms_required: "Saisissez les termes de « {d} » : aucune version publiée ne les porte.",
    budget_exceeded:
      "La vérification a dépassé son budget de temps : simplifiez les motifs (quantificateurs successifs qui se recouvrent).",
    engine_busy: "Le moteur de vérification est occupé. Réessayez.",
    engine_failed: "Le moteur de vérification a échoué. Rien n’a été signé.",
    sample_too_large: "L’essai dépasse 20 000 caractères.",
    test_reveals_term:
      "Le test positif n° {t} contient un terme confidentiel de « {d} » : un positif est signé en clair, retirez-le.",
    unassigned_character:
      "Un texte contient un caractère Unicode que la plateforme ne sait pas encore lire comme le poste.",
    pack_id_mismatch: "Ce client a déjà un paquet sous un autre identifiant.",
    negative_reveals_term:
      "Le test négatif n° {t} contient un terme confidentiel de « {d} » : il serait signé en clair, retirez-le.",
    field_reveals_term:
      "Un libellé, un mot-clé ou le motif du détecteur « {d} » contient un terme confidentiel : il serait signé en clair.",
    too_complex:
      "Le motif de « {d} » enchaîne trop de répétitions qui se disputent les mêmes caractères : il ralentirait chaque analyse sur le poste.",
    pattern_too_slow:
      "Le motif de « {d} » est trop lent sur un texte d’épreuve : simplifiez ses répétitions.",
  },
  reasons: {
    length: "plus de 256 caractères.",
    invalid_character: "caractère hors ASCII imprimable (accent, tabulation…).",
    unbounded_quantifier: "répétition sans borne (*, + ou {n,}) : écrivez {n,m}.",
    bad_quantifier: "borne de répétition invalide (1 à 64, sans zéro initial).",
    nested_repetition: "un groupe répété ne peut contenir ni répétition ni alternative.",
    dot_not_allowed: "le point « . » n’est pas autorisé : utilisez une classe.",
    anchor_not_allowed: "les ancres ^ et $ ne sont pas autorisées.",
    group_not_allowed: "seuls les groupes (?:…) sont autorisés.",
    bad_escape: "échappement non autorisé (seuls \\d \\w \\s et les métacaractères).",
    negated_class: "les classes niées [^…] ne sont pas autorisées.",
    empty_class: "classe vide.",
    bad_class_char: "dans une classe, échappez [ ^ et - hors intervalle.",
    bad_range: "intervalle décroissant dans une classe.",
    unbalanced_class: "crochet non fermé.",
    unbalanced_group: "parenthèse non appariée.",
    stacked_quantifier: "deux quantificateurs se suivent.",
    dangling_quantifier: "quantificateur sans élément à répéter.",
    empty_alternative: "alternative vide.",
    too_deep: "plus de quatre groupes imbriqués.",
    too_short: "une correspondance ferait moins de trois caractères.",
    too_long: "une correspondance pourrait dépasser 256 caractères.",
    no_anchor: "il faut trois caractères fixes consécutifs, ou un contexte.",
    bad_literal: "« ] » ou « } » isolé : échappez-le.",
  },
};

type RulesCopy = typeof FR;

const EN: RulesCopy = {
  tenant: {
    eyebrow: "11 / VS CODE EXTENSION · CUSTOM TUNING",
    title: "Custom tuning",
    description:
      "Rules calibrated by xSOM on your own data and signed, which compatible Secret Guard Enterprise workstations verify and then apply offline. You read them; xSOM adjusts them on request.",
    back: "← Workstations and log",
    refresh: "Refresh",
    ask: "Ask xSOM for an adjustment",
    askFirst: "Ask xSOM for a tuning",
    operatorLink: "xSOM operator workshop →",
    emptyTitle: "No custom tuning yet",
    emptyBody:
      "Tuning is part of Secret Guard Enterprise: xSOM calibrates detectors on your customer identifiers, project names and internal formats, and signs them; a workstation on Secret Guard 0.7 or later applies them without network access. Built-in rules stay active either way.",
    status: "Tuning status",
    version: "Version",
    validity: "Valid until",
    issuer: "Issued and signed by",
    digest: "Pack digest",
    key: "Authority key",
    published: "Published",
    expired: "Expired: a workstation still applies it and reports it",
    revoked: "Withdrawn from distribution",
    active: "Distributed",
    chainOk: "Publication history is chained and intact.",
    chainBroken: "ALERT: the publication history no longer verifies.",
    signatureNote:
      "A workstation only accepts the xSOM authority key built into its extension: a modified pack, or one signed elsewhere, is rejected there.",
    coverage: "Workstations",
    upToDate: "up to date",
    behind: "behind",
    refused: "rejected",
    coverageLine: "{up} / {total} workstations up to date",
    coverageNone:
      "No registered workstation. Workstations fetch the tuning at their next synchronisation.",
    coverageNote:
      "Declared by the extension: “up to date” means the workstation reports the digest of the published version. A workstation whose extension does not support custom tuning yet stays “behind”.",
    applied: "Applied: v{v}",
    notApplied: "No version reported",
    expiredOnDevice: "reported expired",
    detectors: "Detectors",
    detectorsNote:
      "A tuning only adds protections: it never disables or weakens a built-in rule.",
    colLabel: "Detector",
    colCategory: "Category",
    colAction: "Action",
    colMatch: "Recognition",
    termsDetail: "{n} confidential term(s), never sent in clear",
    patternHidden: "Pattern visible to administrators",
    caseInsensitive: "case-insensitive",
    entropy: "entropy ≥ {v}",
    context: "near: {k} (± {w} characters)",
    tests: "{p} positive and {n} negative test(s) verified before signing",
    history: "History",
    historyPublished: "Version {v} published",
    historyRevoked: "Version {v} withdrawn",
    mailSubject: "Secret Guard Enterprise · custom tuning adjustment",
    mailBody:
      "Hello,\n\nWe would like to adjust our custom tuning{version}.\n\nDetector concerned:\nWhat should be detected (synthetic example, never real data):\nWhat should not:\n\nThank you.",
  },
  operator: {
    eyebrow: "XSOM · RULES WORKSHOP",
    title: "Compose, test, sign",
    description:
      "xSOM operators only. Terms typed in clear are used to compute digests and then forgotten; the test text is neither stored nor logged.",
    forbiddenTitle: "xSOM operators only",
    forbiddenBody:
      "Custom tuning is an xSOM service: xSOM composes and signs it. A customer administrator reads it under VS Code extension → Custom tuning.",
    tenant: "Customer",
    chooseTenant: "Choose a customer",
    noTenants: "No customer.",
    current: "Published version:",
    none: "none",
    signingMissing:
      "No xSOM signing key on this server: testing works, publishing is closed.",
    packId: "Pack identifier",
    validity: "Validity (days)",
    detectors: "Detectors",
    addPattern: "Add a pattern",
    addTerms: "Add terms",
    remove: "Remove",
    id: "Identifier",
    label: "Displayed label",
    category: "Category",
    action: "Action",
    pattern: "Pattern",
    patternHelp:
      "Safe subset: literals, classes […], \\d \\w \\s, groups (?:…), bounded {n,m} or ? quantifiers. At least three fixed characters, or a context.",
    caseInsensitive: "Ignore case",
    entropy: "Minimum entropy (bits per character)",
    terms: "Confidential terms, one per line",
    termsHelp: "Never stored: only their salted digests are signed.",
    termsKeep: "Leave empty to keep the {n} term(s) already published.",
    keywords: "Context keywords (comma separated)",
    window: "Window (characters)",
    tests: "Pack tests",
    positives: "Must be detected",
    negatives: "Must trigger nothing",
    addPositive: "Add a positive",
    addNegative: "Add a negative",
    testDetector: "Expected detector",
    testText: "Synthetic text",
    sample: "Free test",
    sampleHelp: "Synthetic text, never stored. Detections show live.",
    checking: "Checking…",
    valid: "Valid pack: ready to sign as version {v}.",
    detections: "{n} detection(s) in the test",
    truncated: "Only the first 1,000 detections are shown.",
    noDetection: "No detection in the test.",
    publish: "Sign and publish version {v}",
    confirmTitle: "Sign version {v} for {tenant}?",
    confirmBody:
      "Signing is final and recorded. The customer’s workstations fetch this version at their next synchronisation; the typed terms will be cleared from this form.",
    confirm: "Sign and publish",
    cancel: "Cancel",
    publishing: "Signing…",
    published: "Version {v} signed and published for {tenant} · digest {d}",
    conflict: "Another version was published meanwhile. Reload the customer.",
    unavailable: "Publishing unavailable: signing key or verification engine missing.",
    rejected: "The platform refused to sign this pack. Run the test again.",
    malformed:
      "Malformed composition: lowercase identifiers (a-z, 0-9, . _ -), labels filled in, simple keywords.",
    failed: "The service did not respond. Nothing was published.",
    rateLimited: "Too many tests in one minute: retrying automatically in a few seconds.",
    incomplete: "To complete: {fields}.",
    removeDetector: "Remove detector {n}",
    removeTest: "Remove test {n}",
    coverage: "{up} / {total} up to date · {behind} behind · {refused} rejected",
  },
  categories: {
    credential: "Access credential",
    customer_data: "Customer data",
    personal_data: "Personal data",
    internal_infra: "Internal infrastructure",
    project: "Confidential project",
  },
  actions: { block: "Block", warn: "Warn" },
  states: {
    up_to_date: "Up to date",
    behind: "Behind",
    refused: "Rejected by the workstation",
  },
  types: { pattern: "Pattern", terms: "Terms" },
  fields: {
    id: "identifier",
    label: "label",
    pattern: "pattern",
    keywords: "keywords",
    window: "window",
    entropy: "entropy",
  },
  codes: {
    schema: "The pack does not follow the contract format.",
    duplicate_detector: "Two detectors share the same identifier.",
    validity_window: "Expiry must come after issuance.",
    too_many_digests: "Too many digests: at most 20,000 terms across the pack.",
    invalid_pattern: "The pattern of detector “{d}” is refused: {r}",
    unknown_test_detector: "A positive test targets a detector that does not exist.",
    missing_positive: "Detector “{d}” has no positive test.",
    positive_not_detected: "Positive test #{t} is not detected by “{d}”.",
    negative_detected: "Negative test #{t} triggers “{d}”.",
    term_empty: "A term of “{d}” contains no letter or digit.",
    term_too_many_words: "A term of “{d}” is longer than four words.",
    terms_required: "Type the terms of “{d}”: no published version carries them.",
    budget_exceeded:
      "Verification exceeded its time budget: simplify the patterns (successive overlapping quantifiers).",
    engine_busy: "The verification engine is busy. Try again.",
    engine_failed: "The verification engine failed. Nothing was signed.",
    sample_too_large: "The test is longer than 20,000 characters.",
    test_reveals_term:
      "Positive test #{t} contains a confidential term of “{d}”: positives are signed in clear, remove it.",
    unassigned_character:
      "A text contains a Unicode character the platform cannot yet read the way the workstation does.",
    pack_id_mismatch: "This customer already has a pack under another identifier.",
    negative_reveals_term:
      "Negative test #{t} contains a confidential term of “{d}”: it would be signed in clear, remove it.",
    field_reveals_term:
      "A label, keyword or the pattern of detector “{d}” contains a confidential term: it would be signed in clear.",
    too_complex:
      "The pattern of “{d}” chains too many repetitions competing for the same characters: it would slow every scan on the workstation.",
    pattern_too_slow:
      "The pattern of “{d}” is too slow on a probe text: simplify its repetitions.",
  },
  reasons: {
    length: "longer than 256 characters.",
    invalid_character: "character outside printable ASCII (accent, tab…).",
    unbounded_quantifier: "unbounded repetition (*, + or {n,}): write {n,m}.",
    bad_quantifier: "invalid repetition bound (1 to 64, no leading zero).",
    nested_repetition: "a repeated group cannot contain repetition or alternation.",
    dot_not_allowed: "the dot “.” is not allowed: use a class.",
    anchor_not_allowed: "anchors ^ and $ are not allowed.",
    group_not_allowed: "only (?:…) groups are allowed.",
    bad_escape: "escape not allowed (only \\d \\w \\s and metacharacters).",
    negated_class: "negated classes [^…] are not allowed.",
    empty_class: "empty class.",
    bad_class_char: "inside a class, escape [ ^ and - outside a range.",
    bad_range: "decreasing range in a class.",
    unbalanced_class: "unclosed bracket.",
    unbalanced_group: "unbalanced parenthesis.",
    stacked_quantifier: "two quantifiers in a row.",
    dangling_quantifier: "quantifier with nothing to repeat.",
    empty_alternative: "empty alternative.",
    too_deep: "more than four nested groups.",
    too_short: "a match would be shorter than three characters.",
    too_long: "a match could exceed 256 characters.",
    no_anchor: "needs three consecutive fixed characters, or a context.",
    bad_literal: "lone “]” or “}”: escape it.",
  },
};

export const RULES_COPY: Record<Lang, RulesCopy> = { fr: FR, en: EN };

export function fill(
  template: string,
  values: Record<string, string | number>,
): string {
  return template.replace(/\{(\w+)\}/g, (whole, key: string) =>
    key in values ? String(values[key]) : whole,
  );
}

/**
 * Le message lisible d'un refus, avec le détecteur ou le test en cause. ``testNumber``
 * traduit l'index envoyé par le serveur en numéro de ligne du formulaire.
 */
export function explain(
  error: PackError,
  lang: Lang,
  testNumber: (sent: number) => number = (sent) => sent + 1,
): string {
  const copy = RULES_COPY[lang];
  const template = (copy.codes as Record<string, string>)[error.code];
  if (!template) return error.code;
  const reasons = copy.reasons as Record<string, string>;
  const reason = error.reason ? (reasons[error.reason] ?? error.reason) : "";
  return fill(template, {
    d: error.detector ?? "",
    t: error.test === null ? "" : testNumber(error.test),
    r: reason,
  });
}

/** La demande d'ajustement : un courriel à xSOM, sujet prérempli, sans donnée réelle. */
export function adjustmentMailto(lang: Lang, version: number | null): string {
  const copy = RULES_COPY[lang].tenant;
  const suffix = version === null ? "" : ` (v${version})`;
  const subject = `${copy.mailSubject}${suffix}`;
  const body = fill(copy.mailBody, { version: suffix });
  return `mailto:${XSOM_CONTACT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

export function shortDigest(value: string): string {
  return value.length > 16 ? `${value.slice(0, 12)}…${value.slice(-4)}` : value;
}
