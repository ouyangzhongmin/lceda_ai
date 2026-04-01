import type { SchematicContext } from "../../types/schematic";
import type { RuleIssue } from "../models/issue";

export function runFloatingPinsCheck(context: SchematicContext): RuleIssue[] {
  const hasReliableNetMapping = context.nets.some((net) => net.nodeIds.length > 0);
  if (!hasReliableNetMapping) {
    return [];
  }

  const connectedPinIds = new Set(context.nets.flatMap((net) => net.nodeIds));

  return context.pins
    .filter((pin) => !pin.noConnected && !connectedPinIds.has(pin.id))
    .map((pin) => ({
      id: `issue-${pin.id}-floating`,
      ruleId: "wiring.floating-pin",
      severity: pin.electricalType === "input" || pin.electricalType === "power_in" ? "high" : "medium",
      title: "引脚悬空未连接",
      message: `${pin.pinName ?? pin.pinNumber ?? pin.id} 脚当前没有连接到任何网络。`,
      objectId: pin.id,
      objectType: "pin" as const,
      suggestion: `请连接 ${pin.pinName ?? pin.pinNumber ?? pin.id} 脚，或明确标记为有意悬空。`,
    }));
}
