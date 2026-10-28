// Saisie GMO² avec recherche dynamique dans la base matériels (hors-ligne) :
// id court, GMO², SN, désignation, type Corim. Plusieurs mots = tous requis.
import { useEffect, useMemo, useState } from "react";
import { allCorimTypes, allMateriels } from "../lib/materiels";
import type { CorimType, Materiel } from "../lib/types";

interface Item { m: Materiel; des: string; hay: string }
let cache: Promise<Item[]> | null = null;
function loadItems(): Promise<Item[]> {
  if (!cache) cache = Promise.all([allMateriels(), allCorimTypes()]).then(([ms, ts]) => {
    const byType = new Map<string, CorimType>(ts.map((t) => [t.type_code, t]));
    return ms.map((m) => {
      const ct = m.type_code ? byType.get(m.type_code) : undefined;
      const des = m.designation || ct?.designation || "";
      const hay = [m.id_court, m.scan, m.sn, des, ct?.type_appareil, m.code_model, m.site, m.localisation]
        .filter(Boolean).join(" ").toLowerCase();
      return { m, des: [des, ct?.type_appareil].filter(Boolean).join(" · "), hay };
    });
  });
  return cache;
}

export function EquipSearch({ value, onChange, onPick, onBlur, placeholder }: {
  value: string; onChange: (v: string) => void; onPick: (m: Materiel) => void; onBlur?: () => void; placeholder?: string;
}) {
  const [items, setItems] = useState<Item[]>([]);
  const [open, setOpen] = useState(false);
  useEffect(() => { loadItems().then(setItems).catch(() => {}); }, []);

  const hits = useMemo(() => {
    const toks = value.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!toks.length || value.trim().length < 2) return [];
    const q = toks[0];
    return items
      .filter((it) => toks.every((t) => it.hay.includes(t)))
      .map((it) => ({ it, s: it.m.id_court.toLowerCase().startsWith(q) ? 0 : it.m.scan.toLowerCase().includes(q) ? 1 : 2 }))
      .sort((a, b) => a.s - b.s || a.it.m.id_court.localeCompare(b.it.m.id_court))
      .slice(0, 8).map((x) => x.it);
  }, [items, value]);
  const exact = hits.length === 1 && hits[0].m.scan === value.trim();

  return (
    <div className="eq-search">
      <input value={value} placeholder={placeholder} autoComplete="off"
        onChange={(e) => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => { setOpen(false); onBlur?.(); }, 180)} />
      {open && hits.length > 0 && !exact && (
        <div className="eq-drop">
          {hits.map(({ m, des }) => (
            <button type="button" key={m.scan} className="eq-item"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => { onPick(m); setOpen(false); }}>
              <span className="eq-id">{m.id_court}</span>
              <span className="eq-des">{des || m.scan}</span>
              <span className="eq-sub">{[m.sn && `SN ${m.sn}`, m.site].filter(Boolean).join(" · ")}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
