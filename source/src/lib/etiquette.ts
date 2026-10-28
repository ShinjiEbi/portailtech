// Rendu des étiquettes Bertin (VP conforme / non conforme) dans un canvas, à l'identique
// des étiquettes officielles : grille, cellule noire « VALIDITE : », fond pointillé,
// colonne logo sur les 2 dernières lignes uniquement. Envoyé ensuite en image à l'imprimante.
import type { Etiquette } from "./bertinPrint";
import LOGO from "../assets/bertin_logo.png?inline"; // intégré au code : pas de fichier séparé à publier

const W = 832, H = 384;          // ≈ 2,17:1 comme l'étiquette 24 mm ; ramené à 128 px à l'impression
const LINE = 5;
const FONT = '"Arial", "Helvetica", "Liberation Sans", sans-serif';

let logoP: Promise<HTMLImageElement | null> | null = null;
function logo(): Promise<HTMLImageElement | null> {
  if (!logoP) logoP = new Promise((res) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => res(null);
    img.src = LOGO;
  });
  return logoP;
}

// Texte gras centré dans une cellule, taille réduite si besoin pour tenir en largeur.
function cellText(ctx: CanvasRenderingContext2D, t: string, x0: number, y0: number, x1: number, y1: number,
  size: number, opts: { color?: string; align?: "center" | "left"; pad?: number } = {}) {
  const pad = opts.pad ?? 16;
  let s = size;
  ctx.font = `bold ${s}px ${FONT}`;
  while (s > 14 && ctx.measureText(t).width > x1 - x0 - 2 * pad) { s -= 2; ctx.font = `bold ${s}px ${FONT}`; }
  ctx.fillStyle = opts.color ?? "#000";
  ctx.textBaseline = "middle";
  ctx.textAlign = opts.align === "left" ? "left" : "center";
  const x = opts.align === "left" ? x0 + pad : (x0 + x1) / 2;
  ctx.fillText(t, x, (y0 + y1) / 2 + s * 0.04);
}

function line(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number) {
  ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
}

function dots(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number) {
  ctx.fillStyle = "#000";
  for (let y = y0 + 6; y < y1 - 3; y += 9)
    for (let x = x0 + 6 + ((y / 9) % 2 ? 4 : 0); x < x1 - 3; x += 9) ctx.fillRect(x, y, 2.6, 2.6);
}

async function drawLogo(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number) {
  const img = await logo();
  if (!img) return;
  // logo couché (lecture de bas en haut), comme sur l'étiquette officielle
  const cw = x1 - x0, ch = y1 - y0;
  const k = Math.min((ch - 20) / img.width, (cw - 16) / img.height);
  ctx.save();
  ctx.translate((x0 + x1) / 2, (y0 + y1) / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.drawImage(img, (-img.width * k) / 2, (-img.height * k) / 2, img.width * k, img.height * k);
  ctx.restore();
}

export async function renderEtiquette(e: Etiquette): Promise<string> {
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = "#000"; ctx.lineWidth = LINE; ctx.lineCap = "square";
  const h = LINE / 2;

  if (e.type === "C") {
    const a = 280, b = 730, r1 = 146, r2 = 266;
    // ligne 1 : « VALIDITE : » blanc sur noir | date sur fond pointillé (pleine largeur)
    ctx.fillStyle = "#000"; ctx.fillRect(0, 0, a, r1);
    dots(ctx, a, 0, W, r1);
    cellText(ctx, "VALIDITE :", 0, 0, a, r1, 46, { color: "#fff", pad: 18 });
    cellText(ctx, e.val, a, 0, W, r1, 88, { pad: 24 });
    // lignes 2 et 3 : libellé | valeur | logo (colonne sur 2 lignes)
    cellText(ctx, "VP :", 0, r1, a, r2, 66, { align: "left", pad: 34 });
    cellText(ctx, e.dvp, a, r1, b, r2, 74);
    cellText(ctx, "ID :", 0, r2, a, H, 66, { align: "left", pad: 34 });
    cellText(ctx, e.id, a, r2, b, H, 80);
    await drawLogo(ctx, b, r1, W, H);
    ctx.strokeStyle = "#000"; ctx.lineWidth = LINE;
    ctx.strokeRect(h, h, W - LINE, H - LINE);
    line(ctx, 0, r1, W, r1);
    line(ctx, 0, r2, b, r2);
    line(ctx, a, 0, a, H);
    line(ctx, b, r1, b, H);
  } else {
    const b = 687, r1 = 166, r2 = 272;
    cellText(ctx, "NON CONFORME", 0, 0, W, r1, 104, { pad: 18 });
    cellText(ctx, "Contrôlé le", 0, r1, b, r2, 60);
    cellText(ctx, e.dvp, 0, r2, b, H, 72);
    await drawLogo(ctx, b, r1, W, H);
    ctx.strokeStyle = "#000"; ctx.lineWidth = LINE;
    ctx.strokeRect(h, h, W - LINE, H - LINE);
    line(ctx, 0, r1, W, r1);
    line(ctx, 0, r2, b, r2);
    line(ctx, b, r1, b, H);
  }
  return c.toDataURL("image/png");
}

// Étiquette code-barres d'un IZ : code-barres en haut, libellé puis « site Ttranche » en dessous.
// Dessinée directement à la résolution de la tête d'impression (128 points de haut, ruban 24 mm)
// pour garder des barres nettes (2 points par module).
export async function renderEtiquetteCodeBarre(code: string, format: string, ligne1: string, ligne2: string): Promise<string> {
  const { default: JsBarcode } = await import("jsbarcode");
  const bc = document.createElement("canvas");
  JsBarcode(bc, code, { format, width: 2, height: 70, margin: 0, displayValue: false, background: "#ffffff", lineColor: "#000000" });
  const H = 128, quiet = 24;
  const fit = (t: string, max: number, size: number) => {
    const ctx = document.createElement("canvas").getContext("2d")!;
    let s = size; ctx.font = `bold ${s}px ${FONT}`;
    while (s > 10 && ctx.measureText(t).width > max) { s -= 1; ctx.font = `bold ${s}px ${FONT}`; }
    return { s, w: ctx.measureText(t).width };
  };
  const W = Math.max(bc.width + 2 * quiet, 220);
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, W, H);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(bc, Math.round((W - bc.width) / 2), 4);
  ctx.fillStyle = "#000"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  const l1 = fit(ligne1, W - 12, 24), l2 = fit(ligne2, W - 12, 22);
  if (ligne1 && ligne2) {
    ctx.font = `bold ${l1.s}px ${FONT}`; ctx.fillText(ligne1, W / 2, 88);
    ctx.font = `bold ${l2.s}px ${FONT}`; ctx.fillText(ligne2, W / 2, 112);
  } else {
    const t = ligne1 || ligne2, f = fit(t, W - 12, 28);
    ctx.font = `bold ${f.s}px ${FONT}`; ctx.fillText(t, W / 2, 100);
  }
  return c.toDataURL("image/png");
}
