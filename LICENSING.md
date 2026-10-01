# Licensing

This repository is **source-available**. Its code is public so that anyone can audit
it, but using it in production requires an xSOM subscription. The one exception is
the free offer: the **Secret Guard Local** detector and its command-line hook are
open source under Apache 2.0.

| Offer on the site | Price | License of the code |
|---|---|---|
| **Secret Guard Local** | Free | Detector and CLI hook: [Apache 2.0](LICENSE-APACHE). VS Code extension: free to use under its [end-user licence](docs/legal/LICENCE-SECRET-GUARD-LOCAL.md), code under the commercial license for now. |
| **Secret Guard Équipe** | Paid | [xSOM Commercial License](LICENSE-COMMERCIAL.md) |
| **Secret Guard Renforcé** | Quoted | [xSOM Commercial License](LICENSE-COMMERCIAL.md) |
| **AI Guard platform** (gateway, traces, console) | Paid or quoted | [xSOM Commercial License](LICENSE-COMMERCIAL.md) |

## Why the detector is open

Secret Guard Local reads every prompt a developer sends to an AI assistant. Anyone
can now check that the detector runs locally, without network access, telemetry or
a language model. The paid editions do not depend on keeping this code secret. Their
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
# Detector, command-line hook and local relay
secret-guard/packages/core/
secret-guard/packages/cli/
secret-guard/packages/relay/
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
secret-guard/tests/relay/clean.test.ts
secret-guard/tests/relay/server.test.ts
```
<!-- open-source-scope:end -->

The VS Code extension still mixes Local and Équipe code in the same files. Its Local
part will join this list once the Équipe code sits behind a separate extension
point. Third-party files keep their own license, such as the fonts in
`frontend/design-system/licenses/`.

## Frequently asked

**Can I use the detector and the CLI hook at work?** Yes, freely, under Apache 2.0.

**Can I self-host the AI Guard platform?** For evaluation, yes. In production, you
need a subscription.

**Can I unlock a paid capability by changing my tenant's plan in my own database?**
No. That is a use beyond your subscription.

**How do I contribute?** Contributions to the open source scope are accepted under
Apache 2.0. Contributions to anything else are licensed to xSOM under section 6 of
the commercial license.

**How do I get a subscription?** Write to julian.talou@xsom.fr with the subject
« Licence commerciale AI Guard ».
