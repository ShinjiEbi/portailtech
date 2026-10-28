// Signature au doigt / stylet (canvas), exportée en PNG transparent (data URL).
import { useEffect, useRef, useState } from "react";

export function SignaturePad({ title, onDone, onClose }: { title: string; onDone: (png: string) => void; onClose: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);
  const [empty, setEmpty] = useState(true);

  useEffect(() => {
    const c = ref.current!;
    const r = c.getBoundingClientRect();
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    c.width = Math.round(r.width * dpr); c.height = Math.round(r.height * dpr);
    const ctx = c.getContext("2d")!;
    ctx.scale(dpr, dpr);
    ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.strokeStyle = "#0d1a73"; ctx.lineWidth = 2.6;
  }, []);

  const pos = (e: React.PointerEvent) => { const r = ref.current!.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  function down(e: React.PointerEvent) {
    e.preventDefault(); ref.current!.setPointerCapture(e.pointerId);
    drawing.current = true; last.current = pos(e);
    const ctx = ref.current!.getContext("2d")!; const p = last.current;
    ctx.beginPath(); ctx.arc(p.x, p.y, 1.2, 0, Math.PI * 2); ctx.fillStyle = "#0d1a73"; ctx.fill();
    setEmpty(false);
  }
  function move(e: React.PointerEvent) {
    if (!drawing.current || !last.current) return;
    const ctx = ref.current!.getContext("2d")!; const p = pos(e);
    ctx.beginPath(); ctx.moveTo(last.current.x, last.current.y); ctx.lineTo(p.x, p.y); ctx.stroke();
    last.current = p;
  }
  function up() { drawing.current = false; last.current = null; }
  function clear() {
    const c = ref.current!; c.getContext("2d")!.clearRect(0, 0, c.width, c.height); setEmpty(true);
  }
  // recadre sur le tracé (marge 6 px) pour que la signature remplisse la zone du PDF
  function done() {
    const c = ref.current!; const ctx = c.getContext("2d")!;
    const { data, width, height } = ctx.getImageData(0, 0, c.width, c.height);
    let x0 = width, y0 = height, x1 = -1, y1 = -1;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > 10) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    }
    if (x1 < 0) return;
    const m = 6; x0 = Math.max(0, x0 - m); y0 = Math.max(0, y0 - m); x1 = Math.min(width - 1, x1 + m); y1 = Math.min(height - 1, y1 + m);
    const out = document.createElement("canvas");
    out.width = x1 - x0 + 1; out.height = y1 - y0 + 1;
    out.getContext("2d")!.drawImage(c, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
    onDone(out.toDataURL("image/png"));
  }

  return (
    <div className="pl-overlay sig-overlay">
      <div className="pl-sheet">
        <div className="pl-sheet-head">
          <span className="pl-sheet-title">{title}</span>
          <button className="pl-x" onClick={onClose} aria-label="Fermer">✕</button>
        </div>
        <canvas ref={ref} className="sig-canvas" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onPointerLeave={up} />
        <p className="muted hint">Signe dans le cadre avec le doigt ou un stylet.</p>
        <div className="btn-row">
          <button className="btn" onClick={clear}>Effacer</button>
          <button className="btn btn-primary" onClick={done} disabled={empty}>Valider</button>
        </div>
      </div>
    </div>
  );
}
