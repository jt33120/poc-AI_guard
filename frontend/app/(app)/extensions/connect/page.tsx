"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ConsoleHeader, ConsoleError } from "@/components/ConsoleUI";
import { useWorkspace } from "@/components/WorkspaceProvider";
import { apiGet, apiSend } from "@/lib/client";
import { useT } from "@/lib/i18n";

interface PendingDevice { platform: string; extension_version: string; expires_at: string }
const CODE = /^[A-Z2-9]{5}-[A-Z2-9]{5}$/;

export default function ConnectWorkstationPage() {
  const { workspace, identity } = useWorkspace();
  const { lang } = useT();
  const tr = (fr: string, en: string) => lang === "fr" ? fr : en;
  const [code, setCode] = useState("");
  const [device, setDevice] = useState<PendingDevice | null>(null);
  const [name, setName] = useState("");
  const [member, setMember] = useState("");
  const [team, setTeam] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [complete, setComplete] = useState(false);
  useEffect(() => { setCode(new URLSearchParams(window.location.search).get("code") ?? ""); }, []);

  async function inspect(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError(null); setDevice(null);
    try { setDevice(await apiGet<PendingDevice>(`v1/extensions/enrollment?code=${encodeURIComponent(code)}`)); }
    catch (err) { setError(err); } finally { setBusy(false); }
  }
  async function confirm(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError(null);
    try {
      await apiSend("v1/extensions/enrollment", "POST", { code, name, member_label: member, team });
      setComplete(true);
    } catch (err) { setError(err); } finally { setBusy(false); }
  }
  return <section className="console-page">
    <ConsoleHeader eyebrow="Dev Guard" title={tr("Relier un poste à votre entreprise", "Link a workstation to your organization")} description={tr("Confirmez le code affiché dans votre extension, puis identifiez ce poste pour l’équipe.", "Confirm the code shown in your extension, then identify this workstation for your team.")} />
    <div className="workspace-company-strip"><div><h2>{workspace?.organization.name}</h2><p>{tr("Entreprise de rattachement", "Destination organization")} · {identity.email}</p></div></div>
    {identity.preview ? <div className="workspace-notice"><p>{tr("L’aperçu ne peut pas rattacher un poste réel. Ouvrez la console connectée à votre entreprise depuis l’extension.", "The preview cannot enroll a real workstation. Open your organization’s connected console from the extension.")}</p></div>
      : identity.role !== "admin" ? <div className="workspace-notice"><p>{tr("Un administrateur de l’entreprise doit confirmer ce rattachement.", "An organization administrator must confirm this enrollment.")}</p></div>
      : complete ? <section className="workspace-empty" role="status"><h2>{tr("Poste enregistré", "Workstation registered")}</h2><p>{name} · {workspace?.organization.name}</p><p>{tr("L’extension confirmera la connexion dans quelques secondes. Les signaux de présence sont indépendants du relais Claude.", "The extension will confirm the connection in a few seconds. Presence updates operate independently of the Claude relay.")}</p><Link className="btn btn-primary" href="/extensions/devices">{tr("Voir les postes de l’équipe", "View team workstations")}</Link></section>
      : <section className="console-panel workspace-enrollment">
        {error != null && <><ConsoleError error={error} /><p className="console-note">{tr("Un code expiré ou déjà confirmé nécessite de relancer le raccordement depuis l’extension.", "For an expired or already confirmed code, restart enrollment from the extension.")}</p></>}
        {!device ? <form onSubmit={inspect}>
          <label htmlFor="pairing-code">{tr("Code de l’extension", "Extension code")}</label>
          <input id="pairing-code" className="input" value={code} onChange={(e) => setCode(e.target.value.toUpperCase().trim())} placeholder="ABCDE-23456" maxLength={11} autoComplete="off" required />
          <p className="console-note">{tr("Vérifiez que ce code correspond à celui affiché dans votre VS Code.", "Check that this code matches the one displayed in your VS Code.")}</p>
          <button className="btn btn-primary" disabled={busy || !CODE.test(code)}>{busy ? tr("Vérification…", "Checking…") : tr("Vérifier le code", "Check code")}</button>
        </form> : <form onSubmit={confirm}>
          <div className="workspace-pairing-device"><strong>{code}</strong><span>{device.platform === "darwin" ? "macOS" : device.platform === "win32" ? "Windows" : "Linux"} · v{device.extension_version}</span><small>{tr("Valable jusqu’à", "Valid until")} {new Date(device.expires_at).toLocaleTimeString(lang)}</small></div>
          <label htmlFor="device-name">{tr("Nom du poste", "Workstation name")}</label><input className="input" id="device-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder={tr("Ex. Mac de Julian", "e.g. Julian’s Mac")} required />
          <label htmlFor="device-member">{tr("Membre — facultatif", "Member — optional")}</label><input className="input" id="device-member" value={member} onChange={(e) => setMember(e.target.value)} maxLength={100} />
          <label htmlFor="device-team">{tr("Équipe — facultatif", "Team — optional")}</label><input className="input" id="device-team" value={team} onChange={(e) => setTeam(e.target.value)} maxLength={80} />
          <p className="console-note">{tr("Ce rattachement partage l’état du poste et des métadonnées de protection avec l’entreprise. Aucun prompt ou secret n’est envoyé dans cet inventaire. Le relais Claude s’active séparément.", "Enrollment shares workstation status and protection metadata with the organization. No prompts or secrets are sent to this inventory. The Claude relay is enabled separately.")}</p>
          <div className="console-actions"><button className="btn btn-primary" disabled={busy || !name.trim()}>{busy ? tr("Rattachement…", "Linking…") : tr("Confirmer le rattachement", "Confirm enrollment")}</button><button className="btn btn-ghost" type="button" disabled={busy} onClick={() => setDevice(null)}>{tr("Changer de code", "Change code")}</button></div>
        </form>}
      </section>}
  </section>;
}
