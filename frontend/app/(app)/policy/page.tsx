"use client";
import { ConsoleHeader } from "@/components/ConsoleUI";
import { PolicyEditor } from "@/components/PolicyEditor";
import { useT } from "@/lib/i18n";
export default function PolicyPage() {
  const { lang } = useT();
  return (
    <section className="console-page">
      <ConsoleHeader
        eyebrow="08 / POLICY CONTROL"
        title={lang === "fr" ? "La policy décide." : "The policy decides."}
        description={
          lang === "fr"
            ? "Autoriser, notifier, faire signer ou refuser. Une règle explicite par action."
            : "Allow, notify, require approval or deny. An explicit rule for every action."
        }
      />
      <PolicyEditor />
    </section>
  );
}
