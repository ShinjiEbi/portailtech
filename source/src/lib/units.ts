// Familles d'unités pour la composante "mesure" : la valeur saisie est convertie
// vers l'unité de base de la famille (facteur 1).
export interface UnitDef { label: string; factor: number }
export interface UnitFamily { key: string; label: string; base: string; units: UnitDef[] }

export const UNIT_FAMILIES: UnitFamily[] = [
  { key: "activite", label: "Activité", base: "Bq", units: [{ label: "Bq", factor: 1 }, { label: "kBq", factor: 1e3 }, { label: "MBq", factor: 1e6 }, { label: "GBq", factor: 1e9 }] },
  { key: "debit", label: "Débit dose", base: "µSv/h", units: [{ label: "nSv/h", factor: 1e-3 }, { label: "µSv/h", factor: 1 }, { label: "mSv/h", factor: 1e3 }] },
  { key: "dose", label: "Dose", base: "µSv", units: [{ label: "nSv", factor: 1e-3 }, { label: "µSv", factor: 1 }, { label: "mSv", factor: 1e3 }, { label: "Sv", factor: 1e6 }] },
  { key: "temps", label: "Temps", base: "s", units: [{ label: "s", factor: 1 }, { label: "min", factor: 60 }, { label: "h", factor: 3600 }] },
  { key: "longueur", label: "Longueur", base: "mm", units: [{ label: "mm", factor: 1 }, { label: "cm", factor: 10 }, { label: "m", factor: 1000 }] },
  { key: "surface", label: "Surface", base: "cm²", units: [{ label: "mm²", factor: 0.01 }, { label: "cm²", factor: 1 }, { label: "m²", factor: 1e4 }] },
  { key: "masse", label: "Masse", base: "g", units: [{ label: "mg", factor: 1e-3 }, { label: "g", factor: 1 }, { label: "kg", factor: 1e3 }] },
];

export const familyByKey = (k?: string | null): UnitFamily | undefined => UNIT_FAMILIES.find((f) => f.key === k);
export function unitFactor(family: UnitFamily | undefined, label: string | undefined): number {
  if (!family) return 1;
  return family.units.find((u) => u.label === label)?.factor ?? 1;
}
export const baseUnitLabel = (family: UnitFamily | undefined): string =>
  family ? (family.units.find((u) => u.factor === 1)?.label ?? family.base) : "";
