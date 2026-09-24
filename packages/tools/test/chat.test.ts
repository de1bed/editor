import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildTimeline } from "@editor/core";
import { defaultStyleSettings, StyleSettings, Transcript, type Timeline } from "@editor/schemas";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------- in-memory DB
const mem = {
  clip: null as any,
  versions: new Map<number, Timeline>(),
  messages: [] as any[],
  feedback: [] as any[],
  styleVersions: [] as any[],
};
vi.mock("@editor/db", async () => {
  const { StyleSettings } = await import("@editor/schemas");
  const styleVersion = (v: any) => ({ ...v, settings: StyleSettings.parse(v.settings) });
  return {
    DbError: class extends Error {},
    MEDIA_BUCKET: "media",
    paths: {},
    clips: { get: async () => ({ ...mem.clip }) },
    timelines: {
      get: async (_db: unknown, _id: string, v?: number) => ({ timeline: mem.versions.get(v ?? mem.clip.currentVersion)! }),
      commit: async (_db: unknown, c: any) => {
        if (c.expectedVersion !== mem.clip.currentVersion) throw new Error("conflict");
        const v = c.expectedVersion + 1;
        mem.versions.set(v, { ...c.timeline, version: v });
        mem.clip.currentVersion = v;
        return v;
      },
    },
    chat: {
      thread: async () => "thread1",
      add: async (_db: unknown, m: any) => (mem.messages.push(m), `msg${mem.messages.length}`),
      history: async () => mem.messages.map((m, i) => ({ ...m, id: `msg${i + 1}` })),
    },
    styleProfiles: {
      getOrCreateDefault: async () => ({ profileId: "p1", version: styleVersion(mem.styleVersions.at(-1)) }),
      createVersion: async (_db: unknown, v: any) => {
        const row = styleVersion({ ...v, id: `sv${mem.styleVersions.length + 1}`, version: mem.styleVersions.length + 1 });
        mem.styleVersions.push(row);
        return row;
      },
    },
    feedback: {
      insert: async (_db: unknown, f: any) => (mem.feedback.push(f), `fb${mem.feedback.length}`),
      setProfileVersionAfter: async (_db: unknown, ids: string[], v: string) => ids.forEach((id) => (mem.feedback[Number(id.slice(2)) - 1].profileVersionAfter = v)),
    },
    unappliedFeedbackCount: async () => mem.feedback.filter((f) => !f.profileVersionAfter).length,
    assets: {}, detections: {}, jobs: {}, projects: {}, renders: {}, transcripts: {},
    getDetection: async () => null, signedUrl: async () => "", uploadText: async () => undefined,
    serviceClient: () => ({}),
  };
});

const { setLLM } = await import("@editor/llm");
const { runClipChat } = await import("../src/chat");
const { TOOLS } = await import("../src/tools");
const { toJsonSchema } = await import("@editor/llm");

const transcript = Transcript.parse(JSON.parse(readFileSync(fileURLToPath(new URL("../../../fixtures/transcripts/sample_10s.json", import.meta.url)), "utf8")));
const enqueued: any[] = [];
const ctx = {
  db: {} as never,
  userId: "u1",
  source: "agent" as const,
  scopes: ["read", "edit", "render"] as ("read" | "edit" | "render")[],
  enqueue: async (type: string, input: Record<string, unknown>) => (enqueued.push({ type, input }), { id: `job${enqueued.length}`, status: "queued" }) as never,
};

beforeEach(() => {
  const tl = buildTimeline({ id: "tl", projectId: "p", clipId: "c1", source: { assetId: "a", durationMs: 10_000, width: 640, height: 360, fps: { num: 30, den: 1 } }, transcript, ranges: [{ startMs: 0, endMs: 10_000 }], style: defaultStyleSettings(), styleProfileVersionId: "sv1" });
  mem.clip = { id: "c1", userId: "u1", projectId: "p", title: "Clip", currentVersion: 0, sourceStartMs: 0, sourceEndMs: 10_000, scores: null, justification: null };
  mem.versions = new Map([[0, tl]]);
  mem.messages = [];
  mem.feedback = [];
  mem.styleVersions = [{ id: "sv1", profileId: "p1", version: 1, settings: {}, learnedRules: [], provenance: {}, changeSummary: "", createdBy: "system" }];
  enqueued.length = 0;
});

function fakeLLM(script: (tools: Map<string, any>) => Promise<string>, interpretation: unknown) {
  const calls: any[] = [];
  setLLM({
    name: "anthropic",
    models: { main: "m", fast: "f" },
    async generateObject<T>(args: any) {
      return { object: args.schema.parse(interpretation) as T, usage: { inputTokens: 0, outputTokens: 0 } };
    },
    async runTools(args) {
      calls.push(args);
      const byName = new Map(args.tools.map((t) => [t.name, t]));
      const toolCalls: any[] = [];
      const wrapped = new Map([...byName].map(([n, t]) => [n, { run: async (input: unknown) => {
        const rec: any = { name: n, input };
        try { rec.output = await t.run(t.input.parse(input)); } catch (e) { rec.error = (e as Error).message; }
        toolCalls.push(rec);
        return rec;
      } }]));
      const text = await script(wrapped);
      return { text, toolCalls, usage: { inputTokens: 0, outputTokens: 0 }, stopReason: "end" };
    },
  });
  return calls;
}

describe("runClipChat", () => {
  it("edits via tools, commits a version, queues a preview and learns an explicit preference", async () => {
    const calls = fakeLLM(
      async (tools) => {
        const r = await tools.get("patch_timeline").run({ clipId: "c1", ops: [{ op: "set_caption_style", patch: { fontSizePx: 110, highlightColor: "#FF0000" } }] });
        expect(r.error).toBeUndefined();
        return "Subtítulos más grandes y en rojo. Lo guardé en tu estilo.";
      },
      { kind: "instruction", area: "captions", scope: "always", summary: "Siempre subtítulos grandes y rojos", explicitPreference: { changes: [{ path: "/captions/fontSizePx", value: 110 }, { path: "/captions/highlightColor", value: "#FF0000" }], rule: null } },
    );
    const res = await runClipChat(ctx, "c1", "de ahora en adelante subtítulos más grandes y el resaltado en rojo");
    expect(res).toMatchObject({ versionBefore: 0, versionAfter: 1, learned: { profileVersion: 2 } });
    expect(mem.versions.get(1)!.style.resolved.captions.fontSizePx).toBe(110);
    expect(enqueued).toEqual([{ type: "render_preview", input: { clipId: "c1", version: 1 } }]);
    // profile v2 carries the change with explicit provenance
    const v2 = mem.styleVersions.at(-1);
    expect(v2.settings.captions.fontSizePx).toBe(110);
    expect(v2.provenance["/captions/fontSizePx"]).toMatchObject({ source: "explicit", confidence: 1 });
    // feedback recorded and linked to the new profile version
    expect(mem.feedback).toHaveLength(1);
    expect(mem.feedback[0]).toMatchObject({ kind: "instruction", area: "captions", scope: "always", timelineVersionBefore: 0, timelineVersionAfter: 1, profileVersionAfter: "sv2" });
    // the model saw the compact timeline with word ids, and only the clip tools
    const sys = calls[0].system as string;
    expect(sys).toContain("w7:m*****@4000[C]");
    expect(calls[0].tools.map((t: any) => t.name)).not.toContain("list_projects");
    expect(mem.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
  });

  it("one-off corrections do not touch the profile; tool errors are reported", async () => {
    fakeLLM(
      async (tools) => {
        const bad = await tools.get("patch_timeline").run({ clipId: "c1", ops: [{ op: "delete_segment", segmentId: "nope" }] });
        expect(bad.error).toMatch(/not found/);
        await tools.get("patch_timeline").run({ clipId: "c1", ops: [{ op: "uncensor_word", wordId: "w7" }] });
        return "Quité el bip.";
      },
      { kind: "correction", area: "censorship", scope: "this_clip", summary: "No censurar esa palabra aquí", explicitPreference: null },
    );
    const res = await runClipChat(ctx, "c1", "en este clip no censures esa palabra");
    expect(res.learned).toBeNull();
    expect(res.toolCalls.map((c) => c.ok)).toEqual([false, true]);
    expect(mem.styleVersions).toHaveLength(1);
    expect(mem.versions.get(1)!.audio.events).toHaveLength(0);
    expect(mem.feedback[0]).toMatchObject({ scope: "this_clip" });
    expect(mem.feedback[0].profileVersionAfter).toBeUndefined();
  });
});

describe("tool schemas", () => {
  it("every tool input converts to a closed JSON schema", () => {
    for (const t of TOOLS) {
      const s = toJsonSchema(t.input);
      expect(s.type, t.name).toBe("object");
    }
    expect(TOOLS.map((t) => t.name)).toEqual(
      expect.arrayContaining(["list_projects", "get_transcript", "propose_clips", "get_timeline", "patch_timeline", "add_blur_region", "detect_objects", "set_censorship", "get_style_profile", "update_style_profile", "render_preview", "render_final", "export_otio"]),
    );
  });
});
