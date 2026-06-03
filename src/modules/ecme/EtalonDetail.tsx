import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { db } from "../../lib/db";
import { localUpsert, localSoftDelete, syncAll } from "../../lib/sync";
import { useAuth } from "../../auth/AuthProvider";
import { Chips } from "../../components/Chips";
import {
  ETALON_STATUTS,
  SITES,
  type Etalon,
  type EtalonStatut,
  type EtalonType,
} from "../../lib/types";
import { RADIONUCLIDES, currentActivity, formatActivity } from "../../lib/decay";

const TYPE_OPTS = [
  { value: "source" as const, label: "Source" },
  { value: "debitmetre" as const, label: "Débitmètre" },
  { value: "autre" as const, label: "Autre" },
];
const STATUT_OPTS = ETALON_STATUTS.map((s) => ({ value: s, label: s.replace("_", " ") }));
const SITE_OPTS = SITES.map((s) => ({ value: s.code, label: s.code }));
const RN_OPTS = RADIONUCLIDES.map((r) => ({ value: r, label: r }));

function blank(): Etalon {
  return {
    id: crypto.randomUUID(),
    type: "source",
    designation: "",
    statut: "en_service",
    caracteristiques: {},
    raccordement_cofrac: false,
    updated_at: new Date().toISOString(),
    deleted: false,
  };
}

export function EtalonDetail() {
  const { id } = useParams();
  const isNew = id === "new";
  const nav = useNavigate();
  const { isReferent } = useAuth();
  const ro = !isReferent;

  const [form, setForm] = useState<Etalon | null>(isNew ? blank() : null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (isNew) return;
    db.etalons
      .get(id!)
      .then((row) =>
        setForm(row ? { ...row, caracteristiques: row.caracteristiques || {} } : blank())
      );
  }, [id, isNew]);

  if (!form) return <div className="splash">…</div>;

  const set = (patch: Partial<Etalon>) => setForm({ ...form, ...patch });
  const setCar = (patch: Record<string, unknown>) =>
    setForm({ ...form, caracteristiques: { ...form.caracteristiques, ...patch } });

  const car = form.caracteristiques;
  const act =
    form.type === "source"
      ? currentActivity(car.activite_ref, car.date_ref, car.radionucleide)
      : null;

  async function save() {
    if (!form!.designation.trim()) return;
    setBusy(true);
    await localUpsert(db.etalons, form!);
    syncAll().catch(console.error);
    nav("/ecme");
  }
  async function remove() {
    if (!confirm("Supprimer cet étalon ?")) return;
    setBusy(true);
    await localSoftDelete(db.etalons, form!.id);
    syncAll().catch(console.error);
    nav("/ecme");
  }

  return (
    <div>
      <Link to="/ecme" className="back">
        ← Étalons
      </Link>
      <div className="page-head">
        <h2>{isNew ? "Nouvel étalon" : form.designation || "Étalon"}</h2>
      </div>

      {ro && (
        <div className="readonly-note">
          Lecture seule — seuls les référents peuvent modifier les étalons.
        </div>
      )}

      <label className="field">
        <span>Type</span>
        {ro ? (
          <input readOnly value={form.type} />
        ) : (
          <Chips
            options={TYPE_OPTS}
            value={form.type}
            onChange={(v) => set({ type: (v ?? "autre") as EtalonType })}
          />
        )}
      </label>

      <label className="field">
        <span>Désignation</span>
        <input
          readOnly={ro}
          value={form.designation}
          onChange={(e) => set({ designation: e.target.value })}
        />
      </label>

      <div className="grid2">
        <label className="field">
          <span>Marque</span>
          <input readOnly={ro} value={form.marque ?? ""} onChange={(e) => set({ marque: e.target.value })} />
        </label>
        <label className="field">
          <span>Modèle</span>
          <input readOnly={ro} value={form.modele ?? ""} onChange={(e) => set({ modele: e.target.value })} />
        </label>
      </div>

      <div className="grid2">
        <label className="field">
          <span>N° série</span>
          <input readOnly={ro} value={form.num_serie ?? ""} onChange={(e) => set({ num_serie: e.target.value })} />
        </label>
        <label className="field">
          <span>Identifiant interne</span>
          <input readOnly={ro} value={form.identifiant ?? ""} onChange={(e) => set({ identifiant: e.target.value })} />
        </label>
      </div>

      <label className="field">
        <span>Statut</span>
        {ro ? (
          <input readOnly value={form.statut} />
        ) : (
          <Chips
            options={STATUT_OPTS}
            value={form.statut}
            onChange={(v) => set({ statut: (v ?? "en_service") as EtalonStatut })}
          />
        )}
      </label>

      <label className="field">
        <span>Site</span>
        {ro ? (
          <input readOnly value={form.site ?? ""} />
        ) : (
          <Chips options={SITE_OPTS} value={form.site ?? null} onChange={(v) => set({ site: v })} />
        )}
      </label>

      {form.type === "source" && (
        <>
          <label className="field">
            <span>Radionucléide</span>
            {ro ? (
              <input readOnly value={car.radionucleide ?? ""} />
            ) : (
              <Chips
                options={RN_OPTS}
                value={car.radionucleide ?? null}
                onChange={(v) => setCar({ radionucleide: v })}
              />
            )}
          </label>
          <div className="grid2">
            <label className="field">
              <span>Activité réf. (Bq)</span>
              <input
                readOnly={ro}
                type="number"
                value={car.activite_ref ?? ""}
                onChange={(e) =>
                  setCar({ activite_ref: e.target.value === "" ? undefined : Number(e.target.value) })
                }
              />
            </label>
            <label className="field">
              <span>Date de réf.</span>
              <input
                readOnly={ro}
                type="date"
                value={car.date_ref ?? ""}
                onChange={(e) => setCar({ date_ref: e.target.value })}
              />
            </label>
          </div>
          {act != null && (
            <label className="field">
              <span>Activité du jour (décroissance)</span>
              <input readOnly className="mono" value={formatActivity(act)} />
            </label>
          )}
        </>
      )}

      {form.type === "debitmetre" && (
        <div className="grid2">
          <label className="field">
            <span>Gamme</span>
            <input readOnly={ro} value={car.gamme ?? ""} onChange={(e) => setCar({ gamme: e.target.value })} />
          </label>
          <label className="field">
            <span>Unité</span>
            <input readOnly={ro} value={car.unite ?? ""} onChange={(e) => setCar({ unite: e.target.value })} />
          </label>
        </div>
      )}

      <div className="grid2">
        <label className="field">
          <span>Date étalonnage</span>
          <input
            readOnly={ro}
            type="date"
            value={form.date_etalonnage ?? ""}
            onChange={(e) => set({ date_etalonnage: e.target.value })}
          />
        </label>
        <label className="field">
          <span>Échéance</span>
          <input
            readOnly={ro}
            type="date"
            value={form.date_echeance ?? ""}
            onChange={(e) => set({ date_echeance: e.target.value })}
          />
        </label>
      </div>

      <label className="field">
        <span>Certificat (réf.)</span>
        <input
          readOnly={ro}
          value={form.certificat_ref ?? ""}
          onChange={(e) => set({ certificat_ref: e.target.value })}
        />
      </label>

      {!ro && (
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
      )}
    </div>
  );
}
