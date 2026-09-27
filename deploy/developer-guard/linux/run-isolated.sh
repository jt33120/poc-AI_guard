#!/usr/bin/env bash
set -euo pipefail

# Pilot reference: an actual namespace sandbox, never a shell denylist.
project=${1:?usage: run-isolated.sh PROJECT COMMAND [ARG...]}
shift
[[ $# -gt 0 ]] || { echo "missing command" >&2; exit 64; }
command -v bwrap >/dev/null || { echo "bubblewrap is required for the reinforced Linux pilot" >&2; exit 78; }
project=$(cd "$project" && pwd -P)
[[ "$project" != "/" ]] || { echo "refusing to mount filesystem root" >&2; exit 64; }

exec bwrap --unshare-all --new-session --die-with-parent \
  --ro-bind /usr /usr --ro-bind /bin /bin --ro-bind /lib /lib --ro-bind /lib64 /lib64 \
  --proc /proc --dev /dev --tmpfs /tmp --dir /home/developer \
  --bind "$project" /workspace --chdir /workspace \
  --unshare-net -- "$@"
