// Impression d'étiquettes Brother via l'appli Android BertinPrint (serveur HTTP local).
// API (APK) : GET /status → {printer, …} ; POST /print {labels:[image base64…]} ;
//   POST /print-label {labels:[…]} (gabarits de l'APK, non utilisés : grille fausse)
//   conforme     : {type:"C",  id, dvp, val}  → « VALIDITE : val / VP : dvp / ID : id »
//   non conforme : {type:"NC", dvp}           → « NON CONFORME / Contrôlé le dvp »
import { CONFORMITE_AVEC_ECHEANCE, type InterventionLigne } from "./types";

export const BERTINPRINT_URL = "http://127.0.0.1:8080";

export type Etiquette = { type: "C"; id: string; dvp: string; val: string; qty?: number } | { type: "NC"; dvp: string; qty?: number };

const fr = (iso: string | null | undefined) => {
  if (!iso) return "";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return y && m && d ? `${d}/${m}/${y}` : iso;
};

// Étiquette d'une ligne (dates du listing) ; renvoie un message si incomplète.
export function etiquetteOf(l: InterventionLigne): Etiquette | string {
  const dvp = fr(l.date_op);
  if (!dvp) return "date d'opération manquante";
  if (!CONFORMITE_AVEC_ECHEANCE.includes(l.conformite)) return { type: "NC", dvp };
  if (!l.id_court) return "id court manquant";
  if (!l.echeance) return "date de validité manquante";
  return { type: "C", id: l.id_court, dvp, val: fr(l.echeance) };
}

async function call(path: string, init?: RequestInit, ms = 4000): Promise<Response> {
  const ctl = new AbortController();
  const t = window.setTimeout(() => ctl.abort(), ms);
  try { return await fetch(BERTINPRINT_URL + path, { ...init, signal: ctl.signal }); }
  finally { window.clearTimeout(t); }
}

export async function bertinStatus(): Promise<{ ok: boolean; printer: boolean; msg: string }> {
  try {
    const r = await call("/status", undefined, 2500);
    const j = await r.json();
    return { ok: true, printer: !!j.printer, msg: j.printer ? "Imprimante connectée" : "BertinPrint actif, imprimante non connectée" };
  } catch {
    return { ok: false, printer: false, msg: "BertinPrint injoignable — lance l'appli BertinPrint sur ce téléphone" };
  }
}

// Envoie des images déjà dessinées (data URL PNG) à l'imprimante.
export async function imprimerImages(images: string[]): Promise<void> {
  if (!images.length) throw new Error("Aucune étiquette");
  let r: Response;
  try {
    r = await call("/print", { method: "POST", headers: { "Content-Type": "text/plain;charset=UTF-8" }, body: JSON.stringify({ labels: images }) }, 30000);
  } catch {
    throw new Error("BertinPrint injoignable — lance l'appli BertinPrint sur ce téléphone");
  }
  let j: { error?: string } = {};
  try { j = await r.json(); } catch { /* ignore */ }
  if (!r.ok) throw new Error(j.error || `Erreur ${r.status}`);
}

// Les étiquettes sont dessinées par le portail (etiquette.ts, gabarit officiel) et envoyées
// en images à /print (le gabarit intégré à l'APK a une grille incorrecte).
// text/plain : requête « simple » (pas de pré-vol CORS), le serveur lit le JSON brut.
export async function imprimer(labels: Etiquette[]): Promise<void> {
  if (!labels.length) throw new Error("Aucune étiquette");
  const { renderEtiquette } = await import("./etiquette");
  const images: string[] = [];
  for (const l of labels) { const png = await renderEtiquette(l); for (let i = 0; i < (l.qty ?? 1); i++) images.push(png); }
  let r: Response;
  try {
    r = await call("/print", { method: "POST", headers: { "Content-Type": "text/plain;charset=UTF-8" }, body: JSON.stringify({ labels: images }) }, 30000);
  } catch {
    throw new Error("BertinPrint injoignable — lance l'appli BertinPrint sur ce téléphone");
  }
  let j: { error?: string } = {};
  try { j = await r.json(); } catch { /* ignore */ }
  if (!r.ok) throw new Error(j.error || `Erreur ${r.status}`);
}
