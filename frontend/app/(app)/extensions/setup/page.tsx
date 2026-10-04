"use client";
import Link from "next/link";
import { ConsoleHeader } from "@/components/ConsoleUI";
import { ConsoleIcon } from "@/components/ConsoleIcon";
import { useT } from "@/lib/i18n";

export default function SetupPage() {
  const { lang } = useT();
  const tr = (fr: string, en: string) => lang === "fr" ? fr : en;
  return <section className="console-page">
    <ConsoleHeader eyebrow="Dev Guard" title={tr("Raccorder un poste", "Connect a workstation")} description={tr("Reliez l’extension de votre développeur à l’espace de votre entreprise.", "Connect your developer’s extension to your organization’s workspace.")} />
    <div className="workspace-steps">
      <section className="workspace-step"><span>1</span><h2>{tr("Installer Secret Guard", "Install Secret Guard")}</h2><p>{tr("Installez l’extension dans VS Code. Les protections locales restent disponibles sans abonnement.", "Install the VS Code extension. Local protection remains available without a subscription.")}</p><Link href="/secret-guard">{tr("Télécharger l’extension", "Download the extension")}</Link></section>
      <section className="workspace-step"><span>2</span><h2>{tr("Relier à mon entreprise", "Link to my organization")}</h2><p>{tr("Dans la palette de VS Code, lancez « Secret Guard: Relier à mon entreprise ». L’extension ouvre votre console avec un code temporaire.", "In VS Code’s command palette, run “Secret Guard: Relier à mon entreprise”. The extension opens your console with a temporary code.")}</p><Link href="/extensions/connect">{tr("Confirmer un code", "Confirm a code")}</Link></section>
      <section className="workspace-step"><span>3</span><h2>{tr("Confirmer l’entreprise et le poste", "Confirm the organization and workstation")}</h2><p>{tr("Un administrateur confirme l’entreprise, nomme le poste et peut préciser le membre et l’équipe. L’inventaire affiche ensuite sa version et son dernier contact.", "An administrator confirms the organization, names the workstation, and can specify a member and team. The inventory then shows its version and last contact.")}</p><Link href="/extensions/devices">{tr("Vérifier le poste", "Check workstation")}</Link></section>
    </div>
    <div className="workspace-notice"><ConsoleIcon name="audit" /><div><strong>{tr("Ce que vous retrouverez ici", "What you will see here")}</strong><p>{tr("L’état du poste, les décisions et le nombre de détections. Aucun prompt ni secret n’est conservé dans ce journal. Les déclarations de l’extension et les observations de la passerelle sont distinguées.", "Workstation status, decisions and detection counts. No prompt or secret is stored in this log. Extension reports are distinguished from gateway observations.")}</p></div></div>
    <p className="console-note">{tr("Le suivi du poste fonctionne avec les assistants locaux compatibles, indépendamment du relais Claude. Le relais Claude s’active séparément et ne concerne que les nouvelles sessions raccordées. Le contenu original transite par votre passerelle pour être nettoyé. Les autres assistants conservent les protections locales des chemins compatibles.", "Workstation tracking works with supported local assistants independently of the Claude relay. The Claude relay is enabled separately and covers new connected sessions only. Original content passes through your gateway for redaction. Other assistants retain local protection on supported paths.")}</p>
  </section>;
}
