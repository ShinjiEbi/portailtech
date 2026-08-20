import { Link } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { allCalculs } from "../../lib/calculs";

export function CalculsView() {
  const calculs = useLiveQuery(() => allCalculs(), []) ?? [];
  return (
    <div>
      <div className="page-head">
        <h2>Calcul</h2>
        <Link to="/calcul/new" className="add">+ Nouveau</Link>
      </div>
      <Link to="/calcul/decroissance" className="card calc-builtin">
        <div className="card-top">
          <span className="card-title">⚛ Décroissance</span>
          <span className="tag">Outil</span>
        </div>
        <div className="card-sub">Activité du jour + semaine glissante</div>
      </Link>
      {calculs.length === 0 && <div className="empty">Aucun calcul — crée ta première formule.</div>}
      {calculs.map((c) => (
        <Link key={c.id} to={`/calcul/${c.id}`} className="card">
          <div className="card-top">
            <span className="card-title">{c.nom || "(sans nom)"}</span>
            <span className={`tag ${c.scope === "partage" ? "ok" : ""}`}>{c.scope === "partage" ? "Partagé" : "Perso"}</span>
          </div>
          <div className="card-sub">
            {c.formules.length} formule(s)
            {(() => {
              const cats = new Set<string>();
              for (const comp of c.composantes) {
                if (comp.type !== "source" || !comp.source_filtres) continue;
                for (const x of [...(comp.source_filtres.radionucleides ?? []), ...(comp.source_filtres.types ?? []), ...(comp.source_filtres.rayonnements ?? [])]) cats.add(x);
              }
              return cats.size ? ` · ${[...cats].join(", ")}` : "";
            })()}
            {c.type_source ? ` · ${c.type_source}` : ""}
          </div>
        </Link>
      ))}
    </div>
  );
}
