// Photos de notes de frais : offline-first.
// À la capture, on réduit l'image puis on stocke le Blob en local (pending=1) :
// utilisable tout de suite, même hors-ligne. uploadPendingFrais() pousse vers
// Supabase Storage (bucket "frais") dès qu'il y a du réseau (appelé par syncAll).
// La ligne du jour ne stocke que le chemin (photo_path) -> reste légère.
import { db } from "./db";
import { supabase } from "./supabase";

const BUCKET = "frais";
const online = () => (typeof navigator === "undefined" ? true : navigator.onLine);

async function uid(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.user.id ?? null;
}

// --- réduction d'image mémoire-safe -----------------------------------------
// Sur Android, décoder une photo plein format (12 à 108 Mpx) sature la RAM du
// WebView et fait redémarrer l'appli. On lit d'abord les dimensions dans
// l'EN-TÊTE du fichier (sans décoder), puis on demande à createImageBitmap un
// décodage DÉJÀ réduit à la cible (décodage à l'échelle côté navigateur), en
// bornant le plus grand côté. imageOrientation:"none" garde les dimensions de
// l'en-tête (pas de distorsion). Les captures sont sérialisées (jamais deux
// décodages simultanés). Le canvas est libéré juste après l'export JPEG.

// Sérialise les réductions : deux captures en parallèle = deux décodages = OOM.
let _chain: Promise<unknown> = Promise.resolve();
function serialize<T>(fn: () => Promise<T>): Promise<T> {
  const run = _chain.then(fn, fn);
  _chain = run.catch(() => {});
  return run as Promise<T>;
}

// Dimensions d'un JPEG/PNG depuis les premiers Ko, SANS décoder l'image.
async function readImageSize(file: File): Promise<{ w: number; h: number } | null> {
  try {
    const buf = new Uint8Array(await file.slice(0, 256 * 1024).arrayBuffer());
    // PNG : signature 89 50 4E 47, IHDR -> largeur/hauteur (BE) aux offsets 16/20
    if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
      const w = (buf[16] << 24) | (buf[17] << 16) | (buf[18] << 8) | buf[19];
      const h = (buf[20] << 24) | (buf[21] << 16) | (buf[22] << 8) | buf[23];
      return w > 0 && h > 0 ? { w, h } : null;
    }
    // JPEG : FFD8 puis saut des segments jusqu'au marqueur SOF (Cx)
    if (buf[0] === 0xff && buf[1] === 0xd8) {
      let i = 2;
      while (i + 9 < buf.length) {
        if (buf[i] !== 0xff) { i++; continue; }
        let marker = buf[i + 1];
        while (marker === 0xff && i + 2 < buf.length) { i++; marker = buf[i + 1]; }
        if ((marker >= 0xd0 && marker <= 0xd9) || marker === 0x01) { i += 2; continue; } // sans longueur
        const len = (buf[i + 2] << 8) | buf[i + 3];
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          const h = (buf[i + 5] << 8) | buf[i + 6];
          const w = (buf[i + 7] << 8) | buf[i + 8];
          return w > 0 && h > 0 ? { w, h } : null;
        }
        if (len < 2) break;
        i += 2 + len;
      }
    }
  } catch { /* en-tête illisible : on laisse createImageBitmap gérer */ }
  return null;
}

async function downscale(file: File, maxDim = 1100, quality = 0.6): Promise<Blob> {
  return serialize(async () => {
    const drawScaled = (src: CanvasImageSource, w: number, h: number): Promise<Blob> => {
      const scale = Math.min(1, maxDim / Math.max(w || maxDim, h || maxDim));
      const cw = Math.max(1, Math.round((w || maxDim) * scale));
      const ch = Math.max(1, Math.round((h || maxDim) * scale));
      const canvas = document.createElement("canvas");
      canvas.width = cw;
      canvas.height = ch;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("canvas 2d indisponible");
      ctx.drawImage(src, 0, 0, cw, ch);
      return new Promise<Blob>((res, rej) => {
        canvas.toBlob(
          (b) => {
            canvas.width = 0; canvas.height = 0; // libère le buffer du canvas
            b ? res(b) : rej(new Error("toBlob a échoué"));
          },
          "image/jpeg",
          quality
        );
      });
    };

    const size = await readImageSize(file);

    // Voie privilégiée : createImageBitmap avec cible de décodage réduite.
    if (typeof createImageBitmap === "function") {
      let opts: ImageBitmapOptions = { imageOrientation: "none", resizeQuality: "medium" };
      if (size) {
        const scale = Math.min(1, maxDim / Math.max(size.w, size.h));
        opts = { ...opts, resizeWidth: Math.max(1, Math.round(size.w * scale)), resizeHeight: Math.max(1, Math.round(size.h * scale)) };
      } else {
        opts = { ...opts, resizeWidth: maxDim };
      }
      try {
        const bmp = await createImageBitmap(file, opts);
        try { return await drawScaled(bmp, bmp.width, bmp.height); }
        finally { bmp.close?.(); }
      } catch {
        // options refusées par le moteur : tentative minimale puis repli <img>
        try {
          const bmp = await createImageBitmap(file, { imageOrientation: "none" } as ImageBitmapOptions);
          try { return await drawScaled(bmp, bmp.width, bmp.height); }
          finally { bmp.close?.(); }
        } catch { /* on bascule sur le repli <img> ci-dessous */ }
      }
    }

    // Repli : <img> + objectURL.
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise<HTMLImageElement>((res, rej) => {
        const im = new Image();
        im.onload = () => res(im);
        im.onerror = () => rej(new Error("image illisible"));
        im.src = url;
      });
      return await drawScaled(img, img.naturalWidth, img.naturalHeight);
    } finally {
      URL.revokeObjectURL(url);
    }
  });
}

// Un justificatif est un PDF ?
const fileIsPdf = (f: { type?: string; name?: string }) =>
  (f.type || "").toLowerCase() === "application/pdf" || /\.pdf$/i.test(f.name || "");
export function fraisIsPdf(path: string): boolean {
  return /\.pdf$/i.test(path);
}

// Ajout d'un justificatif (offline OK) : image -> réduite en JPEG ; PDF -> tel quel.
// Stocké en local (pending=1, utilisable tout de suite) puis poussé si en ligne.
export async function addFraisPhoto(
  date: string,
  fraisId: string,
  file: File
): Promise<{ path: string; nom: string }> {
  const u = await uid();
  if (!u) throw new Error("Non connecté : impossible d'ajouter un justificatif.");
  let blob: Blob, ext: string, type: string;
  if (fileIsPdf(file)) {
    if (file.size > 15 * 1024 * 1024) throw new Error("PDF trop volumineux (max 15 Mo).");
    blob = file; ext = "pdf"; type = "application/pdf";
  } else {
    blob = await downscale(file); ext = "jpg"; type = "image/jpeg";
  }
  const path = `${u}/${date}/${fraisId}.${ext}`;
  const nom = file.name || (ext === "pdf" ? "justificatif.pdf" : "photo.jpg");
  await db.frais_photos.put({
    path, blob, nom, type, pending: 1, updated_at: new Date().toISOString(),
  });
  if (online()) {
    try {
      await supabase.storage.from(BUCKET).upload(path, blob, { upsert: true, contentType: type });
      await db.frais_photos.update(path, { pending: 0 });
    } catch {
      /* reste pending : repoussé à la prochaine sync */
    }
  }
  return { path, nom };
}

// Migration : une photo en base64 (dataURL) venant de l'ancien outil -> Storage.
// On décode via fetch(dataURL) (déjà un JPEG, pas de ré-encodage) puis on stocke
// en pending (uploadé à la sync, comme une capture hors-ligne).
export async function importFraisPhoto(date: string, fraisId: string, dataUrl: string): Promise<string> {
  const u = await uid();
  if (!u) throw new Error("Non connecté : impossible d'importer une photo.");
  const blob = await (await fetch(dataUrl)).blob();
  const path = `${u}/${date}/${fraisId}.jpg`;
  await db.frais_photos.put({
    path, blob, nom: "import.jpg", type: blob.type || "image/jpeg",
    pending: 1, updated_at: new Date().toISOString(),
  });
  if (online()) {
    try {
      await supabase.storage.from(BUCKET).upload(path, blob, { upsert: true, contentType: blob.type || "image/jpeg" });
      await db.frais_photos.update(path, { pending: 0 });
    } catch { /* reste pending */ }
  }
  return path;
}

// URL ouvrable : cache local d'abord (offline OK), sinon téléchargée depuis Storage.
export async function fraisPhotoUrl(path: string): Promise<string | null> {
  const f = await db.frais_photos.get(path);
  if (f) return URL.createObjectURL(f.blob);
  if (!online()) return null;
  const { data, error } = await supabase.storage.from(BUCKET).download(path);
  if (error || !data) return null;
  await db.frais_photos.put({
    path, blob: data, nom: path.split("/").pop() ?? "photo.jpg",
    type: data.type, pending: 0, updated_at: new Date().toISOString(),
  });
  return URL.createObjectURL(data);
}

export async function deleteFraisPhoto(path: string): Promise<void> {
  try {
    if (online()) await supabase.storage.from(BUCKET).remove([path]);
  } catch {
    /* hors-ligne : l'objet cloud restera, sans référence */
  }
  await db.frais_photos.delete(path);
}

// Pousse les photos capturées hors-ligne vers Storage (appelé par syncAll).
export async function uploadPendingFrais(): Promise<void> {
  if (!online()) return;
  const pend = await db.frais_photos.where("pending").equals(1).toArray();
  for (const f of pend) {
    try {
      await supabase.storage.from(BUCKET).upload(f.path, f.blob, {
        upsert: true,
        contentType: f.type || "image/jpeg",
      });
      await db.frais_photos.update(f.path, { pending: 0 });
    } catch {
      /* on réessaiera au prochain passage */
    }
  }
}

// Télécharge les photos référencées par les jours mais absentes du cache
// (pour les consulter hors-ligne sur un autre appareil). Appelé après le pull.
export async function cacheMissingFrais(): Promise<void> {
  if (!online()) return;
  const jours = await db.planning.toArray();
  const paths = new Set<string>();
  for (const j of jours) {
    if (j.deleted) continue;
    for (const fr of j.frais ?? []) if (fr.photo_path) paths.add(fr.photo_path);
  }
  for (const path of paths) {
    if (await db.frais_photos.get(path)) continue;
    try {
      const { data } = await supabase.storage.from(BUCKET).download(path);
      if (data) {
        await db.frais_photos.put({
          path, blob: data, nom: path.split("/").pop() ?? "photo.jpg",
          type: data.type, pending: 0, updated_at: new Date().toISOString(),
        });
      }
    } catch {
      /* on saute cette photo */
    }
  }
}
