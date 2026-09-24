"use client";
import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { publicEnv } from "../env";

let client: SupabaseClient | null = null;

export function browserClient(): SupabaseClient {
  client ??= createBrowserClient(publicEnv.supabaseUrl, publicEnv.supabaseAnonKey);
  return client;
}
