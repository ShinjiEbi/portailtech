import { useEffect, useRef, useState } from "react";
import { useMemoState, clearMemo } from "../../lib/memo";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { Chips } from "../../components/Chips";
import { ScannerModal } from "../../components/ScannerModal";
import { EquipSearch } from "../../components/EquipSearch";
import { LignePhotos } from "../../components/LignePhotos";
import { bertinStatus, etiquetteOf, imprimer, type Etiquette } from "../../lib/bertinPrint";

// Aperçu de l'étiquette telle qu'elle sera imprimée
function ApercuEtiquette({ l }: { l: InterventionLigne }) {
  const [src, setSrc] = useState<string | null>(null);
  const e = etiquetteOf(l);
  const key = typeof e === "string" ? e : JSON.stringify(e);
  useEffect(() => {
    let alive = true;
    if (typeof e === "string") { setSrc(null); return; }
    import("../../lib/etiquette").then(({ renderEtiquette }) => renderEtiquette(e)).then((u) => { if (alive) setSrc(u); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  if (typeof e === "string") return <p className="muted hint iv-tight">Étiquette : {e}</p>;
  return src ? <img className="lbl-preview" src={src} alt="Aperçu de l'étiquette" /> : null;
}
import { getParams } from "../../lib/planning";
import { CONSTAT_MODELES, constatsOfListing, modeleForLigne } from "../../lib/constats";
import {
  blankLigne, deleteLigne, deriveEcheance, getListing, linesOf, lookupEquipement, saveLigne, validiteForOperation,
  dateOfIso, nomExport,
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

  const [q, setQ] = useMemoState(`listing:${listingId}:q`, "");
  const [expandedId, setExpandedId] = useMemoState<string | null>(`listing:${listingId}:open`, null);
  const [draft, setDraft] = useState<InterventionLigne | null>(null);
  const [lookupMsg, setLookupMsg] = useState("");
  const [triExec, setTriExec] = useState<string | null>(null);
  const [scanFor, setScanFor] = useState<null | { kind: "new" } | { kind: "field" } | { kind: "search" }>(null);
  const lastCreatedRef = useRef<InterventionLigne | null>(null);
  const nav = useNavigate();
  // constats déjà saisis + modèle de constat reconnu pour chaque équipement
  const constats = useLiveQuery(() => (listingId ? constatsOfListing(listingId) : Promise.resolve([])), [listingId]) ?? [];
  const constatByLigne = new Map(constats.map((c) => [c.ligne_id, c]));
  const [modeleOf, setModeleOf] = useState<Record<string, string | null>>({});
  const [autreModele, setAutreModele] = useState("");
  useEffect(() => {
    let alive = true;
    (async () => {
      const m: Record<string, string | null> = {};
      for (const l of lignes) m[l.id] = (await modeleForLigne(l))?.id ?? null;
      if (alive) setModeleOf(m);
    })();
    return () => { alive = false; };
  }, [lignes]);

  useEffect(() => { if (listingId) getListing(listingId).then((l) => setListing(l ?? null)); }, [listingId]);
  useEffect(() => { getParams().then((p) => setTriExec(p.trigramme ?? null)); }, []);
  // ligne ouverte mémorisée : on recharge son brouillon au retour sur la page
  useEffect(() => {
    if (expandedId && (!draft || draft.id !== expandedId)) {
      const l = lignes.find((x) => x.id === expandedId);
      if (l) setDraft(l);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expandedId, lignes]);

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

  // ---- étiquettes BertinPrint ------------------------------------------------
  const [printing, setPrinting] = useState(false);
  const [printMsg, setPrintMsg] = useState<{ ok: boolean; t: string } | null>(null);
  async function printLignes(ls: InterventionLigne[]) {
    if (printing || !ls.length) return;
    const ok: { l: InterventionLigne; e: Etiquette }[] = [];
    const ko: string[] = [];
    for (const l of ls) {
      const e = etiquetteOf(l);
      if (typeof e === "string") ko.push(`${l.id_court || l.scan || "?"} : ${e}`); else ok.push({ l, e });
    }
    if (!ok.length) { setPrintMsg({ ok: false, t: "Rien à imprimer — " + ko.join(" ; ") }); return; }
    setPrinting(true); setPrintMsg({ ok: true, t: `Impression de ${ok.length} étiquette(s)…` });
    try {
      await imprimer(ok.map((x) => x.e));
      const now = new Date().toISOString();
      for (const { l } of ok) {
        const nl = { ...l, imprime_le: now };
        await saveLigne(nl);
        if (draft?.id === l.id) setDraft((dd) => (dd ? { ...dd, imprime_le: now } : dd));
      }
      setPrintMsg({ ok: true, t: `✓ ${ok.length} étiquette(s) imprimée(s)` + (ko.length ? ` — ignorée(s) : ${ko.join(" ; ")}` : "") });
    } catch (e) {
      setPrintMsg({ ok: false, t: "❌ " + (e instanceof Error ? e.message : String(e)) });
    } finally { setPrinting(false); }
  }
  async function printAll() {
    const todo = lignes.filter((l) => !l.imprime_le);
    if (todo.length) return printLignes(todo);
    if (lignes.length && confirm(`Toutes les étiquettes ont déjà été imprimées. Tout réimprimer (${lignes.length}) ?`)) return printLignes(lignes);
  }
  async function resetPrint() {
    const done = lignes.filter((l) => l.imprime_le);
    if (!done.length || !confirm(`Remettre ${done.length} étiquette(s) à « non imprimée » ?`)) return;
    for (const l of done) await saveLigne({ ...l, imprime_le: null });
    if (draft) setDraft((dd) => (dd ? { ...dd, imprime_le: null } : dd));
    setPrintMsg({ ok: true, t: "Marquage d'impression réinitialisé." });
  }
  async function checkPrinter() {
    setPrintMsg({ ok: true, t: "Test de BertinPrint…" });
    const s = await bertinStatus();
    setPrintMsg({ ok: s.printer, t: (s.printer ? "✓ " : "⚠ ") + s.msg });
  }
  const nonImprimees = lignes.filter((l) => !l.imprime_le).length;

  const [exporting, setExporting] = useState(false);
  async function exportXlsx() {
    if (!listing || exporting) return;
    setExporting(true);
    try {
      const { exportInterventionXlsx, saveBlob } = await import("../../lib/xlsx");
      const blob = await exportInterventionXlsx(listing, lignes);
      const safe = (listing.nom || "listing").replace(/[^\p{L}\p{N}_-]+/gu, "_").replace(/^_+|_+$/g, "") || "listing";
      await saveBlob(blob, `intervention_${safe}_${new Date().toISOString().slice(0, 10)}.xlsx`);
    } catch (e) {
      alert("Export Excel impossible : " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setExporting(false);
    }
  }

  // documents CT d'une ligne combinés en un seul PDF (sans le constat)
  const [ctBusy, setCtBusy] = useState(false);
  async function exportCt(l: InterventionLigne) {
    if (ctBusy || !l.photos?.length) return;
    setCtBusy(true);
    try {
      const { buildCtPdf } = await import("../../lib/constatPdf");
      const { saveBlob } = await import("../../lib/xlsx");
      const ref = [l.designation, l.id_court || l.scan].filter(Boolean).join(" · ");
      const blob = await buildCtPdf(l.photos, import.meta.env.BASE_URL, ref);
      await saveBlob(blob, nomExport(l, dateOfIso(l.date_op), "CT"));
    } catch (e) {
      alert("Export des documents CT impossible : " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setCtBusy(false);
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
        <button type="button" className="btn btn-primary" onClick={addLigne}>+ Ligne</button>
        <button type="button" className="btn btn-mini" onClick={() => { lastCreatedRef.current = null; setScanFor({ kind: "new" }); }}>📷 Scanner</button>
        <button type="button" className="btn btn-mini" onClick={exportXlsx} disabled={exporting || lignes.length === 0} title="Exporter le listing en Excel">{exporting ? "…" : "⬇ Excel"}</button>
      </div>
      <div className="iv-topbar iv-print">
        <button type="button" className="btn btn-mini" onClick={printAll} disabled={printing || lignes.length === 0}
          title="Imprimer les étiquettes non encore imprimées">{printing ? "🖨 …" : `🖨 Étiquettes${nonImprimees ? ` (${nonImprimees})` : " ✓"}`}</button>
        <button type="button" className="btn btn-mini" onClick={resetPrint} disabled={printing || nonImprimees === lignes.length} title="Remettre toutes les lignes à « non imprimée »">↺ Reset</button>
        <button type="button" className="btn btn-mini" onClick={checkPrinter} disabled={printing} title="Tester la connexion à BertinPrint">Test</button>
      </div>
      <div className="iv-searchbar">
        <input className="iv-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher (GMO², id court, SN, désignation)" />
        <button type="button" className="btn btn-mini" onClick={() => setScanFor({ kind: "search" })} title="Scanner pour rechercher">📷</button>
      </div>

      {printMsg && <p className={printMsg.ok ? "muted hint" : "error"} onClick={() => setPrintMsg(null)}>{printMsg.t}</p>}
      {lignes.length === 0 && <div className="empty">Aucune ligne — ajoute un premier contrôle.</div>}
      {lignes.length > 0 && filtered.length === 0 && <div className="empty">Aucun résultat pour « {q} ».</div>}

      {filtered.map((l) => {
        const open = l.id === expandedId;
        const d = open ? draft : null;
        return (
          <div className="card iv-line" key={l.id}>
            <div className="iv-line-row">
            <button type="button" className="iv-line-head" onClick={() => toggle(l)}>
              <div className="iv-line-main">
                <div className="iv-line-title">{l.id_court || l.scan || "(sans code)"}{l.designation ? ` · ${l.designation}` : ""}</div>
                <div className="iv-line-sub">{l.operation} · {fmtDate(l.date_op)} · éch. {fmtDate(l.echeance)}</div>
              </div>
              {constatByLigne.has(l.id) && <span className="cst-badge" title="Constat de vérification saisi">📄</span>}
              {(l.photos?.length ?? 0) > 0 && <span className="lp-badge" title="Documents joints">📎{l.photos!.length}</span>}
              <span className={`lbl-mac ${l.imprime_le ? "on" : ""}`}
                title={l.imprime_le ? `Étiquette imprimée le ${new Date(l.imprime_le).toLocaleString("fr-FR")}` : "Étiquette non imprimée"}>🏷{l.imprime_le ? "✓" : ""}</span>
              <span className={`iv-conf ${confClass(l.conformite)}`}>{confShort(l.conformite)}</span>
              <span className="iv-caret">{open ? "▾" : "▸"}</span>
            </button>
            <button type="button" className="btn btn-mini lbl-print" onClick={() => printLignes([l])} disabled={printing}
              title={l.imprime_le ? "Réimprimer l'étiquette" : "Imprimer l'étiquette"}>🖨</button>
            </div>

            {open && d && (
              <div className="iv-editor">
                <label className="field"><span>Équipement (GMO², id court, SN, désignation…)</span>
                  <div className="iv-inline">
                    <EquipSearch value={d.scan} onChange={(x) => update({ scan: x })} onBlur={() => doLookupWith()}
                      onPick={(m) => { update({ scan: m.scan }); void doLookupWith(m.scan); }} placeholder="BUG070, NT200, SN…" />
                    <button type="button" className="btn btn-mini" onClick={() => setScanFor({ kind: "field" })} title="Scanner">📷</button>
                    <button type="button" className="btn btn-mini" onClick={() => doLookupWith()}>Chercher</button>
                  </div>
                </label>
                {lookupMsg && <p className="muted hint iv-tight">{lookupMsg}</p>}
                <p className="muted hint iv-tight">Tape quelques caractères (id court, SN, type…) et choisis dans la liste, ou scanne l'étiquette 📷.</p>

                <div className="grid2">
                  <label className="field"><span>Désignation</span>
                    <input value={d.designation ?? ""} onChange={(e) => update({ designation: e.target.value || null })} placeholder="auto / manuel" />
                  </label>
                  <label className="field"><span>N° de série</span>
                    <input value={d.sn ?? ""} onChange={(e) => update({ sn: e.target.value || null })} placeholder="auto / manuel" />
                  </label>
                </div>
                {d.id_court && <p className="muted hint iv-tight">ID court (étiquette) : <b>{d.id_court}</b></p>}

                {(() => {
                  const cst = constatByLigne.get(d.id);
                  const mid = cst?.template_id ?? modeleOf[d.id] ?? null;
                  if (mid) return (
                    <div className={`cst-prompt ${cst ? "done" : ""}`}>
                      <div>
                        <b>📄 Constat de vérification {mid}</b>
                        <div className="muted">{cst ? "Saisi — modifier ou exporter le PDF" : "Équipement reconnu : préremplir le constat ?"}</div>
                      </div>
                      <button type="button" className={`btn ${cst ? "" : "btn-primary"}`} onClick={() => nav(`/interventions/${listingId}/constat/${d.id}`)}>
                        {cst ? "Ouvrir" : "Remplir"}
                      </button>
                    </div>
                  );
                  return (
                    <div className="iv-inline cst-other">
                      <select value={autreModele} onChange={(e) => setAutreModele(e.target.value)}>
                        <option value="">Constat de vérification : aucun modèle reconnu</option>
                        {CONSTAT_MODELES.map((m) => <option key={m.id} value={m.id}>{m.id} — {m.nom}</option>)}
                      </select>
                      <button type="button" className="btn btn-mini" disabled={!autreModele} onClick={() => nav(`/interventions/${listingId}/constat/${d.id}?modele=${autreModele}`)}>Remplir</button>
                    </div>
                  );
                })()}

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

                <div className="field"><span>Documents CT (photos, PDF, HTML, texte){d.photos?.length ? ` · ${d.photos.length}` : ""}</span>
                  <LignePhotos photos={d.photos ?? []} onChange={(p) => update({ photos: p })} />
                  {(d.photos?.length ?? 0) > 0 && (
                    <button type="button" className="btn btn-mini" onClick={() => exportCt(d)} disabled={ctBusy} title="Combiner les documents en un seul PDF (sans le constat)">
                      {ctBusy ? "Génération…" : "⬇ Exporter les documents CT (PDF)"}
                    </button>
                  )}
                </div>
                <div className="field"><span>Étiquette</span><ApercuEtiquette l={d} /></div>
                <button type="button" className="btn btn-danger" onClick={() => removeLigne(d.id)}>Supprimer la ligne</button>
              </div>
            )}
          </div>
        );
      })}

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
