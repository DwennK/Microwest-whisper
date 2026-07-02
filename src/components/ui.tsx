import type React from "react";

export function SectionTitle({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div className="section-title">
      {icon}
      <h2>{title}</h2>
    </div>
  );
}

export function StatusPill({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className={ok ? "status-pill ok" : "status-pill warn"}>
      <span />
      {label}
    </span>
  );
}

export function Select({
  label,
  value,
  options,
  disabled = false,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <select value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}

export function NumberField({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (value: number) => void }) {
  const clampValue = (rawValue: string) => {
    if (rawValue.trim() === "") {
      onChange(min);
      return;
    }
    const parsed = Number(rawValue);
    if (!Number.isFinite(parsed)) {
      onChange(min);
      return;
    }
    onChange(Math.min(max, Math.max(min, Math.round(parsed))));
  };

  return (
    <label className="field">
      <span>{label}</span>
      <input type="number" value={value} min={min} max={max} onChange={(event) => clampValue(event.target.value)} />
    </label>
  );
}

export function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span />
      {label}
    </label>
  );
}
