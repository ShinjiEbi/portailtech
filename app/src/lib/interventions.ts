// Module Intervention : listings de contrôles (partagés ou perso) + lignes.
// - Lookup GMO² -> base matériels (offline) pour pré-remplir désignation / SN / id court.
// - Validité déduite de l'opération (VP* = 1 an, MP* = 3 ans) ; échéance = date + validité
//   uniquement si conforme (Non conforme -> pas d'échéance).
import { db } from "./db";
import { currentUserId, localSoftDelete, localUpsert, syncAll } from "./sync";
import { corimByTypeCode, decompose } from "./materiels";
import {
  CONFORMITE_AVEC_ECHEANCE, VALIDITE_ANS,
  type Conformite, type InterventionLigne, type InterventionListing, type OperationControle,
} from "./types";

// --- listings ---------------------------------------------------------------
export async function allListings(): Promise<InterventionListing[]> {
  const rows = await db.intervention_listings.toArray();
  // plus récents en haut (utile en campagne)
  return rows.filter((r) => !r.deleted).sort((a, b) => b.updated_at.localeCompare(a.updated_at));
}
export async function getListing(id: string): Promise<InterventionListing | undefined> {
  const r = await db.intervention_listings.get(id);
  return r && !r.deleted ? r : undefined;
}
export async function saveListing(l: InterventionListing): Promise<void> {
  const uid = await currentUserId();
  await localUpsert(db.intervention_listings, { ...l, user_id: l.user_id ?? uid });
  syncAll().catch(() => {});
}
export async function deleteListing(id: string): Promise<void> {
  // soft-delete du listing ET de ses lignes (pour ne rien laisser d'orphelin en base)
  const lignes = await db.intervention_lignes.where("listing_id").equals(id).toArray();
  for (const l of lignes) if (!l.deleted) await localSoftDelete(db.intervention_lignes, l.id);
  await localSoftDelete(db.intervention_listings, id);
  syncAll().catch(() => {});
}
export async function duplicateListing(id: string): Promise<string | null> {
  const src = await getListing(id);
  if (!src) return null;
  const uid = await currentUserId();
  const newId = crypto.randomUUID();
  await localUpsert(db.intervention_listings, { ...src, id: newId, nom: `${src.nom} (copie)`, user_id: uid });
  const lignes = (await db.intervention_lignes.where("listing_id").equals(id).toArray()).filter((l) => !l.deleted);
  for (const l of lignes) {
    await localUpsert(db.intervention_lignes, { ...l, id: crypto.randomUUID(), listing_id: newId, user_id: uid });
  }
  syncAll().catch(() => {});
  return newId;
}

// --- lignes -----------------------------------------------------------------
export async function linesOf(listingId: string): Promise<InterventionLigne[]> {
  const rows = await db.intervention_lignes.where("listing_id").equals(listingId).toArray();
  return rows.filter((r) => !r.deleted).sort((a, b) => (a.ordre - b.ordre) || a.date_op.localeCompare(b.date_op));
}
export async function saveLigne(l: InterventionLigne): Promise<void> {
  const uid = await currentUserId();
  await localUpsert(db.intervention_lignes, { ...l, user_id: l.user_id ?? uid });
  syncAll().catch(() => {});
}
export async function deleteLigne(id: string): Promise<void> {
  await localSoftDelete(db.intervention_lignes, id);
  syncAll().catch(() => {});
}

// --- validité / échéance ----------------------------------------------------
// Ajoute n années à une date 'YYYY-MM-DD' en date-only (sans fuseau) ; 29/02 -> 28/02
// si l'année cible n'est pas bissextile.
export function addYears(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  const ny = y + Math.trunc(n);
  const lastDay = new Date(ny, m, 0).getDate(); // dernier jour du mois m (1-based)
  const nd = Math.min(d, lastDay);
  return `${ny}-${String(m).padStart(2, "0")}-${String(nd).padStart(2, "0")}`;
}
export function validiteForOperation(op: OperationControle): number {
  return VALIDITE_ANS[op];
}
// Échéance = date_op + validite_ans, seulement si la conformité émet une échéance.
export function computeEcheance(date_op: string | null, validite_ans: number | null, conformite: Conformite): string | null {
  if (!date_op || validite_ans == null || !CONFORMITE_AVEC_ECHEANCE.includes(conformite)) return null;
  return addYears(date_op, validite_ans);
}
// Recalcule l'échéance d'une ligne en respectant l'échéance manuelle (sauf Non conforme,
// qui force toujours « pas d'échéance »).
export function deriveEcheance(l: InterventionLigne): string | null {
  if (!CONFORMITE_AVEC_ECHEANCE.includes(l.conformite)) return null;
  if (l.echeance_manuelle) return l.echeance;
  return computeEcheance(l.date_op, l.validite_ans, l.conformite);
}

// --- lookup équipement (GMO² -> matériels, offline) -------------------------
export interface EquipSnapshot { id_court: string; designation: string | null; sn: string | null; found: boolean; }
export async function lookupEquipement(scan: string): Promise<EquipSnapshot> {
  const s = scan.trim();
  if (!s) return { id_court: "", designation: null, sn: null, found: false };
  const mat = await db.materiels.get(s);
  if (mat && !mat.deleted) {
    let designation = mat.designation;
    if (!designation && mat.type_code) {
      const ct = await db.corim_types.get(mat.type_code);
      if (ct && !ct.deleted) designation = ct.designation;
    }
    return { id_court: mat.id_court, designation: designation ?? null, sn: mat.sn ?? null, found: true };
  }
  // pas en base : on dérive au moins l'id court depuis le scan
  const dec = decompose(s);
  return { id_court: dec.id_court, designation: null, sn: null, found: false };
}

// Aide au tri Corim côté formulaire (réutilise corimByTypeCode pour rester cohérent).
export { corimByTypeCode };

// --- fabriques --------------------------------------------------------------
export function blankListing(): InterventionListing {
  return {
    id: crypto.randomUUID(), nom: "", scope: "perso", user_id: null,
    updated_at: new Date().toISOString(), deleted: false,
  };
}
export function blankLigne(listingId: string, ordre: number, triExec: string | null = null): InterventionLigne {
  const today = new Date().toISOString().slice(0, 10);
  const operation: OperationControle = "VP cas 1";
  const conformite: Conformite = "Conforme";
  const validite_ans = VALIDITE_ANS[operation];
  return {
    id: crypto.randomUUID(), listing_id: listingId,
    scan: "", id_court: "", designation: null, sn: null,
    type_controle: "Préventif", operation, conformite,
    date_op: today, validite_ans,
    echeance: computeEcheance(today, validite_ans, conformite),
    echeance_manuelle: false,
    commentaire: null, tri_exec: triExec, tri_ct: null,
    ordre, user_id: null,
    updated_at: new Date().toISOString(), deleted: false,
  };
}
