import type { MainPanelState } from "../../ui/panels/mainPanel";
import type { LlmMessage } from "../../services/llm/llmProxyClient";

export function buildNaturalChatMessages(state: MainPanelState, userInput: string): LlmMessage[] {
  // 保留最近 6 轮对话
  const recentTurns = (state.chatMessages ?? [])
    .filter((message) => message.role === "user" || message.role === "assistant")
    .slice(-6)
    .map<LlmMessage>((message) => ({
      role: message.role,
      content: message.content,
    }));

  return [
    {
      role: "system",
      content: [
        "你是嘉立创 EDA 插件中的 AI 助手。",
        "",
        "## 你的职责",
        "- 自然聊天、理解需求、简洁回答",
        "- 如果插件端已经提供了编辑器上下文、选区摘要、RAG 证据或元件库查询结果，你必须优先基于这些事实回答",
        "- 不能忽略工具观测到的信息",
        "",
        "## 重要原则",
        "1. 不要把问候、寒暄或普通闲聊误判成分析请求",
        "2. 不要假装已经执行了原理图检查",
        "3. 如果用户目标还不明确，先追问澄清，不要直接输出分析结论",
        "4. 如果当前缺少原理图上下文，不要输出‘unknown/0’等占位信息",
        "5. 如果需要原理图信息但没有，明确告诉用户需要打开原理图页面或允许读取上下文",
        "",
        "## 错误处理",
        "- 如果信息不足，明确说明缺少什么",
        "- 如果无法完成任务，说明原因和替代方案",
        "- 不要编造信息或假装完成了任务",
      ].join("\n"),
    },
    ...recentTurns,
    {
      role: "user",
      content: userInput,
    },
  ];
}

export function buildChatToolUserPrompt(input: {
  userQuery: string;
  editorContextSummary?: string;
  selectionSummary?: string;
  ragSummary?: string[];
  librarySummary?: string[];
}): string {
  return [
    `用户问题：${input.userQuery}`,
    input.editorContextSummary ? `原理图上下文：${input.editorContextSummary}` : "",
    input.selectionSummary ? `当前选区：${input.selectionSummary}` : "",
    input.librarySummary && input.librarySummary.length > 0 
      ? `元件库信息：\n${input.librarySummary.slice(0, 5).map((item, index) => `${index + 1}. ${item}`).join("\n")}` 
      : "",
    input.ragSummary && input.ragSummary.length > 0 
      ? `知识证据：\n${input.ragSummary.slice(0, 5).map((item, index) => `${index + 1}. ${item}`).join("\n")}` 
      : "",
    "",
    "请基于以上事实自然回复用户。",
    "若信息仍不足，明确指出缺什么。",
    "不要编造未观测到的原理图细节。",
  ]
    .filter(Boolean)
    .join("\n\n");
}
