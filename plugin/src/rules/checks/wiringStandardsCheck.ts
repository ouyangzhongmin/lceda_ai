import type { SchematicContext } from "../../types/schematic";
import type { RuleIssue } from "../models/issue";

export function runWiringStandardsCheck(context: SchematicContext): RuleIssue[] {
  const issues: RuleIssue[] = [];
  const pinToNetName = buildPinToNetNameMap(context);

  for (const component of context.components) {
    const componentPins = context.pins.filter((pin) => pin.componentId === component.id);
    for (const pin of componentPins) {
      const expectedNetName = component.properties[`expected_net_${pin.pinName ?? pin.pinNumber ?? ""}`];
      if (!expectedNetName) {
        continue;
      }

      const actualNetName = pinToNetName.get(pin.id);
        if (!actualNetName) {
          issues.push({
            id: `issue-${component.id}-${pin.id}-missing-net`,
            ruleId: "wiring.expected-net.missing",
            severity: "high",
            title: "引脚未连接到预期网络",
            message: `${component.ref ?? component.id} 的 ${pin.pinName ?? pin.pinNumber ?? pin.id} 脚未连接到预期网络 ${expectedNetName}。`,
            objectId: pin.id,
            objectType: "pin",
            suggestion: `请将 ${component.ref ?? component.id} 的 ${pin.pinName ?? pin.pinNumber ?? pin.id} 脚连接到 ${expectedNetName}。`,
          });
          continue;
        }

      if (actualNetName !== expectedNetName) {
        issues.push({
          id: `issue-${component.id}-${pin.id}-wrong-net`,
          ruleId: "wiring.expected-net.mismatch",
          severity: "high",
          title: "引脚连接与预期不一致",
          message: `${component.ref ?? component.id} 的 ${pin.pinName ?? pin.pinNumber ?? pin.id} 脚应连接到 ${expectedNetName}，当前实际连接到 ${actualNetName}。`,
          objectId: pin.id,
          objectType: "pin",
          suggestion: `请将 ${component.ref ?? component.id} 的 ${pin.pinName ?? pin.pinNumber ?? pin.id} 脚从 ${actualNetName} 调整到 ${expectedNetName}。`,
        });
      }
    }

    if (component.properties.polarity_sensitive === "true") {
      const polarityIssue = detectPolarityReversed(component.id, componentPins, component.properties, pinToNetName);
      if (polarityIssue) {
        issues.push(polarityIssue);
      }
    }
  }

  return issues;
}

function buildPinToNetNameMap(context: SchematicContext): Map<string, string> {
  const pinToNetName = new Map<string, string>();
  for (const net of context.nets) {
    for (const nodeId of net.nodeIds) {
      pinToNetName.set(nodeId, net.name ?? net.id);
    }
  }

  return pinToNetName;
}

function detectPolarityReversed(
  componentId: string,
  pins: SchematicContext["pins"],
  properties: Record<string, string>,
  pinToNetName: Map<string, string>
): RuleIssue | undefined {
  const anodePin = pins.find((pin) => pin.pinName === "ANODE");
  const cathodePin = pins.find((pin) => pin.pinName === "CATHODE");
  const expectedAnode = properties.expected_net_ANODE;
  const expectedCathode = properties.expected_net_CATHODE;

  if (!anodePin || !cathodePin || !expectedAnode || !expectedCathode) {
    return undefined;
  }

  const actualAnode = pinToNetName.get(anodePin.id);
  const actualCathode = pinToNetName.get(cathodePin.id);
  if (actualAnode === expectedCathode && actualCathode === expectedAnode) {
    return {
      id: `issue-${componentId}-polarity-reversed`,
      ruleId: "wiring.polarity.reversed",
      severity: "high",
      title: "极性连接可能接反",
      message: `极性敏感器件 ${componentId} 可能接反：ANODE 当前在 ${actualAnode}，CATHODE 当前在 ${actualCathode}。`,
      objectId: componentId,
      objectType: "component",
      suggestion: `请将 ANODE / CATHODE 分别调整到 ${expectedAnode} / ${expectedCathode}。`,
    };
  }

  return undefined;
}
