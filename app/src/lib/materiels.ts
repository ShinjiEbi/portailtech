// Base matériels (équipements vérifiés). Deux familles d'identifiant :
//  - GMO²  : "SRCONSONSBM2D-BUG070"  → type_code "-" id_court ; désignation auto via Corim
//  - repère fonctionnel (matériels fixes, portiques…) : "8KZC012AR" → nom saisi à la main
// Import depuis l'Excel de suivi (onglets "TIS" + "correspondance CORIM"),
// stockage Supabase (public.materiels / public.corim_types) + miroir Dexie (offline).
import { db } from "./db";
import { supabase } from "./supabase";
import { isOnline, syncAll } from "./sync";
import type { CorimType, Materiel, MaterielEtat } from "./types";

const clean = (v: unknown): string => (v == null ? "" : String(v).replace(/[\t\n\r]+/g, " ").trim());
const nn = (s: string): string | null => (s ? s : null);

// --- trigrammes de site (préfixe de l'id court) -----------------------------
// Abréviations standard du secteur. BUG/SAL confirmés ; les autres sont à valider
// avec les préfixes réels (surtout DP2D). Préfixe inconnu → site laissé vide.
export const SITE_TRIGRAMME: Record<string, string> = {
  BEL: "Belleville", BLA: "Blayais", BUG: "Bugey", CAT: "Cattenom", CHI: "Chinon",
  CHO: "Chooz", CIV: "Civaux", CRU: "Cruas", DAM: "Dampierre", FSH: "Fessenheim",
  FLA: "Flamanville", GOL: "Golfech", GRA: "Gravelines", NOG: "Nogent", PAL: "Paluel",
  PEN: "Penly", SAL: "Saint-Alban", SLB: "Saint-Laurent", TRI: "Tricastin",
  // DP2D (démantèlement) — à confirmer
  BRE: "Brennilis (DP2D)", BU1: "Bugey 1 (DP2D)", CHA: "Chinon A (DP2D)",
  CNA: "Chooz A (DP2D)", SLA: "Saint-Laurent A (DP2D)", CRE: "Creys-Malville (DP2D)",
  PHE: "Phénix (DP2D)",
};

export function siteFromIdCourt(idCourt: string | null | undefined): string | null {
  const m = (idCourt ?? "").match(/^([A-Za-z]+)/);
  if (!m) return null;
  return SITE_TRIGRAMME[m[1].toUpperCase()] ?? null;
}

// Décompose un code SCAN en {type d'identifiant, type_code, id_court}.
export function decompose(scan: string): { id_type: "gmo2" | "repere"; type_code: string | null; id_court: string } {
  const s = scan.trim();
  const i = s.indexOf("-");
  if (i > 0) return { id_type: "gmo2", type_code: s.slice(0, i), id_court: s.slice(i + 1) };
  return { id_type: "repere", type_code: null, id_court: s };
}

// --- parsing de l'Excel DÉDIÉ (celui produit par l'export) ------------------
// Feuille « Matériels » (colonnes par nom) + éventuelle feuille « Correspondance ».
export interface ParsedMateriels { materiels: Materiel[]; types: CorimType[]; feuilles: string[]; }

const normH = (s: string) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
function colIndex(header: string[], ...names: string[]): number {
  const H = header.map(normH);
  for (const n of names) { const i = H.indexOf(normH(n)); if (i >= 0) return i; }
  return -1;
}
const ETAT_FROM: Record<string, MaterielEtat> = {
  enplace: "en_place", magasin: "magasin", devis: "devis", reparation: "reparation", reforme: "reforme",
};
function parseEtat(v: string): MaterielEtat {
  return ETAT_FROM[v.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z]/g, "")] ?? "en_place";
}

function parseMatSheet(aoa: unknown[][]): Materiel[] {
  const header = (aoa[0] ?? []).map(clean);
  const cS = colIndex(header, "scan");
  if (cS < 0) return [];
  const cD = colIndex(header, "designation", "désignation");
  const cM = colIndex(header, "code model", "codemodel");
  const cN = colIndex(header, "s/n", "sn", "n° de série", "numero de serie");
  const cDom = colIndex(header, "domaine");
  const cSite = colIndex(header, "site");
  const cLoc = colIndex(header, "localisation");
  const cE = colIndex(header, "état", "etat");
  const at = (r: unknown[], c: number) => (c >= 0 ? clean(r[c]) : "");
  const now = new Date().toISOString();
  const out: Materiel[] = [];
  for (let i = 1; i < aoa.length; i++) {
    const r = aoa[i] ?? [];
    const scan = at(r, cS);
    if (!scan) continue;
    const d = decompose(scan);
    const site = at(r, cSite);
    out.push({
      scan, id_type: d.id_type, type_code: d.type_code, id_court: d.id_court,
      designation: nn(at(r, cD)), code_model: nn(at(r, cM)), sn: nn(at(r, cN)),
      domaine: nn(at(r, cDom)), site: site || siteFromIdCourt(d.id_court),
      localisation: nn(at(r, cLoc)), etat: cE >= 0 ? parseEtat(at(r, cE)) : "en_place",
      updated_at: now, deleted: false,
    });
  }
  return out;
}

function parseCorimSheet(aoa: unknown[][]): CorimType[] {
  const header = (aoa[0] ?? []).map(clean);
  const cT = colIndex(header, "type_code", "type code", "scan");
  if (cT < 0) return [];
  const cD = colIndex(header, "designation", "désignation", "libellé corim", "libelle corim");
  const cA = colIndex(header, "type appareil", "typeappareil");
  const at = (r: unknown[], c: number) => (c >= 0 ? clean(r[c]) : "");
  const now = new Date().toISOString();
  const out: CorimType[] = [];
  for (let i = 1; i < aoa.length; i++) {
    const r = aoa[i] ?? [];
    const tc = at(r, cT);
    if (!tc) continue;
    out.push({ type_code: tc, designation: nn(at(r, cD)), type_appareil: nn(at(r, cA)), updated_at: now, deleted: false });
  }
  return out;
}

export async function parseMaterielsXlsx(file: File): Promise<ParsedMateriels> {
  const XLSX = await import("xlsx");
  const wb = XLSX.read(new Uint8Array(await file.arrayBuffer()), { type: "array" });
  let materiels: Materiel[] = [];
  let types: CorimType[] = [];
  const feuilles: string[] = [];
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    if (!ws) continue;
    const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: false, defval: "" });
    if (!aoa.length) continue;
    const header = (aoa[0] ?? []).map((c) => normH(clean(c)));
    const n = name.toLowerCase();
    if (n.includes("correspondance") || header.includes("typeappareil") || header.includes("typecode")) {
      const t = parseCorimSheet(aoa); if (t.length) { types = t; feuilles.push(name); }
    } else if (header.includes("scan")) {
      const m = parseMatSheet(aoa); if (m.length) { materiels = m; feuilles.push(name); }
    }
  }
  return { materiels, types, feuilles };
}

// --- import (la feuille fait foi : état/localisation lus depuis le fichier) --
export interface ImportMaterielsResult { materiels: number; types: number; feuilles: string[]; }

export async function importMateriels(file: File): Promise<ImportMaterielsResult> {
  if (!isOnline()) throw new Error("Connexion requise pour importer la base matériels.");
  const { materiels, types, feuilles } = await parseMaterielsXlsx(file);
  if (materiels.length === 0 && types.length === 0)
    throw new Error("Aucune donnée trouvée. Utilise l'Excel dédié (feuille « Matériels », colonne SCAN).");

  const seenM = new Map<string, Materiel>();
  for (const m of materiels) seenM.set(m.scan, m);
  const seenT = new Map<string, CorimType>();
  for (const t of types) seenT.set(t.type_code, t);

  const upsert = async <T>(table: string, rows: T[], onConflict: string) => {
    const CH = 500;
    for (let i = 0; i < rows.length; i += CH) {
      const { error } = await supabase.from(table).upsert(rows.slice(i, i + CH) as object[], { onConflict });
      if (error) throw new Error("Base à mettre à jour (schema.sql) ? " + error.message);
    }
  };
  if (seenT.size) await upsert("corim_types", [...seenT.values()], "type_code");
  if (seenM.size) await upsert("materiels", [...seenM.values()], "scan");
  await syncAll();
  return { materiels: seenM.size, types: seenT.size, feuilles };
}

// --- lectures + filtres -----------------------------------------------------
export async function allMateriels(): Promise<Materiel[]> {
  const rows = await db.materiels.toArray();
  return rows.filter((r) => !r.deleted).sort((a, b) => a.scan.localeCompare(b.scan));
}
export async function allCorimTypes(): Promise<CorimType[]> {
  const rows = await db.corim_types.toArray();
  return rows.filter((r) => !r.deleted);
}
export function corimByTypeCode(types: CorimType[], typeCode: string | null | undefined): CorimType | null {
  if (!typeCode) return null;
  return types.find((t) => t.type_code === typeCode) ?? null;
}

const uniqSorted = (vals: (string | null)[]) => [...new Set(vals.filter((v): v is string => !!v))].sort((a, b) => a.localeCompare(b, "fr"));
export const domainesInDb = (ms: Materiel[]) => uniqSorted(ms.map((m) => m.domaine));
export const sitesInDb = (ms: Materiel[]) => uniqSorted(ms.map((m) => m.site));
export const designationsInDb = (ms: Materiel[]) => uniqSorted(ms.map((m) => m.designation));

export interface MaterielFilter { q?: string; domaine?: string | null; site?: string | null; designation?: string | null; id_type?: string | null; etat?: string | null; }
export function filterMateriels(ms: Materiel[], f: MaterielFilter): Materiel[] {
  const q = (f.q ?? "").trim().toLowerCase();
  return ms.filter((m) => {
    if (f.domaine && m.domaine !== f.domaine) return false;
    if (f.site && m.site !== f.site) return false;
    if (f.designation && m.designation !== f.designation) return false;
    if (f.id_type && m.id_type !== f.id_type) return false;
    if (f.etat && m.etat !== f.etat) return false;
    if (q) {
      const hay = [m.scan, m.id_court, m.sn, m.designation, m.code_model].filter(Boolean).join(" ").toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

// --- export Excel (de la sélection filtrée) ---------------------------------
export async function exportMaterielsXlsx(ms: Materiel[]): Promise<void> {
  const XLSX = await import("xlsx");
  const ETAT: Record<string, string> = { en_place: "En place", magasin: "Magasin", devis: "Devis", reparation: "Réparation", reforme: "Réforme" };
  const header = ["SCAN", "Type ID", "Désignation", "Code Model", "S/N", "Domaine", "Site", "Localisation", "État"];
  const rows = ms.map((m) => [
    m.scan, m.id_type === "gmo2" ? "GMO²" : "Repère", m.designation ?? "", m.code_model ?? "",
    m.sn ?? "", m.domaine ?? "", m.site ?? "", m.localisation ?? "", ETAT[m.etat] ?? m.etat,
  ]);
  const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Matériels");
  const out = XLSX.write(wb, { type: "array", bookType: "xlsx" });
  const blob = new Blob([out as unknown as BlobPart], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `materiels_${new Date().toISOString().slice(0, 10)}.xlsx`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
