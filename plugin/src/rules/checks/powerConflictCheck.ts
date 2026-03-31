import type { SchematicContext } from "../../types/schematic";
import type { RuleIssue } from "../models/issue";

export function runPowerConflictCheck(context: SchematicContext): RuleIssue[] {
  const pinById = new Map(context.pins.map((pin) => [pin.id, pin]));
  const componentById = new Map(context.components.map((component) => [component.id, component]));
  const issues: RuleIssue[] = [];

  for (const net of context.nets) {
    if (!net.isPower || net.nodeIds.length < 2) {
      continue;
    }

    const expectedPowerNames = new Set<string>();
    for (const nodeId of net.nodeIds) {
      const pin = pinById.get(nodeId);
      if (!pin) {
        continue;
      }

      const component = componentById.get(pin.componentId);
      if (!component) {
        continue;
      }

      const expected = component.properties[`expected_net_${pin.pinName ?? pin.pinNumber ?? ""}`];
      if (expected) {
        expectedPowerNames.add(expected);
      }
    }

    const netName = net.name ?? net.id;
    const mismatchedExpected = Array.from(expectedPowerNames).filter((expected) => expected !== netName);
    if (mismatchedExpected.length > 0) {
      issues.push({
        id: `issue-${net.id}-power-conflict`,
        ruleId: "wiring.power-conflict",
        severity: "high",
        title: "电源网络定义冲突",
        message: `电源网络 ${netName} 上存在期望连接到其他电源域的引脚：${mismatchedExpected.join("、")}。`,
        objectId: net.id,
        objectType: "net",
        suggestion: `请拆分 ${netName}，或将不匹配的引脚重新连接到各自预期的电源网络。`,
      });
    }
  }

  return issues;
}
