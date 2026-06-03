// Sites CNPE (codes EDF) + divers. Ajouter ici au besoin.
export const SITES = [
  { code: "KRS", label: "Bugey" },
  { code: "KRT", label: "Tricastin" },
  { code: "RP", label: "St-Alban" },
  { code: "KZC", label: "Creys-Malville" },
  { code: "AUTRE", label: "Autre" },
] as const;

export const ETALON_TYPES = ["source", "debitmetre", "autre"] as const;
export type EtalonType = (typeof ETALON_TYPES)[number];

export const ETALON_STATUTS = ["en_service", "etalonnage", "hs", "reforme"] as const;
export type EtalonStatut = (typeof ETALON_STATUTS)[number];

// Caractristiques spcifiques selon le type (stockes en JSONB ct Supabase)
export interface SourceCaract {
  radionucleide?: string; // ex "Cs-137"
  activite_ref?: number;  // en Bq  la date de rfrence
  date_ref?: string;      // ISO date
}
export interface DebitmetreCaract {
  gamme?: string;
  unite?: string;
  coefficient?: number;
}
export type Caracteristiques = SourceCaract & DebitmetreCaract & Record<string, unknown>;

export interface Etalon {
  id: string;
  type: EtalonType;
  designation: string;
  marque?: string | null;
  modele?: string | null;
  num_serie?: string | null;
  identifiant?: string | null;
  date_etalonnage?: string | null; // ISO date
  date_echeance?: string | null;   // ISO date
  certificat_ref?: string | null;
  certificat_url?: string | null;
  raccordement_cofrac?: boolean;
  site?: string | null;
  localisation?: string | null;
  statut: EtalonStatut;
  caracteristiques: Caracteristiques;
  updated_at: string;
  deleted: boolean;
}

export interface Imputation {
  id: string;
  user_id: string;
  date: string;        // ISO date
  site?: string | null;
  code_affaire?: string | null;
  heures?: number | null;
  activite?: string | null;
  commentaire?: string | null;
  updated_at: string;
  deleted: boolean;
}

export interface JournalEntry {
  id: string;
  user_id: string;
  ts: string;          // ISO datetime
  type?: string | null;
  site?: string | null;
  contenu?: string | null;
  etalon_id?: string | null;
  updated_at: string;
  deleted: boolean;
}

export interface Profile {
  id: string;
  nom?: string | null;
  site?: string | null;
  role: "tech" | "referent" | "admin";
  updated_at: string;
}

// Marqueur local : ligne modifie hors-ligne en attente de push (0/1)
export type Local<T> = T & { _dirty?: 0 | 1 };
