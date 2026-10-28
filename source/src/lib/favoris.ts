// Favoris ECME : épinglage par utilisateur, synchronisé via Supabase
// (table public.ecme_favoris, scopée par user_id). Miroir Dexie pour l'offline.
import { db } from "./db";
import { currentUserId, localUpsert, syncAll } from "./sync";
import type { EcmeFavori } from "./types";

// Ensemble des id d'étalons épinglés (non supprimés).
export async function favorisSet(): Promise<Set<string>> {
  const rows = await db.ecme_favoris.toArray();
  return new Set(rows.filter((r) => !r.deleted).map((r) => r.etalon_id));
}

// Épingle / désépingle un étalon. `pinned` = état courant (true => on retire).
export async function toggleFavori(etalonId: string, pinned: boolean): Promise<void> {
  const uid = await currentUserId();
  if (!uid) return; // épinglage réservé à une session connectée
  await localUpsert(db.ecme_favoris, {
    etalon_id: etalonId,
    user_id: uid,
    deleted: pinned,
    updated_at: new Date().toISOString(),
  } as EcmeFavori);
  syncAll().catch(() => {});
}
