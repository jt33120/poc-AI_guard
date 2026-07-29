---
title: "xSOM AI Guard v2 — Product Requirements Document"
product: xSOM AI Guard
release: v2.0
status: draft
owner: Product (BMAD PM)
created: 2026-07-27
updated: 2026-07-27
supersedes: docs/SPEC.md (MVP), docs/BUILD_PLAN_V1.1.md (M9–M12)
authority: CLAUDE.md §4 (non-negotiable invariants) overrides every requirement in this document
---

# xSOM AI Guard v2 — Product Requirements Document

## 0. Document Purpose

This PRD defines **xSOM AI Guard v2**: the release that turns a very good action-control gateway into *the exhaustive, reference-grade, ultra-easy-to-deploy, transparent AI supervision product*.

It exists because five independent audit streams (code, deployability, transparency, market, standards) converged on the same conclusion: the **enforcement core is right and defensible**, and everything around it — deployment, coverage, disclosure, interop — is a milestone behind the claim. The product supervises the agent but not the supervisors; it computes evidence but does not disclose it; it enforces on MCP but most agents are not MCP; and its documented quickstart does not boot.

This document is the single source of product truth for v2. It defines *what* and *why*, never *how* — implementation sequencing belongs in `docs/BUILD_PLAN_V2.md`, architecture decisions in `docs/ADR-*.md`.

**Authority order.** `CLAUDE.md` §4 (non-negotiable invariants) wins over this PRD. Where a stakeholder demand collides with an invariant, this document states the collision explicitly and resolves it **in favour of the invariant** — never the other way round. Those resolutions are marked inline as **Invariant collision / Resolution**.

**Reading order.** Sections 0–9 are the mandated BMAD template and appear in template order. Sections 10–18 are adapt-in clusters that apply to this product because it is security-, compliance-, and deployment-critical. A reviewer short on time should read §1 (Vision), §12 (Why Now), §4 (Features), §7 (Success Metrics), then §8 (Open Questions).

**Traceability.** Every functional requirement carries a global identifier `FR-n` and a set of testable **Consequences**. Inferences that are not verifiable from the codebase or a cited source are tagged inline as `[ASSUMPTION: …]` and indexed in §9.

---

## 1. Vision

Enterprises are putting agents into production faster than they can govern them. The industry's answer so far has been to watch the model: log prompts, score outputs, filter text. xSOM AI Guard takes the opposite and harder position — **we control what the agent *does*, not what it says.** Every tool call an agent makes passes through a gateway that classifies the action, applies a deterministic authorization policy, pauses irreversible actions for a named human, and writes a hash-chained record that no one, including us, can rewrite unnoticed. That thesis was correct when it was a hypothesis in 2025. In 2026 it is the category: Gartner named Guardian Agents, AWS shipped a policy-enforcing agent gateway, and "immutable audit trail" became a line item in AI Agent Management Platform requirements.

Being right about the thesis is no longer enough, because we are no longer alone in it. What nobody owns is the **intersection**: enforced human approval, cryptographically verifiable evidence, and tool supply-chain integrity — on any cloud, behind any framework, self-hostable in one command. AWS enforces policy but has no human-in-the-loop and no tamper-evidence. Tamper-evident-ledger vendors sign beautiful logs of actions they never stopped. Open-source MCP gateways route traffic and forget it. xSOM v2 is the product that does all three and can be *proved* to do all three by someone who does not trust us.

That last clause is the whole of v2. "Reference-grade" means a security engineer can reconstruct why any action was blocked without reading our source. "Transparent" means an auditor can recompute our hash chain on their own laptop, with our published algorithm, using an export that contains the hashes — and can check that chain against an anchor we do not control. "Ultra-easy to deploy" means `docker compose up` and a single `xsom init`, on a laptop or in an air-gapped datacentre, with no SaaS account, no hand-written SQL, and no vendor URL baked into the artifact. "Exhaustive" means the supervision covers the agent, the sub-agents it delegates to, the humans who approve, *and the administrators who change the rules* — because a tamper-evident record that omits the person who relaxed the policy is not evidence, it is decoration. v2 ships the enforcement plane every policy engine lacks, and it ships the proof.

---

## 2. Target User

xSOM v2 sells to an organisation deploying AI agents that can *act* — send, write, pay, delete, deploy — against real systems, where an unsupervised action has legal, financial, or safety consequence. The buying centre has shifted (see §12): the economic buyer is now the **CISO or Head of AI Platform** carrying agent risk, not the compliance officer racing a deadline.

### 2.1 Jobs To Be Done

| # | Persona | Job (functional) | Job (emotional / social) | Today's workaround |
|---|---|---|---|---|
| JTBD-1 | **Platform engineer** | "Stand up a supervision plane for our agents in an afternoon, in our own VPC, without adding three SaaS vendors to the security review." | Not be the person who introduced an uncontrolled dependency. | Home-grown allowlists in agent code; nothing in staging. |
| JTBD-2 | **AI / agent engineer** | "Ship an agent that can act, without hand-rolling approval plumbing per framework." | Ship fast without being the reason for an incident. | Framework-local `interrupt()` / `canUseTool`, per-project, ungoverned. |
| JTBD-3 | **Security engineer** | "When an action is blocked or allowed, tell me exactly why, by what rule, on whose behalf — in seconds, with data I can hand to an incident review." | Be able to answer the exec question without hedging. | Grep application logs; reconstruct from memory. |
| JTBD-4 | **SRE / on-call** | "When an agent misbehaves at 03:00, stop it now — every instance, everywhere — without a deploy or a support ticket." | Contain the blast radius before it becomes a post-mortem. | Kill the process; rotate a credential and hope. |
| JTBD-5 | **Approver (ops / finance / legal)** | "Give me enough context to make a real decision in under a minute, where I already work." | Not rubber-stamp; not be the bottleneck. | An email with a tool name; approve blind. |
| JTBD-6 | **Compliance officer / DPO** | "Produce defensible evidence that a human supervised the consequential actions, and that the record was not edited." | Be able to say 'here is the proof', not 'here is our policy'. | Screenshots and a spreadsheet. |
| JTBD-7 | **External auditor / regulator** | "Verify the record without trusting the vendor that produced it." | Sign the opinion. | Accept a vendor-asserted boolean. |
| JTBD-8 | **Platform / SecOps lead** | "Get agent decisions into the SIEM and the trace backend we already run, so this is not another console." | Avoid a fifteenth pane of glass. | Manual export; nothing. |

### 2.2 Non-Users (v2)

Explicitly **not** the target of this release. Serving them would dilute the thesis or exceed the invariants.

- **Prompt-safety and content-moderation teams.** xSOM does not inspect, score, or filter prompts. See §5.
- **ML / model evaluation teams.** xSOM has no opinion on model quality, groundedness, or hallucination rate. See §5.
- **APM / infrastructure observability owners.** xSOM emits to their stack; it does not replace it. See §5.
- **Consumer / single-developer hobby users.** The product assumes a Tenant with at least one Member and an auditable purpose. A free self-host path exists (§4 Group C) but the roadmap is not driven by solo use.
- **Agents with no side effects.** A read-only research agent gains audit but not the core value; it is a supported degenerate case, not a target segment.
- **Fully autonomous, no-human-anywhere deployments.** A deployment that will never staff an approver cannot satisfy the product's central guarantee and will be a poor fit; xSOM will still fail closed for them, which they will experience as friction.

### 2.3 Key User Journeys

Each journey is written as **entry state → path → climax → resolution**. Journeys are numbered `UJ-n` and referenced from §4 and §7.

---

#### UJ-1 — Nadia, platform engineer: self-hosted and blocking an action in under 10 minutes

**Entry state.** Nadia has been handed a mandate: "the customer-ops agent goes to production next month, get us control over what it can do." She has a laptop, Docker, and a hard rule from her security team: no new SaaS vendor before a review. She has 30 minutes between meetings. She has read that xSOM needs Supabase, Railway, and Vercel, and has already half-decided this is a two-week project.

**Path.** She clones the repo and runs `docker compose up`. One command brings up Postgres, the control API, the console, and a seeded demo tenant; migrations apply themselves from a ledger; nothing asks her for a cloud account. The compose stack refuses to report healthy until the database is migrated to the bundled head and the JWKS issuer resolves, so when it goes green she knows it actually works rather than merely booted. She runs `xsom init --org "Acme Ops" --email nadia@acme.example`; the CLI creates the tenant, the admin membership, and prints one gateway token, once. No SQL. She points the demo agent at the gateway with the exact environment variable the CLI told her to export.

**Climax.** The demo agent tries `crm.delete_contact`. It does not happen. The console shows a pending approval with a dry-run of the effect; the agent gets a structured "requires approval" result, not a crash. She denies it. She re-runs the agent — still blocked. She checks the downstream mock server's log: the delete was never called.

**Resolution.** Elapsed: eight minutes from `git clone`. She takes a screenshot of the blocked action to the security review with a link to a self-hosted URL on her own machine, and asks for a staging namespace rather than a vendor approval. `SM-1` is the metric that made this journey a requirement.

---

#### UJ-2 — Sofia, AI engineer: bringing a non-MCP agent under supervision without rewriting it

**Entry state.** Sofia's agent is a LangGraph application with twelve tools; none of them are MCP. She has a `humanInTheLoopMiddleware` interrupt on the one tool she was scared of and nothing on the other eleven. Her platform team has just deployed xSOM and told her to "put your agent behind it." She reads that xSOM is an MCP gateway and assumes this means rewriting her tool layer.

**Path.** The onboarding page detects that she is not on MCP and offers the second ingress path. She installs `xsom-guard`, adds four lines wiring the adapter into her graph's pre-tool hook, and sets the base URL the console printed — her own instance's URL, not the vendor's. Every tool call now asks xSOM for a decision before executing. The console's Inspector lists all twelve tools with a baseline tier, and flags that eight of them were auto-classified from their names while four are unknown and therefore denied by default. She writes four rules and watches the Inspector update.

**Climax.** She runs her integration suite. `send_customer_email` is held. The adapter surfaces the approval id to her graph, which parks the run exactly the way `interrupt()` already parks it. Her teammate approves in the console; the run resumes. Crucially, she notices the response header telling her that on this ingress path enforcement is **cooperative** — her process could, in principle, ignore the verdict — and the audit entry records that fact rather than pretending otherwise.

**Resolution.** Eleven previously ungoverned tools are now policy-controlled with no change to her tool implementations. She removes her bespoke interrupt because the decision now lives in one place for the whole company. She files a ticket to move the agent to the MCP path before production, because the console told her plainly that mandatory enforcement is stronger.

---

#### UJ-3 — Yusuf, operations approver: deciding an irreversible action in 40 seconds

**Entry state.** Yusuf runs customer operations. He is not technical. He gets an alert in Slack: an agent wants to do something and needs him. Historically this has meant an email saying `crm.bulk_delete` with no other information, which he approves because the agent is "probably fine" and the queue is blocking his team.

**Path.** The Slack message is a **decision brief**, not a notification. It names the requesting agent and the human on whose behalf it is acting, the action class (irreversible), the deterministic dry-run of the effect ("delete 412 contacts matching segment 'lapsed-2024'"), the risk score with its contributing factors broken out, a banner that this session was marked tainted after the agent fetched an external document nine calls ago, and a live countdown showing the approval expires in 22 minutes — with the words "expiry equals denial" on the face of it.

**Climax.** The blast-radius factor says 412. The dry-run summary was computed by the gateway, not written by the agent — so the agent cannot have talked him into it. He denies, and the interface requires a one-line justification: "segment definition looks wrong, check with data team."

**Resolution.** The denial and his justification are chained into the audit record **at the moment he decides**, not later when the agent happens to re-poll. His name is inside the hashed payload. Three weeks later that entry is the reason the compliance evidence pack shows a real denial rather than a silent expiry.

---

#### UJ-4 — Tom, security engineer: investigating a blocked action

**Entry state.** A product manager escalates: "the invoicing agent is broken, it can't send anything, and this is costing us." Tom has an audit table with an id, a tool name, and a decision. He does not know whether the policy denied it, a constraint was violated, the tool was unknown, the LLM judge escalated it, a risk band escalated it, or the taint guard escalated it. Today he would guess.

**Path.** He opens the audit explorer, filters by tool and time window, and clicks the row. The detail drawer answers the question in one line: **escalated_by = taint**, **decision_reason = post-taint external send**, with a link to the `taint_marked` entry that caused it — same request correlation id, nine calls earlier, source tool `web.fetch`. The risk breakdown shows the score and each contributing factor. The agent is named, not `—`, because the gateway path now carries agent attribution. The policy version in force at decision time is stamped on the entry, and he can diff it against the current one.

**Climax.** He replays the decision: the Inspector's dry-run replay takes the same tool and candidate arguments, runs the full guard pipeline in evaluate-only mode, and returns the complete reasoning chain without executing anything. He reproduces the escalation deterministically, then re-runs it against a candidate policy in simulation and sees exactly which historical decisions would change.

**Resolution.** Root cause in four minutes: a supplier's price-list page contained an injection string; the taint guard did precisely its job. Tom does not relax the policy. He narrows the taint source, ships it as a new policy version with a note, and links the audit entry into the incident review. `SM-2` exists because of this journey.

---

#### UJ-5 — Ravi, SRE: stopping an agent at 03:00

**Entry state.** PagerDuty fires on a spend anomaly: one agent is making 40× its normal volume of external sends. Ravi is on call, has never opened xSOM, and has ten minutes before this becomes a customer-visible incident. His only known lever is "find the process and kill it" — but the agent runs on a customer's infrastructure, not his.

**Path.** The alert links straight to the agent's page. One control: **Halt**, scoped to agent, with tenant-wide and per-tool scopes beside it. He halts the agent. Every gateway session re-checks halt state on the next call — including sessions authenticated hours ago — and fails closed. The halt itself is a chained control-plane event with his identity on it. The console shows halted state, who halted, when, and why (he is required to give a reason).

**Climax.** The next tool call from that agent is denied at the gateway. Not delayed, not logged-and-forwarded — denied, before the downstream server is contacted. He watches the deny counter climb and the send counter stay flat.

**Resolution.** At 09:00 the agent's owner explains a bad prompt template. Ravi resumes the agent from the same page; the resume is chained too. The post-mortem timeline is the audit chain, filtered by agent, with halt and resume in place. Nothing in this journey required a deploy, a support ticket, or database access.

---

#### UJ-6 — Claire, compliance officer: producing evidence

**Entry state.** Claire has to answer a customer security questionnaire and prepare for an internal audit against ISO/IEC 42001 and the EU AI Act. She has been told xSOM produces "an evidence pack". She has been burned before by tools that produce a PDF cover page and a paragraph of generated prose.

**Path.** She opens the compliance page — which exists in the console now, not only as an API. It shows, per registered AI system rather than per tenant: chain integrity with the head hash and period covered, retention status derived from the oldest observed row and the last executed purge (not from a config constant), oversight coverage computed with a tenant predicate she can trust, and the deployer summary. Amber items say what is missing and link to the fix. She selects a framework — EU AI Act, ISO 42001, NIST AI RMF, or SOC 2 — and exports.

**Climax.** The PDF contains the evidence, not a summary of it: an Article 12 section with chain status, entry count, head hash and retention; an Article 14 section with a per-approval table naming approvers, decision times and outcomes sourced from the hash chain rather than the mutable approvals table; an Article 26 section; and an appendix of hash-bearing entries. The FRIA scaffold is labelled "unsigned draft" on its face so nobody mistakes it for a completed assessment.

**Resolution.** She sends the pack. The auditor does not have to take her word for it — see UJ-7. She also downloads the data manifest, which tells her, column by column, what xSOM stores and what it provably never stores, and hands that to the DPO instead of a paragraph of marketing.

---

#### UJ-7 — Anne-Laure, external auditor: verifying without trusting the vendor

**Entry state.** Anne-Laure has the evidence pack from UJ-6 and a professional obligation not to accept a vendor's assertion about the vendor's own database. Her prior experience with "immutable audit" products is a boolean field named `chain_ok` set to `true` by the party being audited.

**Path.** The export contains, for every entry, `prev_hash`, `entry_hash`, and `tenant_id` — the full hashed payload, not a subset. She downloads the standalone verifier, a single self-contained script with a published algorithm in `docs/AUDIT_FORMAT.md`, and runs it on her own machine against the JSON. No database, no xSOM code, no network. It recomputes every hash from GENESIS.

**Climax.** It returns OK, and prints the head hash. She then checks that head hash against the **anchor** — the periodic checkpoint the tenant chose to publish outside xSOM's control (their own object-locked bucket, in this deployment). The anchored head from six weeks ago still reproduces from the exported data. That is the step that makes truncation and wholesale rebuild detectable, and it is the step that means her opinion does not rest on the vendor's good faith.

**Resolution.** She writes that the record is independently verifiable and names the residual risks the published threat model already discloses — including, honestly, the window between anchors. She does not have to discover those limits herself, because §13 and the threat model state them.

---

#### UJ-8 — Marc, administrator: the insider path that no longer works (adversarial)

**Entry state.** Marc is a legitimate tenant admin under pressure to make a stuck agent work. The fastest fix he knows: set `defaults.unknown_tool: auto`, let the agent do the thing, and set it back. Under v1 this leaves ordinary-looking `allow` rows and no trace of the change whatsoever.

**Path.** He edits the policy. The `PUT` succeeds — v2 does not stop admins from administering. But the change writes a chained `policy_updated` control-plane event with his user id inside the hashed payload, the version number, and a diff digest. The previous document is not destroyed: it is retained as an immutable policy version. Every audit entry produced while his change was live is stamped with **that policy version**.

**Climax.** He reverts. That writes a second chained event. Later, a reviewer filtering the audit chain by actor type = human sees a policy relaxation and a policy restoration bracketing a burst of `allow` decisions on a previously unknown tool. The reviewer can diff version N against N-1 and see precisely which guard was removed.

**Resolution.** Marc is not a villain; he is the reason the invariant exists. The point of the journey is that v2's evidence claim survives a privileged insider, which v1's did not. Nothing here requires trusting Marc, and nothing here required blocking him.

---

## 3. Glossary

Every domain noun used in this document is defined here exactly once. Where a common synonym exists, it is listed as **rejected** — that term must not appear elsewhere in the document or in the product surface.

**Action Class** — the reversibility category of a tool call: `read`, `write`, `external_send`, `irreversible`. Determined deterministically. *Rejected synonyms: "risk category", "operation type".*

**Agent** — a non-human principal that calls tools through xSOM. Authenticated by a Gateway Token or a federated workload identity. Distinct from the AI System it belongs to.

**AI System** — the registered, governed unit an Agent belongs to: owner, business purpose, model, framework, version, environment, risk tier, data categories, lifecycle state. The subject of compliance reporting. *Rejected synonyms: "application", "project".*

**Anchor** — a Checkpoint published outside xSOM's control (customer object-lock bucket, timestamp authority, transparency log, or delivered webhook) so that a full-chain rebuild by anyone with database write access is detectable.

**Annex Column** — a column on `audit_log` that is **outside** the hashed Payload. Required for all new audit fields so existing rows keep verifying (CLAUDE.md §4.2). Annex columns are not tamper-evident by the chain alone; they are covered by Checkpoints.

**Approval Record** — the mutable working row representing one pending or decided human decision: dry-run, expiry, decider(s), outcome. It is an index, never the evidence; the evidence is the Audit Entry.

**Approval Tier** — the authorization verdict the policy produces for an action: `auto`, `notify`, `human_in_the_loop`, `human_dual`, `deny`. *Rejected synonyms: "permission level", "verdict".*

**Argument Vault** — an opt-in, per-tenant, envelope-encrypted store of tool-call arguments with its own short retention and its own access audit, used only for replay and simulation. Off by default. Never part of `audit_log`.

**Audit Entry** — one append-only, hash-chained row recording one decision. The unit of evidence.

**Behavioural Drift** — a statistically significant deviation of an Agent's observed behaviour (call rate, action-class mix, blast-radius distribution, deny rate) from its rolling baseline. Distinct from Tool Drift.

**Bootstrap** — the one-command creation of a Tenant, its first admin Member, and its first Gateway Token, with no hand-written SQL.

**Budget** — a per-Tenant or per-Agent spend or volume ceiling, enforced before an action or a model call proceeds.

**Canonical Tool Name** — the fully-qualified `server.tool` identifier used by the policy, the audit, and the fingerprint. The only correct way to name a tool in any record.

**Checkpoint** — a periodic, signed digest over a contiguous range of Audit Entries and their Annex Columns: `(period, first_id, last_id, count, head_hash, annex_digest)`. Makes annex data and tail-truncation tamper-evident without changing the Payload.

**Client** — a grouping of Agents (a project or team) used for per-tool RBAC scoping.

**Constraint** — a bounded condition on a policy Rule (allowed domains, allowed clients, dry-run required, business hours). Violation fails closed.

**Control-Plane Event** — a chained Audit Entry recording a human or system mutation of xSOM itself: policy change, token mint/revoke, approval decision, tool re-baseline, halt/resume, member change, credential change, erasure, retention purge.

**Decision** — the outcome recorded for one tool call: `allow`, `notify`, `deny`, `hitl_pending`, `hitl_approved`, `hitl_denied`, `expired`, plus gate values (`tool_drift`, `poison_suspected`, `rbac_denied`, `taint_marked`, `tainted_action`, `halted`) and Control-Plane Event values.

**Decision Brief** — the complete set of facts presented to a human approver: requesting Agent, action class, deterministic Dry-Run, Risk Score with factors, escalation source, taint and integrity banners, expiry countdown, recent history for the tool.

**Decision Reason** — the enumerated cause of a Decision (`policy`, `constraint`, `unknown_tool`, `auto_classify`, `annotation`, `judge`, `risk`, `taint`, `integrity`, `rbac`, `budget`, `halt`, `dlp`). Stored in its own column, never in `error`.

**Downstream Server** — a tool server xSOM proxies to, declared per Tenant.

**Dry-Run** — the deterministic, gateway-computed description of an action's effect, shown to a human before approval. **Never authored by the Agent or by an LLM.**

**Earned Trust** — a bounded, deterministic discount applied to the Risk Score after N consecutive clean decisions for a specific (Agent, Tool) pair. Never lowers an `irreversible` action below its floor.

**Emergency Stop** — the immediate, fail-closed suspension of all tool calls for a Tenant, an Agent, or a Tool, effective on already-authenticated sessions, reversible by Resume. *Rejected synonyms: "kill switch", "freeze", "panic button".*

**Enforcement Mode** — whether a decision was **mandatory** (xSOM is in the execution path and the action physically cannot proceed without a verdict) or **cooperative** (a client SDK asked and is trusted to obey). Recorded on every Audit Entry.

**Escalation Source** — which guard raised an action's tier above what the policy Rule alone would give: `judge`, `risk`, `taint`, `integrity`, `rbac`, `budget`, `annotation`.

**Event Sink** — an outbound destination for the decision stream: signed webhook, OCSF/CEF for SIEM, or OTLP for a trace backend.

**Evidence Pack** — the exportable artifact mapping Audit Entries and Approval Records onto a regulatory framework's controls, containing the underlying hash-bearing data, not only a summary.

**Gateway Token** — a Tenant-scoped credential (`xsg_`) authenticating an Agent to the gateway. Stored hashed.

**Guard** — one independent check in the decision path: integrity, RBAC, halt, budget, policy, judge, risk, taint, DLP.

**Guard Pipeline** — the single ordered sequence of Guards that every Ingress Path executes. There is exactly one.

**Halt** — see Emergency Stop. (`halted_at` is the state; Halt/Resume are the operations.)

**Hash Chain** — `entry_hash = sha256(prev_hash + Payload)` per Tenant, rooted at `GENESIS`.

**Human-in-the-Loop (HITL)** — the Approval Tier requiring a named human decision before the action executes. Enforced at the gateway, never delegated to a model.

**Ingress Path** — a surface through which a tool call reaches a decision: the MCP gateway, the HTTP `/v1/authorize` endpoint, or the LLM provider proxy.

**Legal Hold** — a flag suspending retention purge and erasure for a defined scope.

**Lineage** — the linkage between a model interaction, a session, a tool call decision, an approval, and an outcome, sufficient to reconstruct "which conversation caused this action".

**Member** — a human principal in a Tenant, holding a Role.

**Migration Ledger** — the `schema_migrations` table recording which schema versions are applied, with checksums.

**Payload** — the canonical JSON object that is hashed into the chain. Its shape is frozen at **v1** and must not change. *Rejected synonym: "event body".*

**Policy Document** — the YAML defining Rules, Constraints and defaults for a Tenant.

**Policy Version** — an immutable, retained revision of a Policy Document, with author, timestamp and note. Stamped on every Audit Entry produced while it was in force.

**Quarantine** — the fail-closed state of a Tool whose fingerprint drifted or whose description is poisoned: not exposed to Agents, calls denied, until a human re-baselines it.

**Read Token** — a scoped read-only credential (`xsr_`) for telemetry ingestion and read APIs.

**Retention Floor** — the minimum period Audit Entries must be kept (≥ 183 days), below which purge is refused.

**Risk Band** — the mapping from a Risk Score range to an Approval Tier. Opt-in.

**Risk Score** — a deterministic 0–100 score from reversibility, blast radius, data sensitivity and novelty. No LLM.

**Role** — `admin`, `operator`, or `viewer`, enforced in the API and in Postgres RLS.

**Rule** — one entry in a Policy Document binding a Canonical Tool Name to an Action Class (or `ambiguous`) and an Approval Tier.

**Separation of Duties** — the requirement that the human who requested or triggered an action is not the human who approves it, and that `human_dual` requires two distinct Members.

**Session** — the durable, persisted correlation scope for an Agent's run, identified by a Session Id derived from the caller's trace context or declared at ingress. Not the MCP protocol session.

**Taint** — the persisted state marking a Session as having consumed untrusted external content, computed from tool *results*, never from prompts.

**Taint Window** — the bounded scope (call count and wall-clock) during which Taint escalates subsequent `irreversible` or `external_send` actions.

**Tenant** — the isolation boundary. Enforced by Postgres RLS, not application logic. *Rejected synonyms: "organisation", "workspace", "account".*

**Tool** — a callable capability exposed by a Downstream Server.

**Tool Annotation** — the MCP-declared behavioural hints on a tool definition (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`). Treated as an untrusted **floor**, never a ceiling.

**Tool Drift** — a change in a Tool's fingerprint (name, description, input schema, annotations) after approval. The rug-pull signal.

**Tool Fingerprint** — the hash of a Tool's definition used to detect Tool Drift.

**Tool Poisoning** — injection phrasing or hidden characters in a Tool's description or annotations.

---

## 4. Features

Features are grouped so the four demands of v2 are unmistakable. **Group A** hardens the existing enforcement core. **Group B** delivers *exhaustive* supervision coverage. **Group C** delivers *ultra-easy* deployment. **Group D** delivers *transparency*.

Functional requirements are numbered globally `FR-1 … FR-152`. Each has testable **Consequences**. `[MVP]` marks inclusion in the v2.0 release (see §6).

---

### Group A — Enforcement Core (the thesis, hardened)

#### A1. Unified Decision Pipeline

**Description.** Today three Ingress Paths produce the same verdict vocabulary with materially different guarantees: the MCP gateway runs integrity, per-tool RBAC and taint; `/v1/authorize` runs none of them; the LLM proxy inspects after the fact and is blind to streaming. A customer cannot tell which guards protected them. v2 makes the Guard Pipeline a single shared function that every Ingress Path calls, so a guard can never again land on one path only, and every response declares which guards ran and in which Enforcement Mode.

**FR-1 `[MVP]` — Single guard pipeline.** All Ingress Paths evaluate the same ordered Guard Pipeline: halt → integrity → RBAC → budget → policy (classification + rule + constraints) → judge (only for `ambiguous`) → risk → taint → decision.
- **Consequences:** A single core function owns the sequence; no Ingress Path contains its own guard ordering. A test asserts that an irreversible call on `/v1/authorize` and the same call on the MCP gateway produce identical Decision, Decision Reason and Escalation Source given identical inputs. Adding a new guard requires one change and is automatically live on all paths.

**FR-2 `[MVP]` — Declared guard coverage.** Every decision response declares the guards that ran and the Enforcement Mode.
- **Consequences:** `AuthorizeResponse` and an `X-XSOM-Guards` response header list executed guards. The MCP path reports `enforcement_mode=mandatory`; SDK and proxy paths report `cooperative`. A customer can determine the strength of their integration from the response alone.

**FR-3 `[MVP]` — Enforcement Mode recorded.** Enforcement Mode is stored on every Audit Entry as an Annex Column and surfaced in every export and Evidence Pack.
- **Consequences:** Compliance reporting can distinguish mandatory from cooperative oversight. §13 states that cooperative decisions are disclosed as such and are not claimed as equivalent evidence.

**FR-4 `[MVP]` — Session-aware HTTP ingress.** `/v1/authorize` accepts a Session Id and an agent-declared digest of the preceding tool result so Taint applies on that path.
- **Consequences:** A taint-then-send sequence is escalated identically on the HTTP path. Absent session information on an `irreversible` action, the pipeline fails closed per FR-7.

**FR-5 — Streamed tool-call inspection.** The LLM proxy reassembles tool-call fragments from SSE deltas so streamed calls are at minimum classified and audited.
- **Consequences:** A streamed completion containing a tool call produces an Audit Entry. Where enforce mode cannot pause a stream, the response header declares `hitl=unavailable` and the entry records `enforcement_mode=cooperative`, rather than silently degrading `hold` to `strip`.

**FR-6 `[MVP]` — Multilingual and opaque tool classification.** Auto-classification heuristics cover French, Spanish and German stems in addition to English, and a Tenant may supply additional patterns in policy defaults.
- **Consequences:** `supprimer_client`, `envoyer_courriel`, `virement` and `enviar_correo` classify to the safe class. Opaque names (`t_0042`) still fall to `unknown_tool` and deny. A misclassification can never *relax* a tier; ordering by decreasing risk is preserved and tested.

**FR-7 `[MVP]` — Fail-closed on guard unavailability.** Any guard that cannot complete (database unreachable, halt state unresolvable, approval service down, session unresolvable) denies `irreversible` and `external_send` actions.
- **Consequences:** A test simulates each guard failing independently and asserts deny on irreversible. No guard failure results in an implicit allow. This restates CLAUDE.md §4.4 as an executable requirement across all paths.

---

#### A2. Policy Lifecycle Management

**Description.** A Policy Document is currently one row, overwritten in place. The prior text is destroyed, decisions cannot be joined to the policy that produced them, and there is no rollback, diff, simulation or staged rollout. That makes the policy unoperable at scale and un-auditable after the fact. v2 makes policy an append-only, versioned, testable artifact.

**FR-8 `[MVP]` — Immutable policy versions.** Every accepted policy change appends a retained version `(tenant_id, version, yaml, author, note, created_at)`; nothing is destroyed.
- **Consequences:** `GET /v1/policy/versions` lists history. The prior document is recoverable. Version numbers are monotonic per Tenant.

**FR-9 `[MVP]` — Policy version stamped on decisions.** The Policy Version in force is written to every Audit Entry as an Annex Column.
- **Consequences:** "Which rules were live when this happened?" is answerable by a join. **Invariant collision:** adding `policy_version` to the hashed Payload would break `verify_chain` on existing rows. **Resolution:** Annex Column; tamper-evidence for annex data comes from Checkpoints (FR-121), not from the Payload.

**FR-10 `[MVP]` — Diff and rollback.** `GET /v1/policy/diff?from=&to=` returns a structured rule-level diff; `POST /v1/policy/rollback/{version}` republishes a prior version as a new version.
- **Consequences:** Rollback never rewrites history; it appends. Both operations are Control-Plane Events (FR-35).

**FR-11 `[MVP]` — Policy simulation.** `POST /v1/policy/simulate` evaluates a candidate document against the last N Audit Entries and returns the decision delta (per tool: unchanged / relaxed / tightened).
- **Consequences:** Simulation is read-only and never executes an action. It reports honestly that argument-dependent guards (constraints, risk, DLP) can only be fully simulated when the Argument Vault (FR-136) is enabled, and marks those rows `indeterminate` rather than guessing.

**FR-12 — Staged rollout.** A policy version may be scoped to a Client or a named Agent set before tenant-wide promotion.
- **Consequences:** A canary Agent evaluates against version N+1 while the rest of the Tenant stays on N. The Audit Entry records which version applied to that Agent.

**FR-13 `[MVP]` — Policy templates.** A library of starter Policy Documents (finance, HR, DevOps, customer communication) is installable in one action and is the default offered at Bootstrap.
- **Consequences:** A new Tenant reaches a working, deny-by-default policy without authoring YAML. Every template ships with `unknown_tool: deny`.

**FR-14 — Deterministic policy export.** The Policy Document exports to a deterministic, human-readable authorization representation for external review.
- **Consequences:** The exported form is generated, never hand-maintained, and a test asserts it round-trips to the same decisions for a fixture corpus. `[ASSUMPTION: A-1]`

---

#### A3. Effective Human Oversight

**Description.** The product's central guarantee is a human in the loop. Today that human sees a tool name and a summary, cannot be joined by a second human because a Tenant can only ever have one, is not recorded in the chain at the moment they decide, and cannot give a reason. Oversight that is present but not *effective* does not satisfy the intent of human-oversight obligations, and it does not satisfy a buyer.

**FR-15 `[MVP]` — Human decision chained at decision time.** Approving or denying writes a chained Audit Entry synchronously, with the deciding Member's identity in `user_id` — inside the hashed Payload.
- **Consequences:** A denial is evidence even if the Agent never returns. Consumption at execution time writes a separate, linked entry, giving a three-link `hold → decide → execute` chain. **Invariant note:** this uses the *existing* `user_id` Payload field, so no Payload shape change is required and `verify_chain` stays green.

**FR-16 `[MVP]` — Mandatory justification.** The decision request requires a bounded free-text reason.
- **Consequences:** `DecisionRequest` carries `decision` and `reason` (bounded length, Pydantic-validated). A decision without a reason is rejected with 422. The reason is stored on the Approval Record and referenced from the Audit Entry. It is treated as potentially sensitive text and is subject to §17 handling.

**FR-17 `[MVP]` — Decision Brief.** The approval surface presents the full Decision Brief as defined in §3.
- **Consequences:** Action class, requesting Agent and Client, deterministic Dry-Run, Risk Score with factor breakdown, Escalation Source, taint and integrity banners, live expiry countdown labelled "expiry = denial", and the tool's recent decisions. All fields except the risk breakdown already exist server-side.

**FR-18 `[MVP]` — Effective expiry.** Expiry is derived in the read path, not only when an Agent polls.
- **Consequences:** An approval past its deadline never renders as pending in the console or the API. A sweeper additionally writes the `expired` Audit Entry and fires an alert so oversight statistics do not silently under-count.

**FR-19 `[MVP]` — Separation of duties.** The requester of an action cannot approve it; `human_dual` requires two distinct Members.
- **Consequences:** A self-approval attempt returns 409 with an explicit reason. A test asserts `human_dual` cannot be satisfied by one Member. This requires FR-79 (membership) to be usable at all — until then the tier is structurally unreachable and the console says so rather than offering it.

**FR-20 `[MVP]` — Approver routing.** Approvals route to a configured approver group or channel per Tenant, with escalation on approaching expiry.
- **Consequences:** A Tenant defines recipients; a global deployment-wide address is no longer possible. Approaching-expiry escalation fires before the deadline, not after.

**FR-21 `[MVP]` — Decide where the human works.** Approve/deny is possible from a signed interactive channel message (Slack-style) as well as the console.
- **Consequences:** Median time-to-decision is measured (SM-5). **Invariant note (CLAUDE.md §4.1):** the channel is how the human is *asked*; the decision is still recorded and enforced by the gateway. A channel callback is authenticated and authorized identically to the console; it never bypasses RBAC or Separation of Duties.

**FR-22 — Native protocol elicitation.** Where the client supports it, the approval request uses the MCP-native input-required mechanism instead of a tool error string, with the error-string form retained as a compatibility fallback.
- **Consequences:** A conforming host renders an approval natively. The verdict remains the gateway's; elicitation is a presentation channel only. `[ASSUMPTION: A-2]`

---

#### A4. Emergency Stop and Containment

**Description.** There is no way to stop a running Agent. Revoking a Gateway Token blocks new sessions only; an already-authenticated MCP session keeps acting until its process exits, and incident response today is "ask the customer to kill the process". A supervision product must own this primitive; it is also an explicit human-oversight obligation.

**FR-23 `[MVP]` — Halt scopes.** Halt is settable at Tenant, Agent and Tool scope.
- **Consequences:** `POST /v1/control/halt` and `/resume` with a scope and a mandatory reason. State is queryable. Each scope is independently testable.

**FR-24 `[MVP]` — Halt is effective on live sessions.** Halt state is re-checked on every tool call, including sessions authenticated before the halt.
- **Consequences:** A test halts a Tenant mid-session and asserts the next call is denied at the gateway before the Downstream Server is contacted. The check reuses the connection already opened for risk/trust, so it adds no additional round trip.

**FR-25 `[MVP]` — Halt fails closed.** If halt state cannot be read, `irreversible` and `external_send` actions are denied.
- **Consequences:** Covered by the FR-7 guard-failure matrix.

**FR-26 `[MVP]` — Halt is reachable in one action.** Halt is a single control on the Agent page and on every alert, requiring no separate console, ticket, or database access.
- **Consequences:** A journey test (UJ-5) measures clicks from alert to effective halt. Target: one.

**FR-27 `[MVP]` — Halt is audited.** Halt and Resume are Control-Plane Events with actor identity and reason.
- **Consequences:** The post-mortem timeline is the audit chain. `halted` appears as a Decision value on denied calls.

**FR-28 — Automatic containment.** A configurable, opt-in rule may auto-halt an Agent on a defined trigger (Behavioural Drift beyond threshold, budget breach, repeated poison quarantine).
- **Consequences:** Off by default. Every auto-halt writes a Control-Plane Event with `actor_type=system` and notifies. A halted Agent is never auto-resumed.

---

#### A5. Risk, Trust and Graduated Autonomy Made Operable

**Description.** M11 shipped a sound deterministic Risk Score, Risk Bands and Earned Trust — and then threw the score away on the stack. It is never persisted, never returned, never displayed. An operator asked to configure Risk Bands has no data on the score distribution their own traffic produces, so the flagship graduated-autonomy feature cannot be tuned and stays off. Worse, Earned Trust is keyed tenant-wide, so one well-behaved Agent discounts risk for a freshly compromised one.

**FR-29 `[MVP]` — Persist the score and its factors.** `risk_score` and `risk_factors` (factor names and integer points only) are written as Annex Columns.
- **Consequences:** A held action is explainable after the fact. **Invariant note (§4.10):** factors carry names and points, never argument values; a test asserts no argument-derived string reaches the column.

**FR-30 `[MVP]` — Return the score.** Risk Score and Risk Band are returned in the authorization response and in the tool view.
- **Consequences:** `AuthorizeResponse` and `ToolView` carry `risk_score` and `risk_band`. Agents and operators see the same number the engine used.

**FR-31 `[MVP]` — Score distribution for tuning.** The console shows a histogram of observed Risk Scores per Tenant and per Agent.
- **Consequences:** Risk Bands can be set from observed data rather than guessed. The band editor previews how many past decisions each candidate band would have changed.

**FR-32 `[MVP]` — Per-agent Earned Trust.** Earned Trust is keyed on `(tenant, agent, tool)`, not `(tenant, tool)`.
- **Consequences:** A new or compromised Agent starts with no discount regardless of its siblings' history. A test asserts Agent B's streak does not discount Agent A. This depends on FR-40 (agent attribution on the gateway path).

**FR-33 `[MVP]` — The irreversible floor holds.** No score, discount, annotation or trust streak can place an `irreversible` action in `auto`.
- **Consequences:** Existing floor test retained and extended to cover annotation-derived and trust-derived paths.

**FR-34 — Tenant-scoped judge budget.** The LLM judge's call cap is enforced over a persistent, tenant-scoped time window.
- **Consequences:** The cap is reachable on HTTP paths, where a per-request judge object currently resets the counter to zero on every call and makes the documented cost guardrail inert. Exhaustion over-classifies to `irreversible` (fail-closed), as today.

---

### Group B — Exhaustive Supervision Coverage

#### B1. Control-Plane Supervision — supervising the supervisors

**Description.** This is the single biggest credibility gap in the product. The hash chain covers every agent action and **no human action on the control plane**. An administrator can relax the policy to allow an unknown tool, let the agent act, and restore it, leaving only ordinary-looking `allow` rows. For a product whose entire pitch is a tamper-evident record, the record omits exactly the actor a reviewer most needs to see.

**FR-35 `[MVP]` — Actor dimension.** Audit Entries carry `actor_type` ∈ `human | agent | system`.
- **Consequences:** The audit explorer filters by actor type. `[ASSUMPTION: A-3]` **Invariant note:** implemented as an Annex Column; the human's identity itself uses the existing in-Payload `user_id` field so the actor identity is chain-protected.

**FR-36 `[MVP]` — Every control-plane mutation is chained.** The following write Control-Plane Events: policy updated, rolled back and promoted; Gateway Token and Read Token minted and revoked; approval decided; tool re-baselined after drift; DLP configuration changed; provider credential connected and revoked; Member added, role changed and removed; Downstream Server created, modified and disabled; halt and resume; erasure executed; retention purge executed; Budget changed; Event Sink created and revoked; anchor published.
- **Consequences:** A test enumerates every mutating route in `api/` and fails if any writes no Audit Entry. That test is the enforcement mechanism, not a convention.

**FR-37 `[MVP]` — Content discipline on control-plane events.** Control-Plane Events record a change *digest* and metadata, never the mutated secret or full document.
- **Consequences:** A token mint event records the token id and never the token. A policy update event records the version and a diff digest, never the YAML body. Enforced by `scripts/audit_security.py`.

**FR-38 `[MVP]` — Attribution is mandatory.** A control-plane mutation performed without a resolvable human or system actor is rejected.
- **Consequences:** No anonymous control-plane change is possible. Automated changes carry `actor_type=system` plus the initiating job identifier.

**FR-39 — Control-plane review surface.** The console offers a chronological control-plane view, filterable by actor and object, independent of agent traffic.
- **Consequences:** UJ-8's reviewer sees policy relaxation and restoration bracketing a burst of allows without writing a query.

---

#### B2. AI System Registry, Agent Identity and Delegation

**Description.** An "agent" today is a token row with a name. There is no owner, purpose, model, framework, environment, risk tier or lifecycle — so there is nothing for an AI-system inventory obligation to read, and compliance reports on a Tenant rather than a system. On the flagship MCP path the token id is not even carried into the audit entry, so per-agent attribution is `NULL` and per-agent trust is impossible. And an orchestrator spawning ten sub-agents through one token is indistinguishable from one agent.

**FR-40 `[MVP]` — Agent attribution on every path.** The resolved Gateway Token id is threaded into every Audit Entry, including gate events, on the MCP path.
- **Consequences:** A regression test asserts a gateway-relayed call produces an entry with non-null agent attribution. Per-agent dashboards and the agent filter stop returning empty for gateway traffic. This unblocks FR-32.

**FR-41 `[MVP]` — AI System registry.** AI Systems are first-class: owner, business purpose, model, framework and version, environment, risk tier, data categories, lifecycle state, linked documentation.
- **Consequences:** Gateway Tokens become credentials *pointing at* an AI System. Compliance status and Evidence Packs render per AI System (FR-127). A Tenant-level view remains available as an aggregate.

**FR-42 `[MVP]` — Registry completeness gate.** An AI System missing required governance fields is reported as `incomplete` in compliance status and its gaps are itemised.
- **Consequences:** Compliance readiness cannot be green while the inventory is unpopulated. The console links each gap to the field that fixes it.

**FR-43 `[MVP]` — Delegation lineage captured.** `parent_request_id`, `delegation_subject`, `originating_principal` and `call_depth` are recorded as Annex Columns and propagated through the MCP call context and the `/v1/authorize` payload.
- **Consequences:** A sub-agent call is attributable to its parent and to the originating human request. The audit explorer renders the delegation tree. Capturing lineage does not require the delegation credential model of FR-44 and ships independently.

**FR-44 — Scoped child credentials.** An Agent may mint a short-lived child credential whose authority is a strict subset of its own.
- **Consequences:** A child can never exceed its parent's Approval Tier for any Action Class; an attempt is denied and audited. Policy defaults cap `call_depth`; exceeding the cap fails closed.

**FR-45 — Federated agent identity.** Agents may authenticate with a short-lived, IdP-issued workload identity in addition to `xsg_` tokens.
- **Consequences:** Per-tool RBAC binds to the verified identity rather than a static token row. Static tokens remain supported and are marked in the console as long-lived credentials with a rotation reminder. `[ASSUMPTION: A-4]`

**FR-46 `[MVP]` — Credential hygiene surfaced.** Token age, last use and rotation status are visible per Agent.
- **Consequences:** A never-rotated, long-lived credential is visible without a query. No automatic revocation — that is FR-23's business, deliberately human-triggered.

**FR-47 `[MVP]` — Revocation is effective immediately.** Revoking a Gateway Token stops the Agent's next call, not merely its next session.
- **Consequences:** Same enforcement point as FR-24. A test revokes mid-session and asserts the next call is denied.

---

#### B3. Universal Ingress — SDK, framework adapters, standards interop

**Description.** xSOM enforces where it sits. Most agents are not MCP: they are LangGraph nodes, OpenAI Agents SDK function tools, Claude Agent SDK tool calls, CrewAI tasks. Each of those exposes a clean pre-execution interception point, and `/v1/authorize` is already the right server-side answer — there is simply no client. "We govern your agents" is not defensible if it means "we govern the subset that uses MCP".

**FR-48 `[MVP]` — Client SDK.** A minimal Python and TypeScript client whose surface is one call: ask for a decision on a tool and arguments, receive a verdict and an approval id.
- **Consequences:** No policy logic in the client. The client is a request/response wrapper; the decision is always the server's.

**FR-49 `[MVP]` — Client-side fail-closed.** On network failure or ambiguous response, the client denies `irreversible` and `external_send` by default.
- **Consequences:** Default is deny; relaxing it requires an explicit, documented opt-in that the client logs loudly at startup.

**FR-50 `[MVP]` — Framework adapters.** Thin adapters for the LangGraph/LangChain human-in-the-loop hook, the OpenAI Agents SDK approval callback, the Claude Agent SDK pre-tool hook, and CrewAI.
- **Consequences:** Each adapter routes the framework's own approval hook to xSOM. **Invariant collision (CLAUDE.md §4.1):** letting the framework decide would delegate HITL away from the gateway. **Resolution:** the framework *asks*, xSOM *decides and records*; the framework never becomes the authority. The adapter's role is transport, and the resulting entries are marked `enforcement_mode=cooperative` (FR-3) so the weaker trust boundary is disclosed, never hidden.

**FR-51 `[MVP]` — Honest strength labelling.** Documentation and the console state plainly that SDK-mediated enforcement is cooperative and that the MCP gateway is mandatory.
- **Consequences:** The onboarding wizard recommends the MCP path for irreversible-heavy workloads. §13 forbids claiming cooperative decisions as equivalent oversight evidence.

**FR-52 — Standards-shaped decision façade.** An interop endpoint accepts a standardised pre-tool-call request shape and returns a standardised verdict, mapping onto the existing engine.
- **Consequences:** Tier mapping is deterministic and documented (`notify` → warn, `human_in_the_loop`/`human_dual` → escalate). The bespoke API remains the primary contract; the façade adds no new decision logic. `[ASSUMPTION: A-5]`

**FR-53 `[MVP]` — Tool annotations as a safety floor.** MCP Tool Annotations are consulted before name heuristics and act only as a floor.
- **Consequences:** `destructiveHint: true` yields at least `irreversible`; `openWorldHint: true` yields at least `external_send`; `readOnlyHint: true` may hint `read` but **never** relaxes an explicit Rule or a higher-classified name match. A test asserts a hostile `readOnlyHint: true` on a tool named `delete_all` cannot reduce its class.

**FR-54 `[MVP]` — Annotations in the fingerprint.** Tool Annotations are included in the Tool Fingerprint.
- **Consequences:** Flipping `destructiveHint` from true to false between two tool listings is Tool Drift and quarantines the tool. This closes a hole in the supply-chain shield that M10 was built to cover.

**FR-55 — Forward compatibility with stateless MCP.** No enforcement state depends on the MCP protocol session or the initialize handshake.
- **Consequences:** Taint, quarantine and trust key off the durable Session (FR-56), persisted in Postgres. An unresolvable Session on an `irreversible` action is treated as tainted, never as clean. Full transport conformance to the 2026-07-28 revision is scoped out of v2.0 (§6.2) pending SDK support, but v2.0 must not add new dependencies on the protocol session. `[ASSUMPTION: A-6]`

---

#### B4. Session Lineage and Incident Reconstruction

**Description.** The model plane and the action plane share nothing. Usage events carry span, trace and session ids; audit entries carry a request id that means three different things on three paths and no session or trace id at all. So "a customer got a bad email — show me the conversation, the model, the cost and the approval that led to it" is not answerable by any query the schema supports.

**FR-56 `[MVP]` — Durable Session identity.** A Session Id is accepted at every Ingress Path (derived from trace context where available, declared otherwise) and persisted.
- **Consequences:** Session identity survives process restarts and reconnects. It is the key for Taint (FR-62) and lineage.

**FR-57 `[MVP]` — Session and trace on audit entries.** `session_id` and `trace_id` are recorded as Annex Columns.
- **Consequences:** Audit and usage records join. **Invariant note:** Annex Columns, per §4.2.

**FR-58 `[MVP]` — Stable correlation id per call.** One correlation id is generated per tool call and shared by the decision entry and every gate entry it produces.
- **Consequences:** A `tainted_action` entry links to the `taint_marked` entry that caused it, and `rbac_denied` records which Agent was denied. Reconstructing causality no longer requires eyeballing timestamps.

**FR-59 `[MVP]` — Session timeline.** `GET /v1/sessions/{id}` stitches model interactions, decisions, approvals and outcomes into one ordered timeline, rendered in the console.
- **Consequences:** UJ-4's investigation is a single page. The timeline states plainly when a link is unavailable rather than inferring one.

**FR-60 `[MVP]` — Evaluate-only replay.** The Inspector runs a candidate tool call through the full Guard Pipeline in evaluate-only mode and returns the complete reasoning chain without executing anything.
- **Consequences:** No Downstream Server is contacted; a test asserts zero downstream invocations during replay. This delivers the replay capability the original specification promised and never shipped.

**FR-61 `[MVP]` — Inspector shows the runtime truth.** The Inspector's tool view is labelled as a baseline tier and declares integrity status, presence of constraints, and whether Risk Bands may escalate it.
- **Consequences:** A quarantined tool is never displayed as available. A tool that risk may escalate shows a tier range, not a single optimistic green tier.

---

#### B5. Durable Taint and Behavioural Drift

**Description.** M12's taint guard is genuinely differentiated and structurally fragile: it lives in process memory on a per-connection object. An orchestrator that opens a fresh session per task — the common pattern — resets taint to clean every time. Separately, drift detection covers tool *definitions* only; an agent that quietly starts doing ten times more external sends raises nothing, because the only novelty signal is a boolean.

**FR-62 `[MVP]` — Persisted taint.** Taint state persists to a `session_taint` table keyed on `(tenant_id, session_id)` with source tool, marked-at timestamp, and both a call-count and a wall-clock window.
- **Consequences:** Taint survives reconnection and applies across Ingress Paths. Tenant isolation by RLS. A test reconnects mid-session and asserts taint still applies.

**FR-63 `[MVP]` — Taint is visible.** Taint state is surfaced in the console, on the Decision Brief, and on the session timeline.
- **Consequences:** An operator can see which sessions are tainted and why without reading raw audit rows.

**FR-64 — DLP participates in post-taint decisions.** An exfiltration-shaped target in the arguments of a post-taint action raises the verdict.
- **Consequences:** A recipient outside the allowlist in a post-taint `external_send` escalates. Detection is metadata-only; matched values are never stored.

**FR-65 `[MVP]` — Behavioural baseline.** A rolling per-`(agent, tool)` baseline is computed from Audit Entries: call rate, action-class mix, blast-radius distribution, deny rate.
- **Consequences:** Computed deterministically from existing data. No new content is collected. No machine learning (§5).

**FR-66 `[MVP]` — Behavioural Drift raises an event.** Deviation beyond a configured threshold writes a `behavior_drift` Audit Entry and notifies.
- **Consequences:** Thresholds are per-Tenant and opt-in, off by default per the backward-compatibility rule. A model version change on a registered AI System is itself a drift trigger.

**FR-67 — Drift feeds the risk score.** Behavioural Drift contributes a graduated factor to the Risk Score, replacing the current binary novelty bit.
- **Consequences:** Deterministic and bounded; cannot alone push an action to `deny` without a configured band. The novelty factor remains for genuinely first-seen pairs.

**FR-68 `[MVP]` — Poison reason is persisted and shown.** The reason a Tool was quarantined as poisoned is stored on the fingerprint and returned by the integrity API.
- **Consequences:** An operator sees *why* a tool is quarantined without reading audit rows. The `poison` status becomes reachable through the API instead of existing only transiently at listing time.

---

#### B6. Outcome Supervision

**Description.** xSOM supervises permission and never correctness. That is the right wedge and it has an honest extension that does not become model evaluation: an *allowed action* has an observable outcome, and today that outcome (the downstream error flag) is computed and discarded as a boolean. Supervising outcomes of actions is defensible; scoring model output is not (§5).

**FR-69 `[MVP]` — Capture action outcome.** The downstream result status of an allowed action is recorded as structured metadata.
- **Consequences:** Success, downstream error, and timeout are distinguishable. **Invariant note (§4.10):** status and error class only; never the result body.

**FR-70 `[MVP]` — Outcome rates per agent and tool.** Success, failure and refusal rates are derived and displayed.
- **Consequences:** An Agent whose failure rate jumps is visible. Refusal detection is a documented, deterministic classifier over error type, not a judgement of quality.

**FR-71 — Operator incident labelling.** An operator may label a decision or a session as an incident with a bounded category and note.
- **Consequences:** Labels are Control-Plane Events (FR-36). Labels never alter the decision record; they annotate it.

**FR-72 — Post-incident linkage.** Labelled incidents are linkable to the policy version, agent, session and approval involved.
- **Consequences:** The incident view is a saved query over existing lineage, not a new data plane.

**FR-73 `[MVP]` — No model quality claims.** Outcome supervision reports only what is observable at the action boundary.
- **Consequences:** No groundedness score, no hallucination metric, no golden-set evaluation ships. The console explicitly names what it does not measure and recommends an evaluation tool for that job.

---

#### B7. Budget, Quota and Consumption Control

**Description.** Cost is measured with precision and enforced not at all. The only throttle is keyed by client IP with no shared storage — so it is per-process, useless across replicas, and simultaneously punishes tenants behind one egress IP while a tenant with many IPs bypasses it entirely.

**FR-74 `[MVP]` — Tenant-keyed rate limiting with shared storage.** Rate limits key on the resolved Tenant or Agent, backed by shared storage so limits hold across replicas.
- **Consequences:** A test asserts two API replicas share one bucket. IP-keyed limiting remains only for unauthenticated surfaces. `[ASSUMPTION: A-7]`

**FR-75 `[MVP]` — Budgets.** A Budget defines a cap over a period at Tenant or Agent scope, with a warn threshold and a breach action.
- **Consequences:** Checked before a model call is forwarded and before a costly action proceeds. Breach fails closed to deny; warn fires an alert.

**FR-76 `[MVP]` — Budget events are audited.** Budget changes are Control-Plane Events; budget-caused denials record `decision_reason=budget`.
- **Consequences:** "Why did the agent stop?" is answerable without a support ticket.

**FR-77 `[MVP]` — Cost correctness.** Cached-read, cache-creation and reasoning token counts are captured and priced distinctly.
- **Consequences:** Cost stops systematically overstating spend for cache-heavy traffic. A finance-facing number that is wrong is worse than absent, so the ledger displays estimated versus provider-billed side by side.

**FR-78 — Connection efficiency.** The control API uses a process-wide connection pool rather than opening a connection per operation.
- **Consequences:** Call sites are unchanged. **Invariant note (§4.3):** tenant-scoped role and JWT-claim settings must remain transaction-local; a test asserts a recycled connection cannot read another Tenant's rows. Requires a dependency justification in the PR per CLAUDE.md §3. `[ASSUMPTION: A-8]`

---

#### B8. Organisation, Membership and Identity Federation

**Description.** A Tenant can never have a second user. The only membership insert in the codebase is the admin created at signup: there is no invite, no member list, no role change. That makes `human_dual` — a tier the policy engine, the schema and the marketing all advertise — structurally impossible to satisfy in any real deployment, and makes Separation of Duties unenforceable.

**FR-79 `[MVP]` — Membership plane.** Invite, list, change role and remove Members, admin-only and audited.
- **Consequences:** RLS gains the corresponding write policies; application checks alone are insufficient per §4.3. A test asserts a non-admin cannot add a Member through either the API or direct SQL under RLS.

**FR-80 `[MVP]` — `human_dual` becomes reachable.** With two or more Members, `human_dual` is satisfiable and enforced as two distinct deciders.
- **Consequences:** The tier is offered in the policy editor only when the Tenant has enough Members; otherwise the editor explains why.

**FR-81 — Scoped operators.** An operator's approval authority may be scoped to Clients or AI Systems.
- **Consequences:** A tenant-wide operator is no longer the only option. Scope is enforced server-side, not by hiding UI.

**FR-82 — Identity federation.** Console authentication supports the customer's OIDC provider through a generic JWKS issuer interface, with IdP group to Role mapping.
- **Consequences:** The current provider becomes one implementation rather than a hard dependency — which also unblocks the self-host path (FR-85). SAML and SCIM are scoped out of v2.0 (§6.2).

**FR-83 — Step-up for high-risk approvals.** A Tenant may require re-authentication before deciding an approval above a Risk Score threshold.
- **Consequences:** Off by default. A step-up failure denies the approval action, never the underlying agent action implicitly.

**FR-84 `[MVP]` — Break-glass is explicit.** Any emergency elevation is a named, time-boxed, heavily audited operation.
- **Consequences:** Break-glass writes a Control-Plane Event and notifies all admins. There is no silent elevation path.

---

### Group C — Ultra-Easy Deployment

> This group is the release's headline promise. It is treated as product, not as documentation: deployment defects ship to main today precisely because CI proves the code is correct and never proves it is deployable.

#### C1. One-Command Self-Host

**Description.** There is no self-host path — not an awkward one, none. No compose file, no frontend image, no migration runner, and a build context that excludes the SQL the container would need to migrate itself. Meanwhile the proven reference posture in this category is open-source-core with first-class self-hosting. An air-gapped or sovereign buyer cannot evaluate xSOM at all.

**FR-85 `[MVP]` — `docker compose up` brings up a working stack.** Database, control API, console, and a seeded demo Tenant, bound to localhost by default.
- **Consequences:** No cloud account required. No hand-written SQL. The demo Tenant is clearly marked and refuses to start under `ENV=prod` without an explicit flag.

**FR-86 `[MVP]` — The console is containerised.** A frontend image exists and is built in CI.
- **Consequences:** The console is deployable by the same mechanism as the API.

**FR-87 `[MVP]` — Auth is not a hard SaaS dependency.** Authentication resolves through a pluggable JWKS issuer so the hosted provider is optional.
- **Consequences:** A supported, reviewed authentication compatibility layer for plain Postgres replaces the test-only fixture. **Invariant note (§4.3):** the layer must create the privileged role with RLS bypass exactly as the hosted provider does, so RLS remains genuinely enforced; the existing RLS test suite must pass unmodified against it.

**FR-88 `[MVP]` — The image can migrate itself.** Migrations and the migration runner are present in the build context.
- **Consequences:** The `.dockerignore` exclusions that make self-migration physically impossible are corrected, verified by a test that runs migration inside the built image.

**FR-89 `[MVP]` — No vendor URL in any artifact.** No generated snippet, page or default points at a vendor-operated host.
- **Consequences:** The agent-facing base URL is configuration, defaulting to the local origin. A test asserts no rendered onboarding artifact contains a vendor hostname. **This is a security requirement, not a cosmetic one:** the current hardcoded default routes a self-hosting customer's own provider API keys, in the request path, to someone else's server.

**FR-90 — Orchestrated deployment.** A Helm chart is published for cluster deployment.
- **Consequences:** Non-root containers, externalised secrets, configurable ingress. `[ASSUMPTION: A-9]`

---

#### C2. Zero-SQL Bootstrap and the `xsom` CLI

**Description.** Self-serve signup that provisions a Tenant, a membership and the identity claim atomically already exists and is fully wired to the console — and is permanently disabled because the environment variable that enables it appears in neither the example environment file nor the deployment guide. So every new deployer hits a dead signup page and is pushed back to hand-writing three SQL statements, one of which requires hunting a UUID in a dashboard. Roughly 70% of a one-command experience already exists; the gap is packaging.

**FR-91 `[MVP]` — Bootstrap without SQL.** `xsom init` creates the Tenant, the admin Member and the first Gateway Token in one command, printing the token exactly once.
- **Consequences:** The deployment guide contains no SQL. A test asserts a fresh database reaches a usable Tenant through the CLI alone.

**FR-92 `[MVP]` — Signup enabled by default where it can be.** Self-serve signup is enabled whenever its prerequisite is configured, and its prerequisite is documented in the example environment file and the deployment guide.
- **Consequences:** The three configuration keys that exist as settings but appear in no documentation are added, with a backend-only warning per §4.6.

**FR-93 `[MVP]` — Errors are actionable.** A disabled or misconfigured capability returns a message naming the specific configuration that would enable it.
- **Consequences:** "Signup is not enabled" becomes "signup disabled: set the service-role key on the backend". **Invariant note (§4.8):** actionable means naming the missing setting, never leaking its value, a stack trace, or a DSN.

**FR-94 `[MVP]` — CLI surface.** `xsom` provides `init`, `migrate`, `bootstrap`, `token mint`, `token revoke`, `halt`, `resume`, `verify-chain`, `export`, and `doctor`.
- **Consequences:** Registered as a console entry point. Every command works against a self-hosted or hosted deployment. `doctor` diagnoses configuration and connectivity and prints remediation.

**FR-95 `[MVP]` — Destructive CLI operations are guarded.** Commands that create or destroy state refuse to run against a production environment without an explicit flag.
- **Consequences:** Fail-closed default. Every CLI mutation writes a Control-Plane Event.

**FR-96 `[MVP]` — Correct integration snippets.** Generated snippets use the actual environment variable names the runtime reads, and include a complete, copy-pasteable client configuration.
- **Consequences:** The current mismatch — the wizard exports one variable name and the gateway reads another, with no overlap anywhere in the repository — is fixed and regression-tested. The placeholder comment that stands in for MCP client configuration is replaced with a real configuration block.

---

#### C3. Schema Migration and Upgrade Path

**Description.** Fifteen migration files are applied only by the test harness and the demo script — never by CI, never by the container, never by a make target. There is no ledger, several migrations are not re-runnable, and the sequence silently skips a number so completeness cannot be checked by counting. The deployment guide says there are five and embeds the maintainer's own project reference as if it were the reader's.

**FR-97 `[MVP]` — Migration ledger.** A `schema_migrations` table records applied version and checksum.
- **Consequences:** An operator can always determine what is applied. A checksum mismatch on an applied migration is a hard error, not a warning.

**FR-98 `[MVP]` — Idempotent forward-only runner.** `xsom migrate` applies pending migrations in order, safely re-runnable.
- **Consequences:** The runner is importable from production code and does **not** import the test package; the current dependency direction is reversed so the test harness imports the shared runner instead.

**FR-99 `[MVP]` — Migration integrity is enforced in CI.** Filename contiguity and checksum stability are checked.
- **Consequences:** A silent numbering gap cannot recur. A modified already-released migration fails CI.

**FR-100 `[MVP]` — Documented upgrade path.** Upgrading between released versions is a documented, tested sequence.
- **Consequences:** A CI job migrates a database seeded at the previous release to the current head and asserts `verify_chain` remains green across the upgrade. This is the concrete test that the chain survives schema evolution.

**FR-101 `[MVP]` — Placeholders, not vendor values.** All deployment documentation uses placeholders.
- **Consequences:** No live project reference, hostname or identifier belonging to the maintainer appears in documentation.

---

#### C4. Readiness and Deployment Verification

**Description.** The health endpoint returns a static literal, so the deployment platform's healthcheck reports a completely non-functional deploy as healthy — wrong DSN, unmigrated database, unreachable issuer, all green. And CI proves correctness while proving nothing about deployability, which is exactly why five independent deployment defects shipped to main simultaneously: none of them was a code-correctness defect.

**FR-102 `[MVP]` — Liveness and readiness are separate.** Liveness stays static and unauthenticated. Readiness returns unhealthy unless the database connects, the schema is at the bundled head, and the auth issuer resolves.
- **Consequences:** Platform healthchecks point at readiness. **Invariant note (§4.8):** readiness reports booleans and counts only — never a DSN, a secret, or a stack trace.

**FR-103 `[MVP]` — Capability reporting.** Readiness reports which optional capabilities are configured as warnings, not failures.
- **Consequences:** An operator sees at a glance that signup, judge, DLP or egress are unconfigured without the deployment being marked down.

**FR-104 `[MVP]` — Environment file boots.** Copying the example environment file and starting the application succeeds.
- **Consequences:** A CI test instantiates settings from the shipped example file and boots the application. **This is a blocker today:** the literal shipped value for the CORS allowlist cannot be parsed, so the documented quickstart crashes about two minutes in — and the existing test suite is structurally blind to it because every test passes that field as an initialisation keyword, bypassing the source that fails.

**FR-105 `[MVP]` — Deployment smoke in CI.** A workflow brings the stack up, migrates, bootstraps, asserts readiness, mints a token, asserts an irreversible action is held and not executed, and verifies the chain.
- **Consequences:** "Ultra-easy to deploy" becomes a gate rather than a claim. This is also the correct home for the end-to-end demonstration the definition of done already requires. The gate is validated by deliberately reintroducing each known deployment defect and confirming it fails. `[ASSUMPTION: A-12]`

**FR-106 `[MVP]` — Demo needs only Docker.** The end-to-end demonstration runs against the composed stack.
- **Consequences:** The demonstration stops being gated behind root-level package installation of database server binaries, and stops importing the test harness. Prerequisites in the README are corrected to match reality.

---

#### C5. Zero-Config Safe Defaults and Onboarding

**Description.** "Ultra-easy" must not mean "insecure by default". Every default that reduces friction must fail toward control, and the onboarding path must produce a working, honest configuration rather than an optimistic one.

**FR-107 `[MVP]` — Safe defaults everywhere.** Out of the box: `unknown_tool: deny`, irreversible actions require a human, Risk Bands off, taint off, auto-halt off, egress off.
- **Consequences:** A zero-configuration deployment is restrictive, not permissive. Every opt-in control states its default explicitly in the console and in `docs/CAPABILITIES.md` — an operator who does not know a control exists cannot consent to it.

**FR-108 `[MVP]` — Guided first policy.** Onboarding proposes a policy from the discovered tool inventory, showing the classification and its source per tool.
- **Consequences:** The operator accepts or edits before anything is applied; nothing is auto-applied silently. Tools classified only by name heuristic are visibly marked as such.

**FR-109 `[MVP]` — Progressive capability activation.** The console shows which capabilities are active, which are available but unconfigured, and exactly what each needs.
- **Consequences:** Backend capability with no operator surface is not counted as shipped (see FR-110).

**FR-110 `[MVP]` — Every shipped control has an operator surface.** Compliance status, tool integrity and quarantine, trust and risk bands, taint, halt, budgets, sessions and egress each have a console page.
- **Consequences:** A quarantined tool — which an Agent cannot see until a human acts — is no longer a dead end reachable only by direct API call. A definition-of-done rule: a backend capability without a console surface does not ship.

**FR-111 `[MVP]` — Bounded, validated configuration.** Downstream Server configuration is bounded in size and depth, key-validated, and rejects inline secrets.
- **Consequences:** A value matching a secret pattern is rejected with an instruction to use an environment reference. Configuration is readable only by admins; lower-privileged Roles see name, transport and enabled state. This closes the one place in the codebase where a credential can be stored in clear text and read by a viewer.

**FR-112 `[MVP]` — Console language parity.** The console is available in English and French.
- **Consequences:** Parity is tested for the approval and audit surfaces at minimum. This serves the stated launch market and pairs with FR-6.

---

### Group D — Transparency

#### D1. Self-Explaining Decisions

**Description.** Transparency is asymmetric today: strong at the storage layer, near zero at the disclosure layer. The policy engine computes a precise reason for every decision — unknown tool, constraint violated, auto-classified, judge, risk, taint — returns it to the caller, and then discards it. So an audit row saying `deny` on a tool cannot tell a human whether the rule denied, a constraint was violated, or the tool was unknown. That is the single most important question an auditor asks.

**FR-113 `[MVP]` — Decision Reason and Escalation Source persisted.** Both are written as Annex Columns on every Audit Entry, from every producer.
- **Consequences:** Every decision is self-explaining without interpretation. A test asserts every produced entry has a non-null Decision Reason. **Invariant collision:** these would ideally be in the hashed Payload. **Resolution:** Payload v1 is frozen (§4.2), so they are Annex Columns, and Checkpoints (FR-121) provide their tamper-evidence. §18 states this limitation explicitly rather than implying the chain covers them.

**FR-114 `[MVP]` — `error` means error.** The `error` field carries genuine execution failures only.
- **Consequences:** The four overloaded conventions currently multiplexed through it move to Decision Reason with an enumerated vocabulary documented in `docs/AUDIT_FORMAT.md`. A field named `error` stops being the primary carrier of policy rationale, which misleads every auditor who reads the column name.

**FR-115 `[MVP]` — Gate events are first-class.** Gate entries carry the same dimensions as decision entries: correlation id, Canonical Tool Name, agent attribution, action class, Decision Reason.
- **Consequences:** No orphan rows. `rbac_denied` records which Agent was denied — without which a confused-deputy guard's audit trail defeats its own purpose.

**FR-116 `[MVP]` — Audit explorer shows the truth.** The explorer displays timestamp, decision, reason, escalation source, agent, policy version and enforcement mode, with filters bound to the existing query parameters and a row detail drawer.
- **Consequences:** The flagship "read the chain" surface stops being a flat, unfilterable, timeless list. The drawer shows every field including chain hashes, the risk breakdown, linked gate entries and the linked approval with its deciders.

**FR-117 `[MVP]` — Explanation is machine-readable.** The reasoning chain is available as structured data, not only rendered prose.
- **Consequences:** A customer can build their own review tooling. The structure is versioned per §15.

**FR-118 `[MVP]` — No generated prose in verdicts.** LLM-generated text may appear only in narrative sections, never as or alongside a control verdict.
- **Consequences:** Evidence Pack control verdicts are computed deterministically. Narrative sections are labelled as generated. This preserves CLAUDE.md §4.1 at the disclosure layer.

---

#### D2. Independent Chain Verification and External Anchoring

**Description.** The hash chain is real and the append-only triggers are real. But nothing that *leaves* the system carries proof: exports omit `prev_hash`, `entry_hash` and even `tenant_id`, which is inside the hashed payload — so an auditor holding the complete export cannot recompute a single hash and must trust a vendor-asserted boolean. Verification requires the backend's own database credentials. And the chain's only root is a constant string, so anyone who can write to the database can rebuild a perfectly-verifying fabricated history. "Tamper-proof" currently means "tamper-evident against actors who cannot write to the database" — which excludes the vendor and the customer's own database administrator.

**FR-119 `[MVP]` — Exports carry the proof.** Every export includes `prev_hash`, `entry_hash`, `tenant_id` and the complete hashed Payload fields per entry.
- **Consequences:** An export is independently recomputable. A test recomputes a full export offline and asserts it matches.

**FR-120 `[MVP]` — Standalone verifier.** A single self-contained verifier recomputes the chain from an export with no database, no network and no xSOM code, and the algorithm is published in `docs/AUDIT_FORMAT.md`.
- **Consequences:** A positive test verifies a real export; a negative test asserts a doctored export fails. This is the artifact that converts "Evidence, not promises" from copy into a checkable claim.

**FR-121 `[MVP]` — Signed Checkpoints.** Periodic Checkpoints digest a contiguous range of entries **and their Annex Columns**, and are signed.
- **Consequences:** Annex data (Decision Reason, risk, policy version, session, enforcement mode) becomes tamper-evident without altering Payload v1. Checkpoints live in their own table; `audit_log` is untouched, so §4.2 holds exactly.

**FR-122 `[MVP]` — External Anchors.** A Tenant may publish Checkpoints to a destination outside xSOM's control.
- **Consequences:** Supported destinations include a customer-controlled object-locked bucket, a timestamp authority, and webhook delivery to the Tenant's own compliance mailbox. Verification gains a second assertion: the head at anchor *k* still reproduces. This is the highest-leverage change for the word "transparent" — it converts a vendor assertion into third-party-checkable evidence.

**FR-123 `[MVP]` — Truncation is detectable.** Table-level truncation is blocked, and tail deletion is detectable through Checkpoints and Anchors.
- **Consequences:** A statement-level truncate trigger is added, since row-level triggers do not fire on truncate and truncation currently leaves verification reporting "OK, 0 entries". A test asserts truncate is refused, and a second asserts that tail deletion after a Checkpoint is detected.

**FR-124 `[MVP]` — Verification as an endpoint.** `GET /v1/audit/verify` returns a structured attestation (`ok`, entry count, first broken id, head hash, head id, period, product version, checkpoint status).
- **Consequences:** Rate-limited, RLS-scoped, downloadable from the console. It is a convenience, never the source of truth — FR-120 is.

**FR-125 `[MVP]` — Honest documentation of limits.** Security documentation states precisely what the chain does and does not detect.
- **Consequences:** The current claim that tampering any row breaks verification is corrected: hash chaining detects mutation and mid-chain excision, and does **not** by itself detect tail truncation or wholesale rebuild. The residual window between Anchors is stated. Precisely stated limits are what make the strong claims credible.

**FR-126 — Published threat model.** A real threat model with assets, adversaries, trust boundaries and a residual-risk register replaces the control checklist.
- **Consequences:** It names the adversaries that matter and are currently absent: a malicious tenant admin with database access, a compromised Downstream Server, a vendor insider, and the vendor itself as the party attesting its own logs.

---

#### D3. Evidence Packs and Framework Mapping

**Description.** The compliance plane assembles genuine evidence and then renders almost none of it: the exported "evidence" PDF drops the entire articles block, so a regulator receives a cover page and a paragraph of generated prose. Retention is reported compliant from a configuration constant while never being enforced. Oversight coverage is computed without a tenant predicate, so its correctness rests on a caller convention rather than on anything the function enforces.

**FR-127 `[MVP]` — Evidence Packs contain the evidence.** Exports render every assembled section plus a hash-bearing appendix, per AI System.
- **Consequences:** A test asserts the rendered document contains the article headings, the head hash, the per-approval table and the entry appendix. Scaffolded assessments carry an "unsigned draft" banner on their face.

**FR-128 `[MVP]` — Oversight sourced from the chain.** Human oversight evidence is sourced from Audit Entries, not from the mutable Approval Record table.
- **Consequences:** The one part of the pack with no tamper-evidence gains it. Depends on FR-15. The Approval Record becomes a convenience index.

**FR-129 `[MVP]` — Tenant-scoped compliance computation.** Every compliance query takes an explicit tenant predicate.
- **Consequences:** A two-tenant test asserts counts do not bleed. Defence in depth, not a replacement for RLS — but the current asymmetry, where chain integrity is tenant-scoped and oversight coverage is not, is exactly the failure mode that produces a plausible-looking, unverifiable compliance artifact.

**FR-130 `[MVP]` — Retention reported from observation.** Retention status derives from the oldest observed entry and the last executed purge, not from a configuration value.
- **Consequences:** Either enforcement is wired (FR-134) or the field is renamed to describe a configured policy. A retention *floor* with no enforcement is not a control and must not be presented to a regulator as an operational fact.

**FR-131 `[MVP]` — Multi-framework mapping.** A declarative control-mapping table renders the same evidence against EU AI Act, GDPR, ISO/IEC 42001, NIST AI RMF and SOC 2.
- **Consequences:** No new collection and no new tables — the evidence already exists; this is mapping and rendering. Each framework export includes a per-control pass/gap table. Control verdicts are deterministic; only narrative prose may be generated (FR-118).

**FR-132 — Impact assessment.** A structured impact assessment with reviewer identity and sign-off timestamp extends the current scaffold.
- **Consequences:** Sign-off is a Control-Plane Event. An unsigned assessment can never report as complete.

---

#### D4. Data Manifest and Content-Free Proof

**Description.** The metadata-only discipline is genuinely implemented and completely undemonstrable: there is no inventory of tables, no per-column statement of what is stored and why, no lawful basis, no retention per table. The whole proof is a hardcoded sentence in one export and a single negative test on one table. Meanwhile the erasure primitive and the retention purge both exist as well-written functions with zero callers anywhere outside their own tests.

**FR-133 `[MVP]` — Data Manifest.** A manifest declares every table and column with classification, retention, lawful basis, and whether it can contain customer text — published as a document and as an endpoint.
- **Consequences:** The manifest is generated from the schema, not hand-maintained.

**FR-134 `[MVP]` — Manifest is enforced in CI.** A test reads the live schema and fails if any column is not declared in the manifest.
- **Consequences:** The content-free claim becomes an enforced invariant rather than prose. This is what "transparent" should mean.

**FR-135 `[MVP]` — Erasure is operable and audited.** An admin-only erasure operation invokes the existing primitives, honours Legal Hold, and records itself.
- **Consequences:** **Invariant collision (CLAUDE.md §4.2 vs. the right to erasure):** `audit_log` is deliberately un-deletable by database trigger, which is required for record-keeping obligations and directly collides with an erasure request. **Resolution in favour of the invariant:** `audit_log` is never erased. Erasure covers operational tables (usage, session, approval summaries, vault). §17 states the reconciliation explicitly — pseudonymised metadata retained under a legal-obligation basis is not erasable personal data — and the product asserts it in documentation rather than leaving it in a docstring. The erasure operation itself writes a Control-Plane Event with a removed-row count.

**FR-136 — Opt-in Argument Vault.** Per-tenant, envelope-encrypted argument storage with short retention and its own access audit, for replay and simulation.
- **Consequences:** **Invariant collision (§4.10):** storing arguments contradicts metadata-only logging. **Resolution:** the vault is a *separate* store, off by default, never written to `audit_log`, encrypted with the existing per-tenant key mechanism, with independent retention and an access log. The hash chain is unchanged. A Tenant that leaves it off keeps today's guarantee exactly, and the console states which mode is active.

**FR-137 `[MVP]` — Ingested telemetry is content-free by rule.** An explicit denylist drops known content-bearing attributes at ingestion, and free-text fields are scanned and bounded.
- **Consequences:** A test posts a payload full of prompt content and asserts nothing content-bearing is persisted. The security audit script fails if a denied key appears in any persisted column. This turns a property currently true by omission into one true by rule — and it aligns with the telemetry standard's own default.

**FR-138 — Per-tenant retention and residency.** Retention is configurable per Tenant above the floor, with a Legal Hold flag.
- **Consequences:** A single process-wide retention value applied to every Tenant is replaced. Purge below the floor remains refused (fail-closed).

---

#### D5. Public Surface — API, SBOM, Provenance, Documentation

**Description.** There is no machine-readable contract for the product at all: interactive docs are correctly disabled in production and the specification is published nowhere else, while the application exposes roughly four times the routes the specification documents. There is no licence, no changelog, no SBOM, no signed release, and no product version recorded on any decision — so "which version of the policy engine made this decision?" is unanswerable, which quietly undermines every other evidence claim over time.

**FR-139 `[MVP]` — Published API specification.** The OpenAPI document is generated in CI, committed, and diff-reviewable.
- **Consequences:** Interactive documentation stays disabled in production per §4.8. CI fails if the committed specification drifts from the application, which also catches undocumented route additions.

**FR-140 `[MVP]` — Product version on every decision.** Product version is recorded on every Audit Entry as an Annex Column.
- **Consequences:** Every decision is attributable to a specific build. Combined with FR-141 this closes the loop between "we log everything" and "you can check what logged it".

**FR-141 `[MVP]` — SBOM and provenance.** Releases publish a software bill of materials and build provenance attestations, with signed images.
- **Consequences:** A release workflow exists. A security reviewer can enumerate dependencies without cloning.

**FR-142 `[MVP]` — Licence and changelog.** A licence file and a maintained changelog exist, and versioning is semantic.
- **Consequences:** The version string that has read `0.1.0` since the first milestone, across twelve milestones and an architecture decision record, is corrected and maintained.

**FR-143 `[MVP]` — Documentation matches the product.** Public documentation describes the shipped surface.
- **Consequences:** The README, which still describes a three-tier policy and a milestone range four milestones stale, is corrected. `docs/CAPABILITIES.md` maps each control to its module, its default state, and what it writes to the audit log. **Undisclosed enforcement behaviour is itself a transparency defect:** a call that can now be held by a risk score or a taint the operator was never told about is surprising behaviour.

**FR-144 `[MVP]` — Coverage map.** A published mapping of recognised agentic-risk categories to the exact module and test that covers them, with honest not-covered rows.
- **Consequences:** Gaps are stated, not implied. Reviewers reward the honest map.

**FR-145 — Supply-chain scanning breadth.** CI scans frontend dependencies and licences in addition to backend dependencies, plus static analysis.
- **Consequences:** Extends the existing dependency-audit and secret-scanning gates.

---

#### D6. Event Egress — SIEM, OTLP and Webhooks

**Description.** Nothing streams out. Export is pull-based, synchronous, and rendered for a human; there is no outbound bus, no webhook, no SIEM format, no trace export. Alerting is one global address for the entire deployment, with no per-tenant routing and no alert for any of the events an operator actually needs to wake up for. And the product ingests telemetry while emitting none, making it a data island the platform team must be argued into rather than an enrichment of the stack they already run.

**FR-146 `[MVP]` — Signed webhook egress.** Decisions are delivered to per-Tenant subscribed endpoints with HMAC signing, replay protection, retry with backoff, and a durable per-subscription cursor.
- **Consequences:** A sink outage backfills from the watermark rather than losing events. Delivery includes denials, holds and gate events — a feed that omits denied requests is not complete.

**FR-147 `[MVP]` — SIEM-shaped format.** A normalised security-event representation is available for pull and push.
- **Consequences:** A pure mapper, fully unit-testable, with no new dependency. Fields are discrete and parseable: agent identity, tool, action class, decision, reason, risk band, policy version — never argument content. "Our stream is safe to forward because it contains no content by construction" is a selling point, and FR-137 makes it checkable.

**FR-148 `[MVP]` — Trace export.** One span per decision is emitted to any standard trace endpoint, propagating the caller's trace context.
- **Consequences:** Off by default, enabled by endpoint configuration. Attributes carry decision, action class, risk score, policy rule and approval id — never arguments. The decision nests under the agent's existing trace, so xSOM enriches the customer's stack instead of competing with it. Requires a dependency justification per §3. `[ASSUMPTION: A-10]`

**FR-149 `[MVP]` — Per-tenant notification channels.** Notification targets are per-Tenant, multi-channel, and typed by event.
- **Consequences:** The single deployment-wide recipient is removed. The notification interface widens from approvals-only to typed events, so channel implementations are additive.

**FR-150 `[MVP]` — Alert on what matters.** Alerts fire on: approval created, approval approaching expiry, tool drift or poison quarantine, tainted action, behavioural drift, chain verification failure, checkpoint or anchor failure, budget threshold and breach, deny-rate anomaly, halt and resume.
- **Consequences:** Each alert type is individually testable and individually mutable per Tenant.

**FR-151 `[MVP]` — Telemetry ingestion tracks the current standard.** Ingestion reads both current and deprecated provider attribute names, and detection covers current attributes.
- **Consequences:** A regression test ingests a payload carrying only the current attribute name. **This is silent data loss today:** modern instrumentation is not merely mis-attributed, it is dropped without even being counted as rejected — a supervision product whose ingest silently zeroes out shows "no AI activity" instead of an error, which is the worst possible failure class.

**FR-152 `[MVP]` — Standard correlation keys preferred.** Standard conversation, agent and session identifiers are preferred over the proprietary correlation mechanism, which remains a fallback.
- **Consequences:** Model spend attributes to the Agent whose actions are policed. Finish-reason and refusal signals sharpen outcome reporting (FR-70).

---

## 5. Non-Goals

These are excluded **by design**, not by capacity. Each protects the thesis. Any proposal to add one requires an architecture decision record arguing why the thesis survives it.

1. **xSOM is not a prompt firewall.** We do not inspect, score, rewrite or block prompts. The taint guard reads tool *results* at the action boundary and never the model's input. We do not claim to prevent jailbreaks; we claim the jailbroken agent still cannot delete the contact.
2. **xSOM is not a model-evaluation platform.** No groundedness, hallucination, task-success or golden-set scoring. Outcome supervision (B6) observes what happened at the action boundary, never how good the model was. That slice is consolidated and well-served by others.
3. **xSOM is not an APM or LLM-observability product.** The observability surface is frozen at "enough to decide and to explain a decision". We emit into the customer's existing stack (FR-148) rather than compete with it.
4. **xSOM is not a data-loss-prevention product.** DLP is used as an input to risk and egress decisions, not sold as a control plane.
5. **xSOM is not an identity provider.** We federate to the customer's IdP; we do not become one.
6. **xSOM is not an agent framework or an orchestrator.** We supervise agents; we do not run them.
7. **xSOM does not do machine-learning anomaly detection in v2.** Behavioural baselines (B5) are deterministic, explainable statistics. An unexplainable escalation is worse than none for this product.
8. **xSOM does not offer a hosted-only future.** Self-host is a first-class, permanently supported deployment mode, not a downgrade.
9. **xSOM does not use an LLM to authorize.** The judge classifies ambiguous tools and writes narrative prose. It never decides, never approves, and never authors a Dry-Run.

---

## 6. MVP Scope

The release is **v2.0**. Its scope test is a single sentence: *a stranger can self-host it in ten minutes, every action and every administrative change is recorded, every decision explains itself, and an auditor can verify the record without trusting us.*

### 6.1 In scope for v2.0

All requirements tagged `[MVP]` in §4. Grouped:

- **Deployment (Group C, essentially complete).** One-command self-host with a containerised console and pluggable auth (FR-85–89); zero-SQL bootstrap and the CLI (FR-91–96); migration ledger, runner, CI integrity and a tested upgrade path (FR-97–101); split liveness/readiness, a booting example environment, and a deployment smoke gate (FR-102–106); safe defaults, guided onboarding, an operator surface for every shipped control, bounded server configuration, and English/French parity (FR-107–112).
- **Transparency (Group D, essentially complete).** Decision Reason and Escalation Source on every entry, `error` de-overloaded, first-class gate events, a real audit explorer (FR-113–117); hash-bearing exports, the standalone verifier, signed Checkpoints, external Anchors, truncation detection, a verification endpoint, and corrected limit documentation (FR-119–125); evidence packs that contain the evidence, chain-sourced oversight, tenant-scoped compliance computation, retention reported from observation, multi-framework mapping (FR-127–131); the Data Manifest with CI enforcement, operable erasure, content-free ingestion by rule (FR-133–135, FR-137); published API specification, product version on every decision, SBOM and provenance, licence and changelog, accurate documentation (FR-139–144); webhook, SIEM and trace egress with per-tenant channels and real alerting, plus corrected telemetry ingestion (FR-146–152).
- **Enforcement core (Group A).** The unified pipeline with declared coverage and enforcement mode (FR-1–4, FR-6–7); policy versions, stamping, diff, rollback, simulation and templates (FR-8–11, FR-13); chained human decisions with mandatory justification, the Decision Brief, effective expiry, separation of duties, routing and channel decisions (FR-15–21); Emergency Stop in full (FR-23–27); persisted and returned risk with per-agent trust and the floor (FR-29–33).
- **Coverage (Group B).** Control-plane supervision in full (FR-35–38); agent attribution, the AI System registry with a completeness gate, delegation lineage capture, credential hygiene and effective revocation (FR-40–43, FR-46–47); the client SDK with fail-closed defaults, framework adapters, honest strength labelling, and tool annotations as floor and in the fingerprint (FR-48–51, FR-53–54); durable Sessions with lineage, the session timeline, evaluate-only replay, and a truthful Inspector (FR-56–61); persisted visible taint, behavioural baselines and drift events, persisted poison reasons (FR-62–63, FR-65–66, FR-68); outcome capture with rates and no quality claims (FR-69–70, FR-73); tenant-keyed limits, budgets and audited budget events with corrected cost accounting (FR-74–77); the membership plane making `human_dual` reachable, plus explicit break-glass (FR-79–80, FR-84).

### 6.2 Out of scope for v2.0

Deliberately deferred. Each has a reason, not merely a lower priority.

| Deferred | Reason |
|---|---|
| FR-5 streamed enforcement, FR-12 staged rollout, FR-14 policy export | Depend on v2.0 foundations (pipeline, versions) landing first. |
| FR-22 native protocol elicitation, FR-55 full stateless-transport conformance | Blocked on SDK support for the 2026-07-28 revision. v2.0 must remain forward-compatible (no new dependency on the protocol session) but does not claim conformance. `[ASSUMPTION: A-6]` |
| FR-28 automatic containment | Manual Emergency Stop must be proven in production before any automated trigger is trusted to halt a customer's agent. |
| FR-34 tenant-scoped judge budget | Correctness fix with a cost, not a safety, consequence; sequenced right after v2.0. |
| FR-44 scoped child credentials, FR-45 federated agent identity | Lineage capture (FR-43) delivers the audit value; the credential model is a larger design requiring an ADR. |
| FR-52 standards façade | Target specifications are still working drafts; premature conformance would be a maintenance liability. `[ASSUMPTION: A-5]` |
| FR-64 DLP-in-taint, FR-67 drift into risk | Additive refinements once persisted taint and baselines exist. |
| FR-71/72 incident labelling and linkage | Needs UX definition; the underlying lineage ships in v2.0. |
| FR-78 connection pooling | Requires a dependency justification and an RLS-under-pooling test; a performance fix, not a v2.0 promise. `[ASSUMPTION: A-8]` |
| FR-81 scoped operators, FR-82 federation, FR-83 step-up | Membership (FR-79) is the gate. SAML and SCIM are explicitly out. |
| FR-90 Helm chart | Compose is the ten-minute promise; the chart follows real cluster demand. `[ASSUMPTION: A-9]` |
| FR-126 threat model, FR-132 impact assessment, FR-136 Argument Vault, FR-138 per-tenant retention, FR-145 scanning breadth | Valuable, not load-bearing for the four demands. The Vault additionally needs a privacy review before shipping even opt-in. |
| SOC 2 Type II / ISO 42001 certification | Organisational programmes, not product requirements. v2.0 produces the evidence they consume; the audits themselves are tracked outside this PRD. |
| A2A transport, multi-instance fleet management, sovereign hosting bundles, machine-learning anomaly detection | Out of thesis or premature. See §5. |

---

## 7. Success Metrics

Primary metrics gate the release. Secondary metrics track adoption. Counter-metrics exist to catch the ways this release could succeed on paper and fail in reality — chiefly by making supervision so annoying that customers widen the auto tier and quietly destroy the product's value.

### Primary

| ID | Metric | Definition | Target | Source |
|---|---|---|---|---|
| **SM-1** | **Time to First Blocked Action (TTFBA)** | Median wall-clock from `git clone` to an irreversible action demonstrably held and not executed, on a self-hosted stack, by an operator who has not seen the product. | **≤ 10 min median, ≤ 20 min p90; 0 hand-written SQL statements; 0 SaaS accounts required.** | FR-105 deployment smoke (machine floor) + moderated onboarding sessions (human truth). UJ-1. |
| **SM-2** | **Decision Explainability Rate** | Share of new Audit Entries carrying a non-null Decision Reason, Escalation Source, agent attribution and policy version, such that the console renders a complete "why" with no human interpretation. | **≥ 99% of entries; 100% of held and denied entries.** | FR-113 completeness test + a sampled review where an engineer must state the cause from the record alone. UJ-4. |
| **SM-3** | **Independent Verification Rate** | Share of Evidence Packs that a third party verifies using only the published algorithm and the standalone verifier — no xSOM code, no database, no network. | **100%.** | FR-119/FR-120 tests + at least one real external auditor run before general availability. UJ-7. |
| **SM-4** | **Supervision Completeness** | Share of mutating control-plane routes that write a chained Control-Plane Event, and share of tool calls crossing a guarded ingress that produce an Audit Entry. | **100% of control-plane routes; 100% of guarded tool calls.** | FR-36 route-enumeration test (a build gate, not a report). UJ-8. |
| **SM-5** | **Oversight Effectiveness** | Median time from approval creation to human decision, and share of approvals decided rather than expired. | **Median < 5 min; expiry < 10% of approvals.** | Approval records; alerting on approaching expiry (FR-150). UJ-3, UJ-5. |
| **SM-6** | **Containment Latency** | Time from an operator deciding to halt to the first denied call from the target Agent. | **< 5 s at p95; effective on already-authenticated sessions.** | FR-24 test + incident drill. UJ-5. |

### Secondary

| ID | Metric | Target |
|---|---|---|
| SM-7 | Share of new deployments that are self-hosted. | Rising; ≥ 40% by one quarter after release. `[ASSUMPTION: A-11]` |
| SM-8 | Share of Tenants with at least one Event Sink attached (webhook, SIEM or trace). | ≥ 50% of Tenants with more than one Agent. |
| SM-9 | Share of Tenants with more than one Member (the precondition for separation of duties). | ≥ 70%. |
| SM-10 | Non-MCP ingress adoption: share of supervised tool calls arriving through the SDK or adapters. | ≥ 25% — evidence that coverage is genuinely exhaustive rather than MCP-shaped. |
| SM-11 | Mean time to policy revert (bad policy published → rolled back). | < 10 min. |
| SM-12 | Upgrade success rate: releases upgraded with chain verification still green. | 100%. |
| SM-13 | Registry completeness: share of Agents attached to a fully populated AI System. | ≥ 80%. |
| SM-14 | Anchor freshness: share of Tenants whose most recent Anchor is within its configured period. | ≥ 95% of Tenants that enabled anchoring. |

### Counter-metrics

These must **not** rise. Each detects a way v2 could look successful while damaging the product.

| ID | Counter-metric | Watch condition |
|---|---|---|
| **CM-1** | **Auto-tier widening.** Share of Tenants moving `unknown_tool` away from deny, widening Risk Bands, or disabling taint after enabling it. | Any sustained rise means supervision became annoying and customers bought back their own risk. This is the single most important counter-metric in the document. |
| **CM-2** | **Rubber-stamp rate.** Share of approvals approved in under 5 seconds, or with an empty-equivalent justification. | A rising rate means the Decision Brief is not being read and oversight is nominal — the exact failure the human-oversight obligation targets. |
| **CM-3** | **Added decision latency.** p95 gateway overhead per tool call. | Must not exceed the pre-v2 baseline by more than a small, budgeted margin. Guards are additive; the pipeline must not become the reason a customer removes it. |
| **CM-4** | **Judge cost per 1,000 decisions.** | Must fall as annotation-based and multilingual classification (FR-6, FR-53) reduce ambiguity. A rise means determinism regressed. |
| **CM-5** | **Bypass rate.** Agents that stop routing through xSOM, or Tenants whose call volume drops while their agent fleet grows. | The clearest signal that enforcement friction exceeded value. |
| **CM-6** | **Support contacts per new deployment.** | If self-host generates more support load than the three-vendor path it replaced, C1–C5 did not actually work. |
| **CM-7** | **False-hold rate.** Approvals approved with no modification and no follow-up incident, as a share of all holds. | High values mean the risk model over-holds and will drive CM-1. |

---

## 8. Open Questions

Each names the decision, the owner function, and the date by which not deciding becomes a blocker.

- **OQ-1 — Licence and distribution model.** Does v2 ship open-core (permissive or copyleft core, commercial tier for federation, SIEM connectors, signed attestations and support), or source-available? This gates FR-142 and the entire self-host go-to-market. The category's proven posture is open-core with genuinely first-class self-hosting. *Owner: founder. Blocks: release announcement.*
- **OQ-2 — Default Anchor destination.** Which external witness is the default for FR-122: customer-controlled object storage, a timestamp authority, a public transparency log, or webhook-to-compliance-mailbox? Each has different trust, cost and air-gap properties, and the air-gapped case may admit no external witness at all. *Owner: security. Blocks: FR-122 implementation.*
- **OQ-3 — Does cooperative enforcement count as oversight evidence?** When an SDK adapter (FR-50) mediates a human approval, may that approval appear in an Evidence Pack as human oversight, and with what qualification? The conservative answer — disclose it, qualify it, never claim equivalence — is assumed in FR-3 and FR-51 and needs legal confirmation. *Owner: compliance + legal. Blocks: FR-127 rendering.*
- **OQ-4 — Argument Vault legal posture.** Even opt-in and encrypted, does storing tool arguments create a processing basis and residency obligation that outweighs the replay and simulation value? If the answer is unclear, FR-136 stays out beyond v2.0. *Owner: DPO. Blocks: FR-136, and limits FR-11 to `indeterminate` rows.*
- **OQ-5 — Halt semantics for in-flight calls.** Does Halt affect a tool call already relayed to a Downstream Server, or only calls not yet relayed? Attempting to cancel in flight is unreliable and may leave partial effects; the conservative answer is to block new calls and state the limit plainly. *Owner: engineering. Blocks: FR-24 acceptance criteria and its documentation.*
- **OQ-6 — Retention: per-Tenant or global floor?** FR-138 allows per-Tenant configuration above the floor. Does a Tenant get to choose *below* our floor if their jurisdiction demands shorter retention, and how does that interact with FR-135's erasure reconciliation? *Owner: compliance. Blocks: FR-138.*
- **OQ-7 — Policy authoring language.** Does the YAML dialect remain the only authoring surface, with a generated export for review (FR-14), or does a standard policy language become a first-class input? A proprietary policy language is a known objection in competitive evaluations; adopting one is a large commitment. *Owner: product + engineering. Blocks: FR-14, FR-52.*
- **OQ-8 — Standards conformance timing.** Which interop targets does v2.1 conform to, in which order, given several are still working drafts? Premature conformance is a maintenance liability; absence is an evaluation objection. *Owner: product. Blocks: v2.1 scoping.*
- **OQ-9 — Checkpoint signing key custody.** Who holds the FR-121 signing key: the instance, the Tenant, or a customer-managed key? Vendor-held keys weaken the very independence the Checkpoint exists to establish. *Owner: security. Blocks: FR-121 design.*
- **OQ-10 — Behavioural Drift thresholds.** Are thresholds shipped as per-Tenant configuration only, or is there a defensible default? A default that misfires will drive CM-1 directly. *Owner: product. Blocks: FR-66 defaults.*
- **OQ-11 — Console-side notification channel trust.** For FR-21, what is the minimum acceptable authentication for a channel-originated approval such that it is genuinely equivalent to a console decision under RBAC and separation of duties? *Owner: security. Blocks: FR-21.*
- **OQ-12 — Pricing and packaging.** Which capabilities are core versus commercial, and at what price point between infrastructure and governance tooling? Silence prevents both bottom-up adoption and a top-down budget line. *Owner: founder. Blocks: general availability.*

---

## 9. Assumptions Index

Every inference in this document that is not directly verifiable from the codebase or a cited source.

| ID | Assumption | Referenced by | Risk if wrong | Validation |
|---|---|---|---|---|
| **A-1** | A deterministic export of the Policy Document to an external authorization representation is achievable without semantic loss for the current rule surface (rules, constraints, defaults, bands). | FR-14 | The export misrepresents behaviour, which is worse than not shipping it. | Round-trip decision-equivalence test on a fixture corpus before shipping. |
| **A-2** | Enough MCP hosts will support the native input-required mechanism within the v2.1 horizon to make elicitation worth building ahead of broad adoption. | FR-22 | Effort spent on a path nobody uses; the fallback carries all traffic. | Survey host support before scheduling; keep the fallback as default until measured. |
| **A-3** | A three-value actor dimension (`human`/`agent`/`system`) is sufficient; no fourth class (e.g. delegated-on-behalf-of) is needed as a distinct actor type rather than an attribute. | FR-35 | A schema change later, though annex columns make this cheap. | Model the delegation cases from FR-43 against the three values during design. |
| **A-4** | Customers will accept short-lived federated workload identities for agents rather than insisting on long-lived static tokens for operational simplicity. | FR-45 | Federation ships and nobody adopts it; static tokens remain the real surface. | Customer interviews before v2.1 scoping. |
| **A-5** | The relevant interop specifications will stabilise enough that a conformance façade is a maintainable addition rather than a moving target. | FR-52, OQ-8 | Continuous rework tracking draft revisions. | Re-evaluate at each v2.x planning cycle; do not conform to working drafts. |
| **A-6** | v2.0 can be made forward-compatible with the stateless protocol revision by persisting all enforcement state, without requiring transport conformance in this release. | FR-55, §6.2 | A larger, unplanned migration lands mid-release. | Design review confirming no enforcement state depends on the protocol session; conformance test written before any SDK bump. |
| **A-7** | Shared-storage rate limiting can be introduced without a new external service becoming a hard runtime dependency for the single-node self-host path. | FR-74 | The ten-minute self-host promise acquires a second required service. | Degrade to in-process limiting on single-node compose, documented explicitly. |
| **A-8** | Transaction-local tenant role and claim settings remain correct under connection pooling, so RLS isolation is unaffected. | FR-78 | A tenant-isolation regression — the most severe possible failure. | A test that a recycled pooled connection cannot read another Tenant's rows, written before the pool is introduced. |
| **A-9** | Compose satisfies the ten-minute promise for the majority of evaluators, so a cluster chart can follow rather than lead. | FR-90 | Enterprise evaluations stall at packaging. | Track how many prospects request a chart during evaluation. |
| **A-10** | Trace export can be added within the dependency discipline of CLAUDE.md §3 with a written justification, rather than requiring a policy exception. | FR-148 | The single cheapest credibility purchase is blocked on process. | Raise the justification in the implementing PR. |
| **A-11** | Self-host share is measurable at all — i.e. self-hosted deployments will opt in to anonymous deployment telemetry. | SM-7 | The adoption metric is unmeasurable and must be replaced by a proxy such as image pulls. | Decide the telemetry posture before release; default off is likely, so plan the proxy metric now. |
| **A-12** | Deployment-defect classes found in this audit are representative — i.e. the deployment smoke gate (FR-105) will catch the next one, not merely the last five. | FR-105, SM-1 | Deployment defects keep shipping despite a green gate. | Deliberately reintroduce each of the five known defects and confirm the gate fails. |
| **A-13** | The compliance-deadline deferral (§12) shifts urgency to security budgets without reducing total demand. | §12, §13 | The go-to-market repositioning chases demand that softened rather than moved. | Track pipeline source attribution: security-led versus compliance-led. |

---

## 10. Cross-Cutting Non-Functional Requirements

Apply to every requirement in §4.

**NFR-1 Determinism on the hot path.** No LLM call participates in any authorization decision. The judge classifies `ambiguous` tools and writes narrative prose only. Given identical inputs and policy version, the pipeline returns an identical decision — this is what makes FR-60 replay and FR-11 simulation meaningful.

**NFR-2 Fail-closed by construction.** Every new code path states its failure verdict. Unknown, unreachable, ambiguous or unresolvable resolves to deny for `irreversible` and `external_send`. Absence of a decision is never an allow.

**NFR-3 Latency budget.** The added p95 overhead per tool call has a stated budget (CM-3). Guards that require input/output share the connection already opened in the pipeline. Guard additions that exceed the budget require an explicit trade-off decision, not silent acceptance.

**NFR-4 Tenant isolation in the database.** Every new table carries RLS from its creating migration. Application-level filtering is never the isolation mechanism (§4.3). Every new table gets a two-tenant isolation test.

**NFR-5 Bounded validation.** Every new input is length- and shape-bounded at the schema layer (§4.9). Unbounded free-form structures — of which the Downstream Server configuration is the current exception — are not acceptable in new surfaces.

**NFR-6 Content discipline.** No new column, log line, span attribute, webhook payload, alert or export may carry tool-argument content, result bodies or PII. Metadata, classifications, counts and hashes only (§4.10). Enforced by FR-134 and the security audit script.

**NFR-7 Backward compatibility of controls.** Every new enforcement branch is opt-in and off by default. An upgrade must never change a Tenant's effective decisions without an explicit action by that Tenant.

**NFR-8 Chain stability across change.** No change may alter the hashed Payload shape. Every release runs chain verification against a database seeded at the previous release (FR-100).

**NFR-9 Testability.** Every module ships tests; business logic coverage stays at or above the existing threshold. Every FR in §4 has at least one automated test that would fail if the requirement regressed.

**NFR-10 Accessibility and clarity.** Approval and audit surfaces are keyboard-navigable and screen-reader-labelled. An approver must be able to act correctly on the Decision Brief without product training.

**NFR-11 Dependency discipline.** No dependency outside the imposed stack without written justification in the PR (§3). FR-78 and FR-148 are the only anticipated additions and both carry explicit justification requirements.

**NFR-12 Availability posture.** Control API unavailability must not silently degrade enforcement. A gateway that cannot reach the control plane fails closed on `irreversible` and `external_send` and reports degraded mode rather than allowing.

---

## 11. Constraints and Guardrails

### 11.1 Safety

- **G-S1** The Dry-Run is computed by the gateway from the tool definition and arguments. It is never authored by the Agent or by an LLM. This is the specific defence against an agent presenting a misleading summary to a human approver, and it is a genuine differentiator that must never be traded for a "nicer" generated summary.
- **G-S2** An unapproved irreversible action is never executed. Not queued optimistically, not executed-and-compensated. Not executed.
- **G-S3** Emergency Stop always wins. No policy, band, trust discount, annotation or approval can override a Halt.
- **G-S4** Tool Annotations are a floor and never a ceiling (FR-53). Downstream servers are untrusted input by definition; the supply-chain shield exists precisely because they can lie.
- **G-S5** New enforcement is opt-in (NFR-7). We do not silently tighten a running customer's agent, because a surprise denial in production converts directly into CM-1.
- **G-S6** Degradation is disclosed, never hidden. If a guard cannot run, the response and the audit record say so.

### 11.2 Privacy

- **G-P1** Metadata and hashes only, by default and by rule (NFR-6, FR-137).
- **G-P2** The Argument Vault (FR-136) is the sole exception, is opt-in, encrypted, separately retained and separately audited, and never touches `audit_log`.
- **G-P3** Egress carries no content (FR-147). This is a marketed property and therefore must be a tested one.
- **G-P4** Justifications and operator notes (FR-16, FR-71) are the only intentionally free-text human fields. They are bounded, classified in the Data Manifest, and excluded from egress payloads by default.
- **G-P5** The privileged database credential is backend-only, never in the frontend, never committed (§4.6). The self-host compatibility layer (FR-87) must not weaken this.
- **G-P6** Tokens live in `httpOnly`, `Secure`, `SameSite` cookies; never in browser storage (§4.5).
- **G-P7** Erasure never touches the audit chain (FR-135). The reconciliation is documented, not implied.

### 11.3 Cost

- **G-C1** The LLM judge is bounded by a persistent, tenant-scoped window (FR-34). A cap that resets per request is not a cap.
- **G-C2** No LLM on the hot path (NFR-1) — the cost argument and the determinism argument point the same way.
- **G-C3** Budgets are enforced, not merely observed (FR-75). Measuring cost precisely while enforcing nothing is the current state and is not acceptable in a product that reports spend to finance.
- **G-C4** Self-host must be free of mandatory paid dependencies. A ten-minute deployment that requires a paid account is not a ten-minute deployment.
- **G-C5** Egress is off by default and cursor-based, so an outage backfills rather than storms (FR-146).
- **G-C6** Cost figures presented to a customer must distinguish estimated from provider-billed and must price cached and reasoning tokens correctly (FR-77).

---

## 12. Why Now

**The category exists, and so do the competitors.** Guardian Agents and AI Agent Management Platforms were formally named in 2026, with "immutable audit trail" listed as a required element. That is validating and dangerous in equal measure: in March 2026 a hyperscaler shipped, generally available, a gateway that intercepts all agent traffic and evaluates every request against policy enforced outside the model's reasoning loop — verbatim xSOM's pitch, from a vendor with default distribution. Its documented surface stops at policy enforcement, access control, authoring and cloud-native logging: **no human-in-the-loop, no tamper-evidence, no supply-chain drift detection, and only for traffic through its own gateway.** Separately, a direct competitor sells the evidence half — hardware-backed signing and a Merkle ledger — with no approvals at all. The intersection is unoccupied and shrinking. xSOM can no longer position on "we control what the agent does", because that sentence is now several companies' marketing. It must position on the intersection: **enforced human approval, cryptographically verifiable evidence, and tool supply-chain integrity, on any cloud, behind any framework, self-hostable.** That repositioning is a v2 deliverable (FR-143, FR-144), not a marketing task.

**The compliance clock moved, and the buyer moved with it.** The regulatory deadline that the compliance milestone was explicitly sequenced against has been deferred by well over a year for the obligations that mattered most to this product, with transparency obligations remaining on the original date. The consequence is not less demand — it is a different buyer. "You must be compliant in August" is no longer a closing argument, and any material still saying it will be corrected by the buyer's own counsel, which costs credibility. The demand moves from the compliance officer's deadline to the security budget, where guardian-agent spend is projected to grow from under 1% of agentic AI budgets to mid-single digits within two years. That is why §2 names the CISO as the economic buyer, why §4 Group B leads with control-plane supervision and containment rather than with framework mappings, and why §7's primary metrics are explainability and verification rather than compliance-readiness percentages.

**Distribution in this category is settled, and xSOM is on the wrong side of it.** The proven posture is open-source core with genuinely first-class self-hosting: the reference product in the adjacent observability category reached millions of container pulls and most of the Fortune 50 before being acquired at a large valuation, with its permissive licence and self-host path preserved. Every open-source gateway competitor already ships one-command self-host. xSOM ships none: no compose file, no chart, no CLI, and hand-written SQL across three vendors — with a documented quickstart that, verified during this audit, does not boot. That is not a packaging inconvenience; it is a hard gate on evaluation, on air-gapped and sovereign buyers, and on the bottom-up adoption loop that this category's winners were built on. It is also, mercifully, the cheapest gap to close: roughly 70% of the one-command experience already exists in the codebase, fully built and unreachable, because the environment variable that enables self-serve provisioning is documented nowhere.

**And the standards are moving underneath the implementation.** Telemetry attribute names the ingester depends on are deprecated, so current instrumentation is silently dropped rather than rejected. Tool definitions already carry machine-readable behavioural hints that are exactly this product's action classes — ignored by the classifier and, more seriously, absent from the supply-chain fingerprint, so a downstream server can flip a destructive flag and the shield reports no drift. The tool protocol's newest revision removes the session abstraction that the taint window, the quarantine cache and the token model all rest on. None of these are strategy questions. They are correctness debt with a short half-life, and each one is cheap now and expensive in six months.

---

## 13. Compliance and Regulatory

xSOM's compliance posture is: **we produce the evidence; we do not certify the customer.** Every claim below must be backed by an artifact a third party can check.

**C-1 Evidence, not attestation.** Every compliance output is derived from Audit Entries and Approval Records. Control verdicts are computed deterministically; generated prose appears only in narrative sections and is labelled (FR-118). A scaffolded assessment is watermarked as an unsigned draft (FR-127).

**C-2 Framework coverage.** v2.0 renders the same underlying evidence against the EU AI Act, GDPR, ISO/IEC 42001, NIST AI RMF and SOC 2 through a declarative mapping table (FR-131). This is a mapping exercise, not new collection. No framework verdict is asserted beyond what the data supports; gaps render as gaps.

**C-3 Corrected dating.** All regulatory dating in the product and its documentation reflects the current deferred timeline for high-risk obligations and the unchanged timeline for transparency obligations. Stale dating is treated as a defect, not a marketing lag (see §12). `[ASSUMPTION: A-13]`

**C-4 Record-keeping versus erasure.** The audit chain is non-erasable by database trigger. This is required for record-keeping obligations and collides directly with an erasure request. **Resolved in favour of the invariant** (FR-135): the chain is never erased; erasure covers operational data; the reconciliation — pseudonymised metadata retained under a legal-obligation basis is not erasable personal data — is stated as a product position in `docs/DATA_MANIFEST.md`, not left in a docstring. That argument *is* the product; it should be asserted, not implied.

**C-5 Human oversight must be effective.** Presence of an approval step is not oversight. The Decision Brief (FR-17), mandatory justification (FR-16), separation of duties (FR-19), effective expiry (FR-18) and one-action Emergency Stop (FR-26) exist because effectiveness, not presence, is the standard — and because CM-2 measures whether we achieved it.

**C-6 Reachable stop.** The stop control is reachable by the designated overseer without a support ticket, a deploy, or a separate administrative console (FR-26), and both stop and resume are recorded with actor and reason (FR-27).

**C-7 Enforcement mode is disclosed.** Cooperative decisions are labelled everywhere they appear (FR-3, FR-51) and are never presented as equivalent to mandatory enforcement in an Evidence Pack. Pending OQ-3, the conservative treatment applies.

**C-8 System-level reporting.** Compliance reports render per AI System (FR-41, FR-127); a Tenant-level aggregate is available but is not the unit of governance, because an inventory obligation is about systems.

**C-9 Our own posture.** xSOM will pursue third-party certification of its own management system, and its own audit chain, approval records and evidence exports are the evidence it will present. A product whose value is producing compliance evidence and which has none of its own is an argument its buyers will make for it. The certifications themselves are organisational programmes and out of scope for this PRD (§6.2).

**C-10 Published limits.** Where a control's coverage is partial, that is stated in `docs/CAPABILITIES.md` and in the threat model (FR-125, FR-126, FR-144). Precisely stated limits are what make the strong claims credible.

---

## 14. API Contracts and Public Surface

**API-1 Versioned, published contract.** All routes remain under `/v1`. The OpenAPI document is generated in CI, committed, and diff-reviewable (FR-139). Interactive documentation stays disabled in production (§4.8) — the specification is published as an artifact instead, which is what an integrator or auditor actually needs.

**API-2 Surfaces.** Four public surfaces, each with its own contract and authentication:
1. **MCP gateway** — agent-facing, Gateway Token authenticated, `enforcement_mode=mandatory`.
2. **Control API** — console- and operator-facing, user JWT, RBAC + RLS.
3. **Decision API** (`/v1/authorize` and the SDK) — agent-facing, Gateway Token authenticated, `enforcement_mode=cooperative`.
4. **Ingestion and egress** — telemetry in (Read Token), events out (signed sinks).

**API-3 New route families in v2.0.** `/v1/policy/versions|diff|rollback|simulate`; `/v1/control/halt|resume`; `/v1/members`; `/v1/systems` (AI System registry); `/v1/sessions/{id}`; `/v1/audit/verify`; `/v1/data/manifest` and `/v1/data/erasure`; `/v1/budgets`; `/v1/sinks`; `/v1/checkpoints` and `/v1/anchors`; `/health/ready`.

**API-4 Response contract for decisions.** Every decision response carries: decision, action class, decision reason, escalation source, risk score and band, policy version, enforcement mode, executed guards, and — where applicable — approval id and expiry. Nothing in a decision response requires the caller to parse prose.

**API-5 Error contract.** Errors return a stable machine-readable code and a human-readable message that names the remediating configuration where one exists (FR-93), and never a stack trace, a DSN, or a secret value (§4.8).

**API-6 Rate limits are documented.** Every rate-limited route publishes its limit and its keying dimension (FR-74). Limits key on Tenant or Agent, not client address, on authenticated surfaces.

**API-7 Egress contracts are versioned.** Webhook, SIEM and trace payload shapes are versioned independently of the HTTP API and documented in `docs/AUDIT_FORMAT.md` alongside the hash-payload specification and the enumerated Decision Reason vocabulary.

**API-8 The chain format is a public contract.** The Payload v1 canonicalisation, the hashing algorithm and the Checkpoint format are published so that FR-120 verification is reproducible by anyone. This is deliberately the most stable contract in the product (§15).

---

## 15. Versioning and Deprecation Policy

**V-1 Semantic versioning.** The product adopts semantic versioning with a maintained changelog (FR-142). The version is recorded on every Audit Entry (FR-140).

**V-2 Payload v1 is frozen — permanently.** The hashed Payload shape does not change. Ever. All new audit fields are Annex Columns (§4.2), and their tamper-evidence comes from Checkpoints (FR-121). If a future need genuinely requires a Payload v2, it must be a new chain with a documented, verifiable transition — never an in-place change, because an in-place change invalidates every historical verification and destroys the product's central claim.

**V-3 Additive decision vocabulary.** New Decision values and new Decision Reason values are additive and affect only new entries. Consumers must tolerate unknown values; this is stated in the egress contract.

**V-4 Migrations are forward-only.** Applied migrations are immutable; a released migration is never edited (FR-99). Corrections ship as new migrations.

**V-5 Deprecation window.** A public API route, an egress field or a CLI flag is deprecated for at least two minor releases, announced in the changelog, and reported at runtime before removal. Removal is a major version.

**V-6 Configuration compatibility.** A configuration key is never repurposed. Renames ship as a new key with the old one accepted and warned for the deprecation window — which is exactly how the environment-variable mismatch in FR-96 should have been handled and was not.

**V-7 Defaults are versioned behaviour.** Changing a default is a behavioural change requiring a minor version and a changelog entry (NFR-7). An upgrade never silently alters a Tenant's effective decisions.

**V-8 Upgrade is tested, not documented.** Every release runs the previous-release-to-current upgrade with chain verification (FR-100). Documentation follows the test.

**V-9 Protocol version tracking.** The tool protocol SDK is pinned to a tested minor version, and a conformance test runs before any bump (FR-55). A protocol revision that would widen the taint window to zero is rejected: an unresolvable session is treated as tainted, never as clean.

---

## 16. Operational Requirements

**OP-1 Readiness is meaningful.** Liveness and readiness are separate; readiness gates on database connectivity, schema head, and issuer resolution (FR-102). Platform healthchecks point at readiness. A deploy that cannot work does not report healthy.

**OP-2 Self-diagnosis.** `xsom doctor` (FR-94) reports configuration, connectivity, schema state, capability activation and chain status, with remediation for each failure.

**OP-3 Incident response is a product capability.** Emergency Stop (A4), the session timeline (FR-59), alerting (FR-150) and egress (D6) are the incident-response path. None of them requires vendor involvement or database access.

**OP-4 Scheduled work exists and is observable.** v2 introduces recurring work — approval expiry sweep, retention purge, checkpointing and anchoring, egress delivery, behavioural baselines. Each is idempotent, records its last successful run, alerts on failure, and is visible in the console. There is no scheduler in the product today; introducing one is a v2.0 operational requirement, not an afterthought.

**OP-5 Backup and restore.** Documented procedure with an explicit statement of what restore means for the chain: a restore to an earlier point is detectable against Anchors and must be disclosed rather than silently accepted.

**OP-6 Degraded modes are named.** Each dependency failure has a named mode with a stated verdict: database unreachable (deny irreversible, report degraded), judge unavailable (over-classify), egress sink down (buffer to cursor, alert), notification channel down (best effort, never block a decision, alert).

**OP-7 Structured logging.** JSON logs with correlation ids matching audit correlation ids, subject to NFR-6 content discipline.

**OP-8 Capacity guidance.** Documented expectations for decision throughput, audit growth rate per thousand decisions, and retention storage, so an operator can size a deployment before running it.

**OP-9 Multi-replica correctness.** Every stateful mechanism — rate limits (FR-74), chain writes, egress cursors, scheduled jobs — is correct across replicas. In-process state that silently degrades at scale is a defect, not a limitation.

**OP-10 Offline operation.** The self-hosted stack functions with no outbound internet access, with optional capabilities (judge, provider proxy, external anchoring) cleanly disabled and reported as unconfigured rather than failing. This is a prerequisite for the sovereign and air-gapped buyers self-host is meant to unlock.

---

## 17. Data Governance

**DG-1 Declared by construction.** Every table and column is declared in the Data Manifest with classification, retention, lawful basis and whether it can contain customer text, generated from the schema and enforced in CI (FR-133, FR-134). An undeclared column fails the build.

**DG-2 Classification vocabulary.** `identifier` · `metadata` · `hash` · `derived` · `free_text` · `encrypted`. Only two `free_text` fields are intentional: human justifications (FR-16) and operator notes (FR-71). Every other free-text-capable field is either bounded and scanned (FR-137) or reclassified.

**DG-3 Retention.** A floor of at least 183 days for the audit chain, refusing purge below it (fail-closed). Operational tables carry shorter, per-table retention declared in the manifest. Per-Tenant configuration above the floor is FR-138, subject to OQ-6.

**DG-4 Enforcement, not declaration.** Retention purge actually runs (OP-4), records its execution, and compliance status reports observed state rather than configured intent (FR-130).

**DG-5 Erasure.** Operable, admin-only, Legal-Hold-aware, self-auditing (FR-135). The audit chain is out of scope for erasure, and the basis is stated (C-4).

**DG-6 Legal Hold.** Suspends purge and erasure for a defined scope; setting and lifting it are Control-Plane Events.

**DG-7 Encryption.** Provider credentials and the Argument Vault use envelope encryption with per-tenant keys. Key custody for Checkpoint signing is OQ-9.

**DG-8 Residency.** Per-Tenant residency is a stated roadmap item, not a v2.0 claim. Self-host (C1) is the current answer for a customer with a hard residency requirement, and the documentation says so plainly rather than implying more.

**DG-9 Subprocessors.** A public list is published and versioned as part of the trust surface (FR-143).

**DG-10 Ingestion is content-free by rule.** A denylist drops content-bearing telemetry attributes at ingestion; free-text telemetry fields are scanned and bounded (FR-137). The property becomes true by rule rather than true by omission — which matters because a customer whose instrumentation has content capture enabled will otherwise post full prompts to an ingestion endpoint that currently ignores them only by accident of enumeration.

---

## 18. Audit Trail and Decision Provenance

This section is the product's constitution. It is the one place where the invariants, the evidence claims and their honest limits are stated together.

**AT-1 One record per decision, appended, chained.** `entry_hash = sha256(prev_hash + Payload)` per Tenant, rooted at `GENESIS`, serialised per Tenant so no two entries share a predecessor. Immutability enforced by database trigger, not by application convention.

**AT-2 Payload v1 is frozen.** See V-2. This is the source of the annex-column discipline and is non-negotiable.

**AT-3 What the chain covers.** Every agent tool-call decision on every Ingress Path, every gate event, every human approval decision **at the moment it is taken** (FR-15), and every control-plane mutation (FR-36). The in-Payload fields — timestamp, tenant, user, request, tool, action class, decision, rule, judge use, args hash, latency, error — are chain-protected.

**AT-4 What the chain does not cover, stated plainly.** Annex Columns (Decision Reason, escalation source, risk, session, trace, policy version, enforcement mode, product version, delegation lineage, agent attribution) are **not** protected by the Payload hash. They are protected by signed Checkpoints (FR-121) and, where enabled, by external Anchors (FR-122). Hash chaining detects mutation and mid-chain excision; it does **not** by itself detect tail truncation or a wholesale rebuild by someone with database write access. The window between Anchors is a residual risk. All of this is published (FR-125) rather than discovered by an adversarial auditor — because a product that overstates its tamper-evidence has a worse problem than one whose limits are known.

**AT-5 Provenance completeness.** Every entry answers, without interpretation: *when*, *which tenant*, *which agent* (FR-40), *on whose behalf* (FR-43), *which human* (FR-15), *which tool* (Canonical Tool Name), *which class*, *what decision*, *why* (FR-113), *escalated by what* (FR-113), *under which policy version* (FR-9), *at what risk with which factors* (FR-29), *in which session* (FR-57), *in which enforcement mode* (FR-3), *on which product build* (FR-140), and *what happened next* (FR-69).

**AT-6 Correlation.** One correlation id per tool call, shared by the decision entry and all its gate entries (FR-58), joining to the session timeline (FR-59) and to the approval record.

**AT-7 Content discipline in the record.** Arguments are represented by hash only. Risk factors are names and points. Gate reasons are enumerated codes, not free text. The `error` field carries execution failures only (FR-114).

**AT-8 The record leaves the system with its proof.** Exports carry `prev_hash`, `entry_hash`, `tenant_id` and the full Payload fields (FR-119). The algorithm is published and a standalone verifier is shipped (FR-120). An export that cannot be independently recomputed is not evidence, and shipping one while claiming otherwise is the failure this release exists to correct.

**AT-9 Verification is available to everyone who needs it.** Tenants verify through the console and the API (FR-124); auditors verify offline (FR-120); the deployment verifies in CI (FR-100, FR-105). Verification never requires the backend's own database credentials, which today it does.

**AT-10 The supervisors are supervised.** A record that omits the administrator who changed the rules is not a tamper-evident record. FR-35 through FR-39 exist because of this sentence, and SM-4 measures it as a build gate rather than a report.
