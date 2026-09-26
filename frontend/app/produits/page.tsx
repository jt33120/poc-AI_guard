import type { Metadata } from "next";

import { GUARD_HOME_COPY } from "@/components/guard-home-copy";
import { ProductsOffer } from "@/components/ProductsOffer";
import { getLang } from "@/lib/lang";
import "../guard-landing.css";
import "../guard-home.css";
import "../home.css";
import "../products.css";

export async function generateMetadata(): Promise<Metadata> {
  const copy = GUARD_HOME_COPY[await getLang()];
  return { title: copy.productsMeta, description: copy.productsDescription };
}

export default function ProductsPage() {
  return <ProductsOffer />;
}
