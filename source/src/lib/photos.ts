// Documents de contrôle technique joints à une ligne : photos (redimensionnées 1000 px,
// JPEG ≈ 60–120 ko), PDF, HTML et texte (stockés tels quels, 3 Mo max).
import type { LignePhoto } from "./types";

const MAX = 1000, QUALITY = 0.6;
export const DOC_MAX_BYTES = 3 * 1024 * 1024;
export const DOC_ACCEPT = "image/*,application/pdf,.pdf,text/html,.html,.htm,text/plain,.txt,.csv,.log";

export type DocKind = "image" | "pdf" | "html" | "texte" | "autre";
export function docKind(d: Pick<LignePhoto, "data" | "mime" | "name">): DocKind {
  const m = (d.mime || d.data.slice(5, d.data.indexOf(";")) || "").toLowerCase();
  const n = (d.name || "").toLowerCase();
  if (m.startsWith("image/")) return "image";
  if (m === "application/pdf" || n.endsWith(".pdf")) return "pdf";
  if (m === "text/html" || /\.html?$/.test(n)) return "html";
  if (m.startsWith("text/") || /\.(txt|csv|log)$/.test(n)) return "texte";
  return "autre";
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); res(img); };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error("Image illisible")); };
    img.src = url;
  });
}
const readAsDataUrl = (f: Blob) => new Promise<string>((res, rej) => {
  const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = () => rej(r.error); r.readAsDataURL(f);
});

export async function photoFromFile(file: File): Promise<LignePhoto> {
  const base = { id: crypto.randomUUID(), ts: new Date().toISOString(), name: file.name };
  if (file.type.startsWith("image/")) {
    const img = await loadImage(file); // l'orientation EXIF est appliquée par le navigateur
    const k = Math.min(1, MAX / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement("canvas");
    c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
    c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
    return { ...base, data: c.toDataURL("image/jpeg", QUALITY), mime: "image/jpeg" };
  }
  if (file.size > DOC_MAX_BYTES) throw new Error(`${file.name} : trop volumineux (${(file.size / 1048576).toFixed(1)} Mo, max 3 Mo)`);
  const n = file.name.toLowerCase();
  const mime = file.type || (n.endsWith(".pdf") ? "application/pdf" : /\.html?$/.test(n) ? "text/html" : "text/plain");
  const data = await readAsDataUrl(new Blob([file], { type: mime }));
  return { ...base, data, mime };
}

export function dataUrlToBlob(d: string): Blob {
  const [head, b64] = d.split(",");
  const mime = head.slice(5).split(";")[0] || "application/octet-stream";
  const bin = atob(b64); const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return new Blob([u], { type: mime });
}
export async function dataUrlText(d: string): Promise<string> {
  return await dataUrlToBlob(d).text();
}
