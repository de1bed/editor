import { runFfmpeg } from "./execute";

const BIN = () => process.env.FFMPEG_PATH ?? "ffmpeg";

/** Same outputs as workers/media/media/ffmpeg.py (CFR proxy with audio, 16 kHz mono WAV, thumbnail). */
export async function makeProxy(src: string, dest: string, height: number, hasAudio: boolean, durationMs: number, onProgress?: (f: number) => void) {
  const inputs = ["-i", src];
  const maps = ["-map", "0:v:0"];
  if (hasAudio) maps.push("-map", "0:a:0");
  else {
    inputs.push("-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo");
    maps.push("-map", "1:a:0", "-shortest");
  }
  await runFfmpeg(
    BIN(),
    [
      "-hide_banner", "-nostdin", "-y", "-progress", "pipe:1", "-nostats",
      ...inputs, ...maps,
      "-vf", `scale=-2:${height}:flags=bicubic,fps=30,format=yuv420p`,
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "26", "-g", "30", "-keyint_min", "30", "-sc_threshold", "0",
      "-c:a", "aac", "-b:a", "128k", "-ar", "48000", "-ac", "2", "-movflags", "+faststart", dest,
    ],
    durationMs,
    { onProgress },
  );
}

export async function extractAudio(src: string, dest: string, durationMs: number, onProgress?: (f: number) => void) {
  await runFfmpeg(
    BIN(),
    ["-hide_banner", "-nostdin", "-y", "-progress", "pipe:1", "-nostats", "-i", src, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", dest],
    durationMs,
    { onProgress },
  );
}

export async function thumbnail(src: string, dest: string, atMs: number) {
  await runFfmpeg(
    BIN(),
    ["-hide_banner", "-nostdin", "-y", "-ss", (atMs / 1000).toFixed(3), "-i", src, "-frames:v", "1", "-vf", "scale=-2:360", "-q:v", "4", dest],
    0,
    {},
  );
}
