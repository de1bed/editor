#!/usr/bin/env tsx
/**
 * editor-mcp stdio   — for local MCP clients (Claude Desktop/Code). Needs MCP_TOKEN.
 * editor-mcp http    — Streamable HTTP on MCP_PORT (default 8787) at POST /mcp,
 *                      authenticated per request with "Authorization: Bearer <token>".
 * Both need SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (server-side) and the job env.
 */
import { createServer } from "node:http";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { serviceClient } from "@editor/db";
import { enqueueJob } from "@editor/jobs";
import type { ToolContext } from "@editor/tools";
import { resolveToken } from "./auth";
import { createMcpServer } from "./server";

function contextFor(userId: string, scopes: ToolContext["scopes"]): ToolContext {
  const db = serviceClient();
  return { db, userId, scopes, source: "mcp", enqueue: (type, input, projectId) => enqueueJob({ db, userId, projectId, type, input }) };
}

async function stdio() {
  const auth = await resolveToken(serviceClient(), process.env.MCP_TOKEN);
  if (!auth) {
    console.error("MCP_TOKEN is missing or invalid (create one in the app: Mi estilo → Tokens MCP)");
    process.exit(1);
  }
  const server = createMcpServer(contextFor(auth.userId, auth.scopes));
  await server.connect(new StdioServerTransport());
}

async function http() {
  const port = Number(process.env.MCP_PORT ?? 8787);
  createServer(async (req, res) => {
    if (req.url?.split("?")[0] !== "/mcp") {
      res.writeHead(404).end();
      return;
    }
    if (req.method !== "POST") {
      // Stateless server: no SSE stream or session to resume.
      res.writeHead(405, { Allow: "POST" }).end();
      return;
    }
    const token = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
    const auth = await resolveToken(serviceClient(), token);
    if (!auth) {
      res.writeHead(401, { "Content-Type": "application/json", "WWW-Authenticate": "Bearer" }).end(JSON.stringify({ error: "invalid token" }));
      return;
    }
    let raw = "";
    for await (const chunk of req) raw += chunk;
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      res.writeHead(400).end();
      return;
    }
    const server = createMcpServer(contextFor(auth.userId, auth.scopes));
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, body);
  }).listen(port, () => console.error(`editor MCP (HTTP) listening on :${port}/mcp`));
}

const mode = process.argv[2] ?? "stdio";
(mode === "http" ? http() : stdio()).catch((e) => {
  console.error(e);
  process.exit(1);
});
