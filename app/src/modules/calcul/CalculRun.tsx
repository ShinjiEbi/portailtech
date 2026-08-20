import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../../lib/db";
import { Chips } from "../../components/Chips";
import { computeCalcul, getCalcul, matchingSources } from "../../lib/calculs";
import { baseUnitLabel, familyByKey, unitFactor } from "../../lib/units";
import type { Calcul, Etalon } from "../../lib/types";

function fmt(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return "—";
  if (v !== 0 && (Math.abs(v) >= 1e5 || Math.abs(v) < 1e-3)) return v.toExponential(4);
  return String(Math.round(v * 1e6) / 1e6);
}
function boundsLabel(min: number | null, max: number | null): string {
  if (min != null && max != null) return `∈ [${fmt(min)} ; ${fmt(max)}]`;
  if (min != null) return `≥ ${fmt(min)}`;
  if (max != null) return `≤ ${fmt(max)}`;
  return "";
}

export function CalculRun() {
  const { id } = useParams();
  const [calcul, setCalcul] = useState<Calcul | null | undefined>(undefined);
  const etalons = useLiveQuery(() => db.etalons.toArray(), []) ?? [];
  const modeles = useLiveQuery(() => db.modeles.toArray(), []) ?? [];
  const [chosen, setChosen] = useState<Record<string, string>>({});
  const [vars, setVars] = useState<Record<string, string>>({});
  const [series, setSeries] = useState<Record<string, string[]>>({});
  const [mesures, setMesures] = useState<Record<string, { v: string; u: string }>>({});

  useEffect(() => { if (id) getCalcul(id).then((c) => setCalcul(c ?? null)); }, [id]);

  const sourceComps = calcul ? calcul.composantes.filter((c) => c.type === "source") : [];
  const variables = calcul ? calcul.composantes.filter((c) => c.type === "variable") : [];
  const mesureComps = calcul ? calcul.composantes.filter((c) => c.type === "mesure") : [];
  const serieComps = calcul ? calcul.composantes.filter((c) => c.type === "serie") : [];

  // init des saisies série (3 lignes) et mesure (unité de base)
  useEffect(() => {
    if (!calcul) return;
    setSeries((prev) => {
      const next = { ...prev }; let ch = false;
      for (const c of calcul.composantes) if (c.type === "serie" && !next[c.id]) { next[c.id] = ["", "", ""]; ch = true; }
      return ch ? next : prev;
    });
    setMesures((prev) => {
      const next = { ...prev }; let ch = false;
      for (const c of calcul.composantes) if (c.type === "mesure" && !next[c.id]) { next[c.id] = { v: "", u: baseUnitLabel(familyByKey(c.unite_famille)) }; ch = true; }
      return ch ? next : prev;
    });
  }, [calcul]);

  const matchedByComp = useMemo(() => {
    const map: Record<string, Etalon[]> = {};
    for (const c of sourceComps) map[c.id] = matchingSources(c.source_filtres, etalons, modeles);
    return map;
  }, [calcul, etalons, modeles]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setChosen((prev) => {
      const next = { ...prev }; let changed = false;
      for (const c of sourceComps) {
        const list = matchedByComp[c.id] ?? [];
        if (list.length && !list.some((e) => e.id === next[c.id])) { next[c.id] = list[0].id; changed = true; }
      }
      return changed ? next : prev;
    });
  }, [matchedByComp]); // eslint-disable-line react-hooks/exhaustive-deps

  const sourcesMap = useMemo(() => {
    const map: Record<string, Etalon | null> = {};
    for (const c of sourceComps) {
      const list = matchedByComp[c.id] ?? [];
      map[c.id] = list.find((e) => e.id === chosen[c.id]) ?? null;
    }
    return map;
  }, [matchedByComp, chosen]); // eslint-disable-line react-hooks/exhaustive-deps

  // variables saisies + mesures converties vers l'unité de base
  const mergedVars = useMemo(() => {
    const mv: Record<string, string> = { ...vars };
    for (const c of mesureComps) {
      const st = mesures[c.id];
      if (st && st.v !== "") mv[c.nom] = String(Number(st.v) * unitFactor(familyByKey(c.unite_famille), st.u));
    }
    return mv;
  }, [vars, mesures, calcul]); // eslint-disable-line react-hooks/exhaustive-deps

  const out = useMemo(() => (calcul ? computeCalcul(calcul, sourcesMap, modeles, mergedVars, series) : null), [calcul, sourcesMap, modeles, mergedVars, series]);

  if (calcul === undefined) return <div className="splash">…</div>;
  if (calcul === null)
    return <div><Link to="/calcul" className="back">← Calcul</Link><div className="empty">Calcul introuvable.</div></div>;

  const hasSaisie = variables.length > 0 || mesureComps.length > 0 || serieComps.length > 0;

  return (
    <div>
      <Link to="/calcul" className="back">← Calcul</Link>
      <div className="page-head">
        <h2>{calcul.nom || "(sans nom)"}</h2>
        <Link to={`/calcul/${calcul.id}/edit`} className="add">✎ Modifier</Link>
      </div>

      {sourceComps.length > 0 && (
        <div className="card">
          <div className="card-title" style={{ marginBottom: 8 }}>Sources{calcul.type_source ? ` (${calcul.type_source})` : ""}</div>
          {sourceComps.map((c) => {
            const list = matchedByComp[c.id] ?? [];
            return (
              <label className="field" key={c.id}>
                <span>{c.libelle || c.nom}</span>
                <select value={chosen[c.id] ?? ""} onChange={(e) => setChosen({ ...chosen, [c.id]: e.target.value })}>
                  {list.length === 0 && <option value="">(aucune source correspondante)</option>}
                  {list.map((s) => <option key={s.id} value={s.id}>{s.num_serie || s.designation || s.id}</option>)}
                </select>
              </label>
            );
          })}
        </div>
      )}

      {hasSaisie && (
        <div className="card">
          <div className="card-title" style={{ marginBottom: 8 }}>Saisie</div>
          {variables.map((v) => (
            <label className="field" key={v.id}>
              <span>{v.libelle || v.nom}{v.unite ? ` (${v.unite})` : ""}</span>
              <input
                type={v.valeur_type === "date" ? "date" : "number"}
                inputMode={v.valeur_type === "date" ? undefined : "decimal"}
                value={vars[v.nom] ?? ""}
                onChange={(e) => setVars({ ...vars, [v.nom]: e.target.value })}
              />
            </label>
          ))}
          {mesureComps.map((c) => {
            const fam = familyByKey(c.unite_famille);
            const st = mesures[c.id] ?? { v: "", u: baseUnitLabel(fam) };
            return (
              <div className="field" key={c.id}>
                <span>{c.libelle || c.nom}</span>
                {fam ? (
                  <div className="grid2">
                    <input type="number" inputMode="decimal" value={st.v} onChange={(e) => setMesures({ ...mesures, [c.id]: { ...st, v: e.target.value } })} />
                    <Chips options={fam.units.map((u) => ({ value: u.label, label: u.label }))} value={st.u} onChange={(v) => setMesures({ ...mesures, [c.id]: { ...st, u: v ?? baseUnitLabel(fam) } })} />
                  </div>
                ) : (
                  <input type="number" inputMode="decimal" value={st.v} onChange={(e) => setMesures({ ...mesures, [c.id]: { ...st, v: e.target.value } })} placeholder="(grandeur non définie)" />
                )}
              </div>
            );
          })}
          {serieComps.map((c) => {
            const rows = series[c.id] ?? [];
            const setRows = (nv: string[]) => setSeries({ ...series, [c.id]: nv });
            return (
              <div className="field" key={c.id}>
                <span>{c.libelle || c.nom}{c.unite ? ` (${c.unite})` : ""}</span>
                {rows.map((val, i) => (
                  <div className="serie-row" key={i}>
                    <input type="number" inputMode="decimal" value={val} onChange={(e) => setRows(rows.map((x, j) => (j === i ? e.target.value : x)))} placeholder={`mesure ${i + 1}`} />
                    {rows.length > 1 && <button type="button" className="key key-del" onClick={() => setRows(rows.filter((_, j) => j !== i))}>⌫</button>}
                  </div>
                ))}
                <button type="button" className="add" onClick={() => setRows([...rows, ""])}>+ Mesure</button>
                {out && Number.isFinite(out.scope[c.nom]) && <p className="muted hint">moyenne {fmt(out.scope[c.nom])} · n {rows.filter((x) => x !== "").length}</p>}
              </div>
            );
          })}
        </div>
      )}

      <div className="card">
        <div className="card-title" style={{ marginBottom: 8 }}>Résultats</div>
        {(!out || out.results.length === 0) && <p className="muted hint">Aucune formule.</p>}
        {out?.results.map((r) => (
          <div key={r.formule.id}>
            <div className="calc-res">
              <span className="calc-res-nom">{r.formule.nom || "(formule)"}</span>
              {r.error
                ? <span className="calc-res-err">{r.error}</span>
                : <span className="calc-res-val">{fmt(r.value)}{r.formule.unite ? ` ${r.formule.unite}` : ""}</span>}
            </div>
            {r.tolerance && (
              <div className="calc-res calc-tol">
                <span className="calc-res-nom">tolérance</span>
                {r.tolerance.error
                  ? <span className="calc-res-err">{r.tolerance.error}</span>
                  : <span className={`calc-res-val ${r.tolerance.pass ? "tol-ok" : "tol-no"}`}>
                      {r.tolerance.pass ? "✓" : "✗"} {fmt(r.value)} {boundsLabel(r.tolerance.min, r.tolerance.max)}{r.formule.unite ? ` ${r.formule.unite}` : ""}
                    </span>}
              </div>
            )}
          </div>
        ))}
      </div>

      {sourceComps.length > 0 && (
        <details className="calc-details">
          <summary>Valeurs des sources</summary>
          {sourceComps.flatMap((c) =>
            (c.source_valeurs && c.source_valeurs.length
              ? c.source_valeurs
              : (c.source_champ ? [{ nom: c.nom, source_champ: c.source_champ, unite: c.unite }] : [])
            ).map((v, i) => (
              <div key={`${c.id}:${i}`} className="calc-res">
                <span className="calc-res-nom">{v.nom}</span>
                <span className="calc-res-val">{fmt(out?.scope[v.nom] ?? null)}{v.unite ? ` ${v.unite}` : ""}</span>
              </div>
            ))
          )}
        </details>
      )}
    </div>
  );
}
