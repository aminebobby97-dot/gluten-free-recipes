"use client";

import { useId, useState } from "react";

export interface ListField {
  key: string;
  label: string;
  placeholder?: string;
  multiline?: boolean;
  /** Tailwind grid column span on wide screens (out of 12). */
  span?: number;
}

type Row = Record<string, string> & { _key: string };

let counter = 0;
const withKey = (row: Record<string, string>): Row => ({ ...row, _key: `r${counter++}` });

/**
 * Repeating rows of fields (ingredients, steps, FAQs...). The value is
 * serialized as JSON into a hidden input so a regular form post can submit it.
 */
export function ListEditor({
  name,
  label,
  hint,
  fields,
  initial,
  addLabel = "Add row",
  numbered = false,
}: {
  name: string;
  label: string;
  hint?: string;
  fields: ListField[];
  initial: Array<Record<string, unknown>>;
  addLabel?: string;
  numbered?: boolean;
}) {
  const id = useId();
  const [rows, setRows] = useState<Row[]>(() =>
    initial.map((item) => withKey(Object.fromEntries(fields.map((f) => [f.key, item[f.key] == null ? "" : String(item[f.key])])))),
  );
  const empty = () => withKey(Object.fromEntries(fields.map((f) => [f.key, ""])));

  const update = (index: number, key: string, value: string) =>
    setRows((prev) => prev.map((row, i) => (i === index ? { ...row, [key]: value } : row)));
  const move = (index: number, delta: number) =>
    setRows((prev) => {
      const next = [...prev];
      const target = index + delta;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  const remove = (index: number) => setRows((prev) => prev.filter((_, i) => i !== index));

  const serialized = JSON.stringify(
    rows
      .map((row) => Object.fromEntries(Object.entries(row).filter(([k, v]) => k !== "_key" && v.trim() !== "")))
      .filter((row) => Object.keys(row).length > 0),
  );

  return (
    <fieldset className="space-y-3">
      <legend className="field-label">{label}</legend>
      {hint && <p className="field-hint -mt-1">{hint}</p>}
      <input type="hidden" name={name} value={serialized} />
      <ol className="space-y-2.5">
        {rows.map((row, index) => (
          <li key={row._key} className="flex gap-2 rounded-xl border border-line bg-cream/50 p-2.5">
            {numbered && <span className="mt-2 w-6 shrink-0 text-center text-sm font-semibold text-ink-faint">{index + 1}</span>}
            <div className="grid flex-1 grid-cols-12 gap-2">
              {fields.map((field) => {
                const fieldId = `${id}-${row._key}-${field.key}`;
                const common = {
                  id: fieldId,
                  value: row[field.key] ?? "",
                  placeholder: field.placeholder ?? field.label,
                  onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => update(index, field.key, e.target.value),
                  className: "field-input text-sm",
                };
                return (
                  <div key={field.key} className={`col-span-12 ${spanClass(field.span)}`}>
                    <label htmlFor={fieldId} className="sr-only">
                      {field.label}
                    </label>
                    {field.multiline ? <textarea rows={2} {...common} /> : <input type="text" {...common} />}
                  </div>
                );
              })}
            </div>
            <div className="flex shrink-0 flex-col gap-1">
              <IconButton label="Move up" onClick={() => move(index, -1)} disabled={index === 0}>
                ↑
              </IconButton>
              <IconButton label="Move down" onClick={() => move(index, 1)} disabled={index === rows.length - 1}>
                ↓
              </IconButton>
              <IconButton label="Remove" onClick={() => remove(index)}>
                ✕
              </IconButton>
            </div>
          </li>
        ))}
      </ol>
      <button type="button" onClick={() => setRows((prev) => [...prev, empty()])} className="btn btn-secondary px-4 py-2 text-sm">
        + {addLabel}
      </button>
    </fieldset>
  );
}

function IconButton({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className="grid h-7 w-7 place-items-center rounded-md text-xs text-ink-soft hover:bg-cream-deep disabled:opacity-30"
    >
      {children}
    </button>
  );
}

// Listed in full so Tailwind can see the class names.
function spanClass(span = 12): string {
  return (
    {
      2: "md:col-span-2",
      3: "md:col-span-3",
      4: "md:col-span-4",
      5: "md:col-span-5",
      6: "md:col-span-6",
      8: "md:col-span-8",
      12: "md:col-span-12",
    } as Record<number, string>
  )[span] ?? "md:col-span-12";
}
