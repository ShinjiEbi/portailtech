// Module RTR : bibliothèque des régimes de travail radiologique (partagés ou perso).
// Stockage local (Dexie) + réconciliation Supabase via sync.ts, comme les Calculs.
import { db } from "./db";
import { currentUserId, localSoftDelete, localUpsert, syncAll } from "./sync";
import type { RegimeTravail } from "./types";

export async function allRegimes(): Promise<RegimeTravail[]> {
  const rows = await db.rtr.toArray();
  return rows
    .filter((r) => !r.deleted)
    .sort((a, b) => a.nom.localeCompare(b.nom, "fr", { numeric: true }));
}

export async function getRegime(id: string): Promise<RegimeTravail | undefined> {
  const r = await db.rtr.get(id);
  return r && !r.deleted ? r : undefined;
}

export async function saveRegime(r: RegimeTravail): Promise<void> {
  const uid = await currentUserId();
  // un régime perso appartient à son créateur ; un régime partagé n'a pas de propriétaire
  const user_id = r.scope === "perso" ? (r.user_id ?? uid) : null;
  await localUpsert(db.rtr, { ...r, user_id });
  syncAll().catch(() => {});
}

export async function deleteRegime(id: string): Promise<void> {
  await localSoftDelete(db.rtr, id);
  syncAll().catch(() => {});
}

export function blankRegime(): RegimeTravail {
  return {
    id: crypto.randomUUID(),
    nom: "",
    site: null,
    date_validite: null,
    code: "",
    scope: "perso",
    user_id: null,
    updated_at: new Date().toISOString(),
    deleted: false,
  };
}

// Un régime est-il périmé ? (date_validite dépassée ; vide = jamais périmé)
export function isExpired(r: RegimeTravail, at: Date = new Date()): boolean {
  if (!r.date_validite) return false;
  const today = at.toISOString().slice(0, 10);
  return r.date_validite < today;
}
