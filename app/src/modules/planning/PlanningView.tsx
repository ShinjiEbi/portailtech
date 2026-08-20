import { Fragment, useEffect, useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { defaultParams, getJour, getParams, isWorked, iso, monthJours } from "../../lib/planning";
import type { PlanningJour, PlanningParams, PlanningType } from "../../lib/types";
import { allImputations, fallbackColor, imputationByCode } from "../../lib/imputations";
import { exportDosi, exportFeuilleTemps } from "../../lib/planningXlsx";
import { MonthRecap } from "./MonthRecap";
import { DayPanel } from "./DayPanel";

const MOIS = [
  "janvier", "février", "mars", "avril", "mai", "juin",
  "juillet", "août", "septembre", "octobre", "novembre", "décembre",
];
const DOW = ["L", "M", "M", "J", "V", "S", "D"];

const TYPE_SLUG: Record<PlanningType, string> = {
  "Travaillé": "trav", "Déplacement": "depl", "RTT": "rtt", "Congé payé": "cp",
  "Férié": "ferie", "Récup": "recup", "Maladie": "mal",
};
const TYPE_SHORT: Record<PlanningType, string> = {
  "Travaillé": "Travaillé", "Déplacement": "Déplac.", "RTT": "RTT", "Congé payé": "CP",
  "Férié": "Férié", "Récup": "Récup", "Maladie": "Maladie",
};

const nf = (v: number, d = 1) => v.toLocaleString("fr-FR", { maximumFractionDigits: d });
// Nom de site court pour la case (sans préfixe CNPE/DP2D).
const siteShort = (s: string) => s.replace(/^(CNPE|DP2D)\s+/, "");

// Numéro de semaine ISO 8601.
function isoWeek(d: Date): number {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = (t.getUTCDay() + 6) % 7;
  t.setUTCDate(t.getUTCDate() - day + 3);
  const first = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
  const fday = (first.getUTCDay() + 6) % 7;
  first.setUTCDate(first.getUTCDate() - fday + 3);
  return 1 + Math.round((t.getTime() - first.getTime()) / 604800000);
}

export default function PlanningView() {
  const now = new Date();
  const [cur, setCur] = useState({ y: now.getFullYear(), m: now.getMonth() });
  const [sel, setSel] = useState<string | null>(null);
  const [params, setParams] = useState<PlanningParams>(() => defaultParams(""));

  useEffect(() => {
    getParams().then(setParams);
  }, []);

  const jours = useLiveQuery(() => monthJours(cur.y, cur.m), [cur.y, cur.m]) ?? [];
  const imps = useLiveQuery(() => allImputations(), []) ?? [];
  const byDate = useMemo(
    () => new Map<string, PlanningJour>(jours.map((j) => [j.date, j])),
    [jours]
  );

  const todayIso = iso(now.getFullYear(), now.getMonth(), now.getDate());

  function shift(delta: number) {
    setCur((c) => {
      const d = new Date(c.y, c.m + delta, 1);
      return { y: d.getFullYear(), m: d.getMonth() };
    });
  }
  function goToday() {
    const n = new Date();
    setCur({ y: n.getFullYear(), m: n.getMonth() });
  }

  // --- Exports Excel ---
  const [wkPick, setWkPick] = useState(false);
  const [busy, setBusy] = useState(false);
  const pad2 = (n: number) => String(n).padStart(2, "0");

  async function doDosi() {
    setBusy(true);
    try {
      await exportDosi(jours, params, cur.y, cur.m);
    } catch (e) {
      alert("Export dosi impossible : " + (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // Semaines (lundi) qui touchent le mois affiché.
  function weeksOfMonth(): Date[] {
    const f = new Date(cur.y, cur.m, 1);
    const o = (f.getDay() + 6) % 7;
    const mon = new Date(cur.y, cur.m, 1 - o);
    const last = new Date(cur.y, cur.m + 1, 0);
    const out: Date[] = [];
    while (mon <= last) {
      out.push(new Date(mon));
      mon.setDate(mon.getDate() + 7);
    }
    return out;
  }

  async function doFT(monday: Date) {
    setWkPick(false);
    setBusy(true);
    try {
      // Une semaine peut déborder sur le mois voisin : on récupère les 7 jours.
      const days: PlanningJour[] = [];
      for (let i = 0; i < 7; i++) {
        const dt = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i);
        const j = await getJour(iso(dt.getFullYear(), dt.getMonth(), dt.getDate()));
        if (j) days.push(j);
      }
      await exportFeuilleTemps(days, params, monday);
    } catch (e) {
      alert("Export feuille de temps impossible : " + (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // grille (lundi en tête)
  const first = new Date(cur.y, cur.m, 1);
  const off = (first.getDay() + 6) % 7;
  const ndays = new Date(cur.y, cur.m + 1, 0).getDate();
  const cells: (number | null)[] = [];
  for (let i = 0; i < off; i++) cells.push(null);
  for (let d = 1; d <= ndays; d++) cells.push(d);
  while (cells.length % 7) cells.push(null);
  const weeks: (number | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));

  return (
    <div className="pl">
      <div className="pl-bar">
        <button className="pl-nav" onClick={() => shift(-1)} aria-label="Mois précédent">◀</button>
        <span className="pl-month">{MOIS[cur.m]} {cur.y}</span>
        <button className="pl-today" onClick={goToday}>Aujourd'hui</button>
        <button className="pl-nav" onClick={() => shift(1)} aria-label="Mois suivant">▶</button>
      </div>

      <div className="pl-cal-scroll">
      <div className="pl-grid">
        <div className="pl-dow">S</div>
        {DOW.map((x, i) => (
          <div className="pl-dow" key={i}>{x}</div>
        ))}

        {weeks.map((wk, ri) => {
          const monday = new Date(cur.y, cur.m, 1 - off + ri * 7);
          return (
            <Fragment key={ri}>
              <div className="pl-wk">{isoWeek(monday)}</div>
              {wk.map((day, ci) => {
                if (day == null) return <div className="pl-cell out" key={ci} />;
                const dateIso = iso(cur.y, cur.m, day);
                const jour = byDate.get(dateIso);
                const dow = new Date(cur.y, cur.m, day).getDay();
                const we = dow === 0 || dow === 6;
                const today = dateIso === todayIso;
                const fr = jour ? (jour.frais ?? []).reduce((s, f) => s + (Number(f.montant) || 0), 0) : 0;
                const cls = [
                  "pl-cell", we ? "we" : "", today ? "today" : "",
                  jour ? `t-${TYPE_SLUG[jour.type]}` : "",
                ].filter(Boolean).join(" ");
                const worked = jour ? isWorked(jour.type) : false;
                const imp = jour ? imputationByCode(imps, jour.imputation) : null;
                const liseColor = jour?.imputation ? (imp?.couleur ?? fallbackColor(jour.imputation)) : undefined;
                // En haut : libellé de la tâche (jours travaillés) ; sinon le type abrégé.
                const top = jour
                  ? (worked ? (imp?.nom_tache ?? (jour.site ? siteShort(jour.site) : "")) : TYPE_SHORT[jour.type])
                  : "";
                return (
                  <button
                    className={cls}
                    key={ci}
                    onClick={() => setSel(dateIso)}
                    style={liseColor ? { boxShadow: `inset 0 0 0 2px ${liseColor}` } : undefined}
                    title={jour?.imputation ? `Pointage : ${jour.imputation}` : undefined}
                  >
                    <span className="pl-d">{day}</span>
                    {top && <span className="pl-site">{top}</span>}
                    {jour && worked && jour.total != null && (
                      <span className="pl-h">{nf(jour.total)} h</span>
                    )}
                    {jour && (jour.dose || fr > 0) ? (
                      <span className="pl-foot">
                        {jour.dose ? <span className="pl-dose">{nf(jour.dose, 2)} µSv</span> : <span />}
                        {fr > 0 ? <span className="pl-eur">{nf(fr, 2)} €</span> : null}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </Fragment>
          );
        })}
      </div>
      </div>

      <MonthRecap jours={jours} />

      <div className="pl-export">
        <button className="btn" onClick={doDosi} disabled={busy}>⬇ Relevé dosi</button>
        <button className="btn" onClick={() => setWkPick(true)} disabled={busy}>⬇ Feuille de temps</button>
      </div>
      {busy && <p className="pl-export-busy">Génération du fichier…</p>}

      {wkPick && (
        <div className="pl-overlay" onClick={() => setWkPick(false)}>
          <div className="pl-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="pl-sheet-head">
              <span className="pl-sheet-title">Feuille de temps — choisis la semaine</span>
              <button className="ghost" onClick={() => setWkPick(false)} title="Fermer">✕</button>
            </div>
            <div className="pl-wklist">
              {weeksOfMonth().map((mon, i) => {
                const sun = new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() + 6);
                const f = (d: Date) => `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}`;
                return (
                  <button className="btn pl-wkbtn" key={i} onClick={() => doFT(mon)} disabled={busy}>
                    S{isoWeek(mon)} · {f(mon)} → {f(sun)}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {sel && <DayPanel date={sel} params={params} onClose={() => setSel(null)} />}
    </div>
  );
}
