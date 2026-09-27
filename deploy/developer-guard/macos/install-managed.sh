#!/bin/bash
set -euo pipefail

[[ $(id -u) -eq 0 ]] || { echo "run as root or deploy with MDM" >&2; exit 77; }
source_dir=$(cd "$(dirname "$0")" && pwd -P)
target="/Library/Application Support/xSOM/DeveloperGuard"
install -d -o root -g wheel -m 0755 "$target" /etc/codex
install -o root -g wheel -m 0644 "$source_dir/requirements.toml" /etc/codex/requirements.toml
install -o root -g wheel -m 0644 "$source_dir/com.microsoft.VSCode.mobileconfig" "$target/com.microsoft.VSCode.mobileconfig"
plutil -lint "$target/com.microsoft.VSCode.mobileconfig" >/dev/null
[[ $(stat -f '%Su:%Sg:%Lp' /etc/codex/requirements.toml) == "root:wheel:644" ]]
echo "Files staged. Deploy the mobileconfig with MDM, restart clients, then run Developer: Policy Diagnostics."
