import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);

export interface ProbeResult {
  durationMs: number;
  width: number;
  height: number;
  fps: { num: number; den: number };
  hasAudio: boolean;
  videoCodec: string | null;
  audioCodec: string | null;
}

export async function probe(path: string, ffprobePath = "ffprobe"): Promise<ProbeResult> {
  const { stdout } = await exec(ffprobePath, ["-v", "error", "-print_format", "json", "-show_streams", "-show_format", path]);
  const j = JSON.parse(stdout) as {
    streams: { codec_type: string; codec_name: string; width?: number; height?: number; avg_frame_rate?: string; r_frame_rate?: string }[];
    format: { duration?: string };
  };
  const v = j.streams.find((s) => s.codec_type === "video");
  const a = j.streams.find((s) => s.codec_type === "audio");
  const [num, den] = (v?.avg_frame_rate && v.avg_frame_rate !== "0/0" ? v.avg_frame_rate : (v?.r_frame_rate ?? "30/1")).split("/").map(Number);
  return {
    durationMs: Math.round(Number(j.format.duration ?? 0) * 1000),
    width: v?.width ?? 0,
    height: v?.height ?? 0,
    fps: { num: num || 30, den: den || 1 },
    hasAudio: Boolean(a),
    videoCodec: v?.codec_name ?? null,
    audioCodec: a?.codec_name ?? null,
  };
}

/** Mean volume (dB) of an audio window, via ffmpeg's volumedetect. */
export async function meanVolumeDb(path: string, startMs: number, durationMs: number, ffmpegPath = "ffmpeg"): Promise<number> {
  const { stderr } = await exec(ffmpegPath, [
    "-hide_banner", "-nostdin", "-ss", (startMs / 1000).toFixed(3), "-t", (durationMs / 1000).toFixed(3), "-i", path,
    "-af", "volumedetect", "-vn", "-f", "null", "-",
  ]);
  const m = /mean_volume:\s*(-?[\d.]+|-inf) dB/.exec(stderr);
  if (!m) throw new Error("volumedetect produced no output");
  return m[1] === "-inf" ? Number.NEGATIVE_INFINITY : Number(m[1]);
}

/** Dominant frequency test: energy through a narrow band-pass around `hz`, in dB. */
export async function bandVolumeDb(path: string, startMs: number, durationMs: number, hz: number, ffmpegPath = "ffmpeg"): Promise<number> {
  const { stderr } = await exec(ffmpegPath, [
    "-hide_banner", "-nostdin", "-ss", (startMs / 1000).toFixed(3), "-t", (durationMs / 1000).toFixed(3), "-i", path,
    "-af", `bandpass=f=${hz}:width_type=q:w=8,bandpass=f=${hz}:width_type=q:w=8,volumedetect`, "-vn", "-f", "null", "-",
  ]);
  const m = /mean_volume:\s*(-?[\d.]+|-inf) dB/.exec(stderr);
  if (!m) throw new Error("volumedetect produced no output");
  return m[1] === "-inf" ? Number.NEGATIVE_INFINITY : Number(m[1]);
}

/** Extracts one frame as raw grayscale bytes (w*h). */
export async function grayFrame(path: string, atMs: number, ffmpegPath = "ffmpeg"): Promise<{ data: Buffer; width: number; height: number }> {
  const p = await probe(path);
  const { stdout } = await exec(
    ffmpegPath,
    ["-hide_banner", "-nostdin", "-ss", (atMs / 1000).toFixed(3), "-i", path, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "gray", "-"],
    { encoding: "buffer", maxBuffer: 64 * 1024 * 1024 },
  );
  return { data: stdout as unknown as Buffer, width: p.width, height: p.height };
}

/** Pixel-intensity variance inside a normalized box of a gray frame (low = blurred/flat). */
export function regionVariance(frame: { data: Buffer; width: number; height: number }, box: { x: number; y: number; w: number; h: number }): number {
  const x0 = Math.floor(box.x * frame.width);
  const y0 = Math.floor(box.y * frame.height);
  const x1 = Math.ceil((box.x + box.w) * frame.width);
  const y1 = Math.ceil((box.y + box.h) * frame.height);
  let sum = 0;
  let sq = 0;
  let n = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const v = frame.data[y * frame.width + x]!;
      sum += v;
      sq += v * v;
      n++;
    }
  }
  const mean = sum / n;
  return sq / n - mean * mean;
}

/** Mean absolute difference between neighbouring pixels inside a normalized box (low = blurred). */
export function regionSharpness(frame: { data: Buffer; width: number; height: number }, box: { x: number; y: number; w: number; h: number }): number {
  const x0 = Math.floor(box.x * frame.width);
  const y0 = Math.floor(box.y * frame.height);
  const x1 = Math.ceil((box.x + box.w) * frame.width) - 1;
  const y1 = Math.ceil((box.y + box.h) * frame.height) - 1;
  let sum = 0;
  let n = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const v = frame.data[y * frame.width + x]!;
      sum += Math.abs(v - frame.data[y * frame.width + x + 1]!) + Math.abs(v - frame.data[(y + 1) * frame.width + x]!);
      n++;
    }
  }
  return sum / n;
}
