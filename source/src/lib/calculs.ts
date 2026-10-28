// Module Calcul : stockage (partagé ou perso) + évaluation des formules.
// S'appuie sur lib/formula (moteur d'expressions) et lib/decay (activité/flux du jour).
import { db } from "./db";
import { currentUserId, localSoftDelete, localUpsert, syncAll } from "./sync";
import { compile, dateToDays } from "./formula";
import { activiteFromValeurs, halfLifeDays } from "./decay";
import { radionucleideOf, rayonnementOf, typeOf } from "./etalonFields";
import type { Calcul, Etalon, EtalonModele, Formule, SourceFiltres, TolBound } from "./types";

export async function allCalculs(): Promise<Calcul[]> {
  const rows = await db.calculs.toArray();
  return rows.filter((r) => !r.deleted).sort((a, b) => a.nom.localeCompare(b.nom, "fr"));
}
export async function getCalcul(id: string): Promise<Calcul | undefined> {
  const r = await db.calculs.get(id);
  return r && !r.deleted ? r : undefined;
}
export async function saveCalcul(c: Calcul): Promise<void> {
  const uid = await currentUserId();
  await localUpsert(db.calculs, { ...c, user_id: c.user_id ?? uid });
  syncAll().catch(() => {});
}
export async function deleteCalcul(id: string): Promise<void> {
  await localSoftDelete(db.calculs, id);
  syncAll().catch(() => {});
}

// --- composantes de source --------------------------------------------------
export interface SourceFieldOpt { key: string; label: string }

// Champs sélectionnables pour une composante « source » (calculés + champs bruts du modèle).
export function sourceFieldOptions(model: EtalonModele | undefined): SourceFieldOpt[] {
  if (!model) return [];
  const opts: SourceFieldOpt[] = [{ key: "@act_jour", label: "Activité du jour" }];
  for (const c of model.champs) if (c.type === "flux") opts.push({ key: "@flux:" + c.libelle, label: "Flux du jour — " + c.libelle });
  opts.push({ key: "@frac", label: "Décroissance (fraction)" });
  opts.push({ key: "@periode", label: "Période (jours)" });
  for (const c of model.champs) opts.push({ key: c.libelle, label: c.libelle });
  return opts;
}

const isDateType = (t: string) => t === "date" || t === "date_ref";

// Valeur numérique d'une composante source pour une source donnée (dates → jours).
export function resolveSourceField(
  source: Etalon, model: EtalonModele | undefined, key: string, at: Date = new Date()
): number | null {
  if (!model || !key) return null;
  if (key.startsWith("@")) {
    const dec = activiteFromValeurs(model.champs, source.valeurs, at);
    if (key === "@act_jour") return dec?.act ?? null;
    if (key === "@frac") return dec?.frac ?? null;
    if (key === "@periode") {
      const fRn = model.champs.find((c) => c.type === "radionucleide");
      return halfLifeDays(fRn ? String(source.valeurs[fRn.cle] ?? "") : "");
    }
    if (key.startsWith("@flux:")) {
      const label = key.slice(6);
      return dec?.fluxes.find((x) => x.label === label)?.value ?? null;
    }
    return null;
  }
  const champ = model.champs.find((c) => c.libelle === key);
  if (!champ) return null;
  const v = source.valeurs[champ.cle];
  if (v == null || v === "") return null;
  if (isDateType(champ.type)) return dateToDays(String(v));
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}

// --- évaluation --------------------------------------------------------------
export interface ToleranceVerdict { min: number | null; max: number | null; pass: boolean | null; error: string | null }
export interface FormuleResult { formule: Formule; value: number | null; error: string | null; tolerance: ToleranceVerdict | null }
export interface ComputeOutput { scope: Record<string, number>; results: FormuleResult[]; missing: string[] }

// Évalue toutes les formules d'un calcul (en ordre, résultats réutilisables).
export function computeCalcul(
  calcul: Calcul,
  sources: Record<string, Etalon | null>,
  modeles: EtalonModele[],
  varValues: Record<string, string>,
  series: Record<string, string[]> = {},
  at: Date = new Date()
): ComputeOutput {
  const modById = new Map(modeles.map((m) => [m.id, m]));
  const scope: Record<string, number> = {};
  const missing: string[] = [];
  for (const comp of calcul.composantes) {
    if (comp.type === "source") {
      const et = sources[comp.id] ?? null;
      const m = et?.modele_id ? modById.get(et.modele_id) : undefined;
      const vals = (comp.source_valeurs && comp.source_valeurs.length)
        ? comp.source_valeurs
        : (comp.source_champ ? [{ nom: comp.nom, source_champ: comp.source_champ }] : []);
      for (const v of vals) {
        if (!v.nom) continue;
        const x = et ? resolveSourceField(et, m, v.source_champ ?? "", at) : null;
        if (x != null && Number.isFinite(x)) scope[v.nom] = x;
        else missing.push(v.nom);
      }
      continue;
    }
    if (comp.type === "serie") {
      if (!comp.nom) continue;
      const arr = (series[comp.id] ?? []).filter((x) => String(x).trim() !== "").map(Number).filter((x) => Number.isFinite(x));
      if (!arr.length) { missing.push(comp.nom); continue; }
      const n = arr.length;
      const mean = arr.reduce((a, b) => a + b, 0) / n;
      const variance = n > 1 ? arr.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1) : 0;
      scope[comp.nom] = mean;
      scope[`${comp.nom}_max`] = Math.max(...arr);
      scope[`${comp.nom}_min`] = Math.min(...arr);
      scope[`${comp.nom}_n`] = n;
      scope[`${comp.nom}_et`] = Math.sqrt(variance);
      continue;
    }
    if (comp.type !== "variable" && comp.type !== "constante" && comp.type !== "mesure") continue;
    let val: number | null = null;
    if (comp.type === "constante") {
      val = comp.valeur_type === "date"
        ? (comp.valeur_date ? dateToDays(comp.valeur_date) : null)
        : (comp.valeur ?? null);
    } else {
      // variable & mesure : saisie au calcul (la mesure est déjà convertie vers l'unité de base)
      const raw = varValues[comp.nom];
      if (raw != null && raw !== "") val = comp.valeur_type === "date" ? dateToDays(raw) : Number(raw);
    }
    if (val != null && Number.isFinite(val)) scope[comp.nom] = val;
    else missing.push(comp.nom);
  }
  const results: FormuleResult[] = [];
  for (const f of calcul.formules) {
    let value: number | null = null;
    let error: string | null = null;
    try {
      value = compile(f.expression)(scope);
      scope[f.nom] = value;
    } catch (e) {
      error = (e as Error).message;
    }
    let tolerance: ToleranceVerdict | null = null;
    if (f.tol_min || f.tol_max) {
      const boundValue = (b: TolBound): number | null => {
        const base = b.base === "source"
          ? (b.source ? (scope[b.source] ?? null) : null)
          : b.base === "variable"
            ? (b.variable ? (scope[b.variable] ?? null) : null)
            : (b.valeur ?? null);
        const pct = b.pourcentage == null ? 100 : b.pourcentage;
        return base == null || !Number.isFinite(base) ? null : base * (pct / 100);
      };
      const min = f.tol_min ? boundValue(f.tol_min) : null;
      const max = f.tol_max ? boundValue(f.tol_max) : null;
      let pass: boolean | null = null;
      let terr: string | null = null;
      if (value == null || error) terr = "résultat indisponible";
      else if (f.tol_min && min == null) terr = "seuil min indisponible";
      else if (f.tol_max && max == null) terr = "seuil max indisponible";
      else pass = (min == null || value >= min) && (max == null || value <= max);
      tolerance = { min, max, pass, error: terr };
    }
    results.push({ formule: f, value, error, tolerance });
  }
  return { scope, results, missing };
}

// --- sélection des sources par catégorie (radionucléide / type) -------------
// Sources ECME correspondant aux filtres du calcul (OU au sein d'une dimension,
// ET entre dimensions). Aucun filtre → aucune source (calcul "hors base").
export function matchingSources(filtres: SourceFiltres | undefined, etalons: Etalon[], modeles: EtalonModele[]): Etalon[] {
  const f = filtres ?? { radionucleides: [], types: [], rayonnements: [] };
  const rns = f.radionucleides ?? [];
  const tys = f.types ?? [];
  const rays = f.rayonnements ?? [];
  if (rns.length === 0 && tys.length === 0 && rays.length === 0) return [];
  const byId = new Map(modeles.map((m) => [m.id, m]));
  return etalons.filter((e) => !e.deleted).filter((e) => {
    const m = e.modele_id ? byId.get(e.modele_id) : undefined;
    if (rns.length && !rns.includes(radionucleideOf(e, m))) return false;
    if (tys.length && !tys.includes(typeOf(e, m))) return false;
    if (rays.length && !rays.includes(rayonnementOf(e, m))) return false;
    return true;
  });
}

// Valeurs distinctes pour peupler les filtres de catégorie.
export function distinctCategories(etalons: Etalon[], modeles: EtalonModele[]): { radionucleides: string[]; types: string[]; rayonnements: string[] } {
  const byId = new Map(modeles.map((m) => [m.id, m]));
  const rns = new Set<string>();
  const tys = new Set<string>();
  const rays = new Set<string>();
  for (const e of etalons) {
    if (e.deleted) continue;
    const m = e.modele_id ? byId.get(e.modele_id) : undefined;
    const rn = radionucleideOf(e, m); if (rn) rns.add(rn);
    const t = typeOf(e, m); if (t) tys.add(t);
    const r = rayonnementOf(e, m); if (r) rays.add(r);
  }
  return {
    radionucleides: [...rns].sort((a, b) => a.localeCompare(b, "fr")),
    types: [...tys].sort((a, b) => a.localeCompare(b, "fr")),
    rayonnements: [...rays].sort((a, b) => a.localeCompare(b, "fr")),
  };
}
