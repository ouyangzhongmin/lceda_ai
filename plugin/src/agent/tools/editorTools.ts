import type { SchematicContext, SchematicPin } from "../../types/schematic";
import type { DraftPlan } from "../../editor/apply-plan/draftPlan";
import type { EditorAdapter } from "../../editor/adapters/editorAdapter";
import type { AgentTool } from "./toolRegistry";

export function createEditorTools(adapter: EditorAdapter): AgentTool[] {
  return [
    {
      name: "editor.get_current_context",
      description: "Read the current schematic context from editor",
      riskLevel: "low",
      execute: async (): Promise<SchematicContext> => adapter.getCurrentContext(),
    },
    {
      name: "editor.get_selection",
      description: "Read the current selection from editor",
      riskLevel: "low",
      execute: async () => adapter.getSelection(),
    },
    {
      name: "editor.describe_selection",
      description: "Describe the currently selected schematic objects with contextual details",
      riskLevel: "low",
      execute: async () => describeSelection(await adapter.getCurrentContext(), await adapter.getSelection()),
    },
    {
      name: "editor.describe_object",
      description: "Describe a schematic object by objectId and objectType using current context",
      riskLevel: "low",
      execute: async (input: { objectId: string; objectType: "component" | "pin" | "net" }) =>
        describeObject(await adapter.getCurrentContext(), input.objectId, input.objectType),
    },
    {
      name: "editor.find_object",
      description: "Find a schematic object by ref, pin label, net name, or object id using current context",
      riskLevel: "low",
      execute: async (input: { query: string }) => findObject(await adapter.getCurrentContext(), input.query),
    },
    {
      name: "editor.locate",
      description: "Locate a schematic object in editor",
      riskLevel: "low",
      execute: async (input: { objectId: string; objectType: "component" | "pin" | "net" }) =>
        adapter.locate(input),
    },
    {
      name: "editor.preview_apply_plan",
      description: "Preview the result of applying a draft plan into the editor",
      riskLevel: "medium",
      execute: async (input: { plan: DraftPlan }) => adapter.previewApplyPlan(input.plan),
    },
    {
      name: "editor.apply_plan",
      description: "Apply a confirmed draft plan into the editor",
      riskLevel: "high",
      requiresConfirmation: true,
      execute: async (input: { plan: DraftPlan }) => adapter.applyPlan(input.plan),
    },
    {
      name: "editor.rollback_apply_plan",
      description: "Rollback a previous apply_plan transaction by transactionId",
      riskLevel: "high",
      requiresConfirmation: true,
      execute: async (input: { transactionId: string }) => adapter.rollbackApplyPlan(input.transactionId),
    },
  ];
}

function describeSelection(context: SchematicContext, selection: { objectIds: string[] }) {
  const items = selection.objectIds
    .map((objectId) => describeObject(context, objectId, inferObjectType(context, objectId)))
    .filter((item) => item.found);
  return {
    count: items.length,
    summary: items.length > 0 ? items.map((item) => item.summary).join("；") : "当前没有可解释的选中对象",
    items,
  };
}

function describeObject(context: SchematicContext, objectId: string, objectType?: "component" | "pin" | "net") {
  const resolvedType = objectType || inferObjectType(context, objectId);
  if (resolvedType === "component") {
    const component = context.components.find((item) => item.id === objectId);
    if (!component) {
      return { found: false, objectId, objectType: resolvedType, summary: `未找到器件 ${objectId}` };
    }
    const relatedPins = context.pins.filter((pin) => pin.componentId === component.id).slice(0, 6);
    return {
      found: true,
      objectId,
      objectType: resolvedType,
      ref: component.ref,
      name: component.name,
      value: component.value,
      packageName: component.packageName,
      summary: [
        component.ref || component.id,
        component.name || "未命名器件",
        component.value || "",
        component.packageName ? `封装 ${component.packageName}` : "",
        relatedPins.length > 0 ? `引脚 ${relatedPins.map((pin) => pin.pinName || pin.pinNumber || pin.id).join(", ")}` : "",
      ]
        .filter(Boolean)
        .join("，"),
      pins: relatedPins.map((pin) => ({
        id: pin.id,
        pinNumber: pin.pinNumber,
        pinName: pin.pinName,
        electricalType: pin.electricalType,
      })),
      properties: component.properties,
    };
  }
  if (resolvedType === "pin") {
    const pin = context.pins.find((item) => item.id === objectId);
    if (!pin) {
      return { found: false, objectId, objectType: resolvedType, summary: `未找到引脚 ${objectId}` };
    }
    const component = context.components.find((item) => item.id === pin.componentId);
    const net = context.nets.find((item) => item.nodeIds.includes(pin.id));
    return {
      found: true,
      objectId,
      objectType: resolvedType,
      componentId: pin.componentId,
      componentRef: component?.ref,
      pinNumber: pin.pinNumber,
      pinName: pin.pinName,
      electricalType: pin.electricalType,
      netName: net?.name,
      summary: [
        component?.ref ? `${component.ref} 的 ${pin.pinNumber || pin.pinName || pin.id} 脚` : pin.id,
        pin.pinName || "",
        pin.electricalType ? `类型 ${pin.electricalType}` : "",
        net?.name ? `连接网络 ${net.name}` : "",
      ]
        .filter(Boolean)
        .join("，"),
    };
  }
  if (resolvedType === "net") {
    const net = context.nets.find((item) => item.id === objectId);
    if (!net) {
      return { found: false, objectId, objectType: resolvedType, summary: `未找到网络 ${objectId}` };
    }
    const nodePins = net.nodeIds
      .map((nodeId) => context.pins.find((pin) => pin.id === nodeId))
      .filter(Boolean)
      .slice(0, 8);
    return {
      found: true,
      objectId,
      objectType: resolvedType,
      name: net.name,
      isPower: net.isPower,
      nodeCount: net.nodeIds.length,
      summary: [
        net.name || net.id,
        net.isPower ? "电源网络" : "信号网络",
        `连接节点 ${net.nodeIds.length} 个`,
        nodePins.length > 0 ? `包含 ${nodePins.map((pin) => formatPinRef(context, pin)).filter(Boolean).join(", ")}` : "",
      ]
        .filter(Boolean)
        .join("，"),
    };
  }
  return { found: false, objectId, objectType: resolvedType || "component", summary: `无法识别对象 ${objectId}` };
}

function inferObjectType(context: SchematicContext, objectId: string): "component" | "pin" | "net" {
  if (context.components.some((item) => item.id === objectId)) {
    return "component";
  }
  if (context.pins.some((item) => item.id === objectId)) {
    return "pin";
  }
  return "net";
}

function formatPinRef(context: SchematicContext, pin: SchematicPin | undefined): string {
  if (!pin) {
    return "";
  }
  const component = context.components.find((item) => item.id === pin.componentId);
  return [component?.ref || pin.componentId, pin.pinNumber || pin.pinName || pin.id].filter(Boolean).join(".");
}

function findObject(context: SchematicContext, query: string) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return {
      found: false,
      query,
      summary: "未提供可搜索对象",
      matches: [],
    };
  }

  const matches = [
    ...context.components
      .map((item) => ({
        score: scoreAliases(normalized, [item.id, item.ref, item.name, item.value]),
        objectId: item.id,
        objectType: "component" as const,
        object: describeObject(context, item.id, "component"),
      }))
      .filter((item) => item.score > 0),
    ...context.pins
      .map((item) => {
        const componentRef = context.components.find((component) => component.id === item.componentId)?.ref;
        return {
          score: scoreAliases(normalized, [
            item.id,
            item.pinNumber,
            item.pinName,
            componentRef && item.pinNumber ? `${componentRef}.${item.pinNumber}` : "",
            componentRef && item.pinName ? `${componentRef}.${item.pinName}` : "",
            componentRef && item.pinNumber ? `${componentRef} ${item.pinNumber}` : "",
            componentRef && item.pinName ? `${componentRef} ${item.pinName}` : "",
          ]),
          objectId: item.id,
          objectType: "pin" as const,
          object: describeObject(context, item.id, "pin"),
        };
      })
      .filter((item) => item.score > 0),
    ...context.nets
      .map((item) => ({
        score: scoreAliases(normalized, [item.id, item.name]),
        objectId: item.id,
        objectType: "net" as const,
        object: describeObject(context, item.id, "net"),
      }))
      .filter((item) => item.score > 0),
  ]
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map((item) => ({
      objectId: item.objectId,
      objectType: item.objectType,
      summary: item.object.summary,
      score: item.score,
    }));

  if (matches.length > 0) {
    const top = matches[0];
    return {
      found: true,
      query,
      objectId: top.objectId,
      objectType: top.objectType,
      summary: top.summary,
      object: describeObject(context, top.objectId, top.objectType),
      matches,
    };
  }

  return {
    found: false,
    query,
    summary: `未找到与 ${query} 对应的器件、引脚或网络`,
    matches: [],
  };
}

function scoreAliases(normalizedQuery: string, aliases: Array<string | undefined>): number {
  let score = 0;
  for (const value of aliases) {
    const normalizedValue = String(value || "").trim().toLowerCase();
    if (!normalizedValue) {
      continue;
    }
    if (normalizedValue === normalizedQuery) {
      score = Math.max(score, 100);
      continue;
    }
    if (normalizedValue.startsWith(normalizedQuery) || normalizedQuery.startsWith(normalizedValue)) {
      score = Math.max(score, 70);
      continue;
    }
    if (normalizedValue.includes(normalizedQuery) || normalizedQuery.includes(normalizedValue)) {
      score = Math.max(score, 40);
    }
  }
  return score;
}
