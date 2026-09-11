# Secret Guard V0

Secret Guard is the local prompt-protection prototype of xSOM AI Guard. It is
distinct from the existing MCP action gateway and server-side egress DLP.

```text
VS Code owned participant / explicit scan / Preview hook configuration
                              │
                              ▼
                   @xsom/secret-guard-core
                 deterministic and local
                              │
                       ALLOW / WARN / BLOCK
```

The delivered V0 is **VS Code-only**:

- `@xsom/secret-guard-core`: synchronous TypeScript detector and risk engine,
  with no runtime dependency, network access, filesystem access, telemetry, or
  logging;
- `@xsom/secret-guard-cli`: file/stdin scanner and the command process used by
  the VS Code Preview hook;
- `xsom-secret-guard-vscode`: VS Code extension with `@secretguard`, explicit
  scan commands, and an installer for the Preview `UserPromptSubmit` hook.

Claude Code and Codex integrations are future work. The hook process contract has
not been certified against either host and must not be presented as protection
for them.

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
- A BLOCK cannot be overridden in the owned `@secretguard` flow. An unredacted
  WARN can be sent only after explicit per-request confirmation there.
- A redacted prompt is eligible for sending only after rescanning the exact
  redacted string to `complete: true`, `decision: "ALLOW"`. The dispatch enforces
  this rule. `redactAndRescan` also returns `content: ""` after an incomplete
  initial scan or any final verdict other than ALLOW.
- “No secret detected” is not a guarantee that content is safe.

## Coverage boundary

The VS Code hook mechanism is Preview. Activation copies the bundled runner,
checks its bytes, and executes clean/blocking local canaries. **Preview validated**
therefore proves only that this managed local runner currently obeys its process
contract. It does not prove that VS Code loaded or invoked the hook for a real
prompt. Workspace Trust, workspace configuration, administrator policy,
Remote/WSL/Container topology, host version, or another hook layer may ignore or
pre-empt the user hook. Invalid, foreign, missing, modified, or failing managed
configuration is reported as degraded; absence is reported as manual mode.

The hook therefore carries no universal interception guarantee. It does not cover
arbitrary third-party webviews, terminal input, attachments, automatically-added
context, repository reads, later tool output, Claude Code, or Codex. The owned
`@secretguard` participant is the only send path whose routing is controlled by
this V0; explicit scan commands only report or copy a result and do not intercept
another assistant.

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
