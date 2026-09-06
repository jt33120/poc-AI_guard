import { pageMetadata } from "@/lib/lang";

// `noindex`, et ici cela va plus loin qu'un principe : l'URL porte le code de
// récupération en `?code=`. Une page indexée, c'est un référent transmis et un
// cache public.
export function generateMetadata() {
  return pageMetadata("reset.title", { descriptionKey: "reset.subtitle", noindex: true });
}

export default function ResetPasswordLayout({ children }: { children: React.ReactNode }) {
  return children;
}
