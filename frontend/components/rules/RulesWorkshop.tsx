"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";

import { EmptyState } from "@/components/ConsoleUI";
import { apiSend } from "@/lib/client";
import { useT } from "@/lib/i18n";

import {
  detectorProblems,
  displayedTest,
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
  // Le champ lui-même porte `aria-invalid` et `aria-describedby` ; ce conteneur ne fait
  // que les ranger.
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
  const problems = detectorProblems(detector);
  const invalid = (name: string) => (problems.has(name) ? true : undefined);
  const describe = (name: string, help = false) =>
    [help ? `${id(name)}-help` : "", problems.has(name) ? id("problems") : ""]
      .filter(Boolean)
      .join(" ") || undefined;
  return (
    <fieldset className="rules-detector" data-problem={problem || undefined}>
      <legend>
        {index + 1}. {copy.types[detector.type]}
        {detector.label ? ` · ${detector.label}` : ""}
      </legend>
      {problems.size > 0 && (
        <p className="rules-field-problem" id={id("problems")}>
          {fill(op.incomplete, {
            fields: [...problems].map((name) => copy.fields[name as keyof typeof copy.fields]).join(", "),
          })}
        </p>
      )}
      <div className="rules-fields">
        <Field id={id("id")} label={op.id}>
          <input
            id={id("id")}
            className="console-mono"
            value={detector.id}
            spellCheck={false}
            autoComplete="off"
            aria-invalid={invalid("id")}
            aria-describedby={describe("id")}
            onChange={(event) => set("id", event.target.value)}
          />
        </Field>
        <Field id={id("label")} label={op.label}>
          <input
            id={id("label")}
            value={detector.label}
            maxLength={80}
            spellCheck={false}
            autoComplete="off"
            aria-invalid={invalid("label")}
            aria-describedby={describe("label")}
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
              aria-invalid={invalid("pattern")}
              aria-describedby={describe("pattern", true)}
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
              autoComplete="off"
              aria-invalid={invalid("entropy")}
              aria-describedby={describe("entropy")}
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
            spellCheck={false}
            autoComplete="off"
            aria-invalid={invalid("keywords")}
            aria-describedby={describe("keywords")}
            onChange={(event) => set("keywords", event.target.value)}
          />
        </Field>
        <Field id={id("window")} label={op.window}>
          <input
            id={id("window")}
            inputMode="numeric"
            autoComplete="off"
            aria-invalid={invalid("window")}
            aria-describedby={describe("window")}
            value={detector.window}
            onChange={(event) => set("window", event.target.value)}
          />
        </Field>
      </div>
      {onRemove && (
        <button
          type="button"
          className="btn btn-ghost"
          aria-label={fill(op.removeDetector, { n: index + 1 })}
          onClick={onRemove}
        >
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
                  // Jamais un détecteur de termes : un positif est signé en clair,
                  // et il contiendrait le terme confidentiel.
                  .filter((detector) => detector.id && detector.type === "pattern")
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
              spellCheck={false}
              autoComplete="off"
              onChange={(event) => update(test.key, { text: event.target.value })}
            />
          </Field>
          <button
            type="button"
            className="btn btn-ghost"
            aria-label={fill(copy.removeTest, { n: index + 1 })}
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

/** Le dernier essai rendu, avec la composition et le texte exacts qu'il a éprouvés. */
interface Checked {
  draft: string;
  sample: string;
  result: DryRunResult;
}

const DEBOUNCE_MS = 900;
const RETRY_AFTER_LIMIT_MS = 8000;

/**
 * L'atelier d'un client : composer la version suivante, l'éprouver en direct, la signer.
 * Chaque modification relance un essai après une courte pause. On ne signe que la
 * composition **exacte** qu'un essai a trouvée valide : toute modification ultérieure
 * ferme la confirmation et exige un nouvel essai.
 */
export function RulesWorkshop({
  view,
  onPublished,
}: {
  view: OperatorRulesView;
  onPublished: (tenantId: string, message: string) => void;
}) {
  const { lang } = useT();
  const copy = RULES_COPY[lang].operator;
  const [form, setForm] = useState<DraftForm>(() => formFromView(view));
  const [sample, setSample] = useState("");
  const [checked, setChecked] = useState<Checked | null>(null);
  const [checking, setChecking] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [confirming, setConfirming] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [notice, setNotice] = useState("");
  const generation = useRef(0);
  const confirmRef = useRef<HTMLHeadingElement>(null);
  const publishRef = useRef<HTMLButtonElement>(null);
  const noticeRef = useRef<HTMLParagraphElement>(null);
  const problem = useMemo(() => localProblem(form), [form]);
  const draft = useMemo(() => JSON.stringify(toDraft(form)), [form]);
  const nextVersion = (view.pack?.version ?? 0) + 1;

  useEffect(() => {
    const run = ++generation.current;
    // Une composition modifiée n'est plus celle que l'on s'apprêtait à signer.
    setConfirming(false);
    if (problem) {
      setChecked(null);
      setChecking(false);
      return;
    }
    setChecking(true);
    const timer = setTimeout(() => {
      apiSend<DryRunResult>(
        `v1/xsom/tenants/${view.tenant.id}/rules-pack/dry-run`,
        "POST",
        { draft: JSON.parse(draft) as unknown, sample: sample || null },
      )
        .then((result) => {
          if (run !== generation.current) return;
          setChecked({ draft, sample, result });
          setFailure(null);
        })
        .catch((err: unknown) => {
          if (run !== generation.current) return;
          setChecked(null);
          const status = String(err);
          if (status.includes("429")) {
            setFailure(copy.rateLimited);
            setTimeout(() => setRetry((value) => value + 1), RETRY_AFTER_LIMIT_MS);
          } else {
            setFailure(status.includes("422") ? copy.malformed : copy.failed);
          }
        })
        .finally(() => {
          if (run === generation.current) setChecking(false);
        });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [draft, sample, problem, retry, view.tenant.id, copy]);

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

  const current = checked !== null && checked.draft === draft ? checked : null;
  const result = current?.result ?? null;
  const canPublish =
    view.signingReady && !problem && !checking && Boolean(result?.valid) && !publishing;

  const cancel = useCallback(() => {
    setConfirming(false);
    // Rendre le focus au bouton qui a ouvert la confirmation, une fois celui-ci remonté.
    setTimeout(() => publishRef.current?.focus(), 0);
  }, []);

  function onConfirmKey(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape" && !publishing) {
      event.stopPropagation();
      cancel();
    }
  }

  async function publish() {
    if (!current?.result.valid) return;
    setPublishing(true);
    setNotice("");
    try {
      const done = await apiSend<PublishResult>(
        `v1/xsom/tenants/${view.tenant.id}/rules-pack/publish`,
        "POST",
        { draft: JSON.parse(current.draft) as unknown, expectedVersion: view.pack?.version ?? 0 },
      );
      setConfirming(false);
      onPublished(
        view.tenant.id,
        fill(copy.published, {
          v: done.version,
          tenant: view.tenant.name,
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
              : status.includes("429")
                ? copy.rateLimited
                : copy.failed,
      );
      setTimeout(() => noticeRef.current?.focus(), 0);
    } finally {
      setPublishing(false);
    }
  }

  const testNumber = (code: string) => (sent: number) =>
    displayedTest(
      form,
      code === "negative_detected" || code === "negative_reveals_term" ? "negative" : "positive",
      sent,
    );
  const statusLine = problem
    ? copy.malformed
    : checking
      ? copy.checking
      : failure
        ? failure
        : result?.error
          ? explain(result.error, lang, testNumber(result.error.code))
          : result
            ? fill(copy.valid, { v: nextVersion })
            : "";
  const shown = current && !checking && current.sample === sample ? current : null;

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
                spellCheck={false}
                autoComplete="off"
                aria-invalid={problem === "packId" ? true : undefined}
                onChange={(event) =>
                  setForm({ ...form, packId: event.target.value })
                }
              />
            </Field>
            <Field id="pack-validity" label={copy.validity}>
              <input
                id="pack-validity"
                inputMode="numeric"
                autoComplete="off"
                aria-invalid={problem === "validityDays" ? true : undefined}
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
          {sample && shown && (
            <>
              <Highlighted text={sample} detections={shown.result.detections} />
              <p className="rules-status">
                {shown.result.detections.length
                  ? fill(copy.detections, { n: shown.result.detections.length })
                  : copy.noDetection}
                {shown.result.truncated ? ` ${copy.truncated}` : ""}
              </p>
              {shown.result.detections.length > 0 && (
                <ul className="rules-detections">
                  {shown.result.detections.map((found) => (
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
          <p
            className="rules-status"
            role="status"
            data-tone={notice ? "deny" : undefined}
            tabIndex={-1}
            ref={noticeRef}
          >
            {notice}
          </p>
          {confirming ? (
            <div
              className="rules-confirm"
              role="group"
              aria-labelledby="confirm-title"
              onKeyDown={onConfirmKey}
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
                  disabled={!canPublish}
                  onClick={() => void publish()}
                >
                  {publishing ? copy.publishing : copy.confirm}
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  disabled={publishing}
                  onClick={cancel}
                >
                  {copy.cancel}
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              className="btn btn-primary"
              ref={publishRef}
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
