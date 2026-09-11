# xSOM Secret Guard for VS Code

Local-first prompt secret detection. The extension exposes three honest surfaces:

- a `UserPromptSubmit` hook installer for compatible VS Code agent harnesses (Preview);
- the `@secretguard` chat participant, which owns and scans its request before using the selected model;
- explicit scan commands for the current selection, document, or clipboard.

The extension does not claim to intercept arbitrary third-party webviews,
terminals, attachments, automatically-added context, repository reads, later tool
output, Claude Code, or Codex. It has no telemetry and makes no network request
for detection. Development requires Node.js 22.13 or newer.

Use **Secret Guard: Activer le hook natif (Preview)** once to configure the
user-level hook. Activation verifies the copied runner with clean and blocking
local canaries. **Preview validée** means that this local runner passed those
checks; it is not a host-level interception attestation. Invalid, foreign,
missing, modified, or failing configuration is shown as degraded. Workspace
Trust, workspace or managed policy, host version and Remote/WSL/Container
execution can ignore or pre-empt the user hook. A successful local canary does
not prove that VS Code invoked it for a real prompt.

`WARN` is blocked by default because a native hook has no per-request confirmation
UI. The `allow` setting weakens that policy and is not a protected mode. In the
owned `@secretguard` flow, sending an unredacted WARN requires explicit
per-request confirmation. A redacted send is valid only when the exact redacted
content rescans to ALLOW; the dispatch blocks incomplete, WARN and BLOCK final
rescans.
