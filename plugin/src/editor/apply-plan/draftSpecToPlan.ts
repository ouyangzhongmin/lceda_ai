import type { DraftDesignSpec, DraftPlan, DraftPlanGuidance } from "./draftPlan";

function assertValidDraftSpec(spec: DraftDesignSpec): void {
  if (!Array.isArray(spec.components)) {
    throw new Error("invalid draft spec: components must be an array");
  }
  if (!Array.isArray(spec.nets)) {
    throw new Error("invalid draft spec: nets must be an array");
  }
  if (!Array.isArray(spec.connections)) {
    throw new Error("invalid draft spec: connections must be an array");
  }
  spec.components.forEach((component, componentIndex) => {
    if (!Array.isArray(component?.pins)) {
      throw new Error(`invalid draft spec: components[${componentIndex}].pins must be an array`);
    }
  });
  spec.connections.forEach((connection, connectionIndex) => {
    if (!Array.isArray(connection?.pinIds)) {
      throw new Error(`invalid draft spec: connections[${connectionIndex}].pinIds must be an array`);
    }
    if (typeof connection?.netName !== "string" || !connection.netName.trim()) {
      throw new Error(`invalid draft spec: connections[${connectionIndex}].netName must be a non-empty string`);
    }
  });
}

function toPlacementProperties(spec: DraftDesignSpec["components"][number]): Record<string, string> {
  const placement = spec.placement;
  if (!placement) {
    return {};
  }
  return {
    placement_x: String(placement.x),
    placement_y: String(placement.y),
    placement_rotation: String(placement.rotation ?? 0),
  };
}

function normalizeNetName(name: string | undefined, netId: string): string {
  const raw = String(name || netId || "").trim();
  if (!raw) {
    return "NET";
  }
  const normalized = raw.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  if (!normalized) {
    return "NET";
  }
  if (normalized === "VCC_5V" || normalized === "USB_5V" || normalized === "VBUS_5V") {
    return "5V";
  }
  if (normalized === "VCC_3V3" || normalized === "3_3V" || normalized === "3V3_SYS" || normalized === "VDD_3V3") {
    return "3V3";
  }
  if (normalized === "VBAT_SYS" || normalized === "VCC_BAT" || normalized === "BATTERY" || normalized === "BAT") {
    return "VBAT";
  }
  if (normalized === "I2S_WS") {
    return "I2S_LRCK";
  }
  return normalized;
}

function componentRoleBucket(role: string | undefined, ref: string | undefined): "power" | "core" | "audio" | "ui" | "io" {
  const normalized = String(role || ref || "").trim().toLowerCase();
  if (/power|charger|charge|battery|ldo|regulator|buck|boost|usb|typec|type-c/.test(normalized)) {
    return "power";
  }
  if (/mcu|soc|main|esp32|controller|processor/.test(normalized)) {
    return "core";
  }
  if (/audio|codec|microphone|mic|speaker|amp/.test(normalized)) {
    return "audio";
  }
  if (/button|key|led|display|user|sensor/.test(normalized)) {
    return "ui";
  }
  return "io";
}

function defaultPlacementForComponent(
  component: DraftDesignSpec["components"][number],
  indexInBucket: number
): { x: number; y: number; rotation?: number } {
  const bucket = componentRoleBucket(component.role, component.ref);
  const normalizedRole = String(component.role || "").trim().toLowerCase();
  const presets: Record<typeof bucket, { baseX: number; baseY: number; dx: number; dy: number }> = {
    power: { baseX: 180, baseY: 180, dx: 0, dy: 140 },
    core: { baseX: 520, baseY: 260, dx: 0, dy: 160 },
    audio: { baseX: 860, baseY: 220, dx: 320, dy: 140 },
    ui: { baseX: 520, baseY: 540, dx: 200, dy: 120 },
    io: { baseX: 180, baseY: 520, dx: 220, dy: 120 },
  };
  const preset = presets[bucket];
  if (bucket === "audio") {
    if (/codec/.test(normalizedRole)) {
      return { x: 860, y: 220, rotation: 0 };
    }
    if (/microphone|mic/.test(normalizedRole)) {
      return { x: 1180, y: 160, rotation: 0 };
    }
    if (/speaker|amp/.test(normalizedRole)) {
      return { x: 1180, y: 300, rotation: 0 };
    }
    const column = Math.floor(indexInBucket / 2);
    const row = indexInBucket % 2;
    return {
      x: preset.baseX + column * preset.dx,
      y: preset.baseY + row * preset.dy - column * 60,
      rotation: 0,
    };
  }
  return {
    x: preset.baseX + Math.floor(indexInBucket / 3) * preset.dx,
    y: preset.baseY + (indexInBucket % 3) * preset.dy,
    rotation: 0,
  };
}

function buildPlacementMap(spec: DraftDesignSpec): Map<string, { x: number; y: number; rotation?: number }> {
  const counters = {
    power: 0,
    core: 0,
    audio: 0,
    ui: 0,
    io: 0,
  };
  const placements = new Map<string, { x: number; y: number; rotation?: number }>();
  for (const component of spec.components) {
    if (component.placement) {
      placements.set(component.id, component.placement);
      continue;
    }
    const bucket = componentRoleBucket(component.role, component.ref);
    const index = counters[bucket];
    counters[bucket] += 1;
    placements.set(component.id, defaultPlacementForComponent(component, index));
  }
  return placements;
}

function toPlacementPropertiesFromMap(
  component: DraftDesignSpec["components"][number],
  placements: Map<string, { x: number; y: number; rotation?: number }>
): Record<string, string> {
  const placement = placements.get(component.id);
  if (!placement) {
    return {};
  }
  return {
    placement_x: String(placement.x),
    placement_y: String(placement.y),
    placement_rotation: String(placement.rotation ?? 0),
  };
}

function toExpectedNetProperties(component: DraftDesignSpec["components"][number], spec: DraftDesignSpec): Record<string, string> {
  const pinNetPairs = spec.connections.flatMap((connection) =>
    connection.pinIds
      .filter((pinId) => component.pins.some((pin) => pin.id === pinId))
      .map((pinId) => {
        const pin = component.pins.find((item) => item.id === pinId);
        const suffix = String(pin?.pinName || pin?.pinNumber || pinId).replace(/[^a-zA-Z0-9]+/g, "_").toUpperCase();
        return [`expected_net_${suffix}`, normalizeNetName(connection.netName, connection.netName)] as const;
      })
  );
  return Object.fromEntries(pinNetPairs);
}

function buildNormalizedConnectionMap(
  connections: DraftDesignSpec["connections"]
): Map<string, { netName: string; pinIds: string[] }> {
  const connectionMap = new Map<string, { netName: string; pinIds: string[] }>();
  for (const connection of connections) {
    const normalizedNetName = normalizeNetName(connection.netName, connection.netName);
    const existing = connectionMap.get(normalizedNetName);
    if (existing) {
      for (const pinId of connection.pinIds) {
        if (!existing.pinIds.includes(pinId)) {
          existing.pinIds.push(pinId);
        }
      }
      continue;
    }
    connectionMap.set(normalizedNetName, {
      netName: normalizedNetName,
      pinIds: [...connection.pinIds],
    });
  }
  return connectionMap;
}

export function draftSpecToPlan(input: {
  spec: DraftDesignSpec;
  guidance?: DraftPlanGuidance;
}): DraftPlan {
  const { spec, guidance } = input;
  assertValidDraftSpec(spec);
  const placements = buildPlacementMap(spec);
  const normalizedConnections = spec.connections.map((connection) => ({
    ...connection,
    netName: normalizeNetName(connection.netName, connection.netName),
  }));
  const normalizedConnectionMap = buildNormalizedConnectionMap(spec.connections);
  const normalizedNets = spec.nets.map((net) => ({
    ...net,
    name: normalizeNetName(net.name, net.id),
  }));
  return {
    title: spec.title,
    rationale: spec.rationale,
    components: spec.components.map((component) => ({
      id: component.id,
      ref: component.ref,
      name: component.name,
      packageName: component.packageName,
      value: component.value,
      componentType: "part",
      addIntoBom: true,
      addIntoPcb: true,
      properties: {
        role: component.role,
        ...(component.searchQuery ? { preferred_search_query: component.searchQuery } : {}),
        ...toPlacementPropertiesFromMap(component, placements),
        ...toExpectedNetProperties(component, spec),
      },
    })),
    pins: spec.components.flatMap((component) =>
      component.pins.map((pin) => ({
        id: pin.id,
        componentId: component.id,
        pinNumber: pin.pinNumber,
        pinName: pin.pinName,
        electricalType: pin.electricalType,
        netName: normalizedConnections.find((connection) => connection.pinIds.includes(pin.id))?.netName,
      }))
    ),
    nets: normalizedNets.map((net) => ({
      id: net.id,
      name: net.name,
      isPower: net.isPower,
      nodeIds: normalizedConnectionMap.get(String(net.name || net.id))?.pinIds ?? [],
    })),
    guidance,
  };
}

export function isDraftDesignSpec(value: unknown): value is DraftDesignSpec {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.systemType === "string" &&
    typeof record.title === "string" &&
    typeof record.rationale === "string" &&
    Array.isArray(record.components) &&
    Array.isArray(record.nets) &&
    Array.isArray(record.connections)
  );
}
