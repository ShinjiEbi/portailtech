// Exports Excel du planning — remplissage des modèles officiels Bertin/EDF.
//
// Approche « patch chirurgical » (portée du standalone) : on n'édite QUE les
// cellules ciblées dans le XML de la feuille ; toutes les autres entrées du
// classeur (styles, macros VBA, zones d'impression, images…) sont recopiées
// octet pour octet. La mise en forme du modèle et les macros restent intactes,
// ce que SheetJS ne garantit pas à la réécriture. Validé en Node sur les vrais
// modèles (styles.xml et vbaProject.bin identiques au bit près).
//
// Les modèles sont servis depuis public/templates/ (précachés par le PWA pour
// l'usage hors-ligne — voir globPatterns dans vite.config.ts).
import {
  PLANNING_TRAVAIL, type PlanningJour, type PlanningParams,
} from "./types";

const MIME_XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const MIME_XLSM = "application/vnd.ms-excel.sheet.macroEnabled.12";
const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const pad = (n: number) => String(n).padStart(2, "0");
const iso = (y: number, m0: number, d: number) => `${y}-${pad(m0 + 1)}-${pad(d)}`;
const isWorked = (t: PlanningJour["type"]) => (PLANNING_TRAVAIL as readonly string[]).includes(t);

/* ============================ ZipX (patch zip) ============================ */
type CellVal = { n: number } | { s: string } | null;
interface ZEntry {
  name: string; method: number; time: number; date: number; crc: number;
  csize: number; usize: number; data: Uint8Array; mod: string | null; del: boolean;
}

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return (u8: Uint8Array) => { let c = 0xFFFFFFFF; for (let i = 0; i < u8.length; i++) c = t[(c ^ u8[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
})();
const ENC = new TextEncoder(), DEC = new TextDecoder();
// lib.dom récent type Uint8Array en Uint8Array<ArrayBufferLike>, refusé tel quel
// comme BlobPart (cas SharedArrayBuffer). On ne manipule jamais de mémoire
// partagée ici → le cast est sûr à l'exécution, et valable sur toute version de TS.
const part = (u8: Uint8Array): BlobPart => u8 as unknown as BlobPart;
async function pipe(u8: Uint8Array, Ctor: typeof CompressionStream | typeof DecompressionStream, kind: string): Promise<Uint8Array> {
  const st = new (Ctor as new (k: string) => GenericTransformStream)(kind);
  const r = new Response(new Blob([part(u8)]).stream().pipeThrough(st));
  return new Uint8Array(await r.arrayBuffer());
}
const inflate = (u8: Uint8Array) => pipe(u8, DecompressionStream, "deflate-raw");
const deflate = (u8: Uint8Array) => pipe(u8, CompressionStream, "deflate-raw");

function openZip(buf: Uint8Array) {
  if (typeof DecompressionStream !== "function") throw new Error("Navigateur trop ancien (DecompressionStream requis).");
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let e = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65558); i--) { if (dv.getUint32(i, true) === 0x06054b50) { e = i; break; } }
  if (e < 0) throw new Error("Classeur illisible (zip invalide).");
  const n = dv.getUint16(e + 10, true); let p = dv.getUint32(e + 16, true);
  const entries: ZEntry[] = [];
  for (let i = 0; i < n; i++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error("Classeur corrompu (central directory).");
    const method = dv.getUint16(p + 10, true), time = dv.getUint16(p + 12, true), date = dv.getUint16(p + 14, true),
      crc = dv.getUint32(p + 16, true), csize = dv.getUint32(p + 20, true), usize = dv.getUint32(p + 24, true),
      nl = dv.getUint16(p + 28, true), el = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true),
      lo = dv.getUint32(p + 42, true), name = DEC.decode(buf.subarray(p + 46, p + 46 + nl));
    const lnl = dv.getUint16(lo + 26, true), lel = dv.getUint16(lo + 28, true), doff = lo + 30 + lnl + lel;
    entries.push({ name, method, time, date, crc, csize, usize, data: buf.subarray(doff, doff + csize), mod: null, del: false });
    p += 46 + nl + el + cl;
  }
  const find = (name: string) => { const x = entries.find((t) => t.name === name && !t.del); if (!x) throw new Error("Entrée absente du modèle : " + name); return x; };
  const cache: Record<string, string> = {};
  return {
    has: (name: string) => entries.some((t) => t.name === name && !t.del),
    async text(name: string) { const x = find(name); if (x.mod != null) return x.mod; if (!(name in cache)) cache[name] = DEC.decode(x.method === 8 ? await inflate(x.data) : x.data); return cache[name]; },
    replace(name: string, str: string) { find(name).mod = str; },
    remove(name: string) { find(name).del = true; },
    async build(): Promise<Uint8Array> {
      const parts: Uint8Array[] = [], cd: Uint8Array[] = []; let off = 0;
      for (const t of entries) {
        if (t.del) continue;
        let method = t.method, crc = t.crc, csize = t.csize, usize = t.usize, data = t.data;
        if (t.mod != null) { const raw = ENC.encode(t.mod); crc = CRC(raw); usize = raw.length; data = await deflate(raw); method = 8; csize = data.length; }
        const nm = ENC.encode(t.name);
        const lh = new Uint8Array(30 + nm.length), lv = new DataView(lh.buffer);
        lv.setUint32(0, 0x04034b50, true); lv.setUint16(4, 20, true); lv.setUint16(6, 0, true); lv.setUint16(8, method, true);
        lv.setUint16(10, t.time, true); lv.setUint16(12, t.date, true); lv.setUint32(14, crc, true);
        lv.setUint32(18, csize, true); lv.setUint32(22, usize, true); lv.setUint16(26, nm.length, true); lv.setUint16(28, 0, true);
        lh.set(nm, 30); parts.push(lh, data);
        const ch = new Uint8Array(46 + nm.length), cv = new DataView(ch.buffer);
        cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true); cv.setUint16(8, 0, true); cv.setUint16(10, method, true);
        cv.setUint16(12, t.time, true); cv.setUint16(14, t.date, true); cv.setUint32(16, crc, true);
        cv.setUint32(20, csize, true); cv.setUint32(24, usize, true); cv.setUint16(28, nm.length, true);
        cv.setUint32(42, off, true); ch.set(nm, 46); cd.push(ch);
        off += lh.length + data.length;
      }
      let cdLen = 0; cd.forEach((c) => (cdLen += c.length));
      const eo = new Uint8Array(22), ev = new DataView(eo.buffer);
      ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, cd.length, true); ev.setUint16(10, cd.length, true);
      ev.setUint32(12, cdLen, true); ev.setUint32(16, off, true);
      const total = off + cdLen + 22, out = new Uint8Array(total); let q = 0;
      for (const b of parts) { out.set(b, q); q += b.length; } for (const c of cd) { out.set(c, q); q += c.length; } out.set(eo, q);
      return out;
    },
  };
}
type Zip = ReturnType<typeof openZip>;

const xesc = (s: string) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const colNum = (c: string) => { let n = 0; for (const ch of c) n = n * 26 + (ch.charCodeAt(0) - 64); return n; };
/* Édite (ou insère, ou vide en gardant le style) une cellule dans le XML feuille. */
function setCell(xml: string, ref: string, val: CellVal): string {
  const mk = (attrs: string) => {
    if (val == null) return `<c r="${ref}"${attrs}/>`;
    if ("n" in val) return `<c r="${ref}"${attrs}><v>${val.n}</v></c>`;
    const t = String(val.s), sp = /^\s|\s$/.test(t) ? ' xml:space="preserve"' : "";
    return `<c r="${ref}"${attrs} t="inlineStr"><is><t${sp}>${xesc(t)}</t></is></c>`;
  };
  const re = new RegExp(`<c r="${ref}"([^>]*?)(/>|>[\\s\\S]*?</c>)`);
  const m = xml.match(re);
  if (m) return xml.replace(re, mk(m[1].replace(/\s+t="[^"]*"/, "")));
  if (val == null) return xml;
  const row = ref.match(/\d+$/)![0], cn = colNum(ref.match(/^[A-Z]+/)![0]);
  const rowRe = new RegExp(`(<row r="${row}"[^>]*>)([\\s\\S]*?)(</row>)`);
  const rm = xml.match(rowRe);
  if (!rm) throw new Error("Ligne " + row + " absente du modèle.");
  let cells = rm[2], at = cells.length;
  const cre = /<c r="([A-Z]+)\d+"[^>]*?(?:\/>|>[\s\S]*?<\/c>)/g; let mm: RegExpExecArray | null;
  while ((mm = cre.exec(cells))) if (colNum(mm[1]) > cn) { at = mm.index; break; }
  return xml.replace(rowRe, rm[1] + cells.slice(0, at) + mk("") + cells.slice(at) + rm[3]);
}
async function sheetPath(z: Zip, name: string): Promise<string> {
  const wb = await z.text("xl/workbook.xml");
  const m = wb.match(new RegExp(`<sheet[^>]*name="${name}"[^>]*r:id="(rId\\d+)"`)) || wb.match(new RegExp(`<sheet[^>]*r:id="(rId\\d+)"[^>]*name="${name}"`));
  if (!m) throw new Error("Feuille introuvable : " + name);
  const rels = await z.text("xl/_rels/workbook.xml.rels");
  const r = rels.match(new RegExp(`<Relationship[^>]*Id="${m[1]}"[^>]*Target="([^"]+)"`)) || rels.match(new RegExp(`<Relationship[^>]*Target="([^"]+)"[^>]*Id="${m[1]}"`));
  if (!r) throw new Error("Relation introuvable : " + m[1]);
  return "xl/" + r[1].replace(/^\//, "").replace(/^xl\//, "");
}
/* Purge le cache d'ordre de calcul + force le recalcul à l'ouverture
   (nos valeurs écrasent des cellules dont dépendent les formules du modèle). */
async function freshCalc(z: Zip): Promise<void> {
  if (z.has("xl/calcChain.xml")) {
    z.remove("xl/calcChain.xml");
    z.replace("[Content_Types].xml", (await z.text("[Content_Types].xml")).replace(/<Override[^>]*calcChain\.xml[^>]*\/>/, ""));
    z.replace("xl/_rels/workbook.xml.rels", (await z.text("xl/_rels/workbook.xml.rels")).replace(/<Relationship[^>]*calcChain\.xml[^>]*\/>/, ""));
  }
  let wb = await z.text("xl/workbook.xml");
  if (!/fullCalcOnLoad/.test(wb)) {
    wb = /<calcPr/.test(wb) ? wb.replace(/<calcPr/, '<calcPr fullCalcOnLoad="1"') : wb.replace(/<\/sheets>/, '</sheets><calcPr fullCalcOnLoad="1"/>');
    z.replace("xl/workbook.xml", wb);
  }
}

/* ===================== mappings métier (= standalone) ===================== */
const SITE_KEY: Record<string, string> = {
  "CNPE Belleville": "BELLEVILLE", "CNPE Blayais": "BLAYAIS", "CNPE Bugey": "BUGEY", "CNPE Cattenom": "CATTENOM", "CNPE Chinon": "CHINON",
  "CNPE Chooz": "CHOOZ", "CNPE Civaux": "CIVAUX", "CNPE Cruas": "CRUAS", "CNPE Dampierre": "DAMPIERRE", "CNPE Flamanville": "FLAMANVILLE",
  "CNPE Golfech": "GOLFECH", "CNPE Gravelines": "GRAVELINES", "CNPE Nogent": "NOGENT", "CNPE Paluel": "PALUEL", "CNPE Penly": "PENLY",
  "CNPE Saint-Alban": "ST ALBAN", "CNPE Saint-Laurent": "ST LAURENT B", "CNPE Tricastin": "TRICASTIN", "DP2D Bugey 1": "BUGEY",
  "DP2D Chinon A": "CHINON", "DP2D Chooz A": "CHOOZ", "DP2D Creys-Malville": "CREYS", "DP2D Fessenheim": "FESSENHEIM", "DP2D Saint-Laurent A": "ST LAURENT A",
};
const CPREF: Record<string, string> = { RPM: "RP", KZC: "KZC", KRS: "KRS", "Assistance hebdo": "RP", Autre: "" };
function dosiLabel(c: string, s: string): string {
  if (s === "Bertin / Aix") return "BERTIN";
  if (s === "Télétravail") return "Télétravail";
  if (!s || s === "Autre") return "Autre (préciser dans Observations)";
  const k = SITE_KEY[s]; if (!k) return "Autre (préciser dans Observations)";
  const p = CPREF[c] !== undefined ? CPREF[c] : "RP";
  return (p ? p + " " : "") + k;
}
const FMAP: Record<string, string> = { "Travaillé": "", "Déplacement": "", "RTT": "RTT", "Congé payé": "CP", "Férié": "Jour Férié", "Récup": "Autre congé", "Maladie": "Autre congé" };
const dateSerial = (y: number, m: number, d: number) => Math.round((Date.UTC(y, m, d) - Date.UTC(1899, 11, 30)) / 86400000);
const toMin = (t: string | null | undefined) => { const p = (t || "").split(":"); return p.length >= 2 ? +p[0] * 60 + +p[1] : null; };
const tf = (mins: number) => mins / 1440;
function splitB(deb: string | null | undefined, fin: string | null | undefined, pause: number | null | undefined) {
  const d = toMin(deb), f = toMin(fin); if (d == null || f == null) return null;
  const p = Math.max(0, pause || 0), piv = 720;
  if (p <= 0) return { amD: d, amF: f, pmD: null as number | null, pmF: null as number | null };
  if (d < piv && f > piv + p) return { amD: d, amF: piv, pmD: piv + p, pmF: f };
  if (f - d <= p) return { amD: d, amF: f, pmD: null as number | null, pmF: null as number | null };
  const mid = Math.round((d + f) / 2), h = Math.floor(p / 2);
  return { amD: d, amF: mid - h, pmD: mid - h + p, pmF: f };
}
export function isoWeek(d: Date): number {
  const dt = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = (dt.getUTCDay() + 6) % 7; dt.setUTCDate(dt.getUTCDate() - day + 3);
  const f = new Date(Date.UTC(dt.getUTCFullYear(), 0, 4));
  return 1 + Math.round(((dt.getTime() - f.getTime()) / 86400000 - 3 + ((f.getUTCDay() + 6) % 7)) / 7);
}

/* ============================ E/S fichiers ============================ */
async function loadTemplate(name: string): Promise<Uint8Array> {
  const url = `${import.meta.env.BASE_URL}templates/${name}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Modèle introuvable : ${name} (${res.status}). Vérifie public/templates/.`);
  return new Uint8Array(await res.arrayBuffer());
}
async function saveBlob(blob: Blob, filename: string): Promise<void> {
  const nav = navigator as Navigator & { canShare?: (d: unknown) => boolean };
  try {
    const file = new File([blob], filename, { type: blob.type });
    if (typeof nav.canShare === "function" && nav.canShare({ files: [file] }) && nav.share) {
      await nav.share({ files: [file], title: filename });
      return;
    }
  } catch { /* partage annulé ou indisponible → téléchargement classique */ }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

/* ============================ Exports publics ============================ */

// Relevé dosimétrique mensuel (modèle .xlsx, feuille "Sheet1").
export async function exportDosi(
  jours: PlanningJour[], params: PlanningParams, year: number, month0: number
): Promise<void> {
  const nom = params.nom || "BEROUD-BLANC";
  const prenom = params.prenom || "Romain";
  const dosi = params.dosi || "";
  const z = openZip(await loadTemplate("releve_dosi.xlsx"));
  const path = await sheetPath(z, "Sheet1");
  let x = await z.text(path);
  // C2 (libellé du mois) et B39 (total dose) restent des formules : recalculées via B2/B3.
  x = setCell(x, "B2", { n: month0 + 1 });
  x = setCell(x, "B3", { n: year });
  x = setCell(x, "B4", { s: nom });
  x = setCell(x, "B5", { s: prenom });
  if (dosi) x = setCell(x, "B6", /^\d+$/.test(dosi) ? { n: +dosi } : { s: dosi });
  for (let r = 8; r <= 38; r++) for (const c of ["B", "C", "D"]) x = setCell(x, c + r, null);
  const byDate: Record<string, PlanningJour> = {};
  for (const j of jours) if (!j.deleted) byDate[j.date] = j;
  const nd = new Date(year, month0 + 1, 0).getDate();
  for (let d = 1; d <= nd; d++) {
    const j = byDate[iso(year, month0, d)];
    if (!j || !isWorked(j.type) || !j.site) continue;
    const r = 7 + d;
    x = setCell(x, "C" + r, { s: dosiLabel(j.contrat || "", j.site) });
    if (j.commentaire) x = setCell(x, "D" + r, { s: j.commentaire });
    if (j.dose != null) x = setCell(x, "B" + r, { n: +j.dose });
  }
  z.replace(path, x);
  await freshCalc(z);
  await saveBlob(new Blob([part(await z.build())], { type: MIME_XLSX }), `Dosimetrie_${cap(MOIS[month0])}_${year}.xlsx`);
}

// Feuille de temps hebdomadaire (modèle .xlsm avec macros, feuille "FT-TIS").
// `monday` = lundi de la semaine voulue.
export async function exportFeuilleTemps(
  jours: PlanningJour[], params: PlanningParams, monday: Date
): Promise<void> {
  const Y = monday.getFullYear(), M = monday.getMonth(), D = monday.getDate();
  const nom = params.nom || "BEROUD-BLANC";
  const sup = params.sup || "MCAPELA";
  const z = openZip(await loadTemplate("feuille_temps.xlsm"));
  const path = await sheetPath(z, "FT-TIS");
  let x = await z.text(path);
  for (let r = 7; r <= 13; r++) for (const C of ["F", "H", "J", "L", "N", "W"]) x = setCell(x, C + r, null);
  for (let r = 21; r <= 27; r++) for (const C of ["H", "J", "L", "N", "W"]) x = setCell(x, C + r, null);
  x = setCell(x, "H3", { n: dateSerial(Y, M, D) }); // format date du modèle conservé
  x = setCell(x, "AA38", { s: nom });
  x = setCell(x, "AK38", { s: sup });
  const byDate: Record<string, PlanningJour> = {};
  for (const j of jours) if (!j.deleted) byDate[j.date] = j;
  for (let i = 0; i < 7; i++) {
    const dt = new Date(Y, M, D + i);
    const j = byDate[iso(dt.getFullYear(), dt.getMonth(), dt.getDate())];
    if (!j) continue;
    const row = 7 + i;
    const fl = FMAP[j.type];
    if (fl) x = setCell(x, "F" + row, { s: fl });
    if (!isWorked(j.type)) continue;
    const sp = splitB(j.debut, j.fin, j.pause);
    if (sp) {
      x = setCell(x, "H" + row, { n: tf(sp.amD) });
      x = setCell(x, "J" + row, { n: tf(sp.amF) });
      if (sp.pmD != null && sp.pmF != null) {
        x = setCell(x, "L" + row, { n: tf(sp.pmD) });
        x = setCell(x, "N" + row, { n: tf(sp.pmF) });
      }
      const short = j.site ? j.site.replace("CNPE ", "").replace("DP2D ", "DP2D ") : "";
      const com = j.commentaire || ((j.contrat || "") + (short ? " " + short : ""));
      if (com) x = setCell(x, "W" + row, { s: com });
    }
    if (j.trajet) {
      const tr = row + 14;
      const tt = (v: string | null | undefined) => { const mn = toMin(v); return mn == null ? null : mn / 1440; };
      const ad = tt(j.t_ad), af = tt(j.t_af), rd = tt(j.t_rd), rf = tt(j.t_rf);
      if (ad != null) x = setCell(x, "H" + tr, { n: ad });
      if (af != null) x = setCell(x, "J" + tr, { n: af });
      if (rd != null) x = setCell(x, "L" + tr, { n: rd });
      if (rf != null) x = setCell(x, "N" + tr, { n: rf });
      if (j.site) x = setCell(x, "W" + tr, { s: "Argis - " + j.site.replace("CNPE ", "").replace("DP2D ", "DP2D ") });
    }
  }
  z.replace(path, x);
  await freshCalc(z);
  await saveBlob(new Blob([part(await z.build())], { type: MIME_XLSM }), `FeuilleTemps_S${isoWeek(monday)}_${Y}.xlsm`);
}
