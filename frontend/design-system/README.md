# xSOM Signal 2.0 — original blue identity

One versioned visual foundation. The corporate site remains focused on its original cybersecurity/services message; the experimental AI POC is not promoted there. Canonical source: `xsom-consulting/infra-xsom_website/design-system`. The console vendors this exact directory at `frontend/design-system`; it does not maintain a second theme.

## Update and synchronize

Edit `design/tokens.json`, then run `node design-system/build.mjs` from the site. Never edit generated `tokens.css`. Run `npm --prefix design-system run check` for drift and contrast checks. Copy the versioned source with `node design-system/build.mjs --sync /absolute/path/to/poc-AI_guard/frontend/design-system`. This copies only this package into the explicit target; it never edits application code. Review the diff in both repositories. A release includes both PRs and identical package contents.

The console serves package assets from `/signal-media/`; copy `frontend/design-system/assets/*` into `frontend/public/signal-media/` after syncing. Font roles: Manrope headings, Source Sans 3 body, JetBrains Mono technical identifiers. Local variable WOFF2 files come from pinned Fontsource 5.3.0 packages; see `ASSETS.md` and `licenses/`. Next.js maps the package font roles to its generated local font families before paint. The original blue/grey SVG is preserved byte-for-byte in both `assets/mark-source.svg` and `assets/mark.svg`; the build rejects recolouring. `mark-light.svg` is the original blue/graphite variant for light surfaces.

Before releasing, verify both copies with `node design-system/build.mjs --check --compare /absolute/path/to/poc-AI_guard/frontend/design-system`. This checks every source and asset byte, not only the color tokens. It reports extra/missing files; synchronization never deletes an unrelated target file.

## Static HTML

Load `tokens.css` and `components.css` after legacy styles, then `<script type="module" src="/design-system/signal.js"></script>`. Use `<signal-flow lang="fr" mode="demo" interactive verdict="hitl">Agent → Guard → Policy → Outil.</signal-flow>`. Always include meaningful fallback text for JavaScript-disabled browsers. Light DOM permits shared CSS and accessible native buttons. Every source-fed attribute is escaped before rendering.

Other elements: `signal-audit`, `signal-risk`, `signal-sovereignty`, `signal-poles`, `signal-timeline`, `signal-video`, `signal-preferences`. For actual service data, set `mode="live"`. Live empty components never populate demonstration records. Audit events accept a JSON `events` attribute: `{id,hash?,previousHash?,label?,verdict?,time?}`. No hash is verified client-side. Risk accepts nullable `score` and `trust` values in 0–100; missing values show an explicit unavailable state. These widgets do not calculate or override policy decisions.

## React / Next.js

Import CSS after existing globals. Import from `design-system/react`: `SignalBootstrap` once, then `AuthorizationFlow`, `AuditChain`, `RiskMeter`, `SovereigntyMap`, `PolesLockin`, `MissionTimeline`, `SignalVideo`, `SignalPreferences`, `VerdictBadge`, `ApprovalCountdown`. Components take `lang="fr"|"en"`; data components default to live mode. `AuditChain.onSelect` receives an event ID. `ApprovalCountdown.onExpire` fires once per expiration timestamp; the host disables actions, while the backend remains authoritative. The shared bootstrap script can restore preferences before paint.

## Motion and preferences

Light by default for new visitors; existing saved theme choices are preserved. Deep blue and cool neutral themes are independently specified. `xsom-signal-preferences` stores theme and reduced-motion choices locally. OS reduced motion always wins. A `signal-preference` window event lets host animations stop immediately. Sound is off each visit and only enabled by a gesture; no file/network/audio request is needed. `signalFeedback(verdict)` may be called only after an actual successful response for a live action.

Shared diagram motion runs on intent, then rests. Video demonstrates three patterns: hover play/freeze; Guarded/Unguarded source switching; a policy-layer control. Every clip has WebM, MP4, WebP poster, muted playback and a branded keyboard-operable player. Reduced-motion leaves the poster and static policy visible. Clips record the actual explanatory component, not a fabricated product screenshot. No stock video or invented production data.

## Primitives and density

`.signal-button`, `.signal-toggle`, `.signal-tag`, `.signal-card`, `.signal-bento`, `.signal-table`, `.signal-tabs`, `.signal-toast`, `.signal-modal`, `.signal-input`, `.signal-nav`, `.signal-footer`. Use native semantics (`button`, `table`, `dialog`, labeled fields); classes do not replace accessible behavior. Console never uses magnetic buttons or custom cursor. Layout-specific spacing is separate from the common palette. Breakpoints are fixed CSS media-query thresholds; all styling scales and color roles come from tokens.

Preview: serve the site locally and open `/design-system/preview.html`. Copy rules: `VOICE.md`. Runtime has no external library, font CDN or tracking. The package's `build.mjs` runs only during maintenance; the corporate deploy remains build-free.
