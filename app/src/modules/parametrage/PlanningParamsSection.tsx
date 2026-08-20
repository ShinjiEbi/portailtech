import { useEffect, useState } from "react";
import { allJours, defaultParams, getParams, saveParams } from "../../lib/planning";
import { buildExport, importPlanningJson } from "../../lib/planningImport";
import { type PlanningParams } from "../../lib/types";

const TRAJET_DEFAUT = { ad: "07:30", af: "08:00", rd: "16:30", rf: "17:00" };

// Réglages du planning — dans l'onglet Paramètres du portail.
export function PlanningParamsSection() {
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  // état d'édition (identité + horaire + trajet)
  const [horaire, setHoraire] = useState("7.5");
  const [nom, setNom] = useState("");
  const [prenom, setPrenom] = useState("");
  const [matricule, setMatricule] = useState("");
  const [dosi, setDosi] = useState("");
  const [sup, setSup] = useState("");
  const [trigramme, setTrigramme] = useState("");
  const [ad, setAd] = useState(TRAJET_DEFAUT.ad);
  const [af, setAf] = useState(TRAJET_DEFAUT.af);
  const [rd, setRd] = useState(TRAJET_DEFAUT.rd);
  const [rf, setRf] = useState(TRAJET_DEFAUT.rf);

  function hydrate(v: PlanningParams) {
    setHoraire(String(v.horaire ?? 7.5));
    setNom(v.nom ?? "");
    setPrenom(v.prenom ?? "");
    setMatricule(v.matricule ?? "");
    setDosi(v.dosi ?? "");
    setSup(v.sup ?? "");
    setTrigramme(v.trigramme ?? "");
    const td = v.trajet_defaut ?? TRAJET_DEFAUT;
    setAd(td.ad); setAf(td.af); setRd(td.rd); setRf(td.rf);
  }

  useEffect(() => {
    getParams().then(hydrate);
  }, []);

  async function save() {
    setBusy(true);
    try {
      await saveParams({
        horaire: Number(horaire) || 7.5,
        nom: nom || null, prenom: prenom || null,
        matricule: matricule || null, dosi: dosi || null, sup: sup || null,
        trigramme: trigramme || null,
        trajet_defaut: { ad, af, rd, rf },
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } finally {
      setBusy(false);
    }
  }

  async function doExport() {
    setBusy(true);
    try {
      const [params, js] = await Promise.all([getParams(), allJours()]);
      const blob = new Blob([JSON.stringify(buildExport(params, js), null, 2)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `planning_${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    } finally {
      setBusy(false);
    }
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusy(true);
    try {
      const json = JSON.parse(await file.text());
      const n = Array.isArray(json?.jours) ? json.jours.length : 0;
      if (!window.confirm(`Importer ${n} jour(s)${json?.params ? " + paramètres" : ""} ? Les dates déjà saisies seront remplacées.`)) {
        setBusy(false);
        return;
      }
      const res = await importPlanningJson(json);
      hydrate(await getParams());
      alert(`Import terminé : ${res.jours} jour(s)${res.params ? " + paramètres" : ""}${res.ignores ? `, ${res.ignores} ignoré(s)` : ""}.`);
    } catch (err) {
      alert("Import impossible : " + ((err as Error).message || "fichier invalide"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card param-section">
      <h3 className="section-title">Planning — mes paramètres</h3>
      <p className="muted hint">Identité et réglages utilisés par la saisie quotidienne et les exports Excel.</p>

      <label className="field">
        <span>Heures contractuelles / jour</span>
        <input type="number" step="0.25" min={0} value={horaire} onChange={(e) => setHoraire(e.target.value)} />
      </label>

      <div className="pl-row2">
        <label className="field"><span>Nom</span><input value={nom} onChange={(e) => setNom(e.target.value)} placeholder="BEROUD-BLANC" /></label>
        <label className="field"><span>Prénom</span><input value={prenom} onChange={(e) => setPrenom(e.target.value)} placeholder="Romain" /></label>
      </div>
      <div className="pl-row2">
        <label className="field"><span>Matricule</span><input value={matricule} onChange={(e) => setMatricule(e.target.value)} /></label>
        <label className="field"><span>N° dosimètre</span><input value={dosi} onChange={(e) => setDosi(e.target.value)} placeholder="3432" /></label>
      </div>
      <div className="pl-row2">
        <label className="field"><span>Responsable hiérarchique</span><input value={sup} onChange={(e) => setSup(e.target.value)} placeholder="MCAPELA" /></label>
        <label className="field"><span>Trigramme (exécutant)</span><input value={trigramme} onChange={(e) => setTrigramme(e.target.value.toUpperCase())} maxLength={3} placeholder="RBB" /></label>
      </div>

      <div className="field">
        <span>Heures de trajet par défaut</span>
        <div className="pl-row2">
          <label className="field"><span>Aller — départ</span><input type="time" value={ad} onChange={(e) => setAd(e.target.value)} /></label>
          <label className="field"><span>Aller — arrivée</span><input type="time" value={af} onChange={(e) => setAf(e.target.value)} /></label>
        </div>
        <div className="pl-row2">
          <label className="field"><span>Retour — départ</span><input type="time" value={rd} onChange={(e) => setRd(e.target.value)} /></label>
          <label className="field"><span>Retour — arrivée</span><input type="time" value={rf} onChange={(e) => setRf(e.target.value)} /></label>
        </div>
      </div>

      <div className="btn-row">
        <button className="btn btn-primary" onClick={save} disabled={busy}>Enregistrer</button>
        {saved && <span className="ok-flash">Enregistré ✓</span>}
      </div>

      <div className="pl-sep" />
      <div className="field">
        <span>Sauvegarde / migration du planning</span>
        <div className="pl-export" style={{ margin: "6px 0 0" }}>
          <button className="btn" onClick={doExport} disabled={busy}>⬇ Exporter (JSON)</button>
          <label className="btn" style={{ cursor: "pointer", textAlign: "center" }}>
            ⬆ Importer (JSON)
            <input type="file" accept="application/json" style={{ display: "none" }} onChange={onFile} disabled={busy} />
          </label>
        </div>
        <p className="muted hint" style={{ marginTop: 8 }}>
          Récupération de l'ancien outil : ouvre-le, « Export JSON », puis importe ici le fichier obtenu.
        </p>
      </div>
    </section>
  );
}
