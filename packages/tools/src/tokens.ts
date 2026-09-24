import { createHash, randomBytes } from "node:crypto";

/** Personal MCP tokens: shown once, stored as sha256. */
export function newMcpToken(): string {
  return `edmcp_${randomBytes(24).toString("base64url")}`;
}

export function hashMcpToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
