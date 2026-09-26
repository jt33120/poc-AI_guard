import type { Metadata } from "next";

import { SecretGuardPage } from "@/components/secret-guard/SecretGuardPage";
import { SECRET_GUARD_COPY } from "@/components/secret-guard/secret-guard-copy";
import { getLang } from "@/lib/lang";
import { latestSecretGuardRelease } from "@/lib/secret-guard-release";
import "../guard-landing.css";
import "../guard-home.css";
import "../home.css";
import "../secret-guard.css";

export async function generateMetadata(): Promise<Metadata> {
  const copy = SECRET_GUARD_COPY[await getLang()].meta;
  return { title: copy.title, description: copy.description };
}

export default async function SecretGuardRoute() {
  return <SecretGuardPage release={await latestSecretGuardRelease()} />;
}
