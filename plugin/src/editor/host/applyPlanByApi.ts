import { previewDraftPlan } from "../apply-plan/previewDraftPlan";
import type { DraftPlan, DraftPreview } from "../apply-plan/draftPlan";
import type { ApplyPlanResult } from "../adapters/editorAdapter";

export interface ApiApplyPlanAdapter {
  preview: (plan: DraftPlan) => Promise<DraftPreview>;
  apply: (plan: DraftPlan) => Promise<ApplyPlanResult>;
  rollback: (transactionId: string) => Promise<{ rolledBack: boolean; transactionId: string }>;
}

type ApplyTransaction =
  | { kind: "source"; sourceSnapshot: unknown }
  | { kind: "shape"; shapeIds: string[] }
  | { kind: "typed_schematic"; componentIds: string[]; wireIds: string[] };

const applyTransactions = new Map<string, ApplyTransaction>();

export function createApiApplyPlanAdapter(
  invoker?: (name: string, ...args: unknown[]) => Promise<unknown>,
  options?: { typedPlacementEnabled?: boolean }
): ApiApplyPlanAdapter {
  return {
    preview: async (plan: DraftPlan): Promise<DraftPreview> => previewDraftPlan(plan),
    apply: async (plan: DraftPlan): Promise<ApplyPlanResult> => {
      const transactionId = createTransactionId();
      if (options?.typedPlacementEnabled && canApplyByTypedPlacement(plan)) {
        const placed = await applyTypedSchematicPlan(plan);
        applyTransactions.set(transactionId, {
          kind: "typed_schematic",
          componentIds: placed.componentIds,
          wireIds: placed.wireIds,
        });
        return summarizeApply(plan, transactionId, true);
      }
      if (!invoker) {
        return summarizeApply(plan, transactionId, false);
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
        return summarizeApply(plan, transactionId, true);
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
        if (!created.called) {
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
      return summarizeApply(plan, transactionId, createdShapeIds.length > 0);
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
  return plan.components.some((component) => {
    const deviceUuid = component.properties.device_uuid;
    const libraryUuid = component.properties.library_uuid;
    return typeof deviceUuid === "string" && deviceUuid && typeof libraryUuid === "string" && libraryUuid;
  });
}

async function applyTypedSchematicPlan(plan: DraftPlan): Promise<{ componentIds: string[]; wireIds: string[] }> {
  const componentIds: string[] = [];
  const wireIds: string[] = [];
  const placedPins = new Map<string, { x: number; y: number; primitiveId: string }>();
  const gridX = 140;
  const gridY = 100;

      for (const [index, component] of plan.components.entries()) {
    const deviceUuid = component.properties.device_uuid;
    const libraryUuid = component.properties.library_uuid;
    if (!deviceUuid || !libraryUuid) {
      continue;
    }
    const x = parsePlacementNumber(component.properties.placement_x) ?? 200 + (index % 3) * gridX;
    const y = parsePlacementNumber(component.properties.placement_y) ?? 200 + Math.floor(index / 3) * gridY;
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
    const nodePoints = net.nodeIds
      .map((nodeId) => placedPins.get(nodeId))
      .filter((item): item is { x: number; y: number; primitiveId: string } => Boolean(item));
    if (nodePoints.length < 2) {
      continue;
    }
    const line = buildOrthogonalPolyline(nodePoints);
    const createdWire = await eda.sch_PrimitiveWire.create(line, net.name);
    if (!createdWire) {
      continue;
    }
    wireIds.push(createdWire.getState_PrimitiveId());
  }

  return { componentIds, wireIds };
}

function parsePlacementNumber(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function findBestMatchingPlanPin(
  pins: DraftPlan["pins"],
  componentId: string,
  pinName?: string,
  pinNumber?: string
): DraftPlan["pins"][number] | undefined {
  const candidates = pins.filter((item) => item.componentId === componentId);
  if (candidates.length === 0) {
    return undefined;
  }

  const runtimeAliases = normalizePinSemantic(pinName, pinNumber);
  let bestScore = -1;
  let bestMatch: DraftPlan["pins"][number] | undefined;

  for (const candidate of candidates) {
    let score = 0;
    if (candidate.pinNumber && pinNumber && candidate.pinNumber === pinNumber) {
      score += 100;
    }
    if (candidate.pinName && pinName && candidate.pinName === pinName) {
      score += 90;
    }
    const candidateAliases = normalizePinSemantic(candidate.pinName, candidate.pinNumber);
    if (candidateAliases.some((alias) => runtimeAliases.includes(alias))) {
      score += 60;
    }
    if (candidate.electricalType) {
      const electricalAlias = normalizeElectricalType(candidate.electricalType);
      if (electricalAlias && runtimeAliases.includes(electricalAlias)) {
        score += 25;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      bestMatch = candidate;
    }
  }

  return bestScore > 0 ? bestMatch : undefined;
}

function normalizePinSemantic(name?: string, pinNumber?: string): string[] {
  const aliases = new Set<string>();
  const addAlias = (value: string): void => {
    const normalized = normalizeToken(value);
    if (!normalized) {
      return;
    }
    aliases.add(normalized);
    const semantic = PIN_SEMANTIC_ALIASES[normalized];
    if (semantic) {
      aliases.add(semantic);
    }
  };

  if (name) {
    addAlias(name);
    for (const token of splitTokens(name)) {
      addAlias(token);
    }
  }
  if (pinNumber) {
    addAlias(pinNumber);
  }

  return [...aliases];
}

function normalizeElectricalType(type: string): string | undefined {
  switch (type.toLowerCase()) {
    case "power_in":
      return "power_in";
    case "power_out":
      return "power_out";
    case "passive":
      return "passive";
    default:
      return undefined;
  }
}

function normalizeToken(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9+_-]+/g, "");
}

function splitTokens(value: string): string[] {
  return value
    .split(/[\s/()[\]-]+/g)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

const PIN_SEMANTIC_ALIASES: Record<string, string> = {
  vin: "power_in",
  in: "power_in",
  vi: "power_in",
  vcc: "power_in",
  vdd: "power_in",
  dcin: "power_in",
  pwrin: "power_in",
  vout: "power_out",
  out: "power_out",
  vo: "power_out",
  vreg: "power_out",
  "3v3": "power_out",
  "5v": "power_out",
  gnd: "ground",
  pgnd: "ground",
  agnd: "ground",
  ground: "ground",
  vss: "ground",
  neg: "negative",
  minus: "negative",
  n: "negative",
  "-": "negative",
  pos: "positive",
  plus: "positive",
  p: "positive",
  "+": "positive",
};

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

function summarizeApply(
  plan: DraftPlan,
  transactionId: string,
  rollbackSupported: boolean
): ApplyPlanResult {
  return {
    applied: true,
    componentCount: plan.components.length,
    netCount: plan.nets.length,
    transactionId,
    rollbackSupported,
  };
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
