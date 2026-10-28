// Import d'une sauvegarde JSON de planning.
// Accepte deux formats, fusionnés champ par champ :
//   - l'ancien outil (standalone)  : jours en camelCase (hNorm, tAD, frais[].photo en base64)
//   - l'export natif (ce module)   : jours en snake_case (h_norm, t_ad, frais[].photo_path)
// Les identifiants sont recalculés pour l'utilisateur courant (UUID déterministe
// par date) et les photos base64 sont basculées vers Supabase Storage.
import { db } from "./db";
import { localUpsert, syncAll } from "./sync";
import { currentUserId, jourId, saveParams } from "./planning";
import { importFraisPhoto } from "./fraisPhotos";
import {
  PLANNING_TYPES, type FraisItem, type PlanningJour, type PlanningParams, type PlanningType,
} from "./types";

type AnyRec = Record<string, unknown>;
const isRec = (v: unknown): v is AnyRec => typeof v === "object" && v !== null;
const TYPES = new Set<string>(PLANNING_TYPES);

const str = (v: unknown): string | null => (v == null || v === "" ? null : String(v));
const num = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
// lit une clé snake_case ou son équivalent camelCase
const pick = (o: AnyRec, snake: string, camel: string) => (o[snake] !== undefined ? o[snake] : o[camel]);

async function normFrais(date: string, raw: unknown): Promise<FraisItem[]> {
  if (!Array.isArray(raw)) return [];
  const out: FraisItem[] = [];
  for (const f of raw) {
    if (!isRec(f)) continue;
    const id = String(f.id ?? crypto.randomUUID());
    const item: FraisItem = {
      id,
      cat: String(f.cat ?? "Autre"),
      montant: Number(f.montant) || 0,
      photo_path: null,
      photo_nom: null,
    };
    if (typeof f.photo_path === "string" && f.photo_path) {
      item.photo_path = f.photo_path;
      item.photo_nom = (f.photo_nom as string) ?? null;
    } else if (typeof f.photo === "string" && f.photo.startsWith("data:")) {
      try { item.photo_path = await importFraisPhoto(date, id, f.photo); item.photo_nom = "import.jpg"; }
      catch { /* on conserve le frais sans la photo */ }
    }
    out.push(item);
  }
  return out;
}

async function normDay(userId: string, raw: AnyRec): Promise<PlanningJour | null> {
  const date = String(raw.date ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const type = String(raw.type ?? "");
  if (!TYPES.has(type)) return null;
  return {
    id: await jourId(userId, date),
    user_id: userId,
    date,
    type: type as PlanningType,
    debut: str(raw.debut),
    fin: str(raw.fin),
    pause: num(raw.pause),
    total: num(raw.total),
    h_norm: num(pick(raw, "h_norm", "hNorm")),
    h_supp: num(pick(raw, "h_supp", "hSupp")),
    site: str(raw.site),
    contrat: str(raw.contrat),
    imputation: str(raw.imputation),
    dose: num(raw.dose),
    trajet: !!raw.trajet,
    t_ad: str(pick(raw, "t_ad", "tAD")),
    t_af: str(pick(raw, "t_af", "tAF")),
    t_rd: str(pick(raw, "t_rd", "tRD")),
    t_rf: str(pick(raw, "t_rf", "tRF")),
    frais: await normFrais(date, raw.frais),
    commentaire: str(raw.commentaire),
    updated_at: new Date().toISOString(),
    deleted: false,
  };
}

function normParams(raw: AnyRec): Partial<PlanningParams> {
  const codes = isRec(raw.codes) ? (raw.codes as Record<string, string>) : {};
  const patch: Partial<PlanningParams> = {
    horaire: Number(raw.horaire) || 7.5,
    matricule: str(raw.matricule),
    dosi: str(raw.dosi),
    nom: str(raw.nom),
    prenom: str(raw.prenom),
    sup: str(raw.sup),
    codes: { ...codes },
  };
  const td = raw.trajet_defaut;
  if (isRec(td) && "ad" in td) {
    patch.trajet_defaut = { ad: String(td.ad), af: String(td.af), rd: String(td.rd), rf: String(td.rf) };
  }
  return patch;
}

export interface ImportResult { jours: number; params: boolean; ignores: number; }

// Analyse le JSON, écrit en base (sans sync par ligne), puis lance UNE sync.
export async function importPlanningJson(json: unknown): Promise<ImportResult> {
  if (!isRec(json)) throw new Error("Fichier JSON invalide.");
  const userId = await currentUserId();
  if (!userId) throw new Error("Connecte-toi avant d'importer.");

  let params = false;
  if (isRec(json.params)) { await saveParams(normParams(json.params)); params = true; }

  const rawJours = Array.isArray(json.jours) ? json.jours : [];
  let jours = 0, ignores = 0;
  for (const j of rawJours) {
    if (!isRec(j)) { ignores++; continue; }
    const row = await normDay(userId, j);
    if (!row) { ignores++; continue; }
    await localUpsert(db.planning, row);
    jours++;
  }

  await syncAll();
  return { jours, params, ignores };
}

// Construit l'objet de sauvegarde natif (round-trip), sans le champ interne _dirty.
export function buildExport(params: PlanningParams, jours: PlanningJour[]) {
  const clean = jours.map((j) => {
    const r = { ...j } as PlanningJour & { _dirty?: 0 | 1 };
    delete r._dirty;
    return r;
  });
  return { version: 1, exported_at: new Date().toISOString(), params, jours: clean };
}
