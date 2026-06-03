import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../../lib/db";
import { localUpsert, localSoftDelete, syncAll } from "../../lib/sync";
import { useAuth } from "../../auth/AuthProvider";
import { Chips } from "../../components/Chips";
import { SITES, type Imputation } from "../../lib/types";

const SITE_OPTS = SITES.map((s) => ({ value: s.code, label: s.code }));
const todayISO = () => new Date().toISOString().slice(0, 10);

export function ImputationsView() {
  const { session } = useAuth();
  const uid = session!.user.id;

  const all = useLiveQuery(() => db.imputations.toArray(), []);
  const list = (all ?? []).filter((i) => !i.deleted).sort((a, b) => (a.date < b.date ? 1 : -1));
  const total = list.reduce((s, i) => s + (i.heures ?? 0), 0);

  const [date, setDate] = useState(todayISO());
  const [site, setSite] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [heures, setHeures] = useState("");
  const [activite, setActivite] = useState("");
  const [commentaire, setCommentaire] = useState("");
  const [busy, setBusy] = useState(false);

  async function add() {
    if (!date) return;
    setBusy(true);
    const row: Imputation = {
      id: crypto.randomUUID(),
      user_id: uid,
      date,
      site,
      code_affaire: code || null,
      heures: heures === "" ? null : Number(heures),
      activite: activite || null,
      commentaire: commentaire || null,
      updated_at: new Date().toISOString(),
      deleted: false,
    };
    await localUpsert(db.imputations, row);
    syncAll().catch(console.error);
    setCode("");
    setHeures("");
    setActivite("");
    setCommentaire("");
    setBusy(false);
  }

  async function del(id: string) {
    await localSoftDelete(db.imputations, id);
    syncAll().catch(console.error);
  }

  return (
    <div>
      <div className="page-head">
        <h2>Imputations</h2>
        <span className="total">{total.toFixed(2)} h</span>
      </div>

      <div className="composer">
        <div className="grid2">
          <label className="field">
            <span>Date</span>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <label className="field">
            <span>Heures</span>
            <input type="number" step="0.25" value={heures} onChange={(e) => setHeures(e.target.value)} />
          </label>
        </div>
        <label className="field">
          <span>Site</span>
          <Chips options={SITE_OPTS} value={site} onChange={setSite} />
        </label>
        <div className="grid2">
          <label className="field">
            <span>Code affaire</span>
            <input value={code} onChange={(e) => setCode(e.target.value)} />
          </label>
          <label className="field">
            <span>Activité</span>
            <input value={activite} onChange={(e) => setActivite(e.target.value)} />
          </label>
        </div>
        <label className="field">
          <span>Commentaire</span>
          <textarea value={commentaire} onChange={(e) => setCommentaire(e.target.value)} />
        </label>
        <button className="btn btn-primary" onClick={add} disabled={busy}>
          Ajouter
        </button>
      </div>

      {list.length === 0 && <div className="empty">Aucune imputation.</div>}
      {list.map((i) => (
        <div key={i.id} className="card">
          <div className="card-top">
            <span className="card-title mono">
              {i.date}
              {i.site ? " · " + i.site : ""}
            </span>
            <span className="mono">{(i.heures ?? 0).toFixed(2)} h</span>
          </div>
          {(i.code_affaire || i.activite) && (
            <div className="card-sub">{[i.code_affaire, i.activite].filter(Boolean).join(" · ")}</div>
          )}
          {i.commentaire && <div className="card-sub">{i.commentaire}</div>}
          <button className="feed-del" onClick={() => del(i.id)}>
            supprimer
          </button>
        </div>
      ))}
    </div>
  );
}
