import type { SchematicContext } from "../../types/schematic";
import type { SchematicCheckResult } from "../../rules/models/checkResult";
import type { SchematicAnalysisEvidence } from "../tools/schematicSummaryTools";

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
    "2. 禁止输出内部对象 ID、UUID、primitiveId、pageId 这类调试标识",
    "3. 不要输出 mcp:// URI",
    "4. 优先使用人类可读标识：位号、器件名称、封装名、网络名、功能模块名",
    "5. 如果证据不足，明确写“当前证据不足以判断”，不要脑补",
    "6. 如果问题主要是属性类问题（如缺少封装/数值），不要夸大成连接错误或电源冲突",
    "7. 不要空泛复述“建议优先处理高风险连接错误”，除非证据里真的有高风险连接错误",
    "",
    "## 输出格式",
    "输出必须是 JSON，格式如下：",
    '{"overview":"","executiveSummary":"","ercSummary":[""],"bomOverview":[""],"functionalBlocks":[""],"powerDomains":[""],"powerPaths":[""],"signalPaths":[""],"controlPaths":[""],"keyComponents":[""],"riskGroups":{"high":[""],"medium":[""],"low":[""]},"keyFindings":[""],"nextSteps":[""]}',
    "",
    "## 字段要求",
    "1. overview: 1-2 句，直接总结当前原理图最主要的问题类型和状态",
    "2. executiveSummary: 1 段（3-5 句），必须覆盖‘这张图大致是什么 + 当前最重要的 2-3 类问题 + 证据边界’",
    "3. ercSummary: 2-4 条，优先写问题分布、严重度统计、最典型问题，不要只写总数",
    "4. bomOverview: 3-6 条，按器件类别概括数量和代表器件；没有可靠证据时可少写",
    "5. functionalBlocks: 2-5 条，只写有证据支持的模块",
    "6. powerDomains: 2-4 条，只写有证据支持的电源域与负载",
    "7. powerPaths: 2-4 条，只写有证据支持的电源路径；不足时允许为空数组",
    "8. signalPaths: 2-4 条，只写有证据支持的信号链路；不足时允许为空数组",
    "9. controlPaths: 2-4 条，只写有证据支持的主控链路；不足时允许为空数组",
    "10. keyComponents: 3-6 条，优先写真实位号/名称，不要写内部 ID",
    "11. riskGroups: 按风险等级整理问题，必须引用人类可读对象；没有 high 就留空",
    "12. keyFindings: 2-4 条，每条都要包含‘发现 + 证据/对象 + 影响’",
    "13. nextSteps: 2-4 条，必须具体可执行，不要只写‘修复后重试’",
    "",
    "## 优先级",
    "- 高风险问题（high）必须详细说明",
    "- 如果 high=0，就不要再写‘优先处理高风险连接错误’这类套话",
    "- 优先说明已知证据最充分的问题类型",
    "- 如果问题过多（>10个），聚合相同类型问题，再点名 3-5 个代表对象",
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
  analysisEvidence?: SchematicAnalysisEvidence;
}): string {
  const issueSummary = summarizeIssuesForPrompt(input.context, input.checkResult);
  const issueGroupLines = issueSummary.groups.map((item, index) =>
    `${index + 1}. [${item.severity}] ${item.title}：${item.count} 个。代表对象：${item.examples.join("、") || "无"}。典型说明：${item.exampleMessage}${item.suggestion ? `。建议：${item.suggestion}` : ""}`
  );
  const issueSampleLines = issueSummary.samples.map((item, index) =>
    `${index + 1}. [${item.severity}] ${item.title}，对象：${item.label}。说明：${item.message}${item.suggestion ? `。建议：${item.suggestion}` : ""}`
  );

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
  const analysisEvidence = input.analysisEvidence;
  const evidenceComponentHints = (analysisEvidence?.keyComponents ?? [])
    .slice(0, 8)
    .map(
      (item, index) =>
        `${index + 1}. ${item.ref}${item.name ? ` / ${item.name}` : ""}${item.value ? ` / ${item.value}` : ""}${item.packageName ? ` / ${item.packageName}` : ""}；角色：${item.reasons.join("、")}；引脚网络：${item.pins
          .slice(0, 8)
          .map((pin) => `${pin.pin}${pin.net ? `->${pin.net}` : ""}`)
          .join("，")}`
    );
  const evidenceNetHints = (analysisEvidence?.representativeNets ?? [])
    .slice(0, 10)
    .map((item, index) => `${index + 1}. ${item.name}${item.isPower ? "（电源）" : ""}：成员 ${item.members.join("、") || "无"}`);
  const evidenceNotableHints = (analysisEvidence?.notableComponents ?? [])
    .slice(0, 12)
    .map((item, index) => `${index + 1}. ${item.label}；类别：${item.category}；关联网络：${item.nets.join("、") || "无"}`);

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
    evidenceComponentHints.length > 0 ? `关键器件与引脚网络证据：\n${evidenceComponentHints.join("\n")}` : "",
    evidenceNetHints.length > 0 ? `代表性网络证据：\n${evidenceNetHints.join("\n")}` : "",
    evidenceNotableHints.length > 0 ? `代表性器件与关联网络：\n${evidenceNotableHints.join("\n")}` : "",
    overviewSummary?.connectivityNotes?.length ? `连接性备注：\n${overviewSummary.connectivityNotes.slice(0, 5).join("\n")}` : "",
    issueGroupLines.length > 0 ? `问题聚合：\n${issueGroupLines.join("\n")}` : "问题聚合：无",
    issueSampleLines.length > 0 ? `问题样本：\n${issueSampleLines.join("\n")}` : "",
    libraryHints.length > 0 ? `关联元件库信息：\n${libraryHints.join("\n")}` : "",
    mcpHints.length > 0 ? `知识参考：\n${mcpHints.join("\n")}` : "",
    "写作要求：优先从关键器件、关键网络、引脚连接关系出发下结论；不要输出内部对象 ID；如果当前问题主要是属性缺失，就明确写成属性完整性问题，不要夸大成连接错误；如果无法确认具体器件位号，就写“某器件/某网络”，不要写 UUID。",
    "请输出 JSON。",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function formatIssueLocation(objectType?: string, objectId?: string): string {
  if (!objectType || !objectId) {
    return "";
  }
  if (objectType === "pin" && /^pin-([^-]+)-(.+)$/i.test(objectId)) {
    const pinMatch = objectId.match(/^pin-([^-]+)-(.+)$/i);
    if (pinMatch) {
      return `${pinMatch[1].toUpperCase()} 的 ${pinMatch[2].toUpperCase()} 脚`;
    }
  }
  if (objectType === "component" && /^component-/i.test(objectId)) {
    return `器件 ${objectId.replace(/^component-/i, "").toUpperCase()}`;
  }
  if (objectType === "net" && /^net-/i.test(objectId)) {
    return `网络 ${objectId.replace(/^net-/i, "")}`;
  }
  return "";
}

function summarizeIssuesForPrompt(
  context: SchematicContext,
  checkResult: SchematicCheckResult
): {
  groups: Array<{
    severity: string;
    title: string;
    count: number;
    examples: string[];
    exampleMessage: string;
    suggestion?: string;
  }>;
  samples: Array<{
    severity: string;
    title: string;
    label: string;
    message: string;
    suggestion?: string;
  }>;
} {
  const groups = new Map<string, {
    severity: string;
    title: string;
    count: number;
    examples: string[];
    exampleMessage: string;
    suggestion?: string;
  }>();
  const samples: Array<{
    severity: string;
    title: string;
    label: string;
    message: string;
    suggestion?: string;
  }> = [];

  for (const issue of checkResult.issues.slice(0, 24)) {
    const label = describeIssueObject(context, issue.objectType, issue.objectId);
    const message = sanitizeIssueText(issue.message, label);
    const key = `${issue.severity}:${issue.title}`;
    const existing = groups.get(key);
    if (existing) {
      existing.count += 1;
      if (label && existing.examples.length < 4 && !existing.examples.includes(label)) {
        existing.examples.push(label);
      }
    } else {
      groups.set(key, {
        severity: issue.severity,
        title: issue.title,
        count: 1,
        examples: label ? [label] : [],
        exampleMessage: message,
        suggestion: issue.suggestion,
      });
    }
    if (samples.length < 8) {
      samples.push({
        severity: issue.severity,
        title: issue.title,
        label: label || "当前对象",
        message,
        suggestion: issue.suggestion,
      });
    }
  }

  return {
    groups: Array.from(groups.values()).sort((a, b) => severityOrder(a.severity) - severityOrder(b.severity) || b.count - a.count).slice(0, 6),
    samples,
  };
}

function describeIssueObject(
  context: SchematicContext,
  objectType?: string,
  objectId?: string
): string {
  if (!objectType || !objectId) {
    return "";
  }
  if (objectType === "component") {
    const component = context.components.find((item) => item.id === objectId);
    if (!component) return "";
    return [safeIssueText(component.ref), safeIssueText(component.name), safeIssueText(component.value), safeIssueText(component.packageName)]
      .filter(Boolean)
      .join(" / ");
  }
  if (objectType === "pin") {
    const pin = context.pins.find((item) => item.id === objectId);
    if (!pin) return "";
    const component = context.components.find((item) => item.id === pin.componentId);
    return [
      safeIssueText(component?.ref) || safeIssueText(component?.name),
      safeIssueText(pin.pinName) || safeIssueText(pin.pinNumber) ? `${safeIssueText(pin.pinName) || ""}${safeIssueText(pin.pinNumber) ? `(${safeIssueText(pin.pinNumber)})` : ""}` : "",
      safeIssueText(pin.netName) ? `网络 ${safeIssueText(pin.netName)}` : "",
    ]
      .filter(Boolean)
      .join(" / ");
  }
  if (objectType === "net") {
    const net = context.nets.find((item) => item.id === objectId);
    return safeIssueText(net?.name) ? `网络 ${safeIssueText(net?.name)}` : "";
  }
  return "";
}

function sanitizeIssueText(message: string, label: string): string {
  const clean = message
    .replace(/\b[0-9A-F]{12,}\b/gi, "")
    .replace(/\b(?:component|pin|net)[:-][^\s，。；]*/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  if (!clean) {
    return label ? `${label} 存在待确认问题` : "存在待确认问题";
  }
  return clean;
}

function safeIssueText(value: string | undefined): string | undefined {
  const text = String(value || "").trim();
  if (!text) {
    return undefined;
  }
  if (text.includes("={Manufacturer Part}")) {
    return undefined;
  }
  if (/^[0-9a-f]{12,}$/i.test(text)) {
    return undefined;
  }
  return text;
}

function severityOrder(severity: string): number {
  if (severity === "high") return 0;
  if (severity === "medium") return 1;
  if (severity === "low") return 2;
  return 9;
}
