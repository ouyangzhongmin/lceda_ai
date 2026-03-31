import type { AgentPlanStepKind, AgentTurnPlan } from "../shared/agentTypes";

export function buildPlannerSystemPrompt(): string {
  return [
    "你是嘉立创 EDA 插件端 agent 的 planner。",
    "你的职责是根据用户输入判断本轮主 route、是否需要上下文、执行步骤，以及是否存在后续阶段。",
    "",
    "## 可用路由",
    "- analysis: 分析、检查、排查、解释当前原理图问题",
    "- draft: 生成、修改、设计原理图草案",
    "- chat: 自然问答、澄清需求、解释概念",
    "",
    "## 可用步骤",
    "- context: 读取当前原理图上下文（器件、网络、连接关系）",
    "- mcp: 检索工程知识、设计规范、参考资料",
    "- rules: 运行原理图检查规则，定位问题",
    "- library: 检索器件库，查找候选元件",
    "- llm: 调用 LLM 生成分析报告或回复",
    "- draft: 生成结构化草案与预览",
    "",
    "## 步骤选择规则",
    "- context: 需要读取原理图时必选",
    "- mcp: 需要检索工程知识、参考设计时选择",
    "- rules: 需要检查原理图问题时必选（analysis 路由）",
    "- library: 需要查找器件时必选（draft 路由）",
    "- llm: 需要 LLM 生成内容时必选",
    "- draft: 生成草案时必选（draft 路由）",
    "",
    "## 多阶段任务",
    "如果请求包含先分析再生成草案、先检查再建议修改，优先主 route=analysis，并设置 followup.route=draft。",
    "如果请求明确要求设计、生成、绘制电路，route=draft。",
    "",
    "## 输出格式",
    "输出必须是 JSON：",
    '{"intent":"chat|analysis|draft","route":"chat|analysis|draft","requiresContext":true,"steps":["context","mcp","rules","library","llm","draft"],"followup":{"route":"chat|analysis|draft","requiresContext":true,"steps":["context","mcp","rules","library","llm","draft"],"when":"..."}}',
    "",
    "如果没有后续阶段，followup 省略。",
  ].join("\n");
}

export function buildPlannerUserPrompt(userQuery: string, intentHint?: string): string {
  return [
    `用户输入：${userQuery}`,
    intentHint ? `意图提示：${intentHint}` : "",
    "",
    "## 示例 1：分析请求",
    '用户输入："检查一下当前原理图有什么问题"',
    '输出：{"intent":"analysis","route":"analysis","requiresContext":true,"steps":["context","mcp","rules","llm"]}',
    "",
    "## 示例 2：草案生成",
    '用户输入："帮我设计一个 ESP32 的最小系统"',
    '输出：{"intent":"draft","route":"draft","requiresContext":true,"steps":["context","mcp","library","llm","draft"]}',
    "",
    "## 示例 3：多阶段任务",
    '用户输入："先分析问题，然后生成修复方案"',
    '输出：{"intent":"analysis","route":"analysis","requiresContext":true,"steps":["context","mcp","rules","llm"],"followup":{"route":"draft","requiresContext":true,"steps":["library","llm","draft"],"when":"分析完成后"}}',
    "",
    "## 示例 4：纯聊天",
    '用户输入："ESP32 和 ESP8266 有什么区别？"',
    '输出：{"intent":"chat","route":"chat","requiresContext":false,"steps":["llm"]}',
    "",
    "请输出 JSON plan。",
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildFallbackPlan(intent: "chat" | "analysis" | "draft"): AgentTurnPlan {
  if (intent === "draft") {
    return {
      intent,
      route: "draft",
      requiresContext: true,
      steps: [
        step("context", "读取当前原理图上下文"),
        step("mcp", "检索相关工程知识与参考资料"),
        step("library", "检索器件库与候选元件"),
        step("llm", "调用 LLM 生成草案规划提示"),
        step("rules", "校验草案约束与风险"),
        step("draft", "生成草案计划与预览"),
      ],
    };
  }
  if (intent === "analysis") {
    return {
      intent,
      route: "analysis",
      requiresContext: true,
      steps: [
        step("context", "读取当前原理图上下文"),
        step("mcp", "检索相关工程知识与参考资料"),
        step("rules", "运行原理图检查并定位问题"),
        step("llm", "生成分析报告"),
      ],
    };
  }
  return {
    intent,
    route: "chat",
    requiresContext: false,
    steps: [step("llm", "自然对话回复")],
  };
}

export function normalizePlannerPlan(rawText: string | undefined): AgentTurnPlan | undefined {
  if (!rawText) {
    console.warn("[Planner] Empty response from LLM");
    return undefined;
  }
  
  try {
    const jsonText = extractJson(rawText);
    const parsed = JSON.parse(jsonText) as Partial<{
      intent: "chat" | "analysis" | "draft";
      route: "chat" | "analysis" | "draft";
      requiresContext: boolean;
      steps: AgentPlanStepKind[];
      followup?: {
        route: "chat" | "analysis" | "draft";
        requiresContext: boolean;
        steps: AgentPlanStepKind[];
        when?: string;
      };
    }>;
    
    if (!parsed.intent || !parsed.route || !Array.isArray(parsed.steps)) {
      console.warn("[Planner] Invalid plan structure:", { parsed });
      return undefined;
    }
    
    const allowed: AgentPlanStepKind[] = ["context", "mcp", "rules", "library", "llm", "draft"];
    const steps = parsed.steps.filter((item): item is AgentPlanStepKind => allowed.includes(item));
    
    if (steps.length === 0) {
      console.warn("[Planner] No valid steps in plan");
      return undefined;
    }
    
    return {
      intent: parsed.intent,
      route: parsed.route,
      requiresContext: Boolean(parsed.requiresContext),
      steps: steps.map((kind) => step(kind, stepNote(kind))),
      followup:
        parsed.followup &&
        parsed.followup.route &&
        Array.isArray(parsed.followup.steps) &&
        parsed.followup.steps.length > 0
          ? {
              route: parsed.followup.route,
              requiresContext: Boolean(parsed.followup.requiresContext),
              steps: parsed.followup.steps
                .filter((item): item is AgentPlanStepKind => allowed.includes(item))
                .map((kind) => step(kind, stepNote(kind))),
              when: parsed.followup.when,
            }
          : undefined,
    };
  } catch (error) {
    console.error("[Planner] Failed to parse LLM response:", {
      rawText: rawText.substring(0, 200),
      error: error instanceof Error ? error.message : String(error),
    });
    return undefined;
  }
}

function stepNote(kind: AgentPlanStepKind): string {
  switch (kind) {
    case "context":
      return "读取当前原理图上下文";
    case "mcp":
      return "检索相关工程知识与参考资料";
    case "rules":
      return "运行原理图检查并定位问题";
    case "library":
      return "检索器件库与候选元件";
    case "llm":
      return "调用 LLM 生成分析/回复";
    case "draft":
      return "生成结构化草案与预览";
    default:
      return `执行步骤 ${kind}`;
  }
}

function step(kind: AgentPlanStepKind, note: string) {
  return { kind, required: true, note };
}

function extractJson(text: string): string {
  const match = text.match(/\{[\s\S]*\}/);
  return match ? match[0] : text;
}
