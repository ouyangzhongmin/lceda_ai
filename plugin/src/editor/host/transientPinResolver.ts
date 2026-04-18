export type TransientPinRecord = {
  primitiveId: string;
  pinName?: string;
  pinNumber?: string;
  x: number;
  y: number;
};

export async function resolveTransientComponentPins(
  input: {
    components: Array<{ componentId: string; ref?: string; deviceUuid: string; libraryUuid: string }>;
  },
  deps: {
    createComponent: (input: {
      componentId: string;
      ref?: string;
      deviceUuid: string;
      libraryUuid: string;
      index: number;
    }) => Promise<{ primitiveId: string } | null>;
    getPinsByPrimitiveId: (primitiveId: string) => Promise<TransientPinRecord[]>;
    deleteComponents: (primitiveIds: string[]) => Promise<boolean>;
  }
): Promise<{ componentPins: Map<string, TransientPinRecord[]> }> {
  const placed: string[] = [];
  const componentPins = new Map<string, TransientPinRecord[]>();

  try {
    for (const [index, component] of input.components.entries()) {
      const created = await deps.createComponent({ ...component, index });
      if (!created?.primitiveId) {
        throw new Error(`transient placement failed: ${component.ref || component.componentId}`);
      }
      placed.push(created.primitiveId);
      const pins = await deps.getPinsByPrimitiveId(created.primitiveId);
      componentPins.set(component.componentId, pins);
    }
    return { componentPins };
  } finally {
    if (placed.length > 0) {
      await deps.deleteComponents(placed);
    }
  }
}
