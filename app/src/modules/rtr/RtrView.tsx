import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { allRegimes, blankRegime, deleteRegime, isExpired, saveRegime } from "../../lib/rtr";
import { code128 } from "../../lib/barcode";
import { PLANNING_SITES, type RegimeTravail, type RtrScope } from "../../lib/types";

// --- Code-barres (Code 128 B) rendu en SVG, scannable au lecteur d'accès ------
function Barcode({ value }: { value: string }) {
  const bc = useMemo(() => code128(value), [value]);
  if (!bc) return <div className="rtr-bc-none">Code non imprimable en code-barres</div>;
  const QUIET = 10; // zone de silence (modules) de chaque côté
  const H = 64;
  const total = bc.modules + QUIET * 2;
  return (
    <svg
      className="rtr-bc"
      viewBox={`0 0 ${total} ${H}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={`Code-barres ${value}`}
    >
      <rect x={0} y={0} width={total} height={H} fill="#ffffff" />
      {bc.bars.map((b, i) => (
        <rect key={i} x={b.x + QUIET} y={0} width={b.w} height={H} fill="#000000" />
      ))}
    </svg>
  );
}

export function RtrView() {
  const regimes = useLiveQuery(() => allRegimes(), []) ?? [];
  const [draft, setDraft] = useState<RegimeTravail | null>(null);
  const [busy, setBusy] = useState(false);

  function startNew() { setDraft(blankRegime()); }
  function startEdit(r: RegimeTravail) { setDraft({ ...r }); }
  function cancel() { setDraft(null); }

  const canSave = !!draft && draft.nom.trim() !== "" && draft.code.trim() !== "";

  async function onSave() {
    if (!draft || !canSave || busy) return;
    setBusy(true);
    try {
      await saveRegime({
        ...draft,
        nom: draft.nom.trim(),
        code: draft.code.trim(),
        site: draft.site?.trim() || null,
        date_validite: draft.date_validite || null,
      });
      setDraft(null);
    } finally { setBusy(false); }
  }

  async function onDelete(r: RegimeTravail) {
    if (busy || !confirm(`Supprimer le régime « ${r.nom || "(sans nom)"} » ?`)) return;
    setBusy(true);
    try {
      await deleteRegime(r.id);
      if (draft?.id === r.id) setDraft(null);
    } finally { setBusy(false); }
  }

  return (
    <div>
      <div className="page-head">
        <h2>Régimes radiologiques</h2>
        {!draft && <button type="button" className="add" onClick={startNew}>+ Nouveau</button>}
      </div>

      {draft && (
        <div className="card rtr-form">
          <label className="field">
            <span>Nom</span>
            <input
              value={draft.nom}
              onChange={(e) => setDraft({ ...draft, nom: e.target.value })}
              placeholder="Ex. RTR Bugey 2025"
              autoFocus
            />
          </label>

          <label className="field">
            <span>Site</span>
            <select
              value={draft.site ?? ""}
              onChange={(e) => setDraft({ ...draft, site: e.target.value || null })}
            >
              <option value="">— Aucun —</option>
              {PLANNING_SITES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>

          <label className="field">
            <span>Date de validité <small>(laisser vide = pas d'échéance)</small></span>
            <input
              type="date"
              value={draft.date_validite ?? ""}
              onChange={(e) => setDraft({ ...draft, date_validite: e.target.value || null })}
            />
          </label>

          <label className="field">
            <span>Code <small>(code-barres d'accès en zone contrôlée)</small></span>
            <input
              value={draft.code}
              onChange={(e) => setDraft({ ...draft, code: e.target.value })}
              placeholder="Ex. 123456789"
              inputMode="text"
              autoCapitalize="characters"
            />
          </label>

          {draft.code.trim() !== "" && (
            <div className="rtr-bc-wrap">
              <Barcode value={draft.code.trim()} />
              <div className="rtr-code">{draft.code.trim()}</div>
            </div>
          )}

          <div className="field">
            <span>Visibilité</span>
            <div className="chips">
              {(["perso", "partage"] as RtrScope[]).map((s) => (
                <button
                  type="button"
                  key={s}
                  className={`chip ${draft.scope === s ? "on" : ""}`}
                  onClick={() => setDraft({ ...draft, scope: s })}
                >
                  {s === "perso" ? "Perso" : "Partagé"}
                </button>
              ))}
            </div>
          </div>

          <div className="btn-row">
            <button type="button" className="btn btn-primary" onClick={onSave} disabled={!canSave || busy}>
              Enregistrer
            </button>
            <button type="button" className="btn" onClick={cancel} disabled={busy}>Annuler</button>
          </div>
        </div>
      )}

      {regimes.length === 0 && !draft && (
        <div className="empty">Aucun régime — ajoute ton premier régime de travail radiologique.</div>
      )}

      {regimes.map((r) => {
        const expired = isExpired(r);
        return (
          <div className="card" key={r.id}>
            <div className="card-top">
              <span className="card-title">{r.nom || "(sans nom)"}</span>
              <span className={`tag ${r.scope === "partage" ? "ok" : ""}`}>
                {r.scope === "partage" ? "Partagé" : "Perso"}
              </span>
            </div>
            <div className="card-sub">
              {r.site || "Sans site"}
              {" · "}
              {r.date_validite
                ? <span className={expired ? "rtr-expired" : ""}>
                    {expired ? "Périmé le " : "Valide jusqu'au "}
                    {new Date(r.date_validite).toLocaleDateString("fr-FR")}
                  </span>
                : "Sans échéance"}
            </div>

            <div className="rtr-bc-wrap">
              <Barcode value={r.code} />
              <div className="rtr-code">{r.code}</div>
            </div>

            <div className="iv-card-actions">
              <button type="button" className="btn btn-mini" onClick={() => startEdit(r)}>Modifier</button>
              <button type="button" className="btn btn-mini btn-danger" onClick={() => onDelete(r)} disabled={busy}>
                Supprimer
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
