import Dexie, { type Table } from "dexie";
import type { Etalon, Imputation, JournalEntry, Local } from "./types";

// IndexedDB locale : source de vrit pour l'UI (lecture/criture instantanes,
// hors-ligne). sync.ts rconcilie avec Supabase quand le rseau est l.
class PortailDB extends Dexie {
  etalons!: Table<Local<Etalon>, string>;
  imputations!: Table<Local<Imputation>, string>;
  journal!: Table<Local<JournalEntry>, string>;
  meta!: Table<{ key: string; value: string }, string>;

  constructor() {
    super("portail-tech");
    this.version(1).stores({
      // 'id' = cl primaire ; le reste = index
      etalons: "id, type, statut, _dirty, updated_at",
      imputations: "id, date, _dirty, updated_at",
      journal: "id, ts, _dirty, updated_at",
      meta: "key",
    });
  }
}

export const db = new PortailDB();

// Helpers checkpoints de synchro (curseur updated_at par table)
export async function metaGet(key: string): Promise<string | null> {
  const row = await db.meta.get(key);
  return row?.value ?? null;
}
export async function metaSet(key: string, value: string): Promise<void> {
  await db.meta.put({ key, value });
}
