import Dexie, { type Table } from "dexie";
import type {
  Etalon, EtalonModele, JournalEntry, Fichier, Local, PlanningJour, PlanningParams, FraisPhoto, Imputation, Materiel, CorimType, EcmeFavori, Calcul,
  InterventionListing, InterventionLigne, RegimeTravail,
} from "./types";

// IndexedDB locale : source de vérité de l'UI (lecture/écriture instantanées,
// hors-ligne). sync.ts réconcilie avec Supabase quand le réseau est là.
class PortailDB extends Dexie {
  etalons!: Table<Local<Etalon>, string>;
  modeles!: Table<Local<EtalonModele>, string>;
  journal!: Table<Local<JournalEntry>, string>;
  fichiers!: Table<Fichier, string>; // cache local des certificats (Blob)
  planning!: Table<Local<PlanningJour>, string>;
  planning_params!: Table<Local<PlanningParams>, string>;
  frais_photos!: Table<FraisPhoto, string>; // cache local des photos de frais (Blob)
  imputations!: Table<Local<Imputation>, string>; // référence partagée (pull-only)
  materiels!: Table<Local<Materiel>, string>;       // base matériels (pull-only)
  corim_types!: Table<Local<CorimType>, string>;    // correspondance Corim (pull-only)
  ecme_favoris!: Table<Local<EcmeFavori>, string>;  // favoris ECME, par utilisateur
  calculs!: Table<Local<Calcul>, string>;           // module Calcul (partagé ou perso)
  intervention_listings!: Table<Local<InterventionListing>, string>; // listings de contrôles
  intervention_lignes!: Table<Local<InterventionLigne>, string>;     // lignes d'un listing
  rtr!: Table<Local<RegimeTravail>, string>;         // régimes de travail radiologique
  meta!: Table<{ key: string; value: string }, string>;

  constructor() {
    super("portail-tech");
    this.version(2).stores({
      etalons: "id, modele_id, modele_nom, statut, _dirty, updated_at",
      modeles: "id, nom, ordre, _dirty, updated_at",
      journal: "id, ts, type, _dirty, updated_at",
      meta: "key",
    });
    // v3 : ajout du cache de fichiers (certificats) pour l'offline
    this.version(3).stores({
      etalons: "id, modele_id, modele_nom, statut, _dirty, updated_at",
      modeles: "id, nom, ordre, _dirty, updated_at",
      journal: "id, ts, type, _dirty, updated_at",
      fichiers: "path",
      meta: "key",
    });
    // v4 : module Planning (saisie quotidienne + paramètres, par utilisateur)
    this.version(4).stores({
      etalons: "id, modele_id, modele_nom, statut, _dirty, updated_at",
      modeles: "id, nom, ordre, _dirty, updated_at",
      journal: "id, ts, type, _dirty, updated_at",
      fichiers: "path",
      planning: "id, user_id, date, _dirty, updated_at",
      planning_params: "id, _dirty, updated_at",
      meta: "key",
    });
    // v5 : cache local des photos de notes de frais (offline + upload différé)
    this.version(5).stores({
      etalons: "id, modele_id, modele_nom, statut, _dirty, updated_at",
      modeles: "id, nom, ordre, _dirty, updated_at",
      journal: "id, ts, type, _dirty, updated_at",
      fichiers: "path",
      planning: "id, user_id, date, _dirty, updated_at",
      planning_params: "id, _dirty, updated_at",
      frais_photos: "path, pending",
      meta: "key",
    });
    // v6 : table des imputations (référence partagée, importée depuis l'Excel)
    // v7 : base matériels + correspondance Corim (référence partagée, import Excel)
    this.version(7).stores({
      etalons: "id, modele_id, modele_nom, statut, _dirty, updated_at",
      modeles: "id, nom, ordre, _dirty, updated_at",
      journal: "id, ts, type, _dirty, updated_at",
      fichiers: "path",
      planning: "id, user_id, date, _dirty, updated_at",
      planning_params: "id, _dirty, updated_at",
      frais_photos: "path, pending",
      imputations: "id, num_projet, tache, _dirty, updated_at",
      materiels: "scan, id_type, domaine, site, type_code, _dirty, updated_at",
      corim_types: "type_code, _dirty, updated_at",
      meta: "key",
    });
    // v8 : favoris ECME (épinglage par utilisateur, synchronisé)
    this.version(8).stores({
      etalons: "id, modele_id, modele_nom, statut, _dirty, updated_at",
      modeles: "id, nom, ordre, _dirty, updated_at",
      journal: "id, ts, type, _dirty, updated_at",
      fichiers: "path",
      planning: "id, user_id, date, _dirty, updated_at",
      planning_params: "id, _dirty, updated_at",
      frais_photos: "path, pending",
      imputations: "id, num_projet, tache, _dirty, updated_at",
      materiels: "scan, id_type, domaine, site, type_code, _dirty, updated_at",
      corim_types: "type_code, _dirty, updated_at",
      ecme_favoris: "etalon_id, _dirty, updated_at",
      meta: "key",
    });
    // v9 : module Calcul (formules)
    this.version(9).stores({
      etalons: "id, modele_id, modele_nom, statut, _dirty, updated_at",
      modeles: "id, nom, ordre, _dirty, updated_at",
      journal: "id, ts, type, _dirty, updated_at",
      fichiers: "path",
      planning: "id, user_id, date, _dirty, updated_at",
      planning_params: "id, _dirty, updated_at",
      frais_photos: "path, pending",
      imputations: "id, num_projet, tache, _dirty, updated_at",
      materiels: "scan, id_type, domaine, site, type_code, _dirty, updated_at",
      corim_types: "type_code, _dirty, updated_at",
      ecme_favoris: "etalon_id, _dirty, updated_at",
      calculs: "id, scope, user_id, _dirty, updated_at",
      meta: "key",
    });
    // v10 : module Intervention (listings de contrôles + lignes, partagés ou perso)
    this.version(10).stores({
      etalons: "id, modele_id, modele_nom, statut, _dirty, updated_at",
      modeles: "id, nom, ordre, _dirty, updated_at",
      journal: "id, ts, type, _dirty, updated_at",
      fichiers: "path",
      planning: "id, user_id, date, _dirty, updated_at",
      planning_params: "id, _dirty, updated_at",
      frais_photos: "path, pending",
      imputations: "id, num_projet, tache, _dirty, updated_at",
      materiels: "scan, id_type, domaine, site, type_code, _dirty, updated_at",
      corim_types: "type_code, _dirty, updated_at",
      ecme_favoris: "etalon_id, _dirty, updated_at",
      calculs: "id, scope, user_id, _dirty, updated_at",
      intervention_listings: "id, scope, user_id, _dirty, updated_at",
      intervention_lignes: "id, listing_id, scan, _dirty, updated_at",
      meta: "key",
    });
    // v11 : bibliothèque RTR (régimes de travail radiologique, partagés ou perso)
    this.version(11).stores({
      etalons: "id, modele_id, modele_nom, statut, _dirty, updated_at",
      modeles: "id, nom, ordre, _dirty, updated_at",
      journal: "id, ts, type, _dirty, updated_at",
      fichiers: "path",
      planning: "id, user_id, date, _dirty, updated_at",
      planning_params: "id, _dirty, updated_at",
      frais_photos: "path, pending",
      imputations: "id, num_projet, tache, _dirty, updated_at",
      materiels: "scan, id_type, domaine, site, type_code, _dirty, updated_at",
      corim_types: "type_code, _dirty, updated_at",
      ecme_favoris: "etalon_id, _dirty, updated_at",
      calculs: "id, scope, user_id, _dirty, updated_at",
      intervention_listings: "id, scope, user_id, _dirty, updated_at",
      intervention_lignes: "id, listing_id, scan, _dirty, updated_at",
      rtr: "id, scope, user_id, code, _dirty, updated_at",
      meta: "key",
    });
    this.version(6).stores({
      etalons: "id, modele_id, modele_nom, statut, _dirty, updated_at",
      modeles: "id, nom, ordre, _dirty, updated_at",
      journal: "id, ts, type, _dirty, updated_at",
      fichiers: "path",
      planning: "id, user_id, date, _dirty, updated_at",
      planning_params: "id, _dirty, updated_at",
      frais_photos: "path, pending",
      imputations: "id, num_projet, tache, _dirty, updated_at",
      meta: "key",
    });
  }
}

export const db = new PortailDB();

export async function metaGet(key: string): Promise<string | null> {
  const row = await db.meta.get(key);
  return row?.value ?? null;
}
export async function metaSet(key: string, value: string): Promise<void> {
  await db.meta.put({ key, value });
}
