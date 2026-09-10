# xSOM Signal acceptance

The redesign keeps the authorization backend and its contracts intact. UI tests
exercise a clearly fictional, isolated `demo.delete_record` action. They never
send approval requests to a live tenant.

## Local checks

Run from the repository root:

```sh
npm --prefix frontend ci
npm --prefix frontend run lint
npm --prefix frontend run typecheck
npm --prefix frontend run test:e2e
```

Playwright builds Next.js and starts a production server on port 3100. Its
configuration supplies dummy Supabase settings and `E2E_TEST_MODE=1`; the
`xsom_e2e` cookie grants a hermetic test session. Browser requests to the control
API are mocked. Never configure this test mode on a deployed environment.

`frontend/e2e/smoke.spec.ts` preserves the existing public evidence, bilingual
metadata, integration snippets, tenant proxy, audit export and policy-save
checks. The complete threat ledger and integration snippets now live on public
`/evidence`; their counts, SSR rendering, profile IDs, engine statements and replay
proofs are unchanged. The POC landing remains on `/`.

`frontend/e2e/heritage.spec.ts` checks the illustrative employee, developer and
confidential-data paths, cloud/internal choices, explicit integration limitations,
zero API calls during exploration, navigation to real evidence, and French/English
layout at all three viewport widths. A recursive guard reads every nested phrase
of `GUARD_COPY` and rejects invented coverage counts. The brand guard also checks the exact bytes
of the original blue logo, not a recolored substitute.

`frontend/e2e/signal.spec.ts` verifies the operator interaction contract:

| Behavior | Observable acceptance |
|---|---|
| Expiry means deny | A past `expires_at` disables acceptance; no write is emitted. A visible approval also becomes unavailable when its deadline passes, without a reload. |
| Server decides | An approval remains visible while its POST is pending. It leaves the queue only after a successful response and reload. |
| Failure is explicit | A failed approval write keeps the action pending and raises an accessible alert. A failed queue read never claims that nothing is waiting. |
| Policy publication | A rejected YAML update keeps the last confirmed version and never announces a successful save. While publication is pending, the editor is read-only and shows the last confirmed version; it unlocks only after the server response. |
| Inspector evidence | Selection and filtering display the server's request, policy and argument hash. A held registry verdict shows the tool as not authorized, without claiming that an execution was already blocked. The screen emits no writes. |
| Risk is observed | A real clean-approval streak and drift count remain unchanged in presentation. Missing scores have no numeric meter. Failed feeds show unknown values, not reassuring zeroes. |
| Executive classification | Uninspected relays, missing or unfamiliar verdicts, observation-mode events and guard observations never inflate the authorization count. They remain separately visible. |
| Demo is explicit | The overview's interactive flow is labelled as illustrative. Switching Guarded/Unguarded or the illustrated verdict never writes to the service. |
| User preferences | The default theme is light; an explicit dark choice and reduced motion survive reload. The operating system's reduced-motion setting takes precedence over a local animation preference. |
| Console language | The redesigned risk view and its actual shared components switch to English, retain their language on reload, and render again when switched back to French. |
| Operator viewport | Inspector, approvals, audit, policy, risk, settings, onboarding and admin retain a contained page at 390, 768 and 1440 pixels. Dense content may scroll within a labelled region. |

The landing smoke reads computed styles and loaded font faces to prove that
Manrope and Source Sans are actually applied, rather than silently replaced by
fallback fonts. The onboarding step-two mode selector must keep a computed
text/background contrast of at least 4.5:1 in both themes at all three widths.

`frontend/e2e/signal-components.spec.ts` checks the shared runtime through the
real onboarding and audit screens. Reduced motion prevents video downloads,
hover playback pauses on leaving the player, and changing Guarded/Unguarded
switches the poster and both media sources. The policy layer stays accessible
with playback disabled. Audit labels remain escaped text, and filtering a live
chain to zero events never inserts demonstration evidence.

The console's existing content-contract tests also cover brand geometry,
no fabricated latency claims, translated threat coverage, real recorded demo
evidence and shared integration snippets:

```sh
uv run pytest --no-cov tests/test_front_copy.py tests/test_brand_mark.py \
  tests/test_integration_snippets.py tests/test_menaces_section.py \
  tests/test_schemas_menaces.py tests/test_audience.py \
  tests/test_marketing_gate.py tests/test_threat_rows.py
```

The full backend gate is `uv run pytest`, with PostgreSQL server binaries on
`PATH`. The database fixture otherwise skips the RLS and HITL integration tests;
a skip is not evidence of tenant isolation. On a Homebrew PostgreSQL 17 install:

```sh
PATH="/opt/homebrew/opt/postgresql@17/bin:$PATH" uv run pytest
```

## Delivery checks

Inspect the deployment associated with the merged Git SHA, its production
alias, and the actual UI. A Vercel `Ready` badge alone does not prove auth or API
connectivity. Check the console API's `/health/ready`; its database, schema and
issuer must be available. Decision and LLM planes do not require the issuer, so
their `ok` verdict may be true with `issuer: false`.

Before release, visually compare the corporate homepage and the POC/console in
dark and light modes. Check keyboard focus, the accessible preference controls,
the static reduced-motion rendering, clearly labelled demo diagrams and all
approval states. Inspect the mobile navigation and long tool names. Network
errors must not turn unknown risk or an unreadable audit into reassuring zeroes.

The corporate repository remains a static GitHub Pages site. Its complementary
checks are `node tools/sync-partials.js --check` and
`node --test tests/*.test.cjs`, including exact original editorial-copy parity,
followed by a browser pass on the French and English home, expertise, sovereignty
and contact pages. The corporate site no longer promotes the POC. That pass must
also check posters, user-controlled video playback, no third-party font or
tracking requests, valid language links and the existing contact form's field
validation. Do not send test email through the production form.
