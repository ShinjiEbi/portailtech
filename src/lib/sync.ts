import { db, metaGet, metaSet } from "./db";
import { supabase } from "./supabase";
import type { Table } from "dexie";

const PAGE = 500;
const EPOCH = "1970-01-01T00:00:00Z";

export function isOnline(): boolean {
  return typeof navigator === "undefined" ? true : navigator.onLine;
}

async function hasSession(): Promise<boolean> {
  const { data } = await supabase.auth.getSession();
  return !!data.session;
}

// ---- critures locales (utilises par l'UI) -------------------------------
// Toute criture passe ici : on tamponne updated_at et on marque _dirty=1.
export async function localUpsert<T extends { id: string }>(
  local: Table<any, string>,
  row: T
): Promise<void> {
  await local.put({ ...row, updated_at: new Date().toISOString(), _dirty: 1 });
}

export async function localSoftDelete(
  local: Table<any, string>,
  id: string
): Promise<void> {
  const row = await local.get(id);
  if (!row) return;
  await local.put({ ...row, deleted: true, updated_at: new Date().toISOString(), _dirty: 1 });
}

// ---- push : lignes _dirty -> Supabase -------------------------------------
async function pushDirty(local: Table<any, string>, remote: string): Promise<void> {
  const dirty = await local.where("_dirty").equals(1).toArray();
  if (dirty.length === 0) return;
  // On laisse la BDD grer updated_at (default now() / trigger), on retire _dirty.
  const payload = dirty.map(({ _dirty, updated_at, ...row }) => row);
  const { error } = await supabase.from(remote).upsert(payload);
  if (error) throw error;
  await db.transaction("rw", local, async () => {
    for (const row of dirty) await local.update(row.id, { _dirty: 0 });
  });
}

// ---- pull : Supabase -> local (incrmental via curseur updated_at) --------
async function pullTable(
  local: Table<any, string>,
  remote: string,
  ckptKey: string
): Promise<void> {
  let ckpt = (await metaGet(ckptKey)) ?? EPOCH;
  for (;;) {
    const { data, error } = await supabase
      .from(remote)
      .select("*")
      .gt("updated_at", ckpt)
      .order("updated_at", { ascending: true })
      .limit(PAGE);
    if (error) throw error;
    if (!data || data.length === 0) break;

    await db.transaction("rw", local, async () => {
      for (const row of data as any[]) {
        const localRow = await local.get(row.id);
        // Une modif locale pas encore pousse l'emporte (on ne l'crase pas).
        if (localRow && localRow._dirty === 1) continue;
        await local.put({ ...row, _dirty: 0 });
      }
    });

    ckpt = (data[data.length - 1] as any).updated_at;
    await metaSet(ckptKey, ckpt);
    if (data.length < PAGE) break;
  }
}

// ---- orchestration --------------------------------------------------------
let running = false;
export async function syncAll(): Promise<void> {
  if (running || !isOnline()) return;
  if (!(await hasSession())) return;
  running = true;
  try {
    // 1) on pousse ce qu'on a saisi hors-ligne
    await pushDirty(db.etalons, "etalons");
    await pushDirty(db.imputations, "imputations");
    await pushDirty(db.journal, "journal");
    // 2) on rcupre les nouveauts (dont nos lignes pousses, ractualises)
    await pullTable(db.etalons, "etalons", "ckpt_etalons");
    await pullTable(db.imputations, "imputations", "ckpt_imputations");
    await pullTable(db.journal, "journal", "ckpt_journal");
  } finally {
    running = false;
  }
}

export async function pendingCount(): Promise<number> {
  const [a, b, c] = await Promise.all([
    db.etalons.where("_dirty").equals(1).count(),
    db.imputations.where("_dirty").equals(1).count(),
    db.journal.where("_dirty").equals(1).count(),
  ]);
  return a + b + c;
}

// Purge locale (au logout) : on repart d'IndexedDB vide.
export async function resetLocal(): Promise<void> {
  await db.transaction("rw", db.etalons, db.imputations, db.journal, db.meta, async () => {
    await Promise.all([
      db.etalons.clear(),
      db.imputations.clear(),
      db.journal.clear(),
      db.meta.clear(),
    ]);
  });
}
