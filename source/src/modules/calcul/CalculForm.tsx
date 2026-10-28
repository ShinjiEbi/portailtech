import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../../lib/db";
import { Chips } from "../../components/Chips";
import {
  deleteCalcul, distinctCategories, getCalcul, matchingSources, saveCalcul, sourceFieldOptions,
} from "../../lib/calculs";
import { checkExpr } from "../../lib/formula";
import { UNIT_FAMILIES, baseUnitLabel, familyByKey } from "../../lib/units";
import type { Calcul, Composante, ComposanteType, ComposanteValeur, Formule, SourceFiltres, SourceValeur, TolBound } from "../../lib/types";

type FieldOpt = { key: string; label: string };
const EMPTY_F: SourceFiltres = { radionucleides: [], types: [], rayonnements: [] };

const SCOPE_OPTS = [{ value: "perso", label: "Perso" }, { value: "partage", label: "Partagé" }];
const CTYPE_OPTS = [{ value: "variable", label: "Variable" }, { value: "constante", label: "Constante" }, { value: "mesure", label: "Mesure" }, { value: "serie", label: "Série" }, { value: "source", label: "Source" }];
const VTYPE_OPTS = [{ value: "nombre", label: "Nombre" }, { value: "date", label: "Date" }];
const TOLBASE_OPTS = [{ value: "constante", label: "Constante" }, { value: "variable", label: "Variable" }, { value: "source", label: "Source" }];

function blank(): Calcul {
  return {
    id: crypto.randomUUID(), nom: "", scope: "perso", user_id: null, type_source: null,
    composantes: [], formules: [], updated_at: new Date().toISOString(), deleted: false,
  };
}
function normalize(c: Calcul): Calcul {
  const composantes = (c.composantes ?? []).map((comp) =>
    comp.type === "source" && !(comp.source_valeurs?.length) && comp.source_champ
      ? { ...comp, source_valeurs: [{ nom: comp.nom, source_champ: comp.source_champ, unite: comp.unite }] }
      : comp
  );
  return { ...c, composantes, formules: c.formules ?? [] };
}
// symboles d'une composante (utilisables dans les expressions)
function compSymbols(c: Composante): string[] {
  if (c.type === "source") {
    if (c.source_valeurs && c.source_valeurs.length) return c.source_valeurs.map((v) => v.nom);
    return c.source_champ ? [c.nom] : [];
  }
  if (c.type === "serie") return c.nom ? [c.nom, `${c.nom}_max`, `${c.nom}_min`, `${c.nom}_n`, `${c.nom}_et`] : [];
  return [c.nom];
}

function MultiChips({ options, values, onChange }: { options: string[]; values: string[]; onChange: (v: string[]) => void }) {
  return (
    <div className="chips">
      {options.map((o) => {
        const on = values.includes(o);
        return <button type="button" key={o} className={`chip ${on ? "on" : ""}`} onClick={() => onChange(on ? values.filter((x) => x !== o) : [...values, o])}>{o}</button>;
      })}
      {options.length === 0 && <span className="muted hint">aucune valeur</span>}
    </div>
  );
}

function BoundEditor({ label, bound, variables, sourceSymbols, onChange }: {
  label: string; bound: TolBound | null; variables: string[]; sourceSymbols: string[];
  onChange: (b: TolBound | null) => void;
}) {
  const on = !!bound;
  const b: TolBound = bound ?? { base: "constante", pourcentage: null };
  return (
    <>
      <label className="field-check">
        <input type="checkbox" checked={on} onChange={(e) => onChange(e.target.checked ? { base: "constante", pourcentage: null } : null)} />
        <span>Borne {label}</span>
      </label>
      {on && (
        <div className="tol-box">
          <label className="field"><span>Seuil = % de…</span>
            <Chips options={TOLBASE_OPTS} value={b.base} onChange={(v) => onChange({ ...b, base: (v ?? "constante") as TolBound["base"] })} />
          </label>
          {b.base === "constante" && (
            <label className="field"><span>Valeur (constante)</span>
              <input type="number" inputMode="decimal" value={b.valeur ?? ""} onChange={(e) => onChange({ ...b, valeur: e.target.value === "" ? null : Number(e.target.value) })} />
            </label>
          )}
          {b.base === "variable" && (
            <label className="field"><span>Variable</span>
              <select value={b.variable ?? ""} onChange={(e) => onChange({ ...b, variable: e.target.value || null })}>
                <option value="">— choisir —</option>
                {variables.map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
            </label>
          )}
          {b.base === "source" && (
            <label className="field"><span>Valeur source</span>
              <select value={b.source ?? ""} onChange={(e) => onChange({ ...b, source: e.target.value || null })}>
                <option value="">— choisir —</option>
                {sourceSymbols.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
          )}
          <label className="field"><span>Pourcentage <small className="muted">(%)</small></span>
            <input type="number" inputMode="decimal" value={b.pourcentage ?? ""} onChange={(e) => onChange({ ...b, pourcentage: e.target.value === "" ? null : Number(e.target.value) })} placeholder="100" />
          </label>
        </div>
      )}
    </>
  );
}

function FormuleEditor({ formule, symbols, variables, sourceSymbols, onChange, onDelete }: {
  formule: Formule; symbols: string[]; variables: string[]; sourceSymbols: string[];
  onChange: (p: Partial<Formule>) => void; onDelete: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const err = formule.expression.trim() ? checkExpr(formule.expression) : null;
  const OPS = ["(", ")", ",", "+", "-", "*", "/", "^", "%"];
  const FNS: { fn: string; label: string }[] = [
    { fn: "abs", label: "|x|" },
    { fn: "ecart", label: "écart |a−b|" },
    { fn: "ecartrel", label: "écart %" },
    { fn: "moy", label: "moy" },
    { fn: "somme", label: "somme" },
    { fn: "arrondi", label: "arrondi" },
    { fn: "min", label: "min" },
    { fn: "max", label: "max" },
    { fn: "racine", label: "√ⁿ" },
    { fn: "exp", label: "exp" },
    { fn: "ln", label: "ln" },
    { fn: "sqrt", label: "√" },
  ];

  function insert(tok: string) {
    const el = ref.current;
    const v = formule.expression;
    const s = el?.selectionStart ?? v.length;
    const e = el?.selectionEnd ?? v.length;
    onChange({ expression: v.slice(0, s) + tok + v.slice(e) });
    requestAnimationFrame(() => { el?.focus(); const p = s + tok.length; el?.setSelectionRange(p, p); });
  }
  function insertFn(fn: string) {
    const el = ref.current;
    const v = formule.expression;
    const s = el?.selectionStart ?? v.length;
    const e = el?.selectionEnd ?? v.length;
    const inner = v.slice(s, e); // si du texte est sélectionné, on l'enveloppe : fn(sélection)
    const ins = `${fn}(${inner})`;
    onChange({ expression: v.slice(0, s) + ins + v.slice(e) });
    requestAnimationFrame(() => {
      el?.focus();
      const p = inner ? s + ins.length : s + fn.length + 1; // après ) si enveloppe, sinon entre ( )
      el?.setSelectionRange(p, p);
    });
  }
  function backspace() {
    const el = ref.current;
    const v = formule.expression;
    const s = el?.selectionStart ?? v.length;
    const e = el?.selectionEnd ?? v.length;
    if (s !== e) { onChange({ expression: v.slice(0, s) + v.slice(e) }); requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(s, s); }); }
    else if (s > 0) { onChange({ expression: v.slice(0, s - 1) + v.slice(s) }); requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(s - 1, s - 1); }); }
  }

  return (
    <div className="card">
      <div className="grid2">
        <label className="field"><span>Nom (résultat)</span>
          <input value={formule.nom} onChange={(e) => onChange({ nom: e.target.value.replace(/\s+/g, "_") })} placeholder="rendement" />
        </label>
        <label className="field"><span>Unité</span>
          <input value={formule.unite ?? ""} onChange={(e) => onChange({ unite: e.target.value })} placeholder="%, c/s/Bq…" />
        </label>
      </div>
      <label className="field"><span>Expression</span>
        <input ref={ref} value={formule.expression} onChange={(e) => onChange({ expression: e.target.value })} placeholder="Appuie sur les boutons ci-dessous" />
      </label>
      {symbols.length > 0 && (
        <div className="calc-keys">
          {symbols.map((s) => <button type="button" key={s} className="key key-sym" onClick={() => insert(s)}>{s}</button>)}
        </div>
      )}
      <div className="calc-keys">
        {OPS.map((o) => <button type="button" key={o} className="key" onClick={() => insert(o)}>{o === "*" ? "×" : o === "/" ? "÷" : o}</button>)}
        {FNS.map((f) => <button type="button" key={f.fn} className="key" onClick={() => insertFn(f.fn)}>{f.label}</button>)}
        <button type="button" className="key key-del" onClick={backspace}>⌫</button>
      </div>
      <p className="muted hint" style={{ marginTop: 4 }}>
        écart(a,b)=|a−b| · « écart % » insère ecartrel(a,b)=|a−b|/|b|×100 · moy(…)/somme(…) · arrondi(x[,n]) · racine(x[,n]) · sépare les arguments avec «,»
      </p>
      {err && <p className="calc-res-err">{err}</p>}

      <div className="card-title" style={{ marginTop: 8, marginBottom: 4 }}>Tolérance</div>
      <BoundEditor label="min (≥)" bound={formule.tol_min ?? null} variables={variables} sourceSymbols={sourceSymbols} onChange={(b) => onChange({ tol_min: b })} />
      <BoundEditor label="max (≤)" bound={formule.tol_max ?? null} variables={variables} sourceSymbols={sourceSymbols} onChange={(b) => onChange({ tol_max: b })} />

      <button type="button" className="btn btn-danger" onClick={onDelete}>Supprimer la formule</button>
    </div>
  );
}

export function CalculForm() {
  const { id } = useParams();
  const isNew = id === "new" || !id;
  const nav = useNavigate();
  const etalons = useLiveQuery(() => db.etalons.toArray(), []) ?? [];
  const modeles = useLiveQuery(() => db.modeles.toArray(), []) ?? [];
  const [form, setForm] = useState<Calcul | null>(isNew ? blank() : null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (!isNew && id) getCalcul(id).then((c) => setForm(c ? normalize(c) : blank())); }, [id, isNew]);

  const upd = (p: Partial<Calcul>) => setForm((f) => (f ? { ...f, ...p } : f));
  const cats = useMemo(() => distinctCategories(etalons, modeles), [etalons, modeles]);
  const modById = useMemo(() => new Map(modeles.map((m) => [m.id, m])), [modeles]);

  if (!form) return <div className="splash">…</div>;

  const updComp = (cid: string, p: Partial<Composante>) => upd({ composantes: form.composantes.map((c) => (c.id === cid ? { ...c, ...p } : c)) });
  const delComp = (cid: string) => upd({ composantes: form.composantes.filter((c) => c.id !== cid) });
  const addComp = () => upd({ composantes: [...form.composantes, { id: crypto.randomUUID(), nom: "", type: "variable", valeur_type: "nombre" }] });

  const updFor = (fid: string, p: Partial<Formule>) => upd({ formules: form.formules.map((f) => (f.id === fid ? { ...f, ...p } : f)) });
  const delFor = (fid: string) => upd({ formules: form.formules.filter((f) => f.id !== fid) });
  const addFor = () => upd({ formules: [...form.formules, { id: crypto.randomUUID(), nom: "", expression: "", unite: "" }] });

  const variableNoms = form.composantes.filter((c) => c.type === "variable" || c.type === "serie" || c.type === "mesure").flatMap(compSymbols).filter(Boolean);
  const sourceSymbols = form.composantes.filter((c) => c.type === "source").flatMap(compSymbols).filter(Boolean);
  const allSymbols = form.composantes.flatMap(compSymbols).filter(Boolean);

  function sourceOptsFor(cf: SourceFiltres): { matched: number; opts: FieldOpt[] } {
    const m = matchingSources(cf, etalons, modeles);
    const seen = new Map<string, string>();
    for (const e of m) {
      const md = e.modele_id ? modById.get(e.modele_id) : undefined;
      for (const o of sourceFieldOptions(md)) if (!seen.has(o.key)) seen.set(o.key, o.label);
    }
    return { matched: m.length, opts: [...seen].map(([key, label]) => ({ key, label })) };
  }

  async function save() {
    if (busy) return;
    if (!form!.nom.trim()) { alert("Donne un nom au calcul."); return; }
    setBusy(true);
    await saveCalcul({ ...form!, nom: form!.nom.trim() });
    nav("/calcul");
  }
  async function remove() {
    if (isNew || busy || !confirm("Supprimer ce calcul ?")) return;
    setBusy(true);
    await deleteCalcul(form!.id);
    nav("/calcul");
  }

  return (
    <div>
      <Link to="/calcul" className="back">← Calcul</Link>
      <div className="page-head"><h2>{isNew ? "Nouveau calcul" : form.nom || "Calcul"}</h2></div>

      <label className="field"><span>Nom</span>
        <input value={form.nom} onChange={(e) => upd({ nom: e.target.value })} placeholder="Ex. Rendement contaminamètre" />
      </label>
      <label className="field"><span>Portée</span>
        <Chips options={SCOPE_OPTS} value={form.scope} onChange={(v) => upd({ scope: (v ?? "perso") as Calcul["scope"] })} />
      </label>
      <label className="field"><span>Type de source <small className="muted">(libellé, optionnel)</small></span>
        <input value={form.type_source ?? ""} onChange={(e) => upd({ type_source: e.target.value || null })} placeholder="Ex. Frottis bêta" />
      </label>

      <div className="page-head" style={{ marginTop: 14 }}>
        <h3>Composantes</h3>
        <button type="button" className="add" onClick={addComp}>+ Composante</button>
      </div>
      {form.composantes.map((c) => {
        const cf = c.source_filtres ?? EMPTY_F;
        const setCf = (p: Partial<SourceFiltres>) => updComp(c.id, { source_filtres: { ...cf, ...p } });
        const so = c.type === "source" ? sourceOptsFor(cf) : null;
        const vals: SourceValeur[] = c.source_valeurs ?? [];
        const setVals = (nv: SourceValeur[]) => updComp(c.id, { source_valeurs: nv });
        return (
          <div className="card" key={c.id}>
            <label className="field"><span>Type</span>
              <Chips options={CTYPE_OPTS} value={c.type} onChange={(v) => {
                const t = (v ?? "variable") as ComposanteType;
                const patch: Partial<Composante> = { type: t };
                if (t === "source" && !(c.source_valeurs?.length)) patch.source_valeurs = [{ nom: "", source_champ: null }];
                updComp(c.id, patch);
              }} />
            </label>

            {(c.type === "variable" || c.type === "constante") && (
              <>
                <div className="grid2">
                  <label className="field"><span>Symbole</span>
                    <input value={c.nom} onChange={(e) => updComp(c.id, { nom: e.target.value.replace(/\s+/g, "_") })} placeholder="Ex. Nbrut" />
                  </label>
                  <label className="field"><span>Unité</span>
                    <input value={c.unite ?? ""} onChange={(e) => updComp(c.id, { unite: e.target.value })} placeholder="c/s, Bq…" />
                  </label>
                </div>
                <label className="field"><span>Format</span>
                  <Chips options={VTYPE_OPTS} value={c.valeur_type ?? "nombre"} onChange={(v) => updComp(c.id, { valeur_type: (v ?? "nombre") as ComposanteValeur })} />
                </label>
                {c.type === "constante" && (
                  <label className="field"><span>Valeur</span>
                    {c.valeur_type === "date"
                      ? <input type="date" value={c.valeur_date ?? ""} onChange={(e) => updComp(c.id, { valeur_date: e.target.value })} />
                      : <input type="number" inputMode="decimal" value={c.valeur ?? ""} onChange={(e) => updComp(c.id, { valeur: e.target.value === "" ? null : Number(e.target.value) })} />}
                  </label>
                )}
                <label className="field"><span>Libellé <small className="muted">(optionnel)</small></span>
                  <input value={c.libelle ?? ""} onChange={(e) => updComp(c.id, { libelle: e.target.value })} />
                </label>
              </>
            )}

            {c.type === "serie" && (
              <>
                <div className="grid2">
                  <label className="field"><span>Symbole (moyenne)</span>
                    <input value={c.nom} onChange={(e) => updComp(c.id, { nom: e.target.value.replace(/\s+/g, "_") })} placeholder="Ex. bdf" />
                  </label>
                  <label className="field"><span>Unité</span>
                    <input value={c.unite ?? ""} onChange={(e) => updComp(c.id, { unite: e.target.value })} placeholder="c/s…" />
                  </label>
                </div>
                <p className="muted hint">Saisie de N mesures à l'exécution. Symboles produits : <b>{c.nom || "x"}</b> (moyenne), {c.nom || "x"}_max, {c.nom || "x"}_min, {c.nom || "x"}_n, {c.nom || "x"}_et (écart‑type).</p>
                <label className="field"><span>Libellé <small className="muted">(optionnel)</small></span>
                  <input value={c.libelle ?? ""} onChange={(e) => updComp(c.id, { libelle: e.target.value })} />
                </label>
              </>
            )}

            {c.type === "mesure" && (
              <>
                <label className="field"><span>Symbole</span>
                  <input value={c.nom} onChange={(e) => updComp(c.id, { nom: e.target.value.replace(/\s+/g, "_") })} placeholder="Ex. A_ref" />
                </label>
                <label className="field"><span>Grandeur</span>
                  <Chips options={UNIT_FAMILIES.map((f) => ({ value: f.key, label: f.label }))} value={c.unite_famille ?? null} onChange={(v) => updComp(c.id, { unite_famille: v })} allLabel="—" />
                </label>
                <p className="muted hint">Saisie au calcul avec choix d'unité ; valeur convertie en <b>{baseUnitLabel(familyByKey(c.unite_famille)) || "(choisis une grandeur)"}</b>.</p>
                <label className="field"><span>Libellé <small className="muted">(optionnel)</small></span>
                  <input value={c.libelle ?? ""} onChange={(e) => updComp(c.id, { libelle: e.target.value })} />
                </label>
              </>
            )}

            {c.type === "source" && (
              <>
                <label className="field"><span>Nom de la source <small className="muted">(étiquette)</small></span>
                  <input value={c.nom} onChange={(e) => updComp(c.id, { nom: e.target.value })} placeholder="Ex. Source Cs-137" />
                </label>
                <div className="tol-box">
                  <p className="muted hint" style={{ marginTop: 0 }}>Filtre de la source</p>
                  <label className="field"><span>Radionucléide</span><MultiChips options={cats.radionucleides} values={cf.radionucleides} onChange={(v) => setCf({ radionucleides: v })} /></label>
                  <label className="field"><span>Type EDF</span><MultiChips options={cats.types} values={cf.types} onChange={(v) => setCf({ types: v })} /></label>
                  <label className="field"><span>Rayonnement</span><MultiChips options={cats.rayonnements} values={cf.rayonnements} onChange={(v) => setCf({ rayonnements: v })} /></label>
                  <p className="muted hint">{so?.matched ?? 0} source(s) correspondante(s){(cf.radionucleides.length || cf.types.length || cf.rayonnements.length) ? "" : " — choisis au moins une catégorie"}.</p>
                </div>
                <p className="muted hint">Valeurs lues sur la source</p>
                {vals.map((v, idx) => (
                  <div className="tol-box" key={idx}>
                    <div className="grid2">
                      <label className="field"><span>Symbole</span>
                        <input value={v.nom} onChange={(e) => setVals(vals.map((x, i) => i === idx ? { ...x, nom: e.target.value.replace(/\s+/g, "_") } : x))} placeholder="Ex. Aj" />
                      </label>
                      <label className="field"><span>Unité</span>
                        <input value={v.unite ?? ""} onChange={(e) => setVals(vals.map((x, i) => i === idx ? { ...x, unite: e.target.value } : x))} placeholder="Bq, mm…" />
                      </label>
                    </div>
                    <label className="field"><span>Champ</span>
                      <select value={v.source_champ ?? ""} onChange={(e) => setVals(vals.map((x, i) => i === idx ? { ...x, source_champ: e.target.value || null } : x))}>
                        <option value="">— choisir —</option>
                        {so?.opts.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
                      </select>
                    </label>
                    {vals.length > 1 && <button type="button" className="btn btn-danger" onClick={() => setVals(vals.filter((_, i) => i !== idx))}>Retirer cette valeur</button>}
                  </div>
                ))}
                <button type="button" className="add" onClick={() => setVals([...vals, { nom: "", source_champ: null }])}>+ Valeur</button>
              </>
            )}

            <button type="button" className="btn btn-danger" onClick={() => delComp(c.id)}>Supprimer la composante</button>
          </div>
        );
      })}

      <div className="page-head" style={{ marginTop: 14 }}>
        <h3>Formules</h3>
        <button type="button" className="add" onClick={addFor}>+ Formule</button>
      </div>
      {form.formules.map((f, i) => (
        <FormuleEditor
          key={f.id}
          formule={f}
          symbols={[...allSymbols, ...form.formules.slice(0, i).map((x) => x.nom)].filter(Boolean)}
          variables={variableNoms}
          sourceSymbols={sourceSymbols}
          onChange={(p) => updFor(f.id, p)}
          onDelete={() => delFor(f.id)}
        />
      ))}

      <div className="btn-row" style={{ marginTop: 14 }}>
        <button className="btn btn-primary" onClick={save} disabled={busy}>Enregistrer</button>
        {!isNew && <button className="btn btn-danger" onClick={remove} disabled={busy}>Supprimer</button>}
      </div>
    </div>
  );
}
