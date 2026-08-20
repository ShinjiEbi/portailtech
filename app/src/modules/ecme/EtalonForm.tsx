import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../../lib/db";
import { localUpsert, localSoftDelete, syncAll, logJournal, isOnline } from "../../lib/sync";
import { uploadCertificat, certificatObjectUrl, deleteCertificat } from "../../lib/storage";
import type { ChangeEvent } from "react";
import { Chips } from "../../components/Chips";
import { ChampInput } from "../../components/ChampInput";
import { ActiviteJour } from "../../components/ActiviteJour";
import { activiteFromValeurs } from "../../lib/decay";
import { favorisSet, toggleFavori } from "../../lib/favoris";
import { ETALON_STATUTS, type ChampLibre, type Etalon, type EtalonModele, type EtalonStatut } from "../../lib/types";

const STATUT_OPTS = ETALON_STATUTS.map((s) => ({ value: s, label: s.replace("_", " ") }));

function blank(): Etalon {
  return {
    id: crypto.randomUUID(),
    modele_id: null,
    modele_nom: "",
    designation: "",
    statut: "en_service",
    epingle: false,
    valeurs: {},
    champs_libres: [],
    updated_at: new Date().toISOString(),
    deleted: false,
  };
}

// Liste des champs comparés pour le log de modification (libellés lisibles).
const FIELD_LABELS: [keyof Etalon, string][] = [
  ["modele_nom", "Modèle"], ["num_serie", "N° constructeur"], ["num_client", "N° client"],
  ["designation", "Désignation"], ["certificat_ref", "Certificat réf."], ["statut", "Statut"],
  ["date_etalonnage", "Date étalonnage"], ["date_echeance", "Échéance"], ["certificat_nom", "Certificat fichier"],
];
const shown = (v: unknown) => (v == null || v === "" ? "∅" : String(v));

// Différences champ par champ entre deux versions d'un étalon (pour le journal).
function diffEtalon(a: Etalon, b: Etalon, modele?: EtalonModele): string[] {
  const lines: string[] = [];
  for (const [k, label] of FIELD_LABELS) {
    const av = shown(a[k]); const bv = shown(b[k]);
    if (av !== bv) lines.push(`${label} : ${av} → ${bv}`);
  }
  const keys = new Set([...Object.keys(a.valeurs || {}), ...Object.keys(b.valeurs || {})]);
  for (const key of keys) {
    const av = shown((a.valeurs || {})[key]); const bv = shown((b.valeurs || {})[key]);
    if (av !== bv) {
      const lib = modele?.champs.find((c) => c.cle === key)?.libelle ?? key;
      lines.push(`${lib} : ${av} → ${bv}`);
    }
  }
  const mapCL = (arr: ChampLibre[] | undefined) => {
    const m = new Map<string, string>();
    for (const c of arr || []) if (c.libelle) m.set(c.libelle, c.valeur ?? "");
    return m;
  };
  const ma = mapCL(a.champs_libres); const mb = mapCL(b.champs_libres);
  for (const lib of new Set([...ma.keys(), ...mb.keys()])) {
    const av = shown(ma.get(lib)); const bv = shown(mb.get(lib));
    if (av !== bv) lines.push(`${lib} : ${av} → ${bv}`);
  }
  return lines;
}

export function EtalonForm() {
  const { id } = useParams();
  const isNew = id === "new";
  const nav = useNavigate();
  const modeles = useLiveQuery(() => db.modeles.toArray(), []);
  const favoris = useLiveQuery(() => favorisSet(), []) ?? new Set<string>();
  const mods = (modeles ?? []).filter((m) => !m.deleted).sort((a, b) => a.ordre - b.ordre);

  const [form, setForm] = useState<Etalon | null>(isNew ? blank() : null);
  const [busy, setBusy] = useState(false);
  const [certBusy, setCertBusy] = useState(false);

  useEffect(() => {
    if (isNew) return;
    db.etalons.get(id!).then((r) =>
      setForm(r ? { ...r, valeurs: r.valeurs || {}, champs_libres: r.champs_libres || [] } : blank())
    );
  }, [id, isNew]);

  if (!form) return <div className="splash">…</div>;

  const set = (p: Partial<Etalon>) => setForm({ ...form, ...p });
  const utilise = favoris.has(form.id);
  const setVal = (cle: string, v: unknown) => setForm({ ...form, valeurs: { ...form.valeurs, [cle]: v } });
  const modele = form.modele_id ? mods.find((m) => m.id === form.modele_id) : undefined;
  const decay = activiteFromValeurs(modele?.champs, form.valeurs);
  const displayName = form.num_serie?.trim() || form.designation.trim() || "sans nom";

  const chooseModele = (m: EtalonModele) => set({ modele_id: m.id, modele_nom: m.nom });
  const setLibre = (i: number, p: Partial<ChampLibre>) => {
    const arr = form.champs_libres.slice();
    arr[i] = { ...arr[i], ...p };
    set({ champs_libres: arr });
  };
  const addLibre = () => set({ champs_libres: [...form.champs_libres, { libelle: "", valeur: "" }] });
  const delLibre = (i: number) => set({ champs_libres: form.champs_libres.filter((_, j) => j !== i) });

  async function onCertFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!isOnline()) {
      alert("Connecte-toi au réseau pour ajouter un certificat.");
      return;
    }
    if (file.size > 25 * 1024 * 1024) {
      alert("Fichier trop volumineux (max ~25 Mo).");
      return;
    }
    setCertBusy(true);
    try {
      const { path, nom } = await uploadCertificat(form!.id, file);
      set({ certificat_path: path, certificat_nom: nom });
    } catch (err) {
      console.error(err);
      alert("Échec de l'envoi du certificat.");
    } finally {
      setCertBusy(false);
    }
  }
  async function openCert() {
    if (!form!.certificat_path) return;
    const url = await certificatObjectUrl(form!.certificat_path, form!.certificat_nom ?? undefined);
    if (!url) {
      alert("Certificat pas encore en cache. Connecte-toi une fois au réseau pour le télécharger.");
      return;
    }
    window.open(url, "_blank");
  }
  async function removeCert() {
    if (!form!.certificat_path || !confirm("Retirer le certificat ?")) return;
    await deleteCertificat(form!.certificat_path);
    set({ certificat_path: null, certificat_nom: null });
  }

  async function save() {
    if (!(form!.num_serie?.trim() || form!.designation.trim()) || busy) return;
    setBusy(true);
    const old = isNew ? null : (await db.etalons.get(form!.id)) ?? null;
    await localUpsert(db.etalons, form!);
    if (isNew) {
      await logJournal("ajout", `Création étalon « ${displayName} »${form!.modele_nom ? ` (modèle : ${form!.modele_nom})` : ""}`, form!.id);
    } else {
      const lines = old ? diffEtalon(old, form!, modele) : [];
      const msg = lines.length
        ? `Modification étalon « ${displayName} » :\n• ${lines.join("\n• ")}`
        : `Modification étalon « ${displayName} » (aucun champ modifié)`;
      await logJournal("modification", msg, form!.id);
    }
    syncAll().catch(console.error);
    nav("/ecme");
  }
  async function remove() {
    if (!confirm("Supprimer cet étalon ?") || busy) return;
    setBusy(true);
    await localSoftDelete(db.etalons, form!.id);
    await logJournal("suppression", `Suppression étalon « ${displayName} »`, form!.id);
    syncAll().catch(console.error);
    nav("/ecme");
  }

  return (
    <div>
      <Link to="/ecme" className="back">
        ← Étalons
      </Link>
      <div className="page-head">
        <h2>{isNew ? "Nouvel étalon" : displayName}</h2>
      </div>

      {mods.length === 0 && (
        <div className="readonly-note">
          Aucun modèle défini. Crée d'abord un modèle dans l'onglet Paramétrage (ou choisis « Manuel »).
        </div>
      )}

      <label className="field">
        <span>Modèle</span>
        <Chips
          options={mods.map((m) => ({ value: m.id, label: m.nom }))}
          value={form.modele_id}
          onChange={(v) => {
            const m = mods.find((x) => x.id === v);
            if (m) chooseModele(m);
          }}
        />
      </label>

      {decay && <ActiviteJour d={decay} />}

      <div className="grid2">
        <label className="field">
          <span>N° constructeur</span>
          <input value={form.num_serie ?? ""} onChange={(e) => set({ num_serie: e.target.value })} />
        </label>
        <label className="field">
          <span>N° client</span>
          <input value={form.num_client ?? ""} onChange={(e) => set({ num_client: e.target.value })} />
        </label>
      </div>

      <div className="grid2">
        <label className="field">
          <span>Certificat (réf.)</span>
          <input value={form.certificat_ref ?? ""} onChange={(e) => set({ certificat_ref: e.target.value })} />
        </label>
        <label className="field">
          <span>Désignation (optionnel)</span>
          <input value={form.designation} onChange={(e) => set({ designation: e.target.value })} />
        </label>
      </div>

      <label className="field">
        <span>Statut</span>
        <Chips options={STATUT_OPTS} value={form.statut} onChange={(v) => set({ statut: (v ?? "en_service") as EtalonStatut })} />
      </label>

      <label className="field-check">
        <input type="checkbox" checked={utilise} onChange={() => toggleFavori(form.id, utilise)} />
        <span>ECME utilisé <small className="muted">(épinglé en haut de la liste)</small></span>
      </label>

      <div className="grid2">
        <label className="field">
          <span>Date étalonnage</span>
          <input type="date" value={form.date_etalonnage ?? ""} onChange={(e) => set({ date_etalonnage: e.target.value })} />
        </label>
        <label className="field">
          <span>Échéance</span>
          <input type="date" value={form.date_echeance ?? ""} onChange={(e) => set({ date_echeance: e.target.value })} />
        </label>
      </div>

      <div className="section-sep">Certificat</div>
      {form.certificat_path ? (
        <div className="cert-row">
          <span className="tag type">fichier</span>
          <span className="cert-nom">{form.certificat_nom || "certificat"}</span>
          <button type="button" className="btn-mini" onClick={openCert}>
            Ouvrir
          </button>
          <button type="button" className="del-mini" onClick={removeCert}>
            ×
          </button>
        </div>
      ) : (
        <label className="cert-upload">
          <input type="file" accept=".pdf,image/*" onChange={onCertFile} disabled={certBusy} hidden />
          <span>{certBusy ? "Envoi…" : "+ Joindre un PDF / image"}</span>
          {!isOnline() && <em className="muted"> (réseau requis)</em>}
        </label>
      )}

      {modele && modele.champs.length > 0 && (
        <div className="section-sep">{modele.nom}</div>
      )}
      {modele?.champs.map((c) => (
        <label className="field" key={c.cle}>
          <span>
            {c.libelle}
            {c.requis ? " *" : ""}
          </span>
          <ChampInput champ={c} value={form.valeurs[c.cle]} onChange={(v) => setVal(c.cle, v)} />
        </label>
      ))}

      <div className="section-sep">
        Champs libres
        <button type="button" className="add-mini" onClick={addLibre}>
          + champ
        </button>
      </div>
      {form.champs_libres.map((cl, i) => (
        <div className="grid-libre" key={i}>
          <input placeholder="Libellé" value={cl.libelle} onChange={(e) => setLibre(i, { libelle: e.target.value })} />
          <input placeholder="Valeur" value={cl.valeur} onChange={(e) => setLibre(i, { valeur: e.target.value })} />
          <button type="button" className="del-mini" onClick={() => delLibre(i)}>
            ×
          </button>
        </div>
      ))}

      <div className="btn-row">
        <button className="btn btn-primary" onClick={save} disabled={busy}>
          Enregistrer
        </button>
        {!isNew && (
          <button className="btn btn-danger" onClick={remove} disabled={busy}>
            Supprimer
          </button>
        )}
      </div>
    </div>
  );
}
