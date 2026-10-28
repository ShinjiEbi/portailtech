# Ajouter un modèle de constat de vérification

Les constats sont des PDF Word « à plat » (sans champs de formulaire). Le script
`gen_constat.py` lit leur mise en page et produit la définition JSON utilisée par l'appli :
cases à cocher (carrés 7×7), tableau des mesures (colonnes Tolérance / Valeur avant /
Valeur après / Observation), zones de l'en-tête (n° de constat, délivré à, date, n° série,
identification client, localisation), sources (« n° : » / « Activité … : »),
exécutant / contrôleur, Nom/Visa/Date du CT renforcé, cadre COMMENTAIRES.

## Étapes

1. Générer la définition :

   ```bash
   pip install pymupdf
   python tools/constats/gen_constat.py "Constat_de_vérification_XXX.pdf" XXX src/modules/constat/templates/XXX.json
   ```

   Le script affiche un résumé (nb de cases d'état, sources, lignes du tableau). Vérifier
   qu'il correspond au PDF (ex. NT170 : 16 cases d'état, 3 sources, 30 lignes).

2. Copier le PDF d'origine : `public/constats/XXX.pdf`.

3. Déclarer le modèle dans `src/lib/constats.ts` (tableau `CONSTAT_MODELES`) :

   ```ts
   import XXX from "../modules/constat/templates/XXX.json";
   { id: "XXX", nom: "Désignation", pdf: "constats/XXX.pdf", tpl: XXX as unknown as ConstatTemplate,
     typeCodes: /^SRCON…$/i,          // type(s) GMO² qui déclenchent ce constat
     designation: /\bXXX\b/i },       // repli sur la désignation Corim / de la ligne
   ```

4. `npm run build`, puis exporter un constat de test et contrôler le PDF (positions des
   croix et des valeurs).

## Limites connues

- Le PDF doit venir de Word (texte sélectionnable) : un scan ne marche pas.
- Les cases doivent être des carrés dessinés (☐ de Word) de 6 à 8,5 pt.
- Les cellules d'un tableau sans en-tête « Valeur avant / Valeur après » ne sont pas
  détectées ; les pages suivantes réutilisent les colonnes de la première page du tableau.
