// Import / export Excel des étalons.
// Chargé à la demande (chunk séparé) : SheetJS n'alourdit pas le bundle initial,
// mais le chunk est précaché par le service worker -> l'import/export marche aussi
// hors-ligne dès qu'on l'a utilisé une fois en ligne.
import * as XLSX from "xlsx";
import type { Etalon, EtalonModele, EtalonStatut, ChampLibre, Local } from "./types";
import { ETALON_STATUTS } from "./types";

const STATUT_LABEL: Record<EtalonStatut, string> = {
  en_service: "en service",
  etalonnage: "étalonnage",
  hs: "HS",
  reforme: "réformé",
};

function statutFromCell(v: unknown): EtalonStatut {
  const s = String(v ?? "").trim().toLowerCase();
  for (const code of ETALON_STATUTS) {
    if (s === code || s === STATUT_LABEL[code].toLowerCase()) return code;
  }
  return "en_service";
}

// Colonnes fixes (en-têtes du fichier).
const C_ID = "id";
const C_MOD = "Modèle";
const C_DES = "Désignation";
const C_NS = "N° constructeur";
const C_NC = "N° client";
const C_ST = "Statut";
const C_DE = "Date étalonnage";
const C_EC = "Date échéance";
const C_CE = "Certificat (réf.)";
const C_CL = "Champs libres";
const FIXED = [C_ID, C_MOD, C_DES, C_NS, C_NC, C_ST, C_DE, C_EC, C_CE];

function pad2(n: number): string { return String(n).padStart(2, "0"); }
function ymdParts(y: number, m: number, d: number): string { return `${y}-${pad2(m)}-${pad2(d)}`; }

// Date JS (issue de cellDates) : SheetJS la construit à minuit LOCAL -> on lit
// les composantes locales (cohérent quel que soit le fuseau du lecteur).
function dateToYMD(d: Date): string { return ymdParts(d.getFullYear(), d.getMonth() + 1, d.getDate()); }

// Serial Excel -> AAAA-MM-JJ, en UTC (indépendant du fuseau). 25569 = nombre de
// jours entre l'origine Excel (1899-12-30) et 1970-01-01. Le +1e-6 absorbe le
// bruit de calcul des serials (ex. 45366.0002).
function excelSerialToYMD(serial: number): string {
  const days = Math.floor(serial - 25569 + 1e-6);
  const d = new Date(days * 86400000);
  return ymdParts(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

// AAAA-MM-JJ -> serial Excel (UTC), pour écrire de VRAIES cellules date.
function ymdToSerial(s: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim());
  if (!m) return null;
  return Math.round(Date.UTC(+m[1], +m[2] - 1, +m[3]) / 86400000) + 25569;
}

// Texte -> AAAA-MM-JJ. Gère l'ISO, le format FR « JJ/MM/AAAA » (par défaut) et
// l'US « MM/JJ/AAAA » (détecté quand le 1er nombre <= 12 et le 2e > 12).
// Séparateurs / . - acceptés, années sur 2 chiffres gérées.
function strToYMD(s: string): string | null {
  const t = s.trim();
  if (!t) return null;
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(t);            // ISO AAAA-MM-JJ
  if (m) return ymdParts(+m[1], +m[2], +m[3]);
  m = /^(\d{4})[/.](\d{1,2})[/.](\d{1,2})$/.exec(t);         // AAAA/MM/JJ
  if (m) return ymdParts(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})$/.exec(t);   // JJ/MM/AAAA (ou US)
  if (m) {
    let d = +m[1], mo = +m[2], y = +m[3];
    if (y < 100) y += y >= 70 ? 1900 : 2000;
    if (mo > 12 && d <= 12) { const tmp = d; d = mo; mo = tmp; } // format US MM/JJ
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    return ymdParts(y, mo, d);
  }
  return null; // illisible : on renvoie null plutôt qu'un texte ambigu
}

function toYMD(v: unknown): string | null {
  if (v == null || v === "") return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : dateToYMD(v);
  if (typeof v === "number") return Number.isFinite(v) ? excelSerialToYMD(v) : null;
  return strToYMD(String(v));
}
function boolFromCell(v: unknown): boolean {
  const s = String(v ?? "").trim().toLowerCase();
  return ["oui", "yes", "true", "vrai", "1", "x", "✓"].includes(s);
}

function champsLibresToStr(cl: ChampLibre[]): string {
  return (cl ?? []).map((c) => `${c.libelle}=${c.valeur}`).join(" | ");
}
function champsLibresFromStr(s: unknown): ChampLibre[] {
  const str = String(s ?? "").trim();
  if (!str) return [];
  return str
    .split("|")
    .map((p) => {
      const i = p.indexOf("=");
      return i < 0
        ? { libelle: p.trim(), valeur: "" }
        : { libelle: p.slice(0, i).trim(), valeur: p.slice(i + 1).trim() };
    })
    .filter((c) => c.libelle);
}

function formatCell(v: unknown, type: string): string | number {
  if (v == null || v === "") return "";
  if (type === "booleen") return v ? "Oui" : "Non";
  if (type === "nombre" || type === "activite_ref" || type === "flux") {
    const n = Number(v);
    return Number.isFinite(n) ? n : "";
  }
  return String(v);
}
function coerce(cell: unknown, type: string): unknown {
  if (type === "booleen") return boolFromCell(cell);
  if (type === "nombre" || type === "activite_ref" || type === "flux") {
    const n = Number(cell);
    return Number.isFinite(n) ? n : undefined;
  }
  if (type === "date" || type === "date_ref") return toYMD(cell);
  return String(cell).trim();
}

// ---- EXPORT ---------------------------------------------------------------
export async function exportEtalonsXlsx(
  etalons: Local<Etalon>[],
  modeles: Local<EtalonModele>[]
): Promise<Blob> {
  const modById = new Map(modeles.map((m) => [m.id, m]));

  // Colonnes dynamiques = union des libellés de champs (ordre modèle puis champ).
  const champCols: string[] = [];
  const seen = new Set<string>();
  for (const m of [...modeles].sort((a, b) => a.ordre - b.ordre)) {
    for (const c of m.champs ?? []) {
      if (!seen.has(c.libelle)) {
        seen.add(c.libelle);
        champCols.push(c.libelle);
      }
    }
  }
  const headers = [...FIXED, ...champCols, C_CL];
  const rows: (string | number)[][] = [headers];

  for (const e of etalons) {
    const mod = e.modele_id ? modById.get(e.modele_id) : undefined;
    const champByLib = new Map((mod?.champs ?? []).map((c) => [c.libelle, c]));
    const row: (string | number)[] = [
      e.id,
      e.modele_nom,
      e.designation,
      e.num_serie ?? "",
      e.num_client ?? "",
      STATUT_LABEL[e.statut] ?? e.statut,
      e.date_etalonnage ?? "",
      e.date_echeance ?? "",
      e.certificat_ref ?? "",
    ];
    for (const lib of champCols) {
      const champ = champByLib.get(lib);
      row.push(champ ? formatCell(e.valeurs?.[champ.cle], champ.type) : "");
    }
    row.push(champsLibresToStr(e.champs_libres));
    rows.push(row);
  }

  const ws = XLSX.utils.aoa_to_sheet(rows);

  // Colonnes de dates -> VRAIES cellules date Excel (affichage + tri corrects,
  // et aller-retour déterministe à la réimportation).
  const dateCols = new Set<number>([FIXED.indexOf(C_DE), FIXED.indexOf(C_EC)]);
  champCols.forEach((lib, i) => {
    const isDate = modeles.some((m) => (m.champs ?? []).some((c) => c.libelle === lib && (c.type === "date" || c.type === "date_ref")));
    if (isDate) dateCols.add(FIXED.length + i);
  });
  for (let r = 1; r < rows.length; r++) {
    for (const c of dateCols) {
      const ref = XLSX.utils.encode_cell({ r, c });
      const cell = ws[ref];
      if (!cell || cell.v === "" || cell.v == null) continue;
      const serial = ymdToSerial(String(cell.v));
      if (serial != null) ws[ref] = { t: "n", v: serial, z: "dd/mm/yyyy" };
    }
  }

  ws["!cols"] = headers.map((h) => ({ wch: Math.min(30, Math.max(10, h.length + 2)) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Étalons");
  const out = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  return new Blob([out], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

// ---- IMPORT ---------------------------------------------------------------
export interface ImportReport {
  drafts: Local<Etalon>[];
  created: number;
  updated: number;
  skipped: { ligne: number; raison: string }[];
}

export async function parseEtalonsXlsx(
  buf: ArrayBuffer,
  modeles: Local<EtalonModele>[],
  existing: Local<Etalon>[]
): Promise<ImportReport> {
  // NB : pas de cellDates. SheetJS construit des Date avec un décalage de fuseau
  // asymétrique (faux selon la zone). On lit donc les dates en serials/texte et
  // on les convertit nous-mêmes en UTC (toYMD) -> résultat identique quel que
  // soit le fuseau du téléphone.
  const wb = XLSX.read(buf, { type: "array" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) throw new Error("Aucune feuille trouvée");
  const aoa = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, blankrows: false, defval: "" });
  if (aoa.length < 2) throw new Error("Feuille vide (aucune donnée)");

  const headers = (aoa[0] as any[]).map((h) => String(h ?? "").trim());
  const idx = (name: string) => headers.findIndex((h) => h.toLowerCase() === name.toLowerCase());
  const cId = idx(C_ID),
    cMod = idx(C_MOD),
    cDes = idx(C_DES),
    cNs = idx(C_NS),
    cNc = idx(C_NC),
    cSt = idx(C_ST),
    cDe = idx(C_DE),
    cEc = idx(C_EC),
    cCe = idx(C_CE),
    cCl = idx(C_CL);
  if (cMod < 0) throw new Error(`Colonne « ${C_MOD} » introuvable`);
  const fixedIdx = new Set([cId, cMod, cDes, cNs, cNc, cSt, cDe, cEc, cCe, cCl]);

  const modByNom = new Map(modeles.map((m) => [m.nom.trim().toLowerCase(), m]));
  const byId = new Map(existing.map((e) => [e.id, e]));
  const report: ImportReport = { drafts: [], created: 0, updated: 0, skipped: [] };

  for (let r = 1; r < aoa.length; r++) {
    const row = aoa[r] as any[];
    const get = (c: number) => (c >= 0 && c < row.length ? row[c] : "");
    const modNom = String(get(cMod) ?? "").trim();
    if (!modNom) {
      report.skipped.push({ ligne: r + 1, raison: "modèle manquant" });
      continue;
    }
    const mod = modByNom.get(modNom.toLowerCase());
    if (!mod) {
      report.skipped.push({ ligne: r + 1, raison: `modèle « ${modNom} » inconnu` });
      continue;
    }

    const id = String(get(cId) ?? "").trim();
    const numSerie = String(get(cNs) ?? "").trim();

    let base: Local<Etalon> | undefined;
    let mode: "id" | "ns" | "new" = "new";
    if (id && byId.has(id)) {
      base = byId.get(id);
      mode = "id";
    } else if (numSerie) {
      const m = existing.find(
        (e) => !e.deleted && (e.num_serie ?? "").trim() === numSerie && e.modele_id === mod.id
      );
      if (m) {
        base = m;
        mode = "ns";
      }
    }

    const champByLib = new Map(mod.champs.map((c) => [c.libelle.toLowerCase(), c]));
    const valeurs: Record<string, unknown> = base ? { ...(base.valeurs ?? {}) } : {};
    for (let c = 0; c < headers.length; c++) {
      if (fixedIdx.has(c)) continue;
      const champ = champByLib.get(headers[c].toLowerCase());
      if (!champ) continue;
      const cell = get(c);
      if (cell === "" || cell == null) continue;
      const val = coerce(cell, champ.type);
      if (val !== undefined) valeurs[champ.cle] = val;
    }

    const draft: Local<Etalon> = {
      id: id || base?.id || crypto.randomUUID(),
      modele_id: mod.id,
      modele_nom: mod.nom,
      designation: String(get(cDes) ?? base?.designation ?? "").trim(),
      num_serie: numSerie || base?.num_serie || null,
      num_client: cNc >= 0 ? String(get(cNc) ?? "").trim() || null : base?.num_client ?? null,
      statut:
        cSt >= 0 && String(get(cSt) ?? "").trim()
          ? statutFromCell(get(cSt))
          : base?.statut ?? "en_service",
      date_etalonnage: cDe >= 0 ? toYMD(get(cDe)) ?? base?.date_etalonnage ?? null : base?.date_etalonnage ?? null,
      date_echeance: cEc >= 0 ? toYMD(get(cEc)) ?? base?.date_echeance ?? null : base?.date_echeance ?? null,
      certificat_ref: cCe >= 0 ? String(get(cCe) ?? "").trim() || null : base?.certificat_ref ?? null,
      certificat_path: base?.certificat_path ?? null,
      certificat_nom: base?.certificat_nom ?? null,
      valeurs,
      champs_libres:
        cCl >= 0 && String(get(cCl) ?? "").trim()
          ? champsLibresFromStr(get(cCl))
          : base?.champs_libres ?? [],
      updated_at: new Date().toISOString(),
      deleted: false,
    };
    report.drafts.push(draft);
    if (mode === "new") report.created++;
    else report.updated++;
  }
  return report;
}

// ---- Téléchargement / partage --------------------------------------------
export async function saveBlob(blob: Blob, filename: string): Promise<void> {
  const navAny = navigator as any;
  try {
    const file = new File([blob], filename, { type: blob.type });
    if (navAny.canShare && navAny.canShare({ files: [file] })) {
      await navAny.share({ files: [file], title: filename });
      return;
    }
  } catch {
    /* partage annulé / indisponible -> on télécharge */
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
