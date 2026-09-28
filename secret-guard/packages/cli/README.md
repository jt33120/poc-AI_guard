# @xsom/secret-guard-cli

Local CLI and VS Code Preview hook process for `@xsom/secret-guard-core`, supported
on Node.js 22.13 or newer. Normal scan and hook responses contain no detected
value. `--mode=block` is the default. The former `--warn=allow` escape hatch
was removed in 0.6: it is still accepted so older hook commands start, and it
now blocks like `--mode=block`.

```bash
printf '%s' 'Explain this function.' | secret-guard scan --json
printf '%s' '{"hook_event_name":"UserPromptSubmit","prompt":"hello"}' | secret-guard hook
```

`scan` exits `0` for ALLOW, `1` for WARN and **`2` for BLOCK**. Usage errors exit
`64`. `hook` writes `{ "continue": true }` to stdout and exits `0` for ALLOW. It
exits `2`, leaves stdout empty, and writes a non-sensitive reason to stderr for a
blocked WARN/BLOCK or invalid event.

## Hidden instructions

`hook` also stops prompts and files that carry characters a person cannot see but a
model reads: Unicode tag characters (ASCII smuggling), bidirectional controls
(Trojan Source), runs of zero-width characters and runs of variation selectors.
Reports give the kind, line and column, never what the characters spell.

```bash
secret-guard instructions               # the instruction files under the current folder
secret-guard instructions --fix         # remove the hidden characters, in place
secret-guard instructions src docs      # every text file under these folders
pbpaste | secret-guard instructions --fix - | pbcopy
```

`instructions` exits `0` when nothing is hidden (or `--fix` cleaned it), `1` when hidden
characters are found and `2` when a file could not be checked entirely. It looks for
`AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `.cursorrules`, `.windsurfrules`, `.clinerules`,
`.github/copilot-instructions.md`, `*.instructions.md`, `*.prompt.md`, `.cursor/rules`,
`.claude/` and MCP configurations, without entering `node_modules` or `.git`. Flags,
emoji sequences, the joiners of scripts that need them and directional marks are left
alone. See `docs/secret-guard/INSTRUCTION-GUARD.md`.

Only the delivered VS Code Preview configuration uses this hook process. Its
contract has not been certified against Claude Code or Codex. A successful local
invocation proves the process response, not that an IDE host loaded, trusted, or
ran the configured hook.
