import { describe, expect, it, vi } from "vitest";

vi.mock("@editor/db", () => ({
  DbError: class extends Error {},
  MEDIA_BUCKET: "media",
  paths: {},
  projects: {
    list: async (_db: unknown, userId: string) => [{ id: "p1", userId, name: "Podcast 12", status: "ready", createdAt: "2026-09-24" }],
    get: async (_db: unknown, id: string) => ({ id, userId: "someone-else", name: "x" }),
  },
  clips: { get: async () => ({ id: "c1", userId: "someone-else" }), list: async () => [] },
  assets: {}, chat: {}, detections: {}, feedback: {}, jobs: {}, renders: {}, styleProfiles: {}, timelines: {}, transcripts: {},
  getDetection: async () => null, signedUrl: async () => "", uploadText: async () => undefined, serviceClient: () => ({}),
}));

const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");
const { createMcpServer } = await import("../src/server");
const { hashToken, newToken } = await import("../src/auth");

async function connect(scopes: ("read" | "edit" | "render")[]) {
  const server = createMcpServer({ db: {} as never, userId: "u1", scopes, source: "mcp", enqueue: async () => ({ id: "j1" }) as never });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "1" });
  await Promise.all([server.connect(a), client.connect(b)]);
  return client;
}

describe("MCP server", () => {
  it("exposes the editing tools with JSON schemas", async () => {
    const client = await connect(["read", "edit", "render"]);
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    for (const n of ["list_projects", "get_transcript", "propose_clips", "get_timeline", "patch_timeline", "add_blur_region", "detect_objects", "set_censorship", "get_style_profile", "update_style_profile", "render_preview", "render_final", "export_otio"]) {
      expect(names).toContain(n);
    }
    const patch = tools.find((t) => t.name === "patch_timeline")!;
    expect(patch.inputSchema.type).toBe("object");
    expect(Object.keys(patch.inputSchema.properties ?? {})).toEqual(expect.arrayContaining(["clipId", "ops"]));
  });

  it("read-only tokens only see read tools", async () => {
    const client = await connect(["read"]);
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).toContain("get_timeline");
    expect(names).not.toContain("patch_timeline");
    expect(names).not.toContain("render_final");
  });

  it("runs tools as the token owner and never leaks other users' data", async () => {
    const client = await connect(["read", "edit", "render"]);
    const ok = await client.callTool({ name: "list_projects", arguments: {} });
    expect(JSON.parse((ok.content as { text: string }[])[0]!.text)).toEqual([{ id: "p1", name: "Podcast 12", status: "ready", createdAt: "2026-09-24" }]);
    const denied = await client.callTool({ name: "get_timeline", arguments: { clipId: "c1" } });
    expect(denied.isError).toBe(true);
    expect((denied.content as { text: string }[])[0]!.text).toMatch(/not found/);
  });

  it("tokens are random and stored hashed", () => {
    const t = newToken();
    expect(t).toMatch(/^edmcp_[\w-]{32}$/);
    expect(hashToken(t)).toMatch(/^[0-9a-f]{64}$/);
    expect(newToken()).not.toBe(t);
  });
});
