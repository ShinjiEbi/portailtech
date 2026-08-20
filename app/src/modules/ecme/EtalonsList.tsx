import { useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { typeOf } from "../../lib/etalonFields";
import { db } from "../../lib/db";
import { ActiviteJour } from "../../components/ActiviteJour";
import { activiteFromValeurs } from "../../lib/decay";
import { localUpsert, logJournal, syncAll } from "../../lib/sync";
import { favorisSet, toggleFavori } from "../../lib/favoris";
import { Chips } from "../../components/Chips";

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

// Valeur d'un champ d'un étalon repérée par le LIBELLÉ du champ (via son modèle),
// pour rester robuste quel que soit le code interne (cle) du champ.
function valeurParLibelle(e: any, modeleById: Map<string, any>, libelle: string): string {
  const mod = e.modele_id ? modeleById.get(e.modele_id) : undefined;
  const champ = mod?.champs?.find(
    (c: any) => String(c.libelle).trim().toLowerCase() === libelle.toLowerCase()
  );
  if (!champ) return "";
  const v = e.valeurs?.[champ.cle];
  return v == null ? "" : String(v);
}

// Libellés de champ reconnus pour les filtres « Type » et « Radionucléide ».
const RN_LIBS = ["Radionucléide", "Radionuclide", "Radio-nucléide", "Radio nucléide", "Isotope", "RN"];
const normLib = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();

// Valeur d'un champ dont le libellé correspond à l'un des candidats (insensible accents/casse).
function valeurParLibelleAny(e: any, modeleById: Map<string, any>, candidates: string[]): string {
  const mod = e.modele_id ? modeleById.get(e.modele_id) : undefined;
  if (!mod?.champs) return "";
  const cand = new Set(candidates.map(normLib));
  const champ = mod.champs.find((c: any) => cand.has(normLib(String(c.libelle))));
  if (!champ) return "";
  const v = e.valeurs?.[champ.cle];
  return v == null ? "" : String(v);
}

const UTIL_OPTS = [{ value: "oui", label: "Utilisés" }, { value: "non", label: "Non utilisés" }];
const RAY_ORDER = ["Alpha", "Bêta", "Gamma", "X", "Neutron"];

// Recherche plein-texte sur TOUS les champs d'un étalon :
// champs fixes + valeurs des champs dynamiques (valeurs) + champs libres.
function collectPrimitives(x: any, out: string[]): void {
  if (x == null) return;
  if (Array.isArray(x)) { for (const v of x) collectPrimitives(v, out); return; }
  if (typeof x === "object") { for (const v of Object.values(x)) collectPrimitives(v, out); return; }
  out.push(String(x));
}
function etalonHaystack(e: any): string {
  const out: string[] = [];
  for (const v of [
    e.modele_nom, e.designation, e.num_serie, e.num_client,
    e.statut, STATUT_LABEL[e.statut],
    e.date_etalonnage, e.date_echeance,
    e.certificat_ref, e.certificat_nom,
  ]) if (v != null) out.push(String(v));
  collectPrimitives(e.valeurs, out);
  collectPrimitives(e.champs_libres, out);
  return out.join(" ").toLowerCase();
}

// Carte étalon : tap = ouvrir, swipe horizontal = épingler / désépingler.
function EtalonCard({
  e, modeleById, pinned, onTogglePin,
}: { e: any; modeleById: Map<string, any>; pinned: boolean; onTogglePin: (e: any, pinned: boolean) => void }) {
  const nav = useNavigate();
  const ref = useRef<HTMLDivElement>(null);
  const sx = useRef(0);
  const sy = useRef(0);
  const swiping = useRef(false);
  const swiped = useRef(false);

  const mod = e.modele_id ? modeleById.get(e.modele_id) : undefined;
  const decay = activiteFromValeurs(mod?.champs, e.valeurs);
  const d = daysUntil(e.date_echeance);
  const ech = d == null ? "" : d < 0 ? "echeance-late" : d < 30 ? "echeance-soon" : "";

  function start(ev: React.TouchEvent) {
    const t = ev.touches[0];
    sx.current = t.clientX; sy.current = t.clientY;
    swiping.current = false; swiped.current = false;
  }
  function move(ev: React.TouchEvent) {
    const t = ev.touches[0];
    const dx = t.clientX - sx.current;
    const dy = t.clientY - sy.current;
    if (!swiping.current && Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy) * 1.4) swiping.current = true;
    if (swiping.current && ref.current) {
      const cl = Math.max(-110, Math.min(110, dx));
      ref.current.style.transition = "none";
      ref.current.style.transform = `translateX(${cl}px)`;
      ref.current.dataset.dir = pinned ? (cl < 0 ? "act" : "") : (cl > 0 ? "act" : "");
    }
  }
  function end(ev: React.TouchEvent) {
    const dx = (ev.changedTouches[0]?.clientX ?? sx.current) - sx.current;
    if (ref.current) {
      ref.current.style.transition = "transform .18s ease";
      ref.current.style.transform = "";
      delete ref.current.dataset.dir;
    }
    if (swiping.current && Math.abs(dx) >= 60) {
      swiped.current = true;
      onTogglePin(e, pinned);
    }
    swiping.current = false;
  }
  function click(ev: React.MouseEvent) {
    if (swiped.current) { ev.preventDefault(); swiped.current = false; return; }
    nav(`/ecme/${e.id}`);
  }

  return (
    <div
      ref={ref}
      className={`card swipe-card${pinned ? " pinned" : ""}`}
      role="link"
      tabIndex={0}
      onClick={click}
      onTouchStart={start}
      onTouchMove={move}
      onTouchEnd={end}
    >
      <div className="card-top">
        <span className="card-title">{pinned ? "📌 " : ""}{e.num_serie || e.designation || "(sans nom)"}</span>
        <span className={`tag ${e.statut}`}>{STATUT_LABEL[e.statut] ?? e.statut}</span>
      </div>
      <div className="card-sub">
        <span className="tag type">{e.modele_nom || "—"}</span>
        {e.num_client ? <span className="card-num"> client {e.num_client}</span> : null}
      </div>
      {decay && <ActiviteJour d={decay} compact />}
      {e.date_echeance && (
        <div className={`card-sub ${ech}`}>
          Échéance : {e.date_echeance}
          {d != null ? ` (${d < 0 ? "dépassée" : "J-" + d})` : ""}
        </div>
      )}
    </div>
  );
}

export function EtalonsList() {
  const [fMod, setFMod] = useState<string | null>(null);
  const [fSite, setFSite] = useState<string | null>(null);
  const [fRay, setFRay] = useState<string | null>(null);
  const [fUtil, setFUtil] = useState<string | null>(null);
  const [fType, setFType] = useState<string | null>(null);
  const [fRN, setFRN] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [q, setQ] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const etalons = useLiveQuery(() => db.etalons.toArray(), []);
  const modeles = useLiveQuery(() => db.modeles.toArray(), []);
  const favoris = useLiveQuery(() => favorisSet(), []) ?? new Set<string>();

  const modVivants = (modeles ?? []).filter((m) => !m.deleted).sort((a, b) => a.ordre - b.ordre);
  const modeleById = new Map(modVivants.map((m) => [m.id, m]));
  const modOpts = modVivants.map((m) => ({ value: m.nom, label: m.nom }));

  const vivants = (etalons ?? []).filter((e) => !e.deleted);

  // Options de filtre dérivées des données réellement présentes
  const siteSet = new Set<string>();
  const raySet = new Set<string>();
  const typeSet = new Set<string>();
  const rnSet = new Set<string>();
  for (const e of vivants) {
    const s = valeurParLibelle(e, modeleById, "Client");
    if (s) siteSet.add(s);
    const r = valeurParLibelle(e, modeleById, "Rayonnement");
    if (r) raySet.add(r);
    const t = typeOf(e, e.modele_id ? modeleById.get(e.modele_id) : undefined);
    if (t) typeSet.add(t);
    const rn = valeurParLibelleAny(e, modeleById, RN_LIBS);
    if (rn) rnSet.add(rn);
  }
  const siteOpts = [...siteSet].sort((a, b) => a.localeCompare(b)).map((s) => ({ value: s, label: s }));
  const rayOpts = [...raySet]
    .sort((a, b) => RAY_ORDER.indexOf(a) - RAY_ORDER.indexOf(b) || a.localeCompare(b))
    .map((r) => ({ value: r, label: r }));
  const typeOpts = [...typeSet].sort((a, b) => a.localeCompare(b)).map((v) => ({ value: v, label: v }));
  const rnOpts = [...rnSet].sort((a, b) => a.localeCompare(b)).map((v) => ({ value: v, label: v }));

  const list = vivants
    .filter((e) => fMod === null || e.modele_nom === fMod)
    .filter((e) => fSite === null || valeurParLibelle(e, modeleById, "Client") === fSite)
    .filter((e) => fRay === null || valeurParLibelle(e, modeleById, "Rayonnement") === fRay)
    .filter((e) => fUtil === null || (fUtil === "oui" ? favoris.has(e.id) : !favoris.has(e.id)))
    .filter((e) => fType === null || typeOf(e, e.modele_id ? modeleById.get(e.modele_id) : undefined) === fType)
    .filter((e) => fRN === null || valeurParLibelleAny(e, modeleById, RN_LIBS) === fRN)
    .filter((e) => {
      const s = q.trim().toLowerCase();
      if (!s) return true;
      return etalonHaystack(e).includes(s);
    })
    .sort((a, b) => (a.num_serie || a.designation).localeCompare(b.num_serie || b.designation));

  const activeCount = [fMod, fType, fRN, fSite, fRay, fUtil].filter((v) => v !== null).length;

  async function togglePin(e: any, pinned: boolean) {
    await toggleFavori(e.id, pinned);
  }

  async function doExport() {
    if (busy) return;
    setBusy(true);
    setMsg(null);
    try {
      const { exportEtalonsXlsx, saveBlob } = await import("../../lib/xlsx");
      const blob = await exportEtalonsXlsx(list, modVivants);
      await saveBlob(blob, `etalons-${new Date().toISOString().slice(0, 10)}.xlsx`);
      setMsg(`${list.length} étalon(s) exporté(s).`);
    } catch (e) {
      setMsg("Export impossible : " + (e as Error).message);
    }
    setBusy(false);
  }

  async function onImportFile(ev: React.ChangeEvent<HTMLInputElement>) {
    const file = ev.target.files?.[0];
    ev.target.value = ""; // permet de re-sélectionner le même fichier
    if (!file || busy) return;
    setBusy(true);
    setMsg(null);
    try {
      const buf = await file.arrayBuffer();
      const { parseEtalonsXlsx } = await import("../../lib/xlsx");
      const res = await parseEtalonsXlsx(buf, modVivants, vivants);
      for (const d of res.drafts) await localUpsert(db.etalons, d);
      if (res.drafts.length) {
        await logJournal(
          "info",
          `Import Excel : ${res.created} ajout(s), ${res.updated} mise(s) à jour`
        );
        syncAll().catch(console.error);
      }
      const skip = res.skipped.length ? ` · ${res.skipped.length} ignorée(s)` : "";
      setMsg(`Import terminé : ${res.created} ajout(s), ${res.updated} mise(s) à jour${skip}.`);
    } catch (e) {
      setMsg("Import impossible : " + (e as Error).message);
    }
    setBusy(false);
  }

  return (
    <div>
      <div className="page-head">
        <h2>ECME · Étalons</h2>
        <Link to="/ecme/new" className="add">
          + Ajouter
        </Link>
      </div>

      <div className="pl-export" style={{ margin: "0 0 10px" }}>
        <button type="button" className="btn" onClick={() => fileRef.current?.click()} disabled={busy}>
          ⬆ Importer (Excel)
        </button>
        <button type="button" className="btn" onClick={doExport} disabled={busy || list.length === 0}>
          ⬇ Exporter ({list.length})
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          style={{ display: "none" }}
          onChange={onImportFile}
        />
      </div>
      {msg && <p className="muted hint">{msg}</p>}

      <input
        className="mat-search"
        placeholder="Rechercher dans tous les champs…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />

      <button type="button" className="btn filters-toggle" onClick={() => setShowFilters((v) => !v)}>
        {showFilters ? "▾" : "▸"} Filtres{activeCount ? ` (${activeCount})` : ""}
      </button>

      {showFilters && (
        <div className="filters">
          {modOpts.length > 0 && (
            <div className="filter-row">
              <span className="filter-lbl">Modèle</span>
              <div className="filter-scroll"><Chips options={modOpts} value={fMod} onChange={setFMod} allLabel="Tous" /></div>
            </div>
          )}
          {typeOpts.length > 0 && (
            <div className="filter-row">
              <span className="filter-lbl">Type</span>
              <div className="filter-scroll"><Chips options={typeOpts} value={fType} onChange={setFType} allLabel="Tous" /></div>
            </div>
          )}
          {rnOpts.length > 0 && (
            <div className="filter-row">
              <span className="filter-lbl">Radionucléide</span>
              <div className="filter-scroll"><Chips options={rnOpts} value={fRN} onChange={setFRN} allLabel="Tous" /></div>
            </div>
          )}
          {rayOpts.length > 0 && (
            <div className="filter-row">
              <span className="filter-lbl">Rayonnement</span>
              <div className="filter-scroll"><Chips options={rayOpts} value={fRay} onChange={setFRay} allLabel="Tous" /></div>
            </div>
          )}
          {siteOpts.length > 0 && (
            <div className="filter-row">
              <span className="filter-lbl">Site</span>
              <div className="filter-scroll"><Chips options={siteOpts} value={fSite} onChange={setFSite} allLabel="Tous" /></div>
            </div>
          )}
          <div className="filter-row">
            <span className="filter-lbl">Utilisé</span>
            <div className="filter-scroll"><Chips options={UTIL_OPTS} value={fUtil} onChange={setFUtil} allLabel="Tous" /></div>
          </div>
        </div>
      )}

      {list.length === 0 && <div className="empty">Aucun étalon pour l'instant.</div>}
      {list.length > 0 && (
        <p className="muted hint" style={{ marginTop: 0 }}>Glisse une carte pour marquer l'ECME « utilisé » (remonte en haut).</p>
      )}

      {list.filter((e) => favoris.has(e.id)).map((e) => (
        <EtalonCard key={e.id} e={e} modeleById={modeleById} pinned onTogglePin={togglePin} />
      ))}
      {list.some((e) => favoris.has(e.id)) && list.some((e) => !favoris.has(e.id)) && <div className="list-sep" />}
      {list.filter((e) => !favoris.has(e.id)).map((e) => (
        <EtalonCard key={e.id} e={e} modeleById={modeleById} pinned={false} onTogglePin={togglePin} />
      ))}
    </div>
  );
}
