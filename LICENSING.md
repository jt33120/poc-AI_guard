# Licensing

This repository is **source-available**. Its code is public so that anyone can audit
it, but using it in production requires an xSOM subscription. The one exception is
the free offer: **Secret Guard Local**, its detector, its command-line hook and the
Local edition of its VS Code extension, is open source under Apache 2.0.

| Offer on the site | Price | License of the code |
|---|---|---|
| **Secret Guard Local** | Free | [Apache 2.0](LICENSE-APACHE) for the detector, the CLI hook and the Local edition of the extension. The official extension stays free to use under its [end-user licence](docs/legal/LICENCE-SECRET-GUARD-LOCAL.md). |
| **Secret Guard Équipe** | Paid | [xSOM Commercial License](LICENSE-COMMERCIAL.md) |
| **Secret Guard Renforcé** | Quoted | [xSOM Commercial License](LICENSE-COMMERCIAL.md) |
| **AI Guard platform** (gateway, traces, console) | Paid or quoted | [xSOM Commercial License](LICENSE-COMMERCIAL.md) |

## Why Secret Guard Local is open

Secret Guard Local reads every prompt a developer sends to an AI assistant. Anyone
can check that the detector runs locally, without network access, telemetry or a
language model. The paid editions do not depend on keeping this code secret. Their
value lies in the policies and rules packs that xSOM calibrates and signs. Signature
verification lives in the commercial runner, and the authority key never enters this
repository.

The open code builds on its own: it depends on no commercial file.
`tests/test_licensing.py` enforces this.

## Open source scope

These paths are licensed under [Apache 2.0](LICENSE-APACHE). A path ending with `/`
covers the whole directory. **Everything else is commercial by default**: a new or
moved file stays commercial until someone deliberately adds it here.

<!-- open-source-scope:start -->
```text
# Detector and command-line hook
secret-guard/packages/core/
secret-guard/packages/cli/
secret-guard/tsconfig.base.json

# Their tests
secret-guard/tests/core/encoding.test.ts
secret-guard/tests/core/rules-pattern.test.ts
secret-guard/tests/core/scan.test.ts
secret-guard/tests/core/security.test.ts
secret-guard/tests/core/sha256.test.ts
secret-guard/tests/core/text.test.ts
secret-guard/tests/cli/file-guard.test.ts
secret-guard/tests/cli/hook.test.ts

# VS Code extension, Local edition
secret-guard/packages/vscode/build-local.mjs
secret-guard/packages/vscode/tsconfig.json
secret-guard/packages/vscode/src/chat-references.ts
secret-guard/packages/vscode/src/clipboard-purge.ts
secret-guard/packages/vscode/src/dashboard.ts
secret-guard/packages/vscode/src/dispatch.ts
secret-guard/packages/vscode/src/hook-activity.ts
secret-guard/packages/vscode/src/hook-check.ts
secret-guard/packages/vscode/src/hook-manager.ts
secret-guard/packages/vscode/src/host-config.ts
secret-guard/packages/vscode/src/local-extension.ts
secret-guard/packages/vscode/src/local-hook.ts
secret-guard/packages/vscode/src/observe-window.ts
secret-guard/packages/vscode/src/onboarding.ts
secret-guard/packages/vscode/src/presentation.ts
secret-guard/packages/vscode/src/protection-mode.ts
secret-guard/packages/vscode/src/protection.ts
secret-guard/packages/vscode/src/status-tooltip.ts
secret-guard/packages/vscode/src/team-port.ts
secret-guard/packages/vscode/src/tooltip-art.ts

# Their tests
secret-guard/tests/vscode/chat-references.test.ts
secret-guard/tests/vscode/clipboard-purge.test.ts
secret-guard/tests/vscode/dashboard.test.ts
secret-guard/tests/vscode/dispatch.test.ts
secret-guard/tests/vscode/hook-activity.test.ts
secret-guard/tests/vscode/hook-manager.test.ts
secret-guard/tests/vscode/onboarding.test.ts
secret-guard/tests/vscode/presentation.test.ts
secret-guard/tests/vscode/status-tooltip.test.ts
secret-guard/tests/vscode/tooltip-art.test.ts
```
<!-- open-source-scope:end -->

In the VS Code extension, the Équipe edition lives in `src/team/` and plugs into the
Local edition through a single seam, `src/team-port.ts`. `build.mjs` builds the
official extension with both editions. `build-local.mjs` builds the Local edition
alone, into `dist/local/`. The manifest, the icons and the xSOM brand stay with
xSOM: publishing your own build requires your own name and branding.

Third-party files keep their own license, such as the fonts in
`frontend/design-system/licenses/`.

## Frequently asked

**Can I use Secret Guard Local at work?** Yes, freely. The official extension is free
under its end-user licence, and its open source code is under Apache 2.0.

**Can I self-host the AI Guard platform?** For evaluation, yes. In production, you
need a subscription.

**Can I unlock a paid capability by changing my tenant's plan in my own database?**
No. That is a use beyond your subscription.

**How do I contribute?** Contributions to the open source scope are accepted under
Apache 2.0. Contributions to anything else are licensed to xSOM under section 6 of
the commercial license.

**How do I get a subscription?** Write to julian.talou@xsom.fr with the subject
« Licence commerciale AI Guard ».
