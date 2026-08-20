import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../../lib/db";
import { importImputations } from "../../lib/imputations";

// Import et consultation des imputations, dans l'onglet Paramètres du portail.
export function ImputationsSection() {
  const imps = useLiveQuery(() => db.imputations.toArray(), []);
  const list = (imps ?? []).filter((i) => !i.deleted);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await importImputations(file);
      setMsg(`✓ ${res.lignes} imputations importées (feuille « ${res.feuille} »).`);
    } catch (err) {
      setMsg("✗ " + ((err as Error).message || "import impossible"));
    } finally {
      setBusy(false);
    }
  }

  const needle = q.trim().toLowerCase();
  const shown = needle
    ? list.filter((i) =>
        `${i.num_projet ?? ""} ${i.tache} ${i.nom_tache ?? ""} ${i.client ?? ""} ${i.nom_projet ?? ""}`
          .toLowerCase()
          .includes(needle)
      )
    : list;

  return (
    <section className="card param-section">
      <h3 className="section-title">Imputations</h3>
      <p className="muted hint">Codes d'affaire × tâches (référence Bertin, partagée). Importe le fichier Excel « Pointages ».</p>

      <div className="btn-row">
        <label className="btn btn-primary" style={{ cursor: "pointer" }}>
          ⬆ Importer l'Excel
          <input
            type="file"
            accept=".xlsx,.xlsm,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            style={{ display: "none" }}
            onChange={onFile}
            disabled={busy}
          />
        </label>
        <span className="pl-count">{list.length} en base</span>
      </div>
      {busy && <p className="muted hint">Import en cours…</p>}
      {msg && <p className="hint" style={{ marginTop: 4 }}>{msg}</p>}

      {list.length > 0 && (
        <>
          <label className="field" style={{ marginTop: 10 }}>
            <span>Rechercher</span>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="site, n° d'affaire, tâche…" />
          </label>
          <div className="imp-list">
            {shown.slice(0, 60).map((i) => (
              <div className="imp-row" key={i.id}>
                <span className="imp-code">{i.num_projet} · {i.tache}</span>
                <span className="imp-name">{i.nom_tache}</span>
                {(i.site || i.usine) && (
                  <span className="imp-flags">{[i.site && "site", i.usine && "usine"].filter(Boolean).join(" / ")}</span>
                )}
              </div>
            ))}
            {shown.length > 60 && <div className="muted hint">… {shown.length - 60} de plus</div>}
            {shown.length === 0 && <div className="muted hint">Aucun résultat.</div>}
          </div>
        </>
      )}
    </section>
  );
}
