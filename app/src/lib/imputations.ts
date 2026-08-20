// Imputations = référentiel des POINTAGES (Client -> Projet[n°+nom] -> Tâche).
// Un pointage = N° projet + Tâche (ce qui est reporté dans Oracle).
// Import depuis l'Excel Bertin (onglets "Pointages …" et "Générique"),
// stockage Supabase (public.imputations) + miroir local Dexie (hors-ligne).
import { db } from "./db";
import { supabase } from "./supabase";
import { isOnline, syncAll } from "./sync";
import { PLANNING_SITES, type Imputation } from "./types";

export interface ImputationInput {
  client: string | null;
  nom_projet: string | null;
  num_projet: string | null;
  tache: string;
  nom_tache: string | null;
  commentaires: string | null;
  site: boolean;
  usine: boolean;
  annee: number | null;
}

const clean = (v: unknown): string => (v == null ? "" : String(v).replace(/[\t\n\r]+/g, " ").trim());
const nn = (s: string): string | null => (s ? s : null);

export interface ParsedImputations { feuille: string; rows: ImputationInput[]; }

// Onglet "Pointages" : Client | Nom Projet | Num Projet | Tâche | Libellé | Comment. | Site | Usine.
// Les cellules Client/Nom/Num sont fusionnées (remplies sur la 1re ligne du bloc) -> on propage.
function parsePointages(aoa: unknown[][], annee: number | null): ImputationInput[] {
  const last = ["", "", ""];
  const out: ImputationInput[] = [];
  for (let i = 1; i < aoa.length; i++) {
    const r = aoa[i] ?? [];
    for (let c = 0; c < 3; c++) { const v = clean(r[c]); if (v) last[c] = v; }
    const tache = clean(r[3]);
    if (!tache) continue;
    out.push({
      client: nn(last[0]), nom_projet: nn(last[1]), num_projet: nn(last[2]),
      tache, nom_tache: nn(clean(r[4])), commentaires: nn(clean(r[5])),
      site: clean(r[6]).toUpperCase() === "X", usine: clean(r[7]).toUpperCase() === "X", annee,
    });
  }
  return out;
}

// Onglet "Générique" : Projets | Tâche | Descriptif | Exemple. Pas de client/n°.
// Le code projet = ce qui précède la parenthèse ("FGBIS1 (Pole…)" -> "FGBIS1").
// Les lignes de section ("Pointage", "Note de frais") n'ont pas de code tâche -> ignorées.
function parseGenerique(aoa: unknown[][], annee: number | null): ImputationInput[] {
  const out: ImputationInput[] = [];
  for (let i = 1; i < aoa.length; i++) {
    const r = aoa[i] ?? [];
    const projets = clean(r[0]);
    const tache = clean(r[1]);
    if (!projets || !/^\d/.test(tache)) continue;
    const num = projets.split(/\s*\(/)[0].trim() || projets;
    out.push({
      client: "Générique", nom_projet: projets, num_projet: num,
      tache, nom_tache: nn(clean(r[2])), commentaires: nn(clean(r[3])),
      site: false, usine: false, annee,
    });
  }
  return out;
}

// Lit toutes les feuilles reconnues (en-tête commençant par "Client" ou "Projets").
export async function parseImputationsXlsx(file: File): Promise<ParsedImputations> {
  const XLSX = await import("xlsx");
  const wb = XLSX.read(new Uint8Array(await file.arrayBuffer()), { type: "array" });
  const rows: ImputationInput[] = [];
  const feuilles: string[] = [];
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    if (!ws) continue;
    const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: false, defval: "" });
    if (!aoa.length) continue;
    const h0 = clean((aoa[0] ?? [])[0]).toLowerCase();
    const ym = name.match(/\b(20\d{2})\b/);
    const annee = ym ? Number(ym[1]) : null;
    if (h0 === "client") { rows.push(...parsePointages(aoa, annee)); feuilles.push(name); }
    else if (h0 === "projets") { rows.push(...parseGenerique(aoa, annee)); feuilles.push(name); }
  }
  if (rows.length === 0) throw new Error("Aucune imputation trouvée (feuilles « Client… » ou « Projets… »).");
  return { feuille: feuilles.join(" + "), rows };
}

export interface ImportImputationsResult { lignes: number; feuille: string; }

// Upsert vers Supabase (clé naturelle num_projet+tache) puis miroir local via sync.
export async function importImputations(file: File): Promise<ImportImputationsResult> {
  if (!isOnline()) throw new Error("Connexion requise pour importer les imputations.");
  const { feuille, rows } = await parseImputationsXlsx(file);
  if (rows.length === 0) throw new Error("Aucune imputation trouvée dans le fichier.");

  const seen = new Map<string, ImputationInput>();
  for (const r of rows) seen.set(`${r.num_projet}|${r.tache}`, r);

  // Conserve les couleurs déjà attribuées ; en crée une (aléatoire, douce) pour les nouvelles.
  const existing = new Map<string, string>();
  const { data: prev, error: selErr } = await supabase
    .from("imputations").select("num_projet,tache,couleur");
  if (selErr) throw new Error("Base à mettre à jour (schema.sql) — colonne « couleur » manquante : " + selErr.message);
  for (const r of prev ?? []) {
    if (r.couleur) existing.set(`${r.num_projet}|${r.tache}`, r.couleur as string);
  }
  const payload = [...seen.values()].map((r) => {
    const key = `${r.num_projet}|${r.tache}`;
    return { ...r, deleted: false, couleur: existing.get(key) ?? randomMutedColor() };
  });

  const CHUNK = 500;
  for (let i = 0; i < payload.length; i += CHUNK) {
    const { error } = await supabase
      .from("imputations")
      .upsert(payload.slice(i, i + CHUNK), { onConflict: "num_projet,tache" });
    if (error) throw new Error(error.message);
  }
  await syncAll();
  return { lignes: payload.length, feuille };
}

export async function allImputations(): Promise<Imputation[]> {
  const rows = await db.imputations.toArray();
  return rows
    .filter((r) => !r.deleted)
    .sort((a, b) => (a.num_projet ?? "").localeCompare(b.num_projet ?? "") || a.tache.localeCompare(b.tache));
}

// Pointage = "N° projet · tâche" (ce qu'on reporte dans Oracle).
export function imputationCode(i: Imputation): string {
  return `${i.num_projet ?? "?"} · ${i.tache}`;
}
export function imputationLabel(i: Imputation): string {
  return `${imputationCode(i)}${i.nom_tache ? " — " + i.nom_tache : ""}`;
}
export function imputationByCode(imps: Imputation[], code: string | null | undefined): Imputation | null {
  if (!code) return null;
  return imps.find((i) => imputationCode(i) === code) ?? null;
}

// --- cascade Client -> Projet -> Tâche --------------------------------------
export interface Projet { num: string; nom: string; }

export function clientsInDb(imps: Imputation[]): string[] {
  const set = new Set<string>();
  for (const i of imps) if (!i.deleted && i.client) set.add(i.client);
  const rank = (c: string) => (c === "EDF" ? 0 : c === "Générique" ? 2 : 1);
  return [...set].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b, "fr"));
}
export function projetsForClient(imps: Imputation[], client: string): Projet[] {
  const m = new Map<string, string>();
  for (const i of imps) {
    if (i.deleted || i.client !== client) continue;
    const num = i.num_projet ?? "";
    if (num && !m.has(num)) m.set(num, i.nom_projet ?? num);
  }
  return [...m.entries()].map(([num, nom]) => ({ num, nom })).sort((a, b) => a.nom.localeCompare(b.nom, "fr"));
}
export function tachesForProjet(imps: Imputation[], num: string): Imputation[] {
  return imps
    .filter((i) => !i.deleted && (i.num_projet ?? "") === num)
    .sort((a, b) => a.tache.localeCompare(b.tache));
}

// --- déduction contrat + site (pour les exports dosi / feuille de temps) ----
function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ").trim()
    .replace(/\bst\b/g, "saint").replace(/\bste\b/g, "sainte")
    .replace(/\s+/g, "");
}
function impParts(i: Imputation): { type: string; site: string } {
  const nt = i.nom_tache ?? "";
  if (/^rpm\b/i.test(nt)) return { type: "rpm", site: norm(nt.replace(/^rpm\s*/i, "")) };
  if (/^kzc/i.test(nt)) return { type: "kzc", site: norm(nt.replace(/^kzc\s*/i, "")) };
  if (/^krt\b/i.test(nt)) return { type: "krt", site: norm(nt.replace(/^krt\s*/i, "")) };
  const proj = (i.nom_projet ?? "").toLowerCase();
  let type = "";
  if (proj.includes("assistance")) type = "assistance";
  else if (proj.includes("skylink")) type = "krs"; // KRS (planning) = MCO Skylink
  else if (proj.includes("krt")) type = "krt";
  return { type, site: norm(nt) };
}
function siteToken(site: string): string {
  return norm(site.replace(/^cnpe\s+/i, "").replace(/^dp2d\s+/i, "").replace(/\s+\d+$/, "").replace(/\s+[ab]$/i, ""));
}
const CANON_SITE: Record<string, string> = (() => {
  const m: Record<string, string> = {};
  for (const s of PLANNING_SITES) { const k = siteToken(s); if (k && !(k in m)) m[k] = s; }
  return m;
})();
const TYPE_CONTRAT: Record<string, string> = { rpm: "RPM", kzc: "KZC", krs: "KRS", assistance: "Assistance hebdo" };

// Contrat (vocabulaire dosi) déduit du pointage ; "Autre" si non reconnu.
export function contratFromImputation(i: Imputation | null): string | null {
  if (!i) return null;
  return TYPE_CONTRAT[impParts(i).type] ?? "Autre";
}
// Site canonique (PLANNING_SITES) déduit du pointage, ou null (tâche sans site).
export function siteFromImputation(i: Imputation | null): string | null {
  if (!i) return null;
  return CANON_SITE[impParts(i).site] ?? null;
}

// --- couleurs des pointages (liseré des cases du planning) ------------------
function hslToHex(h: number, s: number, l: number): string {
  const sn = s / 100, ln = l / 100;
  const a = sn * Math.min(ln, 1 - ln);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const c = ln - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(255 * c).toString(16).padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}
// Couleur douce aléatoire (saturation/luminosité modérées, pas « flash »).
export function randomMutedColor(): string {
  const h = Math.floor(Math.random() * 360);
  const s = 36 + Math.floor(Math.random() * 16); // 36–52 %
  const l = 54 + Math.floor(Math.random() * 10); // 54–64 %
  return hslToHex(h, s, l);
}
// Repli déterministe (douce) tant qu'un pointage n'a pas de couleur stockée.
export function fallbackColor(seed: string | null | undefined): string {
  const s = seed ?? "";
  let h = 0;
  for (let k = 0; k < s.length; k++) h = (h * 31 + s.charCodeAt(k)) >>> 0;
  return hslToHex(h % 360, 42, 58);
}
