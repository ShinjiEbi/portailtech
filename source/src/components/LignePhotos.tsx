// Documents d'une ligne d'intervention (photos, PDF, HTML, texte) — même liste affichée dans la
// ligne et dans le constat. Prise de photo directe, ajout de fichiers, aperçu, légende, suppression.
import { useEffect, useRef, useState } from "react";
import { DOC_ACCEPT, dataUrlText, dataUrlToBlob, docKind, photoFromFile } from "../lib/photos";
import type { LignePhoto } from "../lib/types";

const ICO = { pdf: "📄", html: "🌐", texte: "📝", autre: "📎", image: "🖼" } as const;

export function LignePhotos({ photos, onChange, readOnly }: { photos: LignePhoto[]; onChange?: (p: LignePhoto[]) => void; readOnly?: boolean }) {
  const camRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [view, setView] = useState<LignePhoto | null>(null);

  async function add(files: FileList | null) {
    if (!files?.length || !onChange) return;
    setBusy(true); setErr("");
    try {
      const added: LignePhoto[] = []; const ko: string[] = [];
      for (const f of Array.from(files)) { try { added.push(await photoFromFile(f)); } catch (e) { ko.push(e instanceof Error ? e.message : f.name); } }
      if (added.length) onChange([...photos, ...added]);
      if (ko.length) setErr(ko.join(" · "));
    } finally { setBusy(false); }
  }
  const fmt = (iso: string) => new Date(iso).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

  return (
    <div className="lp">
      {!readOnly && (
        <div className="lp-actions">
          <button type="button" className="btn btn-mini" disabled={busy} onClick={() => camRef.current?.click()}>📷 Photo</button>
          <button type="button" className="btn btn-mini" disabled={busy} onClick={() => fileRef.current?.click()}>📎 Fichier</button>
          {busy && <span className="muted">ajout…</span>}
          <input ref={camRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { add(e.target.files); e.target.value = ""; }} />
          <input ref={fileRef} type="file" accept={DOC_ACCEPT} multiple hidden onChange={(e) => { add(e.target.files); e.target.value = ""; }} />
        </div>
      )}
      {err && <p className="error">{err}</p>}
      {photos.length > 0 ? (
        <div className="lp-grid">
          {photos.map((p) => {
            const k = docKind(p);
            return (
              <button type="button" key={p.id} className="lp-thumb" onClick={() => setView(p)} title={p.name}>
                {k === "image" ? <img src={p.data} alt={p.note || "photo"} /> : (
                  <span className="lp-file"><span className="lp-ico">{ICO[k]}</span><span className="lp-fname">{p.name || k.toUpperCase()}</span></span>
                )}
                {p.note && <span className="lp-note">{p.note}</span>}
              </button>
            );
          })}
        </div>
      ) : readOnly ? <p className="muted hint">Aucun document sur cette ligne.</p> : null}

      {view && <DocViewer doc={view} readOnly={readOnly || !onChange} fmt={fmt}
        onNote={(note) => { const n = { ...view, note }; setView(n); onChange?.(photos.map((x) => (x.id === n.id ? n : x))); }}
        onDelete={() => { if (confirm("Supprimer ce document ?")) { onChange?.(photos.filter((x) => x.id !== view.id)); setView(null); } }}
        onClose={() => setView(null)} />}
    </div>
  );
}

function DocViewer({ doc, readOnly, fmt, onNote, onDelete, onClose }: {
  doc: LignePhoto; readOnly: boolean; fmt: (s: string) => string; onNote: (n: string) => void; onDelete: () => void; onClose: () => void;
}) {
  const k = docKind(doc);
  const [text, setText] = useState<string | null>(null);
  useEffect(() => { if (k === "html" || k === "texte") dataUrlText(doc.data).then(setText).catch(() => setText("")); }, [doc.data, k]);
  function openExt() {
    const url = URL.createObjectURL(dataUrlToBlob(doc.data));
    const a = document.createElement("a"); a.href = url; a.target = "_blank"; a.rel = "noopener";
    if (k !== "pdf") a.download = doc.name || "document";
    a.click(); setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
  return (
    <div className="lp-view" onClick={(e) => e.target === e.currentTarget && onClose()}>
      {k === "image" && <img src={doc.data} alt="" />}
      {k === "html" && text != null && <iframe className="lp-frame" sandbox="" srcDoc={text} title={doc.name} />}
      {k === "texte" && text != null && <pre className="lp-pre">{text}</pre>}
      {(k === "pdf" || k === "autre") && (
        <div className="lp-pdf"><div className="lp-ico big">{ICO[k]}</div><div>{doc.name}</div>
          <button type="button" className="btn btn-primary" onClick={openExt}>Ouvrir</button></div>
      )}
      <div className="lp-view-bar">
        <span className="muted">{fmt(doc.ts)}</span>
        {!readOnly && <input value={doc.note ?? ""} placeholder="Légende (ex. paramètres HT)" onChange={(e) => onNote(e.target.value)} />}
        {k !== "pdf" && k !== "image" && <button type="button" className="btn btn-mini" onClick={openExt} title="Ouvrir / télécharger">⤓</button>}
        {!readOnly && <button type="button" className="btn btn-mini" onClick={onDelete}>🗑</button>}
        <button type="button" className="btn btn-mini" onClick={onClose}>✕</button>
      </div>
    </div>
  );
}
