import type { ToolRegistry } from "../tools/toolRegistry";
import type { AgentTool } from "../tools/toolRegistry";

export interface MCPResource {
  uri: string;
  description: string;
}

export interface MCPResourceDocument {
  uri: string;
  title: string;
  summary: string;
  content: string;
}

export interface MCPToolDefinition {
  name: string;
  description: string;
  execute(input: unknown): Promise<unknown>;
}

export class MCPClient {
  private readonly resources: MCPResource[] = [
    {
      uri: "mcp://knowledge/electronics_principles",
      description: "Electronics principles knowledge snippets",
    },
    {
      uri: "mcp://knowledge/component_knowledge",
      description: "Component usage and pin behavior snippets",
    },
  ];

  private readonly resourceDocuments: Record<string, MCPResourceDocument> = {
    "mcp://knowledge/electronics_principles": {
      uri: "mcp://knowledge/electronics_principles",
      title: "Electronics Principles",
      summary: "Power-path, decoupling, grounding, and signal integrity quick notes for schematic planning.",
      content:
        "Power paths should keep source, regulation, and load relationships explicit. Decoupling capacitors should be placed close to the consuming device. Ground return paths should remain short and unambiguous. Input and output capacitors around regulators should match the datasheet topology and ESR constraints.",
    },
    "mcp://knowledge/component_knowledge": {
      uri: "mcp://knowledge/component_knowledge",
      title: "Component Knowledge",
      summary: "Common component usage guidance, pin-role reminders, and library selection notes.",
      content:
        "When selecting parts from a library, confirm footprint, symbol, and pin naming consistency before placement. LDOs usually require VIN, VOUT, and GND pin validation. Capacitors should be checked for polarity, package, capacitance, and voltage rating. Prefer components whose metadata clearly identifies manufacturer and package.",
    },
  };

  listResources(): MCPResource[] {
    return this.resources;
  }

  readResource(uri: string): MCPResourceDocument {
    const document = this.resourceDocuments[uri];
    if (!document) {
      throw new Error(`mcp resource not found: ${uri}`);
    }
    return document;
  }

  toTools(): AgentTool[] {
    return [
      {
        name: "mcp_list_resources",
        description: "List MCP resources available to the plugin agent",
        riskLevel: "low",
        execute: async () => ({
          resources: this.listResources(),
        }),
      },
      {
        name: "mcp_read_resource",
        description: "Read a specific MCP resource document by URI",
        riskLevel: "low",
        execute: async (input: { uri: string }) => this.readResource(input.uri),
      },
    ];
  }

  registerTools(registry: ToolRegistry, tools: MCPToolDefinition[]): void {
    for (const tool of this.toTools()) {
      registry.register(tool);
    }
    for (const tool of tools) {
      const safeName = String(tool.name || "").replace(/[^a-zA-Z0-9_-]+/g, "_");
      const wrapped: AgentTool = {
        name: `mcp_${safeName}`,
        description: tool.description ? `${tool.description} (source=${tool.name})` : `MCP tool (source=${tool.name})`,
        riskLevel: "low",
        execute: async (input: unknown) => tool.execute(input),
      };
      registry.register(wrapped);
    }
  }
}
