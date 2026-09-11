# Secret Guard V0.2

Secret Guard is the local prompt-protection prototype of xSOM AI Guard. It is
distinct from the existing MCP action gateway and server-side egress DLP.

```text
Native pre-submit hooks / owned participant / explicit scan
                              │
                              ▼
                   @xsom/secret-guard-core
                 deterministic and local
                              │
                       ALLOW / WARN / BLOCK
```

The delivered V0.2 uses the assistants' native pre-submit hooks:

- `@xsom/secret-guard-core`: synchronous TypeScript detector and risk engine,
  with no runtime dependency, network access, filesystem access, telemetry, or
  logging;
- `@xsom/secret-guard-cli`: file/stdin scanner and one fail-closed hook process
  compatible with VS Code/Copilot `UserPromptSubmit`, Claude Code
  `UserPromptSubmit`, Codex `UserPromptSubmit`, and Windsurf Cascade
  `pre_user_prompt`;
- `xsom-secret-guard-vscode`: VS Code extension with automatic multi-host hook
  installation, a persistent lock status, `@secretguard` as a diagnostic owned
  flow, and explicit scan commands.

Once **Secret Guard: Activer la protection automatique** has completed, typing
`@secretguard` is not required. Every text prompt submitted through a configured
native host hook is scanned before the assistant processes it. Clean prompts pass
without interaction; WARN/BLOCK and scanner failures stop the prompt with exit
code 2 and a non-sensitive reason.

## Development

```bash
cd secret-guard
npm ci
npm run verify
```

Development and the supported standalone Node runtime require **Node.js
22.13 or newer**.

`verify` runs formatting, linting, strict TypeScript checks, unit tests with
coverage gates, subprocess contract tests, a 50,000-case synthetic negative
evaluation, a 100,000-case deterministic fuzz smoke, Secret Guard workspace dogfooding, a
VSIX content inspection, latency gates, and `npm audit`.

## Security contract

- Detection is fully local and deterministic; no candidate is validated online.
- Findings contain the rule, type, score, reasons, and original location, never
  the detected value.
- Core inputs above 1 MiB UTF-8 or incomplete scans return `BLOCK`; no prefix is
  approved.
- `secret-guard scan` exits `0` for ALLOW, `1` for WARN and `2` for BLOCK.
  The `hook` process exits `0` with `{ "continue": true }` for ALLOW and exits
  `2` with a non-sensitive reason on stderr for WARN/BLOCK or invalid input.
- A BLOCK cannot be overridden by the automatic hooks or in the owned
  `@secretguard` flow. An unredacted
  WARN can be sent only after explicit per-request confirmation there.
- A redacted prompt is eligible for sending only after rescanning the exact
  redacted string to `complete: true`, `decision: "ALLOW"`. The dispatch enforces
  this rule. `redactAndRescan` also returns `content: ""` after an incomplete
  initial scan or any final verdict other than ALLOW.
- “No secret detected” is not a guarantee that content is safe.

## Native host coverage and boundary

Activation copies the bundled runner, checks its bytes, runs clean and blocking
canaries for both supported wire protocols, then transactionally merges one
marked entry into each user configuration. Existing settings and hooks are
preserved; disable removes only the exact Secret Guard entries. The lock is red
or open when configuration, bytes, or canaries no longer match.

VS Code agent hooks remain Preview. User-level hooks can be removed by the user
and are not an enterprise tamper boundary. Windsurf documents system-level or
cloud-distributed hooks for mandatory fleet enforcement; Codex and Claude Code
also support managed policy layers. A local administrator can always remove a
user-level install.

The protection covers the documented text prompt field only. It does not scan
attachments, automatically-added context, files read later by the agent, tool
output, terminal input, a ChatGPT browser tab, or any client without a compatible
native hook. A visual overlay on another extension's Send button would not add a
security boundary and is intentionally not used.

## Implemented verification budgets

- Core coverage thresholds: 90% lines/statements/functions and **85% branches**.
- Warm clean-input core benchmark gates: 16 KiB p95/p99 15/30 ms; 256 KiB
  75/125 ms; 1 MiB 250/400 ms. A separate 16 KiB CLI subprocess benchmark has a
  p95 gate of 350 ms over 20 process launches. Three targeted adversarial tests
  require their respective 1 MiB or dense inputs to finish in under 2 seconds.
- These are narrow regression gates on generated clean ASCII input, not general
  latency claims. RSS/CPU, secret-heavy input, and end-to-end host/extension
  latency are not measured by these gates.
- The synthetic evaluation generates 1,150 positive cases and 50,000 negative
  cases. Its gates are recall at least 99%, BLOCK precision at least 99.5%,
  false-BLOCK rate at most 0.1%, default-hook rejection at most 0.5%, and full
  fixed-detector catalog coverage. The passing regression run observes zero
  false rejection among those 50,000 generated negatives and reports a 95%
  Wilson upper bound of 0.008% for that synthetic sample only. None of these
  figures estimates performance on representative real-world prompts; a
  deduplicated, independently annotated corpus is required before GA or
  enterprise claims.
- Input cap: 1,048,576 UTF-8 bytes. Base64 decoding is single-level, limited to
  16,384 output bytes per operation, 128 scan-wide decode attempts and 262,144
  estimated output bytes budgeted across generic candidates, JWT segments and
  Docker auth values. Exact SRI digest shapes are excluded before this budget.
  Multiline
  joining is limited to 128 candidate windows of at most 16,384 characters;
  findings are capped at 2,048. There is no implemented wall-clock budget.

See [`../docs/secret-guard/ARCHITECTURE.md`](../docs/secret-guard/ARCHITECTURE.md),
[`../docs/secret-guard/THREAT_MODEL.md`](../docs/secret-guard/THREAT_MODEL.md), and
[`../docs/secret-guard/DEVELOPMENT_PLAN.md`](../docs/secret-guard/DEVELOPMENT_PLAN.md).
