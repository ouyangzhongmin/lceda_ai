import type { SchematicContext } from "../../types/schematic";
import type { RuleIssue } from "../models/issue";

export function runFloatingPinsCheck(context: SchematicContext): RuleIssue[] {
  const pinById = new Map(context.pins.map((pin) => [pin.id, pin]));
  let totalNodeIds = 0;
  let matchedNodeIds = 0;
  context.nets.forEach((net) => {
    totalNodeIds += net.nodeIds.length;
    net.nodeIds.forEach((id) => {
      if (pinById.has(id)) {
        matchedNodeIds += 1;
      }
    });
  });
  const nodeIdMappingReliable = totalNodeIds > 0 && matchedNodeIds / totalNodeIds >= 0.3;
  const hasNetNameMapping = context.pins.some((pin) => Boolean(String(pin.netName || "").trim()));
  if (!nodeIdMappingReliable && !hasNetNameMapping) {
    return [];
  }

  const connectedPinIds = new Set<string>();
  if (nodeIdMappingReliable) {
    context.nets.forEach((net) => {
      net.nodeIds.forEach((id) => {
        if (pinById.has(id)) {
          connectedPinIds.add(id);
        }
      });
    });
  } else {
    // Fallback: some host adapters don't map net.nodeIds to pin.id, but do provide pin.netName.
    context.pins.forEach((pin) => {
      if (String(pin.netName || "").trim()) {
        connectedPinIds.add(pin.id);
      }
    });
  }

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
