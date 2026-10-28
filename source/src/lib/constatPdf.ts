// Export PDF d'un constat : on charge le PDF d'origine et on dessine les valeurs
// par-dessus (texte Helvetica + croix dans les cases). Mise en page strictement identique.
import { PDFDocument, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import type { Constat, LignePhoto } from "./types";
import { modeleById, type TplOpt } from "./constats";

const INK = rgb(0.05, 0.1, 0.45); // bleu « stylo » pour distinguer la saisie

// Police embarquée : Liberation Sans (métrique Arial, comme le modèle Word) avec grec,
// symboles mathématiques (≤ ≥ ± µ π → ² …). « ? » seulement pour un caractère absent.
const SUBST: Record<string, string> = { "\u202f": " ", "\u2009": " " };
let charset: Set<number> | null = null;
function safe(font: PDFFont, s: string): string {
  if (!charset) charset = new Set(font.getCharacterSet());
  let out = "";
  for (const ch of s) {
    const c = SUBST[ch] ?? ch;
    out += [...c].every((x) => charset!.has(x.codePointAt(0)!)) ? c : "?";
  }
  return out;
}

export async function buildConstatPdf(c: Constat, baseUrl: string): Promise<Blob> {
  const modele = modeleById(c.template_id);
  if (!modele) throw new Error(`Modèle de constat inconnu : ${c.template_id}`);
  const t = modele.tpl;
  const bytes = await (await fetch(baseUrl + modele.pdf)).arrayBuffer();
  const pdf = await PDFDocument.load(bytes);
  pdf.registerFontkit(fontkit);
  const fontBytes = await (await fetch(baseUrl + "constats/LiberationSans.ttf")).arrayBuffer();
  const font = await pdf.embedFont(fontBytes, { subset: true });
  charset = null;
  const pages = pdf.getPages();
  const v = c.values;
  const str = (k: string) => { const x = v[k]; return typeof x === "string" ? x.trim() : ""; };

  const H = (p: PDFPage) => p.getHeight();
  // texte posé sur une ligne (y = haut du libellé d'origine)
  function text(pi: number, s: string, x: number, yTop: number, opts: { size?: number; w?: number; align?: string } = {}) {
    if (!s) return;
    const p = pages[pi]; if (!p) return;
    let size = opts.size ?? 8;
    const t2 = safe(font, s);
    if (opts.w) while (size > 4.5 && font.widthOfTextAtSize(t2, size) > opts.w) size -= 0.25;
    const w = font.widthOfTextAtSize(t2, size);
    const xx = opts.align === "center" ? x - w / 2 : x;
    p.drawText(t2, { x: xx, y: H(p) - yTop - size * 0.86, size, font, color: INK });
  }
  // texte centré verticalement dans une cellule
  function cell(pi: number, s: string, b: { x: number; w: number; y0: number; y1: number }, align: "left" | "center" = "center") {
    if (!s) return;
    const p = pages[pi]; if (!p) return;
    let size = 8;
    const t2 = safe(font, s);
    while (size > 4.5 && font.widthOfTextAtSize(t2, size) > b.w) size -= 0.25;
    const w = font.widthOfTextAtSize(t2, size);
    const x = align === "center" ? b.x + (b.w - w) / 2 : b.x + 1;
    p.drawText(t2, { x, y: H(p) - (b.y0 + b.y1) / 2 - size * 0.35, size, font, color: INK });
  }
  function cross(pi: number, o: TplOpt) {
    const p = pages[pi]; if (!p) return;
    const h = H(p), i = 1.1;
    const x0 = o.x + i, x1 = o.x + o.s - i, y0 = h - o.y - i, y1 = h - o.y - o.s + i;
    p.drawLine({ start: { x: x0, y: y0 }, end: { x: x1, y: y1 }, thickness: 1, color: INK });
    p.drawLine({ start: { x: x0, y: y1 }, end: { x: x1, y: y0 }, thickness: 1, color: INK });
  }

  // numéro sur chaque page
  for (const f of t.everyPage) text(f.page, str("numero"), f.x, f.y, { w: 86 });
  // en-tête
  for (const f of t.header) {
    const w = f.align === "center" ? 70 : 82;
    text(f.page, str(f.id), f.x, f.y, { align: f.align, w });
  }
  // états
  for (const e of t.etats) {
    const val = v[`etat.${e.group}`];
    if (Array.isArray(val) ? val.includes(e.label) : val === e.label) cross(e.page, e);
  }
  // sources
  for (const s of t.sources) {
    const numW = (s.num as { w?: number }).w ?? 150;
    text(s.page, str(`src.${s.id}.num`), s.num.x, s.num.y, { w: numW });
    if (s.act) text(s.page, str(`src.${s.id}.act`), s.act.x, s.act.y, { w: 575 - s.act.x });
  }
  // signature (PNG dessiné au doigt) dans une zone, proportions conservées
  async function sign(pi: number, dataUrl: string, x: number, yTop: number, maxW: number, maxH: number) {
    if (!dataUrl.startsWith("data:image/png")) return;
    const p = pages[pi]; if (!p) return;
    const img = await pdf.embedPng(dataUrl);
    const k = Math.min(maxW / img.width, maxH / img.height);
    p.drawImage(img, { x, y: H(p) - yTop - img.height * k, width: img.width * k, height: img.height * k });
  }
  // personnes
  for (const pp of t.personnes) {
    text(pp.page, str(`pers.${pp.id}`), pp.nom.x, pp.nom.y, { w: 140 });
    if (pp.sig) await sign(pp.page, str(`pers.${pp.id}.sig`), pp.sig.x, pp.sig.y + 4, 120, 17);
  }
  // tableau des mesures
  for (const [i, r] of t.rows.entries()) {
    const k = `r${i}`;
    if (r.kind === "titre") {
      if (r.choice && v[`${k}.choice`]) r.choice.forEach((o) => { if (o.v === v[`${k}.choice`]) cross(r.page, o); });
      continue;
    }
    if (r.tolChoice && v[`${k}.tol`]) r.tolChoice.forEach((o) => { if (o.v === v[`${k}.tol`]) cross(r.page, o); });
    for (const c2 of ["avant", "apres"] as const) {
      const cl = r[c2];
      if (!cl) continue;
      if (cl.type === "choice") cl.options.forEach((o) => { if (o.v === v[`${k}.${c2}`]) cross(r.page, o); });
      else {
        cell(r.page, str(`${k}.${c2}`), cl);
        if (cl.type === "textso" && v[`${k}.${c2}.so`] === true) cross(r.page, cl.so);
      }
    }
    if (r.obs) cell(r.page, str(`${k}.obs`), r.obs);
    for (const f of r.obsFields ?? []) {
      const sig = str(`${k}.${f.id}.sig`);
      if (sig) await sign(r.page, sig, f.x, f.y - 2, 575 - f.x, 11);
      else text(r.page, str(`${k}.${f.id}`), f.x, f.y + 1.2, { w: 575 - f.x, size: 7.5 });
    }
  }
  // commentaires (multi-lignes, retour à la ligne automatique)
  const com = str("comments");
  if (com && t.comments) {
    const cm = t.comments, size = cm.size, lh = size * 1.3;
    const lines: string[] = [];
    for (const para of com.split(/\r?\n/).map((x) => safe(font, x))) {
      let cur = "";
      for (const word of para.split(/\s+/)) {
        const tryL = cur ? cur + " " + word : word;
        if (font.widthOfTextAtSize(tryL, size) > cm.w && cur) { lines.push(cur); cur = word; } else cur = tryL;
      }
      lines.push(cur);
    }
    const p = pages[cm.page];
    lines.slice(0, Math.floor(cm.h / lh)).forEach((ln, j) =>
      p.drawText(ln, { x: cm.x + 4, y: H(p) - cm.y - size - j * lh, size, font, color: INK }));
  }
  pdf.setTitle(`Constat de vérification ${c.template_id} ${str("id_client")}`.trim());
  const out = await pdf.save();
  return new Blob([out as BlobPart], { type: "application/pdf" });
}

// PDF des documents CT d'une ligne (sans le constat) : photos (2 par page), PDF joints
// (pages recopiées telles quelles), HTML / texte (contenu texte mis en page).
// `ref` = référence affichée en en-tête de chaque page (ex. désignation · id court).
export async function buildCtPdf(photos: LignePhoto[], baseUrl: string, ref: string): Promise<Blob> {
  if (!photos.length) throw new Error("Aucun document CT sur cette ligne.");
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const fontBytes = await (await fetch(baseUrl + "constats/LiberationSans.ttf")).arrayBuffer();
  const font = await pdf.embedFont(fontBytes, { subset: true });
  charset = null;
  const A4: [number, number] = [595.28, 841.89];
  const head = (p: PDFPage, titre: string) => {
    p.drawText(safe(font, `${titre} — ${ref}`), { x: 40, y: A4[1] - 50, size: 12, font, color: rgb(0, 0, 0) });
  };
  const kind = (d: { data: string; mime?: string; name?: string }) => {
    const m = (d.mime || d.data.slice(5, d.data.indexOf(";"))).toLowerCase(), n = (d.name || "").toLowerCase();
    return m.startsWith("image/") ? "image" : m === "application/pdf" || n.endsWith(".pdf") ? "pdf"
      : m === "text/html" || /\.html?$/.test(n) ? "html" : m.startsWith("text/") ? "texte" : "autre";
  };
  const bytesOf = (d: string) => { const b = atob(d.split(",")[1] ?? ""); const u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; };
  const caption = (ph: LignePhoto) => [ph.name, new Date(ph.ts).toLocaleString("fr-FR"), ph.note].filter(Boolean).join(" — ");

  const images = photos.filter((p) => kind(p) === "image");
  for (let i = 0; i < images.length; i += 2) {
    const p = pdf.addPage(A4);
    head(p, "Documents CT · photos");
    for (let j = 0; j < 2 && i + j < images.length; j++) {
      const ph = images[i + j];
      let img;
      try { img = ph.data.startsWith("data:image/png") ? await pdf.embedPng(ph.data) : await pdf.embedJpg(ph.data); } catch { continue; }
      const boxW = A4[0] - 80, boxH = 330, top = A4[1] - 75 - j * 375;
      const k = Math.min(boxW / img.width, boxH / img.height);
      const w = img.width * k, h = img.height * k;
      p.drawImage(img, { x: 40 + (boxW - w) / 2, y: top - h, width: w, height: h });
      p.drawText(safe(font, [new Date(ph.ts).toLocaleString("fr-FR"), ph.note].filter(Boolean).join(" — ")), { x: 40, y: top - boxH - 14, size: 9, font, color: rgb(0.2, 0.2, 0.2) });
    }
  }
  const nonInclus: string[] = [];
  for (const ph of photos) {
    const k = kind(ph);
    if (k === "pdf") {
      try {
        const src = await PDFDocument.load(bytesOf(ph.data), { ignoreEncryption: true });
        const sep = pdf.addPage(A4); head(sep, "Documents CT");
        sep.drawText(safe(font, caption(ph)), { x: 40, y: A4[1] - 75, size: 10, font, color: rgb(0.2, 0.2, 0.2) });
        const pages = await pdf.copyPages(src, src.getPageIndices());
        pages.forEach((pg) => pdf.addPage(pg));
      } catch { nonInclus.push(`${ph.name || "PDF"} (illisible)`); }
    } else if (k === "html" || k === "texte") {
      let txt = new TextDecoder().decode(bytesOf(ph.data));
      if (k === "html") {
        if (typeof DOMParser !== "undefined") {
          const doc = new DOMParser().parseFromString(txt, "text/html");
          doc.querySelectorAll("script,style").forEach((n) => n.remove());
          doc.querySelectorAll("td,th").forEach((n) => n.append("   "));
          doc.querySelectorAll("br,p,div,tr,li,h1,h2,h3,h4,table").forEach((n) => n.append("\n"));
          txt = doc.body?.textContent ?? "";
        } else txt = txt.replace(/<(script|style)[\s\S]*?<\/\1>/gi, "").replace(/<\/(td|th)>/gi, "   ").replace(/<br\s*\/?>|<\/(p|div|tr|li|h\d)>/gi, "\n").replace(/<[^>]+>/g, "");
        txt = txt.replace(/[ \t]+/g, " ").replace(/\n\s*\n\s*\n+/g, "\n\n").trim();
      }
      const size = 9, lh = 11.5, maxW = A4[0] - 80;
      const lines: string[] = [];
      for (const para of txt.split(/\r?\n/)) {
        let cur = "";
        for (const w of safe(font, para).split(" ")) {
          const t = cur ? cur + " " + w : w;
          if (font.widthOfTextAtSize(t, size) > maxW && cur) { lines.push(cur); cur = w; } else cur = t;
        }
        lines.push(cur);
      }
      const perPage = Math.floor((A4[1] - 110) / lh);
      for (let i = 0; i < Math.max(1, lines.length); i += perPage) {
        const p = pdf.addPage(A4); head(p, "Documents CT");
        p.drawText(safe(font, caption(ph)), { x: 40, y: A4[1] - 68, size: 9, font, color: rgb(0.35, 0.35, 0.35) });
        lines.slice(i, i + perPage).forEach((ln, j) => p.drawText(ln, { x: 40, y: A4[1] - 90 - j * lh, size, font, color: rgb(0, 0, 0) }));
      }
    } else if (k === "autre") nonInclus.push(ph.name || "document");
  }
  if (nonInclus.length) {
    const p = pdf.addPage(A4); head(p, "Documents CT");
    p.drawText(safe(font, "Documents joints non intégrés : " + nonInclus.join(", ")), { x: 40, y: A4[1] - 80, size: 9, font, color: rgb(0, 0, 0) });
  }
  pdf.setTitle(`Documents CT ${ref}`.trim());
  const out = await pdf.save();
  return new Blob([out as BlobPart], { type: "application/pdf" });
}
