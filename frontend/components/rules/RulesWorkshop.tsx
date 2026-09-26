"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { EmptyState } from "@/components/ConsoleUI";
import { apiSend } from "@/lib/client";
import { useT } from "@/lib/i18n";

import {
  emptyDetector,
  formFromView,
  localProblem,
  nextKey,
  toDraft,
  type DetectorForm,
  type DraftForm,
  type TestForm,
} from "./draft";
import { RULES_COPY, explain, fill, shortDigest } from "./rules-copy";
import type {
  Action,
  Category,
  DryRunResult,
  OperatorRulesView,
  PublishResult,
} from "./types";

const CATEGORIES: Category[] = [
  "credential",
  "customer_data",
  "personal_data",
  "internal_infra",
  "project",
];
const ACTIONS: Action[] = ["block", "warn"];

/** Un libellé, son champ, son aide : trois éléments frères, liés par identifiant. */
function Field({
  id,
  label,
  help,
  wide = false,
  children,
}: {
  id: string;
  label: string;
  help?: ReactNode;
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={wide ? "rules-field rules-span" : "rules-field"}>
      <label htmlFor={id}>{label}</label>
      {children}
      {help && <small id={`${id}-help`}>{help}</small>}
    </div>
  );
}

function Highlighted({
  text,
  detections,
}: {
  text: string;
  detections: DryRunResult["detections"];
}) {
  const parts: ReactNode[] = [];
  let cursor = 0;
  for (const found of [...detections].sort((a, b) => a.start - b.start)) {
    if (found.start < cursor) continue;
    if (found.start > cursor) parts.push(text.slice(cursor, found.start));
    parts.push(
      <mark key={`${found.start}-${found.detector}`} title={found.label}>
        {text.slice(found.start, found.end)}
      </mark>,
    );
    cursor = found.end;
  }
  parts.push(text.slice(cursor));
  return <pre className="rules-sample-view">{parts}</pre>;
}

function DetectorEditor({
  detector,
  index,
  problem,
  onChange,
  onRemove,
}: {
  detector: DetectorForm;
  index: number;
  problem: boolean;
  onChange: (next: DetectorForm) => void;
  onRemove: (() => void) | null;
}) {
  const { lang } = useT();
  const copy = RULES_COPY[lang];
  const op = copy.operator;
  const id = (name: string) => `${detector.key}-${name}`;
  const set = <K extends keyof DetectorForm>(key: K, value: DetectorForm[K]) =>
    onChange({ ...detector, [key]: value });
  return (
    <fieldset className="rules-detector" data-problem={problem || undefined}>
      <legend>
        {index + 1}. {copy.types[detector.type]}
        {detector.label ? ` · ${detector.label}` : ""}
      </legend>
      <div className="rules-fields">
        <Field id={id("id")} label={op.id}>
          <input
            id={id("id")}
            className="console-mono"
            value={detector.id}
            spellCheck={false}
            autoComplete="off"
            onChange={(event) => set("id", event.target.value)}
          />
        </Field>
        <Field id={id("label")} label={op.label}>
          <input
            id={id("label")}
            value={detector.label}
            maxLength={80}
            onChange={(event) => set("label", event.target.value)}
          />
        </Field>
        <Field id={id("category")} label={op.category}>
          <select
            id={id("category")}
            value={detector.category}
            onChange={(event) => set("category", event.target.value as Category)}
          >
            {CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {copy.categories[category]}
              </option>
            ))}
          </select>
        </Field>
        <Field id={id("action")} label={op.action}>
          <select
            id={id("action")}
            value={detector.action}
            onChange={(event) => set("action", event.target.value as Action)}
          >
            {ACTIONS.map((action) => (
              <option key={action} value={action}>
                {copy.actions[action]}
              </option>
            ))}
          </select>
        </Field>
      </div>
      {detector.type === "pattern" ? (
        <div className="rules-fields">
          <Field id={id("pattern")} label={op.pattern} help={op.patternHelp} wide>
            <input
              id={id("pattern")}
              className="console-mono"
              value={detector.pattern}
              maxLength={256}
              spellCheck={false}
              autoComplete="off"
              aria-describedby={id("pattern-help")}
              onChange={(event) => set("pattern", event.target.value)}
            />
          </Field>
          <div className="rules-field rules-check">
            <input
              id={id("ci")}
              type="checkbox"
              checked={detector.caseInsensitive}
              onChange={(event) => set("caseInsensitive", event.target.checked)}
            />
            <label htmlFor={id("ci")}>{op.caseInsensitive}</label>
          </div>
          <Field id={id("entropy")} label={op.entropy}>
            <input
              id={id("entropy")}
              inputMode="decimal"
              value={detector.entropy}
              onChange={(event) => set("entropy", event.target.value)}
            />
          </Field>
        </div>
      ) : (
        <div className="rules-fields">
          <Field
            id={id("terms")}
            label={op.terms}
            wide
            help={
              <>
                {op.termsHelp}{" "}
                {detector.publishedTerms
                  ? fill(op.termsKeep, { n: detector.publishedTerms })
                  : ""}
              </>
            }
          >
            <textarea
              id={id("terms")}
              rows={4}
              value={detector.terms}
              spellCheck={false}
              autoComplete="off"
              aria-describedby={id("terms-help")}
              onChange={(event) => set("terms", event.target.value)}
            />
          </Field>
        </div>
      )}
      <div className="rules-fields">
        <Field id={id("keywords")} label={op.keywords} wide>
          <input
            id={id("keywords")}
            value={detector.keywords}
            onChange={(event) => set("keywords", event.target.value)}
          />
        </Field>
        <Field id={id("window")} label={op.window}>
          <input
            id={id("window")}
            inputMode="numeric"
            value={detector.window}
            onChange={(event) => set("window", event.target.value)}
          />
        </Field>
      </div>
      {onRemove && (
        <button type="button" className="btn btn-ghost" onClick={onRemove}>
          {op.remove}
        </button>
      )}
    </fieldset>
  );
}

function TestList({
  title,
  tests,
  detectors,
  withDetector,
  addLabel,
  onChange,
}: {
  title: string;
  tests: TestForm[];
  detectors: DetectorForm[];
  withDetector: boolean;
  addLabel: string;
  onChange: (next: TestForm[]) => void;
}) {
  const { lang } = useT();
  const copy = RULES_COPY[lang].operator;
  const update = (key: string, patch: Partial<TestForm>) =>
    onChange(
      tests.map((test) => (test.key === key ? { ...test, ...patch } : test)),
    );
  return (
    <fieldset className="rules-tests">
      <legend>{title}</legend>
      {tests.map((test, index) => (
        <div
          key={test.key}
          className="rules-test"
          data-with-detector={withDetector || undefined}
        >
          {withDetector && (
            <Field id={`${test.key}-detector`} label={copy.testDetector}>
              <select
                id={`${test.key}-detector`}
                value={test.detector}
                onChange={(event) =>
                  update(test.key, { detector: event.target.value })
                }
              >
                <option value="">—</option>
                {detectors
                  .filter((detector) => detector.id)
                  .map((detector) => (
                    <option key={detector.key} value={detector.id}>
                      {detector.label || detector.id}
                    </option>
                  ))}
              </select>
            </Field>
          )}
          <Field id={`${test.key}-text`} label={`${copy.testText} ${index + 1}`}>
            <textarea
              id={`${test.key}-text`}
              rows={2}
              value={test.text}
              maxLength={2000}
              onChange={(event) => update(test.key, { text: event.target.value })}
            />
          </Field>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => onChange(tests.filter((item) => item.key !== test.key))}
          >
            {copy.remove}
          </button>
        </div>
      ))}
      <button
        type="button"
        className="btn btn-ghost"
        onClick={() =>
          onChange([...tests, { key: nextKey(), detector: "", text: "" }])
        }
      >
        {addLabel}
      </button>
    </fieldset>
  );
}

/**
 * L'atelier d'un client : composer la version suivante, l'éprouver en direct, la signer.
 * Chaque modification relance un essai après une courte pause ; la publication n'est
 * offerte que sur un essai valide et une clé présente, et demande une confirmation.
 */
export function RulesWorkshop({
  view,
  onPublished,
}: {
  view: OperatorRulesView;
  onPublished: (message: string) => void;
}) {
  const { lang } = useT();
  const copy = RULES_COPY[lang].operator;
  const [form, setForm] = useState<DraftForm>(() => formFromView(view));
  const [sample, setSample] = useState("");
  const [result, setResult] = useState<DryRunResult | null>(null);
  const [checking, setChecking] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const generation = useRef(0);
  const confirmRef = useRef<HTMLHeadingElement>(null);
  const problem = useMemo(() => localProblem(form), [form]);
  const nextVersion = (view.pack?.version ?? 0) + 1;

  useEffect(() => {
    const run = ++generation.current;
    if (problem) {
      setResult(null);
      setChecking(false);
      return;
    }
    setChecking(true);
    const timer = setTimeout(() => {
      apiSend<DryRunResult>(
        `v1/xsom/tenants/${view.tenant.id}/rules-pack/dry-run`,
        "POST",
        { draft: toDraft(form), sample: sample || null },
      )
        .then((answer) => {
          if (run !== generation.current) return;
          setResult(answer);
          setFailure(null);
        })
        .catch((err: unknown) => {
          if (run !== generation.current) return;
          setResult(null);
          setFailure(String(err).includes("422") ? copy.malformed : copy.failed);
        })
        .finally(() => {
          if (run === generation.current) setChecking(false);
        });
    }, 600);
    return () => clearTimeout(timer);
  }, [form, sample, problem, view.tenant.id, copy.malformed, copy.failed]);

  useEffect(() => {
    if (confirming) confirmRef.current?.focus();
  }, [confirming]);

  const updateDetector = (key: string, next: DetectorForm) =>
    setForm((current) => ({
      ...current,
      detectors: current.detectors.map((detector) =>
        detector.key === key ? next : detector,
      ),
    }));

  async function publish() {
    setPublishing(true);
    setNotice(null);
    try {
      const done = await apiSend<PublishResult>(
        `v1/xsom/tenants/${view.tenant.id}/rules-pack/publish`,
        "POST",
        { draft: toDraft(form), expectedVersion: view.pack?.version ?? 0 },
      );
      setConfirming(false);
      onPublished(
        fill(copy.published, {
          v: done.version,
          d: shortDigest(done.payloadDigest),
        }),
      );
    } catch (err) {
      const status = String(err);
      setConfirming(false);
      setNotice(
        status.includes("409")
          ? copy.conflict
          : status.includes("503")
            ? copy.unavailable
            : status.includes("422")
              ? copy.rejected
              : copy.failed,
      );
    } finally {
      setPublishing(false);
    }
  }

  const statusLine = problem
    ? copy.malformed
    : checking
      ? copy.checking
      : failure
        ? failure
        : result?.error
          ? explain(result.error, lang)
          : result
            ? fill(copy.valid, { v: nextVersion })
            : "";
  const canPublish =
    view.signingReady &&
    !problem &&
    !checking &&
    Boolean(result?.valid) &&
    !publishing;

  return (
    <div className="rules-workshop">
      {!view.signingReady && (
        <p className="rules-warning" role="note">
          {copy.signingMissing}
        </p>
      )}
      <section className="console-panel" aria-labelledby="workshop-pack">
        <div className="console-panel-heading">
          <h2 id="workshop-pack">{copy.detectors}</h2>
          <span className="console-count">{form.detectors.length}</span>
        </div>
        <div className="rules-body">
          <div className="rules-fields">
            <Field id="pack-id" label={copy.packId}>
              <input
                id="pack-id"
                className="console-mono"
                value={form.packId}
                readOnly={Boolean(view.pack)}
                onChange={(event) =>
                  setForm({ ...form, packId: event.target.value })
                }
              />
            </Field>
            <Field id="pack-validity" label={copy.validity}>
              <input
                id="pack-validity"
                inputMode="numeric"
                value={form.validityDays}
                onChange={(event) =>
                  setForm({ ...form, validityDays: event.target.value })
                }
              />
            </Field>
          </div>
          {form.detectors.map((detector, index) => (
            <DetectorEditor
              key={detector.key}
              detector={detector}
              index={index}
              problem={problem === detector.key}
              onChange={(next) => updateDetector(detector.key, next)}
              onRemove={
                form.detectors.length > 1
                  ? () =>
                      setForm({
                        ...form,
                        detectors: form.detectors.filter(
                          (item) => item.key !== detector.key,
                        ),
                      })
                  : null
              }
            />
          ))}
          <div className="console-actions">
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() =>
                setForm({
                  ...form,
                  detectors: [...form.detectors, emptyDetector("pattern")],
                })
              }
            >
              {copy.addPattern}
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() =>
                setForm({
                  ...form,
                  detectors: [...form.detectors, emptyDetector("terms")],
                })
              }
            >
              {copy.addTerms}
            </button>
          </div>
        </div>
      </section>
      <section className="console-panel" aria-labelledby="workshop-tests">
        <div className="console-panel-heading">
          <h2 id="workshop-tests">{copy.tests}</h2>
        </div>
        <div className="rules-body">
          <TestList
            title={copy.positives}
            tests={form.positives}
            detectors={form.detectors}
            withDetector
            addLabel={copy.addPositive}
            onChange={(positives) => setForm({ ...form, positives })}
          />
          <TestList
            title={copy.negatives}
            tests={form.negatives}
            detectors={form.detectors}
            withDetector={false}
            addLabel={copy.addNegative}
            onChange={(negatives) => setForm({ ...form, negatives })}
          />
        </div>
      </section>
      <section className="console-panel" aria-labelledby="workshop-sample">
        <div className="console-panel-heading">
          <h2 id="workshop-sample">{copy.sample}</h2>
        </div>
        <div className="rules-body">
          <Field id="rules-sample" label={copy.sampleHelp} wide>
            <textarea
              id="rules-sample"
              rows={4}
              value={sample}
              maxLength={20000}
              spellCheck={false}
              autoComplete="off"
              onChange={(event) => setSample(event.target.value)}
            />
          </Field>
          <p
            className="rules-status"
            role="status"
            aria-live="polite"
            data-tone={
              problem || failure || result?.error
                ? "deny"
                : result?.valid
                  ? "allow"
                  : undefined
            }
          >
            {statusLine}
          </p>
          {sample && result && (
            <>
              <Highlighted text={sample} detections={result.detections} />
              <p className="rules-status">
                {result.detections.length
                  ? fill(copy.detections, { n: result.detections.length })
                  : copy.noDetection}
              </p>
              {result.detections.length > 0 && (
                <ul className="rules-detections">
                  {result.detections.map((found) => (
                    <li key={`${found.detector}-${found.start}`}>
                      <strong>{found.label}</strong>
                      <code>{sample.slice(found.start, found.end)}</code>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      </section>
      <section
        className="console-panel rules-publish"
        aria-labelledby="workshop-publish"
      >
        <div className="rules-body">
          <h2 id="workshop-publish" className="sr-only">
            {fill(copy.publish, { v: nextVersion })}
          </h2>
          {notice && (
            <p className="rules-status" role="status" data-tone="deny">
              {notice}
            </p>
          )}
          {confirming ? (
            <div
              className="rules-confirm"
              role="group"
              aria-labelledby="confirm-title"
            >
              <h3 id="confirm-title" tabIndex={-1} ref={confirmRef}>
                {fill(copy.confirmTitle, {
                  v: nextVersion,
                  tenant: view.tenant.name,
                })}
              </h3>
              <p>{copy.confirmBody}</p>
              <div className="console-actions">
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={publishing}
                  onClick={() => void publish()}
                >
                  {publishing ? copy.publishing : copy.confirm}
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  disabled={publishing}
                  onClick={() => setConfirming(false)}
                >
                  {copy.cancel}
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              className="btn btn-primary"
              disabled={!canPublish}
              onClick={() => setConfirming(true)}
            >
              {fill(copy.publish, { v: nextVersion })}
            </button>
          )}
        </div>
      </section>
    </div>
  );
}

export function WorkshopForbidden() {
  const { lang } = useT();
  const copy = RULES_COPY[lang].operator;
  return (
    <section className="console-panel">
      <EmptyState title={copy.forbiddenTitle} description={copy.forbiddenBody} />
    </section>
  );
}
