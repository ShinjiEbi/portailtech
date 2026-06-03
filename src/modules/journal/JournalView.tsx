import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../../lib/db";
import { localUpsert, localSoftDelete, syncAll } from "../../lib/sync";
import { useAuth } from "../../auth/AuthProvider";
import { Chips } from "../../components/Chips";
import { SITES, type JournalEntry } from "../../lib/types";

const TYPE_OPTS = [
  { value: "info", label: "Info" },
  { value: "intervention", label: "Intervention" },
  { value: "materiel", label: "Matériel" },
  { value: "incident", label: "Incident" },
];
const SITE_OPTS = SITES.map((s) => ({ value: s.code, label: s.code }));

function fmt(ts: string): string {
  return new Date(ts).toLocaleString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function JournalView() {
  const { session } = useAuth();
  const uid = session!.user.id;

  const all = useLiveQuery(() => db.journal.toArray(), []);
  const list = (all ?? []).filter((j) => !j.deleted).sort((a, b) => (a.ts < b.ts ? 1 : -1));

  const [type, setType] = useState<string | null>("info");
  const [site, setSite] = useState<string | null>(null);
  const [contenu, setContenu] = useState("");
  const [busy, setBusy] = useState(false);

  async function post() {
    if (!contenu.trim()) return;
    setBusy(true);
    const row: JournalEntry = {
      id: crypto.randomUUID(),
      user_id: uid,
      ts: new Date().toISOString(),
      type,
      site,
      contenu: contenu.trim(),
      etalon_id: null,
      updated_at: new Date().toISOString(),
      deleted: false,
    };
    await localUpsert(db.journal, row);
    syncAll().catch(console.error);
    setContenu("");
    setBusy(false);
  }

  async function del(id: string) {
    if (!confirm("Supprimer cette entrée ?")) return;
    await localSoftDelete(db.journal, id);
    syncAll().catch(console.error);
  }

  return (
    <div>
      <div className="page-head">
        <h2>Journal · main courante</h2>
      </div>

      <div className="composer">
        <Chips options={TYPE_OPTS} value={type} onChange={setType} />
        <Chips options={SITE_OPTS} value={site} onChange={setSite} allLabel="—" />
        <label className="field">
          <span>Note</span>
          <textarea
            value={contenu}
            onChange={(e) => setContenu(e.target.value)}
            placeholder="Saisie…"
          />
        </label>
        <button className="btn btn-primary" onClick={post} disabled={busy}>
          Publier
        </button>
      </div>

      {list.length === 0 && <div className="empty">Journal vide.</div>}
      {list.map((j) => (
        <div key={j.id} className="feed-item">
          <div className="feed-meta">
            <span>{fmt(j.ts)}</span>
            {j.type && <span className="tag type">{j.type}</span>}
            {j.site && <span>{j.site}</span>}
            {j.user_id === uid && <span className="muted">· vous</span>}
            {j.user_id === uid && (
              <button className="feed-del" onClick={() => del(j.id)}>
                ×
              </button>
            )}
          </div>
          <div className="feed-body">{j.contenu}</div>
        </div>
      ))}
    </div>
  );
}
