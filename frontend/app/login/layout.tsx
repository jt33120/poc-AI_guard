import { pageMetadata } from "@/lib/lang";

// `noindex` : un écran d'authentification n'a rien à faire dans un index public.
// Il n'apporte aucun contenu à un lecteur qui arrive d'un moteur de recherche, et
// une page d'entrée indexée est une invitation au remplissage automatisé.
export function generateMetadata() {
  return pageMetadata("login.title", { descriptionKey: "login.subtitle", noindex: true });
}

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return children;
}
