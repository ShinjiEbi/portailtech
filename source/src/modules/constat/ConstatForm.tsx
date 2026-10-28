// Saisie d'un constat de vérification lié à une ligne d'intervention.
// Préremplissage depuis la ligne (équipement, date, conformité, trigrammes) et l'ECME (sources).
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { db, metaGet, metaSet } from "../../lib/db";
import { SignaturePad } from "../../components/SignaturePad";
import { LignePhotos } from "../../components/LignePhotos";
import { dateOfIso, nomExport, saveLigne, suffixeConstat } from "../../lib/interventions";
import { getParams } from "../../lib/planning";
import {
  CONSTAT_MODELES, MA_SIGNATURE, numeroConstat, constatOfLigne, deleteConstat, fmtBq, modeleById, modeleForLigne, parseFrDate,
  prefillConstat, saveConstat, sourcesFor, toutConforme, parseTol, evalTol, activiteSurfacique, parseValeur,
  type ConstatModele, type SourceChoice, type TplCell, type TplRow, type TolEval,
} from "../../lib/constats";
import { siteFromIdCourt } from "../../lib/materiels";
import type { Constat, ConstatValue, InterventionLigne } from "../../lib/types";

const GROUPES: { g: "entree" | "intervention" | "sortie" | "jugement"; titre: string; multi?: boolean }[] = [
  { g: "entree", titre: "État en entrée" },
  { g: "intervention", titre: "Intervention réalisée", multi: true },
  { g: "sortie", titre: "État en sortie" },
  { g: "jugement", titre: "Jugement" },
];

export function ConstatForm() {
  const { id: listingId = "", ligneId = "" } = useParams();
  const [sp] = useSearchParams();
  const nav = useNavigate();
  const [ligne, setLigne] = useState<InterventionLigne | null | undefined>(undefined);
  const [c, setC] = useState<Constat | null>(null);
  const [srcOpts, setSrcOpts] = useState<Record<string, SourceChoice[]>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const saveT = useRef<number>();
  const [sigFor, setSigFor] = useState<{ key: string; title: string; mine?: boolean } | null>(null);
  const [maSig, setMaSig] = useState<string | null>(null);
  const [tri, setTri] = useState<string>("");
  useEffect(() => {
    metaGet(MA_SIGNATURE).then(setMaSig);
    getParams().then((p) => setTri(p.trigramme ?? "")).catch(() => {});
  }, []);
  const pending = useRef<Constat | null>(null);

  // chargement : constat existant, sinon préremplissage depuis la ligne
  useEffect(() => {
    (async () => {
      const l = await db.intervention_lignes.get(ligneId);
      if (!l || l.deleted) { setLigne(null); return; }
      setLigne(l);
      const ex = await constatOfLigne(ligneId);
      const forced = sp.get("modele");
      if (ex && (!forced || forced === ex.template_id)) { setC(ex); return; }
      const m = (forced && modeleById(forced)) || (await modeleForLigne(l)) || CONSTAT_MODELES[0];
      const n = await prefillConstat(m, l);
      if (ex) n.id = ex.id; // changement de modèle : on remplace le constat existant
      setC(n);
      await saveConstat(n);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ligneId]);

  // sauvegarde différée (frappe) + à la sortie
  function persist(next: Constat) {
    pending.current = next;
    window.clearTimeout(saveT.current);
    saveT.current = window.setTimeout(() => { if (pending.current) saveConstat(pending.current); pending.current = null; }, 600);
  }
  useEffect(() => () => { window.clearTimeout(saveT.current); if (pending.current) saveConstat(pending.current); }, []);

  const modele: ConstatModele | null = c ? modeleById(c.template_id) : null;
  const t = modele?.tpl;
  const v = c?.values ?? {};
  const site = ligne ? siteFromIdCourt(ligne.id_court) : null;
  const dateVerif = typeof v.date_verif === "string" ? v.date_verif : "";

  // listes de sources compatibles (recalculées si la date de vérification change)
  useEffect(() => {
    if (!t) return;
    const at = parseFrDate(dateVerif) ?? new Date();
    (async () => {
      const o: Record<string, SourceChoice[]> = {};
      for (const s of t.sources) o[s.id] = await sourcesFor(s, at, site);
      setSrcOpts(o);
    })();
  }, [t, dateVerif, site]);

  function setVals(patch: Record<string, ConstatValue>) {
    setC((prev) => {
      if (!prev) return prev;
      const next = { ...prev, values: { ...prev.values, ...patch } };
      persist(next);
      return next;
    });
  }
  const sv = (k: string) => (typeof v[k] === "string" ? (v[k] as string) : "");

  // regroupement des lignes du tableau par titre de section
  const sections = useMemo(() => {
    const out: { titre: TplRow | null; idx: number; rows: { r: TplRow; i: number }[] }[] = [];
    t?.rows.forEach((r, i) => {
      if (r.kind === "titre" && (r.bold || r.choice || !out.length)) out.push({ titre: r, idx: i, rows: [] });
      else if (r.kind === "titre") out[out.length - 1].rows.push({ r, i });
      else { if (!out.length) out.push({ titre: null, idx: -1, rows: [] }); out[out.length - 1].rows.push({ r, i }); }
    });
    return out;
  }, [t]);

  // Activité surfacique de référence d'après la source choisie (nucléide cité dans le libellé
  // de la ligne, sinon par rayonnement) : activité saisie / surface active (diamètre ECME).
  const asRefFor = (label: string) => (ray: "α" | "β"): number | null => {
    if (!t) return null;
    const m = label.match(/(\d{2,3})\s*(Co|Am|Sr|Cs|Pu)/);
    const want = m ? `${m[2]}-${m[1]}` : null;
    const byRay = ray === "α" ? ["Am-241", "Pu-239"] : ["Co-60", "Sr-90", "Cs-137"];
    const slot = t.sources.find((s) => s.rn && (want ? s.rn === want : byRay.includes(s.rn)));
    if (!slot) return null;
    const ch = (srcOpts[slot.id] ?? []).find((o) => o.etalon.id === v[`src.${slot.id}.etalon`]);
    const act = parseValeur(typeof v[`src.${slot.id}.act`] === "string" ? (v[`src.${slot.id}.act`] as string) : "") ?? ch?.actBq ?? null;
    return activiteSurfacique(act, ch?.etalon.valeurs?.["c_diam"]);
  };
  const tolOf = (r: TplRow, k: "avant" | "apres", i: number): TolEval | null => {
    const cl = r[k];
    if (!cl || cl.type === "choice") return null;
    return evalTol(parseTol(r.tol), typeof v[`r${i}.${k}`] === "string" ? (v[`r${i}.${k}`] as string) : "", asRefFor(r.label));
  };

  // « après ajustage » est facultatif : seul « avant » compte dans l'avancement
  const stats = useMemo(() => {
    if (!t) return { todo: 0, total: 0, nc: 0 };
    let todo = 0, total = 0, nc = 0;
    t.rows.forEach((r, i) => {
      const cl = r.avant;
      if (cl) {
        total++;
        if (!v[`r${i}.avant`] && !(cl.type === "textso" && v[`r${i}.avant.so`])) todo++;
      }
      for (const k of ["avant", "apres"] as const) {
        if (v[`r${i}.${k}`] === "NC") nc++;
        else if (tolOf(r, k, i)?.ok === false) nc++;
      }
    });
    return { todo, total, nc };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t, v, srcOpts]);

  async function exportPdf() {
    if (!c || busy) return;
    if (pending.current) { await saveConstat(pending.current); pending.current = null; }
    setBusy(true); setMsg("");
    try {
      const { buildConstatPdf, buildCtPdf } = await import("../../lib/constatPdf");
      const { saveBlobs } = await import("../../lib/xlsx");
      const base = import.meta.env.BASE_URL;
      const d = parseFrDate(dateVerif) ?? dateOfIso(ligne?.date_op);
      const eq = { designation: ligne?.designation ?? null, id_court: ligne?.id_court || sv("id_client"), scan: ligne?.scan ?? "" };
      const files = [{ blob: await buildConstatPdf(c, base), name: nomExport(eq, d, ligne ? suffixeConstat(ligne) : "VP") }];
      // documents CT : PDF séparé (sans le constat)
      const docs = ligne?.photos ?? [];
      if (docs.length && c.values.annexePhotos !== false) {
        const ref = [eq.designation, eq.id_court].filter(Boolean).join(" · ");
        files.push({ blob: await buildCtPdf(docs, base, ref), name: nomExport(eq, d, "CT") });
      }
      await saveBlobs(files);
    } catch (e) {
      setMsg("Export impossible : " + (e instanceof Error ? e.message : String(e)));
    } finally { setBusy(false); }
  }

  async function changeModele(id: string) {
    if (!c || id === c.template_id) return;
    if (!confirm("Changer de modèle de constat ? Les mesures saisies seront perdues.")) return;
    nav(`/interventions/${listingId}/constat/${ligneId}?modele=${id}`, { replace: true });
    const m = modeleById(id)!;
    const n = await prefillConstat(m, ligne!);
    n.id = c.id;
    setC(n); await saveConstat(n);
  }
  async function reprefill() {
    if (!c || !ligne || !modele) return;
    if (!confirm("Réinitialiser le constat depuis la ligne ? Toutes les saisies seront remplacées.")) return;
    const n = await prefillConstat(modele, ligne);
    n.id = c.id; setC(n); await saveConstat(n);
  }
  async function remove() {
    if (!c || !confirm("Supprimer ce constat ?")) return;
    window.clearTimeout(saveT.current); pending.current = null;
    await deleteConstat(c.id);
    nav(`/interventions/${listingId}`);
  }

  if (ligne === undefined || (ligne && !c)) return <div className="splash">…</div>;
  if (ligne === null || !c || !t || !modele)
    return <div><Link to={`/interventions/${listingId}`} className="back">← Listing</Link><div className="empty">Ligne introuvable.</div></div>;

  return (
    <div className="cst">
      {sigFor && (
        <SignaturePad title={sigFor.title} onClose={() => setSigFor(null)} onDone={(png) => {
          setVals({ [sigFor.key]: png });
          if (sigFor.mine) { metaSet(MA_SIGNATURE, png); setMaSig(png); }
          setSigFor(null);
        }} />
      )}
      <Link to={`/interventions/${listingId}`} className="back">← Listing</Link>
      <div className="page-head">
        <h2>Constat · {ligne.id_court || ligne.scan || "équipement"}</h2>
        <span className="total">{stats.total - stats.todo}/{stats.total}</span>
      </div>
      <label className="field">
        <span>Modèle</span>
        <select value={c.template_id} onChange={(e) => changeModele(e.target.value)}>
          {CONSTAT_MODELES.map((m) => <option key={m.id} value={m.id}>{m.id} — {m.nom}</option>)}
        </select>
      </label>

      <div className="composer">
        <h3 className="section-title">Instrument vérifié</h3>
        <div className="grid2">
          <label className="field">
            <span>Numéro de constat</span>
            <span className="cst-num">
              <input className="mono" value={sv("numero")} onChange={(e) => setVals({ numero: e.target.value.toUpperCase() })} placeholder="RBB2610261153C" />
              <button type="button" className="btn btn-mini" title="Régénérer avec l'heure actuelle"
                onClick={() => setVals({ numero: numeroConstat(tri || ligne.tri_exec) })}>↻</button>
            </span>
          </label>
          <TextF label="Date de vérification" v={sv("date_verif")} on={(x) => setVals({ date_verif: x })} ph="jj/mm/aaaa" mono />
          <TextF label="Délivré à" v={sv("delivre_a")} on={(x) => setVals({ delivre_a: x })} />
          <TextF label="N° série" v={sv("sn")} on={(x) => setVals({ sn: x })} mono />
          <TextF label="Identification client" v={sv("id_client")} on={(x) => setVals({ id_client: x })} mono />
          <TextF label="Localisation" v={sv("localisation")} on={(x) => setVals({ localisation: x })} />
        </div>
      </div>

      <div className="composer">
        {GROUPES.map(({ g, titre, multi }) => {
          const opts = t.etats.filter((e) => e.group === g);
          if (!opts.length) return null;
          const cur = v[`etat.${g}`];
          const arr = Array.isArray(cur) ? cur : [];
          return (
            <div className="field" key={g}>
              <span>{titre}{multi ? " (plusieurs choix)" : ""}</span>
              <div className="chips">
                {opts.map((o) => {
                  const on = multi ? arr.includes(o.label) : cur === o.label;
                  return (
                    <button key={o.label} type="button" className={`chip ${on ? "on" : ""}`}
                      onClick={() => setVals({ [`etat.${g}`]: multi ? (on ? arr.filter((x) => x !== o.label) : [...arr, o.label]) : (on ? null : o.label) })}>
                      {o.label}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      <div className="composer">
        <h3 className="section-title">Équipements de référence</h3>
        {t.sources.map((s) => {
          const opts = srcOpts[s.id] ?? [];
          const sel = sv(`src.${s.id}.etalon`);
          return (
            <div className="cst-src" key={s.id}>
              <p className="muted cst-src-lbl">{s.label.replace(/\s*n°\s*:.*$/i, "")}</p>
              {(s.rn || opts.length > 0) && (
                <select value={sel} onChange={(e) => {
                  const o = opts.find((x) => x.etalon.id === e.target.value);
                  setVals({ [`src.${s.id}.etalon`]: e.target.value || null, [`src.${s.id}.num`]: o?.num ?? "", ...(s.act ? { [`src.${s.id}.act`]: fmtBq(o?.actBq ?? null) } : {}) });
                }}>
                  <option value="">{opts.length ? "— Choisir dans l'ECME —" : "Aucune source compatible dans l'ECME"}</option>
                  {opts.map((o) => (
                    <option key={o.etalon.id} value={o.etalon.id}>
                      {o.num}{o.etalon.num_client && o.etalon.num_client !== o.num ? ` (${o.etalon.num_client})` : ""}{o.typeS ? ` · ${o.typeS}` : ""}{o.actBq != null ? ` · ${fmtBq(o.actBq)} Bq` : ""}{o.client ? ` · ${o.client.replace(/^CNPE\s+/, "")}` : ""}
                    </option>
                  ))}
                </select>
              )}
              <div className="grid2" style={{ marginTop: 8 }}>
                <TextF label="N°" v={sv(`src.${s.id}.num`)} on={(x) => setVals({ [`src.${s.id}.num`]: x })} mono />
                {s.act && <TextF label={`Activité (Bq) au ${dateVerif || "jour"}`} v={sv(`src.${s.id}.act`)} on={(x) => setVals({ [`src.${s.id}.act`]: x })} mono />}
              </div>
            </div>
          );
        })}
      </div>

      <div className="composer">
        <div className="grid2">
          <div>
            <TextF label="Exécutant — Nom" v={sv("pers.exec")} on={(x) => setVals({ "pers.exec": x })} />
            <SigField png={sv("pers.exec.sig")} onSign={() => setSigFor({ key: "pers.exec.sig", title: "Signature de l'exécutant", mine: true })}
              onClear={() => setVals({ "pers.exec.sig": null })}
              mine={maSig && sv("pers.exec.sig") !== maSig ? () => setVals({ "pers.exec.sig": maSig }) : undefined} />
          </div>
          <div>
            <TextF label="Contrôleur technique — Nom" v={sv("pers.ct")} on={(x) => setVals({ "pers.ct": x })} />
            <SigField png={sv("pers.ct.sig")} onSign={() => setSigFor({ key: "pers.ct.sig", title: "Signature du contrôleur technique" })}
              onClear={() => setVals({ "pers.ct.sig": null })} />
          </div>
        </div>
      </div>

      <div className="section-head cst-mes-head">
        <h3 className="section-title">Mesures réalisées</h3>
        <button type="button" className="btn btn-mini" onClick={() => setVals(toutConforme(t, v))} title="Coche C (ou la valeur attendue) dans toutes les cases encore vides">✓ Tout conforme</button>
      </div>
      <p className="muted hint">{stats.todo ? `${stats.todo} case(s) « avant » à renseigner` : "Toutes les cases « avant » sont renseignées."} · « Après ajustage » facultatif · C = conforme, NC = non conforme, SO = sans objet.</p>
      {stats.nc > 0 && <p className="error">⚠ {stats.nc} valeur(s) non conforme(s) ou hors tolérance — vérifie le jugement.</p>}

      {sections.map((sec, si) => (
        <div className="composer cst-sec" key={si}>
          {sec.titre && (
            <div className="cst-sec-head">
              <b>{sec.titre.label}</b>
              {sec.titre.choice && <ChoiceChips opts={sec.titre.choice.map((o) => o.v)} val={sv(`r${sec.idx}.choice`)} on={(x) => setVals({ [`r${sec.idx}.choice`]: x })} />}
              {sec.rows.some(({ r }) => r.kind === "mesure") && (
                <button type="button" className="add-mini" onClick={() => setVals(toutConforme(t, v, sec.rows.map((x) => x.i)))}>✓ C</button>
              )}
            </div>
          )}
          {sec.rows.map(({ r, i }) => r.kind === "titre" ? (
            <div className="cst-sub" key={i}>{r.label}</div>
          ) : (
            <div className="cst-row" key={i}>
              <div className="cst-row-head">
                <span className="cst-lbl">{r.label || "—"}</span>
                {r.tol && <span className="cst-tol">{r.tol}{(() => {
                  const tl = parseTol(r.tol);
                  if (tl?.kind !== "as") return null;
                  const ref = asRefFor(r.label)(tl.ray);
                  return ref == null ? " · source ?" : ` · As = ${fmtNum(ref)} → ${fmtNum(ref * (1 - tl.pct / 100))} à ${fmtNum(ref * (1 + tl.pct / 100))} Bq/cm²`;
                })()}</span>}
                {r.tolChoice && <ChoiceChips opts={r.tolChoice.map((o) => o.v)} val={sv(`r${i}.tol`)} on={(x) => setVals({ [`r${i}.tol`]: x })} />}
              </div>
              <div className="cst-cells">
                <Cell lbl="Avant ajustage" cell={r.avant} k={`r${i}.avant`} v={v} set={setVals} ev={tolOf(r, "avant", i)} />
                <Cell lbl="Après (facultatif)" cell={r.apres} k={`r${i}.apres`} v={v} set={setVals} ev={tolOf(r, "apres", i)} />
              </div>
              {r.obs && <input className="cst-obs" value={sv(`r${i}.obs`)} onChange={(e) => setVals({ [`r${i}.obs`]: e.target.value })} placeholder="Observation" />}
              {r.obsFields && (
                <div className="cst-cells">
                  {r.obsFields.map((f) => f.id === "visa" ? (
                    <SigField key={f.id} small png={sv(`r${i}.visa.sig`)} label="Visa"
                      onSign={() => setSigFor({ key: `r${i}.visa.sig`, title: "Visa du contrôleur technique" })}
                      onClear={() => setVals({ [`r${i}.visa.sig`]: null })} />
                  ) : (
                    <input key={f.id} className="cst-obs" value={sv(`r${i}.${f.id}`)} onChange={(e) => setVals({ [`r${i}.${f.id}`]: e.target.value })}
                      placeholder={f.id === "nom" ? "Nom" : f.id === "visa" ? "Visa" : "Date"} />
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      ))}

      <div className="composer">
        <h3 className="section-title">Documents CT{ligne.photos?.length ? ` (${ligne.photos.length})` : ""}</h3>
        <p className="muted hint">Mêmes documents que la ligne d'intervention (photos, PDF, HTML, texte).</p>
        <LignePhotos photos={ligne.photos ?? []} onChange={async (p) => { const nl = { ...ligne, photos: p }; setLigne(nl); await saveLigne(nl); }} />
        {(ligne.photos?.length ?? 0) > 0 && (
          <label className="field-check">
            <input type="checkbox" checked={v.annexePhotos !== false} onChange={(e) => setVals({ annexePhotos: e.target.checked })} />
            <span>Exporter aussi les documents CT (PDF séparé « _CT »)</span>
          </label>
        )}
      </div>

      {t.comments && (
        <label className="field">
          <span>Commentaires</span>
          <textarea rows={4} value={sv("comments")} onChange={(e) => setVals({ comments: e.target.value })} />
        </label>
      )}

      {msg && <p className="error">{msg}</p>}
      <div className="btn-row cst-actions">
        <button type="button" className="btn btn-primary" onClick={exportPdf} disabled={busy}>{busy ? "Génération…" : "⬇ Exporter le PDF"}</button>
      </div>
      <div className="btn-row">
        <button type="button" className="btn" onClick={reprefill}>↺ Repréremplir</button>
        <button type="button" className="btn btn-danger" onClick={remove}>Supprimer</button>
      </div>
    </div>
  );
}

function SigField({ png, onSign, onClear, mine, small, label }: { png: string; onSign: () => void; onClear: () => void; mine?: () => void; small?: boolean; label?: string }) {
  return (
    <div className="sig-field">
      {label && <small className="muted">{label}</small>}
      {png ? <img className={`sig-thumb ${small ? "small" : ""}`} src={png} alt="signature" /> : null}
      <button type="button" className="btn btn-mini" onClick={onSign}>✍ {png ? "Re-signer" : "Signer"}</button>
      {mine && <button type="button" className="btn btn-mini" onClick={mine}>Ma signature</button>}
      {png && <button type="button" className="btn btn-mini" onClick={onClear}>✕</button>}
    </div>
  );
}

function TextF({ label, v, on, ph, mono }: { label: string; v: string; on: (x: string) => void; ph?: string; mono?: boolean }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input className={mono ? "mono" : ""} value={v} placeholder={ph} onChange={(e) => on(e.target.value)} />
    </label>
  );
}

function ChoiceChips({ opts, val, on }: { opts: string[]; val: string; on: (x: string | null) => void }) {
  return (
    <span className="cst-choice">
      {opts.map((o) => (
        <button key={o} type="button" className={`cst-ch ${val === o ? `on ${o === "NC" ? "nc" : ""}` : ""}`} onClick={() => on(val === o ? null : o)}>{o}</button>
      ))}
    </span>
  );
}

const fmtNum = (x: number) => (Math.abs(x) >= 100 ? Math.round(x).toLocaleString("fr-FR") : x.toLocaleString("fr-FR", { maximumSignificantDigits: 3 }));

function Cell({ lbl, cell, k, v, set, ev }: { lbl: string; cell: TplCell | undefined; k: string; v: Record<string, ConstatValue>; set: (p: Record<string, ConstatValue>) => void; ev?: TolEval | null }) {
  const s = typeof v[k] === "string" ? (v[k] as string) : "";
  if (!cell) return <div className="cst-cell cst-none"><small>{lbl}</small>—</div>;
  return (
    <div className="cst-cell">
      <small>{lbl}</small>
      {cell.type === "choice" ? (
        <ChoiceChips opts={cell.options.map((o) => o.v)} val={s} on={(x) => set({ [k]: x })} />
      ) : (
        <span className="cst-inl">
          <input className={ev?.ok === true ? "tol-ok" : ev?.ok === false ? "tol-nc" : ""} value={s} onChange={(e) => set({ [k]: e.target.value })} inputMode="text" autoCapitalize="off" autoCorrect="off" />
          {ev?.ok != null && <span className={`cst-ev ${ev.ok ? "ok" : "nc"}`} title={`${ev.min ?? "−∞"} … ${ev.max ?? "+∞"}`}>{ev.ok ? "C" : "NC"}</span>}
          {cell.type === "textso" && (
            <button type="button" className={`cst-ch ${v[`${k}.so`] === true ? "on" : ""}`} onClick={() => set({ [`${k}.so`]: v[`${k}.so`] !== true })}>SO</button>
          )}
        </span>
      )}
    </div>
  );
}
