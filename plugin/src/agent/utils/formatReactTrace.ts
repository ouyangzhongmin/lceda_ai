import type { AgentReactEvent, AgentExecutionTrace } from "../shared/agentTypes";

/**
 * 将 ReAct 事件格式化为易读的文字链路
 */
export function formatReactTraceAsText(reactEvents: AgentReactEvent[]): string {
  const lines: string[] = [];
  let currentSection = "";
  let stepNumber = 0;

  for (const event of reactEvents) {
    // 思考阶段 - 作为章节标题
    if (event.kind === "thought") {
      currentSection = event.label;
      lines.push("");
      lines.push(`## ${event.label}`);
      lines.push(event.text);
      lines.push("");
      continue;
    }

    // 任务规划
    if (event.kind === "task") {
      if (event.status === "pending" || event.status === "running") {
        stepNumber++;
        lines.push(`${stepNumber}. [${event.status.toUpperCase()}] ${event.text}`);
      } else if (event.status === "done") {
        lines.push(`   ✓ ${event.text}`);
      } else if (event.status === "failed") {
        lines.push(`   ✗ ${event.text}`);
      }
      continue;
    }

    // 工具调用 + 观测结果（合并显示）
    if (event.kind === "tool_call") {
      const toolLabel = event.toolName || event.label;
      lines.push(`   → 调用工具: ${toolLabel}`);
      if (event.text) {
        lines.push(`     目标: ${event.text}`);
      }
      if (event.inputSummary) {
        lines.push(`     参数: ${event.inputSummary}`);
      }
    }

    if (event.kind === "observation") {
      const status = event.status === "done" ? "✓" : event.status === "failed" ? "✗" : "○";
      lines.push(`   ${status} 结果: ${event.text}`);
      lines.push("");
    }

    // 最终完成
    if (event.kind === "final") {
      lines.push("");
      lines.push(`## 完成`);
      lines.push(event.text);
      lines.push("");
    }
  }

  return lines.join("\n");
}

/**
 * 将 ExecutionTrace 格式化为易读的文字链路
 */
export function formatExecutionTraceAsText(traces: AgentExecutionTrace[]): string {
  const lines: string[] = [];
  let stepNumber = 0;

  for (const trace of traces) {
    const icon = {
      reason: "🤔",
      act: "🔧",
      observe: "👁️",
      finish: "✅",
    }[trace.phase];

    const label = {
      reason: "推理",
      act: "行动",
      observe: "观测",
      finish: "完成",
    }[trace.phase];

    if (trace.phase === "reason") {
      stepNumber++;
      lines.push(`${stepNumber}. ${icon} [${label}] ${trace.message}`);
    } else if (trace.phase === "act") {
      lines.push(`   ${icon} [${label}] ${trace.message}`);
    } else if (trace.phase === "observe") {
      lines.push(`   ${icon} [${label}] ${trace.message}`);
      lines.push("");
    } else if (trace.phase === "finish") {
      lines.push("");
      lines.push(`${icon} [${label}] ${trace.message}`);
    }
  }

  return lines.join("\n");
}

/**
 * 生成完整的执行报告（包含 ReAct 事件和 Execution Traces）
 */
export function formatCompleteExecutionReport(input: {
  reactEvents?: AgentReactEvent[];
  executionTraces?: AgentExecutionTrace[];
  title?: string;
}): string {
  const sections: string[] = [];

  if (input.title) {
    sections.push(`# ${input.title}`);
    sections.push("");
  }

  if (input.reactEvents && input.reactEvents.length > 0) {
    sections.push("# ReAct 执行链路（详细版）");
    sections.push("");
    sections.push(formatReactTraceAsText(input.reactEvents));
    sections.push("");
    sections.push("---");
    sections.push("");
  }

  if (input.executionTraces && input.executionTraces.length > 0) {
    sections.push("# Execution Traces（标准 ReAct 格式）");
    sections.push("");
    sections.push(formatExecutionTraceAsText(input.executionTraces));
  }

  return sections.join("\n");
}

/**
 * 生成简洁的单行摘要
 */
export function formatReactTraceSummary(reactEvents: AgentReactEvent[]): string {
  const thoughts = reactEvents.filter((e) => e.kind === "thought").length;
  const toolCalls = reactEvents.filter((e) => e.kind === "tool_call").length;
  const observations = reactEvents.filter((e) => e.kind === "observation");
  const successful = observations.filter((e) => e.status === "done").length;
  const failed = observations.filter((e) => e.status === "failed").length;

  return `推理 ${thoughts} 次 | 工具调用 ${toolCalls} 次 | 成功 ${successful} 次 | 失败 ${failed} 次`;
}

/**
 * 按阶段分组统计
 */
export function analyzeReactTrace(reactEvents: AgentReactEvent[]): {
  phases: Array<{
    label: string;
    thoughts: string[];
    tools: Array<{ name: string; status: string; result: string }>;
  }>;
  summary: {
    totalThoughts: number;
    totalToolCalls: number;
    successfulCalls: number;
    failedCalls: number;
  };
} {
  const phases: Array<{
    label: string;
    thoughts: string[];
    tools: Array<{ name: string; status: string; result: string }>;
  }> = [];

  let currentPhase: (typeof phases)[0] | null = null;
  let pendingToolCall: { name: string; status: string } | null = null;

  for (const event of reactEvents) {
    if (event.kind === "thought") {
      currentPhase = {
        label: event.label,
        thoughts: [event.text],
        tools: [],
      };
      phases.push(currentPhase);
    } else if (event.kind === "tool_call" && currentPhase) {
      pendingToolCall = {
        name: event.toolName || event.label,
        status: event.status,
      };
    } else if (event.kind === "observation" && currentPhase && pendingToolCall) {
      currentPhase.tools.push({
        name: pendingToolCall.name,
        status: event.status,
        result: event.text,
      });
      pendingToolCall = null;
    }
  }

  const toolCalls = reactEvents.filter((e) => e.kind === "tool_call");
  const observations = reactEvents.filter((e) => e.kind === "observation");

  return {
    phases,
    summary: {
      totalThoughts: reactEvents.filter((e) => e.kind === "thought").length,
      totalToolCalls: toolCalls.length,
      successfulCalls: observations.filter((e) => e.status === "done").length,
      failedCalls: observations.filter((e) => e.status === "failed").length,
    },
  };
}
