import type { Metadata } from "next";

import { FleetPage } from "@/components/fleet/FleetPage";
import { FLEET_COPY } from "@/components/fleet/fleet-copy";
import { getLang } from "@/lib/lang";
import "../guard-landing.css";
import "../guard-home.css";
import "../home.css";
import "../secret-guard.css";
import "../fleet.css";

export async function generateMetadata(): Promise<Metadata> {
  const copy = FLEET_COPY[await getLang()].meta;
  return { title: copy.title, description: copy.description };
}

export default function FleetRoute() {
  return <FleetPage />;
}
