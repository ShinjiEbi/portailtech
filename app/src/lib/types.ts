// ---- Modèles d'étalon (paramétrables) -------------------------------------
export type ChampType =
  | "texte"
  | "nombre"
  | "date"
  | "liste"
  | "booleen"
  | "radionucleide"
  | "activite_ref"
  | "date_ref"
  | "flux";

export const CHAMP_TYPES: { value: ChampType; label: string }[] = [
  { value: "texte", label: "Texte" },
  { value: "nombre", label: "Nombre" },
  { value: "date", label: "Date" },
  { value: "liste", label: "Liste de choix" },
  { value: "booleen", label: "Oui / Non" },
  { value: "radionucleide", label: "Radionucléide" },
  { value: "activite_ref", label: "Activité réf. (kBq)" },
  { value: "date_ref", label: "Date de réf." },
  { value: "flux", label: "Flux (pps, décroît)" },
];

export interface ChampDef {
  cle: string;
  libelle: string;
  type: ChampType;
  options?: string[]; // pour le type "liste"
  requis?: boolean;
}

export interface EtalonModele {
  id: string;
  nom: string;
  ordre: number;
  champs: ChampDef[];
  updated_at: string;
  deleted: boolean;
}

// ---- Étalons --------------------------------------------------------------
export const ETALON_STATUTS = ["en_service", "etalonnage", "hs", "reforme"] as const;
export type EtalonStatut = (typeof ETALON_STATUTS)[number];

export interface ChampLibre {
  libelle: string;
  valeur: string;
}

export interface Etalon {
  id: string;
  modele_id: string | null;
  modele_nom: string; // dénormalisé pour filtrer/afficher hors-ligne
  designation: string;
  num_serie?: string | null;   // n° constructeur (sert de nom de l'étalon)
  num_client?: string | null;  // n° client (affiché sous le nom)
  statut: EtalonStatut;
  date_etalonnage?: string | null;
  date_echeance?: string | null;
  certificat_ref?: string | null;
  certificat_path?: string | null;  // chemin du fichier dans Supabase Storage
  certificat_nom?: string | null;   // nom d'origine du fichier (affichage)
  valeurs: Record<string, unknown>; // valeurs des champs du modèle (clé = ChampDef.cle)
  champs_libres: ChampLibre[];       // champs ajoutés à la main ("Manuel")
  epingle?: boolean;                 // épinglé en haut de la liste ECME
  updated_at: string;
  deleted: boolean;
}

// ---- Journal (log d'activité) ---------------------------------------------
export const JOURNAL_TYPES = ["ajout", "modification", "suppression", "erreur", "info"] as const;
export type JournalType = (typeof JOURNAL_TYPES)[number];

export interface JournalEntry {
  id: string;
  user_id: string;
  ts: string;
  type: JournalType;
  message: string;
  etalon_id?: string | null;
  updated_at: string;
  deleted: boolean;
}

export interface Profile {
  id: string;
  nom?: string | null;
  role: "tech" | "referent" | "admin";
  updated_at: string;
}

// Marqueur local : ligne modifiée hors-ligne en attente de push (0/1)
export type Local<T> = T & { _dirty?: 0 | 1 };

// Cache local d'un fichier (certificat) pour la consultation hors-ligne
export interface Fichier {
  path: string; // = chemin Storage, sert de clé primaire
  blob: Blob;
  nom: string;
  type: string;
  updated_at: string;
}

// ===========================================================================
// Planning mensuel (saisie quotidienne : heures, dose, frais, trajet)
// Données PERSO, isolées par utilisateur (RLS). Une ligne = un jour.
// ===========================================================================
export const PLANNING_TYPES = [
  "Travaillé", "Déplacement", "RTT", "Congé payé", "Férié", "Récup", "Maladie",
] as const;
export type PlanningType = (typeof PLANNING_TYPES)[number];

// Types comptés comme « journée travaillée » (heures / site / contrat actifs).
export const PLANNING_TRAVAIL: PlanningType[] = ["Travaillé", "Déplacement"];

// Contrats : [nom, clé courte, libellé court].
export const PLANNING_CONTRATS: [string, string, string][] = [
  ["RPM", "RPM", "RPM"],
  ["KZC", "KZC", "KZC"],
  ["KRS", "KRS", "KRS"],
  ["Assistance hebdo", "ASS", "Assist."],
  ["Autre", "AUT", "Autre"],
];

// Couleur par contrat — sert de liseré (bordure) sur les cases du planning.
export const PLANNING_CONTRAT_COLORS: Record<string, string> = {
  "RPM": "#3bd17a",
  "KZC": "#4aa3ff",
  "KRS": "#f0a93d",
  "Assistance hebdo": "#c77dff",
  "Autre": "#9aa7b0",
};

// Sites (18 CNPE + 8 DP2D + divers) — aligné sur le champ « Client » du schéma.
export const PLANNING_SITES: string[] = [
  "CNPE Belleville", "CNPE Blayais", "CNPE Bugey", "CNPE Cattenom", "CNPE Chinon",
  "CNPE Chooz", "CNPE Civaux", "CNPE Cruas", "CNPE Dampierre", "CNPE Flamanville",
  "CNPE Golfech", "CNPE Gravelines", "CNPE Nogent", "CNPE Paluel", "CNPE Penly",
  "CNPE Saint-Alban", "CNPE Saint-Laurent", "CNPE Tricastin",
  "DP2D Brennilis", "DP2D Bugey 1", "DP2D Chinon A", "DP2D Chooz A",
  "DP2D Creys-Malville", "DP2D Fessenheim", "DP2D Phénix", "DP2D Saint-Laurent A",
  "Bertin / Aix", "Télétravail", "Autre",
];

export const PLANNING_FRAIS_CATS = [
  "Repas", "Péage", "Hôtel", "Carburant", "Parking", "Autre",
] as const;

// Une note de frais. La photo est stockée dans Supabase Storage (bucket
// « frais »), comme les certificats ECME -> la ligne reste légère.
export interface FraisItem {
  id: string;
  cat: string;
  montant: number;
  photo_path?: string | null; // chemin Storage
  photo_nom?: string | null;  // nom d'origine (affichage)
}

export interface PlanningJour {
  id: string;
  user_id: string;
  date: string;                // 'YYYY-MM-DD' (unique par utilisateur)
  type: PlanningType;
  debut?: string | null;       // 'HH:MM'
  fin?: string | null;
  pause?: number | null;       // minutes
  total?: number | null;       // heures décimales (auto)
  h_norm?: number | null;      // heures normales (<= horaire contractuel)
  h_supp?: number | null;      // heures supplémentaires
  site?: string | null;
  contrat?: string | null;
  imputation?: string | null;  // code d'affaire (auto : params.codes[contrat])
  dose?: number | null;        // µSv du jour
  trajet: boolean;             // heures de trajet saisies ?
  t_ad?: string | null;        // trajet aller départ
  t_af?: string | null;        // trajet aller arrivée
  t_rd?: string | null;        // trajet retour départ
  t_rf?: string | null;        // trajet retour arrivée
  frais: FraisItem[];
  commentaire?: string | null;
  updated_at: string;
  deleted: boolean;
}

// Paramètres du planning : un seul jeu par utilisateur (id = user_id).
export interface PlanningParams {
  id: string;                  // = user_id
  horaire: number;             // heures contractuelles / jour (ex. 7.5)
  matricule?: string | null;
  dosi?: string | null;        // n° dosimètre
  nom?: string | null;
  prenom?: string | null;
  sup?: string | null;         // responsable hiérarchique
  trigramme?: string | null;   // trigramme exécutant (préremplit les lignes d'intervention)
  codes: Record<string, string>;                 // contrat -> code d'imputation
  trajet_defaut?: { ad: string; af: string; rd: string; rf: string } | null;
  sites_favoris: string[];                        // filtre de la liste site/lieu (saisie)
  updated_at: string;
  deleted: boolean;
}

// Cache local d'une photo de note de frais (Blob). pending = pas encore
// uploadée vers Storage (capture hors-ligne) -> repoussée à la prochaine sync.
export interface FraisPhoto {
  path: string;            // = chemin Storage (bucket "frais"), clé primaire
  blob: Blob;
  nom: string;
  type: string;
  pending: 0 | 1;
  updated_at: string;
}

// ---- Imputations (référence partagée, importée depuis l'Excel Bertin) ------
// Une imputation = un n° d'affaire (num_projet) croisé avec un code tâche.
export interface Imputation {
  id: string;
  client: string | null;
  nom_projet: string | null;
  num_projet: string | null;   // n° d'affaire (ex. "25760")
  tache: string;               // code tâche (ex. "11.01")
  nom_tache: string | null;    // libellé (ex. "RPM Bugey")
  commentaires: string | null;
  site: boolean;               // pointable "sur site"
  usine: boolean;              // pointable "en usine"
  annee: number | null;
  couleur?: string | null;     // liseré de la case (1 couleur par pointage, fixée à l'import)
  updated_at: string;
  deleted: boolean;
}

// ---- Base matériels (équipements vérifiés) --------------------------------
export const MATERIEL_ETATS = ["en_place", "magasin", "devis", "reparation", "reforme"] as const;
export type MaterielEtat = (typeof MATERIEL_ETATS)[number];
export const MATERIEL_ETAT_LABEL: Record<MaterielEtat, string> = {
  en_place: "En place", magasin: "Magasin", devis: "Devis", reparation: "Réparation", reforme: "Réforme",
};

export type MaterielIdType = "gmo2" | "repere";

export interface Materiel {
  scan: string;                 // code GMO² ou repère fonctionnel (clé unique)
  id_type: MaterielIdType;
  type_code: string | null;     // 1re partie du GMO² (null si repère)
  id_court: string;             // BUG070 (GMO²) ou le repère (RF) — n° étiquette/CV
  designation: string | null;
  code_model: string | null;
  sn: string | null;
  domaine: string | null;       // RPM / KZC / KRS…
  site: string | null;          // déduit du préfixe de l'id court
  localisation: string | null;  // dans le site (manuel)
  etat: MaterielEtat;
  updated_at: string;
  deleted: boolean;
}

export interface CorimType {
  type_code: string;            // SCAN de la feuille « correspondance CORIM »
  designation: string | null;   // libellé Corim
  type_appareil: string | null;
  updated_at: string;
  deleted: boolean;
}

// ---- Favoris ECME (épinglage par utilisateur, synchronisé) ----------------
export interface EcmeFavori {
  etalon_id: string;
  user_id: string;
  updated_at: string;
  deleted: boolean;
}

// ---- Module Calcul (formules) ---------------------------------------------
export type CalculScope = "partage" | "perso";
export type ComposanteType = "variable" | "constante" | "source" | "serie" | "mesure";
export type ComposanteValeur = "nombre" | "date";

export interface SourceValeur {
  nom: string;                   // symbole utilisé dans les expressions
  source_champ: string | null;   // champ lu sur la source (libellé OU clé calculée @act_jour…)
  unite?: string;
}

export interface Composante {
  id: string;                    // identifiant local (clés React)
  nom: string;                   // symbole (variable/constante) OU étiquette de la source
  type: ComposanteType;
  libelle?: string;
  unite?: string;
  valeur_type?: ComposanteValeur; // variable & constante : nombre | date
  valeur?: number | null;         // constante (nombre)
  valeur_date?: string | null;    // constante (date YYYY-MM-DD)
  source_champ?: string | null;   // composante source (ancien format mono-valeur)
  source_filtres?: SourceFiltres; // composante source : filtre de catégorie (radionucléide / type EDF / rayonnement)
  source_valeurs?: SourceValeur[]; // composante source : plusieurs valeurs (symbole + champ) lues sur la même source
  unite_famille?: string | null;   // composante mesure : famille d'unités (clé) pour la conversion
}

export interface TolBound {
  base: "constante" | "variable" | "source";
  valeur?: number | null;       // base = constante
  variable?: string | null;     // base = variable (symbole d'une composante)
  source?: string | null;       // base = source (symbole d'une composante source)
  pourcentage?: number | null;  // pourcentage appliqué à la base (défaut 100)
}

export interface Formule {
  id: string;
  nom: string;                   // symbole résultat, réutilisable dans les formules suivantes
  expression: string;
  unite?: string;
  // tolérance optionnelle sur le résultat : borne min et/ou max (présence = active)
  tol_min?: TolBound | null;
  tol_max?: TolBound | null;
}

export interface SourceFiltres { radionucleides: string[]; types: string[]; rayonnements: string[]; }

export interface Calcul {
  id: string;
  nom: string;
  scope: CalculScope;
  user_id: string | null;
  type_source: string | null;
  composantes: Composante[];
  formules: Formule[];
  updated_at: string;
  deleted: boolean;
}

// ---- Module Intervention (listings de contrôles + impression étiquettes) ----
// Un « listing » = un rapport d'intervention (campagne de contrôles), partagé ou
// perso (même mécanique que les Calculs). Chaque ligne = un contrôle sur un
// équipement (lookup GMO² -> matériels), avec validité/échéance calculées.
export type InterventionScope = "partage" | "perso";

export interface InterventionListing {
  id: string;
  nom: string;
  scope: InterventionScope;
  user_id: string | null;
  updated_at: string;
  deleted: boolean;
}

// ---- Module RTR (Régimes de Travail Radiologique) -------------------------
// Bibliothèque de régimes de travail radiologique. Chaque régime porte un code
// (code-barres) présenté pour entrer en zone contrôlée. Données partagées ou
// perso (même mécanique que Calculs / Interventions).
export type RtrScope = "partage" | "perso";

export interface RegimeTravail {
  id: string;
  nom: string;
  site: string | null;
  date_validite: string | null;   // 'YYYY-MM-DD' — peut être vide (pas d'échéance)
  code: string;                    // code-barres d'accès en zone contrôlée
  scope: RtrScope;
  user_id: string | null;
  updated_at: string;
  deleted: boolean;
}

export const INTERV_TYPES_CONTROLE = ["Préventif", "Correctif"] as const;
export type TypeControle = (typeof INTERV_TYPES_CONTROLE)[number];

export const INTERV_OPERATIONS = ["VP cas 1", "VP cas 2", "MP cas 1"] as const;
export type OperationControle = (typeof INTERV_OPERATIONS)[number];

export const INTERV_CONFORMITES = ["Conforme", "Conforme après intervention", "Non conforme"] as const;
export type Conformite = (typeof INTERV_CONFORMITES)[number];

// Validité (années) déduite de l'opération réalisée : VP* -> 1 an, MP* -> 3 ans.
export const VALIDITE_ANS: Record<OperationControle, number> = {
  "VP cas 1": 1,
  "VP cas 2": 1,
  "MP cas 1": 3,
};

// Conformités qui émettent une échéance (Non conforme -> aucune échéance).
export const CONFORMITE_AVEC_ECHEANCE: Conformite[] = ["Conforme", "Conforme après intervention"];

export interface InterventionLigne {
  id: string;
  listing_id: string;
  // snapshot de l'équipement au moment du scan (lien souple via `scan`)
  scan: string;                 // GMO² complet (clé de `materiels`) ou repère
  id_court: string;             // ex. BUG070 — code imprimé sur l'étiquette
  designation: string | null;
  sn: string | null;
  // contrôle
  type_controle: TypeControle;
  operation: OperationControle;
  conformite: Conformite;
  date_op: string;              // 'YYYY-MM-DD'
  validite_ans: number | null;  // déduit de l'opération (modifiable)
  echeance: string | null;      // 'YYYY-MM-DD' (= date_op + validite, si conforme)
  echeance_manuelle: boolean;   // true = échéance saisie à la main, ne pas recalculer
  commentaire: string | null;
  tri_exec: string | null;      // trigramme exécutant (préremplissable depuis le profil)
  tri_ct: string | null;        // trigramme contrôleur technique
  ordre: number;                // ordre d'affichage dans le listing
  user_id: string | null;
  updated_at: string;
  deleted: boolean;
}
