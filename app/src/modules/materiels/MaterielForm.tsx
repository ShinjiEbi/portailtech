import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../../lib/db";
import { localSoftDelete, localUpsert, syncAll } from "../../lib/sync";
import { Chips } from "../../components/Chips";
import { allCorimTypes, corimByTypeCode, decompose, siteFromIdCourt } from "../../lib/materiels";
import { MATERIEL_ETATS, MATERIEL_ETAT_LABEL, type Materiel, type MaterielEtat } from "../../lib/types";

const ETAT_OPTS = MATERIEL_ETATS.map((e) => ({ value: e, label: MATERIEL_ETAT_LABEL[e] }));

function blank(): Materiel {
  return {
    scan: "", id_type: "gmo2", type_code: null, id_court: "", designation: null,
    code_model: null, sn: null, domaine: null, site: null, localisation: null,
    etat: "en_place", updated_at: new Date().toISOString(), deleted: false,
  };
}

export function MaterielForm() {
  const { scan } = useParams();
  const isNew = scan === "new";
  const nav = useNavigate();
  const types = useLiveQuery(() => allCorimTypes(), []) ?? [];
  const [form, setForm] = useState<Materiel | null>(isNew ? blank() : null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (isNew) return;
    db.materiels.get(scan!).then((r) => setForm(r ?? blank()));
  }, [scan, isNew]);

  if (!form) return <div className="splash">…</div>;
  const set = (p: Partial<Materiel>) => setForm({ ...form, ...p });

  // Saisie du SCAN (nouveau matériel) : décompose + auto-désignation si GMO².
  function onScan(v: string) {
    const d = decompose(v);
    const patch: Partial<Materiel> = {
      scan: v, id_type: d.id_type, type_code: d.type_code, id_court: d.id_court,
      site: siteFromIdCourt(d.id_court) ?? form!.site,
    };
    if (d.id_type === "gmo2") {
      const c = corimByTypeCode(types, d.type_code);
      if (c?.designation) patch.designation = c.designation;
    }
    set(patch);
  }

  async function save() {
    if (!form!.scan.trim() || busy) return;
    if (form!.id_type === "repere" && !(form!.designation ?? "").trim()) {
      alert("Pour un repère fonctionnel, le nom (désignation) est obligatoire.");
      return;
    }
    setBusy(true);
    await localUpsert(db.materiels, { ...form!, scan: form!.scan.trim() });
    syncAll().catch(console.error);
    nav("/materiels");
  }
  async function remove() {
    if (!confirm("Supprimer ce matériel ?") || busy) return;
    setBusy(true);
    await localSoftDelete(db.materiels, form!.scan);
    syncAll().catch(console.error);
    nav("/materiels");
  }

  const corim = form.id_type === "gmo2" ? corimByTypeCode(types, form.type_code) : null;

  return (
    <div>
      <Link to="/materiels" className="back">← Matériels</Link>
      <div className="page-head"><h2>{isNew ? "Nouveau matériel" : form.designation || form.scan}</h2></div>

      <label className="field">
        <span>Code SCAN (GMO² ou repère fonctionnel)</span>
        <input value={form.scan} onChange={(e) => onScan(e.target.value)} disabled={!isNew} placeholder="SRCON…-BUG070  ou  8KZC012AR" />
      </label>
      <p className="muted hint">
        {form.id_type === "gmo2"
          ? `GMO² · type ${form.type_code ?? "?"} · id ${form.id_court || "?"}${corim?.type_appareil ? ` · ${corim.type_appareil}` : ""}`
          : `Repère fonctionnel · id ${form.id_court || "?"} · nom à saisir manuellement`}
      </p>

      <label className="field">
        <span>Désignation {form.id_type === "gmo2" && <small className="pl-imp-from">(auto Corim, modifiable)</small>}</span>
        <input value={form.designation ?? ""} onChange={(e) => set({ designation: e.target.value })} />
      </label>

      <div className="grid2">
        <label className="field"><span>Code Model</span><input value={form.code_model ?? ""} onChange={(e) => set({ code_model: e.target.value })} /></label>
        <label className="field"><span>N° de série</span><input value={form.sn ?? ""} onChange={(e) => set({ sn: e.target.value })} /></label>
      </div>
      <div className="grid2">
        <label className="field"><span>Domaine</span><input value={form.domaine ?? ""} onChange={(e) => set({ domaine: e.target.value })} placeholder="RPM / KZC / KRS" /></label>
        <label className="field"><span>Site</span><input value={form.site ?? ""} onChange={(e) => set({ site: e.target.value })} /></label>
      </div>
      <label className="field"><span>Localisation (dans le site)</span><input value={form.localisation ?? ""} onChange={(e) => set({ localisation: e.target.value })} /></label>

      <label className="field"><span>État</span><Chips options={ETAT_OPTS} value={form.etat} onChange={(v) => set({ etat: (v ?? "en_place") as MaterielEtat })} /></label>

      <div className="btn-row">
        <button className="btn btn-primary" onClick={save} disabled={busy}>Enregistrer</button>
        {!isNew && <button className="btn btn-danger" onClick={remove} disabled={busy}>Supprimer</button>}
      </div>
    </div>
  );
}
