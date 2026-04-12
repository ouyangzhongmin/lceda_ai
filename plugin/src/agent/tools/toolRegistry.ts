export interface ToolExecutionContext {
  signal?: AbortSignal;
}

export interface AgentTool<Input = unknown, Output = unknown> {
  name: string;
  description: string;
  parameters?: unknown;
  riskLevel?: "low" | "medium" | "high";
  requiresConfirmation?: boolean;
  execute(input: Input, context?: ToolExecutionContext): Promise<Output>;
}

export class ToolRegistry {
  private readonly tools = new Map<string, AgentTool>();

  register(tool: AgentTool): void {
    this.tools.set(tool.name, tool);
  }

  get(name: string): AgentTool | undefined {
    return this.tools.get(name);
  }

  list(): AgentTool[] {
    return Array.from(this.tools.values());
  }

  async invoke<TInput, TOutput>(name: string, input: TInput, context?: ToolExecutionContext): Promise<TOutput> {
    const tool = this.tools.get(name);
    if (!tool) {
      throw new Error(`tool not found: ${name}`);
    }

    return tool.execute(input, context) as Promise<TOutput>;
  }
}
