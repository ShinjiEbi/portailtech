import { useEffect, useRef, useState } from "react";
import { startScan, type ScanController } from "../lib/scanner";

interface Props {
  title?: string;
  allowContinuous?: boolean;   // affiche le bouton "Rafale" (scan en continu)
  defaultContinuous?: boolean;
  onDetected: (text: string, format: string) => void; // appelé à chaque code accepté
  onClose: () => void;
}

function humanError(e: Error): string {
  const n = (e?.name ?? "") + "";
  if (n === "NotAllowedError" || n === "SecurityError") return "Accès caméra refusé. Autorise la caméra puis rouvre le scanner.";
  if (n === "NotFoundError" || n === "OverconstrainedError") return "Aucune caméra disponible sur cet appareil.";
  if (n === "NotReadableError") return "La caméra est déjà utilisée par une autre application.";
  return "Impossible de démarrer la caméra." + (e?.message ? " " + e.message : "");
}

export function ScannerModal({ title = "Scanner un code", allowContinuous = false, defaultContinuous = false, onDetected, onClose }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const ctrlRef = useRef<ScanController | null>(null);
  const lastHit = useRef<{ text: string; t: number }>({ text: "", t: 0 });
  const continuousRef = useRef(defaultContinuous);

  const [err, setErr] = useState("");
  const [engine, setEngine] = useState("");
  const [torchOn, setTorchOn] = useState(false);
  const [hasTorch, setHasTorch] = useState(false);
  const [zoom, setZoom] = useState<{ min: number; max: number; step: number } | null>(null);
  const [zoomVal, setZoomVal] = useState(1);
  const [continuous, setContinuous] = useState(defaultContinuous);
  const [toast, setToast] = useState("");

  useEffect(() => { continuousRef.current = continuous; }, [continuous]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const c = await startScan(videoRef.current!, handleResult, { onError: () => {} });
        if (cancelled) { c.stop(); return; }
        ctrlRef.current = c;
        setEngine(c.engine);
        setHasTorch(c.hasTorch());
        const zr = c.zoomRange();
        setZoom(zr);
        if (zr) setZoomVal(zr.min <= 1 && zr.max >= 1 ? 1 : zr.min);
      } catch (e) {
        setErr(humanError(e as Error));
      }
    })();
    return () => { cancelled = true; ctrlRef.current?.stop(); ctrlRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleResult(text: string, format: string) {
    const now = Date.now();
    // dédup : ignore le même code revu < 2 s (évite les doublons, surtout en rafale)
    if (text === lastHit.current.text && now - lastHit.current.t < 2000) return;
    lastHit.current = { text, t: now };
    try { navigator.vibrate?.(60); } catch { /* ignore */ }
    onDetected(text, format);
    if (continuousRef.current) {
      setToast("✓ " + text);
      window.setTimeout(() => setToast(""), 1200);
    } else {
      doClose();
    }
  }

  function doClose() {
    ctrlRef.current?.stop();
    ctrlRef.current = null;
    onClose();
  }

  async function onTorch() {
    const c = ctrlRef.current; if (!c) return;
    setTorchOn(await c.toggleTorch());
  }
  function onZoom(v: number) {
    setZoomVal(v);
    ctrlRef.current?.setZoom(v);
  }

  return (
    <div className="scan-overlay" role="dialog" aria-modal="true">
      <div className="scan-topbar">
        <span className="scan-title">{title}</span>
        <button type="button" className="scan-x" onClick={doClose} aria-label="Fermer">✕</button>
      </div>

      <div className="scan-stage">
        <video ref={videoRef} className="scan-video" playsInline muted />
        {!err && <div className="scan-frame" />}
        {toast && <div className="scan-toast">{toast}</div>}
        {err && (
          <div className="scan-err">
            <p>{err}</p>
            <button type="button" className="btn btn-primary" onClick={doClose}>Fermer</button>
          </div>
        )}
      </div>

      {!err && (
        <div className="scan-controls">
          {hasTorch && (
            <button type="button" className={`btn btn-mini ${torchOn ? "on" : ""}`} onClick={onTorch}>
              {torchOn ? "🔦 Torche ON" : "🔦 Torche"}
            </button>
          )}
          {zoom && (
            <label className="scan-zoom">
              <span>Zoom</span>
              <input type="range" min={zoom.min} max={zoom.max} step={zoom.step} value={zoomVal} onChange={(e) => onZoom(Number(e.target.value))} />
            </label>
          )}
          {allowContinuous && (
            <button type="button" className={`btn btn-mini ${continuous ? "on" : ""}`} onClick={() => setContinuous((v) => !v)}>
              {continuous ? "Rafale ON" : "Rafale"}
            </button>
          )}
          {engine && <span className="scan-engine">{engine === "native" ? "moteur natif" : "moteur ZXing"}</span>}
        </div>
      )}

      <p className="scan-hint">Vise le QR ou le code-barres — détection automatique, tous formats.</p>
    </div>
  );
}
