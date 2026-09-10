/* xSOM Signal 2.0. Dependency-free progressive web components, shared verbatim. */
const esc = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ],
  );
const choose = (el, fr, en) => (el.getAttribute("lang") === "en" ? en : fr);
const tag = (value) =>
  `<span class="signal-tag" data-verdict="${esc(value)}">${esc(value)}</span>`;
const demo = (el) => el.getAttribute("mode") !== "live";
const demoLabel = (el) =>
  demo(el)
    ? choose(
        el,
        "Démonstration · données illustratives",
        "Demo · illustrative data",
      )
    : choose(el, "Données du service", "Service data");
const title = (label, note) =>
  `<div class="signal-caption"><span class="signal-label">${esc(label)}</span><span class="signal-demo">${esc(note)}</span></div>`;
export const normalizeVerdict = (value) => {
  const normalized = String(value ?? "").toLowerCase();
  const aliases = {
    human_in_the_loop: "hitl",
    human_dual: "hitl",
    hitl_pending: "hitl",
    hitl_approved: "approved",
    hitl_denied: "deny",
    allowed: "allow",
    denied: "deny",
  };
  const verdict = aliases[normalized] || normalized;
  return [
    "auto",
    "allow",
    "notify",
    "hitl",
    "deny",
    "pending",
    "approved",
    "expired",
    "drift",
    "taint",
    "quarantine",
  ].includes(verdict)
    ? verdict
    : "unknown";
};
const validVerdict = normalizeVerdict;
const key = "xsom-signal-preferences";
let preferences = { theme: "light", reduced: false, sound: false };
let initialized = false;
let audioContext;

export function applyPreferences(next = {}) {
  preferences = { ...preferences, ...next };
  const reduced =
    preferences.reduced ||
    matchMedia("(prefers-reduced-motion: reduce)").matches;
  const html = document.documentElement;
  html.dataset.theme = preferences.theme === "light" ? "light" : "dark";
  html.dataset.reducedMotion = String(reduced);
  html.dataset.motion = reduced ? "off" : "on";
  try {
    localStorage.setItem(key, JSON.stringify(preferences));
  } catch {
    /* Storage is optional. */
  }
  window.dispatchEvent(
    new CustomEvent("signal-preference", {
      detail: { ...preferences, reduced },
    }),
  );
  return { ...preferences, reduced };
}

export function signalFeedback(verdict = "allow") {
  if (!preferences.sound) return;
  try {
    const Audio = window.AudioContext || window.webkitAudioContext;
    if (!Audio) return;
    audioContext ||= new Audio();
    if (audioContext.state === "suspended") void audioContext.resume();
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    const now = audioContext.currentTime;
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(verdict === "deny" ? 180 : 480, now);
    oscillator.frequency.exponentialRampToValueAtTime(
      verdict === "deny" ? 140 : 720,
      now + 0.08,
    );
    gain.gain.setValueAtTime(0.035, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
    oscillator.connect(gain);
    gain.connect(audioContext.destination);
    oscillator.start(now);
    oscillator.stop(now + 0.13);
  } catch {
    /* Audio is a non-essential, explicitly enabled enhancement. */
  }
}

export function initSignal() {
  if (typeof window === "undefined" || initialized) return;
  initialized = true;
  try {
    const stored = JSON.parse(localStorage.getItem(key) || "{}");
    preferences.theme = stored.theme === "dark" ? "dark" : "light";
    preferences.reduced = stored.reduced === true;
    // Sound is opt-in for each visit, never resumed without a current gesture.
    preferences.sound = false;
  } catch {
    /* Default theme works without storage. */
  }
  applyPreferences();
  matchMedia("(prefers-reduced-motion: reduce)").addEventListener(
    "change",
    () => applyPreferences(),
  );

  class SignalElement extends HTMLElement {
    static get observedAttributes() {
      return [
        "lang",
        "verdict",
        "events",
        "score",
        "trust",
        "mode",
        "variant",
        "asset-base",
        "interactive",
      ];
    }
    connectedCallback() {
      this.addEventListener("click", this);
      this.render();
    }
    disconnectedCallback() {
      this.removeEventListener("click", this);
    }
    attributeChangedCallback() {
      if (this.isConnected) this.render();
    }
    handleEvent(event) {
      const button = event.target.closest("button");
      if (button && this.contains(button)) this.act?.(button, event);
    }
    render() {}
    replace(content, focus) {
      this.innerHTML = content;
      if (focus)
        this.querySelector(`[data-action="${focus}"]`)?.focus({
          preventScroll: true,
        });
    }
  }

  class Flow extends SignalElement {
    render() {
      const verdict = validVerdict(
        this.getAttribute("verdict") || (demo(this) ? "hitl" : "unknown"),
      );
      const guarded = this.guarded !== false;
      const interactive = this.hasAttribute("interactive") && demo(this);
      const blocked =
        guarded && !["auto", "allow", "notify", "approved"].includes(verdict);
      const decision = !guarded
        ? choose(this, "Aucune", "None")
        : verdict.toUpperCase();
      let outcome = !guarded
        ? choose(
            this,
            "L’outil exécute sans point de contrôle.",
            "The tool executes without a control point.",
          )
        : {
            hitl: choose(
              this,
              "L’action attend une décision humaine. Expiry = deny.",
              "The action awaits a human decision. Expiry = deny.",
            ),
            pending: choose(
              this,
              "L’action attend une décision humaine. Expiry = deny.",
              "The action awaits a human decision. Expiry = deny.",
            ),
            deny: choose(
              this,
              "L’action est bloquée avant tout effet de bord.",
              "The action is blocked before side effects.",
            ),
            expired: choose(
              this,
              "Le délai est dépassé. L’action reste bloquée.",
              "The deadline passed. The action stays blocked.",
            ),
            auto: choose(
              this,
              "La policy autorise. L’outil peut exécuter.",
              "Policy permits. The tool may execute.",
            ),
            allow: choose(
              this,
              "La policy autorise. L’outil peut exécuter.",
              "Policy permits. The tool may execute.",
            ),
            notify: choose(
              this,
              "La policy autorise et notifie.",
              "Policy permits and notifies.",
            ),
          }[verdict] ||
          choose(
            this,
            "Le verdict du service fait autorité.",
            "The service verdict is authoritative.",
          );
      if (!demo(this)) {
        outcome = verdict === "unknown"
          ? choose(this, "Verdict inconnu. Autorisation non établie.", "Unknown verdict. Authorization is not established.")
          : ["hitl", "pending"].includes(verdict)
            ? choose(this, "La policy exige une validation humaine. Expiry = deny.", "Policy requires human approval. Expiry = deny.")
            : blocked
              ? choose(this, "Exécution non autorisée par la policy.", "Execution is not authorized by policy.")
              : choose(this, "La policy permet l’exécution. Ce schéma n’en confirme pas la réalisation.", "Policy permits execution. This diagram does not confirm it occurred.");
      }
      this.replace(`<section class="signal-panel" data-verdict="${verdict}">
        ${title(choose(this, "Flux d’autorisation", "Authorization flow"), demoLabel(this))}
        ${interactive ? `<div class="signal-caption"><button class="signal-toggle" data-action="guarded" aria-pressed="${guarded}"><span class="signal-toggle__track" aria-hidden="true"></span>${guarded ? "Guarded" : "Unguarded"}</button><div class="signal-segmented" aria-label="${choose(this, "Décision illustrée", "Illustrated decision")}">${["auto", "notify", "hitl", "deny"].map((v) => `<button class="signal-tab" data-action="verdict" data-value="${v}" aria-pressed="${v === verdict}" ${!guarded ? "disabled" : ""}>${v.toUpperCase()}</button>`).join("")}</div></div>` : ""}
        <div class="signal-flow__track" aria-label="${choose(this, "Agent, Guard, policy, outil", "Agent, Guard, policy, tool")}">
          <div class="signal-flow__node"><strong>Agent</strong><small>tool.call → MCP</small></div><span class="signal-flow__wire" aria-hidden="true"></span>
          <div class="signal-flow__node ${guarded ? "signal-flow__node--guard" : "signal-flow__node--stopped"}"><strong>Guard</strong><small>${guarded ? choose(this, "contrôle de l’action", "action control") : choose(this, "désactivé", "bypassed")}</small></div><span class="signal-flow__wire" aria-hidden="true"></span>
          <div class="signal-flow__node signal-flow__node--decision"><strong>${esc(decision)}</strong><small>${guarded ? "policy.match" : "no policy"}</small></div><span class="signal-flow__wire" aria-hidden="true"></span>
          <div class="signal-flow__node ${blocked ? "signal-flow__node--stopped" : ""}"><strong>${choose(this, "Outil", "Tool")}</strong><small>${blocked ? (demo(this) ? choose(this, "non exécuté", "not executed") : choose(this, "non autorisé", "not authorized")) : choose(this, "exécution permise", "execution permitted")}</small></div>
        </div><div class="signal-flow__foot"><p role="status">${esc(outcome)}</p>${interactive ? `<button class="signal-button" data-action="replay">${choose(this, "Rejouer le flux", "Replay flow")} <span aria-hidden="true">↗</span></button>` : ""}</div>
      </section>`);
    }
    act(button) {
      const action = button.dataset.action;
      if (action === "guarded") {
        this.guarded = this.guarded === false;
        this.render();
        this.querySelector('[data-action="guarded"]')?.focus();
      }
      if (action === "verdict") {
        this.setAttribute("verdict", button.dataset.value);
        this.querySelector(`[data-value="${button.dataset.value}"]`)?.focus();
      }
      if (["guarded", "verdict", "replay"].includes(action)) {
        const panel = this.querySelector(".signal-panel");
        panel?.removeAttribute("data-pulse");
        requestAnimationFrame(() => panel?.setAttribute("data-pulse", "true"));
        signalFeedback(this.getAttribute("verdict"));
      }
    }
  }

  class Audit extends SignalElement {
    entries() {
      if (this.hasAttribute("events")) {
        try {
          const data = JSON.parse(this.getAttribute("events"));
          return Array.isArray(data) ? data.slice(0, 50) : [];
        } catch {
          return [];
        }
      }
      return demo(this)
        ? [
            {
              id: "demo-001",
              label: "tool.request",
              hash: "demo:a91f…2e7c",
              previousHash: "demo:genesis",
              verdict: "notify",
              time: "10:42:01",
            },
            {
              id: "demo-002",
              label: "policy.match",
              hash: "demo:b28e…6a03",
              previousHash: "demo:a91f…2e7c",
              verdict: "hitl",
              time: "10:42:01",
            },
            {
              id: "demo-003",
              label: "human.decision",
              hash: "demo:c70d…f491",
              previousHash: "demo:b28e…6a03",
              verdict: "deny",
              time: "10:42:18",
            },
          ]
        : [];
    }
    render() {
      const entries = this.entries();
      const index = Math.max(
        0,
        Math.min(this.selected || 0, entries.length - 1),
      );
      const entry = entries[index];
      this.replace(
        `<section class="signal-panel">${title(choose(this, "Chaîne d’audit", "Audit chain"), demoLabel(this))}${entry ? `<ol class="signal-audit__list">${entries.map((event, i) => `<li><button class="signal-audit__event" data-action="event" data-index="${i}" aria-pressed="${i === index}"><span class="signal-label">${String(i + 1).padStart(2, "0")} / ${esc(event.time || event.id)}</span><strong>${esc(event.label || event.id)}</strong><code>${esc(event.hash || choose(this, "Hash non exposé", "Hash not exposed"))}</code>${event.verdict ? tag(validVerdict(event.verdict)) : ""}</button></li>`).join("")}</ol><div class="signal-audit__detail" role="status"><strong>${esc(entry.id)}</strong><code>${choose(this, "Hash précédent", "Previous hash")}: ${esc(entry.previousHash || choose(this, "non exposé par l’API", "not exposed by the API"))}</code><code>Hash: ${esc(entry.hash || choose(this, "non exposé par l’API", "not exposed by the API"))}</code><p>${demo(this) ? choose(this, "Schéma illustratif. Ces empreintes ne sont pas des preuves cryptographiques.", "Illustrative diagram. These fingerprints are not cryptographic evidence.") : choose(this, "Événements du service. Ce dessin ne vérifie pas leur intégrité cryptographique.", "Service events. This diagram does not verify their cryptographic integrity.")}</p></div>` : `<p class="signal-empty">${choose(this, "Aucun événement à inspecter.", "No event to inspect.")}</p>`}</section>`,
      );
    }
    act(button) {
      if (button.dataset.action !== "event") return;
      this.selected = Number(button.dataset.index);
      const entry = this.entries()[this.selected];
      this.render();
      this.querySelector(`[data-index="${this.selected}"]`)?.focus();
      this.dispatchEvent(
        new CustomEvent("signal-select", { detail: entry, bubbles: true }),
      );
    }
  }

  class Risk extends SignalElement {
    render() {
      const number = (name) => {
        const v = this.getAttribute(name);
        return v !== null && v !== "" && Number.isFinite(Number(v))
          ? Math.max(0, Math.min(100, Number(v)))
          : null;
      };
      const score = number("score"),
        trust = number("trust");
      this.replace(
        `<section class="signal-panel">${title(choose(this, "Risque × confiance", "Risk × trust"), demoLabel(this))}<div class="signal-risk__body">${[
          [choose(this, "Risque de l’action", "Action risk"), score],
          [choose(this, "Confiance acquise", "Earned trust"), trust],
        ]
          .map(
            ([label, value]) =>
              `<div><span class="signal-label">${label}</span><strong class="signal-risk__value">${value === null ? "—" : value}<small class="signal-demo">${value === null ? "" : " / 100"}</small></strong>${value === null ? `<p class="signal-demo">${choose(this, "Non fourni par le service", "Not provided by the service")}</p>` : `<meter class="signal-risk__bar" min="0" max="100" value="${value}" aria-label="${label}">${value}/100</meter><div class="signal-risk__scale"><span>0</span><span>100</span></div>`}</div>`,
          )
          .join(
            "",
          )}</div><div class="signal-risk__legend">${["auto", "notify", "hitl", "deny"].map(tag).join("")}</div><div class="signal-flow__foot"><p>${choose(this, "La policy fixe les seuils. Le score ne vaut pas autorisation.", "Policy defines thresholds. A score is not authorization.")}</p></div></section>`,
      );
    }
  }

  class Sovereignty extends SignalElement {
    render() {
      const external = this.external === true;
      this.replace(
        `<section class="signal-panel">${title(choose(this, "Résidence & contrôle", "Residency & control"), choose(this, "Schéma d’architecture", "Architecture diagram"))}<div class="signal-caption"><div class="signal-segmented"><button class="signal-tab" data-action="internal" aria-pressed="${!external}">${choose(this, "Périmètre maîtrisé", "Owned perimeter")}</button><button class="signal-tab" data-action="external" aria-pressed="${external}">${choose(this, "Service externe", "External service")}</button></div></div><div class="signal-sovereignty__zones"><div class="signal-zone signal-zone--owned"><span class="signal-label">01 / ${choose(this, "Votre périmètre", "Your perimeter")}</span><h3>${choose(this, "Données. Clés. Audit.", "Data. Keys. Audit.")}</h3><ul><li>${choose(this, "Région et opérateur choisis", "Chosen region and operator")}</li><li>${choose(this, "Accès et clés sous contrôle", "Controlled access and keys")}</li><li>${choose(this, "Journal conservé selon vos règles", "Logs retained under your rules")}</li></ul></div><div class="signal-zone"><span class="signal-label">02 / ${external ? choose(this, "Frontière de sortie", "Egress boundary") : choose(this, "Calcul souverain", "Sovereign compute")}</span><h3>${external ? choose(this, "Sortie conditionnelle.", "Conditional egress.") : choose(this, "Le modèle vient aux données.", "The model comes to the data.")}</h3><ul><li>${external ? choose(this, "Destination autorisée explicitement", "Explicitly allowed destination") : choose(this, "Modèle déployé dans le périmètre", "Model deployed inside the perimeter")}</li><li>${external ? choose(this, "Filtrage DLP avant transfert", "DLP filtering before transfer") : choose(this, "Capacité et coûts observables", "Observable capacity and cost")}</li><li>${external ? choose(this, "Résidence à vérifier par contrat", "Residency to verify contractually") : choose(this, "Pas de sortie implicite", "No implicit egress")}</li></ul></div></div></section>`,
      );
    }
    act(button) {
      this.external = button.dataset.action === "external";
      this.render();
      this.querySelector(`[data-action="${button.dataset.action}"]`)?.focus();
    }
  }

  class Poles extends SignalElement {
    render() {
      this.active ||= new Set([0, 1, 2]);
      const names = choose(
        this,
        [
          "Télécom & cybersécurité",
          "IA & cloud souverain",
          "Data & automatisation",
        ],
        [
          "Telecom & cybersecurity",
          "AI & sovereign cloud",
          "Data & automation",
        ],
      );
      this.replace(
        `<section class="signal-panel">${title(choose(this, "Trois pôles. Un programme.", "Three practices. One programme."), choose(this, "Activez votre périmètre", "Select your scope"))}<div class="signal-poles__grid">${names.map((name, i) => `<button class="signal-pole" data-action="pole" data-index="${i}" aria-pressed="${this.active.has(i)}"><span class="signal-label">0${i + 1}</span><strong>${name}</strong><span class="signal-label">${this.active.has(i) ? choose(this, "Activé ↗", "Engaged ↗") : choose(this, "Activer +", "Engage +")}</span></button>`).join("")}</div><p class="signal-poles__summary" role="status">${this.active.size === 0 ? choose(this, "Choisissez le premier pôle de votre programme.", "Choose the first practice for your programme.") : choose(this, `${this.active.size} pôle${this.active.size > 1 ? "s" : ""} activé${this.active.size > 1 ? "s" : ""}. Du cadrage à la production.`, `${this.active.size} practice${this.active.size > 1 ? "s" : ""} engaged. From scope to production.`)}</p></section>`,
      );
    }
    act(button) {
      const i = Number(button.dataset.index);
      this.active.has(i) ? this.active.delete(i) : this.active.add(i);
      this.render();
      this.querySelector(`[data-index="${i}"]`)?.focus();
    }
  }

  class Timeline extends SignalElement {
    render() {
      const steps = choose(
        this,
        [
          ["Cadrage", "Contraintes. Risques. Décisions."],
          ["Build", "Architecture. Intégration. Tests."],
          ["Production", "Bascule. Preuves. Réversibilité."],
          ["Run", "Observation. Transmission. Ajustements."],
        ],
        [
          ["Scope", "Constraints. Risks. Decisions."],
          ["Build", "Architecture. Integration. Tests."],
          ["Production", "Cutover. Evidence. Reversibility."],
          ["Run", "Observe. Transfer. Adjust."],
        ],
      );
      this.replace(
        `<section class="signal-panel">${title(choose(this, "Jusqu’à la production", "Through to production"), choose(this, "Méthode xSOM", "xSOM method"))}<ol class="signal-timeline">${steps.map(([name, description], i) => `<li><span class="signal-label">0${i + 1}</span><strong>${name}</strong><p>${description}</p></li>`).join("")}</ol></section>`,
      );
    }
  }

  class Preferences extends SignalElement {
    connectedCallback() {
      this.refresh = () => this.render();
      window.addEventListener("signal-preference", this.refresh);
      super.connectedCallback();
    }
    disconnectedCallback() {
      window.removeEventListener("signal-preference", this.refresh);
      super.disconnectedCallback();
    }
    render() {
      const reduced =
        preferences.reduced ||
        matchMedia("(prefers-reduced-motion: reduce)").matches;
      const focus =
        document.activeElement?.closest("signal-preferences") === this
          ? document.activeElement.dataset.action
          : null;
      this.replace(
        `<div class="signal-preferences" role="group" aria-label="${choose(this, "Préférences d’affichage", "Display preferences")}">
        <button class="signal-toggle" data-action="theme" aria-pressed="${preferences.theme === "light"}"><span class="signal-toggle__track" aria-hidden="true"></span>${choose(this, "Thème clair", "Light theme")}</button>
        <button class="signal-toggle" data-action="motion" aria-pressed="${reduced}" aria-label="${choose(this, "Réduire les animations", "Reduce motion")}"><span class="signal-toggle__track" aria-hidden="true"></span>${choose(this, "Réduire les animations", "Reduce motion")}</button>
        <button class="signal-toggle" data-action="sound" aria-pressed="${preferences.sound}"><span class="signal-toggle__track" aria-hidden="true"></span>${choose(this, "Son", "Sound")}</button>
      </div>`,
        focus,
      );
    }
    act(button) {
      if (button.dataset.action === "theme")
        applyPreferences({
          theme: preferences.theme === "dark" ? "light" : "dark",
        });
      if (button.dataset.action === "motion")
        applyPreferences({ reduced: !preferences.reduced });
      if (button.dataset.action === "sound") {
        applyPreferences({ sound: !preferences.sound });
        signalFeedback();
      }
    }
  }

  class Video extends SignalElement {
    connectedCallback() {
      this.onPreference = () => {
        if (document.documentElement.dataset.reducedMotion === "true")
          this.stop(true);
        this.updatePlayButton();
      };
      this.onEnter = () => this.play();
      this.onLeave = () => {
        if (!this.manual) this.stop();
      };
      window.addEventListener("signal-preference", this.onPreference);
      this.addEventListener("pointerenter", this.onEnter);
      this.addEventListener("pointerleave", this.onLeave);
      super.connectedCallback();
    }
    disconnectedCallback() {
      window.removeEventListener("signal-preference", this.onPreference);
      this.removeEventListener("pointerenter", this.onEnter);
      this.removeEventListener("pointerleave", this.onLeave);
      this.stop();
      super.disconnectedCallback();
    }
    render() {
      const variant =
        this.getAttribute("variant") === "unguarded" ? "unguarded" : "guarded";
      const base = this.getAttribute("asset-base") || "/design-system/assets";
      const asset = (name) => `${base.replace(/\/$/, "")}/${name}`;
      const reduced = document.documentElement.dataset.reducedMotion === "true";
      this.replace(
        `<section class="signal-panel">${title(choose(this, "L’action, image par image", "The action, frame by frame"), choose(this, "Séquence illustrative", "Illustrative sequence"))}<div class="signal-video__stage" data-layer="flow"><video muted playsinline preload="none" poster="${esc(asset(variant + ".webp"))}" aria-label="${choose(this, "Schéma animé du contrôle d’action", "Animated action-control diagram")}"><source data-src="${esc(asset(variant + ".webm"))}" type="video/webm"><source data-src="${esc(asset(variant + ".mp4"))}" type="video/mp4"></video><div class="signal-video__layer"><code>${variant === "guarded" ? "mode: guarded" : "mode: unguarded"}</code><code>${variant === "guarded" ? "policy: human_approval" : "policy: none"}</code><code>${variant === "guarded" ? "on_expiry: deny" : "tool: execute_without_gate"}</code></div></div><div class="signal-video__controls"><button class="signal-toggle" data-action="variant" aria-pressed="${variant === "guarded"}"><span class="signal-toggle__track" aria-hidden="true"></span>${variant === "guarded" ? "Guarded" : "Unguarded"}</button><div class="signal-segmented"><button class="signal-tab" data-action="layer" aria-pressed="false">${choose(this, "Voir la policy", "View policy")}</button><button class="signal-button" data-action="play" ${reduced ? "disabled" : ""}>${choose(this, "Lire la séquence", "Play sequence")}</button></div></div><p class="signal-video__message" role="status">${reduced ? choose(this, "Animations réduites : poster et policy restent consultables.", "Reduced motion: poster and policy remain available.") : choose(this, "Survolez ou lancez la lecture. Le schéma s’arrête à la décision.", "Hover or press play. The diagram stops at the decision.")}</p></section>`,
      );
      this.querySelector("video")?.addEventListener("ended", () => {
        this.manual = false;
        this.updatePlayButton();
      });
      this.querySelector("video")?.addEventListener("error", () => {
        this.querySelector(".signal-video__message").textContent = choose(
          this,
          "Vidéo indisponible. Le poster et la vue policy restent accessibles.",
          "Video unavailable. Poster and policy view remain accessible.",
        );
      });
    }
    async play() {
      if (document.documentElement.dataset.reducedMotion === "true") return;
      const video = this.querySelector("video");
      if (!video) return;
      if (!video.dataset.loaded) {
        video
          .querySelectorAll("source")
          .forEach((source) => (source.src = source.dataset.src));
        video.dataset.loaded = "true";
        video.load();
      }
      if (video.ended) video.currentTime = 0;
      try {
        await video.play();
        this.updatePlayButton();
      } catch {
        /* Poster is the fallback for denied autoplay. */
      }
    }
    stop(poster = false) {
      const video = this.querySelector("video");
      if (video) {
        video.pause();
        if (poster) {
          video.currentTime = 0;
          video.removeAttribute("src");
          video
            .querySelectorAll("source")
            .forEach((s) => s.removeAttribute("src"));
          delete video.dataset.loaded;
          video.load();
        }
      }
      this.manual = false;
      this.updatePlayButton();
    }
    updatePlayButton() {
      const button = this.querySelector('[data-action="play"]'),
        video = this.querySelector("video");
      if (button) {
        button.disabled =
          document.documentElement.dataset.reducedMotion === "true";
        button.textContent =
          video && !video.paused
            ? choose(this, "Pause", "Pause")
            : choose(this, "Lire la séquence", "Play sequence");
      }
    }
    act(button) {
      if (button.dataset.action === "variant") {
        this.stop();
        this.setAttribute(
          "variant",
          this.getAttribute("variant") === "unguarded"
            ? "guarded"
            : "unguarded",
        );
        this.querySelector('[data-action="variant"]')?.focus();
      }
      if (button.dataset.action === "layer") {
        const stage = this.querySelector(".signal-video__stage");
        const policy = stage.dataset.layer !== "policy";
        stage.dataset.layer = policy ? "policy" : "flow";
        button.setAttribute("aria-pressed", String(policy));
      }
      if (button.dataset.action === "play") {
        const video = this.querySelector("video");
        if (video?.paused) {
          this.manual = true;
          void this.play();
        } else this.stop();
      }
    }
  }

  for (const [name, Element] of [
    ["signal-flow", Flow],
    ["signal-audit", Audit],
    ["signal-risk", Risk],
    ["signal-sovereignty", Sovereignty],
    ["signal-poles", Poles],
    ["signal-timeline", Timeline],
    ["signal-preferences", Preferences],
    ["signal-video", Video],
  ]) {
    if (!customElements.get(name)) customElements.define(name, Element);
  }
}

// Static hosts load this module directly. React hosts initialize after hydration.
if (
  typeof window !== "undefined" &&
  Array.from(document.scripts).some(
    (script) =>
      script.type === "module" &&
      /\/design-system\/signal\.js(?:\?|$)/.test(script.src),
  )
)
  initSignal();
