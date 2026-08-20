import { db, metaGet, metaSet } from "./db";
import { supabase } from "./supabase";
import { cacheMissingCertificats } from "./storage";
import { cacheMissingFrais, uploadPendingFrais } from "./fraisPhotos";
import type { Table } from "dexie";
import type { JournalType } from "./types";

const PAGE = 500;
const EPOCH = "1970-01-01T00:00:00Z";

export function isOnline(): boolean {
  return typeof navigator === "undefined" ? true : navigator.onLine;
}

async function hasSession(): Promise<boolean> {
  const { data } = await supabase.auth.getSession();
  return !!data.session;
}

export async function currentUserId(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.user.id ?? null;
}

// ---- écritures locales (utilisées par l'UI) ------------------------------
export async function localUpsert<T extends object>(
  local: Table<any, string>,
  row: T
): Promise<void> {
  await local.put({ ...row, updated_at: new Date().toISOString(), _dirty: 1 });
}

export async function localSoftDelete(local: Table<any, string>, id: string): Promise<void> {
  const row = await local.get(id);
  if (!row) return;
  await local.put({ ...row, deleted: true, updated_at: new Date().toISOString(), _dirty: 1 });
}

// ---- journal : écriture d'un évènement de log ----------------------------
export async function logJournal(
  type: JournalType,
  message: string,
  etalon_id: string | null = null
): Promise<void> {
  const { data } = await supabase.auth.getSession();
  const uid = data.session?.user.id;
  if (!uid) return;
  await localUpsert(db.journal, {
    id: crypto.randomUUID(),
    user_id: uid,
    ts: new Date().toISOString(),
    type,
    message,
    etalon_id,
    deleted: false,
    updated_at: new Date().toISOString(),
  });
  syncAll().catch(() => {});
}

// ---- push : lignes _dirty -> Supabase -------------------------------------
async function pushDirty(local: Table<any, string>, remote: string): Promise<void> {
  const dirty = await local.where("_dirty").equals(1).toArray();
  if (dirty.length === 0) return;
  const pk = ((local.schema?.primKey?.keyPath as string) || "id");
  const payload = dirty.map(({ _dirty, updated_at, ...row }) => row);
  const { error } = await supabase.from(remote).upsert(payload);
  if (error) throw error;
  await db.transaction("rw", local, async () => {
    for (const row of dirty) await local.update((row as any)[pk], { _dirty: 0 });
  });
}

// ---- pull : Supabase -> local (incrémental via curseur updated_at) --------
async function pullTable(local: Table<any, string>, remote: string, ckptKey: string): Promise<void> {
  const pk = ((local.schema?.primKey?.keyPath as string) || "id");
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
        const localRow = await local.get((row as any)[pk]);
        if (localRow && localRow._dirty === 1) continue; // modif locale non poussée : on garde
        await local.put({ ...row, _dirty: 0 });
      }
    });
    ckpt = (data[data.length - 1] as any).updated_at;
    await metaSet(ckptKey, ckpt);
    if (data.length < PAGE) break;
  }
}

let running = false;

// Diagnostic : on consigne dans le journal l'erreur exacte renvoyée par Supabase
// pour la synchro des calculs (sinon masquée). Dédupliquée pour ne pas spammer.
function errText(e: unknown): string {
  if (e && typeof e === "object") {
    const o = e as { code?: string; message?: string; details?: string; hint?: string };
    const parts = [o.code ? `[${o.code}]` : "", o.message ?? "", o.details ? `— ${o.details}` : "", o.hint ? `(${o.hint})` : ""].filter(Boolean);
    if (parts.length) return parts.join(" ");
  }
  return String(e);
}
let lastCalcErr: string | null = null;
function logCalcErr(phase: string, e: unknown): void {
  const t = `Sync calculs (${phase}) : ${errText(e)}`;
  if (t !== lastCalcErr) { lastCalcErr = t; logJournal("erreur", t).catch(() => {}); }
}

// Resynchronisation forcée des calculs (bouton Paramètres) : re-marque tout pour
// l'envoi, ré-initialise le curseur de pull, et consigne le bilan/erreur exacte
// dans le journal. Renvoie un message lisible à afficher.
export async function resyncCalculs(): Promise<string> {
  const msg = await _resyncCalculs();
  await metaSet("last_calc_sync", `${new Date().toLocaleString("fr-FR")} · ${msg}`).catch(() => {});
  return msg;
}
async function _resyncCalculs(): Promise<string> {
  if (!isOnline()) return "Hors ligne : impossible de synchroniser.";
  if (!(await hasSession())) return "Non connecté : connecte-toi d'abord.";
  const all = await db.calculs.toArray();
  const local = all.filter((r) => !r.deleted).length;
  await db.transaction("rw", db.calculs, async () => {
    for (const r of all) await db.calculs.update(r.id, { _dirty: 1 });
  });
  let pushed = 0, pulled = 0, err = "";
  try {
    const d = await db.calculs.where("_dirty").equals(1).toArray();
    if (d.length) {
      const payload = d.map(({ _dirty, updated_at, ...row }) => row);
      const { error } = await supabase.from("calculs").upsert(payload);
      if (error) throw error;
      await db.transaction("rw", db.calculs, async () => {
        for (const r of d) await db.calculs.update(r.id, { _dirty: 0 });
      });
      pushed = d.length;
    }
  } catch (e) { err = "push: " + errText(e); }
  try {
    await metaSet("ckpt_calculs", EPOCH);
    let ckpt = EPOCH;
    for (;;) {
      const { data, error } = await supabase.from("calculs").select("*").gt("updated_at", ckpt).order("updated_at", { ascending: true }).limit(PAGE);
      if (error) throw error;
      if (!data || data.length === 0) break;
      await db.transaction("rw", db.calculs, async () => {
        for (const row of data as Record<string, unknown>[]) {
          const lr = await db.calculs.get(row.id as string);
          if (lr && lr._dirty === 1) continue;
          await db.calculs.put({ ...(row as object), _dirty: 0 } as never);
          pulled++;
        }
      });
      ckpt = (data[data.length - 1] as Record<string, string>).updated_at;
      await metaSet("ckpt_calculs", ckpt);
      if (data.length < PAGE) break;
    }
  } catch (e) { err = (err ? err + " | " : "") + "pull: " + errText(e); }
  const msg = err
    ? `Resync calculs ÉCHEC — local ${local}. ${err}`
    : `Resync calculs OK — local ${local}, poussés ${pushed}, tirés ${pulled}.`;
  await logJournal(err ? "erreur" : "info", msg);
  return msg;
}


export async function syncAll(): Promise<void> {
  if (running || !isOnline()) return;
  if (!(await hasSession())) return;
  running = true;
  try {
    await pushDirty(db.modeles, "etalon_modeles");
    await pushDirty(db.etalons, "etalons");
    await pushDirty(db.journal, "journal");
    await pushDirty(db.planning, "planning_jours");
    await pushDirty(db.planning_params, "planning_params");
    try { await pushDirty(db.materiels, "materiels"); } catch { /* table absente */ }
    try { await pushDirty(db.ecme_favoris, "ecme_favoris"); } catch { /* table absente */ }
    let calcOk = true; let calcMsg = "";
    try { await pushDirty(db.calculs, "calculs"); } catch (e) { calcOk = false; calcMsg = "push: " + errText(e); logCalcErr("push", e); }
    // intervention : push des en-têtes AVANT les lignes (FK + RLS parent côté Supabase)
    try { await pushDirty(db.intervention_listings, "intervention_listings"); } catch { /* table absente */ }
    try { await pushDirty(db.intervention_lignes, "intervention_lignes"); } catch { /* table absente */ }
    try { await pushDirty(db.rtr, "rtr"); } catch { /* table absente */ }
    await pullTable(db.modeles, "etalon_modeles", "ckpt_modeles");
    await pullTable(db.etalons, "etalons", "ckpt_etalons");
    await pullTable(db.journal, "journal", "ckpt_journal");
    await pullTable(db.planning, "planning_jours", "ckpt_planning");
    await pullTable(db.planning_params, "planning_params", "ckpt_planning_params");
    // imputations : référence partagée, on ne fait que tirer (import = écriture directe).
    // Protégé : si le schema.sql n'a pas encore été exécuté, on n'interrompt pas le reste.
    try {
      await pullTable(db.imputations, "imputations", "ckpt_imputations");
    } catch {
      /* table imputations absente (schema.sql pas encore appliqué) */
    }
    try {
      await pullTable(db.materiels, "materiels", "ckpt_materiels");
      await pullTable(db.corim_types, "corim_types", "ckpt_corim_types");
    } catch {
      /* tables materiels/corim_types absentes (schema.sql pas encore appliqué) */
    }
    try {
      await pullTable(db.ecme_favoris, "ecme_favoris", "ckpt_ecme_favoris");
    } catch {
      /* table ecme_favoris absente (schema.sql pas encore appliqué) */
    }
    try {
      await pullTable(db.calculs, "calculs", "ckpt_calculs");
    } catch (e) {
      calcOk = false; calcMsg = (calcMsg ? calcMsg + " | " : "") + "pull: " + errText(e); logCalcErr("pull", e);
    }
    try {
      await pullTable(db.intervention_listings, "intervention_listings", "ckpt_interv_listings");
      await pullTable(db.intervention_lignes, "intervention_lignes", "ckpt_interv_lignes");
    } catch {
      /* tables intervention absentes (schema.sql pas encore appliqué) */
    }
    try {
      await pullTable(db.rtr, "rtr", "ckpt_rtr");
    } catch {
      /* table rtr absente (schema.sql pas encore appliqué) */
    }
    if (calcOk) lastCalcErr = null;
    await metaSet("last_calc_sync", `${new Date().toLocaleString("fr-FR")} · ${calcOk ? "OK (synchro auto)" : "ÉCHEC — " + calcMsg}`).catch(() => {});
    // 3) on télécharge les certificats pas encore en cache (pour l'offline)
    await cacheMissingCertificats();
    // 4) photos de frais : on pousse celles capturées hors-ligne, puis on
    //    récupère celles référencées mais absentes du cache local.
    await uploadPendingFrais();
    await cacheMissingFrais();
  } finally {
    running = false;
  }
}

export async function pendingCount(): Promise<number> {
  const [a, b, c, d, e, f, g, h, i] = await Promise.all([
    db.modeles.where("_dirty").equals(1).count(),
    db.etalons.where("_dirty").equals(1).count(),
    db.journal.where("_dirty").equals(1).count(),
    db.planning.where("_dirty").equals(1).count(),
    db.planning_params.where("_dirty").equals(1).count(),
    db.calculs.where("_dirty").equals(1).count(),
    db.intervention_listings.where("_dirty").equals(1).count(),
    db.intervention_lignes.where("_dirty").equals(1).count(),
    db.rtr.where("_dirty").equals(1).count(),
  ]);
  return a + b + c + d + e + f + g + h + i;
}

export async function resetLocal(): Promise<void> {
  await db.transaction(
    "rw",
    [db.modeles, db.etalons, db.journal, db.fichiers, db.planning, db.planning_params, db.frais_photos, db.imputations, db.materiels, db.corim_types, db.ecme_favoris, db.calculs, db.intervention_listings, db.intervention_lignes, db.rtr, db.meta],
    async () => {
      await Promise.all([
        db.modeles.clear(),
        db.etalons.clear(),
        db.journal.clear(),
        db.fichiers.clear(),
        db.planning.clear(),
        db.planning_params.clear(),
        db.frais_photos.clear(),
        db.imputations.clear(),
        db.materiels.clear(),
        db.corim_types.clear(),
        db.ecme_favoris.clear(),
        db.calculs.clear(),
        db.intervention_listings.clear(),
        db.intervention_lignes.clear(),
        db.rtr.clear(),
        db.meta.clear(),
      ]);
    }
  );
}
