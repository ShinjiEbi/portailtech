// Mémoire d'interface : l'état d'une page (saisies, filtres, onglet…) est conservé quand on
// change d'onglet et qu'on revient, et même après fermeture de l'appli (localStorage).
import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";

const PREFIX = "ptmem:";
function read<T>(key: string): T | undefined {
  try { const s = localStorage.getItem(PREFIX + key); return s == null ? undefined : (JSON.parse(s) as T); } catch { return undefined; }
}
function write(key: string, v: unknown) {
  try { localStorage.setItem(PREFIX + key, JSON.stringify(v)); } catch { /* stockage indisponible */ }
}
export function clearMemo(prefix: string) {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && k.startsWith(PREFIX + prefix)) localStorage.removeItem(k);
    }
  } catch { /* ignore */ }
}

// useState mémorisé sous une clé. Changer de clé recharge la valeur correspondante.
export function useMemoState<T>(key: string, init: T | (() => T)): [T, Dispatch<SetStateAction<T>>] {
  const initRef = useRef(init);
  const get = () => {
    const v = read<T>(key);
    if (v !== undefined) return v;
    const i = initRef.current;
    return typeof i === "function" ? (i as () => T)() : i;
  };
  const [state, setState] = useState<T>(get);
  const keyRef = useRef(key);
  useEffect(() => {
    if (keyRef.current !== key) { keyRef.current = key; setState(get()); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const set = useCallback<Dispatch<SetStateAction<T>>>((a) => {
    setState((prev) => {
      const next = typeof a === "function" ? (a as (p: T) => T)(prev) : a;
      write(keyRef.current, next);
      return next;
    });
  }, []);
  return [state, set];
}

// ---- dernière page visitée par onglet + position de défilement ------------
export const lastPathOf = (tab: string): string | undefined => read<string>(`nav:${tab}`);
export const rememberPath = (tab: string, path: string) => write(`nav:${tab}`, path);
export const scrollOf = (path: string): number => read<number>(`scroll:${path}`) ?? 0;
export const rememberScroll = (path: string, y: number) => write(`scroll:${path}`, Math.round(y));
