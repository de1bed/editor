"use client";
import { useRef, useState } from "react";
import * as tus from "tus-js-client";
import type { MediaAsset } from "@editor/db";
import { api } from "@/lib/client-api";
import { publicEnv } from "@/lib/env";
import { fmtBytes } from "@/lib/format";
import { browserClient } from "@/lib/supabase/browser";

/**
 * Resumable upload straight to Supabase Storage (TUS, 6 MB chunks). If the tab
 * closes, choosing the same file again resumes where it stopped.
 */
export function Uploader({ projectId, pending, onDone }: { projectId: string; pending: MediaAsset | null; onDone: () => void }) {
  const [progress, setProgress] = useState<{ sent: number; total: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const [paused, setPaused] = useState(false);
  const uploadRef = useRef<tus.Upload | null>(null);

  async function start(file: File) {
    setErr(null);
    try {
      if (pending && pending.originalFilename !== file.name) {
        // A different file: register a new source.
        pending = null;
      }
      let assetId = pending?.id;
      let objectName = pending?.path;
      if (!assetId || !objectName) {
        const r = await api<{ asset: MediaAsset; upload: { bucket: string; path: string } }>(`/api/projects/${projectId}/source`, {
          body: { filename: file.name, mimeType: file.type || "video/mp4", bytes: file.size },
        });
        assetId = r.asset.id;
        objectName = r.upload.path;
      }
      const { data } = await browserClient().auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error("Sesión expirada, vuelve a entrar");

      const upload = new tus.Upload(file, {
        endpoint: `${publicEnv.supabaseUrl}/storage/v1/upload/resumable`,
        retryDelays: [0, 2000, 5000, 10000, 20000, 60000],
        headers: { authorization: `Bearer ${token}`, "x-upsert": "true" },
        uploadDataDuringCreation: true,
        removeFingerprintOnSuccess: true,
        chunkSize: 6 * 1024 * 1024, // required by Supabase
        metadata: { bucketName: "media", objectName, contentType: file.type || "video/mp4", cacheControl: "3600" },
        onProgress: (sent, total) => setProgress({ sent, total }),
        onError: (e) => setErr(e.message),
        onSuccess: async () => {
          try {
            await api(`/api/assets/${assetId}/uploaded`, { method: "POST" });
            onDone();
          } catch (e) {
            setErr((e as Error).message);
          }
        },
      });
      uploadRef.current = upload;
      const previous = await upload.findPreviousUploads();
      if (previous[0]) upload.resumeFromPreviousUpload(previous[0]);
      upload.start();
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  const pct = progress ? Math.floor((progress.sent / progress.total) * 100) : 0;
  return (
    <div
      className={`card flex flex-col items-center justify-center gap-3 p-8 text-center ${drag ? "border-accent" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDrag(true);
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        const f = e.dataTransfer.files[0];
        if (f) void start(f);
      }}
    >
      <p className="font-medium">{pending ? "Reanudar la subida" : "Sube tu video"}</p>
      <p className="text-xs text-muted">
        {pending ? `Vuelve a elegir “${pending.originalFilename}” para continuar donde quedó.` : "Podcast, entrevista, película… Hasta varios GB. Arrastra el archivo o elígelo."}
      </p>
      {progress ? (
        <div className="w-full max-w-sm">
          <div className="h-2 overflow-hidden rounded bg-white/10">
            <div className="h-full bg-accent transition-all" style={{ width: `${pct}%` }} />
          </div>
          <p className="mt-1 text-xs text-muted">
            {pct}% · {fmtBytes(progress.sent)} de {fmtBytes(progress.total)}
          </p>
        </div>
      ) : (
        <label className="btn-primary cursor-pointer">
          Elegir archivo
          <input type="file" accept="video/*,audio/*" className="hidden" onChange={(e) => e.target.files?.[0] && start(e.target.files[0])} />
        </label>
      )}
      {progress && pct < 100 && (
        <button
          className="text-xs text-muted hover:text-white"
          onClick={() => {
            if (paused) uploadRef.current?.start();
            else void uploadRef.current?.abort();
            setPaused(!paused);
          }}
        >
          {paused ? "Continuar" : "Pausar"}
        </button>
      )}
      {err && <p className="text-sm text-red-400">{err}</p>}
    </div>
  );
}
