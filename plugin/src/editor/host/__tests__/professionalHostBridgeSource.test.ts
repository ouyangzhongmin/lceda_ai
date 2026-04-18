import { test } from "node:test";
import * as assert from "node:assert/strict";

import { resolveProfessionalRawHostApi } from "../professionalHostBridgeSource";

test("resolveProfessionalRawHostApi prefers local api apply adapter over namespace applyPlan when typed placement runtime is available", async () => {
  const runtime = globalThis as typeof globalThis & {
    api?: (name: string, ...args: unknown[]) => Promise<unknown>;
    lcPro?: {
      applyPlan?: {
        apply?: (plan: unknown) => Promise<unknown>;
      };
    };
    eda?: unknown;
  };

  const originalApi = runtime.api;
  const originalLcPro = runtime.lcPro;
  const originalEda = runtime.eda;

  const apiCalls: string[] = [];
  let namespaceApplyCalled = false;

  runtime.api = async (name: string, ..._args: unknown[]) => {
    apiCalls.push(name);
    if (name === "getSource" || name === "getSchSource" || name === "getCurrentSchematic") {
      throw new Error("source unavailable");
    }
    if (name === "getShape") {
      return undefined;
    }
    if (name === "createShape") {
      return { success: true, id: "shape-1" };
    }
    return undefined;
  };

  runtime.lcPro = {
    applyPlan: {
      apply: async () => {
        namespaceApplyCalled = true;
        return {
          applied: true,
          componentCount: 99,
          netCount: 88,
        };
      },
    },
  };

  runtime.eda = {
    sch_PrimitiveComponent: {
      create: async () => null,
    },
    sch_PrimitiveWire: {
      create: async () => null,
    },
  };

  try {
    const rawApi = resolveProfessionalRawHostApi();
    assert.ok(rawApi?.applyPlan?.apply);

    const result = await rawApi!.applyPlan!.apply!({
      title: "test",
      rationale: "test",
      components: [],
      pins: [],
      nets: [],
    } as any);

    assert.equal(namespaceApplyCalled, false);
    assert.notDeepEqual(result, {
      applied: true,
      componentCount: 99,
      netCount: 88,
    });
    assert.equal(apiCalls.includes("getSource") || apiCalls.includes("getSchSource") || apiCalls.includes("getCurrentSchematic"), true);
  } finally {
    runtime.api = originalApi;
    runtime.lcPro = originalLcPro;
    runtime.eda = originalEda;
  }
});
