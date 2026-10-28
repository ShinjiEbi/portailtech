import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../../lib/db";

const TYPE_LABEL: Record<string, string> = {
  ajout: "ajout", modification: "modif", suppression: "suppr", erreur: "erreur", info: "info",
};

function fmt(ts: string): string {
  return new Date(ts).toLocaleString("fr-FR", {
    day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit",
  });
}

// Journal en lecture seule : log automatique des modifications
// (ECME avec détail des champs, modèles, imports). Aucune saisie manuelle.
export function JournalLog() {
  const all = useLiveQuery(() => db.journal.toArray(), []);
  const list = (all ?? [])
    .filter((j) => !j.deleted)
    .sort((a, b) => (a.ts < b.ts ? 1 : -1))
    .slice(0, 200);

  return (
    <section className="card param-section">
      <h3 className="section-title">Journal · log d'activité</h3>
      <p className="muted hint">
        Historique automatique des ajouts, modifications et suppressions (ECME, modèles, imports). Lecture seule.
      </p>

      {list.length === 0 && <div className="empty">Journal vide.</div>}

      {list.map((j) => (
        <div key={j.id} className={`feed-item jt-${j.type}`}>
          <div className="feed-meta">
            <span>{fmt(j.ts)}</span>
            <span className={`tag jtag-${j.type}`}>{TYPE_LABEL[j.type] ?? j.type}</span>
          </div>
          <div className="feed-body">{j.message}</div>
        </div>
      ))}
    </section>
  );
}
