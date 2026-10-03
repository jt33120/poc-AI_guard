"use client";

import Link from "next/link";

export function ExceptionList() {
  return (
    <p className="console-note">
      Les exceptions d’action sont des approbations à usage unique et durée
      courte. <Link href="/extensions/approvals">Ouvrir la file d’approbation</Link>.
    </p>
  );
}
