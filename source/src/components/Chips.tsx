interface Option<T extends string> {
  value: T;
  label: string;
}

// Slecteur  puces (prfr aux menus droulants pour la saisie terrain)
export function Chips<T extends string>({
  options,
  value,
  onChange,
  allLabel,
}: {
  options: Option<T>[];
  value: T | null;
  onChange: (v: T | null) => void;
  allLabel?: string; // si fourni : ajoute une puce "tout" (valeur null)
}) {
  return (
    <div className="chips">
      {allLabel && (
        <button
          type="button"
          className={`chip ${value === null ? "on" : ""}`}
          onClick={() => onChange(null)}
        >
          {allLabel}
        </button>
      )}
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className={`chip ${value === o.value ? "on" : ""}`}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
