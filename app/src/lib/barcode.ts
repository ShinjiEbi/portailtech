// Générateur de code-barres Code 128 (jeu B) — autonome, sans dépendance.
// Sert à afficher à l'écran le code d'un régime de travail radiologique afin de
// le présenter au lecteur d'accès en zone contrôlée.
//
// Le jeu B couvre l'ASCII imprimable (espace .. '~', valeurs 32..126), ce qui
// englobe chiffres, lettres majuscules/minuscules et symboles courants.

// Table des motifs Code 128 (valeurs 0..106). Chaque motif = largeurs des
// modules, alternées barre/espace en commençant par une barre. La dernière
// entrée (106) est le motif d'arrêt (7 modules, se termine par une barre).
const PATTERNS = [
  "212222", "222122", "222221", "121223", "121322", "131222", "122213", "122312", "132212", "221213",
  "221312", "231212", "112232", "122132", "122231", "113222", "123122", "123221", "223211", "221132",
  "221231", "213212", "223112", "312131", "311222", "321122", "321221", "312212", "322112", "322211",
  "212123", "212321", "232121", "111323", "131123", "131321", "112313", "132113", "132311", "211313",
  "231113", "231311", "112133", "112331", "132131", "113123", "113321", "133121", "313121", "211331",
  "231131", "213113", "213311", "213131", "311123", "311321", "331121", "312113", "312311", "332111",
  "314111", "221411", "431111", "111224", "111422", "121124", "121421", "141122", "141221", "112214",
  "112412", "122114", "122411", "142112", "142211", "241211", "221114", "413111", "241112", "134111",
  "111242", "121142", "121241", "114212", "124112", "124211", "411212", "421112", "421211", "212141",
  "214121", "412121", "111143", "111341", "131141", "114113", "114311", "411113", "411311", "113141",
  "114131", "311141", "411131", "211412", "211214", "211232", "2331112",
];

const START_B = 104;
const STOP = 106;

export interface Barcode {
  bars: { x: number; w: number }[]; // barres noires (position + largeur en modules)
  modules: number;                  // largeur totale en modules (barres + espaces)
}

// Encode une chaîne en Code 128 B. Renvoie null si un caractère sort du jeu B.
export function code128(text: string): Barcode | null {
  if (!text) return null;
  const values: number[] = [START_B];
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    if (code < 32 || code > 126) return null; // hors jeu B
    values.push(code - 32);
  }
  // Somme de contrôle : (start + Σ valeur_i * position_i) mod 103, position dès 1
  let sum = START_B;
  for (let i = 1; i < values.length; i++) sum += values[i] * i;
  values.push(sum % 103);
  values.push(STOP);

  const bars: { x: number; w: number }[] = [];
  let x = 0;
  for (const v of values) {
    const pat = PATTERNS[v];
    for (let i = 0; i < pat.length; i++) {
      const w = pat.charCodeAt(i) - 48; // '0'..'9' -> largeur
      if (i % 2 === 0) bars.push({ x, w }); // index pair = barre noire
      x += w;
    }
  }
  return { bars, modules: x };
}
