import type { LocateTarget, SchematicContext } from "../../types/schematic";
import type { RuleIssue } from "../../rules/models/issue";
import type { AgentTool } from "./toolRegistry";
import type { ToolRegistry } from "./toolRegistry";

export function createIssueTools(tools: ToolRegistry): AgentTool[] {
  return [
    {
      name: "issues.locate_first",
      description: "定位第一个可映射到编辑器对象的问题",
      execute: async (input: { issues: RuleIssue[]; context?: SchematicContext }) => {
        const firstLocatable = input.issues.find(
          (issue) => issue.objectId && issue.objectType
        );

        if (!firstLocatable || !firstLocatable.objectId || !firstLocatable.objectType) {
          return {
            located: false,
            issueId: undefined,
          };
        }

        await tools.invoke<LocateTarget, void>("editor.locate", {
          objectId: firstLocatable.objectId,
          objectType: firstLocatable.objectType,
        });

        let objectLabel: string | undefined;
        try {
          const described = await tools.invoke<{ objectId: string; objectType: "component" | "pin" | "net" }, { summary?: string }>(
            "editor.describe_object",
            {
              objectId: firstLocatable.objectId,
              objectType: firstLocatable.objectType,
            }
          );
          objectLabel = described.summary;
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
