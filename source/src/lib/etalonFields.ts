// Lecture des "catégories" d'une source (radionucléide, type) depuis les champs du modèle.
import type { ChampDef, Etalon, EtalonModele } from "./types";

export const TYPE_LIBS = ["Type", "Type EDF", "Type de source", "Type source", "Catégorie", "Categorie", "Classe", "Type CEFRI", "Type sonde", "Type de sonde", "Type appareil"];
export const RN_LIBS = ["Radionucléide", "Radionuclide", "Radio-nucléide", "Radio nucléide", "Isotope", "RN"];
export const RAY_LIBS = ["Rayonnement", "Type rayonnement", "Ray"];
const normLib = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();

export function valeurChampParLibelle(source: Etalon, model: EtalonModele | undefined, candidates: string[]): string {
  if (!model?.champs) return "";
  const cand = new Set(candidates.map(normLib));
  const champ = model.champs.find((c: ChampDef) => cand.has(normLib(c.libelle)));
  if (!champ) return "";
  const v = source.valeurs[champ.cle];
  return v == null ? "" : String(v);
}
export const radionucleideOf = (e: Etalon, m: EtalonModele | undefined) => valeurChampParLibelle(e, m, RN_LIBS);
const EDF_TYPE_RE = /^s\s*\d{1,2}$/; // valeurs type EDF : S1, S2, S3, ...
export function typeOf(e: Etalon, m: EtalonModele | undefined): string {
  const byLib = valeurChampParLibelle(e, m, TYPE_LIBS);
  if (byLib) return byLib;
  // repli : champ dont la valeur ressemble à un type EDF (S1/S2/S3…), quel que soit son libellé
  if (!m?.champs) return "";
  for (const c of m.champs) {
    const v = e.valeurs[c.cle];
    if (v == null) continue;
    if (EDF_TYPE_RE.test(normLib(String(v)))) return String(v).trim();
  }
  return "";
}
export const rayonnementOf = (e: Etalon, m: EtalonModele | undefined) => valeurChampParLibelle(e, m, RAY_LIBS);
