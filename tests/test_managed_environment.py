"""Static gates for managed deployment artifacts; platform qualification remains physical."""

from __future__ import annotations

import json
import plistlib
from pathlib import Path

ROOT = Path(__file__).parents[1] / "deploy" / "developer-guard"


def test_linux_policy_and_sandbox_fail_closed() -> None:
    policy = json.loads((ROOT / "linux" / "policy.json").read_text(encoding="utf-8"))
    assert policy["AllowedExtensions"]["xsom.xsom-secret-guard-vscode"] == ["0.6.0"]
    assert policy["AllowedExtensions"]["*"] is False
    sandbox = (ROOT / "linux" / "run-isolated.sh").read_text(encoding="utf-8")
    for required in ("--unshare-all", "--unshare-net", "--new-session", "--die-with-parent"):
        assert required in sandbox
    assert "docker.sock" not in sandbox and "--bind /home" not in sandbox


def test_macos_profile_is_system_scoped_and_non_removable() -> None:
    with (ROOT / "macos" / "com.microsoft.VSCode.mobileconfig").open("rb") as handle:
        profile = plistlib.load(handle)
    assert profile["PayloadScope"] == "System"
    assert profile["PayloadRemovalDisallowed"] is True
    settings = profile["PayloadContent"][0]
    assert settings["AllowedExtensions"]["xsom.xsom-secret-guard-vscode"] == ["0.6.0"]
    assert settings["ChatHooks"] is True


def test_windows_bootstrap_and_system_requirements_are_enforced() -> None:
    script = (ROOT / "windows" / "install-managed.ps1").read_text(encoding="utf-8")
    assert "#Requires -RunAsAdministrator" in script
    assert "HKLM:\\Software\\Policies\\Microsoft\\VSCode" in script
    assert "bootstrap\\extensions" in script
    assert "$env:ProgramData" in script
    assert "icacls" in script
