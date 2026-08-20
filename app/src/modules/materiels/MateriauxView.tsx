import { useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import {
  allCorimTypes, allMateriels, designationsInDb, domainesInDb, exportMaterielsXlsx,
  filterMateriels, importMateriels, sitesInDb,
} from "../../lib/materiels";
import { MATERIEL_ETAT_LABEL, type MaterielEtat } from "../../lib/types";

const ID_OPTS = [{ value: "gmo2", label: "GMO²" }, { value: "repere", label: "Repère" }];
const ETAT_OPTS = Object.entries(MATERIEL_ETAT_LABEL).map(([value, label]) => ({ value, label }));

export function MateriauxView() {
  const materiels = useLiveQuery(() => allMateriels(), []) ?? [];
  const corimTypes = useLiveQuery(() => allCorimTypes(), []) ?? [];
  const typeAppByCode = useMemo(
    () => new Map(corimTypes.map((t) => [t.type_code, t.type_appareil])),
    [corimTypes]
  );
  const [q, setQ] = useState("");
  const [domaine, setDomaine] = useState<string | null>(null);
  const [site, setSite] = useState<string | null>(null);
  const [designation, setDesignation] = useState<string | null>(null);
  const [idType, setIdType] = useState<string | null>(null);
  const [etat, setEtat] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const domaineOpts = useMemo(() => domainesInDb(materiels).map((d) => ({ value: d, label: d })), [materiels]);
  const siteOpts = useMemo(() => sitesInDb(materiels).map((s) => ({ value: s, label: s })), [materiels]);
  const desigOpts = useMemo(() => designationsInDb(materiels).map((d) => ({ value: d, label: d })), [materiels]);
  const list = useMemo(
    () => filterMateriels(materiels, { q, domaine, site, designation, id_type: idType, etat }),
    [materiels, q, domaine, site, designation, idType, etat]
  );

  async function onImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || busy) return;
    setBusy(true); setMsg(null);
    try {
      const r = await importMateriels(file);
      setMsg(`Import : ${r.materiels} matériel(s), ${r.types} correspondance(s) Corim (${r.feuilles.join(", ")}).`);
    } catch (err) {
      setMsg("Import impossible : " + (err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function onExport() {
    if (busy || list.length === 0) return;
    setBusy(true);
    try { await exportMaterielsXlsx(list); } finally { setBusy(false); }
  }

  return (
    <div>
      <div className="page-head">
        <h2>Matériels</h2>
        <Link to="/materiels/new" className="add">+ Ajouter</Link>
      </div>

      <div className="pl-export" style={{ margin: "0 0 10px" }}>
        <button type="button" className="btn" onClick={() => fileRef.current?.click()} disabled={busy}>⬆ Importer (Excel)</button>
        <button type="button" className="btn" onClick={onExport} disabled={busy || list.length === 0}>⬇ Exporter ({list.length})</button>
        <input ref={fileRef} type="file" accept=".xlsx,.xlsm,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" style={{ display: "none" }} onChange={onImport} />
      </div>
      {msg && <p className="muted hint">{msg}</p>}

      <input className="mat-search" placeholder="Rechercher (scan, S/N, désignation…)" value={q} onChange={(e) => setQ(e.target.value)} />

      <div className="mat-filters">
        {domaineOpts.length > 0 && (
          <select value={domaine ?? ""} onChange={(e) => setDomaine(e.target.value || null)}>
            <option value="">Domaine</option>
            {domaineOpts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        )}
        {siteOpts.length > 0 && (
          <select value={site ?? ""} onChange={(e) => setSite(e.target.value || null)}>
            <option value="">Site</option>
            {siteOpts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        )}
        {desigOpts.length > 0 && (
          <select value={designation ?? ""} onChange={(e) => setDesignation(e.target.value || null)}>
            <option value="">Type</option>
            {desigOpts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        )}
        <select value={idType ?? ""} onChange={(e) => setIdType(e.target.value || null)}>
          <option value="">GMO²/RF</option>
          {ID_OPTS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <select value={etat ?? ""} onChange={(e) => setEtat(e.target.value || null)}>
          <option value="">État</option>
          {ETAT_OPTS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>

      <p className="muted hint">{list.length} matériel(s){materiels.length !== list.length ? ` / ${materiels.length}` : ""}.</p>

      {materiels.length === 0 && <div className="empty">Base vide — importe l'Excel dédié (feuille « Matériels »).</div>}
      {materiels.length > 0 && list.length === 0 && <div className="empty">Aucun matériel ne correspond aux filtres.</div>}

      {list.slice(0, 300).map((m) => {
        const typeApp = m.type_code ? typeAppByCode.get(m.type_code) : null;
        return (
          <Link key={m.scan} to={`/materiels/${encodeURIComponent(m.scan)}`} className="card">
            <div className="card-top">
              <span className="card-title">{m.designation || m.scan}</span>
              <span className={`tag mat-etat e-${m.etat}`}>{MATERIEL_ETAT_LABEL[m.etat as MaterielEtat] ?? m.etat}</span>
            </div>
            {typeApp && <div className="card-sub mat-type-app">{typeApp}</div>}
            <div className="card-sub">
              <span className="tag type">{m.id_type === "gmo2" ? "GMO²" : "Repère"}</span>
              {m.id_court}{m.sn ? ` · S/N ${m.sn}` : ""}{m.domaine ? ` · ${m.domaine}` : ""}{m.site ? ` · ${m.site}` : ""}
            </div>
          </Link>
        );
      })}
    </div>
  );
}
