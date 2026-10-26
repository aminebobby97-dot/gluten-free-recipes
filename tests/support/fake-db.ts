// Minimal in-memory stand-in for the parts of the Supabase query builder used
// by the publishing services. Supports eq/neq filters, insert, update, upsert
// (with ignoreDuplicates) and single/maybeSingle.

import type { SupabaseClient } from "@supabase/supabase-js";

type Row = Record<string, unknown>;

export function createFakeDb(tables: Record<string, Row[]> = {}) {
  const data: Record<string, Row[]> = Object.fromEntries(Object.entries(tables).map(([k, v]) => [k, v.map((r) => ({ ...r }))]));
  const calls: Array<{ table: string; op: string; payload?: unknown }> = [];

  function from(table: string) {
    data[table] ??= [];
    let op: "select" | "update" | "insert" | "upsert" | "delete" = "select";
    let payload: Row | Row[] | undefined;
    let upsertOpts: { onConflict?: string; ignoreDuplicates?: boolean } = {};
    const filters: Array<(r: Row) => boolean> = [];

    const run = () => {
      const rows = data[table];
      if (op === "insert" || op === "upsert") {
        const list = Array.isArray(payload) ? payload : [payload!];
        const out: Row[] = [];
        for (const item of list) {
          const key = upsertOpts.onConflict;
          if (op === "upsert" && key && rows.some((r) => r[key] === item[key])) {
            if (upsertOpts.ignoreDuplicates) continue;
          }
          const row = { id: `id-${rows.length + 1}`, retry_count: 0, status: "pending", ...item };
          rows.push(row);
          out.push(row);
        }
        return out;
      }
      const matched = rows.filter((r) => filters.every((f) => f(r)));
      if (op === "update") matched.forEach((r) => Object.assign(r, payload));
      if (op === "delete") data[table] = rows.filter((r) => !matched.includes(r));
      return matched;
    };

    const builder = {
      select: () => builder,
      insert: (p: Row | Row[]) => ((op = "insert"), (payload = p), calls.push({ table, op, payload: p }), builder),
      upsert: (p: Row | Row[], o: typeof upsertOpts = {}) => ((op = "upsert"), (payload = p), (upsertOpts = o), calls.push({ table, op, payload: p }), builder),
      update: (p: Row) => ((op = "update"), (payload = p), calls.push({ table, op, payload: p }), builder),
      delete: () => ((op = "delete"), calls.push({ table, op }), builder),
      eq: (col: string, val: unknown) => (filters.push((r) => r[col] === val), builder),
      neq: (col: string, val: unknown) => (filters.push((r) => r[col] !== val), builder),
      single: async () => {
        const rows = run();
        return rows.length === 1 ? { data: rows[0], error: null } : { data: null, error: { message: `expected 1 row, got ${rows.length}` } };
      },
      maybeSingle: async () => ({ data: run()[0] ?? null, error: null }),
      then: (resolve: (v: { data: Row[]; error: null }) => unknown) => resolve({ data: run(), error: null }),
    };
    return builder;
  }

  return { db: { from } as unknown as SupabaseClient, data, calls };
}
