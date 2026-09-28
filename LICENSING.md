# Licensing

xSOM AI Guard is **open core**. The engine that controls what an agent does is
open source. The advanced traceability, compliance and enterprise features are
source-available under a commercial license and need an xSOM subscription in
production.

| Edition | License | What you can do |
|---|---|---|
| **Community** | [Apache 2.0](LICENSE) | Use, modify, self-host and redistribute, including commercially. |
| **Commercial** | [xSOM Commercial License](LICENSE-COMMERCIAL.md) | Read, audit, test and modify outside production. Production use needs a subscription. |

## What is open

The Community Edition is everything in this repository except the paths listed
under [Commercial scope](#commercial-scope). It is a complete action-control gateway:

- the MCP gateway and its downstream proxy, and `POST /v1/authorize`;
- the deterministic policy engine, action classification and YAML policy editor;
- human-in-the-loop approval with dry-run, one approver and expiry as denial;
- the append-only, hash-chained audit log, `verify_chain`, signed checkpoints and raw exports;
- the LLM monitoring proxy, usage and cost tracking, OTLP `gen_ai` ingestion;
- agent and gateway-token inventory, the CLI, SQL migrations, tests and documentation.

The audit log and human approval stay open on purpose. The product sells control
over what agents do, so it cannot charge for proving what they did. `PLANCHER` in
`core/entitlements.py` keeps these capabilities in every plan, and a test enforces it.

## What is commercial

- **Advanced traceability and compliance**: EU AI Act evidence packs (art. 12, 14, 26),
  FRIA scaffolding, chained third-party verdicts, corpus provenance, shadow-AI inventory.
- **Advanced protection**: LLM judge, natural-language policy assistant, third-party
  prompt guard, per-tenant DLP tuning, graduated autonomy by risk band, session taint
  tracking, tool integrity and quarantine, observation windows and promotion reports.
- **Multi-client and enterprise**: clients and projects, read tokens, provider
  credentials, OIDC role mapping.
- **xSOM products**: xSOM-signed rules packs, Developer Guard and Secret Guard
  (server side and extension), the web console and site.

Any capability that the `pro` or `entreprise` plan carries and the `free` plan does
not is a Commercial Feature, wherever its code lives.

## Commercial scope

These paths are licensed under [LICENSE-COMMERCIAL.md](LICENSE-COMMERCIAL.md). A path
ending with `/` covers the whole directory. `tests/test_licensing.py` checks that each
path exists and that every paid API router is listed.

<!-- commercial-scope:start -->
```text
# Advanced traceability and compliance
api/compliance.py
core/compliance.py
api/verdicts.py
core/verdicts.py
api/corpora.py
core/corpora.py
api/shadow_ai.py
core/shadow_ai.py

# Advanced protection
core/judge.py
core/policy_assistant.py
core/prompt_guard.py
api/dlp.py
core/dlp_config.py
core/risk.py
core/taint_store.py
gateway/taint.py
api/integrity.py
core/integrity.py
api/monitor.py
api/promotion.py
core/promotion.py

# Multi-client and enterprise
api/clients.py
core/clients.py
api/read_tokens.py
core/read_tokens.py
api/credentials.py
core/credentials.py
core/role_map.py

# xSOM-signed rules packs, Developer Guard and Secret Guard
api/rules_packs.py
core/rules_packs.py
core/rules_pack_engine.py
api/developer_policies.py
core/developer_policies.py
core/developer_approvals.py
api/extension_devices.py
core/extension_devices.py
api/extension_ingest.py
core/extension_redaction.py
core/attachments.py
core/attachment_worker.py
secret-guard/

# Web console, site and brand
frontend/
```
<!-- commercial-scope:end -->

The official Secret Guard Local build stays free to use under its own
[end-user licence](docs/legal/LICENCE-SECRET-GUARD-LOCAL.md). Third-party files keep
their own license, such as the fonts in `frontend/design-system/licenses/`.

## Frequently asked

**Can I run the Community Edition in production?** Yes. It loads some commercial
modules, which is allowed as long as no Commercial Feature is enabled.

**Can I unlock a paid capability by changing my tenant's plan in my own database?**
No. That is a Commercial Feature used without a subscription.

**Can I build my own version of a commercial feature?** Yes, if you write it
yourself without copying the Commercial Components.

**How do I contribute?** Contributions to the Community Edition are accepted under
Apache 2.0. Contributions to a Commercial Component are licensed to xSOM under
section 6 of the commercial license.

**How do I get a subscription?** Write to julian.talou@xsom.fr with the subject
« Licence commerciale AI Guard ».
