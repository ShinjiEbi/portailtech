// Évaluateur d'expressions sûr (sans eval) pour le module Calcul.
// Gère : nombres, variables nommées, opérateurs + - * / ^ % , parenthèses, fonctions.
// Les dates sont passées en nombre de jours (epoch days) → une soustraction de deux
// dates donne directement des jours écoulés, utilisable dans une décroissance.

export type Scope = Record<string, number>;

type Tok =
  | { t: "num"; v: number }
  | { t: "var"; v: string }
  | { t: "op"; v: string }
  | { t: "fn"; v: string }
  | { t: "lp" }
  | { t: "rp" }
  | { t: "comma" };

const sum = (a: number[]) => a.reduce((s, x) => s + x, 0);
const FUNCS: Record<string, (...a: number[]) => number> = {
  exp: Math.exp, ln: Math.log, log: Math.log, log10: Math.log10, log2: Math.log2,
  sqrt: Math.sqrt, abs: Math.abs, absolu: Math.abs,
  round: Math.round, floor: Math.floor, ceil: Math.ceil,
  min: (...a) => Math.min(...a), max: (...a) => Math.max(...a),
  pow: (a, b) => Math.pow(a, b), puissance: (a, b) => Math.pow(a, b),
  // écart absolu entre deux valeurs : |a − b|
  ecart: (a, b) => Math.abs(a - b),
  // écart relatif en % : |a − b| / |b| × 100
  ecartrel: (a, b) => (Math.abs(a - b) / Math.abs(b)) * 100,
  // moyenne / somme (nombre d'arguments libre)
  moy: (...a) => sum(a) / a.length, moyenne: (...a) => sum(a) / a.length,
  somme: (...a) => sum(a),
  // arrondi à n décimales (n facultatif → arrondi à l'entier)
  arrondi: (x, n) => { const d = Number.isFinite(n) ? n : 0; const p = Math.pow(10, d); return Math.round(x * p) / p; },
  // racine : racine(x) = √x ; racine(x, n) = racine n-ième
  racine: (x, n) => (Number.isFinite(n) ? Math.pow(x, 1 / n) : Math.sqrt(x)),
};
// arités fixes (validées) ; min/max/moy/moyenne/somme variadiques ; arrondi/racine 1–2 ; reste = 1
const ARITY: Record<string, number> = { pow: 2, puissance: 2, ecart: 2, ecartrel: 2 };
const PREC: Record<string, number> = { "+": 2, "-": 2, "*": 3, "/": 3, "%": 3, "u-": 3.5, "^": 4 };
const RIGHT = new Set(["^", "u-"]);
const isIdentStart = (c: string) => /[A-Za-zÀ-ÿ_]/.test(c);
const isIdent = (c: string) => /[A-Za-zÀ-ÿ0-9_]/.test(c);

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  const prev = () => out[out.length - 1];
  while (i < src.length) {
    const c = src[i];
    if (c === " " || c === "\t" || c === "\n") { i++; continue; }
    if ((c >= "0" && c <= "9") || (c === "." && /[0-9]/.test(src[i + 1] ?? ""))) {
      let j = i + 1;
      while (j < src.length && /[0-9._]/.test(src[j])) j++;
      // exposant scientifique 1e3 / 2.5E-4
      if ((src[j] === "e" || src[j] === "E") && /[0-9+\-]/.test(src[j + 1] ?? "")) {
        j++; if (src[j] === "+" || src[j] === "-") j++;
        while (j < src.length && /[0-9]/.test(src[j])) j++;
      }
      const num = Number(src.slice(i, j).replace(/_/g, "").replace(",", "."));
      if (Number.isNaN(num)) throw new Error(`Nombre invalide : "${src.slice(i, j)}"`);
      out.push({ t: "num", v: num }); i = j; continue;
    }
    if (isIdentStart(c)) {
      let j = i + 1;
      while (j < src.length && isIdent(src[j])) j++;
      const name = src.slice(i, j);
      let k = j; while (src[k] === " ") k++;
      if (src[k] === "(") out.push({ t: "fn", v: name });
      else out.push({ t: "var", v: name });
      i = j; continue;
    }
    if (c === "(") { out.push({ t: "lp" }); i++; continue; }
    if (c === ")") { out.push({ t: "rp" }); i++; continue; }
    if (c === ",") { out.push({ t: "comma" }); i++; continue; }
    if ("+-*/^%".includes(c)) {
      // moins/plus unaire en début, après un opérateur, une ( ou une ,
      const p = prev();
      const unary = !p || p.t === "op" || p.t === "lp" || p.t === "comma";
      if (c === "-" && unary) out.push({ t: "op", v: "u-" });
      else if (c === "+" && unary) { /* +unaire : sans effet */ }
      else out.push({ t: "op", v: c });
      i++; continue;
    }
    throw new Error(`Caractère inattendu : "${c}"`);
  }
  return out;
}

function toRPN(tokens: Tok[]): Tok[] {
  const out: Tok[] = [];
  const stack: Tok[] = [];
  const argc: number[] = []; // nb d'arguments par fonction en cours
  for (let idx = 0; idx < tokens.length; idx++) {
    const tk = tokens[idx];
    if (tk.t === "num" || tk.t === "var") out.push(tk);
    else if (tk.t === "fn") { stack.push(tk); argc.push(1); }
    else if (tk.t === "comma") {
      while (stack.length && stack[stack.length - 1].t !== "lp") out.push(stack.pop()!);
      if (!stack.length) throw new Error("Virgule hors d'une fonction");
      if (argc.length) argc[argc.length - 1]++;
    } else if (tk.t === "op") {
      if (tk.v !== "u-") {
        while (stack.length) {
          const top = stack[stack.length - 1];
          if (top.t !== "op") break;
          const a = PREC[tk.v], b = PREC[top.v];
          if (b > a || (b === a && !RIGHT.has(tk.v))) out.push(stack.pop()!);
          else break;
        }
      }
      stack.push(tk);
    } else if (tk.t === "lp") stack.push(tk);
    else if (tk.t === "rp") {
      while (stack.length && stack[stack.length - 1].t !== "lp") out.push(stack.pop()!);
      if (!stack.length) throw new Error("Parenthèse fermante en trop");
      stack.pop(); // enlève la (
      const top = stack[stack.length - 1];
      if (top && top.t === "fn") {
        const fn = stack.pop() as Tok & { t: "fn" };
        const n = argc.pop() ?? 1;
        out.push({ t: "fn", v: fn.v + "#" + n }); // encode l'arité
      }
    }
  }
  while (stack.length) {
    const top = stack.pop()!;
    if (top.t === "lp") throw new Error("Parenthèse ouvrante non fermée");
    out.push(top);
  }
  return out;
}

function evalRPN(rpn: Tok[], scope: Scope): number {
  const st: number[] = [];
  for (const tk of rpn) {
    if (tk.t === "num") st.push(tk.v);
    else if (tk.t === "var") {
      const v = scope[tk.v];
      if (v == null || Number.isNaN(v)) throw new Error(`Valeur manquante : "${tk.v}"`);
      st.push(v);
    } else if (tk.t === "op") {
      if (tk.v === "u-") { st.push(-st.pop()!); continue; }
      const b = st.pop()!, a = st.pop()!;
      if (a == null || b == null) throw new Error("Expression incomplète");
      st.push(tk.v === "+" ? a + b : tk.v === "-" ? a - b : tk.v === "*" ? a * b :
        tk.v === "/" ? a / b : tk.v === "%" ? a % b : Math.pow(a, b));
    } else if (tk.t === "fn") {
      const [name, nStr] = tk.v.split("#");
      const n = Number(nStr);
      const fn = FUNCS[name];
      if (!fn) throw new Error(`Fonction inconnue : "${name}"`);
      const wanted = ARITY[name];
      if (wanted != null && wanted !== n) throw new Error(`${name}() attend ${wanted} argument(s)`);
      const args = st.splice(st.length - n, n);
      st.push(fn(...args));
    }
  }
  if (st.length !== 1) throw new Error("Expression invalide");
  return st[0];
}

// Compile une expression en fonction réutilisable (lève une erreur si syntaxe invalide).
export function compile(expr: string): (scope: Scope) => number {
  const rpn = toRPN(tokenize(expr));
  return (scope: Scope) => evalRPN(rpn, scope);
}
export function evaluate(expr: string, scope: Scope): number {
  return compile(expr)(scope);
}
// Liste des symboles (variables, hors fonctions) utilisés par une expression.
export function variablesIn(expr: string): string[] {
  const seen = new Set<string>();
  for (const tk of tokenize(expr)) if (tk.t === "var") seen.add(tk.v);
  return [...seen];
}
// Vérifie qu'une expression est valide (syntaxe + opérandes/arité) ; renvoie l'erreur éventuelle.
export function checkExpr(expr: string): string | null {
  try {
    const scope: Scope = {};
    for (const v of variablesIn(expr)) scope[v] = 1;
    compile(expr)(scope);
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}
// Convertit une date (YYYY-MM-DD) en nombre de jours depuis l'epoch.
export function dateToDays(d: string | Date): number {
  const ms = (d instanceof Date ? d : new Date(d + "T00:00:00Z")).getTime();
  return Math.floor(ms / 86400000);
}
