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

function toExpectedNetProperties(component: DraftDesignSpec["components"][number], spec: DraftDesignSpec): Record<string, string> {
  const pinNetPairs = spec.connections.flatMap((connection) =>
    connection.pinIds
      .filter((pinId) => component.pins.some((pin) => pin.id === pinId))
      .map((pinId) => {
        const pin = component.pins.find((item) => item.id === pinId);
        const suffix = String(pin?.pinName || pin?.pinNumber || pinId).replace(/[^a-zA-Z0-9]+/g, "_").toUpperCase();
        return [`expected_net_${suffix}`, connection.netName] as const;
      })
  );
  return Object.fromEntries(pinNetPairs);
}

export function draftSpecToPlan(input: {
  spec: DraftDesignSpec;
  guidance?: DraftPlanGuidance;
}): DraftPlan {
  const { spec, guidance } = input;
  assertValidDraftSpec(spec);
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
        ...toPlacementProperties(component),
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
        netName: spec.connections.find((connection) => connection.pinIds.includes(pin.id))?.netName,
      }))
    ),
    nets: spec.nets.map((net) => ({
      id: net.id,
      name: net.name,
      isPower: net.isPower,
      nodeIds: spec.connections.find((connection) => connection.netName === String(net.name || net.id))?.pinIds ?? [],
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
