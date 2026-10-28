// Bibliothèque RTR : IZ (codes d'accès des régimes de travail radiologique).
// Porté de PTV1 (forms/Bibliotèque RTR.html) : mêmes champs, compteur d'usage,
// filtres, import/export JSON (compatible sauvegarde PTV1) et CSV.
// Données perso : Dexie local + synchro Supabase (table rtr_iz, RLS user_id).
import { db, metaGet, metaSet } from "./db";
import { currentUserId, localSoftDelete, localUpsert, syncAll } from "./sync";
import type { RtrBarcodeFormat, RtrIz } from "./types";

export interface RtrConfig { sites: string[]; tags: string[]; }
export const RTR_DEFAULT_CONFIG: RtrConfig = {
  sites: ["Bugey", "Creys-Malville", "St Alban", "Tricastin"],
  tags: ["routine", "étalonnage", "intervention", "urgence", "arrêt de tranche", "frottis", "point chaud"],
};
const CFG_KEY = "rtr_cfg";

export async function getRtrConfig(): Promise<RtrConfig> {
  try {
    const raw = await metaGet(CFG_KEY);
    if (raw) return { ...RTR_DEFAULT_CONFIG, ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return RTR_DEFAULT_CONFIG;
}
export async function setRtrConfig(cfg: RtrConfig): Promise<void> {
  await metaSet(CFG_KEY, JSON.stringify(cfg));
}

export async function allIz(): Promise<RtrIz[]> {
  return (await db.rtr_iz.toArray()).filter((r) => !r.deleted);
}
export async function findByCode(code: string): Promise<RtrIz | undefined> {
  const c = normCode(code);
  if (!c) return undefined;
  return (await allIz()).find((r) => normCode(r.code) === c);
}

export function blankIz(code = ""): RtrIz {
  const now = new Date().toISOString();
  const p = parseIzCode(code);
  return {
    id: crypto.randomUUID(), code: code.trim(), num_iz: p.num_iz, indice: p.indice,
    code_travail: null, num_act: null, validite_debut: null, validite_fin: null,
    activite: null, intervenant: null, projet: null, objet: null,
    label: null, site: null, tranche: null, local: null,
    ded_max: null, ded_neutron: null, dose_moy: null, dose_jour: null, ded_trajet: null,
    tags: [], notes: null, barcode_format: "CODE39", use_count: 0, last_used: null,
    created_at: now, user_id: null, updated_at: now, deleted: false,
  };
}

// Code-barres des fiches individuelles RTR (EDF) : Code 39 « <N° IZ> <indice> »,
// ex. "49281716 1". On en déduit N° IZ et indice.
export function parseIzCode(raw: string): { num_iz: string | null; indice: string | null } {
  const m = raw.trim().match(/^(\d{5,})(?:[\s-]+(\d{1,3}))?$/);
  return m ? { num_iz: m[1], indice: m[2] ?? null } : { num_iz: null, indice: null };
}
// Contenu du code-barres à partir de N° IZ + indice (même format que la fiche).
export function buildIzCode(num_iz: string | null, indice: string | null): string {
  const n = (num_iz ?? "").trim(), i = (indice ?? "").trim();
  return n ? (i ? `${n} ${i}` : n) : "";
}
// Normalisation pour comparer un scan à la base (espaces ignorés).
export const normCode = (c: string) => c.replace(/\s+/g, "").toUpperCase();

export type Validite = "valide" | "bientot" | "expire" | "future" | "inconnue";
export function validiteOf(iz: Pick<RtrIz, "validite_debut" | "validite_fin">, now = new Date()): { etat: Validite; jours: number | null } {
  const today = now.toISOString().slice(0, 10);
  if (iz.validite_debut && today < iz.validite_debut) return { etat: "future", jours: null };
  if (!iz.validite_fin) return { etat: "inconnue", jours: null };
  const jours = Math.round((Date.parse(iz.validite_fin) - Date.parse(today)) / 86400000);
  if (jours < 0) return { etat: "expire", jours };
  return { etat: jours <= 30 ? "bientot" : "valide", jours };
}

export async function saveIz(iz: RtrIz): Promise<void> {
  const uid = await currentUserId();
  await localUpsert(db.rtr_iz, { ...iz, code: iz.code.trim(), user_id: iz.user_id ?? uid });
  syncAll().catch(() => {});
}
export async function deleteIz(id: string): Promise<void> {
  await localSoftDelete(db.rtr_iz, id);
  syncAll().catch(() => {});
}
export async function deleteAllIz(): Promise<number> {
  const rows = await allIz();
  for (const r of rows) await localSoftDelete(db.rtr_iz, r.id);
  syncAll().catch(() => {});
  return rows.length;
}
export async function markUsed(id: string): Promise<RtrIz | undefined> {
  const iz = await db.rtr_iz.get(id);
  if (!iz || iz.deleted) return undefined;
  const next = { ...iz, use_count: (iz.use_count || 0) + 1, last_used: new Date().toISOString() };
  await saveIz(next);
  return next;
}
export async function setBarcodeFormat(id: string, f: RtrBarcodeFormat): Promise<void> {
  const iz = await db.rtr_iz.get(id);
  if (iz && !iz.deleted) await saveIz({ ...iz, barcode_format: f });
}

// ---- export / import ------------------------------------------------------
function download(blob: Blob, name: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
const today = () => new Date().toISOString().slice(0, 10);

// Format identique à PTV1 (champs camelCase) pour rester interchangeable.
export async function exportJson(): Promise<number> {
  const rows = await allIz();
  const cfg = await getRtrConfig();
  const izs = rows.map(({ id: _i, user_id: _u, deleted: _d, ...r }) => ({
    ...r,
    // champs PTV1 (camelCase) pour rester relisible par l'ancienne page
    label: r.label ?? "", site: r.site ?? "", tranche: r.tranche ?? "", local: r.local ?? "", notes: r.notes ?? "",
    createdAt: r.created_at, lastUsed: r.last_used, useCount: r.use_count || 0,
    updatedAt: r.updated_at, barcodeFormat: r.barcode_format ?? undefined,
  }));
  const payload = { type: "iz-bertin-export", version: 1, exportedAt: new Date().toISOString(), userCfg: cfg, izs };
  download(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }), `iz_backup_${today()}.json`);
  return rows.length;
}

export async function exportCsv(): Promise<number> {
  const rows = await allIz();
  if (!rows.length) return 0;
  const headers = ["N° IZ", "Indice", "Code travail", "Validité début", "Validité fin", "Activité", "Intervenant", "Projet",
    "Site", "Tranche", "Local", "Objet", "Libellé", "DED max (mSv/h)", "Dont neutron (mSv/h)", "Dose moy. (mSv)",
    "Dose moy./jour (mSv/j)", "DED trajet (mSv/h)", "N° Act", "Tags", "Notes", "Nb usages", "Dernier usage"];
  const n = (v: number | null) => (v == null ? "" : String(v).replace(".", ","));
  const data = rows.map((r) => [
    r.num_iz ?? r.code, r.indice ?? "", r.code_travail ?? "", r.validite_debut ?? "", r.validite_fin ?? "",
    r.activite ?? "", r.intervenant ?? "", r.projet ?? "", r.site ?? "", r.tranche ?? "", r.local ?? "", r.objet ?? "",
    r.label ?? "", n(r.ded_max), n(r.ded_neutron), n(r.dose_moy), n(r.dose_jour), n(r.ded_trajet), r.num_act ?? "",
    (r.tags ?? []).join("; "), (r.notes ?? "").replace(/\n/g, " "), r.use_count || 0, r.last_used ?? "",
  ]);
  const csv = [headers, ...data].map((l) => l.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(";")).join("\n");
  download(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }), `iz_export_${today()}.csv`);
  return rows.length;
}

interface ImportedIz extends Partial<Omit<RtrIz, "code" | "label" | "site" | "tranche" | "local" | "notes" | "tags">> {
  code?: string; label?: string; site?: string; tranche?: string; local?: string; notes?: string;
  tags?: string[]; createdAt?: string; lastUsed?: string | null; useCount?: number; barcodeFormat?: string;
}
export interface ParsedImport { izs: ImportedIz[]; cfg: Partial<RtrConfig> | null; }

export function parseImport(text: string): ParsedImport {
  const data = JSON.parse(text);
  if (!data || !Array.isArray(data.izs)) throw new Error("Format JSON invalide (tableau « izs » attendu)");
  return { izs: data.izs, cfg: data.userCfg ?? null };
}

// Fusion par code : compteur = max, dernier usage = le plus récent (comme PTV1).
export async function importIzs(list: ImportedIz[]): Promise<number> {
  let n = 0;
  for (const src of list) {
    const code = (src.code ?? "").trim();
    if (!code) continue;
    const existing = await findByCode(code);
    const base = existing ?? blankIz(code);
    const lastUsed = [existing?.last_used, src.lastUsed].filter(Boolean).sort().pop() ?? null;
    const extra: Partial<RtrIz> = {};
    const keys = ["num_iz", "indice", "code_travail", "num_act", "validite_debut", "validite_fin", "activite", "intervenant",
      "projet", "objet", "ded_max", "ded_neutron", "dose_moy", "dose_jour", "ded_trajet"] as const;
    for (const k of keys) if (src[k] != null && src[k] !== "") (extra as Record<string, unknown>)[k] = src[k];
    if (!extra.num_iz) Object.assign(extra, Object.fromEntries(Object.entries(parseIzCode(code)).filter(([, v]) => v)));
    await saveIz({
      ...base, ...extra,
      label: src.label || null, site: src.site || null, tranche: src.tranche || null,
      local: src.local || null, notes: src.notes || null, tags: Array.isArray(src.tags) ? src.tags : [],
      barcode_format: (src.barcodeFormat as RtrBarcodeFormat) || base.barcode_format,
      use_count: Math.max(existing?.use_count || 0, src.useCount || 0),
      last_used: lastUsed,
      created_at: existing?.created_at || src.createdAt || base.created_at,
    });
    n++;
  }
  return n;
}
