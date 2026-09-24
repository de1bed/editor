"use client";
import { useEffect, useRef, useState } from "react";
import { FONT_FACES } from "@editor/core/fonts";

/**
 * Preview video with captions drawn live by libass (JASSUB) from the same ASS
 * the final render burns in. Caption edits show up instantly, no re-render.
 */
export interface DrawnBox {
  /** Normalized to the 9:16 output frame. */
  box: { x: number; y: number; w: number; h: number };
  outputMs: number;
}

export function CaptionPlayer({
  src,
  ass,
  poster,
  drawing = false,
  onDraw,
}: {
  src: string | null;
  ass: string | null;
  poster?: string;
  drawing?: boolean;
  onDraw?: (d: DrawnBox) => void;
}) {
  const [drag, setDrag] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
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
  const pos = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) };
  };
  return (
    <div className="relative aspect-[9/16] w-full overflow-hidden rounded-xl bg-black">
      <video ref={video} src={src} poster={poster} controls={!drawing} playsInline crossOrigin="anonymous" className="h-full w-full object-contain" />
      {drawing && (
        <div
          className="absolute inset-0 cursor-crosshair bg-black/10"
          onPointerDown={(e) => {
            video.current?.pause();
            const p = pos(e);
            setDrag({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
            e.currentTarget.setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => drag && setDrag({ ...drag, x1: pos(e).x, y1: pos(e).y })}
          onPointerUp={() => {
            if (drag && Math.abs(drag.x1 - drag.x0) > 0.02 && Math.abs(drag.y1 - drag.y0) > 0.01) {
              onDraw?.({
                box: { x: Math.min(drag.x0, drag.x1), y: Math.min(drag.y0, drag.y1), w: Math.abs(drag.x1 - drag.x0), h: Math.abs(drag.y1 - drag.y0) },
                outputMs: Math.round((video.current?.currentTime ?? 0) * 1000),
              });
            }
            setDrag(null);
          }}
        >
          {drag && (
            <div
              className="absolute border-2 border-accent bg-accent/20"
              style={{ left: `${Math.min(drag.x0, drag.x1) * 100}%`, top: `${Math.min(drag.y0, drag.y1) * 100}%`, width: `${Math.abs(drag.x1 - drag.x0) * 100}%`, height: `${Math.abs(drag.y1 - drag.y0) * 100}%` }}
            />
          )}
        </div>
      )}
    </div>
  );
}
