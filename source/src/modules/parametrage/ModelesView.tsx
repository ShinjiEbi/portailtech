import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { db, metaGet } from "../../lib/db";
import { resyncCalculs, currentUserId } from "../../lib/sync";
import { PlanningParamsSection } from "./PlanningParamsSection";
import { ImputationsSection } from "./ImputationsSection";
import { JournalLog } from "../journal/JournalView";

export function ModelesView() {
  const modeles = useLiveQuery(() => db.modeles.toArray(), []);
  const list = (modeles ?? []).filter((m) => !m.deleted).sort((a, b) => a.ordre - b.ordre);
  const [syncing, setSyncing] = useState(false);
  const calcCount = useLiveQuery(() => db.calculs.filter((c) => !c.deleted).count(), []);
  const calcDirty = useLiveQuery(() => db.calculs.where("_dirty").equals(1).count(), []);
  const lastSync = useLiveQuery(() => metaGet("last_calc_sync"), []);
  const [sess, setSess] = useState("…");
  useEffect(() => {
    let alive = true;
    currentUserId().then((u) => { if (alive) setSess(u ? "connecté" : "NON connecté"); });
    return () => { alive = false; };
  }, []);

  return (
    <div>
      <div className="page-head">
        <h2>Paramètres</h2>
      </div>

      <PlanningParamsSection />
      <ImputationsSection />

      <div className="section-head">
        <h3 className="section-title">Modèles ECME</h3>
        <Link to="/parametrage/new" className="add">+ Modèle</Link>
      </div>
      <p className="muted hint">
        Un modèle définit les champs proposés pour un type d'étalon. Partagés par toute l'équipe.
      </p>

      {list.length === 0 && <div className="empty">Aucun modèle.</div>}

      {list.map((m) => (
        <Link key={m.id} to={`/parametrage/${m.id}`} className="card">
          <div className="card-top">
            <span className="card-title">{m.nom}</span>
            <span className="card-num">
              {m.champs.length} champ{m.champs.length > 1 ? "s" : ""}
            </span>
          </div>
          {m.champs.length > 0 && (
            <div className="card-sub">{m.champs.map((c) => c.libelle).filter(Boolean).join(" · ")}</div>
          )}
        </Link>
      ))}

      <section className="card param-section">
        <h3 className="section-title">Synchronisation des calculs</h3>
        <div className="muted" style={{ fontSize: 13, lineHeight: 1.8, marginBottom: 10 }}>
          <div>Connexion : {navigator.onLine ? "en ligne" : "hors ligne"} · session : {sess}</div>
          <div>Calculs en local : {calcCount ?? "…"} — en attente d'envoi : {calcDirty ?? "…"}</div>
          <div>Dernière synchro : {lastSync ?? "jamais"}</div>
        </div>
        <p className="muted hint">« Resynchroniser » force l'envoi + la récupération et met à jour ces infos. En cas d'échec, l'erreur exacte de Supabase apparaît sur la ligne « Dernière synchro ».</p>
        <button
          type="button"
          className="btn"
          disabled={syncing}
          onClick={async () => {
            setSyncing(true);
            try { alert(await resyncCalculs()); } finally { setSyncing(false); }
          }}
        >
          {syncing ? "Synchronisation…" : "Resynchroniser les calculs"}
        </button>
      </section>

      <JournalLog />
    </div>
  );
}
