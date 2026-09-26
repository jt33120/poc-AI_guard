"""Release and CI gates required by Developer Guard distribution."""

from pathlib import Path

ROOT = Path(__file__).parents[1]


def test_secret_guard_ci_gate_is_server_side_and_commit_bound() -> None:
    workflow = (ROOT / ".github" / "workflows" / "ci.yml").read_text(encoding="utf-8")
    assert "Server-side Developer Guard quality receipt" in workflow
    assert 'create-quality-receipt.mjs --commit "$GITHUB_SHA"' in workflow
    assert 'verify-quality-receipt.mjs quality-receipt.json "$GITHUB_SHA"' in workflow
    assert "--no-verify" not in workflow


def test_release_publishes_sbom_provenance_and_checksums_with_vsix() -> None:
    workflow = (ROOT / ".github" / "workflows" / "secret-guard-release.yml").read_text(
        encoding="utf-8"
    )
    for required in (
        "npm sbom --package-lock-only --sbom-format cyclonedx",
        "create-release-provenance.mjs",
        "xsom-secret-guard-vscode.sbom.cdx.json",
        "release-provenance.json",
        "SHA256SUMS",
    ):
        assert required in workflow
