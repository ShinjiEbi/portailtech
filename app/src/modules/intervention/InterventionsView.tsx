import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../../lib/db";
import { allListings, deleteListing, duplicateListing } from "../../lib/interventions";

export function InterventionsView() {
  const nav = useNavigate();
  const listings = useLiveQuery(() => allListings(), []) ?? [];
  const lignes = useLiveQuery(() => db.intervention_lignes.toArray(), []) ?? [];
  const [busy, setBusy] = useState(false);

  const countFor = (id: string) => lignes.filter((l) => l.listing_id === id && !l.deleted).length;

  async function onDuplicate(id: string) {
    if (busy) return;
    setBusy(true);
    try {
      const newId = await duplicateListing(id);
      if (newId) nav(`/interventions/${newId}`);
    } finally { setBusy(false); }
  }
  async function onDelete(id: string, nom: string) {
    if (busy || !confirm(`Supprimer le listing « ${nom || "(sans nom)"} » et ses lignes ?`)) return;
    setBusy(true);
    try { await deleteListing(id); } finally { setBusy(false); }
  }

  return (
    <div>
      <div className="page-head">
        <h2>Interventions</h2>
        <Link to="/interventions/new" className="add">+ Nouveau</Link>
      </div>

      {listings.length === 0 && <div className="empty">Aucun listing — crée ta première campagne de contrôles.</div>}

      {listings.map((l) => (
        <div className="card" key={l.id}>
          <Link to={`/interventions/${l.id}`} className="iv-card-link">
            <div className="card-top">
              <span className="card-title">{l.nom || "(sans nom)"}</span>
              <span className={`tag ${l.scope === "partage" ? "ok" : ""}`}>{l.scope === "partage" ? "Partagé" : "Perso"}</span>
            </div>
            <div className="card-sub">{countFor(l.id)} ligne(s)</div>
          </Link>
          <div className="iv-card-actions">
            <Link to={`/interventions/${l.id}/edit`} className="btn btn-mini">Renommer</Link>
            <button type="button" className="btn btn-mini" onClick={() => onDuplicate(l.id)} disabled={busy}>Dupliquer</button>
            <button type="button" className="btn btn-mini btn-danger" onClick={() => onDelete(l.id, l.nom)} disabled={busy}>Supprimer</button>
          </div>
        </div>
      ))}
    </div>
  );
}
