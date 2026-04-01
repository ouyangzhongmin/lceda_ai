import type { SchematicContext } from "../../types/schematic";
import type { RuleIssue } from "../models/issue";

export function runComponentAttributesCheck(context: SchematicContext): RuleIssue[] {
  const issues: RuleIssue[] = [];

  for (const component of context.components) {
    if (component.componentType && component.componentType !== "part" && component.componentType !== "component") {
      continue;
    }

    if (!component.ref) {
      issues.push({
        id: `issue-${component.id}-missing-ref`,
        ruleId: "component.missing-ref",
        severity: "high",
        title: "器件缺少位号",
        message: `${component.name ?? component.id} 缺少位号标识。`,
        objectId: component.id,
        objectType: "component",
        suggestion: "请为该器件补充唯一位号。",
      });
    }

    if (component.addIntoPcb !== false && !component.packageName) {
      issues.push({
        id: `issue-${component.id}-missing-package`,
        ruleId: "component.missing-package",
        severity: "medium",
        title: "器件缺少封装信息",
        message: `${component.ref ?? component.id} 缺少封装或 footprint 信息。`,
        objectId: component.id,
        objectType: "component",
        suggestion: "请在评审或导出前补充封装信息。",
      });
    }

    if (component.addIntoBom !== false && !component.value) {
      issues.push({
        id: `issue-${component.id}-missing-value`,
        ruleId: "component.missing-value",
        severity: "medium",
        title: "器件缺少数值或型号",
        message: `${component.ref ?? component.id} 缺少数值或型号描述。`,
        objectId: component.id,
        objectType: "component",
        suggestion: "请补充器件数值或型号信息。",
      });
    }
  }

  return issues;
}
