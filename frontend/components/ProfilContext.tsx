"use client";

/**
 * Les profils cochés, partagés par les sections qui en dépendent (`L7`).
 *
 * Le relevé (`L5`) et « Pour qui » (`L7`) répondent à deux questions différentes à
 * partir du **même** choix : ce qui vous concerne aujourd'hui, et ce qui le deviendrait.
 * Deux sélecteurs sur une page poseraient au visiteur une question à laquelle il a déjà
 * répondu, et le laisseraient devant deux réponses possiblement divergentes.
 *
 * L'appel au moteur vit ici, une fois : c'est aussi ce qui garantit que les deux
 * sections lisent les mêmes comptes. Les recalculer de leur côté donnerait deux
 * moteurs, ce que ce chantier refuse depuis `L3`.
 */

import { createContext, useCallback, useContext, useEffect, useState } from "react";

import type { StrKey } from "@/lib/i18n";
import { fetchReleveProfil, type ReleveProfil } from "@/lib/threats";

//: Les six profils, dans l'ordre de la chaîne de valeur. Les libellés réutilisent
//: les clés du diagnostic public : deux libellés pour le même profil finiraient par
//: diverger. Partagés ici plutôt que dupliqués dans les deux sections qui les
//: affichent, pour la même raison.
export const PROFILS: { id: string; label: StrKey; hint: StrKey }[] = [
  { id: "P1a", label: "triage.p1a", hint: "triage.p1a.hint" },
  { id: "P1b", label: "triage.p1b", hint: "triage.p1b.hint" },
  { id: "P2", label: "triage.p2", hint: "triage.p2.hint" },
  { id: "P3", label: "triage.p3", hint: "triage.p3.hint" },
  { id: "P4", label: "triage.p4", hint: "triage.p4.hint" },
  { id: "P5", label: "triage.p5", hint: "triage.p5.hint" },
];

interface Etat {
  choisis: string[];
  basculer: (id: string) => void;
  positionne: ReleveProfil | undefined;
  occupe: boolean;
  echoue: boolean;
}

const Contexte = createContext<Etat>({
  choisis: [],
  basculer: () => {},
  positionne: undefined,
  occupe: false,
  echoue: false,
});

export function ProfilProvider({ children }: { children: React.ReactNode }) {
  const [choisis, setChoisis] = useState<string[]>([]);
  const [positionne, setPositionne] = useState<ReleveProfil | undefined>();
  const [occupe, setOccupe] = useState(false);
  const [echoue, setEchoue] = useState(false);

  const basculer = useCallback((id: string) => {
    setChoisis((actuels) =>
      actuels.includes(id) ? actuels.filter((p) => p !== id) : [...actuels, id],
    );
  }, []);

  useEffect(() => {
    if (choisis.length === 0) {
      setPositionne(undefined);
      setEchoue(false);
      return;
    }
    let annule = false;
    setOccupe(true);
    setEchoue(false);
    fetchReleveProfil(choisis)
      .then((r) => {
        if (!annule) setPositionne(r);
      })
      .catch(() => {
        // Fail-soft à l'affichage, jamais fail-open sur la revendication : on retire
        // le positionnement plutôt que d'en garder un périmé, et on le dit.
        if (!annule) {
          setPositionne(undefined);
          setEchoue(true);
        }
      })
      .finally(() => {
        if (!annule) setOccupe(false);
      });
    return () => {
      annule = true;
    };
  }, [choisis]);

  return (
    <Contexte.Provider value={{ choisis, basculer, positionne, occupe, echoue }}>
      {children}
    </Contexte.Provider>
  );
}

export function useProfils(): Etat {
  return useContext(Contexte);
}
