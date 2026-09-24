import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type Db = SupabaseClient;

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing environment variable ${name}`);
  return v;
}

let service: Db | null = null;

/** Service-role client: bypasses RLS. Server-side only (jobs, workers, trusted API code). */
export function serviceClient(): Db {
  service ??= createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return service;
}

/** Throws with the PostgREST message when a query failed. */
export function must<T>(res: { data: T | null; error: { message: string; code?: string } | null }, what: string): T {
  if (res.error) throw new DbError(`${what}: ${res.error.message}`, res.error.code);
  if (res.data === null) throw new DbError(`${what}: not found`, "PGRST116");
  return res.data;
}

export class DbError extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = "DbError";
  }
  get isNotFound() {
    return this.code === "PGRST116";
  }
  get isConflict() {
    return this.code === "40001" || this.code === "23505";
  }
}
