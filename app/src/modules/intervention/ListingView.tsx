import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { Chips } from "../../components/Chips";
import { ScannerModal } from "../../components/ScannerModal";
import { MaterielPicker } from "../../components/MaterielPicker";
import { getParams } from "../../lib/planning";
import {
  blankLigne, deleteLigne, deriveEcheance, getListing, linesOf, lookupEquipement, saveLigne, validiteForOperation,
} from "../../lib/interventions";
import {
  CONFORMITE_AVEC_ECHEANCE, INTERV_CONFORMITES, INTERV_OPERATIONS, INTERV_TYPES_CONTROLE,
  type Conformite, type InterventionLigne, type InterventionListing,
} from "../../lib/types";

const TC_OPTS = INTERV_TYPES_CONTROLE.map((v) => ({ value: v, label: v }));
const OP_OPTS = INTERV_OPERATIONS.map((v) => ({ value: v, label: v }));
const CF_OPTS = INTERV_CONFORMITES.map((v) => ({ value: v, label: v === "Conforme après intervention" ? "Conf. après interv." : v }));

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  return y && m && d ? `${d}/${m}/${y}` : iso;
}
function confClass(c: Conformite): string {
  return c === "Non conforme" ? "no" : c === "Conforme après intervention" ? "warn" : "ok";
}
function confShort(c: Conformite): string {
  return c === "Conforme après intervention" ? "Conf. après interv." : c;
}

export function ListingView() {
  const { id } = useParams();
  const listingId = id ?? "";
  const [listing, setListing] = useState<InterventionListing | null | undefined>(undefined);
  const lignes = useLiveQuery(() => (listingId ? linesOf(listingId) : Promise.resolve([])), [listingId]) ?? [];

  const [q, setQ] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<InterventionLigne | null>(null);
  const [lookupMsg, setLookupMsg] = useState("");
  const [triExec, setTriExec] = useState<string | null>(null);
  const [scanFor, setScanFor] = useState<null | { kind: "new" } | { kind: "field" } | { kind: "search" }>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const lastCreatedRef = useRef<InterventionLigne | null>(null);

  useEffect(() => { if (listingId) getListing(listingId).then((l) => setListing(l ?? null)); }, [listingId]);
  useEffect(() => { getParams().then((p) => setTriExec(p.trigramme ?? null)); }, []);

  function update(patch: Partial<InterventionLigne>) {
    setDraft((d) => {
      if (!d) return d;
      const next: InterventionLigne = { ...d, ...patch };
      if ("operation" in patch) next.validite_ans = validiteForOperation(next.operation);
      if ("echeance" in patch) next.echeance_manuelle = true; // édition manuelle de l'échéance
      next.echeance = deriveEcheance(next);
      saveLigne(next);
      return next;
    });
  }

  function toggle(l: InterventionLigne) {
    if (expandedId === l.id) { setExpandedId(null); setDraft(null); setLookupMsg(""); }
    else { setExpandedId(l.id); setDraft(l); setLookupMsg(""); }
  }

  async function addLigne() {
    const ordre = lignes.reduce((m, l) => Math.max(m, l.ordre), 0) + 1;
    const nl = blankLigne(listingId, ordre, triExec);
    await saveLigne(nl);
    setExpandedId(nl.id);
    setDraft(nl);
    setLookupMsg("");
  }

  // Crée une ligne depuis un scan (sans l'ouvrir) — utilisé par le scanner, y compris en rafale.
  async function createLineFromScan(scan: string) {
    const ordre = lignes.reduce((m, l) => Math.max(m, l.ordre), 0) + 1;
    const base = blankLigne(listingId, ordre, triExec);
    const r = await lookupEquipement(scan);
    const nl: InterventionLigne = {
      ...base, scan,
      id_court: r.id_court,
      designation: r.found ? r.designation : base.designation,
      sn: r.found ? r.sn : base.sn,
    };
    await saveLigne(nl);
    lastCreatedRef.current = nl;
  }

  async function doLookupWith(s?: string) {
    if (!draft) return;
    const scan = (s ?? draft.scan ?? "").trim();
    const r = await lookupEquipement(scan);
    if (r.found) update({ id_court: r.id_court, designation: r.designation, sn: r.sn });
    else update({ id_court: r.id_court }); // garde désignation/SN saisies à la main
    setLookupMsg(scan ? (r.found ? "✓ trouvée dans la base matériels" : "non trouvée — saisie manuelle") : "");
  }

  function onScanDetected(text: string) {
    if (!scanFor) return;
    if (scanFor.kind === "new") { void createLineFromScan(text); }
    else if (scanFor.kind === "field") { update({ scan: text }); void doLookupWith(text); }
    else if (scanFor.kind === "search") { setQ(text); }
  }

  function onScanClose() {
    const f = scanFor;
    setScanFor(null);
    if (f?.kind === "new" && lastCreatedRef.current) {
      const nl = lastCreatedRef.current;
      setExpandedId(nl.id);
      setDraft(nl);
      setLookupMsg("");
      lastCreatedRef.current = null;
    }
  }

  function openPicker() { lastCreatedRef.current = null; setPickerOpen(true); }
  function onManualLine() { setPickerOpen(false); void addLigne(); }
  function onPickerClose() {
    setPickerOpen(false);
    if (lastCreatedRef.current) {
      const nl = lastCreatedRef.current;
      setExpandedId(nl.id);
      setDraft(nl);
      setLookupMsg("");
      lastCreatedRef.current = null;
    }
  }

  async function removeLigne(lid: string) {
    if (!confirm("Supprimer cette ligne ?")) return;
    if (expandedId === lid) { setExpandedId(null); setDraft(null); }
    await deleteLigne(lid);
  }

  if (listing === undefined) return <div className="splash">…</div>;
  if (listing === null)
    return <div><Link to="/interventions" className="back">← Interventions</Link><div className="empty">Listing introuvable.</div></div>;

  const ql = q.trim().toLowerCase();
  const filtered = ql
    ? lignes.filter((l) => [l.scan, l.id_court, l.sn, l.designation].filter(Boolean).join(" ").toLowerCase().includes(ql))
    : lignes;

  return (
    <div>
      <Link to="/interventions" className="back">← Interventions</Link>
      <div className="page-head">
        <h2>{listing.nom || "(sans nom)"}</h2>
        <Link to={`/interventions/${listing.id}/edit`} className="add">✎ En-tête</Link>
      </div>

      <div className="iv-topbar">
        <button type="button" className="btn btn-primary" onClick={openPicker}>+ Ligne</button>
        <button type="button" className="btn btn-mini" onClick={() => { lastCreatedRef.current = null; setScanFor({ kind: "new" }); }}>📷 Scanner</button>
      </div>
      <div className="iv-searchbar">
        <input className="iv-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher (GMO², id court, SN, désignation)" />
        <button type="button" className="btn btn-mini" onClick={() => setScanFor({ kind: "search" })} title="Scanner pour rechercher">📷</button>
      </div>

      {lignes.length === 0 && <div className="empty">Aucune ligne — ajoute un premier contrôle.</div>}
      {lignes.length > 0 && filtered.length === 0 && <div className="empty">Aucun résultat pour « {q} ».</div>}

      {filtered.map((l) => {
        const open = l.id === expandedId;
        const d = open ? draft : null;
        return (
          <div className="card iv-line" key={l.id}>
            <button type="button" className="iv-line-head" onClick={() => toggle(l)}>
              <div className="iv-line-main">
                <div className="iv-line-title">{l.id_court || l.scan || "(sans code)"}{l.designation ? ` · ${l.designation}` : ""}</div>
                <div className="iv-line-sub">{l.operation} · {fmtDate(l.date_op)} · éch. {fmtDate(l.echeance)}</div>
              </div>
              <span className={`iv-conf ${confClass(l.conformite)}`}>{confShort(l.conformite)}</span>
              <span className="iv-caret">{open ? "▾" : "▸"}</span>
            </button>

            {open && d && (
              <div className="iv-editor">
                <label className="field"><span>GMO² / scan</span>
                  <div className="iv-inline">
                    <input value={d.scan} onChange={(e) => update({ scan: e.target.value })} onBlur={() => doLookupWith()} placeholder="SRCONSONSBM2D-BUG070" />
                    <button type="button" className="btn btn-mini" onClick={() => setScanFor({ kind: "field" })} title="Scanner">📷</button>
                    <button type="button" className="btn btn-mini" onClick={() => doLookupWith()}>Chercher</button>
                  </div>
                </label>
                {lookupMsg && <p className="muted hint iv-tight">{lookupMsg}</p>}
                <p className="muted hint iv-tight">Scan caméra à venir — pour l'instant saisie/collage du code ; désignation et SN se remplissent depuis la base matériels.</p>

                <div className="grid2">
                  <label className="field"><span>Désignation</span>
                    <input value={d.designation ?? ""} onChange={(e) => update({ designation: e.target.value || null })} placeholder="auto / manuel" />
                  </label>
                  <label className="field"><span>N° de série</span>
                    <input value={d.sn ?? ""} onChange={(e) => update({ sn: e.target.value || null })} placeholder="auto / manuel" />
                  </label>
                </div>
                {d.id_court && <p className="muted hint iv-tight">ID court (étiquette) : <b>{d.id_court}</b></p>}

                <label className="field"><span>Type de contrôle</span>
                  <Chips options={TC_OPTS} value={d.type_controle} onChange={(v) => update({ type_controle: v ?? "Préventif" })} />
                </label>
                <label className="field"><span>Opération réalisée</span>
                  <Chips options={OP_OPTS} value={d.operation} onChange={(v) => update({ operation: v ?? "VP cas 1" })} />
                </label>
                <label className="field"><span>Conformité</span>
                  <Chips options={CF_OPTS} value={d.conformite} onChange={(v) => update({ conformite: v ?? "Conforme" })} />
                </label>

                <div className="grid2">
                  <label className="field"><span>Date de l'opération</span>
                    <input type="date" value={d.date_op} onChange={(e) => update({ date_op: e.target.value })} />
                  </label>
                  <label className="field"><span>Validité (ans)</span>
                    <input type="number" inputMode="numeric" min={0} value={d.validite_ans ?? ""} onChange={(e) => update({ validite_ans: e.target.value === "" ? null : Number(e.target.value) })} />
                  </label>
                </div>

                <label className="field"><span>Échéance{d.echeance_manuelle ? " (manuelle)" : " (auto)"}</span>
                  <div className="iv-inline">
                    <input type="date" value={d.echeance ?? ""} disabled={!CONFORMITE_AVEC_ECHEANCE.includes(d.conformite)} onChange={(e) => update({ echeance: e.target.value || null })} />
                    {d.echeance_manuelle && <button type="button" className="btn btn-mini" onClick={() => update({ echeance_manuelle: false })} title="Recalculer automatiquement">↺ auto</button>}
                  </div>
                </label>
                {!CONFORMITE_AVEC_ECHEANCE.includes(d.conformite) && <p className="muted hint iv-tight">Non conforme : pas d'échéance.</p>}

                <label className="field"><span>Commentaire</span>
                  <textarea value={d.commentaire ?? ""} onChange={(e) => update({ commentaire: e.target.value || null })} rows={2} />
                </label>

                <div className="grid2">
                  <label className="field"><span>Trigramme exécutant</span>
                    <input value={d.tri_exec ?? ""} onChange={(e) => update({ tri_exec: e.target.value.toUpperCase() || null })} maxLength={3} placeholder="RBB" />
                  </label>
                  <label className="field"><span>Trigramme CT</span>
                    <input value={d.tri_ct ?? ""} onChange={(e) => update({ tri_ct: e.target.value.toUpperCase() || null })} maxLength={3} placeholder="—" />
                  </label>
                </div>

                <button type="button" className="btn btn-danger" onClick={() => removeLigne(d.id)}>Supprimer la ligne</button>
              </div>
            )}
          </div>
        );
      })}

      {pickerOpen && (
        <MaterielPicker
          addedScans={new Set(lignes.map((l) => l.scan).filter(Boolean))}
          onPick={(m) => void createLineFromScan(m.scan)}
          onManual={onManualLine}
          onClose={onPickerClose}
        />
      )}

      {scanFor && (
        <ScannerModal
          title={scanFor.kind === "search" ? "Scanner pour rechercher" : "Scanner un équipement"}
          allowContinuous={scanFor.kind === "new"}
          onDetected={onScanDetected}
          onClose={onScanClose}
        />
      )}
    </div>
  );
}
