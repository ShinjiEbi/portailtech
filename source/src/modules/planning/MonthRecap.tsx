import { isWorked } from "../../lib/planning";
import type { PlanningJour } from "../../lib/types";

const nf = (v: number, d = 1) =>
  v.toLocaleString("fr-FR", { minimumFractionDigits: 0, maximumFractionDigits: d });

function fraisSum(j: PlanningJour): number {
  return (j.frais ?? []).reduce((s, f) => s + (Number(f.montant) || 0), 0);
}

export function MonthRecap({ jours }: { jours: PlanningJour[] }) {
  const worked = jours.filter((j) => isWorked(j.type));
  const sum = (sel: (j: PlanningJour) => number | null | undefined) =>
    jours.reduce((s, j) => s + (Number(sel(j)) || 0), 0);

  const joursTrav = worked.length;
  const hNorm = sum((j) => j.h_norm);
  const hSupp = sum((j) => j.h_supp);
  const hTot = sum((j) => j.total);
  const fraisTot = jours.reduce((s, j) => s + fraisSum(j), 0);
  const doseTot = sum((j) => j.dose);

  // répartition par type (uniquement les types présents)
  const parType = new Map<string, number>();
  for (const j of jours) parType.set(j.type, (parType.get(j.type) ?? 0) + 1);

  return (
    <div>
      <div className="pl-kpis">
        <div className="pl-kpi accent">
          <b>{joursTrav}</b>
          <span>jours travaillés</span>
        </div>
        <div className="pl-kpi">
          <b>{nf(hNorm)}</b>
          <span>h normales</span>
        </div>
        <div className="pl-kpi warn">
          <b>{nf(hSupp)}</b>
          <span>h supplémentaires</span>
        </div>
        <div className="pl-kpi">
          <b>{nf(hTot)}</b>
          <span>total heures</span>
        </div>
        <div className="pl-kpi">
          <b>{nf(fraisTot, 2)} €</b>
          <span>notes de frais</span>
        </div>
        <div className="pl-kpi warn">
          <b>{nf(doseTot, 2)}</b>
          <span>µSv (dose)</span>
        </div>
      </div>
      {parType.size > 0 && (
        <div className="pl-rep">
          {[...parType.entries()].map(([t, n]) => (
            <span className="pl-pill" key={t}>
              {t} · {n}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
