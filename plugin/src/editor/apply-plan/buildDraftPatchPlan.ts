import type { DraftPlan } from "./draftPlan";
import type {
  AppliedDraftSnapshot,
  DraftObjectBindings,
  DraftPatchConflict,
  DraftPatchOperation,
  DraftPatchPlan,
} from "./draftPatchPlan";

type ComponentBinding = DraftObjectBindings["componentBindings"][number];

function getOptionalRef(component: { ref?: string }): string | undefined {
  return component.ref ? String(component.ref) : undefined;
}

function getProperty(
  properties: Record<string, string>,
  key: string
): string | undefined {
  const value = properties[key];
  return value ? String(value) : undefined;
}

function isSameClass(
  previousProperties: Record<string, string>,
  nextProperties: Record<string, string>
): boolean {
  const previousRole = getProperty(previousProperties, "completion_role");
  const nextRole = getProperty(nextProperties, "completion_role");
  if (previousRole && nextRole) {
    return previousRole === nextRole;
  }
  return true;
}

function findBinding(
  bindings: DraftObjectBindings | undefined,
  previousComponent: { id: string; ref?: string },
  nextComponent: { ref?: string }
): ComponentBinding | undefined {
  const componentBindings = bindings?.componentBindings || [];
  const previousRef = getOptionalRef(previousComponent);
  const nextRef = getOptionalRef(nextComponent);

  return componentBindings.find((binding) => {
    if (binding.draftComponentId === previousComponent.id) {
      return true;
    }
    if (previousRef && binding.ref === previousRef) {
      return true;
    }
    if (nextRef && binding.ref === nextRef) {
      return true;
    }
    return false;
  });
}

function collectRefs(
  components: Array<{ id: string; ref?: string }>
): Map<string, Array<{ id: string; ref?: string }>> {
  const refs = new Map<string, Array<{ id: string; ref?: string }>>();
  for (const component of components) {
    const ref = getOptionalRef(component);
    if (!ref) {
      continue;
    }
    const matches = refs.get(ref);
    if (matches) {
      matches.push(component);
    } else {
      refs.set(ref, [component]);
    }
  }
  return refs;
}

function resolvePreviousComponent(
  nextComponent: DraftPlan["components"][number],
  previousById: Map<string, AppliedDraftSnapshot["components"][number]>,
  unmatchedPreviousByRef: Map<string, Array<AppliedDraftSnapshot["components"][number]>>
): AppliedDraftSnapshot["components"][number] | undefined {
  const directMatch = previousById.get(nextComponent.id);
  if (directMatch) {
    return directMatch;
  }

  const nextRef = getOptionalRef(nextComponent);
  if (!nextRef) {
    return undefined;
  }

  const candidates = unmatchedPreviousByRef.get(nextRef);
  if (!candidates || candidates.length !== 1) {
    return undefined;
  }

  return candidates[0];
}

export function buildDraftPatchPlan(input: {
  previous: AppliedDraftSnapshot;
  next: DraftPlan;
  bindings?: DraftObjectBindings;
}): DraftPatchPlan {
  const previousById = new Map(
    input.previous.components.map((component) => [component.id, component] as const)
  );
  const unmatchedPreviousByRef = collectRefs(input.previous.components);
  const matchedPreviousIds = new Set<string>();

  const operations: DraftPatchOperation[] = [];
  const conflicts: DraftPatchConflict[] = [];
  let addComponentCount = 0;
  let removeComponentCount = 0;
  let replaceDeviceCount = 0;

  for (const nextComponent of input.next.components) {
    const previousComponent = resolvePreviousComponent(
      nextComponent,
      previousById,
      unmatchedPreviousByRef
    );
    if (!previousComponent) {
      operations.push({
        kind: "add_component",
        componentId: nextComponent.id,
      });
      addComponentCount += 1;
      continue;
    }
    matchedPreviousIds.add(previousComponent.id);

    const previousRef = getOptionalRef(previousComponent);
    if (previousRef) {
      const candidates = unmatchedPreviousByRef.get(previousRef);
      if (candidates) {
        unmatchedPreviousByRef.set(
          previousRef,
          candidates.filter((candidate) => candidate.id !== previousComponent.id)
        );
      }
    }

    const previousDeviceUuid = getProperty(
      previousComponent.properties,
      "device_uuid"
    );
    const nextDeviceUuid = getProperty(nextComponent.properties, "device_uuid");
    if (
      !previousDeviceUuid ||
      !nextDeviceUuid ||
      previousDeviceUuid === nextDeviceUuid
    ) {
      continue;
    }

    const binding = findBinding(input.bindings, previousComponent, nextComponent);

    if (isSameClass(previousComponent.properties, nextComponent.properties)) {
      operations.push({
        kind: "replace_component_device",
        componentId: nextComponent.id,
        primitiveId: binding?.primitiveId,
        mode: "same_class",
        keepRef: true,
        keepPlacement: true,
        nextDeviceUuid,
        nextLibraryUuid: getProperty(nextComponent.properties, "library_uuid"),
      });
      replaceDeviceCount += 1;
      continue;
    }

    const conflictId = `conflict-${nextComponent.id}`;
    operations.push({
      kind: "replace_component_device",
      componentId: nextComponent.id,
      primitiveId: binding?.primitiveId,
      mode: "cross_class",
      keepRef: true,
      keepPlacement: true,
      nextDeviceUuid,
      nextLibraryUuid: getProperty(nextComponent.properties, "library_uuid"),
    });
    operations.push({
      kind: "mark_conflict",
      conflictId,
    });
    conflicts.push({
      id: conflictId,
      type: "device_class_changed",
      level: "warning",
      componentRef: nextComponent.ref,
      message: `器件 ${String(nextComponent.ref || nextComponent.id)} 发生跨类替换，需保留可映射连接并标记剩余待处理项。`,
      suggestedAction: "应用变更后检查待处理连接",
    });
    replaceDeviceCount += 1;
  }

  for (const previousComponent of input.previous.components) {
    if (matchedPreviousIds.has(previousComponent.id)) {
      continue;
    }

    const binding = findBinding(input.bindings, previousComponent, previousComponent);
    operations.push({
      kind: "remove_component",
      componentId: previousComponent.id,
      primitiveId: binding?.primitiveId,
    });
    removeComponentCount += 1;
  }

  return {
    baseDraftVersionId: input.previous.draftVersionId,
    nextDraftVersionId: `${input.previous.draftVersionId}:next`,
    summary: {
      addComponentCount,
      removeComponentCount,
      replaceDeviceCount,
      updatePropCount: 0,
      addWireCount: 0,
      removeWireCount: 0,
      conflictCount: conflicts.length,
    },
    operations,
    conflicts,
  };
}
