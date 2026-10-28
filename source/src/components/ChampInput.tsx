import { Chips } from "./Chips";
import { RADIONUCLIDES, periodeFor, formatPeriode } from "../lib/decay";
import type { ChampDef } from "../lib/types";

const RN_OPTS = RADIONUCLIDES.map((r) => ({ value: r, label: r }));

export function ChampInput({
  champ,
  value,
  onChange,
}: {
  champ: ChampDef;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  switch (champ.type) {
    case "nombre":
    case "activite_ref":
    case "flux":
      return (
        <input
          type="number"
          value={value == null ? "" : String(value)}
          onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))}
        />
      );
    case "date":
    case "date_ref":
      return (
        <input type="date" value={value ? String(value) : ""} onChange={(e) => onChange(e.target.value)} />
      );
    case "booleen":
      return (
        <label className="check">
          <input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} /> oui
        </label>
      );
    case "liste":
      return (
        <Chips
          options={(champ.options ?? []).map((o) => ({ value: o, label: o }))}
          value={value ? String(value) : null}
          onChange={(v) => onChange(v)}
        />
      );
    case "radionucleide": {
      const p = periodeFor(value ? String(value) : undefined);
      return (
        <>
          <Chips options={RN_OPTS} value={value ? String(value) : null} onChange={(v) => onChange(v)} />
          {p && <div className="champ-note">Période : {formatPeriode(p)}</div>}
        </>
      );
    }
    default:
      return (
        <input type="text" value={value ? String(value) : ""} onChange={(e) => onChange(e.target.value)} />
      );
  }
}
