import type { Metadata } from "next";
import { LegalPage, legalTitle } from "@/components/LegalPage";
export const metadata: Metadata = { title: legalTitle("conditions-utilisation") };
export default function Page() { return <LegalPage document="conditions-utilisation" />; }
