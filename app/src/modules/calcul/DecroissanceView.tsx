import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Chips } from "../../components/Chips";
import { currentActivity, fractionRemaining, formatBq, formatPeriode, periodeFor, RADIONUCLIDES } from "../../lib/decay";

const UNITS = [
  { value: "Bq", f: 1 }, { value: "kBq", f: 1e3 }, { value: "MBq", f: 1e6 }, { value: "GBq", f: 1e9 },
];

// date locale du jour au format YYYY-MM-DD (évite le décalage UTC en soirée)
function todayISO(): string {
  const d = new Date();
  const l = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return l.toISOString().slice(0, 10);
}
const frDate = (d: Date) => d.toLocaleDateString("fr-FR", { weekday: "short", day: "2-digit", month: "2-digit" });
// construit une date locale à minuit depuis "YYYY-MM-DD"
function localDate(iso: string): Date | null {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

export function DecroissanceView() {
  const [rn, setRn] = useState("");
  const [a0, setA0] = useState("");
  const [unit, setUnit] = useState("kBq");
  const [dateRef, setDateRef] = useState("");
  const [dateJour, setDateJour] = useState(todayISO());

  const periode = periodeFor(rn || undefined);
  const factor = UNITS.find((u) => u.value === unit)?.f ?? 1;
  const a0Bq = a0 === "" ? undefined : Number(a0) * factor;
  const jour = dateJour ? localDate(dateJour) : null;

  const actJour = useMemo(
    () => (jour ? currentActivity(a0Bq, dateRef || undefined, rn || undefined, jour) : null),
    [a0Bq, dateRef, rn, dateJour] // eslint-disable-line react-hooks/exhaustive-deps
  );
  const frac = useMemo(
    () => (jour ? fractionRemaining(dateRef || undefined, rn || undefined, jour) : null),
    [dateRef, rn, dateJour] // eslint-disable-line react-hooks/exhaustive-deps
  );
  const semaine = useMemo(() => {
    if (!jour) return [];
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(jour);
      d.setDate(jour.getDate() + i);
      return { d, act: currentActivity(a0Bq, dateRef || undefined, rn || undefined, d) };
    });
  }, [a0Bq, dateRef, rn, dateJour]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div>
      <Link to="/calcul" className="back">← Calcul</Link>
      <div className="page-head"><h2>Décroissance</h2></div>

      <label className="field"><span>Radionucléide</span>
        <select value={rn} onChange={(e) => setRn(e.target.value)}>
          <option value="">— choisir —</option>
          {RADIONUCLIDES.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
      </label>
      {periode && <p className="muted hint">Période : {formatPeriode(periode)}</p>}
      {rn && !periode && <p className="calc-res-err">Période inconnue pour ce radionucléide.</p>}

      <div className="grid2">
        <label className="field"><span>Activité de référence</span>
          <input type="number" inputMode="decimal" value={a0} onChange={(e) => setA0(e.target.value)} placeholder="Ex. 370" />
        </label>
        <label className="field"><span>Unité</span>
          <Chips options={UNITS.map((u) => ({ value: u.value, label: u.value }))} value={unit} onChange={(v) => setUnit(v ?? "kBq")} />
        </label>
      </div>
      <div className="grid2">
        <label className="field"><span>Date de référence</span>
          <input type="date" value={dateRef} onChange={(e) => setDateRef(e.target.value)} />
        </label>
        <label className="field"><span>Date du jour</span>
          <input type="date" value={dateJour} onChange={(e) => setDateJour(e.target.value)} />
        </label>
      </div>

      <div className="card">
        <div className="card-title" style={{ marginBottom: 8 }}>Activité du jour</div>
        <div className="calc-res">
          <span className="calc-res-nom">{jour ? frDate(jour) : "—"}</span>
          <span className="calc-res-val">{actJour != null ? formatBq(actJour) : "—"}</span>
        </div>
        {frac != null && (
          <div className="calc-res">
            <span className="calc-res-nom">Fraction restante</span>
            <span className="calc-res-val">{(frac * 100).toFixed(2)} %</span>
          </div>
        )}
      </div>

      <div className="card">
        <div className="card-title" style={{ marginBottom: 8 }}>Semaine glissante</div>
        {semaine.length === 0 && <p className="muted hint">Renseigne la date du jour.</p>}
        {semaine.map(({ d, act }, i) => (
          <div key={i} className="calc-res">
            <span className="calc-res-nom">{frDate(d)}</span>
            <span className="calc-res-val">{act != null ? formatBq(act) : "—"}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
