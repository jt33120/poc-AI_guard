import type { Metadata } from "next";
import { LegalPage, legalTitle } from "@/components/LegalPage";
export const metadata: Metadata = { title: legalTitle("confidentialite"), robots: { index: false, follow: true } };
export default function Page() { return <LegalPage document="confidentialite" />; }
