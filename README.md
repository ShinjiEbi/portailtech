# Portail-tech

Suite d'outils radioprotection terrain, **offline-first**, partagée entre techniciens.
Stack : **Vite + React + TypeScript + Supabase + PWA**, IndexedDB local (Dexie) comme
source de vérité de l'interface, Supabase comme base commune synchronisée.

## Organisation du dépôt

Ce dépôt contient **à la fois le code source et le site compilé** (déployé tel quel
sur GitHub Pages, qui sert la racine du dépôt).

```
portailtech/
├── app/                     ← CODE SOURCE (projet Vite complet, à modifier ici)
│   ├── index.html           ← gabarit (entrée Vite)
│   ├── src/                 ← modules React + lib (Dexie, sync, …)
│   ├── public/              ← icônes, templates Excel, planning-legacy.html
│   ├── supabase/schema.sql  ← schéma + RLS Postgres
│   ├── package.json, vite.config.ts, tsconfig.json
│   └── .env.example
│
├── index.html, assets/, sw.js, workbox-*.js, manifest.webmanifest, …
│                            ← SITE COMPILÉ (sortie du build, servi par GitHub Pages)
├── supabase/schema.sql      ← copie de référence du schéma (à exécuter dans Supabase)
└── planning.html            ← ancien prototype autonome (indépendant de l'appli)
```

> ⚠️ **On modifie le code dans `app/`**, jamais les fichiers compilés à la racine
> (`assets/`, `index.html`, `sw.js`, …) qui sont régénérés par le build.

## Développer / construire

```bash
cd app
cp .env.example .env      # renseigne VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY
npm install
npm run dev               # développement local
```

Build de production (base GitHub Pages `/portailtech/`) :

```bash
cd app
VITE_BASE=/portailtech/ npm run build   # -> app/dist/
```

## Déployer

GitHub Pages sert la **racine** du dépôt. Pour publier une nouvelle version, on copie
la sortie du build (`app/dist/`) à la racine :

```bash
cd app && VITE_BASE=/portailtech/ npm run build
cp -r dist/* ..            # écrase index.html, assets/, sw.js, … à la racine
```

(`app/dist/index.html` sert aussi de `404.html` pour le routage SPA.)

## Backend Supabase

1. Créer un projet Supabase (gratuit).
2. **SQL Editor** : coller le contenu de `supabase/schema.sql` et exécuter. Le script est
   **idempotent** (relançable) : il crée/ajuste les tables, index, triggers et **RLS**.
   À relancer après toute évolution du schéma (nouvelles tables/colonnes).
3. **Authentication > Users** : créer un compte par technicien.

La clé **anon** est publique par design : toute la sécurité passe par les **RLS**.
Ne jamais mettre la clé `service_role` dans le front.

---

## Module RTR — Régimes de travail radiologique

Bibliothèque des **régimes de travail radiologique**. Chaque régime porte :

- un **nom** ;
- un **site** (liste CNPE / DP2D) ;
- une **date de validité** *optionnelle* (vide = pas d'échéance ; une date dépassée est
  signalée « Périmé ») ;
- un **code** correspondant au **code-barres** présenté au lecteur pour entrer en
  **zone contrôlée**. Le code est affiché à l'écran sous forme de code-barres scannable
  (**Code 128 B**, généré côté client, sans dépendance externe).

Chaque régime est **perso** (visible du seul créateur, isolé par RLS) ou **partagé**
(visible et modifiable par toute l'équipe) — même mécanique que les modules Calcul et
Intervention.

On accède à la bibliothèque via le bouton **☢** dans l'en-tête, **à gauche du bouton de
synchronisation**.

### Fichiers concernés

- `app/src/lib/types.ts` — type `RegimeTravail` / `RtrScope`.
- `app/src/lib/db.ts` — table Dexie `rtr` (version 11).
- `app/src/lib/rtr.ts` — CRUD local + synchro.
- `app/src/lib/barcode.ts` — encodeur Code 128 B (SVG).
- `app/src/modules/rtr/RtrView.tsx` — écran liste + formulaire + code-barres.
- `app/src/lib/sync.ts` — push/pull de la table `rtr`.
- `app/src/components/Layout.tsx` — bouton d'accès dans l'en-tête.
- `app/src/App.tsx` — route `/rtr`.
- `supabase/schema.sql` — table `public.rtr` + RLS (à ré-exécuter dans Supabase).

> **Important :** après déploiement, exécuter le `schema.sql` à jour dans Supabase pour
> créer la table `rtr`. Tant qu'elle n'existe pas, l'appli fonctionne (les régimes
> restent stockés en local) mais ne se synchronise pas.

## Comment ça marche (offline-first)

- L'UI lit et écrit **uniquement dans IndexedDB** (Dexie) : instantané, hors-ligne.
- `app/src/lib/sync.ts` réconcilie avec Supabase dès qu'il y a du réseau + une session :
  **push** des lignes `_dirty`, **pull** incrémental par curseur `updated_at`.
- Suppression = **soft-delete** (`deleted = true`). Conflits : dernier qui écrit gagne.
- La barre en haut indique l'état réseau, la dernière synchro et le nombre de
  modifications en attente ; un tap force la synchro.
