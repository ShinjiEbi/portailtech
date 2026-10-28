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

// Identifiant utilisateur : session live, sinon le dernier connu sur l'appareil (hors-ligne /
// session expirée) — pour que les saisies hors-ligne restent rattachées au bon compte.
export const UID_KEY = "portail-tech-uid";
export async function currentUserId(): Promise<string | null> {
  try {
    const { data } = await supabase.auth.getSession();
    const id = data.session?.user.id ?? null;
    if (id) { try { localStorage.setItem(UID_KEY, id); } catch { /* ignore */ } return id; }
  } catch { /* hors-ligne */ }
  try { return localStorage.getItem(UID_KEY); } catch { return null; }
}

// Lignes créées hors-ligne sans utilisateur : on les rattache au compte connecté avant l'envoi
// (sinon refus RLS). updated_at n'est pas modifié.
async function adoptOrphans(uid: string): Promise<void> {
  for (const t of [db.intervention_listings, db.intervention_lignes, db.constats, db.rtr_iz, db.calculs] as Table<any, string>[]) {
    const rows = await t.where("_dirty").equals(1).toArray();
    const pk = ((t.schema?.primKey?.keyPath as string) || "id");
    for (const r of rows) if (!r.user_id) await t.update(r[pk], { user_id: uid });
  }
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
async function pushDirty(local: Table<any, string>, remote: string, omit: string[] = []): Promise<number> {
  const dirty = await local.where("_dirty").equals(1).toArray();
  if (dirty.length === 0) return 0;
  const pk = ((local.schema?.primKey?.keyPath as string) || "id");
  let done = 0;
  // par paquets (photos / constats peuvent être lourds)
  for (let i = 0; i < dirty.length; i += 50) {
    const chunk = dirty.slice(i, i + 50);
    const payload = chunk.map(({ _dirty, updated_at, ...row }) => { for (const k of omit) delete (row as Record<string, unknown>)[k]; return row; });
    const { error } = await supabase.from(remote).upsert(payload);
    if (error) throw error;
    // on ne marque « synchronisé » que si la ligne n'a pas été re-modifiée pendant l'envoi
    await db.transaction("rw", local, async () => {
      for (const row of chunk) {
        const cur = await local.get((row as any)[pk]);
        if (cur && cur.updated_at === (row as any).updated_at) await local.update((row as any)[pk], { _dirty: 0 });
      }
    });
    done += chunk.length;
  }
  return done;
}

// ---- pull : Supabase -> local (incrémental via curseur updated_at) --------
async function pullTable(local: Table<any, string>, remote: string, ckptKey: string): Promise<number> {
  const pk = ((local.schema?.primKey?.keyPath as string) || "id");
  let ckpt = (await metaGet(ckptKey)) ?? EPOCH;
  let n = 0;
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
        n++;
      }
    });
    ckpt = (data[data.length - 1] as any).updated_at;
    await metaSet(ckptKey, ckpt);
    if (data.length < PAGE) break;
  }
  return n;
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


// ---- synchronisation complète ---------------------------------------------
// Chaque table est traitée indépendamment : une erreur sur l'une n'empêche plus les autres.
// Les appels concurrents sont regroupés : si une synchro est en cours, une nouvelle passe
// est enchaînée à la fin (aucune modification ne reste en attente).
export interface SyncReport {
  at: string;
  status: "ok" | "erreur" | "hors_ligne" | "non_connecte";
  pushed: number;
  pulled: number;
  errors: string[];
}
export const LAST_SYNC_REPORT = "last_sync_report";

let current: Promise<SyncReport> | null = null;
let again = false;

export function syncAll(): Promise<SyncReport> {
  if (current) { again = true; return current; }
  current = (async () => {
    let r: SyncReport;
    let n = 0;
    do { again = false; r = await runSync(); } while (again && r.status === "ok" && ++n < 3);
    return r;
  })().finally(() => { current = null; });
  return current;
}
export const syncRunning = () => current != null;

async function runSync(): Promise<SyncReport> {
  const at = new Date().toISOString();
  const rep: SyncReport = { at, status: "ok", pushed: 0, pulled: 0, errors: [] };
  if (!isOnline()) { rep.status = "hors_ligne"; return rep; }
  if (!(await hasSession())) { rep.status = "non_connecte"; await metaSet(LAST_SYNC_REPORT, JSON.stringify(rep)).catch(() => {}); return rep; }
  running = true;
  try { const uid = await currentUserId(); if (uid) await adoptOrphans(uid); } catch { /* ignore */ }
  const absent = (e: unknown) => /PGRST205|42P01|Could not find the table|relation "[^"]*" does not exist/i.test(errText(e));
  async function push(lbl: string, t: Table<any, string>, remote: string, optional = false) {
    try { rep.pushed += await pushDirty(t, remote); }
    catch (e) {
      if (remote === "intervention_lignes" && /imprime_le|photos/.test(errText(e))) {
        try { rep.pushed += await pushDirty(t, remote, ["imprime_le", "photos"]); return; } catch (e2) { e = e2; }
      }
      if (optional && absent(e)) return;
      rep.errors.push(`${lbl} (envoi) : ${errText(e)}`);
      if (remote === "calculs") logCalcErr("push", e);
    }
  }
  async function pull(lbl: string, t: Table<any, string>, remote: string, ck: string, optional = false) {
    try { rep.pulled += await pullTable(t, remote, ck); }
    catch (e) {
      if (optional && absent(e)) return;
      rep.errors.push(`${lbl} (réception) : ${errText(e)}`);
      if (remote === "calculs") logCalcErr("pull", e);
    }
  }
  try {
    // envoi (parents avant enfants : FK + RLS)
    await push("Modèles", db.modeles, "etalon_modeles");
    await push("ECME", db.etalons, "etalons");
    await push("Journal", db.journal, "journal");
    await push("Planning", db.planning, "planning_jours");
    await push("Paramètres planning", db.planning_params, "planning_params");
    await push("Matériels", db.materiels, "materiels", true);
    await push("Favoris ECME", db.ecme_favoris, "ecme_favoris", true);
    await push("Calculs", db.calculs, "calculs", true);
    await push("Listings", db.intervention_listings, "intervention_listings", true);
    await push("Lignes d'intervention", db.intervention_lignes, "intervention_lignes", true);
    await push("Bibliothèque IZ", db.rtr_iz, "rtr_iz", true);
    await push("Constats", db.constats, "constats", true);
    // réception
    await pull("Modèles", db.modeles, "etalon_modeles", "ckpt_modeles");
    await pull("ECME", db.etalons, "etalons", "ckpt_etalons");
    await pull("Journal", db.journal, "journal", "ckpt_journal");
    await pull("Planning", db.planning, "planning_jours", "ckpt_planning");
    await pull("Paramètres planning", db.planning_params, "planning_params", "ckpt_planning_params");
    await pull("Imputations", db.imputations, "imputations", "ckpt_imputations", true);
    await pull("Matériels", db.materiels, "materiels", "ckpt_materiels", true);
    await pull("Types Corim", db.corim_types, "corim_types", "ckpt_corim_types", true);
    await pull("Favoris ECME", db.ecme_favoris, "ecme_favoris", "ckpt_ecme_favoris", true);
    await pull("Calculs", db.calculs, "calculs", "ckpt_calculs", true);
    await pull("Listings", db.intervention_listings, "intervention_listings", "ckpt_interv_listings", true);
    await pull("Lignes d'intervention", db.intervention_lignes, "intervention_lignes", "ckpt_interv_lignes", true);
    await pull("Bibliothèque IZ", db.rtr_iz, "rtr_iz", "ckpt_rtr_iz", true);
    await pull("Constats", db.constats, "constats", "ckpt_constats", true);
    const calcErr = rep.errors.filter((x) => x.startsWith("Calculs"));
    if (!calcErr.length) lastCalcErr = null;
    await metaSet("last_calc_sync", `${new Date().toLocaleString("fr-FR")} · ${calcErr.length ? "ÉCHEC — " + calcErr.join(" | ") : "OK (synchro auto)"}`).catch(() => {});
    // fichiers : certificats (cache offline), photos de frais (envoi différé + cache)
    try { await cacheMissingCertificats(); } catch (e) { rep.errors.push(`Certificats : ${errText(e)}`); }
    try { await uploadPendingFrais(); await cacheMissingFrais(); } catch (e) { rep.errors.push(`Photos de frais : ${errText(e)}`); }
  } finally {
    running = false;
  }
  if (rep.errors.length) rep.status = "erreur";
  await metaSet(LAST_SYNC_REPORT, JSON.stringify(rep)).catch(() => {});
  if (rep.status === "ok") await metaSet("last_sync", at).catch(() => {});
  return rep;
}

export async function pendingCount(): Promise<number> {
  const [a, b, c, d, e, f, g, h, i, j] = await Promise.all([
    db.modeles.where("_dirty").equals(1).count(),
    db.etalons.where("_dirty").equals(1).count(),
    db.journal.where("_dirty").equals(1).count(),
    db.planning.where("_dirty").equals(1).count(),
    db.planning_params.where("_dirty").equals(1).count(),
    db.calculs.where("_dirty").equals(1).count(),
    db.intervention_listings.where("_dirty").equals(1).count(),
    db.intervention_lignes.where("_dirty").equals(1).count(),
    db.rtr_iz.where("_dirty").equals(1).count(),
    db.constats.where("_dirty").equals(1).count(),
  ]);
  const [k, l] = await Promise.all([
    db.materiels.where("_dirty").equals(1).count(),
    db.ecme_favoris.where("_dirty").equals(1).count(),
  ]);
  return a + b + c + d + e + f + g + h + i + j + k + l;
}

export async function resetLocal(): Promise<void> {
  await db.transaction(
    "rw",
    [db.modeles, db.etalons, db.journal, db.fichiers, db.planning, db.planning_params, db.frais_photos, db.imputations, db.materiels, db.corim_types, db.ecme_favoris, db.calculs, db.intervention_listings, db.intervention_lignes, db.rtr_iz, db.constats, db.meta],
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
        db.rtr_iz.clear(),
        db.constats.clear(),
        db.meta.clear(),
      ]);
    }
  );
}
