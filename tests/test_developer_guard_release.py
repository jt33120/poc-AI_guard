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


def test_release_compiles_the_rules_authority_from_a_public_repository_variable() -> None:
    """xSOM custom tuning: public keys come from a variable, the seed never enters."""
    workflow = (ROOT / ".github" / "workflows" / "secret-guard-release.yml").read_text(
        encoding="utf-8"
    )
    assert "XSOM_RULES_AUTHORITY_KEYS: ${{ vars.XSOM_RULES_AUTHORITY_KEYS }}" in workflow
    assert 'XSOM_RULES_REQUIRE_AUTHORITY: "1"' in workflow
    assert "Require the xSOM rules authority public key" in workflow
    assert "XSOM_RULES_SIGNING_KEY" not in workflow
    assert "secrets.XSOM_RULES" not in workflow
