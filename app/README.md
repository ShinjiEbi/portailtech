# Portail-tech V2

Suite d'outils radioprotection terrain, **offline-first**, partage entre techniciens.
Stack : **Vite + React + TypeScript + Supabase + PWA**, IndexedDB local (Dexie) comme
source de vrit de l'interface, Supabase comme base commune synchronise.

## Les 3 modules

- **ECME / talons** : base commune des talons, partage par l'quipe. Chaque talon
  suit un **modle** (Source, Dbitmtre, Multimdia, Manuel) qui dtermine ses champs.
  Ajout / modification / suppression ouverts  tout utilisateur connect. Pour les sources,
  **l'activit du jour est calcule par dcroissance et mise en vidence**
  (A = A0e^(-ln2t/T)). Un talon peut aussi recevoir des champs libres (mode Manuel).
  Chaque talon peut porter un **certificat** (PDF / image) stock dans Supabase Storage
  et mis en cache local pour rester **consultable hors-ligne** (l'envoi, lui, ncessite
  le rseau). Le bucket "certificats" est cr automatiquement par `schema.sql`.
- **Journal** : **log d'activit partag**. Les ajouts / modifs / suppressions d'talons
  et de modles y sont enregistrs automatiquement ; on peut aussi ajouter une entre
  manuelle (erreur, info).
- **Paramtrage** : gestion des **modles paramtrables**. Chaque modle = un nom + une
  liste de champs (libell, type texte/nombre/date/liste/oui-non/radionuclide/activit/date
  de rf., obligatoire ou non). Partags entre tous, synchroniss.

---

## 1. Prrequis

- Node.js 18+ et npm
- Un projet Supabase (gratuit) : https://supabase.com

## 2. Crer le backend Supabase

1. Cre un projet sur Supabase.
2. Ouvre **SQL Editor**, colle le contenu de `supabase/schema.sql`, excute.
   a cre les tables, les index, les triggers et les **RLS**.
3. **Authentication > Providers** : laisse "Email" activ. Pour des comptes crs  la
   main sans email de confirmation, dsactive "Confirm email" dans les rglages Auth.

## 3. Crer les comptes techniciens

- **Authentication > Users > Add user** : un compte par technicien (email + mot de passe).
- Un profil est cr automatiquement (rle `tech` par dfaut).
- Pour donner les droits d'criture sur les talons  un rfrent :
  ```sql
  update public.profiles set role = 'referent' where id = '<uuid-du-user>';
  ```
  (l'uuid se trouve dans Authentication > Users)

## 4. Configurer le front

```bash
cp .env.example .env
```
Renseigne dans `.env` (valeurs dans **Project Settings > API**) :
```
VITE_SUPABASE_URL=https://xxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...
```
La cl **anon** est publique par design : la scurit passe entirement par les RLS.
Ne jamais mettre la cl `service_role` dans le front.

## 5. Lancer en dev

```bash
npm install
npm run dev
```

## 6. Build de production

```bash
npm run build      # tsc --noEmit + vite build  ->  dist/
npm run preview    # pour tester le build localement
```

### Dploiement

- **Recommand (Cloudflare Pages / Netlify / Vercel)** : pointer sur le repo,
  build `npm run build`, dossier `dist/`, et dclarer les variables
  `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`. La base reste `/`.
- **GitHub Pages** (dpt "projet", ex. `/Portail-tech/`) :
  ```bash
  VITE_BASE=/Portail-tech/ npm run build
  cp dist/index.html dist/404.html   # routage SPA
  ```
  puis publier `dist/`.

## 7. Installer en PWA sur mobile

Ouvrir l'URL dans le navigateur > menu > **Ajouter  l'cran d'accueil**.
L'appli se lance plein cran et fonctionne **hors-ligne** une fois les talons
tlchargs (utile en zone contrle, sans rseau).

---

## Comment a marche (offline-first)

- L'UI lit et crit **uniquement dans IndexedDB** (Dexie) : instantan, hors-ligne.
- `src/lib/sync.ts` rconcilie avec Supabase ds qu'il y a du rseau + une session :
  - **push** des lignes marques `_dirty` (cres/modifies hors-ligne) ;
  - **pull** incrmental par curseur `updated_at` (pagination 500).
- Suppression = **soft-delete** (`deleted = true`) pour ne jamais rater une suppression
  faite hors-ligne. Conflits : dernier qui crit gagne (LWW sur `updated_at`).
- La barre en haut indique l'tat rseau, la dernire synchro et le nombre de
  modifications en attente ; un tap force la synchro.

## Limites connues / pistes d'extension

- Le journal affiche "vous" sur tes entres ; pour afficher le **nom des autres
  auteurs**, synchroniser aussi la table `profiles` dans Dexie et faire la jointure.
- Pas de gestion des pices jointes / certificats PDF (seulement une rfrence texte).
- L'criture des talons/modles est ouverte  tout utilisateur connect. Pour la
  rserver  des rfrents, remettre une policy base sur le rle (voir l'historique git).
- Ajouter un radionuclide : `src/lib/decay.ts` (`HALF_LIVES_DAYS`).
- Les types de champs des modles sont dfinis dans `src/lib/types.ts` (`CHAMP_TYPES`)
  et rendus par `src/components/ChampInput.tsx`.

## Arborescence

```
portail-tech/
 supabase/schema.sql      # tables + RLS + triggers + modles par dfaut
 src/
   lib/                   # supabase, db (Dexie), sync, decay, types
   auth/                  # AuthProvider, RequireAuth, Login
   components/            # Layout, SyncStatus, Chips, ChampInput, ActiviteJour
   modules/
     ecme/                # EtalonsList, EtalonForm (champs dynamiques + dcroissance)
     journal/             # JournalView (log d'activit)
     parametrage/         # ModelesView, ModeleForm (modles paramtrables)
 .env.example
 vite.config.ts           # PWA + base configurable (VITE_BASE)
```
