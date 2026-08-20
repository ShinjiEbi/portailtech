import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { db } from "../../lib/db";
import { localUpsert, localSoftDelete, syncAll, logJournal } from "../../lib/sync";
import { Chips } from "../../components/Chips";
import { CHAMP_TYPES, type ChampDef, type ChampType, type EtalonModele } from "../../lib/types";

function blank(): EtalonModele {
  return { id: crypto.randomUUID(), nom: "", ordre: 50, champs: [], updated_at: new Date().toISOString(), deleted: false };
}
const newKey = () => "c_" + Math.random().toString(36).slice(2, 8);

export function ModeleForm() {
  const { id } = useParams();
  const isNew = id === "new";
  const nav = useNavigate();
  const [m, setM] = useState<EtalonModele | null>(isNew ? blank() : null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (isNew) return;
    db.modeles.get(id!).then((r) => setM(r ? { ...r, champs: r.champs || [] } : blank()));
  }, [id, isNew]);

  if (!m) return <div className="splash">…</div>;

  const setChamp = (i: number, p: Partial<ChampDef>) => {
    const a = m.champs.slice();
    a[i] = { ...a[i], ...p };
    setM({ ...m, champs: a });
  };
  const addChamp = () => setM({ ...m, champs: [...m.champs, { cle: newKey(), libelle: "", type: "texte" }] });
  const delChamp = (i: number) => setM({ ...m, champs: m.champs.filter((_, j) => j !== i) });

  async function save() {
    if (!m!.nom.trim() || busy) return;
    setBusy(true);
    await localUpsert(db.modeles, m!);
    await logJournal(isNew ? "ajout" : "modification", `${isNew ? "Ajout" : "Modification"} modèle « ${m!.nom} »`);
    syncAll().catch(console.error);
    nav("/parametrage");
  }
  async function remove() {
    if (!confirm("Supprimer ce modèle ? (les étalons existants ne sont pas supprimés)") || busy) return;
    setBusy(true);
    await localSoftDelete(db.modeles, m!.id);
    await logJournal("suppression", `Suppression modèle « ${m!.nom} »`);
    syncAll().catch(console.error);
    nav("/parametrage");
  }

  return (
    <div>
      <Link to="/parametrage" className="back">
        ← Modèles
      </Link>
      <div className="page-head">
        <h2>{isNew ? "Nouveau modèle" : m.nom || "Modèle"}</h2>
      </div>

      <div className="grid2">
        <label className="field">
          <span>Nom du modèle</span>
          <input value={m.nom} onChange={(e) => setM({ ...m, nom: e.target.value })} />
        </label>
        <label className="field">
          <span>Ordre d'affichage</span>
          <input type="number" value={m.ordre} onChange={(e) => setM({ ...m, ordre: Number(e.target.value) || 0 })} />
        </label>
      </div>

      <div className="section-sep">
        Champs
        <button type="button" className="add-mini" onClick={addChamp}>
          + champ
        </button>
      </div>

      {m.champs.length === 0 && <div className="muted hint">Aucun champ (modèle « manuel » possible aussi).</div>}

      {m.champs.map((c, i) => (
        <div className="champ-edit" key={c.cle}>
          <div className="champ-edit-top">
            <input
              className="champ-lib"
              placeholder="Libellé du champ"
              value={c.libelle}
              onChange={(e) => setChamp(i, { libelle: e.target.value })}
            />
            <button type="button" className="del-mini" onClick={() => delChamp(i)}>
              ×
            </button>
          </div>
          <Chips
            options={CHAMP_TYPES}
            value={c.type}
            onChange={(v) => setChamp(i, { type: (v ?? "texte") as ChampType })}
          />
          {c.type === "liste" && (
            <input
              className="champ-opts"
              placeholder="Choix séparés par des virgules"
              value={(c.options ?? []).join(", ")}
              onChange={(e) =>
                setChamp(i, { options: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })
              }
            />
          )}
          <label className="check">
            <input type="checkbox" checked={!!c.requis} onChange={(e) => setChamp(i, { requis: e.target.checked })} />{" "}
            obligatoire
          </label>
        </div>
      ))}

      <div className="btn-row">
        <button className="btn btn-primary" onClick={save} disabled={busy}>
          Enregistrer
        </button>
        {!isNew && (
          <button className="btn btn-danger" onClick={remove} disabled={busy}>
            Supprimer
          </button>
        )}
      </div>
    </div>
  );
}
