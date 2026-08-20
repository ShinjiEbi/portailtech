import type { ChampDef } from "./types";

// Périodes radioactives — valeurs tirées du guide LNHB « Mini table des
// radionucléides 2015 », reprises telles quelles du fichier EDF Saint-Alban
// (DTS-000-DI012). On stocke la période en années (affichage) ET en jours
// (calcul de décroissance), pour coller au centième près à l'outil EDF.
export interface Periode {
  annees: number;
  jours: number;
}

export const PERIODES: Record<string, Periode> = {
  "Am-241": { annees: 432.6, jours: 158004 },
  "Ba-133": { annees: 10.54, jours: 3850 },
  "C-14": { annees: 5700, jours: 2081881 },
  "Cd-109": { annees: 1.2626, jours: 461.14 },
  "Cl-36": { annees: 302000, jours: 110303144 },
  "Cm-244": { annees: 18.11, jours: 6615 },
  "Co-57": { annees: 0.7442, jours: 271.8 },
  "Co-60": { annees: 5.2711, jours: 1925 },
  "Cs-137": { annees: 30.05, jours: 10976 },
  "Eu-152": { annees: 13.522, jours: 4939 },
  "Fe-55": { annees: 2.747, jours: 1003 },
  "Na-22": { annees: 2.6029, jours: 951 },
  "Ni-63": { annees: 98.7, jours: 36049 },
  "Pm-147": { annees: 2.6234, jours: 958 },
  "Pu-238": { annees: 87.74, jours: 32046 },
  "Pu-239": { annees: 24100, jours: 8802337 },
  "Sr-89": { annees: 0.1385, jours: 50.57 },
  "Sr-90": { annees: 28.8, jours: 10519 },
  "Sr-90 + Y-90": { annees: 28.8, jours: 10519 },
  "Tc-99": { annees: 211500, jours: 77248725 },
  "Th-230": { annees: 75.38, jours: 27532 },
  "Tl-204": { annees: 3.788, jours: 1384 },
  "U-233": { annees: 159190, jours: 58142905 },
  "Y-88": { annees: 0.2919, jours: 106.626 },
};

export const RADIONUCLIDES = Object.keys(PERIODES);

export function periodeFor(rn?: string): Periode | null {
  if (!rn) return null;
  return PERIODES[rn] ?? null;
}
export function halfLifeDays(rn?: string): number | null {
  return periodeFor(rn)?.jours ?? null;
}

// A = A0 * exp(-ln2 * t / T) — t et T en jours, résultat dans l'unité de A0.
export function currentActivity(a0?: number, dateRef?: string, rn?: string, at: Date = new Date()): number | null {
  const T = halfLifeDays(rn);
  if (!T || !a0 || !dateRef) return null;
  const ref = new Date(dateRef).getTime();
  if (Number.isNaN(ref)) return null;
  const dt = (at.getTime() - ref) / 86_400_000;
  return a0 * Math.exp((-Math.LN2 * dt) / T);
}

export function fractionRemaining(dateRef?: string, rn?: string, at: Date = new Date()): number | null {
  const T = halfLifeDays(rn);
  if (!T || !dateRef) return null;
  const ref = new Date(dateRef).getTime();
  if (Number.isNaN(ref)) return null;
  const dt = (at.getTime() - ref) / 86_400_000;
  return Math.exp((-Math.LN2 * dt) / T);
}

// Mise en forme d'une période pour affichage (années + jours).
export function formatPeriode(p?: Periode | null): string {
  if (!p) return "";
  const a =
    p.annees >= 1000
      ? p.annees.toLocaleString("fr-FR")
      : p.annees.toLocaleString("fr-FR", { maximumFractionDigits: 4 });
  const j = Math.round(p.jours).toLocaleString("fr-FR");
  return `${a} a (${j} j)`;
}

// Activité en kBq (convention EDF pour les sources) -> kBq/MBq/GBq.
export function formatKBq(kbq?: number | null): string {
  if (kbq == null || !Number.isFinite(kbq)) return "";
  const abs = Math.abs(kbq);
  if (abs >= 1e6) return (kbq / 1e6).toFixed(3) + " GBq";
  if (abs >= 1e3) return (kbq / 1e3).toFixed(3) + " MBq";
  if (abs >= 1) return kbq.toFixed(3) + " kBq";
  return (kbq * 1000).toFixed(1) + " Bq";
}

// Ancien format en Bq (gardé au cas où un modèle utiliserait des Bq).
export function formatActivity(bq?: number | null): string {
  if (bq == null || !Number.isFinite(bq)) return "";
  const abs = Math.abs(bq);
  if (abs >= 1e9) return (bq / 1e9).toFixed(2) + " GBq";
  if (abs >= 1e6) return (bq / 1e6).toFixed(2) + " MBq";
  if (abs >= 1e3) return (bq / 1e3).toFixed(2) + " kBq";
  return bq.toFixed(0) + " Bq";
}

export interface FluxJour {
  label: string;
  value: number; // pps, décroissance appliquée
}
export interface DecayResult {
  rn: string;
  act: number | null; // activité du jour (kBq), si activité de réf. fournie
  frac: number | null; // fraction restante = facteur de décroissance
  fluxes: FluxJour[]; // flux du jour (pps), même décroissance que l'activité
  periode: Periode | null;
}

// Repère les champs par TYPE (radionucleide / activite_ref / date_ref / flux) et
// applique la décroissance à l'activité ET aux flux (même facteur, même période).
export function activiteFromValeurs(
  champs: ChampDef[] | undefined,
  valeurs: Record<string, unknown> | undefined,
  at: Date = new Date()
): DecayResult | null {
  if (!champs || !valeurs) return null;
  const fRn = champs.find((c) => c.type === "radionucleide");
  const fD = champs.find((c) => c.type === "date_ref");
  if (!fRn || !fD) return null;
  const rn = String(valeurs[fRn.cle] ?? "");
  const d = String(valeurs[fD.cle] ?? "");
  const frac = fractionRemaining(d, rn, at);
  if (!rn || !d || frac == null) return null;

  const fA = champs.find((c) => c.type === "activite_ref");
  const a0 = fA ? Number(valeurs[fA.cle]) : NaN;
  const act = fA && a0 ? a0 * frac : null;

  const fluxes: FluxJour[] = [];
  for (const c of champs) {
    if (c.type !== "flux") continue;
    const f0 = Number(valeurs[c.cle]);
    if (!f0) continue;
    fluxes.push({ label: c.libelle, value: f0 * frac });
  }

  if (act == null && fluxes.length === 0) return null;
  return { rn, act, frac, fluxes, periode: periodeFor(rn) };
}

// Activité toujours exprimée en becquerel (forme uniforme, pas de kBq/MBq).
export function formatBq(bq?: number | null): string {
  if (bq == null || !Number.isFinite(bq)) return "";
  return Math.round(bq).toLocaleString("fr-FR") + " Bq";
}
