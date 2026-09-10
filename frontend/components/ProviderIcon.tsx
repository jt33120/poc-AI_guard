/** Text identifiers, not invented vendor logos. Neutral across the Signal palette. */
const ABBREVIATIONS: Record<string, string> = {
  openai: "OA",
  anthropic: "AN",
  mistral: "MI",
  openrouter: "OR",
  langchain: "LC",
  mcp: "MCP",
  http: "API",
};
export function ProviderIcon({
  id,
  className,
}: {
  id: string;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={`console-provider-mark ${className ?? ""}`}
    >
      {ABBREVIATIONS[id] ?? "API"}
    </span>
  );
}
