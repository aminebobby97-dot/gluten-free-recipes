// Minimal in-memory stand-in for the parts of the Supabase query builder used
// by the publishing services. Supports eq/neq/lt/lte/in/is filters, insert, update, upsert
// (with ignoreDuplicates), single/maybeSingle and head-only counts.

import type { SupabaseClient } from "@supabase/supabase-js";

type Row = Record<string, unknown>;

export type FakeRpc = (args: Record<string, unknown>, data: Record<string, Row[]>) => unknown;

export function createFakeDb(tables: Record<string, Row[]> = {}, rpcs: Record<string, FakeRpc> = {}) {
  const data: Record<string, Row[]> = Object.fromEntries(Object.entries(tables).map(([k, v]) => [k, v.map((r) => ({ ...r }))]));
  const calls: Array<{ table: string; op: string; payload?: unknown }> = [];

  function from(table: string) {
    data[table] ??= [];
    let op: "select" | "update" | "insert" | "upsert" | "delete" = "select";
    let payload: Row | Row[] | undefined;
    let upsertOpts: { onConflict?: string; ignoreDuplicates?: boolean } = {};
    const filters: Array<(r: Row) => boolean> = [];
    let countOnly = false;

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
      select: (_cols?: string, opts?: { count?: string; head?: boolean }) => ((countOnly = Boolean(opts?.head)), builder),
      insert: (p: Row | Row[]) => ((op = "insert"), (payload = p), calls.push({ table, op, payload: p }), builder),
      upsert: (p: Row | Row[], o: typeof upsertOpts = {}) => ((op = "upsert"), (payload = p), (upsertOpts = o), calls.push({ table, op, payload: p }), builder),
      update: (p: Row) => ((op = "update"), (payload = p), calls.push({ table, op, payload: p }), builder),
      delete: () => ((op = "delete"), calls.push({ table, op }), builder),
      eq: (col: string, val: unknown) => (filters.push((r) => r[col] === val), builder),
      neq: (col: string, val: unknown) => (filters.push((r) => r[col] !== val), builder),
      lt: (col: string, val: unknown) => (filters.push((r) => (r[col] as string | number) < (val as string | number)), builder),
      lte: (col: string, val: unknown) => (filters.push((r) => (r[col] as string | number) <= (val as string | number)), builder),
      in: (col: string, vals: unknown[]) => (filters.push((r) => vals.includes(r[col])), builder),
      is: (col: string, val: unknown) => (filters.push((r) => (r[col] ?? null) === val), builder),
      not: (col: string, operator: string, val: unknown) => {
        if (operator !== "is") throw new Error(`fake-db: not(${operator}) is not supported`);
        filters.push((r) => (r[col] ?? null) !== val);
        return builder;
      },
      order: () => builder,
      limit: () => builder,
      single: async () => {
        const rows = run();
        return rows.length === 1 ? { data: rows[0], error: null } : { data: null, error: { message: `expected 1 row, got ${rows.length}` } };
      },
      maybeSingle: async () => ({ data: run()[0] ?? null, error: null }),
      then: (resolve: (v: { data: Row[] | null; error: null; count?: number }) => unknown) => {
        const rows = run();
        return resolve(countOnly ? { data: null, error: null, count: rows.length } : { data: rows, error: null });
      },
    };
    return builder;
  }

  async function rpc(name: string, args: Record<string, unknown> = {}) {
    calls.push({ table: `rpc:${name}`, op: "rpc", payload: args });
    const handler = rpcs[name];
    if (!handler) return { data: null, error: { message: `rpc ${name} is not faked` } };
    try {
      return { data: handler(args, data), error: null };
    } catch (err) {
      return { data: null, error: { message: err instanceof Error ? err.message : String(err) } };
    }
  }

  return { db: { from, rpc } as unknown as SupabaseClient, data, calls };
}
