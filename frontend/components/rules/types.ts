/**
 * Les formes que l'API « Règles sur mesure » rend à la console (`api/rules_packs.py`).
 * Aucune ne porte un terme confidentiel : un détecteur `terms` n'expose que son nombre
 * d'empreintes.
 */

export type Category =
  | "credential"
  | "customer_data"
  | "personal_data"
  | "internal_infra"
  | "project";
export type Action = "warn" | "block";
export type DeviceState = "up_to_date" | "behind" | "refused";

export interface DetectorContext {
  keywords: string[];
  window: number;
}

export interface DetectorSummary {
  id: string;
  label: string;
  category: Category;
  action: Action;
  type: "pattern" | "terms";
  context: DetectorContext | null;
  pattern?: string;
  caseInsensitive?: boolean;
  minEntropyTenths?: number | null;
  termsCount?: number;
  maxWords?: number;
}

export interface PackView {
  packId: string;
  version: number;
  issuedAt: string;
  expiresAt: string;
  issuer: string;
  keyId: string;
  payloadDigest: string;
  publishedAt: string;
  revoked: boolean;
  expired: boolean;
  detectors: DetectorSummary[];
  tests: { positives: number; negatives: number };
}

export interface CoverageDevice {
  id: string;
  name: string;
  state: DeviceState;
  appliedVersion: number | null;
  appliedDigest: string | null;
  expired: boolean;
}

export interface Coverage {
  total: number;
  up_to_date: number;
  behind: number;
  refused: number;
  devices: CoverageDevice[];
}

export interface HistoryEntry {
  event: "published" | "revoked";
  packId: string;
  version: number;
  payloadDigest: string;
  at: string;
}

export interface TenantRulesView {
  pack: PackView | null;
  coverage: Coverage | null;
  history: HistoryEntry[];
  chainIntact: boolean;
  xsomOperator: boolean;
}

export interface OperatorTenant {
  id: string;
  name: string;
  packId: string | null;
  version: number | null;
  publishedAt: string | null;
}

export interface EditableDetector {
  id: string;
  label: string;
  category: Category;
  action: Action;
  context?: DetectorContext;
  match:
    | {
        type: "pattern";
        pattern: string;
        caseInsensitive?: boolean;
        minEntropyTenths?: number;
      }
    | { type: "terms"; termsCount: number; maxWords: number };
}

export interface OperatorRulesView {
  tenant: { id: string; name: string };
  pack: PackView | null;
  draft: {
    packId: string;
    detectors: EditableDetector[];
    tests: {
      positives: { detector: string; text: string }[];
      negatives: string[];
    };
  } | null;
  coverage: Coverage | null;
  history: HistoryEntry[];
  chainIntact: boolean;
  signingReady: boolean;
}

export interface PackError {
  code: string;
  detector: string | null;
  test: number | null;
  reason: string | null;
}

export interface DryRunResult {
  valid: boolean;
  error: PackError | null;
  version: number;
  detections: { detector: string; label: string; start: number; end: number }[];
  digests: number;
}

export interface PublishResult {
  version: number;
  packId: string;
  payloadDigest: string;
  keyId: string;
}
