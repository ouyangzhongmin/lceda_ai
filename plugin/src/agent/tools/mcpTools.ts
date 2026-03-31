import type { AgentTool } from "./toolRegistry";
import type { MCPClient } from "../mcp/mcpClient";

export function createMcpTools(client: MCPClient | undefined): AgentTool[] {
  if (!client) {
    return [];
  }
  return client.toTools();
}
