import type { SchematicContext } from "../../types/schematic";
import type { RuleIssue } from "../models/issue";

export function runShortCircuitCheck(context: SchematicContext): RuleIssue[] {
  const pinById = new Map(context.pins.map((pin) => [pin.id, pin]));
  const componentById = new Map(context.components.map((component) => [component.id, component]));
  const issues: RuleIssue[] = [];

  for (const net of context.nets) {
    const expectedPowerDomains = new Set<string>();

    for (const nodeId of net.nodeIds) {
      const pin = pinById.get(nodeId);
      if (!pin) {
        continue;
      }

      const component = componentById.get(pin.componentId);
      if (!component) {
        continue;
      }

      const expectedNetName = component.properties[`expected_net_${pin.pinName ?? pin.pinNumber ?? ""}`];
      if (expectedNetName) {
        expectedPowerDomains.add(expectedNetName);
      }
    }

    if (expectedPowerDomains.size < 2) {
      continue;
    }

    const netName = net.name ?? net.id;
    issues.push({
      id: `issue-${net.id}-short-circuit-risk`,
      ruleId: "wiring.short-circuit-risk",
      severity: "high",
      title: "网络存在短路风险",
      message: `网络 ${netName} 合并了多个预期电源域：${Array.from(expectedPowerDomains).join("、")}。`,
      objectId: net.id,
      objectType: "net",
      suggestion: `请拆分 ${netName}，或通过稳压器、二极管、开关等器件隔离不同电源域。`,
    });
  }

  return issues;
}
