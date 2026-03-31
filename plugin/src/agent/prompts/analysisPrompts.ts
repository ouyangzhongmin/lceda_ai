import type { SchematicContext } from "../../types/schematic";
import type { SchematicCheckResult } from "../../rules/models/checkResult";

export function buildAnalysisSummaryPrompt(context: SchematicContext): string {
  return [
    `channel=${context.project.channel}`,
    `components=${context.components.length}`,
    `nets=${context.nets.length}`,
    `selection=${context.selection.objectIds.length}`,
  ].join(", ");
}

export function buildAnalysisSystemPrompt(): string {
  return [
    "你是嘉立创 EDA 原理图分析助手。",
    "",
    "## 你的任务",
    "基于插件端 agent 已经收集的证据（原理图上下文、规则检查结果、知识摘要），生成面向工程师的中文分析报告。",
    "",
    "## 重要原则",
    "1. 必须基于已观测到的事实，不能编造未观测到的细节",
    "2. 不要输出内部对象 ID（如 component-xxx）",
    "3. 不要输出 mcp:// URI",
    "4. 引脚对象优先写成网络标签名称",
    "5. 如果信息不足，明确指出缺少什么",
    "",
    "## 输出格式",
    "输出必须是 JSON，格式如下：",
    '{"overview":"","executiveSummary":"","ercSummary":[""],"bomOverview":[""],"functionalBlocks":[""],"powerDomains":[""],"powerPaths":[""],"signalPaths":[""],"controlPaths":[""],"keyComponents":[""],"riskGroups":{"high":[""],"medium":[""],"low":[""]},"keyFindings":[""],"nextSteps":[""]}',
    "",
    "## 字段要求",
    "1. overview: 1-2 句，总结整图用途与总体状态",
    "2. executiveSummary: 1 段（3-5 句），说明整机用途、主控、电源链路和当前主要风险",
    "3. ercSummary: 2-4 条，概括规则检查结果（不要只写 passed/failed）",
    "4. bomOverview: 3-6 条，按器件类别概括数量和代表器件",
    "5. functionalBlocks: 2-5 条，说明主要功能模块及其证据",
    "6. powerDomains: 2-4 条，说明主要电源域与关键负载",
    "7. powerPaths: 2-4 条，说明关键供电路径",
    "8. signalPaths: 2-4 条，说明主要信号链路或接口链路",
    "9. controlPaths: 2-4 条，说明主控到关键外设的链路",
    "10. keyComponents: 3-6 条，说明关键器件与职责",
    "11. riskGroups: 按风险等级整理问题（high/medium/low）",
    "12. keyFindings: 2-4 条，最重要的发现",
    "13. nextSteps: 2-4 条，建议的后续行动",
    "",
    "## 优先级",
    "- 高风险问题（high）必须详细说明",
    "- 电源路径问题优先于信号路径",
    "- 关键器件问题优先于普通器件",
    "- 如果问题过多（>10个），只详细说明前 5 个最严重的",
    "",
    "## 长度控制",
    "- overview: 不超过 50 字",
    "- executiveSummary: 不超过 200 字",
    "- 每条列表项: 不超过 100 字",
    "- 总输出: 控制在 2000 字以内",
    "",
    "## 错误处理",
    "- 如果缺少关键信息，在对应字段中说明",
    "- 如果无法判断，使用‘需要进一步确认’",
    "- 不要编造数据或假设未观测到的连接",
  ].join("\n");
}

export function buildAnalysisUserPrompt(input: {
  userQuery: string;
  context: SchematicContext;
  checkResult: SchematicCheckResult;
  locateLabel?: string;
  mcpSummaries?: Array<{ title: string; summary: string }>;
  libraryInsights?: Array<{ title: string; summary: string }>;
  overviewSummary?: {
    componentCount: number;
    netCount: number;
    selectionCount: number;
    categories: Array<{ category: string; count: number; examples: string[] }>;
    keyComponents: Array<{ ref: string; label: string; reason: string }>;
    functionalBlocks: Array<{ name: string; evidence: string[] }>;
    powerDomains: Array<{ name: string; nodeCount: number; attachedComponents: string[] }>;
    powerPaths?: Array<{ sourceNet: string; path: string[]; note: string }>;
    signalPaths?: Array<{ block: string; path: string[]; note: string }>;
    controlPaths?: Array<{ controller: string; target: string; path: string[]; note: string }>;
    connectivityNotes: string[];
  };
}): string {
  // 限制问题列表长度，避免 prompt 过长
  const maxIssues = 10;
  const issueLines = input.checkResult.issues.slice(0, maxIssues).map((issue, index) => {
    const location = formatIssueLocation(issue.objectType, issue.objectId);
    return `${index + 1}. [${issue.severity}] ${issue.title}${location ? `，位置：${location}` : ""}。说明：${issue.message}${issue.suggestion ? `。建议：${issue.suggestion}` : ""}`;
  });

  if (input.checkResult.issues.length > maxIssues) {
    issueLines.push(`... 还有 ${input.checkResult.issues.length - maxIssues} 个问题未列出`);
  }

  const mcpHints = (input.mcpSummaries ?? [])
    .slice(0, 3)
    .map((item, index) => `${index + 1}. ${item.title}：${item.summary}`);
    
  const libraryHints = (input.libraryInsights ?? [])
    .slice(0, 3)
    .map((item, index) => `${index + 1}. ${item.title}：${item.summary}`);
    
  const overviewSummary = input.overviewSummary;
  
  const categoryHints = (overviewSummary?.categories ?? [])
    .slice(0, 8)
    .map((item, index) => `${index + 1}. ${item.category}：${item.count} 个（例如：${item.examples.slice(0, 3).join("、") || "无"}）`);
    
  const keyComponentHints = (overviewSummary?.keyComponents ?? [])
    .slice(0, 8)
    .map((item, index) => `${index + 1}. ${item.ref}：${item.label}；${item.reason}`);
    
  const functionalBlockHints = (overviewSummary?.functionalBlocks ?? [])
    .slice(0, 6)
    .map((item, index) => `${index + 1}. ${item.name}：${item.evidence.join("、")}`);
    
  const powerDomainHints = (overviewSummary?.powerDomains ?? [])
    .slice(0, 6)
    .map((item, index) => `${index + 1}. ${item.name}：连接 ${item.nodeCount} 个节点；关键器件 ${item.attachedComponents.slice(0, 5).join("、") || "无"}`);
    
  const powerPathHints = (overviewSummary?.powerPaths ?? [])
    .slice(0, 5)
    .map((item, index) => `${index + 1}. ${item.sourceNet}：${item.path.join(" -> ")}；${item.note}`);
    
  const signalPathHints = (overviewSummary?.signalPaths ?? [])
    .slice(0, 5)
    .map((item, index) => `${index + 1}. ${item.block}：${item.path.join(" -> ")}；${item.note}`);
    
  const controlPathHints = (overviewSummary?.controlPaths ?? [])
    .slice(0, 5)
    .map((item, index) => `${index + 1}. ${item.controller} -> ${item.target}：${item.path.join(" -> ")}；${item.note}`);

  return [
    `用户问题：${input.userQuery}`,
    `上下文：${buildAnalysisSummaryPrompt(input.context)}`,
    `检查结果：共 ${input.checkResult.issues.length} 个问题。`,
    input.locateLabel ? `优先定位：${input.locateLabel}` : "",
    overviewSummary
      ? `整图摘要：器件 ${overviewSummary.componentCount} 个，网络 ${overviewSummary.netCount} 条，选区 ${overviewSummary.selectionCount} 个。`
      : "",
    categoryHints.length > 0 ? `器件分类概览：\n${categoryHints.join("\n")}` : "",
    keyComponentHints.length > 0 ? `关键器件：\n${keyComponentHints.join("\n")}` : "",
    functionalBlockHints.length > 0 ? `功能模块：\n${functionalBlockHints.join("\n")}` : "",
    powerDomainHints.length > 0 ? `电源域：\n${powerDomainHints.join("\n")}` : "",
    powerPathHints.length > 0 ? `电源路径：\n${powerPathHints.join("\n")}` : "",
    signalPathHints.length > 0 ? `信号路径：\n${signalPathHints.join("\n")}` : "",
    controlPathHints.length > 0 ? `主控链路：\n${controlPathHints.join("\n")}` : "",
    overviewSummary?.connectivityNotes?.length ? `连接性备注：\n${overviewSummary.connectivityNotes.slice(0, 5).join("\n")}` : "",
    issueLines.length > 0 ? `问题列表：\n${issueLines.join("\n")}` : "问题列表：无",
    libraryHints.length > 0 ? `关联元件库信息：\n${libraryHints.join("\n")}` : "",
    mcpHints.length > 0 ? `知识参考：\n${mcpHints.join("\n")}` : "",
    "请输出 JSON。",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function formatIssueLocation(objectType?: string, objectId?: string): string {
  if (!objectType || !objectId) {
    return "";
  }
  if (objectType === "pin") {
    const pinMatch = objectId.match(/^pin-([^-]+)-(.+)$/i);
    if (pinMatch) {
      return `${pinMatch[1].toUpperCase()} 的 ${pinMatch[2].toUpperCase()} 脚`;
    }
  }
  if (objectType === "component") {
    const ref = objectId.replace(/^component-/i, "").toUpperCase();
    return `器件 ${ref}`;
  }
  if (objectType === "net") {
    return `网络 ${objectId.replace(/^net-/i, "")}`;
  }
  return `${objectType}:${objectId}`;
}
