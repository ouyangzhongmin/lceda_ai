export type AgentIntent = "chat" | "analysis" | "draft";

export function classifyAgentIntent(input: string): AgentIntent {
  const trimmed = input.trim();
  const lower = trimmed.toLowerCase();
  const isDraftRequest =
    /生成(?:一版|一个|电路|原理图|草案)?|画(?:一个|一版|出)?|设计(?:一个|一版)?|搭一个|帮我做一个/.test(trimmed) ||
    lower.includes("draft") ||
    lower.includes("generate schematic") ||
    lower.includes("draw");
  if (isDraftRequest) {
    return "draft";
  }

  const isAnalysisRequest =
    /分析|检查|排查|review|analy[sz]e|检查当前|分析当前|看看问题|有什么问题|帮我看下|哪里有问题|有无问题/.test(trimmed) ||
    lower.includes("analyze") ||
    lower.includes("review") ||
    lower.includes("check");
  if (isAnalysisRequest) {
    return "analysis";
  }

  return "chat";
}
