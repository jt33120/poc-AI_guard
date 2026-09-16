import type { Metadata } from "next";

import { GUARD_HOME_COPY } from "@/components/guard-home-copy";
import { ProductsOffer } from "@/components/ProductsOffer";
import { getLang } from "@/lib/lang";
import "../guard-landing.css";
import "../guard-home.css";

export function generateMetadata(): Metadata {
  const copy = GUARD_HOME_COPY[getLang()];
  return { title: copy.productsMeta, description: copy.productsDescription };
}

export default function ProductsPage() {
  return <ProductsOffer />;
}
