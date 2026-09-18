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

Only the delivered VS Code Preview configuration uses this hook process. Its
contract has not been certified against Claude Code or Codex. A successful local
invocation proves the process response, not that an IDE host loaded, trusted, or
ran the configured hook.
