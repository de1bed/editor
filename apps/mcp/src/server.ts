import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { TOOLS, type ToolContext, ToolError } from "@editor/tools";

/**
 * MCP server exposing the same tools the in-app agent uses. Each call runs
 * with the token owner's identity; tools check ownership of every entity.
 */
export function createMcpServer(ctx: ToolContext): McpServer {
  const server = new McpServer(
    { name: "editor-ia", version: "0.1.0" },
    {
      instructions:
        "Edit vertical short-form clips of the user's videos. The AI never edits pixels: read a clip with get_timeline, change it with patch_timeline (typed EditOps) or the helper tools, then render_preview/render_final. Times are source milliseconds. Use export_otio to open a clip in DaVinci Resolve or Premiere.",
    },
  );
  for (const tool of TOOLS) {
    if (!ctx.scopes.includes(tool.scope)) continue;
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: tool.input as never,
        annotations: { readOnlyHint: tool.scope === "read", destructiveHint: false, openWorldHint: false },
      },
      (async (args: unknown) => {
        try {
          const result = await tool.run(ctx, tool.input.parse(args ?? {}));
          return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
        } catch (e) {
          const msg = e instanceof ToolError || e instanceof Error ? e.message : String(e);
          return { content: [{ type: "text" as const, text: `Error: ${msg}` }], isError: true };
        }
      }) as never,
    );
  }
  return server;
}
