import type { LocateTarget, SchematicContext } from "../../types/schematic";
import type { RuleIssue } from "../../rules/models/issue";
import type { AgentTool } from "./toolRegistry";
import type { ToolRegistry } from "./toolRegistry";

export function createIssueTools(tools: ToolRegistry): AgentTool[] {
  return [
    {
      name: "issues_locate_first",
      description: "定位第一个可映射到编辑器对象的问题",
      parameters: {
        type: "object",
        properties: {
          issues: {
            type: "array",
            description: "待定位的问题列表，通常来自 rules_run_schematic_checks 的 issues。",
            items: { type: "object" },
          },
        },
        required: ["issues"],
        additionalProperties: false,
      },
      execute: async (input: { issues: RuleIssue[]; context?: SchematicContext }) => {
        const severityRank = (value: string | undefined): number =>
          value === "high" ? 3 : value === "medium" ? 2 : value === "low" ? 1 : 0;
        const titleRank = (title: string | undefined): number => {
          const t = String(title || "").trim();
          if (!t) return 0;
          // Prefer issues that are concrete and immediately actionable in schematic editing.
          if (t.includes("短路")) return 100;
          if (t.includes("电源") && t.includes("冲突")) return 95;
          if (t.includes("引脚悬空")) return 90;
          if (t.includes("器件缺少封装")) return 85;
          if (t.includes("器件缺少数值")) return 80;
          if (t.includes("按键") && t.includes("上拉")) return 70;
          if (t.includes("未连接 GPIO")) return 10; // useful, but often less urgent than BOM/PCB blockers
          return 50;
        };

        const firstLocatable = (input.issues || [])
          .filter((issue) => issue && issue.objectId && issue.objectType)
          .slice()
          .sort((a, b) => {
            const sa = severityRank(a.severity);
            const sb = severityRank(b.severity);
            if (sb !== sa) return sb - sa;
            const ta = titleRank(a.title);
            const tb = titleRank(b.title);
            if (tb !== ta) return tb - ta;
            return 0;
          })[0];

        if (!firstLocatable || !firstLocatable.objectId || !firstLocatable.objectType) {
          return {
            located: false,
            issueId: undefined,
          };
        }

        await tools.invoke<LocateTarget, void>("editor_locate", {
          objectId: firstLocatable.objectId,
          objectType: firstLocatable.objectType,
        });

        let objectLabel: string | undefined;
        try {
          const described = await tools.invoke<{ objectId: string; objectType: "component" | "pin" | "net" }, { summary?: string }>(
            "editor_describe_object",
            {
              objectId: firstLocatable.objectId,
              objectType: firstLocatable.objectType,
            }
          );
          objectLabel = sanitizeDescribeSummary(described.summary);
        } catch {
          // best effort
        }
        if (!objectLabel) {
          objectLabel = buildReadableObjectLabel(input.context, firstLocatable.objectType, firstLocatable.objectId);
        }

        return {
          located: true,
          issueId: firstLocatable.id,
          objectId: firstLocatable.objectId,
          objectType: firstLocatable.objectType,
          objectLabel,
        };
      },
    },
  ];
}

function buildReadableObjectLabel(
  context: SchematicContext | undefined,
  objectType?: "component" | "pin" | "net",
  objectId?: string
): string | undefined {
  if (!context || !objectType || !objectId) {
    return undefined;
  }
  if (objectType === "component") {
    const component = context.components.find((item) => item.id === objectId);
    if (!component) return undefined;
    return [cleanText(component.ref), cleanText(component.name), cleanText(component.value), cleanText(component.packageName)]
      .filter(Boolean)
      .join(" / ");
  }
  if (objectType === "pin") {
    const pin = context.pins.find((item) => item.id === objectId);
    if (!pin) return undefined;
    const component = context.components.find((item) => item.id === pin.componentId);
    const pinLabel = [cleanText(pin.pinName), cleanText(pin.pinNumber) ? `(${cleanText(pin.pinNumber)})` : ""]
      .filter(Boolean)
      .join("");
    return [
      cleanText(component?.ref) || cleanText(component?.name),
      pinLabel,
      cleanText(pin.netName) ? `网络 ${cleanText(pin.netName)}` : "",
    ]
      .filter(Boolean)
      .join(" / ");
  }
  if (objectType === "net") {
    const net = context.nets.find((item) => item.id === objectId);
    return cleanText(net?.name) ? `网络 ${cleanText(net?.name)}` : undefined;
  }
  return undefined;
}

function cleanText(value: string | undefined): string | undefined {
  const text = String(value || "").trim();
  if (!text) return undefined;
  if (text.includes("={Manufacturer Part}")) return undefined;
  if (/^[0-9a-f]{12,}$/i.test(text)) return undefined;
  return text;
}

function sanitizeDescribeSummary(summary: string | undefined): string | undefined {
  const raw = String(summary || "").trim();
  if (!raw) return undefined;

  // Some editor implementations return comma-separated property placeholders
  // such as "esp32，={Manufacturer Part}，...". Keep the meaningful segments.
  const parts = raw
    .split(/[，,]/g)
    .map((item) => cleanText(item))
    .filter(Boolean) as string[];
  const joined = parts.join(" / ").trim();
  return joined || undefined;
}
