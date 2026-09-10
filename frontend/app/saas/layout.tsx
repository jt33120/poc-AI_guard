import { pageMetadata } from "@/lib/lang";

// La page reste cliente : elle lit la langue depuis le contexte. Un layout qui ne
// fait qu'exporter `generateMetadata` lui rend son titre et sa description, que Next
// ne peut pas demander à un composant client.
export function generateMetadata() {
  return pageMetadata("saas.meta.title", { descriptionKey: "saas.meta.lede" });
}

export default function SaasLayout({ children }: { children: React.ReactNode }) {
  return children;
}
