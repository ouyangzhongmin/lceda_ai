import type { DraftPlan } from "./draftPlan";

export type DraftApplyErrorClassification =
  | {
      kind: "unmapped_required_nets";
      netNames: string[];
      rawMessage: string;
    }
  | {
      kind: "required_connection_unresolved" | "required_connection_net_mismatch";
      fromComponentRef: string;
      fromPin: string;
      toComponentRef: string;
      toPin: string;
      netName: string;
      rawMessage: string;
    }
  | {
      kind: "unknown";
      rawMessage: string;
    };

function normalizeNetName(name: string | undefined): string {
  const raw = String(name || "").trim();
  if (!raw) return "";
  const normalized = raw.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  if (normalized === "VCC_5V" || normalized === "USB_5V" || normalized === "VBUS_5V") return "5V";
  if (normalized === "VCC_3V3" || normalized === "3_3V" || normalized === "3V3_SYS" || normalized === "VDD_3V3") return "3V3";
  if (normalized === "VBAT_SYS" || normalized === "VCC_BAT" || normalized === "BATTERY" || normalized === "BAT") return "VBAT";
  return normalized;
}

function isGroundNet(name: string | undefined): boolean {
  return normalizeNetName(name) === "GND";
}

function isPositivePowerNet(name: string | undefined): boolean {
  const normalized = normalizeNetName(name);
  return Boolean(normalized) && normalized !== "GND";
}

function inferNextConnectorRef(plan: DraftPlan): string {
  const used = new Set(
    plan.components
      .map((component) => String(component.ref || "").trim().toUpperCase())
      .filter(Boolean)
  );
  let index = 1;
  while (used.has(`J${index}`)) {
    index += 1;
  }
  return `J${index}`;
}

function hasPowerSourceOnNet(plan: DraftPlan, nodeIds: string[]): boolean {
  return nodeIds.some((nodeId) => {
    const pin = plan.pins.find((item) => item.id === nodeId);
    return String(pin?.electricalType || "").trim().toLowerCase() === "power_out";
  });
}

function resolvePlanPinByRef(plan: DraftPlan, componentRef: string, pinLabel: string): DraftPlan["pins"][number] | undefined {
  const component = plan.components.find((item) => String(item.ref || "").trim() === componentRef);
  if (!component) return undefined;
  return plan.pins.find(
    (pin) =>
      pin.componentId === component.id &&
      (String(pin.pinNumber || "").trim() === pinLabel || String(pin.pinName || "").trim() === pinLabel)
  );
}

export function shouldRepairDraftApplyError(error: unknown): boolean {
  return classifyDraftApplyError(error).kind !== "unknown";
}

export function classifyDraftApplyError(error: unknown): DraftApplyErrorClassification {
  const message = error instanceof Error ? error.message : String(error);
  const unmappedMatch = message.match(/unmapped required nets:\s*([^()]+?)(?:\s*\(|$)/i);
  if (unmappedMatch) {
    const netNames = unmappedMatch[1]
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
    return {
      kind: "unmapped_required_nets",
      netNames,
      rawMessage: message,
    };
  }
  const requiredConnectionMatch = message.match(
    /required connection (unresolved|net mismatch):\s*([^.]+)\.([^\s]+)\s*->\s*([^.]+)\.([^\s]+)\s*\(([^)]+)\)/i
  );
  if (requiredConnectionMatch) {
    return {
      kind:
        requiredConnectionMatch[1].toLowerCase() === "net mismatch"
          ? "required_connection_net_mismatch"
          : "required_connection_unresolved",
      fromComponentRef: requiredConnectionMatch[2].trim(),
      fromPin: requiredConnectionMatch[3].trim(),
      toComponentRef: requiredConnectionMatch[4].trim(),
      toPin: requiredConnectionMatch[5].trim(),
      netName: requiredConnectionMatch[6].trim(),
      rawMessage: message,
    };
  }
  return {
    kind: "unknown",
    rawMessage: message,
  };
}

function backfillRequiredConnections(plan: DraftPlan): { plan: DraftPlan; changed: boolean } {
  const requiredConnections = plan.guidance?.requiredConnections ?? [];
  if (requiredConnections.length === 0) {
    return { plan, changed: false };
  }

  const nextPlan: DraftPlan = {
    ...plan,
    components: plan.components.map((component) => ({
      ...component,
      properties: { ...component.properties },
    })),
    pins: plan.pins.map((pin) => ({ ...pin })),
    nets: plan.nets.map((net) => ({ ...net, nodeIds: [...net.nodeIds] })),
    selectedDevices: plan.selectedDevices ? [...plan.selectedDevices] : undefined,
    guidance: plan.guidance,
  };

  let changed = false;
  for (const connection of requiredConnections) {
    const fromPin = resolvePlanPinByRef(nextPlan, connection.fromComponentRef, connection.fromPin);
    const toPin = resolvePlanPinByRef(nextPlan, connection.toComponentRef, connection.toPin);
    const net = nextPlan.nets.find((item) => normalizeNetName(item.name || item.id) === normalizeNetName(connection.netName));
    if (!fromPin || !toPin || !net) {
      continue;
    }
    if (!net.nodeIds.includes(fromPin.id)) {
      net.nodeIds.push(fromPin.id);
      changed = true;
    }
    if (!net.nodeIds.includes(toPin.id)) {
      net.nodeIds.push(toPin.id);
      changed = true;
    }
    if (fromPin.netName !== net.name) {
      fromPin.netName = net.name;
      changed = true;
    }
    if (toPin.netName !== net.name) {
      toPin.netName = net.name;
      changed = true;
    }
  }

  return { plan: nextPlan, changed };
}

export function repairDraftPlanPowerConnectivity(plan: DraftPlan): { plan: DraftPlan; changed: boolean } {
  const requiredConnectionRepair = backfillRequiredConnections(plan);
  const inputPlan = requiredConnectionRepair.plan;
  const groundNet = plan.nets.find((net) => isGroundNet(net.name || net.id));
  if (!groundNet) {
    return { plan: inputPlan, changed: requiredConnectionRepair.changed };
  }

  const orphanPowerNets = inputPlan.nets.filter((net) => {
    if (!net.isPower || !isPositivePowerNet(net.name || net.id)) {
      return false;
    }
    if ((net.nodeIds?.length ?? 0) >= 2) {
      return false;
    }
    return !hasPowerSourceOnNet(inputPlan, net.nodeIds ?? []);
  });
  if (orphanPowerNets.length === 0) {
    return { plan: inputPlan, changed: requiredConnectionRepair.changed };
  }

  const nextPlan: DraftPlan = {
    ...inputPlan,
    components: inputPlan.components.map((component) => ({
      ...component,
      properties: { ...component.properties },
    })),
    pins: inputPlan.pins.map((pin) => ({ ...pin })),
    nets: inputPlan.nets.map((net) => ({ ...net, nodeIds: [...net.nodeIds] })),
    selectedDevices: inputPlan.selectedDevices ? [...inputPlan.selectedDevices] : undefined,
    guidance: inputPlan.guidance,
  };

  for (const orphanNet of orphanPowerNets) {
    const ref = inferNextConnectorRef(nextPlan);
    const componentId = `repair-${ref.toLowerCase()}`;
    const posPinId = `${componentId}-pos`;
    const gndPinId = `${componentId}-gnd`;
    const normalizedPowerNet = normalizeNetName(orphanNet.name || orphanNet.id);

    nextPlan.components.push({
      id: componentId,
      ref,
      name: "Power Header",
      packageName: "HDR-TH_1X2",
      value: normalizedPowerNet,
      componentType: "part",
      addIntoBom: true,
      addIntoPcb: true,
      properties: {
        role: "power_connector",
        preferred_search_query: `2pin power header ${normalizedPowerNet} GND`,
        placement_x: "180",
        placement_y: String(180 + nextPlan.components.filter((component) => component.properties.role === "power_connector").length * 140),
        placement_rotation: "0",
        expected_net_1: normalizedPowerNet,
        expected_net_2: "GND",
      },
    });
    nextPlan.pins.push(
      {
        id: posPinId,
        componentId,
        pinNumber: "1",
        pinName: normalizedPowerNet,
        electricalType: "power_out",
        netName: normalizedPowerNet,
      },
      {
        id: gndPinId,
        componentId,
        pinNumber: "2",
        pinName: "GND",
        electricalType: "power_out",
        netName: "GND",
      }
    );

    const targetPowerNet = nextPlan.nets.find((net) => net.id === orphanNet.id);
    if (targetPowerNet && !targetPowerNet.nodeIds.includes(posPinId)) {
      targetPowerNet.nodeIds.push(posPinId);
    }
    if (!groundNet.nodeIds.includes(gndPinId)) {
      const targetGroundNet = nextPlan.nets.find((net) => net.id === groundNet.id);
      targetGroundNet?.nodeIds.push(gndPinId);
    }
  }

  return { plan: nextPlan, changed: true };
}
