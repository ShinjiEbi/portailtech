import { formatKBq, formatPeriode, type DecayResult } from "../lib/decay";

function fmtPps(v: number): string {
  return Math.round(v).toLocaleString("fr-FR") + " pps";
}

// Bloc "valeurs du jour" mis en évidence : activité + flux décrus (sources).
export function ActiviteJour({ d, compact }: { d: DecayResult; compact?: boolean }) {
  const pct = Math.round((d.frac ?? 0) * 100);
  return (
    <div className={`act-highlight ${compact ? "compact" : ""}`}>
      <div className="act-head">
        <span className="act-lbl">Valeurs du jour</span>
        <span className="act-rn">{d.rn}</span>
      </div>
      {d.act != null && <div className="act-val">{formatKBq(d.act)}</div>}
      {d.act != null && (
        <div className="act-bar">
          <i style={{ width: `${Math.max(2, Math.min(100, pct))}%` }} />
        </div>
      )}
      {d.fluxes.map((f, i) => (
        <div className="act-flux" key={i}>
          <span className="act-flux-lbl">{f.label}</span>
          <span className="act-flux-val">{fmtPps(f.value)}</span>
        </div>
      ))}
      <div className="act-pct">
        {pct}% de l'activité initiale
        {d.periode ? ` · période ${formatPeriode(d.periode)}` : ""}
      </div>
    </div>
  );
}
