import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Chips } from "../../components/Chips";
import { blankListing, deleteListing, getListing, saveListing } from "../../lib/interventions";
import type { InterventionListing } from "../../lib/types";

const SCOPE_OPTS = [{ value: "perso", label: "Perso" }, { value: "partage", label: "Partagé" }];

export function ListingForm() {
  const { id } = useParams();
  const isNew = id === "new" || !id;
  const nav = useNavigate();
  const [form, setForm] = useState<InterventionListing | null>(isNew ? blankListing() : null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (!isNew && id) getListing(id).then((l) => setForm(l ?? blankListing())); }, [id, isNew]);

  if (!form) return <div className="splash">…</div>;
  const upd = (p: Partial<InterventionListing>) => setForm((f) => (f ? { ...f, ...p } : f));

  async function save() {
    if (busy) return;
    if (!form!.nom.trim()) { alert("Donne un nom au listing."); return; }
    setBusy(true);
    await saveListing({ ...form!, nom: form!.nom.trim() });
    nav(`/interventions/${form!.id}`);
  }
  async function remove() {
    if (isNew || busy || !confirm("Supprimer ce listing et ses lignes ?")) return;
    setBusy(true);
    await deleteListing(form!.id);
    nav("/interventions");
  }

  return (
    <div>
      <Link to="/interventions" className="back">← Interventions</Link>
      <div className="page-head"><h2>{isNew ? "Nouveau listing" : form.nom || "Listing"}</h2></div>

      <label className="field"><span>Nom</span>
        <input value={form.nom} onChange={(e) => upd({ nom: e.target.value })} placeholder="Ex. VP radiamètres Bugey — sept. 26" autoFocus />
      </label>
      <label className="field"><span>Portée</span>
        <Chips options={SCOPE_OPTS} value={form.scope} onChange={(v) => upd({ scope: (v ?? "perso") as InterventionListing["scope"] })} />
      </label>
      <p className="muted hint">Partagé : visible et modifiable par toute l'équipe. Perso : visible par toi seul.</p>

      <div className="btn-row" style={{ marginTop: 14 }}>
        <button className="btn btn-primary" onClick={save} disabled={busy}>Enregistrer</button>
        {!isNew && <button className="btn btn-danger" onClick={remove} disabled={busy}>Supprimer</button>}
      </div>
    </div>
  );
}
