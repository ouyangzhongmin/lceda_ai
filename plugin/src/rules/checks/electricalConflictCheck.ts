import type { SchematicContext } from "../../types/schematic";
import type { RuleIssue } from "../models/issue";

const DRIVER_TYPES = new Set(["output", "power_out", "bidirectional"]);

export function runElectricalConflictCheck(context: SchematicContext): RuleIssue[] {
  const pinById = new Map(context.pins.map((pin) => [pin.id, pin]));
  const issues: RuleIssue[] = [];

  for (const net of context.nets) {
    const drivers = net.nodeIds
      .map((nodeId) => pinById.get(nodeId))
      .filter((pin): pin is NonNullable<typeof pin> => Boolean(pin))
      .filter((pin) => pin.electricalType && DRIVER_TYPES.has(pin.electricalType));

    if (drivers.length < 2) {
      continue;
    }

    const labels = drivers.map(
      (pin) => `${pin.componentId}:${pin.pinName ?? pin.pinNumber ?? pin.id}:${pin.electricalType}`
    );
    const netName = net.name ?? net.id;

    issues.push({
      id: `issue-${net.id}-electrical-conflict`,
      ruleId: "wiring.electrical-conflict",
      severity: "high",
      title: "网络存在驱动冲突",
      message: `网络 ${netName} 上存在多个输出驱动引脚：${labels.join("、")}。`,
      objectId: net.id,
      objectType: "net",
      suggestion: `请确认 ${netName} 是否允许共驱动，或在驱动端之间增加隔离与方向控制。`,
    });
  }

  return issues;
}
