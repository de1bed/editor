import { additionalFiles, ffmpeg } from "@trigger.dev/build/extensions/core";
import { defineConfig } from "@trigger.dev/sdk";

export default defineConfig({
  // Your Trigger.dev project ref (dashboard → Project settings).
  project: process.env.TRIGGER_PROJECT_REF ?? "proj_replace_me",
  dirs: ["./src/trigger"],
  runtime: "node",
  maxDuration: 4 * 60 * 60,
  retries: { enabledInDev: false, default: { maxAttempts: 3, factor: 3, minTimeoutInMs: 5_000, maxTimeoutInMs: 60_000 } },
  // ffmpeg lets MEDIA_WORKER=local run ingest/render on Trigger.dev machines as a fallback to Modal.
  // Caption fonts are copied next to the bundle; set FONTS_DIR accordingly in the Trigger.dev env.
  build: { extensions: [ffmpeg(), additionalFiles({ files: ["../../assets/fonts/**"] })] },
});
