// Constats de vérification Bertin (NT170, NT200, ABPM…) liés aux lignes d'intervention.
// Les modèles (src/modules/constat/templates/*.json) sont générés depuis les PDF d'origine :
// positions des cases à cocher, cellules du tableau des mesures et zones de l'en-tête.
// Le PDF exporté = PDF d'origine + valeurs dessinées par-dessus (voir constatPdf.ts).
import { db } from "./db";
import { currentUserId, localSoftDelete, localUpsert, syncAll } from "./sync";
import { decompose, siteFromIdCourt } from "./materiels";
import { activiteFromValeurs } from "./decay";
import { getParams } from "./planning";
import type { Constat, ConstatValue, Etalon, EtalonModele, InterventionLigne } from "./types";
import NT170 from "../modules/constat/templates/NT170.json";
import NT200 from "../modules/constat/templates/NT200.json";
import ABPM from "../modules/constat/templates/ABPM.json";

// ---- structure des modèles -------------------------------------------------
export interface Pos { x: number; y: number }
export interface TplText { id: string; page: number; x: number; y: number; size: number; align: string; w?: number }
export interface TplOpt { v: string; x: number; y: number; s: number }
export interface TplEtat extends TplOpt { group: "entree" | "intervention" | "sortie" | "jugement"; label: string; page: number }
export interface TplSource { id: string; label: string; rn: string | null; types: string[]; page: number; num: Pos; act: Pos | null }
export interface TplPersonne { id: "exec" | "ct"; page: number; nom: Pos; sig: Pos | null }
export interface CellBox { x: number; w: number; y0: number; y1: number }
export type TplCell =
  | ({ type: "text" } & CellBox)
  | ({ type: "textso"; so: TplOpt } & CellBox)
  | { type: "choice"; options: TplOpt[] }
  | null;
export interface TplRow {
  kind: "titre" | "mesure"; page: number; label: string; bold?: boolean; choice?: TplOpt[];
  y0?: number; y1?: number; tol?: string; tolChoice?: TplOpt[];
  avant?: TplCell; apres?: TplCell; obs?: CellBox & { type: "text" }; obsFields?: { id: string; x: number; y: number }[];
}
export interface ConstatTemplate {
  id: string; pages: number;
  header: TplText[]; everyPage: TplText[];
  etats: TplEtat[]; sources: TplSource[]; personnes: TplPersonne[];
  rows: TplRow[]; comments: { page: number; x: number; y: number; w: number; h: number; size: number } | null;
}
export interface ConstatModele {
  id: string; nom: string; pdf: string; tpl: ConstatTemplate;
  typeCodes: RegExp; designation: RegExp;
}

export const CONSTAT_MODELES: ConstatModele[] = [
  { id: "NT170", nom: "Contrôleur de frottis MGPI NT170", pdf: "constats/NT170.pdf", tpl: NT170 as unknown as ConstatTemplate,
    typeCodes: /^SRCONCHINT170$/i, designation: /\bNT\s*-?170\b/i },
  { id: "NT200", nom: "Contrôleur d'échantillons MGPI NT200", pdf: "constats/NT200.pdf", tpl: NT200 as unknown as ConstatTemplate,
    typeCodes: /^SRCONFRONT200$/i, designation: /\bNT\s*-?200\b/i },
  { id: "ABPM", nom: "Balise aérosol MGPI ABPM", pdf: "constats/ABPM.pdf", tpl: ABPM as unknown as ConstatTemplate,
    typeCodes: /^SRCONAE(R)?(-?A?20\dM?|ABPM|A30\dM)$/i, designation: /\bABPM\b/i },
];
export const modeleById = (id: string) => CONSTAT_MODELES.find((m) => m.id === id) ?? null;

// Modèle de constat applicable à un équipement (type GMO² puis désignation Corim / ligne).
export async function modeleForLigne(l: Pick<InterventionLigne, "scan" | "designation">): Promise<ConstatModele | null> {
  const scan = (l.scan ?? "").trim();
  const tc = scan ? decompose(scan).type_code : null;
  if (tc) {
    const m = CONSTAT_MODELES.find((x) => x.typeCodes.test(tc));
    if (m) return m;
    const ct = await db.corim_types.get(tc);
    if (ct && !ct.deleted && ct.designation) {
      const m2 = CONSTAT_MODELES.find((x) => x.designation.test(ct.designation!));
      if (m2) return m2;
    }
  }
  if (l.designation) return CONSTAT_MODELES.find((x) => x.designation.test(l.designation!)) ?? null;
  return null;
}

// ---- CRUD -----------------------------------------------------------------
export async function constatOfLigne(ligneId: string): Promise<Constat | undefined> {
  const rows = await db.constats.where("ligne_id").equals(ligneId).toArray();
  return rows.filter((r) => !r.deleted).sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0];
}
export async function constatsOfListing(listingId: string): Promise<Constat[]> {
  return (await db.constats.where("listing_id").equals(listingId).toArray()).filter((r) => !r.deleted);
}
export async function getConstat(id: string): Promise<Constat | undefined> {
  const r = await db.constats.get(id);
  return r && !r.deleted ? r : undefined;
}
export async function saveConstat(c: Constat): Promise<void> {
  const uid = await currentUserId();
  await localUpsert(db.constats, { ...c, user_id: c.user_id ?? uid });
  syncAll().catch(() => {});
}
export async function deleteConstat(id: string): Promise<void> {
  await localSoftDelete(db.constats, id);
  syncAll().catch(() => {});
}

// ---- sources : étalons ECME compatibles -----------------------------------
const normRn = (s: string) => s.replace(/[\s-]/g, "").toLowerCase();       // "Co-60" ≡ "co60"
const normS = (s: string) => s.toUpperCase().replace(/^S0*(\d+)$/, "S$1"); // S03 ≡ S3
export interface SourceChoice { etalon: Etalon; num: string; actBq: number | null; typeS: string; client: string; score: number }

export async function sourcesFor(slot: TplSource, at: Date, site: string | null): Promise<SourceChoice[]> {
  const [etalons, modeles] = await Promise.all([db.etalons.toArray(), db.modeles.toArray()]);
  const mById = new Map(modeles.filter((m) => !m.deleted).map((m) => [m.id, m as EtalonModele]));
  const out: SourceChoice[] = [];
  for (const e of etalons) {
    if (e.deleted || e.statut === "reforme") continue;
    const m = e.modele_id ? mById.get(e.modele_id) : undefined;
    const v = e.valeurs ?? {};
    const rnField = m?.champs.find((c) => c.type === "radionucleide");
    const rn = rnField ? String(v[rnField.cle] ?? "") : "";
    if (slot.rn && normRn(rn) !== normRn(slot.rn)) continue;
    if (!slot.rn && rnField) continue; // emplacement « appareil » (DP11…) : pas les sources
    const d = activiteFromValeurs(m?.champs, v, at);
    const typeS = String(v["c_typs"] ?? "");
    const client = String(v["c_client"] ?? "");
    let score = 0;
    if (slot.types.length && slot.types.map(normS).includes(normS(typeS))) score += 4;
    if (site && client.toLowerCase().includes(site.toLowerCase())) score += 2;
    if (e.statut === "en_service") score += 1;
    out.push({ etalon: e, num: e.num_serie || e.num_client || e.designation, actBq: d?.act != null ? d.act * 1000 : null, typeS, client, score });
  }
  return out.sort((a, b) => b.score - a.score || a.num.localeCompare(b.num));
}
export const fmtBq = (bq: number | null) => (bq == null ? "" : Math.round(bq).toLocaleString("fr-FR").replace(/ | /g, " "));

// ---- préremplissage --------------------------------------------------------
// N° de constat : <trigramme><AAMMJJHHmm>C, ex. RBB2610261153C
export function numeroConstat(tri: string | null | undefined, d: Date = new Date()): string {
  const p2 = (n: number) => String(n).padStart(2, "0");
  const t = (tri ?? "").trim().toUpperCase() || "XXX";
  return `${t}${p2(d.getFullYear() % 100)}${p2(d.getMonth() + 1)}${p2(d.getDate())}${p2(d.getHours())}${p2(d.getMinutes())}C`;
}
// Signature mémorisée de l'utilisateur (sur l'appareil) pour la réutiliser d'un tap.
export const MA_SIGNATURE = "ma_signature";
const frDate = (iso: string | null | undefined) => {
  if (!iso) return "";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return y && m && d ? `${d}/${m}/${y}` : iso;
};
export const parseFrDate = (s: string): Date | null => {
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  return m ? new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]), 12) : null;
};

export async function prefillConstat(modele: ConstatModele, l: InterventionLigne): Promise<Constat> {
  const t = modele.tpl;
  const v: Record<string, ConstatValue> = {};
  const mat = l.scan ? await db.materiels.get(l.scan.trim()) : undefined;
  const site = siteFromIdCourt(l.id_court) ?? mat?.site ?? null;
  const p0 = await getParams().catch(() => null);
  v.numero = numeroConstat(p0?.trigramme || l.tri_exec);
  v.delivre_a = site ? `CNPE ${site}` : "";
  v.date_verif = frDate(l.date_op);
  v.sn = l.sn ?? mat?.sn ?? "";
  v.id_client = l.id_court || "";
  v.localisation = mat?.localisation || site || "";
  // états / jugement déduits de la conformité de la ligne
  const has = (g: string, lab: string) => t.etats.some((e) => e.group === g && e.label === lab);
  const conf = l.conformite;
  if (conf === "Conforme") {
    if (has("entree", "Dans les spécifications")) v["etat.entree"] = "Dans les spécifications";
    if (has("sortie", "Dans les spécifications")) v["etat.sortie"] = "Dans les spécifications";
  } else if (conf === "Conforme après intervention") {
    if (has("entree", "Hors spécifications")) v["etat.entree"] = "Hors spécifications";
    if (has("sortie", "Dans les spécifications")) v["etat.sortie"] = "Dans les spécifications";
  } else if (has("sortie", "Hors spécifications")) v["etat.sortie"] = "Hors spécifications";
  v["etat.intervention"] = has("intervention", "Vérification") ? ["Vérification"] : [];
  if (has("jugement", conf)) v["etat.jugement"] = conf;
  // personnes
  const p = p0;
  const nomExec = [p?.prenom, p?.nom].filter(Boolean).join(" ");
  v["pers.exec"] = nomExec || l.tri_exec || "";
  v["pers.ct"] = l.tri_ct ?? "";
  // sources : meilleure correspondance (radionucléide, type S, site), activité au jour de la vérif
  const at = parseFrDate(String(v.date_verif)) ?? new Date();
  for (const s of t.sources) {
    const best = (await sourcesFor(s, at, site))[0];
    if (best && s.rn) {
      v[`src.${s.id}.etalon`] = best.etalon.id;
      v[`src.${s.id}.num`] = best.num;
      v[`src.${s.id}.act`] = fmtBq(best.actBq);
    }
  }
  v.comments = l.commentaire ?? "";
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(), listing_id: l.listing_id, ligne_id: l.id, template_id: modele.id,
    values: v, user_id: null, created_at: now, updated_at: now, deleted: false,
  };
}

// Remplit les cases « C » (ou Oui/Non attendu) encore vides de la colonne « avant ajustage ».
export function toutConforme(t: ConstatTemplate, values: Record<string, ConstatValue>, rowIdx?: number[]): Record<string, ConstatValue> {
  const v = { ...values };
  t.rows.forEach((r, i) => {
    if (rowIdx && !rowIdx.includes(i)) return;
    for (const c of ["avant"] as const) { // « après ajustage » reste facultatif
      const cell = r[c];
      if (!cell || cell.type !== "choice") continue;
      const k = `r${i}.${c}`;
      if (v[k]) continue;
      const vs = cell.options.map((o) => o.v);
      const ok = vs.includes("C") ? cell.options.find((o) => o.v === "C")
        : vs.includes("Oui") && vs.includes("Non") ? cell.options.find((o) => o.v === (/^\s*(sans|non)\b/i.test(r.tol ?? "") ? "Non" : "Oui"))
        : undefined;
      if (ok) v[k] = ok.v;
    }
  });
  return v;
}

// ---- tolérances dynamiques -------------------------------------------------
// Interprète la colonne « Tolérance » d'une ligne : plage, borne, valeur ± écart,
// ou activité surfacique de référence (As ± x %) calculée depuis la source choisie.
export type Tol =
  | { kind: "range"; min: number | null; max: number | null }
  | { kind: "as"; ray: "α" | "β"; pct: number };
const num = (s: string) => Number(s.replace(/(\d)\s+(?=\d)/g, "$1").replace(",", "."));
const N = "(\\d[\\d\\s]*(?:[.,]\\d+)?)";
export function parseTol(tol: string | undefined): Tol | null {
  if (!tol) return null;
  const s = tol.replace(/\s+/g, " ").trim();
  let m = s.match(/As\s*([αβ])\s*à\s*±\s*(\d+(?:[.,]\d+)?)\s*%/);
  if (m) return { kind: "as", ray: m[1] as "α" | "β", pct: num(m[2]) };
  m = s.match(new RegExp(`${N}\\s*%?\\s*[≤<]\\s*(?:[A-Za-zÀ-ÿ.]+\\s*)?[≤<]\\s*${N}`));
  if (m) return { kind: "range", min: num(m[1]), max: num(m[2]) };
  m = s.match(new RegExp(`^${N}\\s*±\\s*${N}\\s*(%)?`));
  if (m) { const c = num(m[1]), d = num(m[2]) * (m[3] ? num(m[1]) / 100 : 1); return { kind: "range", min: c - d, max: c + d }; }
  m = s.match(new RegExp(`^[≤<]\\s*${N}`));
  if (m) return { kind: "range", min: null, max: num(m[1]) };
  m = s.match(new RegExp(`^[≥>]\\s*${N}`));
  if (m) return { kind: "range", min: num(m[1]), max: null };
  return null;
}
export function parseValeur(v: string): number | null {
  const m = v.replace(/(\d)\s+(?=\d)/g, "$1").match(/-?\d+(?:[.,]\d+)?/);
  return m ? Number(m[0].replace(",", ".")) : null;
}
// Activité surfacique (Bq/cm²) d'une source = activité du jour / surface active (diamètre en mm).
export function activiteSurfacique(actBq: number | null, diamMm: unknown): number | null {
  const d = Number(diamMm);
  if (actBq == null || !d) return null;
  return actBq / (Math.PI * (d / 20) ** 2);
}
export interface TolEval { ok: boolean | null; min: number | null; max: number | null; ref?: number }
export function evalTol(tol: Tol | null, valeur: string, asRef?: (ray: "α" | "β") => number | null): TolEval | null {
  if (!tol) return null;
  let min: number | null, max: number | null, ref: number | undefined;
  if (tol.kind === "as") {
    const r = asRef?.(tol.ray) ?? null;
    if (r == null) return { ok: null, min: null, max: null };
    ref = r; min = r * (1 - tol.pct / 100); max = r * (1 + tol.pct / 100);
  } else { min = tol.min; max = tol.max; }
  const x = parseValeur(valeur);
  if (x == null) return { ok: null, min, max, ref };
  const eps = 1e-9;
  return { ok: (min == null || x >= min - eps) && (max == null || x <= max + eps), min, max, ref };
}
