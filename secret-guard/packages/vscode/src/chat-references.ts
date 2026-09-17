// Text of the references attached to an @secretguard request. They are sent to
// the model inside the same message as the prompt, so one scan and one
// redaction pass cover everything the model receives.

export type ResolvedReference =
  | {
      readonly status: "text";
      readonly label: string;
      readonly content: string;
    }
  | { readonly status: "unreadable"; readonly label: string };

export type ReferenceText = Extract<ResolvedReference, { status: "text" }>;

export function composePrompt(
  prompt: string,
  references: readonly ReferenceText[],
): string {
  return [
    prompt,
    ...references.map(
      ({ label, content }) =>
        `[Pièce jointe : ${label}]\n${content}\n[Fin de la pièce jointe : ${label}]`,
    ),
  ].join("\n\n");
}

function inlineCode(value: string): string {
  return `\`${value.replace(/[`\r\n]/gu, " ")}\``;
}

export function unreadableReferencesMessage(labels: readonly string[]): string {
  return [
    "$(lock) **Envoi bloqué.** Secret Guard ne peut pas analyser localement :",
    ...labels.map((label) => `- ${inlineCode(label)}`),
    "",
    "Seuls les fichiers texte UTF-8 de 1 Mio au plus sont vérifiés. Retirez cette référence ou collez son contenu en texte.",
  ].join("\n");
}
