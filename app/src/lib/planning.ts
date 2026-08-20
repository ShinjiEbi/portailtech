// Accès aux données du module Planning, par-dessus le moteur offline-first
// existant (Dexie local + sync.ts vers Supabase). Aucune logique réseau ici :
// on écrit en local (localUpsert/localSoftDelete) et on déclenche syncAll().
import { db } from "./db";
import { supabase } from "./supabase";
import { localUpsert, localSoftDelete, syncAll } from "./sync";
import {
  PLANNING_TRAVAIL,
  type PlanningJour,
  type PlanningParams,
  type PlanningType,
} from "./types";

// ---- utilitaires -----------------------------------------------------------
const pad = (n: number) => String(n).padStart(2, "0");
export const iso = (y: number, m0: number, d: number) => `${y}-${pad(m0 + 1)}-${pad(d)}`;

export function isWorked(type: PlanningType): boolean {
  return PLANNING_TRAVAIL.includes(type);
}

// Heures : total = travail + trajet ; supp = travail au-delà de l'horaire ;
// le trajet est toujours compté en heures NORMALES (jamais en supp).
const toMin = (v?: string | null): number | null => {
  if (!v) return null;
  const [h, m] = v.split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
};
export function trajetHeures(ad?: string | null, af?: string | null, rd?: string | null, rf?: string | null): number {
  const seg = (d?: string | null, f?: string | null) => { const a = toMin(d), b = toMin(f); return a == null || b == null ? 0 : Math.max(0, b - a); };
  return (seg(ad, af) + seg(rd, rf)) / 60;
}
export function calcHeures(
  debut?: string | null,
  fin?: string | null,
  pause?: number | null,
  horaire = 7.5,
  trajetH = 0
): { total: number | null; h_norm: number | null; h_supp: number | null } {
  const tr = Math.round((trajetH || 0) * 10) / 10;
  if (!debut || !fin) {
    if (tr > 0) return { total: tr, h_norm: tr, h_supp: 0 };
    return { total: null, h_norm: null, h_supp: null };
  }
  const [a, b] = debut.split(":").map(Number);
  const [c, d] = fin.split(":").map(Number);
  let mins = c * 60 + d - (a * 60 + b) - Math.max(0, Number(pause) || 0);
  if (mins < 0) mins = 0;
  const work = Math.round(mins / 6) / 10;
  const supp = Math.max(0, +(work - horaire).toFixed(2));
  const normWork = Math.min(work, horaire);
  return {
    total: Math.round((work + tr) * 10) / 10,
    h_norm: Math.round((normWork + tr) * 10) / 10,
    h_supp: Math.round(supp * 10) / 10,
  };
}

// Code d'imputation auto : mappé par contrat (params.codes[contrat]).
export function imputationFor(params: PlanningParams, contrat?: string | null): string {
  return contrat ? params.codes?.[contrat] ?? "" : "";
}

// ---- identité ---------------------------------------------------------------
export async function currentUserId(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.user.id ?? null;
}

// UUID v5 déterministe : même (user_id|date) -> même id sur tous les appareils,
// donc l'upsert fusionne au lieu de créer des doublons (offline multi-postes).
const NS_PLANNING = "6f9a1e4c-2b7d-5c3a-8e21-planning0jour"; // namespace fixe du module
function parseUuid(u: string): Uint8Array {
  const hex = u.replace(/[^0-9a-f]/gi, "").padEnd(32, "0").slice(0, 32);
  const out = new Uint8Array(16);
  for (let i = 0; i < 16; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}
function fmtUuid(b: Uint8Array): string {
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}
export async function jourId(userId: string, date: string): Promise<string> {
  const ns = parseUuid(NS_PLANNING);
  const name = new TextEncoder().encode(`${userId}|${date}`);
  const buf = new Uint8Array(ns.length + name.length);
  buf.set(ns);
  buf.set(name, ns.length);
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-1", buf));
  const id = hash.slice(0, 16);
  id[6] = (id[6] & 0x0f) | 0x50; // version 5
  id[8] = (id[8] & 0x3f) | 0x80; // variant RFC 4122
  return fmtUuid(id);
}

// ---- jours ------------------------------------------------------------------
function monthBounds(y: number, m0: number): [string, string] {
  return [iso(y, m0, 1), `${y}-${pad(m0 + 1)}-31`]; // borne haute large : tri ISO
}

// Jours (non supprimés) d'un mois donné. m0 = mois 0-indexé (0 = janvier).
export async function monthJours(y: number, m0: number): Promise<PlanningJour[]> {
  const [start, end] = monthBounds(y, m0);
  const rows = await db.planning.where("date").between(start, end, true, true).toArray();
  return rows.filter((r) => !r.deleted).sort((a, b) => a.date.localeCompare(b.date));
}

// Tous les jours (pour l'export JSON). 
export async function allJours(): Promise<PlanningJour[]> {
  const rows = await db.planning.toArray();
  return rows.filter((r) => !r.deleted).sort((a, b) => a.date.localeCompare(b.date));
}

export async function getJour(date: string): Promise<PlanningJour | null> {
  const uid = await currentUserId();
  if (!uid) return null;
  const id = await jourId(uid, date);
  const row = await db.planning.get(id);
  return row && !row.deleted ? (row as PlanningJour) : null;
}

// Dernier jour TRAVAILLÉ strictement avant `date` (pour pré-remplir un jour vide).
export async function lastWorkedJour(before: string): Promise<PlanningJour | null> {
  const rows = await db.planning.where("date").below(before).toArray();
  const worked = rows.filter((r) => !r.deleted && isWorked(r.type)).sort((a, b) => b.date.localeCompare(a.date));
  return worked[0] ?? null;
}

const JOUR_DEFAUTS: Omit<PlanningJour, "id" | "user_id" | "date" | "updated_at"> = {
  type: "Travaillé",
  debut: null, fin: null, pause: null,
  total: null, h_norm: null, h_supp: null,
  site: null, contrat: null, imputation: null,
  dose: null,
  trajet: false, t_ad: null, t_af: null, t_rd: null, t_rf: null,
  frais: [],
  commentaire: null,
  deleted: false,
};

// Crée/met à jour un jour. `patch` doit au moins contenir `date`.
export async function upsertJour(
  patch: Partial<PlanningJour> & { date: string }
): Promise<PlanningJour> {
  const user_id = await currentUserId();
  if (!user_id) throw new Error("Non connecté : impossible d'enregistrer le jour.");
  const id = patch.id ?? (await jourId(user_id, patch.date));
  const existing = await db.planning.get(id);
  const { _dirty, ...prev } = (existing ?? {}) as Partial<PlanningJour> & { _dirty?: 0 | 1 };
  void _dirty;
  const row: PlanningJour = {
    ...JOUR_DEFAUTS,
    ...prev,
    ...patch,
    id,
    user_id,
    deleted: false,
    updated_at: new Date().toISOString(),
  };
  await localUpsert(db.planning, row);
  syncAll().catch(() => {});
  return row;
}

export async function deleteJour(date: string): Promise<void> {
  const uid = await currentUserId();
  if (!uid) return;
  const id = await jourId(uid, date);
  await localSoftDelete(db.planning, id);
  syncAll().catch(() => {});
}

// ---- paramètres (1 jeu par utilisateur, id = user_id) ----------------------
export const DEFAULT_CODES: Record<string, string> = {
  RPM: "", KZC: "", KRS: "", "Assistance hebdo": "", Autre: "",
};

export function defaultParams(id = ""): PlanningParams {
  return {
    id,
    horaire: 7.5,
    matricule: "", dosi: "", nom: "", prenom: "", sup: "", trigramme: "",
    codes: { ...DEFAULT_CODES },
    trajet_defaut: null,
    sites_favoris: [],
    updated_at: new Date().toISOString(),
    deleted: false,
  };
}

export async function getParams(): Promise<PlanningParams> {
  const uid = await currentUserId();
  if (!uid) return defaultParams("");
  const row = await db.planning_params.get(uid);
  if (!row || row.deleted) return defaultParams(uid);
  // complète les clés de codes manquantes (robustesse si ajout de contrat)
  return {
    ...defaultParams(uid), ...row,
    codes: { ...DEFAULT_CODES, ...(row.codes ?? {}) },
    sites_favoris: Array.isArray(row.sites_favoris) ? row.sites_favoris : [],
  };
}

export async function saveParams(patch: Partial<PlanningParams>): Promise<PlanningParams> {
  const uid = await currentUserId();
  if (!uid) throw new Error("Non connecté : impossible d'enregistrer les paramètres.");
  const current = await getParams();
  const row: PlanningParams = {
    ...current,
    ...patch,
    codes: { ...current.codes, ...(patch.codes ?? {}) },
    id: uid,
    deleted: false,
    updated_at: new Date().toISOString(),
  };
  await localUpsert(db.planning_params, row);
  syncAll().catch(() => {});
  return row;
}
