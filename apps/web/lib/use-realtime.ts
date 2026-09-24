"use client";
import { useEffect, useRef } from "react";
import { browserClient } from "./supabase/browser";

/**
 * Calls `onChange` whenever a row of `table` matching `filter` changes
 * (Supabase Realtime, RLS-scoped). Falls back to polling every `pollMs`.
 */
export function useRealtime(tables: string[], filter: string, onChange: () => void, pollMs = 8000) {
  const cb = useRef(onChange);
  cb.current = onChange;
  useEffect(() => {
    const sb = browserClient();
    const channel = sb.channel(`rt:${tables.join(",")}:${filter}`);
    for (const table of tables) {
      channel.on("postgres_changes", { event: "*", schema: "public", table, filter }, () => cb.current());
    }
    channel.subscribe();
    const t = setInterval(() => cb.current(), pollMs);
    return () => {
      clearInterval(t);
      void sb.removeChannel(channel);
    };
  }, [tables.join(","), filter, pollMs]);
}
