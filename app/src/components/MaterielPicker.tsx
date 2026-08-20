import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import {
  allCorimTypes, allMateriels, corimByTypeCode, domainesInDb, filterMateriels, sitesInDb,
} from "../lib/materiels";
import type { Materiel } from "../lib/types";

interface Props {
  title?: string;
  addedScans?: Set<string>;        // scans déjà présents (affichés "✓ déjà ajouté")
  onPick: (m: Materiel) => void;   // appelé à chaque sélection
  onManual?: () => void;           // échappatoire : ligne sans matériel
  onClose: () => void;
}

// Sélecteur de matériel : cherche dans la base matériels synchronisée (= données Supabase,
// miroir local Dexie -> instantané et hors-ligne). Filtres Contrat (domaine) + Site, et
// recherche plein-texte sur n'importe quel champ (scan, S/N, désignation, id court, modèle).
export function MaterielPicker({ title = "Ajouter un matériel", addedScans, onPick, onManual, onClose }: Props) {
  const materiels = useLiveQuery(() => allMateriels(), []) ?? [];
  const corimTypes = useLiveQuery(() => allCorimTypes(), []) ?? [];
  const typeAppByCode = useMemo(() => new Map(corimTypes.map((t) => [t.type_code, t.type_appareil])), [corimTypes]);

  const [q, setQ] = useState("");
  const [domaine, setDomaine] = useState<string | null>(null);
  const [site, setSite] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set()); // ajoutés pendant cette session

  const domaineOpts = useMemo(() => domainesInDb(materiels), [materiels]);
  const siteOpts = useMemo(() => sitesInDb(materiels), [materiels]);
  const list = useMemo(() => filterMateriels(materiels, { q, domaine, site }), [materiels, q, domaine, site]);

  function designationOf(m: Materiel): string {
    if (m.designation) return m.designation;
    const c = m.type_code ? corimByTypeCode(corimTypes, m.type_code) : null;
    return c?.designation ?? m.id_court;
  }
  function pick(m: Materiel) {
    if (addedScans?.has(m.scan) || picked.has(m.scan)) return;
    onPick(m);
    setPicked((s) => new Set(s).add(m.scan));
  }

  return (
    <div className="mp-overlay" role="dialog" aria-modal="true">
      <div className="mp-head">
        <span className="mp-title">{title}</span>
        <button type="button" className="scan-x" onClick={onClose} aria-label="Fermer">✕</button>
      </div>

      <div className="mp-search">
        <input placeholder="Rechercher (scan, S/N, désignation, id court…)" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
      </div>

      <div className="mp-filters">
        {domaineOpts.length > 0 && (
          <select value={domaine ?? ""} onChange={(e) => setDomaine(e.target.value || null)}>
            <option value="">Contrat</option>
            {domaineOpts.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        )}
        {siteOpts.length > 0 && (
          <select value={site ?? ""} onChange={(e) => setSite(e.target.value || null)}>
            <option value="">Site</option>
            {siteOpts.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        )}
        {(q || domaine || site) && (
          <button type="button" className="btn btn-mini" onClick={() => { setQ(""); setDomaine(null); setSite(null); }}>Réinit.</button>
        )}
      </div>

      <div className="mp-count">{list.length} matériel(s){materiels.length !== list.length ? ` / ${materiels.length}` : ""}</div>

      <div className="mp-list">
        {materiels.length === 0 && <div className="empty">Base matériels vide — importe-la dans l'onglet Matériels.</div>}
        {materiels.length > 0 && list.length === 0 && <div className="empty">Aucun matériel ne correspond.</div>}
        {list.slice(0, 300).map((m) => {
          const added = (addedScans?.has(m.scan) ?? false) || picked.has(m.scan);
          const typeApp = m.type_code ? typeAppByCode.get(m.type_code) : null;
          return (
            <button type="button" key={m.scan} className={`mp-row ${added ? "added" : ""}`} onClick={() => pick(m)} disabled={added}>
              <div className="mp-row-main">
                <div className="mp-row-title">{designationOf(m)}</div>
                <div className="mp-row-sub">
                  <span className="tag type">{m.id_type === "gmo2" ? "GMO²" : "RF"}</span>
                  {m.id_court}{m.sn ? ` · S/N ${m.sn}` : ""}{m.domaine ? ` · ${m.domaine}` : ""}{m.site ? ` · ${m.site}` : ""}{typeApp ? ` · ${typeApp}` : ""}
                </div>
              </div>
              <span className="mp-add">{added ? "✓" : "+"}</span>
            </button>
          );
        })}
        {list.length > 300 && <div className="mp-count">… affine la recherche (300 premiers affichés sur {list.length}).</div>}
      </div>

      <div className="mp-foot">
        {onManual && <button type="button" className="btn btn-mini" onClick={onManual}>+ Ligne manuelle</button>}
        <span className="mp-foot-count">{picked.size > 0 ? `${picked.size} ajouté(s)` : ""}</span>
        <button type="button" className="btn btn-primary" onClick={onClose}>Fermer</button>
      </div>
    </div>
  );
}
