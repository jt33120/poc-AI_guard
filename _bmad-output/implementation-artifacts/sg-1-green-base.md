# Story SG.1: Green Secret Guard base (P0)

Status: done

## Story

As the xSOM release owner,
I want `npm --prefix secret-guard run verify` to pass end to end on macOS,
so that every later change is measured against a known-good baseline.

## Acceptance Criteria

1. The approval bridge listens on a Unix socket whose path fits `sun_path` (103 bytes on macOS/BSD, 107 on Linux), inside a private 0700 directory; Windows keeps its named pipe.
2. A VS Code storage path longer than the limit still serves approvals end to end (runner → socket → gateway).
3. When no candidate location fits, the bridge refuses explicitly (`approval_socket_path_too_long`) instead of failing later.
4. The Extension Host suite runs unattended (locked screen, keychain locked) without timing out.
5. The full verify is green: format, lint, typecheck, coverage, build, CLI, Extension Host, VSIX, evaluate, fuzz, dogfood, benchmark, audit.

## Tasks / Subtasks

- [x] Private short socket directory (`approvalSocketLocation`) with ownership and mode checks (AC 1, 3)
- [x] Tests for long base paths, byte (not character) length, fallback, refusal (AC 1–3)
- [x] Extension Host: `--use-inmemory-secretstorage` so a locked login keychain cannot block the VS Code main process (AC 4)
- [x] Full verify run (AC 5)

## Dev Notes

- Root cause 1: `join(globalStorage, "developer-guard-approval.sock")` exceeds 104 bytes on macOS → `listen EINVAL`. Real product bug, not only a test artefact.
- Root cause 2: the test VS Code instance blocked its main process on the macOS keychain (screen locked overnight); configuration writes and clipboard calls waited until the 120 s watchdog.
- Files: `secret-guard/packages/vscode/src/approval-bridge.ts`, `secret-guard/tests/vscode/approval-bridge.test.ts`, `secret-guard/scripts/run-vscode-tests-worker.mjs`.

## Dev Agent Record

### Agent Model Used

Claude Opus 5.5

### Completion Notes List

- Commits `dcd7407`, `aeaac24`. Verify green: 29 files, 393 tests (+5), 4 skipped; Extension Host 4/4.
