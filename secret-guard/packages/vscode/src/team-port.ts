import type * as vscode from "vscode";
import type { HookResponse, ProtectionMode } from "@xsom/secret-guard-cli/hook";
import type {
  CompiledRulesPack,
  Finding,
  ScanResult,
} from "@xsom/secret-guard-core";
import type { DashboardTeam } from "./dashboard.js";
import type { HookHealth } from "./hook-manager.js";
import type { ObserveCap } from "./observe-window.js";
import type { RulesPackLine } from "./status-tooltip.js";

// The only seam between Secret Guard Local and the Équipe edition. Local code
// never imports Équipe code: the official build passes an implementation of
// these ports, the open source build keeps the defaults below. A default adds
// nothing (no tuning, no audit, no organization cap, no relay), so the Local
// edition protects exactly as it would on its own.

/** A local event the Équipe edition may audit: metadata only, never content. */
export interface LocalEvent {
  readonly kind: "scan" | "mode_changed";
  readonly assistant: "manual" | "secretguard";
  readonly mode: ProtectionMode;
  readonly outcome:
    "clean" | "blocked" | "redacted" | "warned" | "passed" | "configured";
  readonly findings: number;
}

/** What the Local extension lends the Équipe edition. */
export interface TeamHost {
  readonly context: vscode.ExtensionContext;
  readonly storage: string;
  readonly hookHealth: () => Promise<HookHealth>;
  readonly mode: () => ProtectionMode;
  /** Redraw the status bar and the protection centre. */
  readonly refresh: () => Promise<void>;
  /** Re-read the organization's cap on Avertir after a policy sync, then redraw. */
  readonly policyChanged: () => Promise<void>;
  /** Close an open status bar hover before acting on it. */
  readonly closeControls: () => void;
}

/** The Équipe edition, as the Local extension sees it. */
export interface Team extends vscode.Disposable {
  /** The verified xSOM tuning for local scans; undefined keeps the built-in rules. */
  rules(): CompiledRulesPack | undefined;
  /** Audit a local event. Findings are counted, never sent. */
  record(event: LocalEvent, findings?: readonly Finding[]): void;
  /** The organization's cap on Avertir, from a verified managed policy. */
  observeCap(): Promise<ObserveCap>;
  /** The tuning line under the readiness line of the status tooltip. */
  tooltipLine(): RulesPackLine | undefined;
  /** The Équipe sections of the protection centre. */
  dashboard(): DashboardTeam | undefined;
  /** The commands those sections may link to. */
  readonly dashboardCommands: readonly string[];
  /** Reconnect an enrolled workstation, in the background. */
  restore(): Promise<void>;
}

export type TeamFactory = (host: TeamHost) => Promise<Team>;

export const NO_TEAM: Team = {
  rules: () => undefined,
  record: () => undefined,
  observeCap: () => Promise.resolve(undefined),
  tooltipLine: () => undefined,
  dashboard: () => undefined,
  dashboardCommands: [],
  restore: () => Promise.resolve(),
  dispose: () => undefined,
};

export const noTeam: TeamFactory = () => Promise.resolve(NO_TEAM);

/** What the installed hook has checked locally, for the Équipe edition. */
export interface HookScan {
  readonly rawInput: string;
  readonly mode: ProtectionMode;
  readonly response: HookResponse;
  /** Every local scan of this check: the prompt and the files it names. */
  readonly results: readonly ScanResult[];
}

/**
 * The Équipe verdict on a local check: refuse under the managed policy, hand
 * a blocked prompt to the mandatory-redaction relay, or explain a block.
 */
export type HookVerdict =
  | { readonly effect: "refuse"; readonly message: string }
  | { readonly effect: "delegate" }
  | { readonly effect: "explain"; readonly message: string };

/** The Équipe side of one hook check, read once before the local scan. */
export interface HookEdition {
  readonly observeCap: ObserveCap;
  readonly rules?: CompiledRulesPack;
  /** Undefined keeps the local verdict. */
  settle(scan: HookScan): Promise<HookVerdict | undefined>;
}

export interface HookTeam {
  prepare(storage: string, args: readonly string[]): Promise<HookEdition>;
}

export const NO_HOOK_TEAM: HookTeam = {
  prepare: () =>
    Promise.resolve({
      observeCap: undefined,
      settle: () => Promise.resolve(undefined),
    }),
};
