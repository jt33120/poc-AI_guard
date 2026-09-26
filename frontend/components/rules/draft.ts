/**
 * L'état du formulaire de l'opérateur et sa traduction en composition pour l'API.
 *
 * Rien de ceci ne touche au stockage du navigateur : les termes confidentiels ne vivent
 * que dans l'état React de l'onglet, et sont effacés après une publication.
 */

import type { Action, Category, OperatorRulesView } from "./types";

export interface DetectorForm {
  key: string;
  id: string;
  label: string;
  category: Category;
  action: Action;
  type: "pattern" | "terms";
  pattern: string;
  caseInsensitive: boolean;
  entropy: string;
  terms: string;
  publishedTerms: number | null;
  keywords: string;
  window: string;
}

export interface TestForm {
  key: string;
  detector: string;
  text: string;
}

export interface DraftForm {
  packId: string;
  validityDays: string;
  detectors: DetectorForm[];
  positives: TestForm[];
  negatives: TestForm[];
}

let counter = 0;
export function nextKey(): string {
  counter += 1;
  return `k${counter}`;
}

export function emptyDetector(type: "pattern" | "terms"): DetectorForm {
  return {
    key: nextKey(),
    id: "",
    label: "",
    category: type === "terms" ? "project" : "customer_data",
    action: "block",
    type,
    pattern: "",
    caseInsensitive: false,
    entropy: "",
    terms: "",
    publishedTerms: null,
    keywords: "",
    window: "24",
  };
}

export function formFromView(view: OperatorRulesView): DraftForm {
  const draft = view.draft;
  if (!draft) {
    return {
      packId: "reglage-principal",
      validityDays: "365",
      detectors: [emptyDetector("pattern")],
      positives: [{ key: nextKey(), detector: "", text: "" }],
      negatives: [{ key: nextKey(), detector: "", text: "" }],
    };
  }
  return {
    packId: draft.packId,
    validityDays: "365",
    detectors: draft.detectors.map((detector) => ({
      ...emptyDetector(detector.match.type),
      id: detector.id,
      label: detector.label,
      category: detector.category,
      action: detector.action,
      pattern: detector.match.type === "pattern" ? detector.match.pattern : "",
      caseInsensitive:
        detector.match.type === "pattern" &&
        Boolean(detector.match.caseInsensitive),
      entropy:
        detector.match.type === "pattern" &&
        detector.match.minEntropyTenths !== undefined
          ? String(detector.match.minEntropyTenths / 10)
          : "",
      publishedTerms:
        detector.match.type === "terms" ? detector.match.termsCount : null,
      keywords: detector.context?.keywords.join(", ") ?? "",
      window: String(detector.context?.window ?? 24),
    })),
    positives: draft.tests.positives.map((test) => ({
      key: nextKey(),
      detector: test.detector,
      text: test.text,
    })),
    negatives: draft.tests.negatives.map((text) => ({
      key: nextKey(),
      detector: "",
      text,
    })),
  };
}

const ID = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const KEYWORD = /^[A-Za-z0-9][A-Za-z0-9 _.@:/-]{1,39}$/;

function lines(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function keywords(text: string): string[] {
  return text
    .split(",")
    .map((word) => word.trim())
    .filter(Boolean);
}

/** Les défauts évidents, signalés avant tout appel : identifiant, libellé, contexte. */
export function localProblem(form: DraftForm): string | null {
  if (!ID.test(form.packId)) return "packId";
  const days = Number(form.validityDays);
  if (!Number.isInteger(days) || days < 1 || days > 730) return "validityDays";
  for (const detector of form.detectors) {
    if (!ID.test(detector.id) || !detector.label.trim()) return detector.key;
    const words = keywords(detector.keywords);
    if (words.some((word) => !KEYWORD.test(word))) return detector.key;
    const window = Number(detector.window);
    if (words.length && (!Number.isInteger(window) || window < 1 || window > 256))
      return detector.key;
    if (detector.type === "pattern" && !detector.pattern) return detector.key;
    if (detector.entropy.trim()) {
      const bits = Number(detector.entropy.replace(",", "."));
      if (!Number.isFinite(bits) || bits < 0 || bits > 8) return detector.key;
    }
  }
  return null;
}

export function toDraft(form: DraftForm): Record<string, unknown> {
  return {
    packId: form.packId,
    validityDays: Number(form.validityDays),
    detectors: form.detectors.map((detector) => {
      const words = keywords(detector.keywords);
      const entropy = detector.entropy.trim()
        ? Math.round(Number(detector.entropy.replace(",", ".")) * 10)
        : null;
      const terms = lines(detector.terms);
      return {
        id: detector.id,
        label: detector.label.trim(),
        category: detector.category,
        action: detector.action,
        match:
          detector.type === "pattern"
            ? {
                type: "pattern",
                pattern: detector.pattern,
                caseInsensitive: detector.caseInsensitive,
                minEntropyTenths: entropy,
              }
            : { type: "terms", terms: terms.length ? terms : null },
        context: words.length
          ? { keywords: words, window: Number(detector.window) }
          : null,
      };
    }),
    tests: {
      positives: form.positives
        .filter((test) => test.text.trim() && test.detector)
        .map((test) => ({ detector: test.detector, text: test.text })),
      negatives: form.negatives
        .filter((test) => test.text.trim())
        .map((test) => test.text),
    },
  };
}
