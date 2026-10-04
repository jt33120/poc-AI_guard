"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ConsoleHeader, ConsoleSkeleton } from "@/components/ConsoleUI";
import { ConsoleIcon } from "@/components/ConsoleIcon";
import { useWorkspace } from "@/components/WorkspaceProvider";
import { apiGet } from "@/lib/client";
import { useT } from "@/lib/i18n";
import { accessLabel, canOpenProduct, PRODUCTS, type Product } from "@/lib/workspace";

export default function HomePage() {
  const { lang } = useT();
  const tr = (fr: string, en: string) => lang === "fr" ? fr : en;
  const { workspace, identity, loading, error, reload } = useWorkspace();
  const [counts, setCounts] = useState<{ devices: number | null; agents: number | null }>({ devices: null, agents: null });
  useEffect(() => {
    let current = true;
    const enabled = (product: Product) => canOpenProduct(workspace?.subscriptions.find((s) => s.product === product));
    Promise.allSettled([
      enabled("secret_guard") ? apiGet<unknown[]>("v1/extensions/devices") : Promise.resolve(null),
      enabled("ai_guard") ? apiGet<{ agents: unknown[] }>("v1/agents") : Promise.resolve(null),
    ]).then(([devices, agents]) => {
      if (current) setCounts({
        devices: devices.status === "fulfilled" && Array.isArray(devices.value) ? devices.value.length : null,
        agents: agents.status === "fulfilled" && Array.isArray(agents.value?.agents) ? agents.value.agents.length : null,
      });
    });
    return () => { current = false; };
  }, [workspace]);

  return <section className="console-page workspace-overview">
    <ConsoleHeader title={tr("Votre espace xSOM", "Your xSOM workspace")} description={tr("Un même compte entreprise. Un suivi adapté à chaque usage de l’IA.", "One organization account. Dedicated oversight for each AI use case.")} />
    {error != null && <div className="workspace-notice" role="alert"><div><strong>{tr("Les accès de l’entreprise sont indisponibles", "Organization access is unavailable")}</strong><p>{tr("Réessayez pour retrouver vos produits et leurs abonnements.", "Try again to retrieve your products and subscriptions.")}</p></div><button className="btn btn-ghost" onClick={reload}>{tr("Réessayer", "Retry")}</button></div>}
    {loading ? <ConsoleSkeleton rows={3} /> : <div className="workspace-products-grid">
      {(["secret_guard", "ai_guard"] as const).map((product) => {
        const secret = product === "secret_guard";
        const info = PRODUCTS[product];
        const subscription = workspace?.subscriptions.find((s) => s.product === product);
        const available = canOpenProduct(subscription);
        const count = secret ? counts.devices : counts.agents;
        return <article className="workspace-product-card" data-product={product} key={product}>
          <div className="workspace-product-card-top"><span className="workspace-product-mark"><ConsoleIcon name={product} /></span><strong>{info.name}</strong><span className="workspace-access-badge" data-active={available}>{!available && <ConsoleIcon name="lock" />}{accessLabel(subscription?.status, lang)}</span></div>
          <h2>{info[lang]}</h2>
          <p>{secret ? tr("Accompagnez les développeurs qui travaillent avec des assistants IA, depuis leur poste jusqu’aux règles de l’équipe.", "Support developers working with AI assistants, from their workstation to team policies.") : tr("Supervisez les actions de vos agents en production et gardez la main sur les décisions qui engagent votre entreprise.", "Oversee your production agents and stay in control of decisions that affect your organization.")}</p>
          <div className="workspace-product-scope"><span>{secret ? tr("Développeurs", "Developers") : tr("Équipes métier", "Business teams")}</span><span aria-hidden="true">/</span><span>{secret ? tr("Responsables techniques", "Engineering leads") : tr("Opérations & conformité", "Operations & compliance")}</span></div>
          <div className="workspace-product-measure"><ConsoleIcon name={secret ? "device" : "ai_guard"} /><div><strong>{available && !identity.preview ? count ?? "—" : "—"}</strong><span>{secret ? tr("postes enregistrés", "registered workstations") : tr("agents enregistrés", "registered agents")}</span></div><small>{identity.preview ? tr("Inventaire réel non connecté", "Live inventory not connected") : !available ? tr("Accès requis", "Access required") : count === null ? tr("Inventaire indisponible", "Inventory unavailable") : count === 0 ? tr("Prêt pour le premier raccordement", "Ready for your first connection") : tr("Inventaire de l’entreprise", "Organization inventory")}</small></div>
          <ul className="workspace-feature-list">
            {(secret ? [tr("Postes et état des protections", "Workstations and protection status"), tr("Événements et décisions locales", "Local events and decisions"), tr("Politiques et approbations d’équipe", "Team policies and approvals")] : [tr("Agents et outils connectés", "Connected agents and tools"), tr("Actions et validations humaines", "Actions and human approvals"), tr("Audit, risques et coûts d’usage", "Audit, risk and usage costs")]).map((text) => <li key={text}><ConsoleIcon name="check" />{text}</li>)}
          </ul>
          <Link className="workspace-product-open" href={available ? info.href : `/subscriptions#${product}`}><span>{available ? `${tr("Ouvrir", "Open")} ${info.name}` : tr("Consulter l’accès", "View access")}</span><ConsoleIcon name={available ? "arrow" : "lock"} /></Link>
        </article>;
      })}
    </div>}
    <section className="workspace-company-strip" aria-label={tr("Compte entreprise", "Organization account")}>
      <div className="workspace-company-heading"><span className="workspace-avatar">{workspace?.organization.name.slice(0, 1) ?? "—"}</span><div><h2>{workspace?.organization.name ?? tr("Votre entreprise", "Your organization")}</h2><p>{workspace?.subscriptions.some((s) => s.status === "internal") ? tr("Nous utilisons nos produits au quotidien. Dogfooding.", "We use our products every day. Dogfooding.") : tr("Les accès aux produits sont gérés pour cette entreprise.", "Product access is managed for this organization.")}</p></div></div>
      <Link href="/subscriptions">{tr("Gérer mes abonnements", "Manage my subscriptions")}<ConsoleIcon name="arrow" /></Link>
    </section>
    <div className="workspace-overview-foot"><span>{tr("Compte", "Account")} <strong>{identity.email ?? "—"}</strong></span><span><ConsoleIcon name="lock" />{tr("Les journaux restent propres à chaque produit.", "Each product keeps its own activity log.")}</span></div>
  </section>;
}
