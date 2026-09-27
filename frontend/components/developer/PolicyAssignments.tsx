"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ConsoleError,
  ConsoleSkeleton,
  EmptyState,
  localTime,
} from "@/components/ConsoleUI";
import { apiGet, apiSend, apiSendVoid } from "@/lib/client";
import { useT } from "@/lib/i18n";
import {
  OBSERVE_CAP_CHOICES,
  normalizeObserveCap,
  observeCapOption,
  observeCapSummary,
  readObserveCap,
  withObserveCap,
  type ObserveCap,
} from "./observe-cap";

type Device = { id: string; name: string; revoked_at: string | null };
type Policy = {
  policy_id: string;
  version: number;
  expires_at: string;
  revoked_at: string | null;
  key_id: string;
  observe_max_minutes?: number | null;
  min_runner_version?: string | null;
};

function template(): string {
  const now = new Date();
  const expires = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  return JSON.stringify(
    {
      schemaVersion: 1,
      policyId: "team-default",
      version: 1,
      issuedAt: new Date(now.getTime() - 60_000).toISOString(),
      expiresAt: expires.toISOString(),
      defaults: { unknownAction: "deny" },
      rules: [
        {
          id: "allow-read",
          effect: "allow",
          match: { actionClasses: ["read"] },
        },
        {
          id: "approval-publish",
          effect: "require_approval",
          match: { actionClasses: ["publish", "deploy"] },
        },
      ],
    },
    null,
    2,
  );
}

/** How Avertir is capped on the workstations, chosen while composing. */
function ObserveCapChoice({
  body,
  onChange,
}: {
  body: string;
  onChange: (next: string) => void;
}) {
  const { t } = useT();
  const reading = readObserveCap(body);
  const unreadable = reading === "unreadable";
  const hint =
    reading === "unreadable"
      ? t("devpol.observe.unreadable")
      : reading === "unknown"
        ? t("devpol.observe.unknown")
        : t("devpol.observe.hint");
  const choose = (cap: ObserveCap) => {
    const next = withObserveCap(body, cap);
    if (next !== undefined) onChange(next);
  };
  return (
    <fieldset
      className="devpol-observe"
      disabled={unreadable}
      aria-describedby="devpol-observe-hint"
    >
      <legend>{t("devpol.observe.legend")}</legend>
      <div className="devpol-observe-options">
        {OBSERVE_CAP_CHOICES.map((cap) => (
          <label key={String(cap)}>
            <input
              type="radio"
              name="devpol-observe-cap"
              value={cap === null ? "none" : String(cap)}
              checked={reading === cap}
              onChange={() => choose(cap)}
            />
            {t(observeCapOption(cap))}
          </label>
        ))}
      </div>
      <p
        id="devpol-observe-hint"
        className="devpol-observe-hint"
        role={reading === "unknown" ? "alert" : undefined}
      >
        {hint}
      </p>
    </fieldset>
  );
}

function PolicySummary({ policy }: { policy: Policy }) {
  const { t, lang } = useT();
  const cap = normalizeObserveCap(policy.observe_max_minutes);
  return (
    <li>
      <div>
        <strong>
          {policy.policy_id} · v{policy.version}
        </strong>
        <span>
          {t("devpol.summary.expires", {
            date: localTime(policy.expires_at, lang),
          })}
          {policy.min_runner_version
            ? ` · ${t("devpol.summary.runner", { v: policy.min_runner_version })}`
            : ""}
        </span>
      </div>
      <span className="devpol-cap" data-cap={cap ?? "none"}>
        {cap === "unknown" || cap === "unreadable"
          ? t("devpol.summary.unknown")
          : t(observeCapSummary(cap))}
      </span>
    </li>
  );
}

export function PolicyAssignments({ devices }: { devices: readonly Device[] }) {
  const { t } = useT();
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [listState, setListState] = useState<"loading" | "error" | "ready">(
    "loading",
  );
  const [listError, setListError] = useState<unknown>(null);
  const [body, setBody] = useState(template);
  const [selectedPolicy, setSelectedPolicy] = useState("");
  const [selectedDevice, setSelectedDevice] = useState("");
  const [message, setMessage] = useState("");
  const generation = useRef(0);
  const activeDevices = useMemo(
    () => devices.filter((device) => !device.revoked_at),
    [devices],
  );
  const reload = useCallback(async () => {
    const run = ++generation.current;
    setListState("loading");
    try {
      const list = await apiGet<Policy[]>("v1/developer-policies");
      if (run !== generation.current) return;
      setPolicies(list.filter((policy) => !policy.revoked_at));
      setListState("ready");
    } catch (error) {
      if (run !== generation.current) return;
      setListError(error);
      setListState("error");
    }
  }, []);
  useEffect(() => {
    const requests = generation;
    void reload();
    return () => {
      requests.current++;
    };
  }, [reload]);
  async function publish() {
    try {
      const parsed = JSON.parse(body) as { policyId?: unknown };
      if (typeof parsed.policyId !== "string" || !parsed.policyId)
        throw new Error(t("devpol.missingId"));
      await apiSend(
        `v1/developer-policies/${encodeURIComponent(parsed.policyId)}`,
        "PUT",
        parsed,
      );
      await reload();
      setSelectedPolicy(parsed.policyId);
      setMessage(t("devpol.published"));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t("devpol.invalid"));
    }
  }
  async function assign() {
    if (!selectedPolicy || !selectedDevice) return;
    try {
      await apiSendVoid(
        `v1/developer-policies/${encodeURIComponent(selectedPolicy)}/assign/${encodeURIComponent(selectedDevice)}`,
        "POST",
      );
      setMessage(t("devpol.assigned"));
    } catch {
      setMessage(t("devpol.assignFailed"));
    }
  }
  return (
    <section
      className="console-panel"
      aria-labelledby="developer-policies-title"
    >
      <div className="console-panel-heading">
        <h2 id="developer-policies-title">{t("devpol.title")}</h2>
        <span className="console-count">{policies.length}</span>
      </div>
      <p className="console-note">{t("devpol.note")}</p>
      <div className="devpol-compose">
        <label>
          {t("devpol.json")}{" "}
          <textarea
            aria-label={t("devpol.json")}
            value={body}
            onChange={(event) => setBody(event.target.value)}
            rows={12}
            style={{ width: "100%", fontFamily: "var(--font-mono, monospace)" }}
          />
        </label>
        <ObserveCapChoice body={body} onChange={setBody} />
      </div>
      <div className="console-actions">
        <button className="btn btn-ghost" onClick={() => void publish()}>
          {t("devpol.publish")}
        </button>
      </div>
      <section aria-labelledby="developer-policies-list">
        <h3 id="developer-policies-list" className="devpol-list-title">
          {t("devpol.list.title")}
        </h3>
        {listState === "loading" ? (
          <ConsoleSkeleton rows={2} />
        ) : listState === "error" ? (
          <ConsoleError error={listError} retry={() => void reload()} />
        ) : policies.length === 0 ? (
          <EmptyState
            title={t("devpol.list.emptyTitle")}
            description={t("devpol.list.emptyBody")}
          />
        ) : (
          <ul className="risk-tool-list devpol-list">
            {policies.map((policy) => (
              <PolicySummary policy={policy} key={policy.policy_id} />
            ))}
          </ul>
        )}
      </section>
      <div className="console-actions">
        <label>
          {t("devpol.assign.policyLabel")}{" "}
          <select
            aria-label={t("devpol.assign.policy")}
            value={selectedPolicy}
            onChange={(event) => setSelectedPolicy(event.target.value)}
          >
            <option value="">{t("devpol.assign.choose")}</option>
            {policies.map((policy) => (
              <option value={policy.policy_id} key={policy.policy_id}>
                {policy.policy_id} · v{policy.version}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t("devpol.assign.deviceLabel")}{" "}
          <select
            aria-label={t("devpol.assign.device")}
            value={selectedDevice}
            onChange={(event) => setSelectedDevice(event.target.value)}
          >
            <option value="">{t("devpol.assign.choose")}</option>
            {activeDevices.map((device) => (
              <option value={device.id} key={device.id}>
                {device.name}
              </option>
            ))}
          </select>
        </label>
        <button
          className="btn btn-ghost"
          disabled={!selectedPolicy || !selectedDevice}
          onClick={() => void assign()}
        >
          {t("devpol.assign")}
        </button>
      </div>
      <p role="status">{message}</p>
    </section>
  );
}
