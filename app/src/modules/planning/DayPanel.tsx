import { useEffect, useMemo, useRef, useState } from "react";
import { Chips } from "../../components/Chips";
import { calcHeures, deleteJour, getJour, isWorked, trajetHeures, upsertJour } from "../../lib/planning";
import { addFraisPhoto, deleteFraisPhoto, fraisIsPdf, fraisPhotoUrl } from "../../lib/fraisPhotos";
import {
  allImputations, clientsInDb, contratFromImputation, imputationByCode, imputationCode,
  projetsForClient, siteFromImputation, tachesForProjet,
} from "../../lib/imputations";
import {
  PLANNING_FRAIS_CATS, PLANNING_TYPES,
  type FraisItem, type Imputation, type PlanningParams, type PlanningType,
} from "../../lib/types";

function longDate(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Intl.DateTimeFormat("fr-FR", {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
  }).format(new Date(y, m - 1, d));
}

const TYPE_OPTS = PLANNING_TYPES.map((t) => ({ value: t, label: t }));
const TRAJET_DEFAUT = { ad: "07:30", af: "08:00", rd: "16:30", rf: "17:00" };
// "HH:MM" depuis un total de minutes (borné sur 24 h)
const hhmm = (totalMin: number): string => {
  const m = ((Math.round(totalMin) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};

export function DayPanel({
  date, params, onClose,
}: {
  date: string;
  params: PlanningParams;
  onClose: () => void;
}) {
  const [loaded, setLoaded] = useState(false);
  const [exists, setExists] = useState(false);
  const [busy, setBusy] = useState(false);

  const [type, setType] = useState<PlanningType>("Travaillé");
  const [debut, setDebut] = useState("");
  const [fin, setFin] = useState("");
  const [pause, setPause] = useState("");
  const [dose, setDose] = useState("");
  const [commentaire, setCommentaire] = useState("");
  const [imputation, setImputation] = useState("");   // pointage = "n° projet · tâche"
  const [client, setClient] = useState("");
  const [projet, setProjet] = useState("");           // n° projet
  const [imps, setImps] = useState<Imputation[]>([]);

  const [trajet, setTrajet] = useState(false);
  const [tAD, setTAD] = useState("");
  const [tAF, setTAF] = useState("");
  const [tRD, setTRD] = useState("");
  const [tRF, setTRF] = useState("");

  const [frais, setFrais] = useState<FraisItem[]>([]);
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [photoBusy, setPhotoBusy] = useState<string | null>(null);
  const urlsRef = useRef<string[]>([]);
  const reconRef = useRef(false); // client/projet déjà reconstruits depuis le pointage ?

  const def = params.trajet_defaut ?? TRAJET_DEFAUT;

  function addPreview(path: string, url: string) {
    urlsRef.current.push(url);
    setPreviews((p) => ({ ...p, [path]: url }));
  }

  useEffect(() => {
    let alive = true;
    (async () => {
      const j = await getJour(date);
      if (!alive) return;
      reconRef.current = false;
      setClient(""); setProjet("");
      if (j) {
        setExists(true);
        setType(j.type);
        setDebut(j.debut ?? "");
        setFin(j.fin ?? "");
        setPause(j.pause != null ? String(j.pause) : "");
        setDose(j.dose != null ? String(j.dose) : "");
        setCommentaire(j.commentaire ?? "");
        setImputation(j.imputation ?? "");
        setTrajet(!!j.trajet);
        setTAD(j.t_ad ?? def.ad);
        setTAF(j.t_af ?? def.af);
        setTRD(j.t_rd ?? def.rd);
        setTRF(j.t_rf ?? def.rf);
        setFrais(j.frais ?? []);
        (j.frais ?? []).forEach((fr) => {
          if (fr.photo_path) {
            fraisPhotoUrl(fr.photo_path).then((u) => {
              if (alive && u) addPreview(fr.photo_path as string, u);
            });
          }
        });
      } else {
        setExists(false);
        // jour vide : pré-remplissage par défaut d'après l'horaire journalier (params), dose à 0
        const pauseMin = 60;
        const fin = hhmm(8 * 60 + Math.round((params.horaire || 7.5) * 60) + pauseMin);
        setType("Travaillé");
        setDebut("08:00");
        setFin(fin);
        setPause(String(pauseMin));
        setDose("0");
        setCommentaire("");
        setImputation("");
        setTrajet(false);
        setTAD(def.ad); setTAF(def.af); setTRD(def.rd); setTRF(def.rf);
        setFrais([]);
      }
      setLoaded(true);
    })();
    return () => {
      alive = false;
      urlsRef.current.forEach((u) => URL.revokeObjectURL(u));
      urlsRef.current = [];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  useEffect(() => {
    allImputations().then(setImps);
  }, []);

  const worked = isWorked(type);
  const calc = useMemo(
    () => calcHeures(debut || null, fin || null, pause === "" ? null : Number(pause), params.horaire, trajet ? trajetHeures(tAD, tAF, tRD, tRF) : 0),
    [debut, fin, pause, params.horaire, trajet, tAD, tAF, tRD, tRF]
  );

  // Reconstruit Client/Projet depuis le pointage chargé, une fois les imputations dispo.
  useEffect(() => {
    if (reconRef.current || !imps.length || !imputation) return;
    const imp = imputationByCode(imps, imputation);
    if (imp) { setClient(imp.client ?? ""); setProjet(imp.num_projet ?? ""); }
    reconRef.current = true;
  }, [imps, imputation]);

  // Cascade Client → Projet → Tâche ; le pointage = code de la tâche choisie.
  const clients = useMemo(() => clientsInDb(imps), [imps]);
  const projets = useMemo(() => (client ? projetsForClient(imps, client) : []), [imps, client]);
  const taches = useMemo(() => (projet ? tachesForProjet(imps, projet) : []), [imps, projet]);
  const selImp = useMemo(() => imputationByCode(imps, imputation), [imps, imputation]);
  // Contrat + site déduits du pointage (servent aux exports dosi / feuille de temps).
  const dContrat = contratFromImputation(selImp);
  const dSite = siteFromImputation(selImp);

  function toggleTrajet(on: boolean) {
    setTrajet(on);
    if (on && !tAD && !tAF && !tRD && !tRF) {
      setTAD(def.ad); setTAF(def.af); setTRD(def.rd); setTRF(def.rf);
    }
  }

  const addFrais = () =>
    setFrais((f) => [...f, { id: crypto.randomUUID(), cat: "Repas", montant: 0 }]);
  const upFrais = (id: string, patch: Partial<FraisItem>) =>
    setFrais((f) => f.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  async function rmFrais(id: string) {
    const it = frais.find((x) => x.id === id);
    if (it?.photo_path) await deleteFraisPhoto(it.photo_path);
    setFrais((f) => f.filter((x) => x.id !== id));
  }
  async function pickPhoto(id: string, file: File) {
    setPhotoBusy(id);
    try {
      const it = frais.find((x) => x.id === id);
      if (it?.photo_path) await deleteFraisPhoto(it.photo_path); // remplace l'ancien justificatif
      const { path, nom } = await addFraisPhoto(date, id, file);
      upFrais(id, { photo_path: path, photo_nom: nom });
      const u = await fraisPhotoUrl(path);
      if (u) addPreview(path, u);
    } catch (e) {
      alert((e as Error).message || "Erreur lors de l'ajout du justificatif.");
    } finally {
      setPhotoBusy(null);
    }
  }
  const onPickFile = (id: string) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) pickPhoto(id, file);
    e.target.value = "";
  };
  async function rmPhoto(id: string) {
    const it = frais.find((x) => x.id === id);
    if (it?.photo_path) {
      await deleteFraisPhoto(it.photo_path);
      upFrais(id, { photo_path: null, photo_nom: null });
    }
  }

  async function save() {
    setBusy(true);
    try {
      const fraisOut: FraisItem[] = worked
        ? frais.map((f) => ({
            id: f.id, cat: f.cat, montant: Number(f.montant) || 0,
            photo_path: f.photo_path ?? null, photo_nom: f.photo_nom ?? null,
          }))
        : [];
      if (!worked) {
        for (const f of frais) if (f.photo_path) await deleteFraisPhoto(f.photo_path);
      }
      await upsertJour({
        date,
        type,
        debut: worked ? debut || null : null,
        fin: worked ? fin || null : null,
        pause: worked && pause !== "" ? Number(pause) : null,
        total: worked ? calc.total : null,
        h_norm: worked ? calc.h_norm : null,
        h_supp: worked ? calc.h_supp : null,
        site: worked ? (dSite ?? null) : null,
        contrat: worked ? (dContrat ?? null) : null,
        imputation: worked ? (imputation || null) : null,
        dose: worked && dose !== "" ? Number(dose) : null,
        trajet: worked ? trajet : false,
        t_ad: worked && trajet ? tAD || null : null,
        t_af: worked && trajet ? tAF || null : null,
        t_rd: worked && trajet ? tRD || null : null,
        t_rf: worked && trajet ? tRF || null : null,
        frais: fraisOut,
        commentaire: commentaire || null,
      });
      onClose();
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      for (const f of frais) if (f.photo_path) await deleteFraisPhoto(f.photo_path);
      await deleteJour(date);
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="pl-overlay" onClick={onClose}>
      <div className="pl-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="pl-sheet-head">
          <span className="pl-sheet-title">{longDate(date)}</span>
          <button className="ghost" onClick={onClose} title="Fermer">✕</button>
        </div>

        {!loaded ? (
          <p className="muted">…</p>
        ) : (
          <>
            <div className="field">
              <span>Type de journée</span>
              <Chips options={TYPE_OPTS} value={type} onChange={(v) => v && setType(v)} />
            </div>

            {worked && (
              <>
                <div className="pl-row3">
                  <label className="field">
                    <span>Début</span>
                    <input type="time" value={debut} onChange={(e) => setDebut(e.target.value)} />
                  </label>
                  <label className="field">
                    <span>Fin</span>
                    <input type="time" value={fin} onChange={(e) => setFin(e.target.value)} />
                  </label>
                  <label className="field">
                    <span>Pause (min)</span>
                    <input type="number" min={0} value={pause} onChange={(e) => setPause(e.target.value)} />
                  </label>
                </div>
                <div className="pl-calc">
                  <span>Total : <b>{calc.total != null ? `${calc.total} h` : "—"}</b></span>
                  <span>Normales : <b>{calc.h_norm != null ? `${calc.h_norm} h` : "—"}</b></span>
                  <span>Supp. : <b>{calc.h_supp != null ? `${calc.h_supp} h` : "—"}</b></span>
                </div>

                <label className="check">
                  <input type="checkbox" checked={trajet} onChange={(e) => toggleTrajet(e.target.checked)} />
                  Saisir des heures de trajet
                </label>
                {trajet && (
                  <div style={{ marginTop: 8 }}>
                    <div className="pl-row2">
                      <label className="field">
                        <span>Aller — départ</span>
                        <input type="time" value={tAD} onChange={(e) => setTAD(e.target.value)} />
                      </label>
                      <label className="field">
                        <span>Aller — arrivée</span>
                        <input type="time" value={tAF} onChange={(e) => setTAF(e.target.value)} />
                      </label>
                    </div>
                    <div className="pl-row2">
                      <label className="field">
                        <span>Retour — départ</span>
                        <input type="time" value={tRD} onChange={(e) => setTRD(e.target.value)} />
                      </label>
                      <label className="field">
                        <span>Retour — arrivée</span>
                        <input type="time" value={tRF} onChange={(e) => setTRF(e.target.value)} />
                      </label>
                    </div>
                  </div>
                )}

                <label className="field">
                  <span>Client</span>
                  <select value={client} onChange={(e) => { setClient(e.target.value); setProjet(""); setImputation(""); }}>
                    <option value="">—</option>
                    {clients.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </label>

                <label className="field">
                  <span>Projet</span>
                  <select value={projet} onChange={(e) => { setProjet(e.target.value); setImputation(""); }} disabled={!client}>
                    <option value="">—</option>
                    {projets.map((p) => <option key={p.num} value={p.num}>{p.nom}</option>)}
                  </select>
                </label>

                <label className="field">
                  <span>Tâche</span>
                  <select value={imputation} onChange={(e) => setImputation(e.target.value)} disabled={!projet}>
                    <option value="">—</option>
                    {taches.map((t) => (
                      <option key={t.id} value={imputationCode(t)}>{t.tache} — {t.nom_tache ?? ""}</option>
                    ))}
                  </select>
                  {imps.length === 0 ? (
                    <p className="pl-imp-none">Importe les imputations dans Paramètres pour choisir un pointage.</p>
                  ) : selImp ? (
                    <p className="pl-imp-auto">
                      Pointage Oracle : <b>{imputationCode(selImp)}</b>
                      {(dContrat || dSite) ? ` · ${[dContrat, dSite && dSite.replace(/^(CNPE|DP2D) /, "")].filter(Boolean).join(" / ")}` : ""}
                    </p>
                  ) : (
                    <p className="pl-imp-auto">Choisis client → projet → tâche pour fixer le pointage.</p>
                  )}
                </label>

                <label className="field">
                  <span>Dose du jour (µSv)</span>
                  <input type="number" step="0.1" value={dose} placeholder="0" onChange={(e) => setDose(e.target.value)} />
                </label>

                <div className="field">
                  <span>Notes de frais du jour</span>
                  {frais.map((f) => (
                    <div className="pl-frais-row" key={f.id}>
                      <select value={f.cat} onChange={(e) => upFrais(f.id, { cat: e.target.value })}>
                        {PLANNING_FRAIS_CATS.map((c) => (
                          <option key={c} value={c}>{c}</option>
                        ))}
                      </select>
                      <input
                        type="number" step="0.01" min={0} placeholder="€"
                        value={f.montant}
                        onChange={(e) => upFrais(f.id, { montant: Number(e.target.value) || 0 })}
                      />
                      <span className="pl-photo-wrap">
                        {f.photo_path && previews[f.photo_path] ? (
                          <span className="pl-recu">
                            {fraisIsPdf(f.photo_path) ? (
                              <a className="pl-thumb pl-pdf" href={previews[f.photo_path]} target="_blank" rel="noopener" title="Ouvrir le PDF">📄</a>
                            ) : (
                              <a className="pl-thumb-link" href={previews[f.photo_path]} target="_blank" rel="noopener" title="Ouvrir le justificatif">
                                <img className="pl-thumb" src={previews[f.photo_path]} alt="reçu" />
                              </a>
                            )}
                            <button type="button" className="pl-recu-x" onClick={() => rmPhoto(f.id)} title="Retirer le justificatif">✕</button>
                          </span>
                        ) : (
                          <span className="pl-photo-btns">
                            <label className="pl-photo-lbl" title="Prendre une photo">
                              {photoBusy === f.id ? "…" : "📷"}
                              <input type="file" accept="image/*" capture="environment" onChange={onPickFile(f.id)} />
                            </label>
                            <label className="pl-photo-lbl" title="Importer une photo ou un PDF">
                              📎
                              <input type="file" accept="image/*,application/pdf" onChange={onPickFile(f.id)} />
                            </label>
                          </span>
                        )}
                      </span>
                      <button className="pl-x" onClick={() => rmFrais(f.id)} title="Supprimer la ligne">✕</button>
                    </div>
                  ))}
                  <button className="btn-mini pl-frais-add" onClick={addFrais}>+ Ajouter une note de frais</button>
                </div>
              </>
            )}

            <label className="field">
              <span>Commentaire</span>
              <textarea rows={2} value={commentaire} onChange={(e) => setCommentaire(e.target.value)} />
            </label>

            <div className="btn-row">
              <button className="btn btn-primary" onClick={save} disabled={busy}>Enregistrer</button>
              {exists && (
                <button className="btn btn-danger" onClick={remove} disabled={busy}>Supprimer</button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
