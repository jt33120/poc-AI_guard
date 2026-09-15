# xSOM Secret Guard for VS Code

Local-first prompt secret detection. The primary surface is automatic:

- native pre-submit hook installers for VS Code/Copilot, Claude Code, Codex, and
  Windsurf Cascade;
- the `@secretguard` chat participant, which owns and scans its request before using the selected model;
- explicit scan commands for the current selection, document, or clipboard.

The extension does not inject DOM or CSS into another assistant's Send button.
That would be fragile and keyboard-bypassable. The visible `$(lock)` status is an
indicator; the actual block runs in the host's native pre-submit lifecycle. It has
no telemetry and makes no network request for detection. Development requires
Node.js 22.13 or newer.

On first startup, the extension automatically verifies the copied runner with
clean and blocking canaries for both supported envelopes, then merges one owned
hook into the supported native host configurations. Existing settings and hooks
are preserved. VS Code 1.133–1.136 can protect Claude Code, Codex and Windsurf;
native VS Code/Copilot prompt hooks are added only on VS Code 1.137 or newer.
The first-run action opens Codex CLI to review and trust only the xSOM hook, then
the user starts a new Codex chat. Codex deliberately requires this one explicit
approval because user hooks execute outside its sandbox; the extension never
bypasses that control. Set `secretGuard.hook.autoEnable` to `false` for manual
installation.

`$(lock) Secret Guard: prêt` means that all four user configurations, runner
bytes, and local canaries match. It does not attest Codex trust, remote execution,
or MDM policy. Clicking the status opens the Codex finalization flow. User-level
hooks remain removable, VS Code hooks are Preview, and Remote/WSL/Container
topologies can execute on a different filesystem. Zero-touch enterprise
enforcement requires managed/system configuration.

`WARN` is blocked by default because a native hook has no per-request confirmation
UI. The `allow` setting weakens that policy and is not a protected mode. In the
owned `@secretguard` flow, sending an unredacted WARN requires explicit
per-request confirmation. A redacted send is valid only when the exact redacted
content rescans to ALLOW; the dispatch blocks incomplete, WARN and BLOCK final
rescans.
