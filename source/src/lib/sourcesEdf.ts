// Types de sources EDF pour le contrôle des appareils de RP
// (Procédure nationale de prévention D2000 PNP 00100 — réf. technique METRO 00, indice 01,
// tableau n°1 « caractéristiques des sources »). S14 d'après les constats Bertin (ESAL20 90Sr).
export interface TypeSourceEdf {
  id: string;                 // S01 … S15 (S09bis)
  rn: string[];               // radionucléide(s) — format de l'appli (Co-60…)
  ray: "Alpha" | "Bêta" | "Gamma" | null;
  min: number | null;         // activité en Bq : min < A < max
  max: number | null;
  vieAns: number | null;      // durée de vie max théorique
  diamActif: number | null;   // mm (null = « ≤ 12 mm » ou spécifique)
  geometrie: string;
  tolerance?: string;
}
const PONCT = "Ø 38 mm, Ø actif ≤ 12 mm (de préférence ≤ 10 mm), activité dans la cavité d'un support plastique rigide et étanche, épaisseur 10 mm";
const PLANE = "Ø 50 mm, Ø actif 44 mm, dépôt sur feuille d'aluminium ≈ 0,3 mm, support inox 2 mm (± 1 mm), rendement ≈ 0,5 (0,45 à 0,53)";
export const TYPES_SOURCES_EDF: TypeSourceEdf[] = [
  { id: "S01", rn: ["Co-60"], ray: "Gamma", min: 50e3, max: 150e3, vieAns: 8, diamActif: null, geometrie: PONCT, tolerance: "Amax ± 20 %, connue à mieux que 15 % (2σ)" },
  { id: "S02", rn: ["Co-60"], ray: "Gamma", min: 10e3, max: 30e3, vieAns: 8, diamActif: null, geometrie: PONCT, tolerance: "Amax ± 20 %, connue à mieux que 15 % (2σ)" },
  { id: "S03", rn: ["Co-60"], ray: "Bêta", min: 1e3, max: 4e3, vieAns: 10, diamActif: 44, geometrie: PLANE, tolerance: "Amax ± 30 %, connue à mieux que 15 % (2σ)" },
  { id: "S04", rn: ["Co-60"], ray: "Bêta", min: 2e3, max: 8e3, vieAns: 10, diamActif: 44, geometrie: PLANE, tolerance: "Amax ± 30 %, connue à mieux que 15 % (2σ)" },
  { id: "S05", rn: ["Co-60"], ray: "Gamma", min: 3e3, max: 6e3, vieAns: 5, diamActif: null, geometrie: PONCT, tolerance: "Amax ± 20 %, connue à mieux que 15 % (2σ)" },
  { id: "S06", rn: ["Co-60"], ray: "Gamma", min: 0.5e6, max: 1.5e6, vieAns: 8, diamActif: null, geometrie: PONCT, tolerance: "Amax ± 20 %, connue à mieux que 15 % (2σ)" },
  { id: "S07", rn: ["Co-60"], ray: "Gamma", min: 1e3, max: 4e3, vieAns: 10, diamActif: null, geometrie: PONCT, tolerance: "Amax ± 20 %, connue à mieux que 15 % (2σ)" },
  { id: "S08", rn: ["Pu-239", "Cs-137"], ray: null, min: null, max: null, vieAns: null, diamActif: null, geometrie: "Spécifique type SC31 (MIRION)" },
  { id: "S09", rn: ["Cs-137"], ray: "Gamma", min: null, max: 0.37e6, vieAns: null, diamActif: null, geometrie: "Spécifique, réf. CDRB10750 Nuclitec, spécifications MIRION 72291" },
  { id: "S09bis", rn: ["Cs-137"], ray: "Gamma", min: null, max: 3.7e6, vieAns: null, diamActif: null, geometrie: "Spécifique, réf. CDRB10750 Nuclitec, spécifications MIRION 72290 (en cas d'achat ou de remplacement, prendre S09)" },
  { id: "S10", rn: ["Ba-133"], ray: "Gamma", min: 2e3, max: 500e3, vieAns: null, diamActif: null, geometrie: "Spécifique" },
  { id: "S11", rn: ["Am-241"], ray: "Alpha", min: null, max: 450, vieAns: null, diamActif: 44, geometrie: PLANE, tolerance: "Amax ± 30 %, connue à mieux que 15 % (2σ)" },
  { id: "S12", rn: ["Cs-137"], ray: "Gamma", min: 300e6, max: 500e6, vieAns: 22, diamActif: null, geometrie: "Spécifique" },
  { id: "S13", rn: ["Co-60"], ray: "Gamma", min: null, max: 95e3, vieAns: null, diamActif: null, geometrie: "Géométrie compatible avec le dispositif de contrôle de bon fonctionnement des radiamètres" },
  { id: "S14", rn: ["Sr-90"], ray: "Bêta", min: 2e3, max: 8e3, vieAns: null, diamActif: 44, geometrie: "Type ESAL20 ou équivalent (d'après les constats NT170 / NT200)", tolerance: "± 20 %" },
  { id: "S15", rn: [], ray: null, min: null, max: null, vieAns: null, diamActif: null, geometrie: "Non décrit dans la procédure (tableau n°1)" },
];

// « S3 », « s 03 », « S9 bis » → « S03 », « S09bis »
export function normTypeS(v: unknown): string {
  const m = String(v ?? "").trim().match(/^s\s*0*(\d{1,2})\s*(bis)?$/i);
  return m ? `S${m[1].padStart(2, "0")}${m[2] ? "bis" : ""}` : String(v ?? "").trim();
}
export const typeSourceEdf = (v: unknown) => TYPES_SOURCES_EDF.find((t) => t.id === normTypeS(v)) ?? null;

const fmtA = (bq: number) =>
  bq >= 1e6 ? `${(bq / 1e6).toLocaleString("fr-FR")} MBq` : bq >= 1e3 ? `${(bq / 1e3).toLocaleString("fr-FR")} kBq` : `${bq.toLocaleString("fr-FR")} Bq`;
export function plageTexte(t: TypeSourceEdf): string {
  if (t.min != null && t.max != null) return `${fmtA(t.min)} < A < ${fmtA(t.max)}`;
  if (t.max != null) return `A < ${fmtA(t.max)}`;
  if (t.min != null) return `A > ${fmtA(t.min)}`;
  return "non spécifiée";
}
export function libelleType(t: TypeSourceEdf): string {
  return `${t.id === "S09bis" ? "S09 bis" : t.id} — ${t.rn.join(" / ") || "?"}${t.ray ? " " + ({ Alpha: "α", "Bêta": "β", Gamma: "γ" }[t.ray]) : ""} · ${plageTexte(t)}`;
}
