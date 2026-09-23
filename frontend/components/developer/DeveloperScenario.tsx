"use client";

import { useState } from "react";

import { useT } from "@/lib/i18n";
import { DEVELOPER_COPY } from "./developer-copy";

type Threat = "secret" | "destructive" | "network";
type Profile = "local" | "team" | "reinforced";

export function DeveloperScenario() {
  const { lang } = useT();
  const copy = DEVELOPER_COPY[lang].scenario;
  const [threat, setThreat] = useState<Threat>("secret");
  const [profile, setProfile] = useState<Profile>("local");
  const selected = copy.threats[threat];

  return (
    <div className="developer-scenario" data-testid="developer-scenario">
      <div className="developer-scenario__controls">
        <fieldset>
          <legend>{copy.threatLabel}</legend>
          <div className="developer-segmented">
            {(Object.keys(copy.threats) as Threat[]).map((id) => (
              <button key={id} type="button" aria-pressed={threat === id} onClick={() => setThreat(id)}>
                {copy.threats[id].label}
              </button>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend>{copy.profileLabel}</legend>
          <div className="developer-segmented">
            {(Object.keys(copy.profiles) as Profile[]).map((id) => (
              <button key={id} type="button" aria-pressed={profile === id} onClick={() => setProfile(id)}>
                {copy.profiles[id]}
              </button>
            ))}
          </div>
        </fieldset>
      </div>

      <p className="developer-synthetic">{copy.synthetic}</p>
      <ol className="developer-scenario__steps" aria-live="polite">
        <li><span>01 · {copy.steps.request}</span><p>{selected.request}</p></li>
        <li><span>02 · {copy.steps.intercept}</span><p>{selected.intercept}</p></li>
        <li className="developer-scenario__decision"><span>03 · {copy.steps.decision}</span><p>{selected.decisions[profile]}</p></li>
        <li><span>04 · {copy.steps.evidence}</span><p>{selected.evidence}</p></li>
      </ol>
      <p className="developer-boundary">{copy.boundary}</p>
    </div>
  );
}
