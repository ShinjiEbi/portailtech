import { db } from "./db";
import { supabase } from "./supabase";

const BUCKET = "certificats";
const online = () => (typeof navigator === "undefined" ? true : navigator.onLine);

// Télécharge un fichier depuis Storage et le met en cache local (Dexie).
export async function downloadAndCache(path: string, nom?: string): Promise<Blob | null> {
  const { data, error } = await supabase.storage.from(BUCKET).download(path);
  if (error || !data) return null;
  await db.fichiers.put({
    path,
    blob: data,
    nom: nom ?? path.split("/").pop() ?? "certificat",
    type: data.type,
    updated_at: new Date().toISOString(),
  });
  return data;
}

// Upload (réseau requis) + mise en cache immédiate.
export async function uploadCertificat(etalonId: string, file: File): Promise<{ path: string; nom: string }> {
  const dot = file.name.lastIndexOf(".");
  const ext = dot >= 0 ? file.name.slice(dot) : "";
  const path = `${etalonId}/certificat${ext}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
    upsert: true,
    contentType: file.type || "application/octet-stream",
  });
  if (error) throw error;
  await db.fichiers.put({ path, blob: file, nom: file.name, type: file.type, updated_at: new Date().toISOString() });
  return { path, nom: file.name };
}

// URL ouvrable : depuis le cache si dispo (offline OK), sinon téléchargée.
export async function certificatObjectUrl(path: string, nom?: string): Promise<string | null> {
  const f = await db.fichiers.get(path);
  if (f) return URL.createObjectURL(f.blob);
  if (!online()) return null;
  const blob = await downloadAndCache(path, nom);
  return blob ? URL.createObjectURL(blob) : null;
}

export async function deleteCertificat(path: string): Promise<void> {
  try {
    await supabase.storage.from(BUCKET).remove([path]);
  } catch {
    /* hors-ligne : l'objet cloud restera, sans référence */
  }
  await db.fichiers.delete(path);
}

// Télécharge tous les certificats encore absents du cache (appelé après le pull).
export async function cacheMissingCertificats(): Promise<void> {
  if (!online()) return;
  const etalons = await db.etalons.toArray();
  for (const e of etalons as any[]) {
    if (e.deleted || !e.certificat_path) continue;
    const have = await db.fichiers.get(e.certificat_path);
    if (have) continue;
    try {
      await downloadAndCache(e.certificat_path, e.certificat_nom);
    } catch {
      /* on saute ce fichier */
    }
  }
}
