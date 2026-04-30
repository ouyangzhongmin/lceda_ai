import { previewDraftPlan } from "../apply-plan/previewDraftPlan";
import type { DraftPlan, DraftPreview } from "../apply-plan/draftPlan";
import { normalizeDraftPlan } from "../apply-plan/generateDraftPlan";
import { resolveDraftPlanDevices } from "../apply-plan/resolveDraftPlanDevices";
import type { SchematicPin } from "../../types/schematic";
import { typedGetLibrarySymbol, typedSearchLibraryDevices } from "./proHostProbe";
import { typedGetLibrarySymbolSource } from "./proHostProbe";
import { resolveHostEditorBridge } from "./runtime";
import type { ApplyPlanResult } from "../adapters/editorAdapter";
import { matchDraftPinsToRealPins } from "./pinMatchEngine";
import { resolveTransientComponentPins, type TransientPinRecord } from "./transientPinResolver";

export interface ApiApplyPlanAdapter {
  preview: (plan: DraftPlan) => Promise<DraftPreview>;
  apply: (plan: DraftPlan) => Promise<ApplyPlanResult>;
  rollback: (transactionId: string) => Promise<{ rolledBack: boolean; transactionId: string }>;
}

type ApplyTransaction =
  | { kind: "source"; sourceSnapshot: unknown }
  | { kind: "shape"; shapeIds: string[] }
  | { kind: "typed_schematic"; componentIds: string[]; wireIds: string[] };

type SkippedConnection = {
  fromComponentRef?: string;
  fromPin?: string;
  toComponentRef?: string;
  toPin?: string;
  netName?: string;
  reason: string;
};

type TypedApplyResult = {
  componentIds: string[];
  wireIds: string[];
  labelIds: string[];
  connectedNetCount: number;
  skippedConnections: SkippedConnection[];
};

const applyTransactions = new Map<string, ApplyTransaction>();

export function createApiApplyPlanAdapter(
  invoker?: (name: string, ...args: unknown[]) => Promise<unknown>,
  options?: { typedPlacementEnabled?: boolean }
): ApiApplyPlanAdapter {
  return {
    preview: async (plan: DraftPlan): Promise<DraftPreview> => previewDraftPlan(normalizeDraftPlan(plan)),
    apply: async (plan: DraftPlan): Promise<ApplyPlanResult> => {
      plan = normalizeDraftPlan(plan);
      if (options?.typedPlacementEnabled && !canApplyByTypedPlacement(plan)) {
        plan = await resolveDraftPlanDevices(plan, async (query) =>
          typedSearchLibraryDevices({ query, scope: "system", pageSize: 5 })
        );
        if (hasAnyPlacementDevice(plan) && !canApplyByTypedPlacement(plan)) {
          throw new Error(
            `typed placement requires all draft components to have resolved devices: ${listUnresolvedPlacementComponents(plan).join(", ")}`
          );
        }
      }
      if (options?.typedPlacementEnabled && canApplyByTypedPlacement(plan)) {
        plan = await enrichResolvedPinsForTypedPlacement(plan);
      }
      const transactionId = createTransactionId();
      if (options?.typedPlacementEnabled && canApplyByTypedPlacement(plan)) {
        const placed = await applyTypedSchematicPlan(plan);
        const applied = placed.componentIds.length > 0 || placed.wireIds.length > 0;
        applyTransactions.set(transactionId, {
          kind: "typed_schematic",
          componentIds: placed.componentIds,
          wireIds: placed.wireIds,
        });
        return summarizeApply(plan, transactionId, applied, applied, {
          connectedNetCount: placed.connectedNetCount,
          skippedConnections: placed.skippedConnections,
        });
      }
      if (!invoker) {
        return summarizeApply(plan, transactionId, false, false);
      }

      const sourceRead = await tryInvokeCandidates(invoker, [
        ["getSource"],
        ["getSchSource"],
        ["getCurrentSchematic"],
      ]);

      if (sourceRead.called) {
        const mergedSource = mergeDraftIntoSource(sourceRead.value, plan);
        const sourceWrite = await tryInvokeCandidates(invoker, [
          ["applySource", mergedSource],
          ["applySource", JSON.stringify(mergedSource)],
          ["setSource", mergedSource],
          ["setSource", JSON.stringify(mergedSource)],
          ["updateSource", mergedSource],
          ["updateSource", JSON.stringify(mergedSource)],
        ]);
        if (!sourceWrite.called) {
          throw new Error("host api apply source failed: applySource/setSource/updateSource unavailable");
        }
        applyTransactions.set(transactionId, {
          kind: "source",
          sourceSnapshot: sourceRead.value,
        });
        return summarizeApply(plan, transactionId, true, true);
      }

      const shapes = draftToShapes(plan);
      const createdShapeIds: string[] = [];
      for (const shape of shapes) {
        const existingResult = await tryInvokeCandidates(invoker, [
          ["getShape", shape.id],
          ["getShape", shape.kind, shape.id],
        ]);
        if (existingResult.called && existingResult.value !== undefined && existingResult.value !== null) {
          const updated = await tryInvokeCandidates(invoker, [
            ["updateShape", shape.id, shape.payload],
            ["updateShape", shape.payload],
            ["updateShape", shape.kind, shape.id, shape.payload],
          ]);
          if (updated.called) {
            continue;
          }
        }
        const created = await tryInvokeCandidates(invoker, [
          ["createShape", shape.payload],
          ["createShape", shape.kind, shape.payload],
        ]);
        if (!created.called || !isSuccessfulMutationResult(created.value)) {
          throw new Error(`host api apply shape failed: cannot create shape ${shape.id}`);
        }
        if (!(existingResult.called && existingResult.value !== undefined && existingResult.value !== null)) {
          createdShapeIds.push(shape.id);
        }
      }

      applyTransactions.set(transactionId, {
        kind: "shape",
        shapeIds: createdShapeIds,
      });
      return summarizeApply(plan, transactionId, createdShapeIds.length > 0, createdShapeIds.length > 0);
    },
    rollback: async (transactionId: string): Promise<{ rolledBack: boolean; transactionId: string }> => {
      const tx = applyTransactions.get(transactionId);
      if (!tx) {
        return { rolledBack: false, transactionId };
      }

      if (tx.kind === "source") {
        if (!invoker) {
          return { rolledBack: false, transactionId };
        }
        const reverted = await tryInvokeCandidates(invoker, [
          ["applySource", tx.sourceSnapshot],
          ["setSource", tx.sourceSnapshot],
          ["updateSource", tx.sourceSnapshot],
        ]);
        if (reverted.called) {
          applyTransactions.delete(transactionId);
          return { rolledBack: true, transactionId };
        }
        return { rolledBack: false, transactionId };
      }

      if (tx.kind === "typed_schematic") {
        const deletedWire = await deleteTypedSchematicWires(tx.wireIds);
        const deletedComponent = await deleteTypedSchematicComponents(tx.componentIds);
        applyTransactions.delete(transactionId);
        return { rolledBack: deletedWire || deletedComponent, transactionId };
      }

      for (const shapeId of tx.shapeIds) {
        await tryInvokeCandidates(invoker, [
          ["deleteShape", shapeId],
          ["removeShape", shapeId],
        ]);
      }
      applyTransactions.delete(transactionId);
      return { rolledBack: tx.shapeIds.length > 0, transactionId };
    },
  };
}

async function enrichResolvedPinsForTypedPlacement(plan: DraftPlan): Promise<DraftPlan> {
  plan = await enrichResolvedPinsFromTransientPlacement(plan);
  const needsPinResolution = plan.pins.some(
    (pin) => pin.pinResolutionStatus === "unresolved" || !(pin.resolvedPinName || pin.resolvedPinNumber)
  );
  if (!needsPinResolution) {
    return plan;
  }
  const bridge = resolveHostEditorBridge();
  if (!bridge?.getLibraryDevice) {
    return plan;
  }
  return resolveDraftPlanDevices(
    plan,
    async () => [],
    async ({ deviceUuid, libraryUuid }) =>
      bridge.getLibraryDevice!({
        deviceUuid,
        libraryUuid,
        scope: "system",
      }),
    bridge.getLibrarySymbol
      ? async ({ symbolUuid, libraryUuid }) =>
          bridge.getLibrarySymbol!({
            symbolUuid,
            libraryUuid,
            scope: "system",
          })
      : async ({ symbolUuid, libraryUuid }) =>
          typedGetLibrarySymbol({
            symbolUuid,
            libraryUuid,
            scope: "system",
          }),
    bridge.getLibrarySymbolSource
      ? async ({ symbolUuid, libraryUuid }) =>
          bridge.getLibrarySymbolSource!({
            symbolUuid,
            libraryUuid,
            scope: "system",
          })
      : async ({ symbolUuid, libraryUuid }) =>
          typedGetLibrarySymbolSource({
            symbolUuid,
            libraryUuid,
            scope: "system",
          })
  );
}

async function enrichResolvedPinsFromTransientPlacement(plan: DraftPlan): Promise<DraftPlan> {
  if (typeof eda === "undefined") {
    return plan;
  }
  if (typeof eda.sch_PrimitiveComponent?.create !== "function") {
    return plan;
  }
  if (typeof eda.sch_PrimitiveComponent?.getAllPinsByPrimitiveId !== "function") {
    return plan;
  }
  if (typeof eda.sch_PrimitiveComponent?.delete !== "function") {
    return plan;
  }

  const components = plan.components
    .map((component) => {
      const deviceUuid = component.properties.device_uuid;
      const libraryUuid = component.properties.library_uuid;
      if (!deviceUuid || !libraryUuid) {
        return null;
      }
      return {
        componentId: component.id,
        ref: component.ref,
        deviceUuid,
        libraryUuid,
      };
    })
    .filter((component): component is { componentId: string; ref?: string; deviceUuid: string; libraryUuid: string } =>
      Boolean(component)
    );

  if (components.length === 0) {
    return plan;
  }

  const resolved = await resolveTransientComponentPins(
    { components },
    {
      createComponent: async ({ deviceUuid, libraryUuid, index }) => {
        const x = 12000 + (index % 6) * 240;
        const y = 12000 + Math.floor(index / 6) * 180;
        const created = await eda.sch_PrimitiveComponent.create(
          {
            uuid: deviceUuid,
            libraryUuid,
          },
          x,
          y,
          undefined,
          0,
          false,
          true,
          true
        );
        if (!created) {
          return null;
        }
        return { primitiveId: created.getState_PrimitiveId() };
      },
      getPinsByPrimitiveId: async (primitiveId) => readTransientPins(primitiveId),
      deleteComponents: async (primitiveIds) => eda.sch_PrimitiveComponent.delete(primitiveIds),
    }
  );

  const nextPins = plan.pins.map((pin) => ({ ...pin }));
  let changed = false;
  for (const component of plan.components) {
    const realPins = resolved.componentPins.get(component.id);
    if (!realPins || realPins.length === 0) {
      continue;
    }
    const planPins = nextPins.filter((pin) => pin.componentId === component.id);
    const matches = matchDraftPinsToRealPins({
      role: inferTransientPinMatchRole(component.ref, component.name),
      planPins,
      realPins,
    });
    for (const planPin of planPins) {
      const match = matches.get(planPin.id);
      if (!match) {
        continue;
      }
      const changedPin = applyResolvedPinMatch(planPin, match);
      if (changedPin !== planPin) {
        const index = nextPins.findIndex((candidate) => candidate.id === changedPin.id);
        nextPins[index] = changedPin;
        changed = true;
      }
    }
  }

  return changed ? { ...plan, pins: nextPins } : plan;
}

function readTransientPins(primitiveId: string): Promise<TransientPinRecord[]> {
  return Promise.resolve(eda.sch_PrimitiveComponent.getAllPinsByPrimitiveId(primitiveId)).then((pins) =>
    (pins ?? []).map((pin) => ({
      primitiveId: pin.getState_PrimitiveId(),
      pinName: pin.getState_PinName(),
      pinNumber: pin.getState_PinNumber(),
      x: pin.getState_X(),
      y: pin.getState_Y(),
    }))
  );
}

function inferTransientPinMatchRole(ref: string | undefined, name: string | undefined): string | undefined {
  const upperRef = String(ref || "").toUpperCase();
  const lowerName = String(name || "").toLowerCase();
  if (upperRef.startsWith("D") || lowerName.includes("led")) {
    return "led";
  }
  if (upperRef.startsWith("R") || lowerName.includes("resistor")) {
    return "resistor";
  }
  if (upperRef.startsWith("C") || lowerName.includes("capacitor")) {
    return "capacitor";
  }
  if (upperRef.startsWith("J") || lowerName.includes("connector") || lowerName.includes("header")) {
    return "connector";
  }
  return undefined;
}

function applyResolvedPinMatch(
  pin: SchematicPin,
  match: { resolvedPinName?: string; resolvedPinNumber?: string; confidence: number; reason: string }
): SchematicPin {
  const nextPin: SchematicPin = {
    ...pin,
    resolvedPinName: match.resolvedPinName ?? pin.resolvedPinName,
    resolvedPinNumber: match.resolvedPinNumber ?? pin.resolvedPinNumber,
    pinResolutionStatus: "resolved",
    pinResolutionConfidence: match.confidence,
    pinResolutionReason: match.reason,
  };
  if (
    nextPin.resolvedPinName === pin.resolvedPinName &&
    nextPin.resolvedPinNumber === pin.resolvedPinNumber &&
    nextPin.pinResolutionStatus === pin.pinResolutionStatus &&
    nextPin.pinResolutionConfidence === pin.pinResolutionConfidence &&
    nextPin.pinResolutionReason === pin.pinResolutionReason
  ) {
    return pin;
  }
  return nextPin;
}

function hasAnyPlacementDevice(plan: DraftPlan): boolean {
  return plan.components.some((component) => {
    const deviceUuid = component.properties.device_uuid;
    const libraryUuid = component.properties.library_uuid;
    return typeof deviceUuid === "string" && deviceUuid && typeof libraryUuid === "string" && libraryUuid;
  });
}

function requiresResolvedPlacementDevice(component: DraftPlan["components"][number]): boolean {
  return component.properties.generated_by !== "rule_completion";
}

function listUnresolvedPlacementComponents(plan: DraftPlan): string[] {
  return plan.components
    .filter((component) => {
      if (!requiresResolvedPlacementDevice(component)) {
        return false;
      }
      const deviceUuid = component.properties.device_uuid;
      const libraryUuid = component.properties.library_uuid;
      return !(typeof deviceUuid === "string" && deviceUuid && typeof libraryUuid === "string" && libraryUuid);
    })
    .map((component) => component.ref || component.name || component.id);
}

function canApplyByTypedPlacement(plan: DraftPlan): boolean {
  if (typeof eda === "undefined") {
    return false;
  }
  if (typeof eda.sch_PrimitiveComponent?.create !== "function") {
    return false;
  }
  if (typeof eda.sch_PrimitiveWire?.create !== "function") {
    return false;
  }
  const requiredComponents = plan.components.filter(requiresResolvedPlacementDevice);
  return requiredComponents.length > 0 && requiredComponents.every((component) => {
    const deviceUuid = component.properties.device_uuid;
    const libraryUuid = component.properties.library_uuid;
    return typeof deviceUuid === "string" && deviceUuid && typeof libraryUuid === "string" && libraryUuid;
  });
}

async function applyTypedSchematicPlan(plan: DraftPlan): Promise<TypedApplyResult> {
  const componentIds: string[] = [];
  const wireIds: string[] = [];
  const labelIds: string[] = [];
  const placedPins = new Map<string, { x: number; y: number; primitiveId: string }>();
  const skippedConnections: SkippedConnection[] = [];
  let connectedNetCount = 0;
  const defaultPlacements = buildFunctionalPlacementMap(plan);
  try {
    for (const [index, component] of plan.components.entries()) {
      const deviceUuid = component.properties.device_uuid;
      const libraryUuid = component.properties.library_uuid;
      if (!deviceUuid || !libraryUuid) {
        continue;
      }
      const fallbackPlacement = defaultPlacements.get(component.id) ?? buildIndexedFallbackPlacement(index);
      const x = clampToDrawingBoundsX(parsePlacementNumber(component.properties.placement_x) ?? fallbackPlacement.x);
      const y = clampToDrawingBoundsY(parsePlacementNumber(component.properties.placement_y) ?? fallbackPlacement.y);
      const rotation = parsePlacementNumber(component.properties.placement_rotation) ?? 0;
      const created = await eda.sch_PrimitiveComponent.create(
        {
          uuid: deviceUuid,
          libraryUuid,
        },
        x,
        y,
        undefined,
        rotation,
        false,
        true,
        true
      );
      if (!created) {
        continue;
      }
      applyComponentDesignator(created, component.ref);
      const primitiveId = created.getState_PrimitiveId();
      componentIds.push(primitiveId);
      const pins = await eda.sch_PrimitiveComponent.getAllPinsByPrimitiveId(primitiveId);
      if (pins) {
        for (const pin of pins) {
          const pinName = pin.getState_PinName();
          const pinNumber = pin.getState_PinNumber();
          const planPin = findBestMatchingPlanPin(plan.pins, component.id, pinName, pinNumber);
          if (!planPin) {
            continue;
          }
          placedPins.set(planPin.id, {
            x: pin.getState_X(),
            y: pin.getState_Y(),
            primitiveId: pin.getState_PrimitiveId(),
          });
        }
      }
    }

    for (const net of plan.nets) {
      const displayNetName = resolveDisplayNetName(plan, net);
      const nodeIds = [...new Set(net.nodeIds)];
      const nodePoints = net.nodeIds
        .map((nodeId) => placedPins.get(nodeId))
        .filter((item): item is { x: number; y: number; primitiveId: string } => Boolean(item));
      const missingNodeIds = nodeIds.filter((nodeId) => !placedPins.has(nodeId));
      if (missingNodeIds.length > 0) {
        skippedConnections.push(
          ...buildSkippedConnectionsForNet(plan, displayNetName, missingNodeIds, "endpoint_unresolved")
        );
        continue;
      }
      if (nodePoints.length < 2) {
        continue;
      }
      if (shouldUseNetLabelsForNet(displayNetName, nodePoints)) {
        const createdLabeledNet = await createNetLabelsForNet(nodePoints, displayNetName);
        if (createdLabeledNet.labelIds.length > 0) {
          wireIds.push(...createdLabeledNet.wireIds);
          labelIds.push(...createdLabeledNet.labelIds);
          connectedNetCount += 1;
          continue;
        }
      }
      const line = buildOrthogonalPolyline(nodePoints);
      const createdWire = await eda.sch_PrimitiveWire.create(line, displayNetName);
      if (!createdWire) {
        continue;
      }
      wireIds.push(createdWire.getState_PrimitiveId());
      connectedNetCount += 1;
    }

    skippedConnections.push(...collectSkippedRequiredConnections(plan, placedPins));

    return { componentIds, wireIds, labelIds, connectedNetCount, skippedConnections };
  } catch (error) {
    await deleteTypedSchematicLabels(labelIds);
    await deleteTypedSchematicWires(wireIds);
    await deleteTypedSchematicComponents(componentIds);
    throw error;
  }
}

type FunctionalZone =
  | "power"
  | "control"
  | "clock"
  | "input"
  | "processing"
  | "audio"
  | "output"
  | "interface"
  | "support";

const DRAWING_BOUNDS = {
  minX: 80,
  minY: 100,
  maxX: 1080,
  maxY: 720,
};

const NET_LABEL_DISTANCE_THRESHOLD = 260;

function buildFunctionalPlacementMap(plan: DraftPlan): Map<string, { x: number; y: number }> {
  const zoneOrder: FunctionalZone[] = [
    "power",
    "control",
    "clock",
    "input",
    "processing",
    "audio",
    "output",
    "interface",
    "support",
  ];
  const zoneAnchors: Record<FunctionalZone, { x: number; y: number }> = {
    power: { x: 140, y: 180 },
    control: { x: 300, y: 180 },
    clock: { x: 460, y: 160 },
    input: { x: 300, y: 340 },
    processing: { x: 560, y: 300 },
    audio: { x: 800, y: 240 },
    output: { x: 920, y: 300 },
    interface: { x: 920, y: 500 },
    support: { x: 560, y: 560 },
  };
  const zoneBuckets = new Map<FunctionalZone, DraftPlan["components"]>();
  for (const zone of zoneOrder) {
    zoneBuckets.set(zone, []);
  }
  for (const component of plan.components) {
    zoneBuckets.get(inferFunctionalZone(component))?.push(component);
  }
  const placements = new Map<string, { x: number; y: number }>();
  const intraZoneX = 180;
  const intraZoneY = 120;
  const maxCols = 2;
  for (const zone of zoneOrder) {
    const anchor = zoneAnchors[zone];
    const components = zoneBuckets.get(zone) ?? [];
    components.forEach((component, index) => {
      placements.set(component.id, {
        x: clampToDrawingBoundsX(anchor.x + (index % maxCols) * intraZoneX),
        y: clampToDrawingBoundsY(anchor.y + Math.floor(index / maxCols) * intraZoneY),
      });
    });
  }
  return placements;
}

function buildIndexedFallbackPlacement(index: number): { x: number; y: number } {
  const gridX = 180;
  const gridY = 120;
  return {
    x: clampToDrawingBoundsX(220 + (index % 4) * gridX),
    y: clampToDrawingBoundsY(220 + Math.floor(index / 4) * gridY),
  };
}

function inferFunctionalZone(component: DraftPlan["components"][number]): FunctionalZone {
  const ref = String(component.ref || "").toUpperCase();
  const name = String(component.name || "").toLowerCase();
  const device = String(component.properties.device_name || component.properties.preferred_search_query || "").toLowerCase();
  const completionRole = String(component.properties.completion_role || "").toLowerCase();
  const text = `${ref} ${name} ${device} ${completionRole}`;
  if (
    /^B\d+/u.test(ref) ||
    /^BT\d+/u.test(ref) ||
    /(battery|charger|charge|ldo|buck|boost|regulator|pmic|type-c|usb|vbus|power|tp4056|ip5306|dw01|fs8205)/iu.test(text)
  ) {
    return "power";
  }
  if (
    /^U\d+/u.test(ref) &&
    /(esp32|stm32|nrf|mcu|soc|controller|cpu|processor|rp2040|esp-|esp_)/iu.test(text)
  ) {
    return "processing";
  }
  if (/(crystal|oscillator|xtal|26mhz|32khz|clock)/iu.test(text) || /^X\d+/u.test(ref)) {
    return "clock";
  }
  if (/(mic|microphone|mems|sensor|hall|button|key|switch|touch|input)/iu.test(text)) {
    return "input";
  }
  if (/(codec|dac|i2s|audio)/iu.test(text)) {
    return "audio";
  }
  if (/(amp|speaker|spk|buzzer|earphone|output)/iu.test(text)) {
    return "output";
  }
  if (/(pullup|pulldown|decoupling|bulk_cap|load_cap|gain_config|esd|clock)/iu.test(completionRole)) {
    return "support";
  }
  if (/^J\d+/u.test(ref) || /(connector|header|socket|antenna|uart|debug|download)/iu.test(text)) {
    return "interface";
  }
  if (/(led|reset|boot|en|indicator|status)/iu.test(text)) {
    return "control";
  }
  return "support";
}

function parsePlacementNumber(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function applyComponentDesignator(created: unknown, ref: string | undefined): void {
  if (!created || !ref || typeof created !== "object") {
    return;
  }
  const record = created as Record<string, unknown>;
  const candidateMethodNames = [
    "setState_Designator",
    "setDesignator",
    "setState_Ref",
  ];
  for (const methodName of candidateMethodNames) {
    const method = record[methodName];
    if (typeof method !== "function") {
      continue;
    }
    try {
      method.call(created, ref);
      return;
    } catch {
      // Try next compatible setter.
    }
  }
}

function collectSkippedRequiredConnections(
  plan: DraftPlan,
  placedPins: Map<string, { x: number; y: number; primitiveId: string }>
): SkippedConnection[] {
  const requiredConnections = plan.guidance?.requiredConnections;
  if (!requiredConnections || requiredConnections.length === 0) {
    return [];
  }
  const skipped: SkippedConnection[] = [];

  const componentsByRef = new Map(
    plan.components
      .filter((component) => component.ref)
      .map((component) => [String(component.ref), component.id] as const)
  );

  for (const connection of requiredConnections) {
    const fromComponentId = componentsByRef.get(connection.fromComponentRef);
    const toComponentId = componentsByRef.get(connection.toComponentRef);
    const fromPin = resolvePlanPin(plan, fromComponentId, connection.fromPin);
    const toPin = resolvePlanPin(plan, toComponentId, connection.toPin);
    const net = plan.nets.find((item) => item.name === connection.netName);

    if (!fromComponentId || !toComponentId || !fromPin || !toPin || !net) {
      skipped.push({
        fromComponentRef: connection.fromComponentRef,
        fromPin: connection.fromPin,
        toComponentRef: connection.toComponentRef,
        toPin: connection.toPin,
        netName: connection.netName,
        reason: "required_connection_definition_unresolved",
      });
      continue;
    }

    if (!net.nodeIds.includes(fromPin.id) || !net.nodeIds.includes(toPin.id)) {
      skipped.push({
        fromComponentRef: connection.fromComponentRef,
        fromPin: connection.fromPin,
        toComponentRef: connection.toComponentRef,
        toPin: connection.toPin,
        netName: connection.netName,
        reason: "required_connection_net_mismatch",
      });
      continue;
    }

    if (!placedPins.has(fromPin.id) || !placedPins.has(toPin.id)) {
      skipped.push({
        fromComponentRef: connection.fromComponentRef,
        fromPin: connection.fromPin,
        toComponentRef: connection.toComponentRef,
        toPin: connection.toPin,
        netName: connection.netName,
        reason: "required_connection_endpoint_unresolved",
      });
    }
  }
  return skipped;
}

function buildSkippedConnectionsForNet(
  plan: DraftPlan,
  netName: string,
  missingNodeIds: string[],
  reason: string
): SkippedConnection[] {
  const pinsById = new Map(plan.pins.map((pin) => [pin.id, pin]));
  const componentsById = new Map(plan.components.map((component) => [component.id, component]));
  return missingNodeIds.map((nodeId) => {
    const pin = pinsById.get(nodeId);
    const component = pin ? componentsById.get(pin.componentId) : undefined;
    return {
      fromComponentRef: component?.ref ?? component?.id,
      fromPin: pin?.pinName ?? pin?.pinNumber ?? pin?.id,
      netName,
      reason,
    };
  });
}

function resolveDisplayNetName(
  plan: DraftPlan,
  net: DraftPlan["nets"][number]
): string {
  const rawName = String(net.name || net.id || "").trim();
  if (!rawName) {
    return net.id;
  }
  const normalized = rawName.toUpperCase();
  if (isStandardNetName(normalized)) {
    return normalized;
  }
  const componentsById = new Map(plan.components.map((component) => [component.id, component]));
  const pinsById = new Map(plan.pins.map((pin) => [pin.id, pin]));
  const endpointPins = net.nodeIds
    .map((nodeId) => pinsById.get(nodeId))
    .filter((pin): pin is DraftPlan["pins"][number] => Boolean(pin))
  const endpointComponents = endpointPins
    .map((pin) => componentsById.get(pin.componentId))
    .filter((component): component is DraftPlan["components"][number] => Boolean(component));
  const primaryRole = inferNetPrimaryRole(endpointComponents);
  const normalizedTokens = normalized.replace(/[^A-Z0-9]+/g, "_");
  if (isLowSignalNetName(normalized)) {
    const semanticName = inferSemanticNetNameFromPins(endpointPins, endpointComponents);
    if (semanticName) {
      return semanticName;
    }
  }
  if (/ESP_EN|CHIP_EN|ENABLE|^EN$/iu.test(normalized)) {
    return `${primaryRole}_EN`;
  }
  if (/STATUS_LED|LED_STATUS/iu.test(normalized)) {
    return "LED_STATUS";
  }
  if (/BOOT_IO0|GPIO0_BOOT|BOOT0/iu.test(normalized)) {
    return `${primaryRole}_BOOT0`;
  }
  if (/MIC|MICROPHONE/.test(normalizedTokens)) {
    if (/DATA|SD|DOUT/.test(normalizedTokens)) {
      return "MIC_SD";
    }
    if (/WS|LRCK/.test(normalizedTokens)) {
      return "MIC_WS";
    }
    if (/CLK|BCLK/.test(normalizedTokens)) {
      return "MIC_CLK";
    }
  }
  if (/AMP|SPEAKER/.test(normalizedTokens)) {
    if (/DIN|DATA|AUDIO/.test(normalizedTokens)) {
      return "AMP_DIN";
    }
    if (/GAIN/.test(normalizedTokens)) {
      return "AMP_GAIN";
    }
  }
  if (/USB/.test(normalizedTokens)) {
    if (/POWER|VBUS|5V/.test(normalizedTokens)) {
      return "USB_5V_IN";
    }
  }
  if (/BUTTON|BTN|KEY/.test(normalizedTokens)) {
    if (/BOOT/.test(normalizedTokens)) {
      return "BTN_BOOT";
    }
    if (/RESET|RST/.test(normalizedTokens)) {
      return "BTN_RESET";
    }
  }
  return normalized;
}

function isStandardNetName(name: string): boolean {
  return /^(VBUS|VBAT|5V|3V3|GND|I2C_SCL|I2C_SDA|I2S_BCLK|I2S_LRCK|I2S_DOUT|UART_TX|UART_RX)$/iu.test(name);
}

function isLowSignalNetName(name: string): boolean {
  return /^(NET[_-]?\d+|N\$\d+|UNNAMED.*|SIG\d*)$/iu.test(name);
}

function inferNetPrimaryRole(components: DraftPlan["components"]): "MCU" | "MIC" | "AMP" | "USB" | "LED" {
  for (const component of components) {
    const text = `${component.ref || ""} ${component.name || ""} ${component.properties.completion_role || ""}`.toUpperCase();
    if (/(ESP32|STM32|NRF|RP2040|MCU|SOC)/iu.test(text)) {
      return "MCU";
    }
    if (/(MIC|INMP441|MICROPHONE)/iu.test(text)) {
      return "MIC";
    }
    if (/(MAX98357|AMP|SPEAKER)/iu.test(text)) {
      return "AMP";
    }
    if (/(USB|TYPE-C|VBUS)/iu.test(text)) {
      return "USB";
    }
    if (/(LED|STATUS)/iu.test(text)) {
      return "LED";
    }
  }
  return "MCU";
}

function inferSemanticNetNameFromPins(
  pins: DraftPlan["pins"],
  components: DraftPlan["components"]
): string | undefined {
  const pinTokens = pins
    .flatMap((pin) => [pin.pinName, pin.resolvedPinName, pin.pinNumber])
    .filter((value): value is string => Boolean(value))
    .map((value) => value.toUpperCase());
  const primaryRole = inferNetPrimaryRole(components);
  const joined = pinTokens.join(" ");
  if (/\b(BCLK|CLK)\b/.test(joined) && components.some((component) => /MIC|INMP441/iu.test(`${component.name || ""}`))) {
    return "MIC_CLK";
  }
  if (/\b(WS|LRCK|L\/R)\b/.test(joined) && components.some((component) => /MIC|INMP441/iu.test(`${component.name || ""}`))) {
    return "MIC_WS";
  }
  if (/\b(DIN|DOUT|SD|DATA)\b/.test(joined)) {
    if (components.some((component) => /MAX98357|AMP|SPEAKER/iu.test(`${component.name || ""}`))) {
      return "AMP_DIN";
    }
    if (components.some((component) => /MIC|INMP441/iu.test(`${component.name || ""}`))) {
      return "MIC_SD";
    }
  }
  if (/\b(VBUS|5V)\b/.test(joined) && primaryRole === "USB") {
    return "USB_5V_IN";
  }
  if (/\b(BOOT|IO0|GPIO0)\b/.test(joined)) {
    return "BTN_BOOT";
  }
  return undefined;
}

function summarizeApply(
  plan: DraftPlan,
  transactionId: string,
  applied: boolean,
  rollbackSupported: boolean,
  partialWiring?: {
    connectedNetCount: number;
    skippedConnections: SkippedConnection[];
  }
): ApplyPlanResult {
  return {
    applied,
    componentCount: plan.components.length,
    netCount: plan.nets.length,
    transactionId,
    rollbackSupported,
    partialWiring: partialWiring
      ? {
          connectedNetCount: partialWiring.connectedNetCount,
          skippedConnectionCount: partialWiring.skippedConnections.length,
          skippedConnections: partialWiring.skippedConnections,
        }
      : undefined,
  };
}

function ensureResolvedDraftPinsForTypedPlacement(plan: DraftPlan): void {
  const componentsById = new Map(plan.components.map((component) => [component.id, component]));
  const unresolvedPins = plan.pins.filter((pin) => {
    if (pin.pinResolutionStatus === "unresolved") {
      return true;
    }
    return !(pin.resolvedPinName || pin.resolvedPinNumber);
  });
  if (unresolvedPins.length === 0) {
    return;
  }
  const labels = unresolvedPins.map((pin) => {
    const component = componentsById.get(pin.componentId);
    const ref = component?.ref ?? component?.id ?? pin.componentId;
    const label = pin.pinName || pin.pinNumber || pin.id;
    return `${ref}.${label}`;
  });
  throw new Error(`unresolved draft pin mappings: ${labels.join(", ")}`);
}

function resolvePlanPin(
  plan: DraftPlan,
  componentId: string | undefined,
  pinLabel: string
): DraftPlan["pins"][number] | undefined {
  if (!componentId) {
    return undefined;
  }
  return plan.pins.find(
    (pin) =>
      pin.componentId === componentId &&
      (String(pin.pinNumber || "").trim() === pinLabel || String(pin.pinName || "").trim() === pinLabel)
  );
}

function findBestMatchingPlanPin(
  pins: DraftPlan["pins"],
  componentId: string,
  pinName?: string,
  pinNumber?: string
): DraftPlan["pins"][number] | undefined {
  const candidates = pins.filter(
    (item) =>
      item.componentId === componentId &&
      item.pinResolutionStatus !== "unresolved" &&
      Boolean(item.resolvedPinName || item.resolvedPinNumber)
  );
  if (candidates.length === 0) {
    return undefined;
  }

  let bestScore = -1;
  let bestMatch: DraftPlan["pins"][number] | undefined;

  for (const candidate of candidates) {
    let score = 0;
    if (candidate.resolvedPinNumber && pinNumber && candidate.resolvedPinNumber === pinNumber) {
      score += 200;
    }
    if (candidate.resolvedPinName && pinName && candidate.resolvedPinName === pinName) {
      score += 180;
    }
    if (score > bestScore) {
      bestScore = score;
      bestMatch = candidate;
    }
  }

  return bestScore > 0 ? bestMatch : undefined;
}

function buildOrthogonalPolyline(points: Array<{ x: number; y: number }>): number[] {
  if (points.length < 2) {
    return points.flatMap((point) => [point.x, point.y]);
  }
  const line: number[] = [points[0].x, points[0].y];
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    const middleX = current.x;
    const middleY = previous.y;
    if (line[line.length - 2] !== middleX || line[line.length - 1] !== middleY) {
      line.push(middleX, middleY);
    }
    if (line[line.length - 2] !== current.x || line[line.length - 1] !== current.y) {
      line.push(current.x, current.y);
    }
  }
  return line;
}

function clampToDrawingBoundsX(value: number): number {
  return Math.min(DRAWING_BOUNDS.maxX, Math.max(DRAWING_BOUNDS.minX, value));
}

function clampToDrawingBoundsY(value: number): number {
  return Math.min(DRAWING_BOUNDS.maxY, Math.max(DRAWING_BOUNDS.minY, value));
}

function shouldUseNetLabelsForNet(
  netName: string | undefined,
  points: Array<{ x: number; y: number }>
): boolean {
  if (!netName || points.length < 2) {
    return false;
  }
  if (typeof eda === "undefined" || typeof (eda as typeof eda & Record<string, any>).sch_PrimitiveNetLabel?.create !== "function") {
    return false;
  }
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const span = (Math.max(...xs) - Math.min(...xs)) + (Math.max(...ys) - Math.min(...ys));
  return span >= NET_LABEL_DISTANCE_THRESHOLD;
}

async function createNetLabelsForNet(
  points: Array<{ x: number; y: number }>,
  netName: string
): Promise<{ wireIds: string[]; labelIds: string[] }> {
  if (typeof eda === "undefined") {
    return { wireIds: [], labelIds: [] };
  }
  const labelApi = (eda as typeof eda & Record<string, any>).sch_PrimitiveNetLabel;
  if (!labelApi || typeof labelApi.create !== "function") {
    return { wireIds: [], labelIds: [] };
  }
  const wireIds: string[] = [];
  const labelIds: string[] = [];
  for (const point of points) {
    const direction = point.x <= (DRAWING_BOUNDS.minX + DRAWING_BOUNDS.maxX) / 2 ? 1 : -1;
    const stubEndX = clampToDrawingBoundsX(point.x + direction * 40);
    const stub = buildOrthogonalPolyline([
      { x: point.x, y: point.y },
      { x: stubEndX, y: point.y },
    ]);
    const createdWire = await eda.sch_PrimitiveWire.create(stub, undefined);
    if (createdWire?.getState_PrimitiveId) {
      wireIds.push(createdWire.getState_PrimitiveId());
    }
    const labelX = clampToDrawingBoundsX(stubEndX + direction * 18);
    const createdLabel = await labelApi.create(labelX, point.y, netName);
    if (createdLabel?.getState_PrimitiveId) {
      labelIds.push(createdLabel.getState_PrimitiveId());
    }
  }
  return { wireIds, labelIds };
}

async function deleteTypedSchematicComponents(componentIds: string[]): Promise<boolean> {
  if (typeof eda === "undefined" || typeof eda.sch_PrimitiveComponent?.delete !== "function") {
    return false;
  }
  if (componentIds.length === 0) {
    return false;
  }
  return eda.sch_PrimitiveComponent.delete(componentIds);
}

async function deleteTypedSchematicWires(wireIds: string[]): Promise<boolean> {
  if (typeof eda === "undefined" || typeof eda.sch_PrimitiveWire?.delete !== "function") {
    return false;
  }
  if (wireIds.length === 0) {
    return false;
  }
  return eda.sch_PrimitiveWire.delete(wireIds);
}

async function deleteTypedSchematicLabels(labelIds: string[]): Promise<boolean> {
  if (typeof eda === "undefined") {
    return false;
  }
  const labelApi = (eda as typeof eda & Record<string, any>).sch_PrimitiveNetLabel;
  if (!labelApi || typeof labelApi.delete !== "function") {
    return false;
  }
  if (labelIds.length === 0) {
    return false;
  }
  return labelApi.delete(labelIds);
}

function isSuccessfulMutationResult(value: unknown): boolean {
  if (value === undefined || value === null || value === false) {
    return false;
  }
  return true;
}

function mergeDraftIntoSource(rawSource: unknown, plan: DraftPlan): Record<string, unknown> {
  const base = normalizeSourceObject(rawSource);
  const components = normalizeArray(base.components);
  const pins = normalizeArray(base.pins);
  const nets = normalizeArray(base.nets);

  base.components = mergeById(components, plan.components as unknown as Record<string, unknown>[]);
  base.pins = mergeById(pins, plan.pins as unknown as Record<string, unknown>[]);
  base.nets = mergeById(nets, plan.nets as unknown as Record<string, unknown>[]);

  return base;
}

function normalizeSourceObject(rawSource: unknown): Record<string, unknown> {
  const source = tryParseJsonString(rawSource);
  if (typeof source === "object" && source !== null) {
    return { ...(source as Record<string, unknown>) };
  }
  return {};
}

function normalizeArray(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(
    (item): item is Record<string, unknown> => typeof item === "object" && item !== null
  );
}

function mergeById(
  existing: Record<string, unknown>[],
  incoming: Record<string, unknown>[]
): Record<string, unknown>[] {
  const map = new Map<string, Record<string, unknown>>();
  for (const item of existing) {
    const id = readId(item);
    if (id) {
      map.set(id, item);
    }
  }
  for (const item of incoming) {
    const id = readId(item);
    if (!id) {
      continue;
    }
    map.set(id, item);
  }
  return [...map.values()];
}

function readId(value: Record<string, unknown>): string | undefined {
  const candidates = ["id", "uuid", "uid", "gId", "gid"];
  for (const key of candidates) {
    const raw = value[key];
    if (typeof raw === "string" && raw.length > 0) {
      return raw;
    }
  }
  return undefined;
}

function draftToShapes(plan: DraftPlan): Array<{ id: string; kind: string; payload: Record<string, unknown> }> {
  const output: Array<{ id: string; kind: string; payload: Record<string, unknown> }> = [];
  for (const component of plan.components) {
    output.push({
      id: component.id,
      kind: "component",
      payload: {
        type: "component",
        ...component,
      },
    });
  }
  for (const net of plan.nets) {
    output.push({
      id: net.id,
      kind: "net",
      payload: {
        type: "net",
        ...net,
      },
    });
  }
  return output;
}

async function tryInvokeCandidates(
  invoker: (name: string, ...args: unknown[]) => Promise<unknown>,
  candidates: Array<[string] | [string, unknown] | [string, unknown, unknown] | [string, unknown, unknown, unknown]>
): Promise<{ called: boolean; value?: unknown }> {
  for (const candidate of candidates) {
    const [name, arg1, arg2, arg3] = candidate;
    const args = [arg1, arg2, arg3].filter((item) => item !== undefined);
    try {
      return {
        called: true,
        value: await invoker(name, ...args),
      };
    } catch {
      // Try next candidate for runtime API compatibility.
    }
  }
  return {
    called: false,
  };
}

function tryParseJsonString(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function createTransactionId(): string {
  return `apt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
