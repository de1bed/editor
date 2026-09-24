import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { RenderPlan } from "@editor/schemas";

export const DEFAULT_FONTS_DIR = resolve(fileURLToPath(new URL("../../../assets/fonts", import.meta.url)));

export interface ExecuteOptions {
  /** Local path or http(s) URL for each input key of the plan. */
  resolveInput: (key: string, input: RenderPlan["inputs"][string]) => string | Promise<string>;
  outputPath: string;
  fontsDir?: string;
  ffmpegPath?: string;
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}

/**
 * Runs a RenderPlan with the local ffmpeg binary. The Python worker on Modal
 * implements the same placeholder substitution (workers/media/media/render.py).
 */
export async function executeRenderPlan(plan: RenderPlan, opts: ExecuteOptions): Promise<{ outputPath: string; stderr: string }> {
  const work = await mkdtemp(join(tmpdir(), "render-"));
  try {
    const files: Record<string, string> = {};
    for (const [name, content] of Object.entries(plan.files)) {
      const p = join(work, name);
      await writeFile(p, content, "utf8");
      files[name] = p;
    }
    const inputs: Record<string, string> = {};
    for (const [key, input] of Object.entries(plan.inputs)) inputs[key] = await opts.resolveInput(key, input);
    const fontsDir = opts.fontsDir ?? process.env.FONTS_DIR ?? DEFAULT_FONTS_DIR;
    const args = substitute(plan.args, { inputs, files, fontsDir, output: opts.outputPath });
    const stderr = await runFfmpeg(opts.ffmpegPath ?? "ffmpeg", ["-progress", "pipe:1", "-nostats", ...args], plan.output.durationMs, opts);
    return { outputPath: opts.outputPath, stderr };
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

export function substitute(
  args: string[],
  ctx: { inputs: Record<string, string>; files: Record<string, string>; fontsDir: string; output: string },
): string[] {
  return args.map((a) =>
    a
      .replace(/\{\{input:([^}]+)\}\}/g, (_, k: string) => {
        const v = ctx.inputs[k];
        if (!v) throw new Error(`render plan references unknown input "${k}"`);
        return v;
      })
      .replace(/\{\{file:([^}]+)\}\}/g, (_, k: string) => {
        const v = ctx.files[k];
        if (!v) throw new Error(`render plan references unknown file "${k}"`);
        return escapeFilterPath(v);
      })
      .replace(/\{\{fontsdir\}\}/g, () => escapeFilterPath(ctx.fontsDir))
      .replace(/\{\{output\}\}/g, () => ctx.output),
  );
}

/** Paths inside filtergraph option values: escape the characters the parser treats specially. */
function escapeFilterPath(p: string): string {
  return p.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'");
}

export function runFfmpeg(
  bin: string,
  args: string[],
  durationMs: number,
  opts: Pick<ExecuteOptions, "onProgress" | "signal">,
): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"], signal: opts.signal });
    let stderr = "";
    child.stderr.on("data", (d: Buffer) => {
      stderr += d.toString();
      if (stderr.length > 200_000) stderr = stderr.slice(-100_000);
    });
    child.stdout.on("data", (d: Buffer) => {
      const m = /out_time_us=(\d+)/.exec(d.toString());
      if (m && opts.onProgress && durationMs > 0) opts.onProgress(Math.min(1, Number(m[1]) / 1000 / durationMs));
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolvePromise(stderr);
      else reject(new Error(`ffmpeg exited with ${code}\n${stderr.slice(-4000)}`));
    });
  });
}
