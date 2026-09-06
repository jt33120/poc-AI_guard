import { pageMetadata } from "@/lib/lang";

// La page reste cliente : elle porte un formulaire à état. Un layout qui ne fait
// qu'exporter `generateMetadata` lui rend malgré tout son titre et sa description,
// que Next ne peut pas demander à un composant client.
export function generateMetadata() {
  return pageMetadata("triage.title", { descriptionKey: "triage.lede" });
}

export default function TriageLayout({ children }: { children: React.ReactNode }) {
  return children;
}
