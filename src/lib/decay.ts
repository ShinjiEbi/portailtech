// Priodes radioactives des radionuclides courants en mtrologie RP.
// Valeurs exprimes EN JOURS (les annes sont converties avec 365.25 j/an).
export const HALF_LIVES_DAYS: Record<string, number> = {
  "Cs-137": 30.07 * 365.25,
  "Co-60": 5.2711 * 365.25,
  "Am-241": 432.6 * 365.25,
  "Sr-90": 28.79 * 365.25,
  "Ba-133": 10.51 * 365.25,
  "Eu-152": 13.517 * 365.25,
  "Na-22": 2.6018 * 365.25,
  "Cs-134": 2.0648 * 365.25,
  "Mn-54": 312.2,
  "Co-57": 271.74,
  "Cd-109": 461.4,
  "Zn-65": 243.93,
  "I-131": 8.0252,
  "Tc-99m": 0.2503,
};

export const RADIONUCLIDES = Object.keys(HALF_LIVES_DAYS);

export function halfLifeDays(radionuclide?: string): number | null {
  if (!radionuclide) return null;
  return HALF_LIVES_DAYS[radionuclide] ?? null;
}

// Activit du jour par dcroissance : A = A0 * exp(-ln2 * t / T)
export function currentActivity(
  a0?: number,
  dateRef?: string,
  radionuclide?: string,
  at: Date = new Date()
): number | null {
  const T = halfLifeDays(radionuclide);
  if (!T || !a0 || !dateRef) return null;
  const ref = new Date(dateRef).getTime();
  if (Number.isNaN(ref)) return null;
  const dtDays = (at.getTime() - ref) / 86_400_000;
  return a0 * Math.exp((-Math.LN2 * dtDays) / T);
}

// Fraction restante (0..1) par rapport  l'activit de rfrence
export function fractionRemaining(
  dateRef?: string,
  radionuclide?: string,
  at: Date = new Date()
): number | null {
  const T = halfLifeDays(radionuclide);
  if (!T || !dateRef) return null;
  const ref = new Date(dateRef).getTime();
  if (Number.isNaN(ref)) return null;
  const dtDays = (at.getTime() - ref) / 86_400_000;
  return Math.exp((-Math.LN2 * dtDays) / T);
}

// Mise en forme Bq -> kBq/MBq/GBq
export function formatActivity(bq?: number | null): string {
  if (bq == null || !Number.isFinite(bq)) return "";
  const abs = Math.abs(bq);
  if (abs >= 1e9) return (bq / 1e9).toFixed(2) + " GBq";
  if (abs >= 1e6) return (bq / 1e6).toFixed(2) + " MBq";
  if (abs >= 1e3) return (bq / 1e3).toFixed(2) + " kBq";
  return bq.toFixed(0) + " Bq";
}
