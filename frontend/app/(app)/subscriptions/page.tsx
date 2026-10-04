"use client";

import Link from "next/link";
import { ConsoleHeader, ConsoleSkeleton } from "@/components/ConsoleUI";
import { ConsoleIcon } from "@/components/ConsoleIcon";
import { useWorkspace } from "@/components/WorkspaceProvider";
import { useT } from "@/lib/i18n";
import { accessLabel, canOpenProduct, PRODUCTS } from "@/lib/workspace";

export default function SubscriptionsPage() {
  const { lang } = useT();
  const tr = (fr: string, en: string) => lang === "fr" ? fr : en;
  const { workspace, loading, error, reload, identity } = useWorkspace();
  return <section className="console-page workspace-subscriptions">
    <ConsoleHeader title={tr("Mes abonnements", "My subscriptions")} description={tr("Les produits et les accès de votre entreprise, au même endroit.", "Your organization’s products and access, in one place.")} />
    <div className="workspace-subscription-context"><ConsoleIcon name="team" /><strong>{workspace?.organization.name ?? tr("Votre entreprise", "Your organization")}</strong><span>{identity.email}</span></div>
    {error != null && <div className="workspace-notice" role="alert"><div><strong>{tr("Impossible de charger vos abonnements", "Could not load your subscriptions")}</strong><p>{tr("Aucun statut de paiement ne peut être confirmé pour le moment.", "No payment status can be confirmed right now.")}</p></div><button className="btn btn-ghost" onClick={reload}>{tr("Réessayer", "Retry")}</button></div>}
    {loading ? <ConsoleSkeleton rows={3} /> : <div className="workspace-products-grid">
      {(["secret_guard", "ai_guard"] as const).map((product) => {
        const info = PRODUCTS[product];
        const subscription = workspace?.subscriptions.find((s) => s.product === product);
        const available = canOpenProduct(subscription);
        const internal = subscription?.status === "internal";
        return <article id={product} className="workspace-subscription-card" data-product={product} key={product}>
          <div className="workspace-product-card-top"><span className="workspace-product-mark"><ConsoleIcon name={product} /></span><div><h2>{info.name}</h2><p>{info[lang]}</p></div></div>
          <span className="workspace-access-badge" data-active={available}>{!available && <ConsoleIcon name="lock" />}{accessLabel(subscription?.status, lang)}</span>
          <dl className="workspace-subscription-facts">
            <div><dt>{tr("Édition", "Edition")}</dt><dd>{subscription?.edition ?? tr("Non définie", "Not set")}</dd></div>
            <div><dt>{tr("Type d’accès", "Access type")}</dt><dd>{internal ? "Dogfooding" : subscription?.status === "trial" ? tr("Découverte", "Trial") : subscription?.status === "active" ? tr("Abonnement", "Subscription") : tr("Aucun accès actif confirmé", "No active access confirmed")}</dd></div>
            {subscription?.seats && <div><dt>{tr("Postes inclus", "Included seats")}</dt><dd>{subscription.seats}</dd></div>}
            <div><dt>{tr("Fin de validité", "Valid until")}</dt><dd>{subscription?.ends_at ? new Intl.DateTimeFormat(lang, { dateStyle: "long" }).format(new Date(subscription.ends_at)) : internal ? tr("Aucune échéance définie", "No end date set") : tr("Non renseignée", "Not provided")}</dd></div>
          </dl>
          <p className="workspace-subscription-note">{internal ? tr("Accès interne pour utiliser et éprouver le produit dans votre entreprise. Aucun abonnement payant n’est présenté ici.", "Internal access to use and test the product in your organization. This is not shown as a paid subscription.") : available ? tr("Cet accès ouvre l’espace du produit aux membres autorisés de votre entreprise.", "This access opens the product workspace to authorized members of your organization.") : tr("Ce produit reste visible dans votre menu. Un accès actif est nécessaire pour ouvrir ses pages.", "This product stays visible in your menu. Active access is required to open its pages.")}</p>
          <Link className={available ? "btn btn-primary" : "btn btn-ghost"} href={available ? info.href : product === "secret_guard" ? "/secret-guard" : "/produits"}>{available ? `${tr("Ouvrir", "Open")} ${info.name}` : tr("Découvrir les offres", "Explore plans")}<ConsoleIcon name={available ? "arrow" : "lock"} /></Link>
        </article>;
      })}
    </div>}
    <section className="workspace-free-plan"><span className="workspace-product-mark" data-product="secret_guard"><ConsoleIcon name="secret_guard" /></span><div><h2>Secret Guard Local</h2><p>{tr("La protection locale des secrets est gratuite. Elle continue de fonctionner sans abonnement à la console d’équipe.", "Local secret protection is free. It keeps working without a team console subscription.")}</p></div><Link href="/secret-guard">{tr("Voir l’extension", "View extension")}<ConsoleIcon name="arrow" /></Link></section>
    <div className="workspace-billing-note"><ConsoleIcon name="subscriptions" /><div><h2>{tr("Facturation", "Billing")}</h2><p>{tr("Les montants, factures et moyens de paiement ne sont pas encore reliés à cette console. Pour les conditions de votre abonnement, référez-vous au contrat de votre entreprise.", "Amounts, invoices and payment methods are not yet connected to this console. Refer to your organization’s contract for subscription terms.")}</p></div></div>
  </section>;
}
