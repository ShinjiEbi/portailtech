// Bibliothèque IZ / RTR — fiches individuelles d'entrée en zone (régime de travail radiologique).
// Champs calqués sur la fiche EDF : N° IZ + indice (code-barres Code 39 « 49281716 1 »),
// code travail, validité du RTR, activité, projet, tranche/local, valeurs prévues.
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useMemoState, clearMemo } from "../../lib/memo";
import { useLiveQuery } from "dexie-react-hooks";
import JsBarcode from "jsbarcode";
import { ScannerModal } from "../../components/ScannerModal";
import {
  allIz, blankIz, buildIzCode, deleteAllIz, deleteIz, exportCsv, exportJson, findByCode, getRtrConfig,
  importIzs, markUsed, normCode, parseImport, saveIz, setBarcodeFormat, setRtrConfig, validiteOf,
  RTR_DEFAULT_CONFIG, type RtrConfig, type Validite,
} from "../../lib/rtr";
import { RTR_BARCODE_FORMATS, type RtrBarcodeFormat, type RtrIz } from "../../lib/types";

type Tab = "library" | "settings";
type Cat = "all" | "recent" | "frequent" | `tag:${string}`;
type VFilter = "all" | "valide" | "bientot" | "expire";

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso.length === 10 ? iso + "T00:00:00" : iso)
    .toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });
}
function isThisMonth(iso: string | null): boolean {
  if (!iso) return false;
  const d = new Date(iso), n = new Date();
  return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth();
}
const recency = (iz: RtrIz) => iz.last_used || iz.created_at || "";
const countBy = (vals: string[]) => {
  const m = new Map<string, number>();
  for (const v of vals) m.set(v, (m.get(v) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
};
const izTitle = (iz: RtrIz) => iz.num_iz ? `${iz.num_iz}${iz.indice ? " " + iz.indice : ""}` : iz.code;
const mSv = (v: number | null, u: string) => (v == null ? "—" : `${v.toFixed(3)} ${u}`);

function ValiditeTag({ iz }: { iz: RtrIz }) {
  const { etat, jours } = validiteOf(iz);
  const txt: Record<Validite, string> = {
    valide: "Valide", bientot: `Expire dans ${jours} j`, expire: "Expiré", future: "Pas encore valide", inconnue: "Validité ?",
  };
  return <span className={`tag rtr-v-${etat}`}>{txt[etat]}</span>;
}

export function RtrView() {
  const rows = useLiveQuery(() => allIz(), [], []) ?? [];
  const [cfg, setCfg] = useState<RtrConfig>(RTR_DEFAULT_CONFIG);
  const [tab, setTab] = useMemoState<Tab>("rtr:tab", "library");
  const [q, setQ] = useMemoState("rtr:q", "");
  const [vf, setVf] = useMemoState<VFilter>("rtr:vf", "all");
  const [site, setSite] = useMemoState("rtr:site", "");
  const [projet, setProjet] = useMemoState("rtr:projet", "");
  const [cat, setCat] = useMemoState<Cat>("rtr:cat", "all");
  const [scan, setScan] = useState(false);
  const [edit, setEdit] = useState<RtrIz | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [showId, setShowId] = useState<string | null>(null);
  async function printBarcode(iz: RtrIz) {
    const l1 = (iz.label || iz.projet || "").trim();
    const l2 = [iz.site, iz.tranche && `T${iz.tranche}`].filter(Boolean).join(" ");
    flash("Impression de l'étiquette…");
    try {
      const { renderEtiquetteCodeBarre } = await import("../../lib/etiquette");
      const { imprimerImages } = await import("../../lib/bertinPrint");
      const png = await renderEtiquetteCodeBarre(iz.code, iz.barcode_format ?? "CODE39", l1, l2);
      await imprimerImages([png]);
      flash(`✓ Étiquette IZ ${izTitle(iz)} imprimée`);
    } catch (e) {
      flash("❌ " + (e instanceof Error ? e.message : String(e)));
    }
  }
  const [toast, setToast] = useState("");
  const toastT = useRef<number>();

  useEffect(() => { getRtrConfig().then(setCfg); }, []);

  function flash(msg: string) {
    setToast(msg);
    window.clearTimeout(toastT.current);
    toastT.current = window.setTimeout(() => setToast(""), 2200);
  }

  const sites = useMemo(() => countBy(rows.map((r) => r.site ?? "").filter(Boolean)), [rows]);
  const projets = useMemo(() => countBy(rows.map((r) => (r.projet ?? "").trim()).filter(Boolean)), [rows]);
  const tags = useMemo(() => countBy(rows.flatMap((r) => r.tags ?? [])).slice(0, 8), [rows]);
  const vCount = useMemo(() => {
    const c = { valide: 0, bientot: 0, expire: 0 };
    for (const r of rows) { const e = validiteOf(r).etat; if (e in c) c[e as keyof typeof c]++; }
    return c;
  }, [rows]);
  const recentCount = rows.filter((r) => isThisMonth(r.last_used)).length;

  const list = useMemo(() => {
    let f = rows.slice();
    if (vf !== "all") f = f.filter((r) => {
      const e = validiteOf(r).etat;
      return vf === "valide" ? e === "valide" || e === "bientot" : e === vf;
    });
    if (site) f = f.filter((r) => r.site === site);
    if (projet) f = f.filter((r) => (r.projet ?? "").trim() === projet);
    if (cat === "recent") f = f.sort((a, b) => recency(b).localeCompare(recency(a))).slice(0, 30);
    else if (cat === "frequent") f = f.filter((r) => (r.use_count || 0) > 0).sort((a, b) => (b.use_count || 0) - (a.use_count || 0));
    else if (cat.startsWith("tag:")) { const t = cat.slice(4); f = f.filter((r) => (r.tags ?? []).includes(t)); }
    const s = q.trim().toLowerCase();
    if (s) {
      const sn = normCode(s).toLowerCase();
      f = f.filter((r) => normCode(r.code).toLowerCase().includes(sn) ||
        [r.num_iz, r.code_travail, r.label, r.site, r.projet, r.activite, r.intervenant, r.local, r.objet, r.notes, ...(r.tags ?? [])]
          .some((v) => (v ?? "").toLowerCase().includes(s)));
    }
    if (cat === "all" && !s) {
      // valides d'abord, puis par usage récent
      const rank = (r: RtrIz) => (validiteOf(r).etat === "expire" ? 1 : 0);
      f.sort((a, b) => rank(a) - rank(b) || recency(b).localeCompare(recency(a)));
    }
    return f;
  }, [rows, vf, site, projet, cat, q]);

  async function onScanned(text: string) {
    const code = text.trim();
    if (!code) return;
    const ex = await findByCode(code);
    if (ex) {
      const u = await markUsed(ex.id);
      flash(`✓ IZ ${izTitle(ex)} — usage ${u?.use_count ?? ""}×`);
      setDetailId(ex.id);
    } else {
      setEdit(blankIz(code));
      flash("Nouvel IZ — complète avec la fiche RTR");
    }
  }

  const detail = detailId ? rows.find((r) => r.id === detailId) ?? null : null;
  const hasFilter = !!(site || projet || q || cat !== "all" || vf !== "all");

  return (
    <div className="rtr">
      <div className="page-head">
        <h2>Bibliothèque IZ</h2>
        <span className="total" title={`${recentCount} utilisé(s) ce mois`}>{rows.length} IZ · {vCount.valide + vCount.bientot} valides</span>
      </div>

      <div className="chips">
        <button className={`chip ${tab === "library" ? "on" : ""}`} onClick={() => setTab("library")}>📚 Bibliothèque</button>
        <button className={`chip ${tab === "settings" ? "on" : ""}`} onClick={() => setTab("settings")}>⚙ Réglages</button>
      </div>

      {tab === "library" ? (
        <>
          <div className="btn-row rtr-actions">
            <button className="btn btn-primary" onClick={() => setScan(true)}>📷 Scanner une fiche</button>
            <button className="btn" onClick={() => setEdit(blankIz())}>✏ Saisie manuelle</button>
          </div>

          <div className="iv-searchbar">
            <input className="iv-search" type="search" value={q} onChange={(e) => setQ(e.target.value)}
              placeholder="🔍 N° IZ, code travail, projet, site…" />
          </div>

          <div className="rtr-filters">
            <FilterRow title="Validité">
              <button className={`chip ${vf === "all" ? "on" : ""}`} onClick={() => setVf("all")}>Tous ({rows.length})</button>
              <button className={`chip ${vf === "valide" ? "on" : ""}`} onClick={() => setVf("valide")}>Valides ({vCount.valide + vCount.bientot})</button>
              {vCount.bientot > 0 && <button className={`chip ${vf === "bientot" ? "on" : ""}`} onClick={() => setVf("bientot")}>≤ 30 j ({vCount.bientot})</button>}
              {vCount.expire > 0 && <button className={`chip ${vf === "expire" ? "on" : ""}`} onClick={() => setVf("expire")}>Expirés ({vCount.expire})</button>}
            </FilterRow>
            {sites.length > 0 && (
              <FilterRow title="Site">
                <button className={`chip ${site === "" ? "on" : ""}`} onClick={() => setSite("")}>Tous</button>
                {sites.map(([s, n]) => (
                  <button key={s} className={`chip ${site === s ? "on" : ""}`} onClick={() => setSite(s)}>{s} ({n})</button>
                ))}
              </FilterRow>
            )}
            {projets.length > 0 && (
              <FilterRow title="Projet">
                <button className={`chip ${projet === "" ? "on" : ""}`} onClick={() => setProjet("")}>Tous</button>
                {projets.map(([l, n]) => (
                  <button key={l} title={l} className={`chip ${projet === l ? "on" : ""}`} onClick={() => setProjet(l)}>
                    {l.length > 30 ? l.slice(0, 28) + "…" : l} ({n})
                  </button>
                ))}
              </FilterRow>
            )}
            <FilterRow title="Catégorie">
              <button className={`chip ${cat === "all" ? "on" : ""}`} onClick={() => setCat("all")}>Tous</button>
              <button className={`chip ${cat === "recent" ? "on" : ""}`} onClick={() => setCat("recent")}>📅 Récents</button>
              <button className={`chip ${cat === "frequent" ? "on" : ""}`} onClick={() => setCat("frequent")}>⭐ Fréquents</button>
              {tags.map(([t, n]) => (
                <button key={t} className={`chip ${cat === `tag:${t}` ? "on" : ""}`} onClick={() => setCat(`tag:${t}`)}>#{t} ({n})</button>
              ))}
            </FilterRow>
          </div>

          {list.length === 0 ? (
            <div className="empty">
              {rows.length === 0 ? <>Aucun IZ enregistré.<br />Scanne le code-barres d'une fiche RTR ↑</>
                : hasFilter ? "Aucun résultat pour ces filtres." : "Aucun résultat."}
            </div>
          ) : list.map((iz) => (
            <div key={iz.id} className={`card rtr-card ${validiteOf(iz).etat === "expire" ? "rtr-expired" : ""}`}>
              <button type="button" className="rtr-card-main" onClick={() => setDetailId(iz.id)}>
                <div className="rtr-l1">
                  <span className="rtr-num">{iz.num_iz || iz.code}</span>
                  {iz.indice && <span className="rtr-ind">ind. {iz.indice}</span>}
                  {iz.code_travail && <span className="rtr-ct">CT {iz.code_travail}</span>}
                </div>
                <div className="rtr-l2">{iz.label || iz.projet || iz.activite || "—"}</div>
                <div className="rtr-l3">
                  <ValiditeTag iz={iz} />
                  {iz.validite_fin && <span>jusqu'au <b>{fmtDate(iz.validite_fin)}</b></span>}
                  {(iz.site || iz.tranche) && <span>{[iz.site, iz.tranche && `T${iz.tranche}`].filter(Boolean).join(" ")}</span>}
                  {iz.ded_max != null && <span>DED {iz.ded_max.toFixed(3)}</span>}
                </div>
                {iz.tags?.length > 0 && (
                  <div className="rtr-tags">{iz.tags.map((t) => <span key={t} className="tag type">#{t}</span>)}</div>
                )}
              </button>
              <div className="rtr-side">
                <button type="button" className="rtr-scan-btn" title="Présenter le code-barres au lecteur"
                  onClick={() => { setShowId(iz.id); void markUsed(iz.id); }}>
                  <span className="rtr-scan-ico">▮▯▮▮▯▮</span>
                  <span>Lecteur</span>
                </button>
                <button type="button" className="rtr-scan-btn" title="Imprimer une étiquette code-barres" onClick={() => printBarcode(iz)}>
                  <span className="rtr-scan-ico">🖨</span>
                  <span>Étiquette</span>
                </button>
              </div>
            </div>
          ))}
        </>
      ) : (
        <RtrSettings cfg={cfg} onCfg={async (c) => { setCfg(c); await setRtrConfig(c); }} flash={flash} />
      )}

      {scan && (
        <ScannerModal title="Scanner la fiche RTR" onDetected={(t) => onScanned(t)} onClose={() => setScan(false)} />
      )}
      {edit && (
        <RtrEditSheet iz={edit} cfg={cfg} rows={rows} onClose={() => setEdit(null)}
          onSaved={(msg) => { setEdit(null); flash(msg); }} />
      )}
      {(() => {
        const z = showId ? rows.find((r) => r.id === showId) : null;
        return z ? <ScanDisplay code={z.code} fmt={z.barcode_format ?? "CODE39"} title={izTitle(z)} onClose={() => setShowId(null)} /> : null;
      })()}
      {detail && (
        <RtrDetailSheet iz={detail} flash={flash} onClose={() => setDetailId(null)}
          onEdit={() => { setDetailId(null); setEdit(detail); }} />
      )}
      {toast && <div className="rtr-toast">{toast}</div>}
    </div>
  );
}

function FilterRow({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="filter-row">
      <span className="filter-lbl">{title}</span>
      <div className="filter-scroll"><div className="chips">{children}</div></div>
    </div>
  );
}

// ---------------------------------------------------------------------------
function RtrEditSheet({ iz, cfg, rows, onClose, onSaved }: {
  iz: RtrIz; cfg: RtrConfig; rows: RtrIz[]; onClose: () => void; onSaved: (msg: string) => void;
}) {
  const isNew = !rows.some((r) => r.id === iz.id);
  const [f, setF] = useState<RtrIz>(iz);
  // le contenu du code-barres suit N° IZ + indice, sauf s'il a été saisi à la main
  const [codeAuto, setCodeAuto] = useState(!iz.code || iz.code === buildIzCode(iz.num_iz, iz.indice));
  const [tagIn, setTagIn] = useState("");
  const set = <K extends keyof RtrIz>(k: K, v: RtrIz[K]) => setF((p) => {
    const n = { ...p, [k]: v };
    if (codeAuto && (k === "num_iz" || k === "indice")) n.code = buildIzCode(n.num_iz, n.indice);
    return n;
  });
  const txt = (k: keyof RtrIz) => ({ value: (f[k] as string | null) ?? "", onChange: (e: { target: { value: string } }) => set(k, e.target.value as never) });
  const num = (k: keyof RtrIz) => ({
    type: "number", inputMode: "decimal" as const, step: "0.001",
    value: f[k] == null ? "" : String(f[k]),
    onChange: (e: { target: { value: string } }) => {
      const v = e.target.value.replace(",", ".");
      set(k, (v === "" || isNaN(Number(v)) ? null : Number(v)) as never);
    },
  });

  const suggestions = useMemo(() => {
    const s = new Set<string>([...rows.flatMap((r) => r.tags ?? []), ...cfg.tags]);
    return [...s].filter((t) => !f.tags.includes(t)).sort().slice(0, 10);
  }, [rows, cfg.tags, f.tags]);
  const siteOptions = f.site && !cfg.sites.includes(f.site) ? [...cfg.sites, f.site] : cfg.sites;
  const projetsConnus = useMemo(() => [...new Set(rows.map((r) => r.projet).filter(Boolean) as string[])], [rows]);
  const activitesConnues = useMemo(() => [...new Set(rows.flatMap((r) => [r.activite, r.intervenant]).filter(Boolean) as string[])], [rows]);

  function addTag(t: string) {
    const v = t.trim().replace(/,$/, "");
    if (v && !f.tags.includes(v)) set("tags", [...f.tags, v]);
    setTagIn("");
  }

  async function save() {
    const code = f.code.trim() || buildIzCode(f.num_iz, f.indice);
    if (!code) { alert("N° IZ obligatoire"); return; }
    if (f.validite_debut && f.validite_fin && f.validite_fin < f.validite_debut) { alert("La fin de validité précède le début."); return; }
    const tagsFinal = tagIn.trim() && !f.tags.includes(tagIn.trim()) ? [...f.tags, tagIn.trim()] : f.tags;
    let base = f;
    const dup = await findByCode(code);
    if (dup && dup.id !== f.id) {
      if (!confirm(`L'IZ ${izTitle(dup)} existe déjà. Le remplacer par cette saisie ?`)) return;
      base = { ...f, id: dup.id, created_at: dup.created_at, use_count: Math.max(dup.use_count, f.use_count), last_used: dup.last_used ?? f.last_used };
    }
    const clean = (s: string | null) => (s ?? "").trim() || null;
    const strKeys = ["num_iz", "indice", "code_travail", "num_act", "activite", "intervenant", "projet", "objet",
      "label", "site", "tranche", "local", "notes", "validite_debut", "validite_fin"] as const;
    const cleaned = { ...base } as RtrIz;
    for (const k of strKeys) (cleaned as unknown as Record<string, unknown>)[k] = clean(base[k]);
    await saveIz({
      ...cleaned, code, tags: tagsFinal,
      ...(isNew && !base.last_used ? { use_count: 1, last_used: new Date().toISOString() } : {}),
    });
    onSaved(isNew ? "✓ IZ enregistré" : "✓ IZ modifié");
  }

  async function del() {
    if (!confirm(`Supprimer définitivement l'IZ ${izTitle(f)} ?`)) return;
    await deleteIz(f.id);
    onSaved("Supprimé");
  }

  return (
    <div className="pl-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="pl-sheet">
        <div className="pl-sheet-head">
          <span className="pl-sheet-title">{isNew ? "Nouvel IZ" : `IZ ${izTitle(f)}`}</span>
          <button className="pl-x" onClick={onClose} aria-label="Fermer">✕</button>
        </div>

        <div className="section-sep" style={{ marginTop: 0, borderTop: "none", paddingTop: 0 }}>Identification</div>
        <div className="grid2">
          <label className="field">
            <span>N° IZ <b style={{ color: "var(--danger)" }}>*</b></span>
            <input className="mono" inputMode="numeric" {...txt("num_iz")} placeholder="49281716" autoFocus={isNew && !f.num_iz} />
          </label>
          <label className="field">
            <span>Indice</span>
            <input className="mono" inputMode="numeric" {...txt("indice")} placeholder="1" />
          </label>
          <label className="field">
            <span>Code travail</span>
            <input className="mono" inputMode="numeric" {...txt("code_travail")} placeholder="068" autoFocus={isNew && !!f.num_iz} />
          </label>
          <label className="field">
            <span>N° Act</span>
            <input className="mono" inputMode="numeric" {...txt("num_act")} placeholder="29365316" />
          </label>
        </div>
        <label className="field">
          <span>Contenu du code-barres {codeAuto ? <small className="muted">(auto : N° IZ + indice)</small> : null}</span>
          <input className="mono" value={f.code} placeholder="49281716 1"
            onChange={(e) => { setCodeAuto(false); setF((p) => ({ ...p, code: e.target.value })); }} />
        </label>

        <div className="section-sep">Validité du RTR</div>
        <div className="grid2">
          <label className="field"><span>Du</span><input type="date" {...txt("validite_debut")} /></label>
          <label className="field"><span>Au</span><input type="date" {...txt("validite_fin")} /></label>
        </div>

        <div className="section-sep">Intervention</div>
        <datalist id="rtr-activites">{activitesConnues.map((a) => <option key={a} value={a} />)}</datalist>
        <datalist id="rtr-projets">{projetsConnus.map((a) => <option key={a} value={a} />)}</datalist>
        <label className="field"><span>Activité</span><input list="rtr-activites" {...txt("activite")} placeholder="KZC / BERTIN TECHNOLOGIES - MA" /></label>
        <label className="field"><span>Intervenant</span><input list="rtr-activites" {...txt("intervenant")} placeholder="KZC / BERTIN TECHNOLOGIES - MAINTEN" /></label>
        <label className="field"><span>Projet</span><input list="rtr-projets" {...txt("projet")} placeholder="TEM 2026" /></label>
        <div className="pl-row3">
          <label className="field">
            <span>Site</span>
            <select value={f.site ?? ""} onChange={(e) => set("site", e.target.value)}>
              <option value="">—</option>
              {siteOptions.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <label className="field"><span>Tranche</span><input {...txt("tranche")} placeholder="9" /></label>
          <label className="field"><span>Local</span><input {...txt("local")} placeholder="-" /></label>
        </div>
        <label className="field"><span>Objet d'intervention</span><input {...txt("objet")} /></label>

        <div className="section-sep">Valeurs prévues</div>
        <div className="grid2">
          <label className="field"><span>DED max prévu (mSv/h)</span><input {...num("ded_max")} placeholder="0.005" /></label>
          <label className="field"><span>Dont neutron (mSv/h)</span><input {...num("ded_neutron")} placeholder="0.000" /></label>
          <label className="field"><span>Dose moy. intervenant (mSv)</span><input {...num("dose_moy")} placeholder="0.158" /></label>
          <label className="field"><span>Dose moy. / jour (mSv/j)</span><input {...num("dose_jour")} placeholder="0.010" /></label>
          <label className="field"><span>DED trajet (mSv/h)</span><input {...num("ded_trajet")} placeholder="0.000" /></label>
        </div>

        <div className="section-sep">Perso</div>
        <label className="field"><span>Libellé court</span><input {...txt("label")} placeholder="ex: Maintenance balises T9" /></label>
        <div className="field">
          <span>Tags (Entrée pour valider)</span>
          <div className="rtr-taginput">
            {f.tags.map((t) => (
              <span key={t} className="rtr-pill">#{t}
                <button type="button" onClick={() => set("tags", f.tags.filter((x) => x !== t))} aria-label="Retirer">×</button>
              </span>
            ))}
            <input value={tagIn} onChange={(e) => setTagIn(e.target.value)} placeholder="ex: routine, étalonnage…"
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === ",") { e.preventDefault(); addTag(tagIn); }
                else if (e.key === "Backspace" && !tagIn && f.tags.length) set("tags", f.tags.slice(0, -1));
              }} />
          </div>
          {suggestions.length > 0 && (
            <div className="rtr-sugg">Suggérés : {suggestions.map((t) => (
              <button key={t} type="button" onClick={() => addTag(t)}>#{t}</button>
            ))}</div>
          )}
        </div>
        <label className="field">
          <span>Notes</span>
          <textarea rows={3} {...txt("notes")} placeholder="Modes opératoires, contacts, consignes…" />
        </label>
        <div className="btn-row">
          {!isNew && <button className="btn btn-danger" onClick={del}>Supprimer</button>}
          <button className="btn" onClick={onClose}>Annuler</button>
          <button className="btn btn-primary" onClick={save}>💾 Enregistrer</button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
function RtrDetailSheet({ iz, onClose, onEdit, flash }: {
  iz: RtrIz; onClose: () => void; onEdit: () => void; flash: (m: string) => void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [fmt, setFmt] = useState<RtrBarcodeFormat>(iz.barcode_format ?? "CODE39");
  const [full, setFull] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!svgRef.current) return;
    setErr("");
    try {
      JsBarcode(svgRef.current, iz.code, {
        format: fmt, displayValue: false, width: 2, height: 80, margin: 0,
        background: "#ffffff", lineColor: "#000000",
        valid: (ok: boolean) => { if (!ok) throw new Error("invalide"); },
      });
    } catch {
      svgRef.current.innerHTML = "";
      setErr(`Ce code n'est pas valide pour le format ${fmt}. Essaie un autre format.`);
    }
  }, [iz.code, fmt]);

  async function pickFmt(f: RtrBarcodeFormat) {
    setFmt(f);
    await setBarcodeFormat(iz.id, f);
  }
  async function copy() {
    const v = iz.num_iz ?? iz.code;
    try { await navigator.clipboard.writeText(v); }
    catch {
      const ta = document.createElement("textarea");
      ta.value = v; document.body.appendChild(ta); ta.select();
      document.execCommand("copy"); document.body.removeChild(ta);
    }
    flash("✓ N° IZ copié");
  }
  async function used() {
    const u = await markUsed(iz.id);
    flash(`✓ Marqué utilisé (${u?.use_count ?? ""}×)`);
  }

  const ident: [string, string][] = [
    ["Code travail", iz.code_travail || "—"],
    ["Validité", iz.validite_debut || iz.validite_fin ? `${fmtDate(iz.validite_debut)} → ${fmtDate(iz.validite_fin)}` : "—"],
    ["Activité", iz.activite || "—"],
    ["Interv.", iz.intervenant || "—"],
    ["Projet", iz.projet || "—"],
    ["Site", iz.site || "—"],
    ["Tranche / Local", `${iz.tranche || "—"} / ${iz.local || "—"}`],
    ["Objet", iz.objet || "—"],
    ["N° Act", iz.num_act || "—"],
  ];
  const prevues: [string, string][] = [
    ["DED max prévu", mSv(iz.ded_max, "mSv/h")],
    ["Dont neutron", mSv(iz.ded_neutron, "mSv/h")],
    ["Dose moy. intervenant", mSv(iz.dose_moy, "mSv")],
    ["Dose moy. / jour", mSv(iz.dose_jour, "mSv/j")],
    ["DED trajet", mSv(iz.ded_trajet, "mSv/h")],
  ];
  const perso: [string, string][] = [
    ["Libellé", iz.label || "—"],
    ["Tags", iz.tags?.length ? iz.tags.map((t) => `#${t}`).join(" ") : "—"],
    ["Notes", iz.notes || "—"],
    ["Utilisations", `${iz.use_count || 0}× · dernier ${fmtDate(iz.last_used)}`],
  ];
  const grid = (r: [string, string][]) => (
    <dl className="detail-grid">
      {r.map(([k, v]) => <Fragment key={k}><dt>{k}</dt><dd style={{ whiteSpace: "pre-wrap" }}>{v}</dd></Fragment>)}
    </dl>
  );

  if (full) return <ScanDisplay code={iz.code} fmt={fmt} title={izTitle(iz)} onClose={() => setFull(false)} />;
  return (
    <div className="pl-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="pl-sheet">
        <div className="pl-sheet-head">
          <span className="pl-sheet-title">Fiche IZ</span>
          <button className="pl-x" onClick={onClose} aria-label="Fermer">✕</button>
        </div>
        <div className="rtr-detail-code">N° IZ : {izTitle(iz)} <ValiditeTag iz={iz} /></div>
        <div className={`rtr-barcode ${err ? "err" : ""}`}>
          <svg ref={svgRef} />
          {err ? <p>❌ {err}</p> : <span className="rtr-barcode-txt">{iz.code}</span>}
        </div>
        <div className="rtr-fmt">
          <span className="filter-lbl">Format</span>
          <div className="chips">
            {RTR_BARCODE_FORMATS.map((b) => (
              <button key={b.id} className={`chip ${fmt === b.id ? "on" : ""}`} onClick={() => pickFmt(b.id)}>{b.label}</button>
            ))}
          </div>
        </div>
        <div className="btn-row" style={{ marginBottom: 6 }}>
          <button className="btn" onClick={copy}>📋 Copier le N° IZ</button>
          <button className="btn" onClick={used}>✓ Utilisé aujourd'hui</button>
        </div>
        <div className="section-sep">Fiche</div>
        {grid(ident)}
        <div className="section-sep">Valeurs prévues</div>
        {grid(prevues)}
        <div className="section-sep">Perso</div>
        {grid(perso)}
        <div className="btn-row" style={{ marginTop: 16 }}>
          <button className="btn btn-primary" onClick={onEdit}>✏ Modifier</button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
function RtrSettings({ cfg, onCfg, flash }: { cfg: RtrConfig; onCfg: (c: RtrConfig) => Promise<void>; flash: (m: string) => void }) {
  const [sites, setSites] = useState(cfg.sites.join("\n"));
  const [tags, setTags] = useState(cfg.tags.join("\n"));
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => { setSites(cfg.sites.join("\n")); setTags(cfg.tags.join("\n")); }, [cfg]);
  const lines = (s: string) => s.split("\n").map((x) => x.trim()).filter(Boolean);

  async function onImport(file: File) {
    try {
      const { izs, cfg: c } = parseImport(await file.text());
      if (c && confirm("Importer aussi la config (sites, tags) ?")) await onCfg({ ...cfg, ...c });
      if (!confirm(`Importer ${izs.length} IZ ? (les codes existants seront fusionnés)`)) return;
      const n = await importIzs(izs);
      flash(`✓ Import : ${n} IZ`);
    } catch (e) {
      flash("Erreur import : " + (e as Error).message);
    }
  }

  return (
    <>
      <div className="composer">
        <h3 className="section-title">Sites</h3>
        <p className="muted hint">Proposés dans la liste au moment de la saisie d'un IZ.</p>
        <label className="field">
          <span>Sites (un par ligne)</span>
          <textarea rows={5} value={sites} onChange={(e) => setSites(e.target.value)} />
        </label>
        <button className="btn btn-primary" onClick={async () => { await onCfg({ ...cfg, sites: lines(sites) }); flash("✓ Sites enregistrés"); }}>💾 Enregistrer</button>
      </div>
      <div className="composer">
        <h3 className="section-title">Tags suggérés</h3>
        <p className="muted hint">Proposés en auto-complétion.</p>
        <label className="field">
          <span>Tags (un par ligne)</span>
          <textarea rows={5} value={tags} onChange={(e) => setTags(e.target.value)} />
        </label>
        <button className="btn btn-primary" onClick={async () => { await onCfg({ ...cfg, tags: lines(tags) }); flash("✓ Tags enregistrés"); }}>💾 Enregistrer</button>
      </div>
      <div className="composer">
        <h3 className="section-title">Données</h3>
        <p className="muted hint">IZ synchronisés avec ton compte. L'import JSON accepte aussi les sauvegardes de PTV1.</p>
        <div className="toolbar">
          <button className="btn" onClick={async () => flash(`✓ Sauvegarde JSON (${await exportJson()} IZ)`)}>📦 Sauvegarde JSON</button>
          <button className="btn" onClick={async () => { const n = await exportCsv(); flash(n ? "✓ Export CSV" : "Aucun IZ à exporter"); }}>📊 Export CSV</button>
          <button className="btn" onClick={() => fileRef.current?.click()}>📥 Import JSON</button>
          <button className="btn btn-danger" onClick={async () => {
            if (!confirm("⚠ Effacer TOUS les IZ ?") || !confirm("Vraiment ? Action irréversible (aussi sur tes autres appareils).")) return;
            flash(`${await deleteAllIz()} IZ effacés`);
          }}>🗑 Tout effacer</button>
        </div>
        <input ref={fileRef} type="file" accept="application/json,.json" hidden
          onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) onImport(f); }} />
      </div>
    </>
  );
}

// Affichage plein écran pour un lecteur laser (trait rouge) : fond blanc pur, barres larges,
// grandes marges blanches, écran maintenu allumé. Largeur des barres et orientation réglables.
function ScanDisplay({ code, fmt, title, onClose }: { code: string; fmt: RtrBarcodeFormat; title: string; onClose: () => void }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [mod, setMod] = useMemoState("rtr:scan:mod", 3);
  const [rot, setRot] = useMemoState("rtr:scan:rot", false);
  useEffect(() => {
    let lock: { release: () => Promise<void> } | null = null;
    const nav = navigator as Navigator & { wakeLock?: { request: (t: "screen") => Promise<{ release: () => Promise<void> }> } };
    nav.wakeLock?.request("screen").then((l) => { lock = l; }).catch(() => {});
    document.documentElement.requestFullscreen?.().catch(() => {});
    return () => { lock?.release().catch(() => {}); if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); };
  }, []);
  useEffect(() => {
    if (!svgRef.current) return;
    try {
      JsBarcode(svgRef.current, code, { format: fmt, displayValue: false, width: mod, height: 160, margin: 14 * mod, background: "#ffffff", lineColor: "#000000" });
    } catch { /* format invalide : géré dans la fiche */ }
  }, [code, fmt, mod]);
  return (
    <div className="scan-show" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`scan-show-code ${rot ? "rot" : ""}`}><svg ref={svgRef} /><div className="scan-show-txt">{title}</div></div>
      <div className="scan-show-bar">
        <button onClick={() => setMod(Math.max(1, mod - 1))}>− barres</button>
        <span>{mod}</span>
        <button onClick={() => setMod(Math.min(8, mod + 1))}>+ barres</button>
        <button onClick={() => setRot(!rot)}>⟲ Tourner</button>
        <button onClick={onClose}>✕</button>
      </div>
      <p className="scan-show-tip">Luminosité au maximum · incline légèrement l'écran (10–20°) pour éviter le reflet · le trait rouge doit traverser toutes les barres.</p>
    </div>
  );
}
