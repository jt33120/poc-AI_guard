#!/usr/bin/env bash
set -euo pipefail

[[ $(id -u) -eq 0 ]] || { echo "run as root" >&2; exit 77; }
source_dir=$(cd "$(dirname "$0")" && pwd -P)
install -d -o root -g root -m 0755 /etc/vscode /etc/codex /etc/xsom/developer-guard
install -o root -g root -m 0644 "$source_dir/policy.json" /etc/vscode/policy.json
install -o root -g root -m 0644 "$source_dir/requirements.toml" /etc/codex/requirements.toml

python3 -m json.tool /etc/vscode/policy.json >/dev/null
[[ $(stat -c '%U:%G:%a' /etc/vscode/policy.json) == "root:root:644" ]]
[[ $(stat -c '%U:%G:%a' /etc/codex/requirements.toml) == "root:root:644" ]]
echo "Managed files installed. Restart VS Code and run Developer: Policy Diagnostics."
