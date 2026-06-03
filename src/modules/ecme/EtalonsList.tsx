import { useState } from "react";
import { Link } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../../lib/db";
import { Chips } from "../../components/Chips";
import { useAuth } from "../../auth/AuthProvider";
import type { EtalonType } from "../../lib/types";
import { currentActivity, fractionRemaining, formatActivity } from "../../lib/decay";

const TYPE_OPTS = [
  { value: "source" as const, label: "Sources" },
  { value: "debitmetre" as const, label: "Débitmètres" },
  { value: "autre" as const, label: "Autres" },
];
const STATUT_LABEL: Record<string, string> = {
  en_service: "en service",
  etalonnage: "étalonnage",
  hs: "HS",
  reforme: "réformé",
};

function daysUntil(d?: string | null): number | null {
  if (!d) return null;
  return Math.ceil((new Date(d).getTime() - Date.now()) / 86_400_000);
}

export function EtalonsList() {
  const { isReferent } = useAuth();
  const [type, setType] = useState<EtalonType | null>(null);
  const all = useLiveQuery(() => db.etalons.toArray(), []);

  const list = (all ?? [])
    .filter((e) => !e.deleted && (type === null || e.type === type))
    .sort((a, b) => a.designation.localeCompare(b.designation));

  return (
    <div>
      <div className="page-head">
        <h2>ECME · Étalons</h2>
        {isReferent && (
          <Link to="/ecme/new" className="add">
            + Ajouter
          </Link>
        )}
      </div>

      <Chips options={TYPE_OPTS} value={type} onChange={setType} allLabel="Tous" />

      {list.length === 0 && (
        <div className="empty">Aucun étalon{type ? " de ce type" : ""}.</div>
      )}

      {list.map((e) => {
        const car = e.caracteristiques || {};
        const isSource = e.type === "source";
        const act = isSource
          ? currentActivity(car.activite_ref, car.date_ref, car.radionucleide)
          : null;
        const frac = isSource ? fractionRemaining(car.date_ref, car.radionucleide) : null;
        const d = daysUntil(e.date_echeance);
        const echClass = d == null ? "" : d < 0 ? "echeance-late" : d < 30 ? "echeance-soon" : "";
        return (
          <Link key={e.id} to={`/ecme/${e.id}`} className="card">
            <div className="card-top">
              <span className="card-title">{e.designation}</span>
              <span className={`tag ${e.statut}`}>{STATUT_LABEL[e.statut] ?? e.statut}</span>
            </div>
            <div className="card-sub">
              {isSource && car.radionucleide ? car.radionucleide + " · " : ""}
              {[e.marque, e.modele].filter(Boolean).join(" ")}
              {e.num_serie ? <span className="card-num"> · n° {e.num_serie}</span> : null}
            </div>
            {isSource && act != null && (
              <div className="activity">
                <span>{formatActivity(act)}</span>
                <span className="bar">
                  <i style={{ width: `${Math.max(2, Math.min(100, (frac ?? 0) * 100))}%` }} />
                </span>
                <span className="muted">{Math.round((frac ?? 0) * 100)}%</span>
              </div>
            )}
            {e.date_echeance && (
              <div className={`card-sub ${echClass}`}>
                Échéance : {e.date_echeance}
                {d != null ? ` (${d < 0 ? "dépassée" : "J-" + d})` : ""}
              </div>
            )}
          </Link>
        );
      })}
    </div>
  );
}
