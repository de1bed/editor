"use client";
import { useEffect, useRef } from "react";
import { FONT_FACES } from "@editor/core/fonts";

/**
 * Preview video with captions drawn live by libass (JASSUB) from the same ASS
 * the final render burns in. Caption edits show up instantly, no re-render.
 */
export function CaptionPlayer({ src, ass, poster }: { src: string | null; ass: string | null; poster?: string }) {
  const video = useRef<HTMLVideoElement>(null);
  const renderer = useRef<{ destroy(): Promise<void>; renderer?: { setTrack(c: string): Promise<void> | void }; ready: Promise<void> } | null>(null);

  useEffect(() => {
    let disposed = false;
    const el = video.current;
    if (!el || !ass) return;
    (async () => {
      const { default: JASSUB } = await import("jassub");
      if (disposed) return;
      // Absolute URLs: the worker resolves relative ones against its own script URL.
      const fonts = FONT_FACES.map((f) => new URL(`/fonts/${f.file}`, location.origin).href);
      const inst = new JASSUB({ video: el, subContent: ass, fonts, defaultFont: "montserrat extrabold", queryFonts: false });
      renderer.current = inst as unknown as typeof renderer.current;
    })().catch((e) => console.warn("JASSUB unavailable, captions only in renders", e));
    return () => {
      disposed = true;
      void renderer.current?.destroy();
      renderer.current = null;
    };
    // Re-created only when the video element source changes; track updates below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src]);

  useEffect(() => {
    const r = renderer.current;
    if (!r || !ass) return;
    void r.ready.then(() => r.renderer?.setTrack(ass));
  }, [ass]);

  if (!src) {
    return <div className="flex aspect-[9/16] w-full items-center justify-center rounded-xl bg-black/60 text-sm text-muted">Renderizando vista previa…</div>;
  }
  return (
    <div className="relative aspect-[9/16] w-full overflow-hidden rounded-xl bg-black">
      <video ref={video} src={src} poster={poster} controls playsInline crossOrigin="anonymous" className="h-full w-full object-contain" />
    </div>
  );
}
