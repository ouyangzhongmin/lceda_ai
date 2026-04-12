import type { PluginChannel } from "../types/schematic";
import { installHostBridge } from "../editor/host/installHostBridge";
import { previewDraftPlan } from "../editor/apply-plan/previewDraftPlan";

export function installFakeHostBridge(channel: PluginChannel): void {
  let context = buildFakeContext(channel);
  let txSeq = 0;

  const locate = async (target: { objectId: string }): Promise<void> => {
    const knownObjectIds = new Set([
      ...context.components.map((item) => item.id),
      ...context.pins.map((item) => item.id),
      ...context.nets.map((item) => item.id),
    ]);

    if (!knownObjectIds.has(target.objectId)) {
      throw new Error(`fake host could not locate ${target.objectId}`);
    }
  };

  if (channel === "professional") {
    installHostBridge({
      channel,
      rawApi: {
        editor: {
          getActiveSchematicContext: async () => context,
          getCurrentSelection: async () => context.selection,
          locateEntity: locate,
          createEmptySchematicPage: async (input) => {
            context = buildEmptyFakeContext(channel, input?.title || "Draft Plan");
            return context;
          },
        },
        system: {
          openBrowser: async (url) => {
            if (typeof console !== "undefined") {
              console.log("fake host open browser", url);
            }
          },
        },
        library: {
          searchDevices: async (input) => {
            const q = input.query.trim() || "device";
            return [
              {
                uuid: "dev-ldo-demo",
                name: /cap|电容/i.test(q) ? "Capacitor 10uF 0603" : "ME6211C33M5G-N",
                libraryUuid: "lib-system-demo",
                symbolUuid: /cap|电容/i.test(q) ? "sym-cap-0603" : "sym-ldo-sot23",
                symbolName: /cap|电容/i.test(q) ? "Capacitor" : "LDO Regulator",
                footprintUuid: /cap|电容/i.test(q) ? "pkg-0603" : "pkg-sot23-5",
                footprintName: /cap|电容/i.test(q) ? "0603" : "SOT-23-5",
                manufacturer: /cap|电容/i.test(q) ? "Yageo" : "MICRONE",
                description: `fake library result for ${q}`,
              },
              {
                uuid: "dev-cap-demo",
                name: "Capacitor 10uF 0603",
                libraryUuid: "lib-system-demo",
                symbolUuid: "sym-cap-0603",
                symbolName: "Capacitor",
                footprintUuid: "pkg-0603",
                footprintName: "0603",
                manufacturer: "Yageo",
                description: `fake library result for ${q}`,
              },
            ];
          },
          getDevice: async (input) => ({
            uuid: input.deviceUuid,
            name: input.deviceUuid === "dev-cap-demo" ? "Capacitor 10uF 0603" : "ME6211C33M5G-N",
            libraryUuid: input.libraryUuid ?? "lib-system-demo",
            manufacturer: input.deviceUuid === "dev-cap-demo" ? "Yageo" : "MICRONE",
            symbol: {
              uuid: input.deviceUuid === "dev-cap-demo" ? "sym-cap-0603" : "sym-ldo-sot23",
              name: input.deviceUuid === "dev-cap-demo" ? "Capacitor" : "LDO Regulator",
              libraryUuid: input.libraryUuid ?? "lib-system-demo",
            },
            footprint: {
              uuid: input.deviceUuid === "dev-cap-demo" ? "pkg-0603" : "pkg-sot23-5",
              name: input.deviceUuid === "dev-cap-demo" ? "0603" : "SOT-23-5",
              libraryUuid: input.libraryUuid ?? "lib-system-demo",
            },
          }),
          getDevicesByLcscIds: async (input) =>
            input.lcscIds.map((id) => ({
              uuid: `dev-${id}`,
              name: `Fake Device ${id}`,
              libraryUuid: input.libraryUuid ?? "lib-system-demo",
              supplierId: id,
            })),
        },
        applyPlan: {
          preview: async (plan) => previewDraftPlan(plan),
          apply: async (plan) => ({
            applied: true,
            componentCount: plan.components.length,
            netCount: plan.nets.length,
            transactionId: `fake_tx_${++txSeq}`,
            rollbackSupported: true,
          }),
          rollback: async (transactionId) => ({ rolledBack: true, transactionId }),
        },
      },
    });
    return;
  }

  installHostBridge({
    channel,
    rawApi: {
      schematic: {
        getCurrentDocument: async () => context,
        getSelection: async () => context.selection,
        locateObject: locate,
        createEmptyPage: async (input) => {
          context = buildEmptyFakeContext(channel, input?.title || "Draft Plan");
          return context;
        },
      },
      shell: {
        openExternal: async (url) => {
          if (typeof console !== "undefined") {
            console.log("fake host open external", url);
          }
        },
      },
      applyPlan: {
        preview: async (plan) => previewDraftPlan(plan),
        apply: async (plan) => ({
          applied: true,
          componentCount: plan.components.length,
          netCount: plan.nets.length,
          transactionId: `fake_tx_${++txSeq}`,
          rollbackSupported: true,
        }),
        rollback: async (transactionId) => ({ rolledBack: true, transactionId }),
      },
    },
  });
}

function buildFakeContext(channel: PluginChannel) {
  return {
    project: {
      projectId: `${channel}-fake-project`,
      pageId: `${channel}-fake-page`,
      pageName: channel === "professional" ? "Fake Pro Schematic" : "Fake Standard Schematic",
      channel,
    },
    components: [
      {
        id: "cmp-u1",
        ref: "U1",
        name: "Fake MCU",
        libraryId: "fake-lib-mcu",
        packageName: "QFN-48",
        value: "FAKE-MCU",
        properties: {},
      },
    ],
    pins: [
      {
        id: "pin-u1-1",
        componentId: "cmp-u1",
        pinNumber: "1",
        pinName: "VCC",
        electricalType: "power_in",
      },
    ],
    nets: [
      {
        id: "net-vcc",
        name: "VCC_3V3",
        nodeIds: ["pin-u1-1"],
        isPower: true,
      },
    ],
    selection: {
      objectIds: [],
    },
  };
}

function buildEmptyFakeContext(channel: PluginChannel, pageName: string) {
  return {
    project: {
      projectId: `${channel}-fake-project`,
      pageId: `${channel}-fake-page-draft`,
      pageName,
      channel,
    },
    components: [],
    pins: [],
    nets: [],
    selection: {
      objectIds: [],
    },
  };
}
