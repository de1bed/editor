import { readFileSync } from "node:fs";
import { join } from "node:path";
import { notFound } from "next/navigation";
import { timelineToAss } from "@editor/core";
import { Timeline } from "@editor/schemas";
import { CaptionPlayer } from "@/components/caption-player";

export const dynamic = "force-dynamic";

/** Development-only (or ENABLE_DEV_PAGES=true): fixture preview + live captions (run `pnpm dev:fixture` first). */
export default async function DevPlayer({ searchParams }: { searchParams: Promise<{ webm?: string }> }) {
  const { webm } = await searchParams;
  if (process.env.NODE_ENV === "production" && process.env.ENABLE_DEV_PAGES !== "true") notFound();
  const root = join(process.cwd(), "..", "..");
  const timeline = Timeline.parse(JSON.parse(readFileSync(join(root, "fixtures/plans/sample.timeline.json"), "utf8")));
  return (
    <div className="mx-auto max-w-xs">
      <CaptionPlayer src={webm ? "/dev-fixture/preview.webm" : "/dev-fixture/preview.mp4"} ass={timelineToAss(timeline)} />
    </div>
  );
}
