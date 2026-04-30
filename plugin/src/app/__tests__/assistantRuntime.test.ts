import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import * as assert from "node:assert/strict";

import {
  applyStreamingAssistantContentDelta,
  applyDraftDeviceCandidateSelection,
  applyCustomLlmConfigSavedState,
  applyDraftPlanWithRepair,
  appendAssistantMessages,
  appendUserChatMessage,
  buildDraftApplyUnavailableMessage,
  buildDevicePickerApplyProgressText,
  buildDevicePickerCandidatePresentation,
  buildDevicePickerSearchProgressText,
  buildDevicePickerReasonLabel,
  buildDevicePickerRoleLabel,
  clampStreamingAssistantContent,
  deriveSessionHistoryEntries,
  finalizeDraftTurnMessages,
  formatDraftApplyErrorMessage,
  formatDraftApplySuccessSummary,
  enrichDraftPlanFromBridge,
  hasUnresolvedDraftDevices,
  inferDraftComponentRole,
  mergeAssistantFinalMessage,
  mergeStreamProcessFields,
  normalizeDevicePickerCandidates,
  isPerfDebugEnabled,
  buildStreamingProcessSignature,
  limitStreamProcessItems,
  shouldApplyStreamingReactEvents,
  shouldMirrorStreamingTextToAssistantBody,
  shouldSanitizeFullStreamingText,
  shouldSendComposerPrompt,
  shouldStopRunningTurnFromComposer,
  shouldAutoApplyDraftFromChatInput,
  shouldCountStreamEventAsTurnActivity,
  stripFinalControlLikeText,
  shouldIgnoreDuplicateSendWhileRunning,
  shouldUseDraftReplyLeadNarrative,
  resolveDraftDeviceSearchQuery,
  buildDraftDeviceSearchQueries,
  resolveDevicePickerManualQueryStateForSearch,
  updateDevicePickerManualQueryState,
  upsertLlmReasoningStepItem,
  getAssistantRuntime,
} from "../assistantRuntime";
import { getAssistantCardLayout } from "../assistantCardLayout";
import type { MainPanelState } from "../../ui/panels/mainPanel";
import { previewDraftPlan } from "../../editor/apply-plan/previewDraftPlan";
import type { DraftPlan } from "../../editor/apply-plan/draftPlan";
import type { HostEditorBridge } from "../../editor/host/runtime";

const assistantRuntimeSource = readFileSync(resolve(process.cwd(), "src/app/assistantRuntime.ts"), "utf8");

test("assistant runtime does not batch analysis llm stream events behind a second buffer", () => {
  assert.equal(assistantRuntimeSource.includes("analysisStreamBuffer"), false);
});

test("shouldIgnoreDuplicateSendWhileRunning returns true for the same pending prompt in an active turn", () => {
  assert.equal(
    shouldIgnoreDuplicateSendWhileRunning({
      trimmedInput: "帮我设计一个点亮LED的电路",
      pendingChatInput: "帮我设计一个点亮LED的电路",
      activeTurnId: 1,
      agentRunState: "waiting_llm",
    }),
    true
  );
});

test("shouldIgnoreDuplicateSendWhileRunning returns false for a different prompt", () => {
  assert.equal(
    shouldIgnoreDuplicateSendWhileRunning({
      trimmedInput: "帮我设计一个点亮LED的电路",
      pendingChatInput: "检查这个原理图",
      activeTurnId: 1,
      agentRunState: "waiting_llm",
    }),
    false
  );
});

test("shouldIgnoreDuplicateSendWhileRunning returns false when no turn is active", () => {
  assert.equal(
    shouldIgnoreDuplicateSendWhileRunning({
      trimmedInput: "帮我设计一个点亮LED的电路",
      pendingChatInput: "帮我设计一个点亮LED的电路",
      activeTurnId: undefined,
      agentRunState: "idle",
    }),
    false
  );
});

test("shouldIgnoreDuplicateSendWhileRunning returns true during planning when the latest user message already matches", () => {
  assert.equal(
    shouldIgnoreDuplicateSendWhileRunning({
      trimmedInput: "帮我设计一个点亮LED的电路",
      pendingChatInput: undefined,
      activeTurnId: undefined,
      agentRunState: "planning",
      lastUserMessageContent: "帮我设计一个点亮LED的电路",
    }),
    true
  );
});

test("shouldStopRunningTurnFromComposer returns true while a turn is running", () => {
  assert.equal(
    shouldStopRunningTurnFromComposer({
      agentRunState: "waiting_llm",
      activeTurnId: 1,
    }),
    true
  );
});

test("shouldStopRunningTurnFromComposer returns false when no turn is active", () => {
  assert.equal(
    shouldStopRunningTurnFromComposer({
      agentRunState: "idle",
      activeTurnId: undefined,
    }),
    false
  );
});

test("shouldCountStreamEventAsTurnActivity ignores sanitized no-op stream events", () => {
  assert.equal(
    shouldCountStreamEventAsTurnActivity({
      contentChanged: false,
      processChanged: false,
      detailChanged: false,
    }),
    false
  );
  assert.equal(
    shouldCountStreamEventAsTurnActivity({
      contentChanged: false,
      processChanged: true,
      detailChanged: false,
    }),
    true
  );
});

test("shouldSendComposerPrompt returns true while busy so composer click can act as stop", () => {
  assert.equal(
    shouldSendComposerPrompt({
      isBusy: true,
      text: "",
    }),
    true
  );
});

test("shouldSendComposerPrompt returns false when idle and input is blank", () => {
  assert.equal(
    shouldSendComposerPrompt({
      isBusy: false,
      text: "   ",
    }),
    false
  );
});

test("finalizeDraftTurnMessages replaces the pending assistant without duplicating previous user messages", () => {
  const previousMessages = [
    { role: "user" as const, title: "你", content: "帮我设计一个点亮LED的电路" },
    { role: "assistant" as const, title: "草案生成中", content: "", streaming: true },
  ];

  const draftMessages = [
    { role: "assistant" as const, title: "需关注", content: "草案生成完成，但未返回预览信息。", tone: "warning" as const },
  ];

  const finalMessages = finalizeDraftTurnMessages(previousMessages, draftMessages);
  assert.equal(finalMessages.length, 2);
  assert.equal(finalMessages[0]?.role, "user");
  assert.equal(finalMessages[0]?.content, "帮我设计一个点亮LED的电路");
  assert.equal(finalMessages[1]?.role, "assistant");
  assert.equal(finalMessages[1]?.title, "需关注");
  assert.equal(finalMessages[1]?.content, "草案生成完成，但未返回预览信息。");
  assert.equal(finalMessages[1]?.tone, "warning");
});

test("shouldAutoApplyDraftFromChatInput returns true for confirm-like input in awaiting_confirmation state", () => {
  assert.equal(
    shouldAutoApplyDraftFromChatInput({
      agentRunState: "awaiting_confirmation",
      input: "确认",
      hasDraftPlan: true,
      draftBlocked: false,
    }),
    true
  );
});

test("shouldAutoApplyDraftFromChatInput returns false when no draft is pending confirmation", () => {
  assert.equal(
    shouldAutoApplyDraftFromChatInput({
      agentRunState: "completed",
      input: "确认",
      hasDraftPlan: true,
      draftBlocked: false,
    }),
    false
  );
});

test("formatDraftApplyErrorMessage converts empty-page guard errors into actionable guidance", () => {
  assert.equal(
    formatDraftApplyErrorMessage(new Error('draft apply requires an empty schematic page: current page "Sheet 1" already has content')),
    "应用草案失败：当前原理图页“Sheet 1”已有内容。请先新建空白原理图页，再重新应用草案。"
  );
});

test("formatDraftApplyErrorMessage keeps generic errors readable", () => {
  assert.equal(
    formatDraftApplyErrorMessage(new Error("unmapped required nets: 5V (draft-j1-vbus)")),
    "应用草案失败：unmapped required nets: 5V (draft-j1-vbus)"
  );
});

test("formatDraftApplyErrorMessage converts unresolved placement device errors into actionable guidance", () => {
  assert.equal(
    formatDraftApplyErrorMessage(
      new Error("typed placement requires all draft components to have resolved devices: B1, U3")
    ),
    "应用草案失败：以下器件还没有完成可放置器件选型：B1、U3。请先完成器件确认，再重新应用草案。"
  );
});

test("formatDraftApplyErrorMessage converts unresolved draft pin mappings into actionable guidance", () => {
  assert.equal(
    formatDraftApplyErrorMessage(
      new Error("unresolved draft pin mappings: D1.A, D1.C")
    ),
    "应用草案失败：D1 等器件的连接还没有自动校正完成。请先确认相关器件型号，再重新应用草案。"
  );
});

test("formatDraftApplySuccessSummary keeps full-success apply messaging concise", () => {
  const message = formatDraftApplySuccessSummary({
    componentCount: 3,
    netCount: 2,
  });

  assert.equal(message.title, "已应用草案");
  assert.equal(message.summary, "草案已应用：器件 3，网络 2。");
  assert.match(message.content, /草案已成功应用到画布/);
});

test("formatDraftApplySuccessSummary reports manual follow-up when some connections are skipped", () => {
  const message = formatDraftApplySuccessSummary({
    componentCount: 5,
    netCount: 4,
    partialWiring: {
      connectedNetCount: 2,
      skippedConnectionCount: 2,
      skippedConnections: [
        {
          fromComponentRef: "U1",
          fromPin: "SDA",
          toComponentRef: "U2",
          toPin: "SDA",
          netName: "I2C_SDA",
          reason: "endpoint_unresolved",
        },
        {
          fromComponentRef: "D1",
          fromPin: "K",
          netName: "GND",
          reason: "endpoint_unresolved",
        },
      ],
    },
  });

  assert.equal(message.title, "已应用，部分连接需手动处理");
  assert.match(message.summary, /有 2 处连接需手动处理/);
  assert.match(message.content, /已自动连线：2/);
  assert.match(message.content, /需手动连线：2/);
  assert.match(message.content, /U1\.SDA -> U2\.SDA \(I2C_SDA\)/);
  assert.match(message.content, /D1\.K \(GND\)/);
});

test("preview rationale exposes peripheral completion summary for near-production drafts", () => {
  const preview = previewDraftPlan({
    title: "voice system",
    rationale: "test",
    components: [
      { id: "u1", ref: "U1", name: "ESP32-S3", properties: {} },
      { id: "j1", ref: "J1", name: "USB-C", properties: {} },
    ],
    pins: [],
    nets: [],
  } as DraftPlan);

  assert.equal((preview.completedPeripheralCount ?? 0) > 0, true);
  assert.match(preview.rationale, /已自动补全外围器件/);
});

test("enrichDraftPlanFromBridge resolves draft pins from host library detail", async () => {
  const plan = {
    title: "led",
    rationale: "test",
    components: [
      {
        id: "draft-d1",
        ref: "D1",
        properties: {
          device_uuid: "led-device",
          library_uuid: "led-lib",
        },
      },
    ],
    pins: [
      {
        id: "draft-d1-a",
        componentId: "draft-d1",
        pinName: "A",
        pinNumber: "1",
      },
      {
        id: "draft-d1-c",
        componentId: "draft-d1",
        pinName: "C",
        pinNumber: "2",
      },
    ],
    nets: [],
  } as DraftPlan;

  const enriched = await enrichDraftPlanFromBridge(plan, {
    getLibraryDevice: async () => ({
      uuid: "led-device",
      pins: [
        { pinName: "A", pinNumber: "1", electricalType: "passive" },
        { pinName: "K", pinNumber: "2", electricalType: "passive" },
      ],
    }),
  });

  assert.equal(enriched?.pins.find((pin) => pin.id === "draft-d1-a")?.resolvedPinName, "A");
  assert.equal(enriched?.pins.find((pin) => pin.id === "draft-d1-c")?.resolvedPinName, "K");
  assert.equal(enriched?.pins.find((pin) => pin.id === "draft-d1-c")?.pinResolutionStatus, "resolved");
});

test("manual device selection followed by library enrichment clears unresolved pin preview details", async () => {
  const plan = {
    title: "led",
    rationale: "test",
    components: [
      {
        id: "draft-d1",
        ref: "D1",
        properties: {
          preferred_search_query: "KT-0805R",
          device_resolution_status: "unresolved",
          device_resolution_reason: "unresolved",
        },
      },
    ],
    pins: [
      {
        id: "draft-d1-a",
        componentId: "draft-d1",
        pinName: "A",
        pinNumber: "1",
        pinResolutionStatus: "unresolved",
      },
      {
        id: "draft-d1-c",
        componentId: "draft-d1",
        pinName: "C",
        pinNumber: "2",
        pinResolutionStatus: "unresolved",
      },
    ],
    nets: [
      { id: "net-vcc", name: "3V3", nodeIds: ["draft-d1-a"], isPower: true },
      { id: "net-gnd", name: "GND", nodeIds: ["draft-d1-c"], isPower: true },
    ],
  } as DraftPlan;

  const previewBefore = previewDraftPlan(plan);
  assert.equal(previewBefore.unresolvedPinDetails?.length, 2);

  applyDraftDeviceCandidateSelection(plan, {
    componentId: "draft-d1",
    candidate: {
      uuid: "led-device",
      libraryUuid: "led-lib",
      name: "KT-0805R",
      footprintName: "LED0805-R-RD",
      manufacturer: "KENTO",
    },
  });

  const enriched = await enrichDraftPlanFromBridge(plan, {
    getLibraryDevice: async () => ({
      uuid: "led-device",
      pins: [
        { pinName: "A", pinNumber: "1", electricalType: "passive" },
        { pinName: "K", pinNumber: "2", electricalType: "passive" },
      ],
    }),
  });

  const previewAfter = previewDraftPlan(enriched as DraftPlan);
  assert.equal(previewAfter.unresolvedPinDetails?.length ?? 0, 0);
  assert.equal(previewAfter.unresolvedDeviceDetails?.length ?? 0, 0);
  assert.match(previewAfter.rationale, /已选器件:\s*led=KT-0805R/);
  assert.equal(enriched?.pins.find((pin) => pin.id === "draft-d1-c")?.resolvedPinName, "K");
});

test("enrichDraftPlanFromBridge falls back to host symbol source when device detail lacks explicit pins", async () => {
  const plan = {
    title: "ip5306",
    rationale: "test",
    components: [
      {
        id: "draft-u1",
        ref: "U1",
        properties: {
          device_uuid: "device-ip5306",
          library_uuid: "lib-lcsc",
        },
      },
    ],
    pins: [
      {
        id: "draft-u1-vin",
        componentId: "draft-u1",
        pinName: "VIN",
      },
      {
        id: "draft-u1-bat",
        componentId: "draft-u1",
        pinName: "BAT",
      },
    ],
    nets: [],
  } as DraftPlan;

  const enriched = await enrichDraftPlanFromBridge(plan, {
    getLibraryDevice: async () => ({
      uuid: "device-ip5306",
      symbol: {
        uuid: "symbol-ip5306",
        libraryUuid: "lib-lcsc",
      },
    }),
    getLibrarySymbol: async () => ({
      uuid: "symbol-ip5306",
      raw: {},
    }),
    getLibrarySymbolSource: async () => ({
      uuid: "symbol-ip5306",
      raw: {
        documentSource: JSON.stringify({
          shape: [
            { pin: "VIN", num: "1", type: "power" },
            { pin: "BAT", num: "5", type: "power" },
          ],
        }),
      },
    }),
  });

  assert.equal(enriched?.pins.find((pin) => pin.id === "draft-u1-vin")?.resolvedPinNumber, "1");
  assert.equal(enriched?.pins.find((pin) => pin.id === "draft-u1-bat")?.resolvedPinNumber, "5");
});

test("applyDraftPlanWithRepair retries structured repair up to the configured limit", async () => {
  const attempts: DraftPlan[] = [
    { title: "draft-0", rationale: "r", components: [], pins: [], nets: [] },
    { title: "draft-1", rationale: "r", components: [], pins: [], nets: [] },
    { title: "draft-2", rationale: "r", components: [], pins: [], nets: [] },
  ];
  let applyCount = 0;
  let repairCount = 0;

  const result = await applyDraftPlanWithRepair({
    initialPlan: attempts[0]!,
    maxRepairAttempts: 2,
    applyPlan: async (plan) => {
      const currentIndex = attempts.findIndex((item) => item.title === plan.title);
      applyCount += 1;
      if (currentIndex < 2) {
        throw new Error(currentIndex === 0
          ? "unmapped required nets: 3V3 (missing endpoints)"
          : "required connection unresolved: U1.VOUT -> J1.1 (3V3)");
      }
      return {
        applied: true,
        componentCount: 2,
        netCount: 1,
        transactionId: "tx-1",
      };
    },
    repairPlan: async ({ plan, applyError }) => {
      repairCount += 1;
      if (applyError.includes("unmapped required nets")) {
        return { repaired: true, plan: attempts[1]! };
      }
      if (applyError.includes("required connection unresolved")) {
        return { repaired: true, plan: attempts[2]! };
      }
      return { repaired: false, plan };
    },
  });

  assert.equal(applyCount, 3);
  assert.equal(repairCount, 2);
  assert.equal(result.repairCount, 2);
  assert.equal(result.repaired, true);
  assert.equal(result.finalPlan.title, "draft-2");
  assert.equal(result.result.transactionId, "tx-1");
});

test("applyDraftPlanWithRepair stops once repair budget is exhausted", async () => {
  let applyCount = 0;
  let repairCount = 0;

  await assert.rejects(
    () =>
      applyDraftPlanWithRepair({
        initialPlan: { title: "draft-0", rationale: "r", components: [], pins: [], nets: [] },
        maxRepairAttempts: 1,
        applyPlan: async () => {
          applyCount += 1;
          throw new Error("required connection unresolved: U1.VOUT -> J1.1 (3V3)");
        },
        repairPlan: async ({ plan }) => {
          repairCount += 1;
          return {
            repaired: true,
            plan: { ...plan, title: `${plan.title}-next` },
          };
        },
      }),
    /required connection unresolved: U1\.VOUT -> J1\.1 \(3V3\)/i
  );

  assert.equal(applyCount, 2);
  assert.equal(repairCount, 1);
});

test("closeDevicePicker syncs state without dispatching a global DOM event", async () => {
  const runtimeGlobals = globalThis as typeof globalThis & {
    LCEDA_HOST_BRIDGE?: HostEditorBridge;
    __LCEDA_AI_ASSISTANT_RUNTIME__?: ReturnType<typeof getAssistantRuntime>;
    __LCEDA_AI_ASSISTANT_FRAME_SYNC_STATE__?: (state: MainPanelState) => void;
    dispatchEvent?: (event: Event) => boolean;
    localStorage?: Storage;
  };
  const previousBridge = runtimeGlobals.LCEDA_HOST_BRIDGE;
  const previousRuntime = runtimeGlobals.__LCEDA_AI_ASSISTANT_RUNTIME__;
  const previousSync = runtimeGlobals.__LCEDA_AI_ASSISTANT_FRAME_SYNC_STATE__;
  const previousDispatchEvent = runtimeGlobals.dispatchEvent;
  const previousStorage = runtimeGlobals.localStorage;

  let syncCount = 0;
  let dispatchCount = 0;
  const storageMap = new Map<string, string>();
  runtimeGlobals.localStorage = {
    getItem: (key: string) => storageMap.get(key) ?? null,
    setItem: (key: string, value: string) => {
      storageMap.set(key, String(value));
    },
    removeItem: (key: string) => {
      storageMap.delete(key);
    },
    clear: () => {
      storageMap.clear();
    },
    key: (index: number) => Array.from(storageMap.keys())[index] ?? null,
    get length() {
      return storageMap.size;
    },
  } as Storage;
  runtimeGlobals.__LCEDA_AI_ASSISTANT_FRAME_SYNC_STATE__ = () => {
    syncCount += 1;
  };
  runtimeGlobals.dispatchEvent = (() => {
    dispatchCount += 1;
    return true;
  }) as typeof globalThis.dispatchEvent;
  runtimeGlobals.LCEDA_HOST_BRIDGE = {
    getChannel: () => "professional",
    getCapabilityReport: () => ({
      channel: "professional",
      available: true,
      missing: [],
      optionalMissing: [],
    }),
    getCurrentContext: async () => ({
      project: { projectId: "p1", projectName: "demo", pageId: "page-1", pageName: "P1" },
      components: [],
      pins: [],
      nets: [],
      selection: { objectIds: [] },
    }),
    getSelection: async () => ({ objectIds: [] }),
    locate: async () => {},
  };

  try {
    const runtime = getAssistantRuntime();
    await runtime.openPanel();
    await runtime.openDevicePicker();
    const closed = await runtime.closeDevicePicker();

    assert.equal(closed.devicePicker?.open, false);
    assert.equal(dispatchCount, 0);
    assert.equal(syncCount > 0, true);
  } finally {
    runtimeGlobals.LCEDA_HOST_BRIDGE = previousBridge;
    runtimeGlobals.__LCEDA_AI_ASSISTANT_RUNTIME__ = previousRuntime;
    runtimeGlobals.__LCEDA_AI_ASSISTANT_FRAME_SYNC_STATE__ = previousSync;
    runtimeGlobals.dispatchEvent = previousDispatchEvent;
    runtimeGlobals.localStorage = previousStorage;
  }
});

test("closeDevicePicker keeps picker closed when an in-flight device choice finishes later", async () => {
  const runtimeGlobals = globalThis as typeof globalThis & {
    LCEDA_HOST_BRIDGE?: HostEditorBridge;
    __LCEDA_AI_ASSISTANT_RUNTIME__?: ReturnType<typeof getAssistantRuntime>;
    localStorage?: Storage;
  };
  const previousBridge = runtimeGlobals.LCEDA_HOST_BRIDGE;
  const previousRuntime = runtimeGlobals.__LCEDA_AI_ASSISTANT_RUNTIME__;
  const previousStorage = runtimeGlobals.localStorage;

  const storageMap = new Map<string, string>();
  runtimeGlobals.localStorage = {
    getItem: (key: string) => storageMap.get(key) ?? null,
    setItem: (key: string, value: string) => {
      storageMap.set(key, String(value));
    },
    removeItem: (key: string) => {
      storageMap.delete(key);
    },
    clear: () => {
      storageMap.clear();
    },
    key: (index: number) => Array.from(storageMap.keys())[index] ?? null,
    get length() {
      return storageMap.size;
    },
  } as Storage;

  const draftPlan: DraftPlan = {
    title: "Device picker race",
    rationale: "test",
    components: [
      {
        id: "draft-c1",
        ref: "C1",
        name: "Capacitor",
        packageName: "C0603",
        value: "100nF",
        properties: {
          device_resolution_status: "unresolved",
          device_resolution_reason: "manual",
          preferred_search_query: "100nF capacitor C0603",
        },
      },
    ],
    pins: [
      { id: "draft-c1-1", componentId: "draft-c1", pinName: "1", pinNumber: "1", electricalType: "passive" },
      { id: "draft-c1-2", componentId: "draft-c1", pinName: "2", pinNumber: "2", electricalType: "passive" },
    ],
    nets: [],
  };

  storageMap.set(
    "lceda_ai.panel.last_state",
    JSON.stringify({
      loggedIn: false,
      agentRunState: "awaiting_confirmation",
      agentRunRoute: "draft",
      summary: "草案待确认",
      chatMessages: [],
      draftPlan,
      draftPreview: {
        title: draftPlan.title,
        rationale: draftPlan.rationale,
        componentRefs: ["C1"],
        netNames: [],
        componentCount: 1,
        netCount: 0,
      },
      devicePicker: {
        open: true,
        items: [
          {
            componentId: "draft-c1",
            componentRef: "C1",
            role: "input_capacitor",
            roleLabel: "输入电容",
            status: "unresolved",
            query: "100nF capacitor C0603",
            candidates: [
              {
                uuid: "cap-device",
                name: "CC0603KRX7R9BB104",
                libraryUuid: "cap-lib",
                footprintName: "C0603",
              },
            ],
          },
        ],
      },
    } satisfies Partial<MainPanelState>)
  );

  try {
    const runtime = getAssistantRuntime();
    runtimeGlobals.LCEDA_HOST_BRIDGE = {
      getChannel: () => "standard",
      isAvailable: async () => true,
      getCapabilityReport: () => ({
        channel: "standard",
        available: true,
        missing: [],
        optionalMissing: [],
      }),
      getCurrentContext: async () => ({
        project: { channel: "standard", projectId: "p1", projectName: "demo", pageId: "page-picker", pageName: "Sheet 1" },
        components: [],
        pins: [],
        nets: [],
        selection: { objectIds: [] },
      }),
      getSelection: async () => ({ objectIds: [] }),
      locate: async () => {},
      getLibraryDevice: async () => {
        await runtime.closeDevicePicker();
        return {
          uuid: "cap-device",
          raw: {
            device: {
              uuid: "cap-device",
            },
          },
        };
      },
    };

    await runtime.openPanel();
    const selected = await runtime.chooseDraftDeviceCandidate({ componentId: "draft-c1", candidateIndex: 0 });

    assert.equal(selected.devicePicker?.open, false);
    assert.equal(selected.draftPlan?.components[0]?.properties?.device_resolution_status, "resolved");
  } finally {
    runtimeGlobals.LCEDA_HOST_BRIDGE = previousBridge;
    runtimeGlobals.__LCEDA_AI_ASSISTANT_RUNTIME__ = previousRuntime;
    runtimeGlobals.localStorage = previousStorage;
  }
});

test("openDevicePicker falls back to restored state draft plan after history restore", async () => {
  const runtimeGlobals = globalThis as typeof globalThis & {
    LCEDA_HOST_BRIDGE?: HostEditorBridge;
    __LCEDA_AI_ASSISTANT_RUNTIME__?: ReturnType<typeof getAssistantRuntime>;
    localStorage?: Storage;
  };
  const previousBridge = runtimeGlobals.LCEDA_HOST_BRIDGE;
  const previousRuntime = runtimeGlobals.__LCEDA_AI_ASSISTANT_RUNTIME__;
  const previousStorage = runtimeGlobals.localStorage;

  const storageMap = new Map<string, string>();
  runtimeGlobals.localStorage = {
    getItem: (key: string) => storageMap.get(key) ?? null,
    setItem: (key: string, value: string) => {
      storageMap.set(key, String(value));
    },
    removeItem: (key: string) => {
      storageMap.delete(key);
    },
    clear: () => {
      storageMap.clear();
    },
    key: (index: number) => Array.from(storageMap.keys())[index] ?? null,
    get length() {
      return storageMap.size;
    },
  } as Storage;

  const draftPlan: DraftPlan = {
    title: "History draft",
    rationale: "test",
    components: [
      {
        id: "draft-r1",
        ref: "R1",
        name: "Resistor",
        value: "10k",
        properties: {
          device_resolution_status: "unresolved",
          device_resolution_reason: "manual",
          preferred_search_query: "10k resistor 0603",
        },
      },
    ],
    pins: [],
    nets: [],
  };

  storageMap.set(
    "lceda_ai.panel.session.history-draft",
    JSON.stringify({
      sessionId: "history-draft",
      loggedIn: false,
      agentRunState: "awaiting_confirmation",
      agentRunRoute: "draft",
      summary: "历史草案待确认",
      chatMessages: [],
      draftPlan,
      draftPreview: {
        title: draftPlan.title,
        rationale: draftPlan.rationale,
        componentRefs: ["R1"],
        netNames: [],
        componentCount: 1,
        netCount: 0,
      },
    } satisfies Partial<MainPanelState>)
  );

  runtimeGlobals.LCEDA_HOST_BRIDGE = {
    getChannel: () => "standard",
    isAvailable: async () => true,
    getCapabilityReport: () => ({
      channel: "standard",
      available: true,
      missing: [],
      optionalMissing: [],
    }),
    getCurrentContext: async () => ({
      project: { channel: "standard", projectId: "p1", projectName: "demo", pageId: "page-history", pageName: "Sheet 1" },
      components: [],
      pins: [],
      nets: [],
      selection: { objectIds: [] },
    }),
    getSelection: async () => ({ objectIds: [] }),
    locate: async () => {},
  };

  try {
    const runtime = getAssistantRuntime();
    await runtime.openPanel();
    const restored = await runtime.restoreSession("history-draft");
    assert.equal(restored.draftPlan?.title, "History draft");

    const opened = await runtime.openDevicePicker();
    assert.equal(opened.devicePicker?.open, true);
    assert.equal(opened.devicePicker?.items[0]?.componentId, "draft-r1");
  } finally {
    runtimeGlobals.LCEDA_HOST_BRIDGE = previousBridge;
    runtimeGlobals.__LCEDA_AI_ASSISTANT_RUNTIME__ = previousRuntime;
    runtimeGlobals.localStorage = previousStorage;
  }
});

test("applyDraftPlan persists applied snapshot and initializes empty bindings after successful full apply", async () => {
  const runtimeGlobals = globalThis as typeof globalThis & {
    LCEDA_HOST_BRIDGE?: HostEditorBridge;
    __LCEDA_AI_ASSISTANT_RUNTIME__?: ReturnType<typeof getAssistantRuntime>;
    localStorage?: Storage;
  };
  const previousBridge = runtimeGlobals.LCEDA_HOST_BRIDGE;
  const previousRuntime = runtimeGlobals.__LCEDA_AI_ASSISTANT_RUNTIME__;
  const previousStorage = runtimeGlobals.localStorage;

  const storageMap = new Map<string, string>();
  runtimeGlobals.localStorage = {
    getItem: (key: string) => storageMap.get(key) ?? null,
    setItem: (key: string, value: string) => {
      storageMap.set(key, String(value));
    },
    removeItem: (key: string) => {
      storageMap.delete(key);
    },
    clear: () => {
      storageMap.clear();
    },
    key: (index: number) => Array.from(storageMap.keys())[index] ?? null,
    get length() {
      return storageMap.size;
    },
  } as Storage;

  const draftPlan: DraftPlan = {
    title: "LED Driver",
    rationale: "test rationale",
    components: [
      {
        id: "draft-r1",
        kind: "resistor",
        ref: "R1",
        value: "1k",
        properties: {},
      },
    ],
    pins: [],
    nets: [
      {
        id: "draft-net-vcc",
        name: "VCC",
        nodes: [],
      },
    ],
  };

  storageMap.set(
    "lceda_ai.panel.last_state",
    JSON.stringify({
      loggedIn: false,
      agentRunState: "awaiting_confirmation",
      agentRunRoute: "draft",
      summary: "草案待应用",
      chatMessages: [],
      draftPlan,
      draftPreview: {
        title: draftPlan.title,
        rationale: draftPlan.rationale,
        componentRefs: ["R1"],
        netNames: ["VCC"],
        componentCount: 1,
        netCount: 1,
      },
    } satisfies Partial<MainPanelState>)
  );

  runtimeGlobals.LCEDA_HOST_BRIDGE = {
    getChannel: () => "standard",
    isAvailable: async () => true,
    getCapabilityReport: async () => ({
      channel: "standard",
      available: true,
      missing: [],
      optionalMissing: [],
    }),
    getCurrentContext: async () => ({
      project: {
        projectId: "p1",
        projectName: "demo",
        pageId: "page-42",
        pageName: "Sheet 1",
      },
      components: [],
      pins: [],
      nets: [],
    }),
    getSelection: async () => ({ objectIds: [] }),
    locate: async () => {},
    applyPlan: async () => ({
      applied: true,
      componentCount: 1,
      netCount: 1,
      transactionId: "tx-42",
    }),
  };

  try {
    const runtime = getAssistantRuntime();
    const state = await runtime.openPanel();
    assert.equal(state.agentRunState, "awaiting_confirmation");
    assert.equal(state.draftPlan?.title, "LED Driver");

    const applied = await runtime.applyDraftPlan();

    assert.equal(applied.agentRunState, "completed");
    assert.equal(applied.appliedDraftSnapshot?.title, "LED Driver");
    assert.equal(applied.appliedDraftSnapshot?.rationale, "test rationale");
    assert.equal(applied.appliedDraftSnapshot?.applyTransactionId, "tx-42");
    assert.notEqual(applied.appliedDraftSnapshot?.draftVersionId, "tx-42");
    assert.match(applied.appliedDraftSnapshot?.draftVersionId ?? "", /^draft_/);
    assert.equal(applied.appliedDraftSnapshot?.pageId, "page-42");
    assert.deepEqual(applied.appliedDraftSnapshot?.components, draftPlan.components);
    assert.deepEqual(applied.appliedDraftSnapshot?.pins, draftPlan.pins);
    assert.deepEqual(applied.appliedDraftSnapshot?.nets, draftPlan.nets);
    assert.equal(typeof applied.appliedDraftSnapshot?.appliedAt, "string");
    assert.equal(applied.draftObjectBindings?.pageId, "page-42");
    assert.equal(applied.draftObjectBindings?.authoritative, false);
    assert.deepEqual(applied.draftObjectBindings?.componentBindings, []);
    assert.deepEqual(applied.draftObjectBindings?.wireBindings, []);

    const persistedStateRaw = storageMap.get("lceda_ai.panel.last_state");
    assert.ok(persistedStateRaw);
    const persistedState = JSON.parse(persistedStateRaw) as MainPanelState;
    assert.equal(persistedState.appliedDraftSnapshot?.applyTransactionId, "tx-42");
    assert.equal(persistedState.draftObjectBindings?.authoritative, false);

    runtimeGlobals.__LCEDA_AI_ASSISTANT_RUNTIME__ = undefined;
    const rehydratedRuntime = getAssistantRuntime();
    const rehydrated = await rehydratedRuntime.openPanel();
    assert.equal(rehydrated.appliedDraftSnapshot?.applyTransactionId, "tx-42");
    assert.equal(rehydrated.appliedDraftSnapshot?.draftVersionId, applied.appliedDraftSnapshot?.draftVersionId);
    assert.equal(rehydrated.draftObjectBindings?.authoritative, false);
  } finally {
    runtimeGlobals.LCEDA_HOST_BRIDGE = previousBridge;
    runtimeGlobals.__LCEDA_AI_ASSISTANT_RUNTIME__ = previousRuntime;
    runtimeGlobals.localStorage = previousStorage;
  }
});

test("rollbackLastApply clears persisted applied snapshot bindings and patch state after successful rollback", async () => {
  const runtimeGlobals = globalThis as typeof globalThis & {
    LCEDA_HOST_BRIDGE?: HostEditorBridge;
    __LCEDA_AI_ASSISTANT_RUNTIME__?: ReturnType<typeof getAssistantRuntime>;
    localStorage?: Storage;
  };
  const previousBridge = runtimeGlobals.LCEDA_HOST_BRIDGE;
  const previousRuntime = runtimeGlobals.__LCEDA_AI_ASSISTANT_RUNTIME__;
  const previousStorage = runtimeGlobals.localStorage;

  const storageMap = new Map<string, string>();
  runtimeGlobals.localStorage = {
    getItem: (key: string) => storageMap.get(key) ?? null,
    setItem: (key: string, value: string) => {
      storageMap.set(key, String(value));
    },
    removeItem: (key: string) => {
      storageMap.delete(key);
    },
    clear: () => {
      storageMap.clear();
    },
    key: (index: number) => Array.from(storageMap.keys())[index] ?? null,
    get length() {
      return storageMap.size;
    },
  } as Storage;

  const draftPlan: DraftPlan = {
    title: "Regulator",
    rationale: "rollback test",
    components: [],
    pins: [],
    nets: [],
  };

  storageMap.set(
    "lceda_ai.panel.last_state",
    JSON.stringify({
      loggedIn: false,
      agentRunState: "awaiting_confirmation",
      agentRunRoute: "draft",
      summary: "草案待应用",
      chatMessages: [],
      draftPlan,
      draftPreview: {
        title: draftPlan.title,
        rationale: draftPlan.rationale,
        componentRefs: [],
        netNames: [],
        componentCount: 0,
        netCount: 0,
      },
    } satisfies Partial<MainPanelState>)
  );

  runtimeGlobals.LCEDA_HOST_BRIDGE = {
    getChannel: () => "standard",
    isAvailable: async () => true,
    getCapabilityReport: async () => ({
      channel: "standard",
      available: true,
      missing: [],
      optionalMissing: [],
    }),
    getCurrentContext: async () => ({
      project: {
        projectId: "p1",
        projectName: "demo",
        pageId: "page-rollback",
        pageName: "Sheet 1",
      },
      components: [],
      pins: [],
      nets: [],
    }),
    getSelection: async () => ({ objectIds: [] }),
    locate: async () => {},
    applyPlan: async () => ({
      applied: true,
      componentCount: 0,
      netCount: 0,
      transactionId: "tx-rollback",
    }),
    rollbackApplyPlan: async () => ({
      rolledBack: true,
      transactionId: "tx-rollback",
    }),
  };

  try {
    const runtime = getAssistantRuntime();
    await runtime.openPanel();
    const applied = await runtime.applyDraftPlan();
    assert.equal(applied.appliedDraftSnapshot?.applyTransactionId, "tx-rollback");

    const lastStateBeforeRollback = runtime.getLastState();
    assert.ok(lastStateBeforeRollback);
    lastStateBeforeRollback.draftPatchPlan = {
      baseDraftVersionId: applied.appliedDraftSnapshot?.draftVersionId ?? "base",
      nextDraftVersionId: "next",
      summary: {
        addComponentCount: 0,
        removeComponentCount: 0,
        replaceDeviceCount: 0,
        updatePropCount: 0,
        addWireCount: 0,
        removeWireCount: 0,
        conflictCount: 0,
      },
      operations: [],
      conflicts: [],
    };

    const rolledBack = await runtime.rollbackLastApply();
    assert.equal(rolledBack.agentRunState, "completed");
    assert.equal(rolledBack.appliedDraftSnapshot, undefined);
    assert.equal(rolledBack.draftObjectBindings, undefined);
    assert.equal(rolledBack.draftPatchPlan, undefined);

    const persistedStateRaw = storageMap.get("lceda_ai.panel.last_state");
    assert.ok(persistedStateRaw);
    const persistedState = JSON.parse(persistedStateRaw) as MainPanelState;
    assert.equal(persistedState.appliedDraftSnapshot, undefined);
    assert.equal(persistedState.draftObjectBindings, undefined);
    assert.equal(persistedState.draftPatchPlan, undefined);
  } finally {
    runtimeGlobals.LCEDA_HOST_BRIDGE = previousBridge;
    runtimeGlobals.__LCEDA_AI_ASSISTANT_RUNTIME__ = previousRuntime;
    runtimeGlobals.localStorage = previousStorage;
  }
});

test("re-applying a draft with applied snapshot and bindings builds a patch preview instead of full apply", async () => {
  const runtimeGlobals = globalThis as typeof globalThis & {
    LCEDA_HOST_BRIDGE?: HostEditorBridge;
    __LCEDA_AI_ASSISTANT_RUNTIME__?: ReturnType<typeof getAssistantRuntime>;
    localStorage?: Storage;
  };
  const previousBridge = runtimeGlobals.LCEDA_HOST_BRIDGE;
  const previousRuntime = runtimeGlobals.__LCEDA_AI_ASSISTANT_RUNTIME__;
  const previousStorage = runtimeGlobals.localStorage;

  const storageMap = new Map<string, string>();
  runtimeGlobals.localStorage = {
    getItem: (key: string) => storageMap.get(key) ?? null,
    setItem: (key: string, value: string) => {
      storageMap.set(key, String(value));
    },
    removeItem: (key: string) => {
      storageMap.delete(key);
    },
    clear: () => {
      storageMap.clear();
    },
    key: (index: number) => Array.from(storageMap.keys())[index] ?? null,
    get length() {
      return storageMap.size;
    },
  } as Storage;

  const draftPlan: DraftPlan = {
    title: "LED Driver v2",
    rationale: "patch preview test",
    components: [
      {
        id: "draft-r1",
        kind: "resistor",
        ref: "R1",
        value: "2k",
        properties: {
          device_uuid: "dev-rx-2k",
          library_uuid: "lib-r",
          completion_role: "resistor",
        },
      },
      {
        id: "draft-c1",
        kind: "capacitor",
        ref: "C1",
        value: "100nF",
        properties: {
          device_uuid: "dev-c-100n",
          library_uuid: "lib-c",
        },
      },
    ],
    pins: [],
    nets: [],
  };

  storageMap.set(
    "lceda_ai.panel.last_state",
    JSON.stringify({
      loggedIn: false,
      agentRunState: "awaiting_confirmation",
      agentRunRoute: "draft",
      summary: "草案待应用",
      chatMessages: [],
      draftPlan,
      draftPreview: {
        title: draftPlan.title,
        rationale: draftPlan.rationale,
        componentRefs: ["R1", "C1"],
        netNames: [],
        componentCount: 2,
        netCount: 0,
      },
      appliedDraftSnapshot: {
        draftVersionId: "draft_prev",
        applyTransactionId: "tx-prev",
        title: "LED Driver v1",
        rationale: "previous",
        appliedAt: new Date().toISOString(),
        pageId: "page-42",
        components: [
          {
            id: "draft-r1",
            kind: "resistor",
            ref: "R1",
            value: "1k",
            properties: {
              device_uuid: "dev-r-1k",
              library_uuid: "lib-r",
              completion_role: "regulator",
            },
          },
        ],
        pins: [],
        nets: [],
      },
      draftObjectBindings: {
        pageId: "page-42",
        authoritative: true,
        componentBindings: [
          {
            draftComponentId: "draft-r1",
            ref: "R1",
            primitiveId: "prim-r1",
            deviceUuid: "dev-r-1k",
            libraryUuid: "lib-r",
          },
        ],
        wireBindings: [],
      },
    } satisfies Partial<MainPanelState>)
  );

  let applyPlanCalls = 0;
  runtimeGlobals.LCEDA_HOST_BRIDGE = {
    getChannel: () => "standard",
    isAvailable: async () => true,
    getCapabilityReport: async () => ({
      channel: "standard",
      available: true,
      missing: [],
      optionalMissing: [],
    }),
    getCurrentContext: async () => ({
      project: {
        projectId: "p1",
        projectName: "demo",
        pageId: "page-42",
        pageName: "Sheet 1",
      },
      components: [],
      pins: [],
      nets: [],
    }),
    getSelection: async () => ({ objectIds: [] }),
    locate: async () => {},
    applyPlan: async () => {
      applyPlanCalls += 1;
      return {
        applied: true,
        componentCount: 2,
        netCount: 0,
        transactionId: "tx-new",
      };
    },
  };

  try {
    const runtime = getAssistantRuntime();
    await runtime.openPanel();

    const previewed = await runtime.applyDraftPlan();

    assert.equal(applyPlanCalls, 0);
    assert.equal(previewed.agentRunState, "awaiting_confirmation");
    assert.equal(previewed.agentRunRoute, "draft");
    assert.match(previewed.agentRunDetail ?? "", /patch|补丁|预览/i);
    assert.match(previewed.summary ?? "", /新增器件 1/);
    assert.match(previewed.summary ?? "", /替换器件 1/);
    assert.ok(previewed.draftPatchPlan);
    assert.equal(previewed.draftPatchPlan?.baseDraftVersionId, "draft_prev");
    assert.equal(previewed.draftPatchPlan?.summary.addComponentCount, 1);
    assert.equal(previewed.draftPatchPlan?.summary.replaceDeviceCount, 1);
    assert.equal(previewed.draftPatchPlan?.summary.removeComponentCount, 0);

    const lastMessage = previewed.chatMessages?.[previewed.chatMessages.length - 1];
    assert.ok(lastMessage);
    assert.match(lastMessage?.content ?? "", /新增器件 1/);
    assert.match(lastMessage?.content ?? "", /待处理冲突 1/);
    assert.deepEqual(lastMessage?.actions, [
      {
        label: "应用补丁草案",
        action: "apply_patch_draft",
      },
    ]);
  } finally {
    runtimeGlobals.LCEDA_HOST_BRIDGE = previousBridge;
    runtimeGlobals.__LCEDA_AI_ASSISTANT_RUNTIME__ = previousRuntime;
    runtimeGlobals.localStorage = previousStorage;
  }
});

test("applyPatchDraftPlan executes apply_patch_draft and refreshes snapshot bindings and summary", async () => {
  const runtimeGlobals = globalThis as typeof globalThis & {
    LCEDA_HOST_BRIDGE?: HostEditorBridge;
    __LCEDA_AI_ASSISTANT_RUNTIME__?: ReturnType<typeof getAssistantRuntime>;
    localStorage?: Storage;
  };
  const previousBridge = runtimeGlobals.LCEDA_HOST_BRIDGE;
  const previousRuntime = runtimeGlobals.__LCEDA_AI_ASSISTANT_RUNTIME__;
  const previousStorage = runtimeGlobals.localStorage;

  const storageMap = new Map<string, string>();
  runtimeGlobals.localStorage = {
    getItem: (key: string) => storageMap.get(key) ?? null,
    setItem: (key: string, value: string) => {
      storageMap.set(key, String(value));
    },
    removeItem: (key: string) => {
      storageMap.delete(key);
    },
    clear: () => {
      storageMap.clear();
    },
    key: (index: number) => Array.from(storageMap.keys())[index] ?? null,
    get length() {
      return storageMap.size;
    },
  } as Storage;

  const previousPlan: DraftPlan = {
    title: "LED Driver",
    rationale: "previous",
    components: [
      {
        id: "draft-r1",
        kind: "resistor",
        ref: "R1",
        value: "1k",
        properties: {
          device_uuid: "dev-r-1k",
          library_uuid: "lib-r",
        },
      },
    ],
    pins: [],
    nets: [],
  };

  const nextPlan: DraftPlan = {
    title: "LED Driver v2",
    rationale: "patched",
    components: [
      {
        id: "draft-r1",
        kind: "resistor",
        ref: "R1",
        value: "2k",
        properties: {
          device_uuid: "dev-r-2k",
          library_uuid: "lib-r",
        },
      },
      {
        id: "draft-c1",
        kind: "capacitor",
        ref: "C1",
        value: "100nF",
        properties: {
          device_uuid: "dev-c-100nf",
          library_uuid: "lib-c",
        },
      },
    ],
    pins: [],
    nets: [],
  };

  storageMap.set(
    "lceda_ai.panel.last_state",
    JSON.stringify({
      loggedIn: false,
      agentRunState: "awaiting_confirmation",
      agentRunRoute: "draft",
      summary: "草案待应用",
      chatMessages: [],
      draftPlan: nextPlan,
      draftPreview: {
        title: nextPlan.title,
        rationale: nextPlan.rationale,
        componentRefs: ["R1", "C1"],
        netNames: [],
        componentCount: 2,
        netCount: 0,
      },
      appliedDraftSnapshot: {
        draftVersionId: "draft_prev",
        applyTransactionId: "tx-prev",
        title: previousPlan.title,
        rationale: previousPlan.rationale,
        appliedAt: "2026-04-25T00:00:00.000Z",
        pageId: "page-42",
        components: previousPlan.components,
        pins: previousPlan.pins,
        nets: previousPlan.nets,
      },
      draftObjectBindings: {
        pageId: "page-42",
        authoritative: true,
        componentBindings: [
          {
            draftComponentId: "draft-r1",
            ref: "R1",
            primitiveId: "sch-r1",
            deviceUuid: "dev-r-1k",
            libraryUuid: "lib-r",
          },
        ],
        wireBindings: [],
      },
    } satisfies Partial<MainPanelState>)
  );

  let patchDraftPlanCalls = 0;
  runtimeGlobals.LCEDA_HOST_BRIDGE = {
    getChannel: () => "standard",
    isAvailable: async () => true,
    getCapabilityReport: async () => ({
      channel: "standard",
      available: true,
      missing: [],
      optionalMissing: [],
    }),
    getCurrentContext: async () => ({
      project: {
        projectId: "p1",
        projectName: "demo",
        pageId: "page-42",
        pageName: "Sheet 1",
      },
      components: [],
      pins: [],
      nets: [],
    }),
    getSelection: async () => ({ objectIds: [] }),
    locate: async () => {},
    patchDraftPlan: async () => {
      patchDraftPlanCalls += 1;
      return {
        applied: true,
        transactionId: "tx-patch-1",
        bindings: {
          pageId: "page-42",
          authoritative: true,
          componentBindings: [
            {
              draftComponentId: "draft-r1",
              ref: "R1",
              primitiveId: "sch-r1",
              deviceUuid: "dev-r-2k",
              libraryUuid: "lib-r",
            },
            {
              draftComponentId: "draft-c1",
              ref: "C1",
              primitiveId: "sch-c1",
              deviceUuid: "dev-c-100nf",
              libraryUuid: "lib-c",
            },
          ],
          wireBindings: [],
        },
      };
    },
  } as HostEditorBridge & {
    patchDraftPlan: NonNullable<HostEditorBridge["patchDraftPlan"]>;
  };

  try {
    const runtime = getAssistantRuntime();
    await runtime.openPanel();

    const previewed = await runtime.applyDraftPlan();
    assert.ok(previewed.draftPatchPlan);

    const applied = await (runtime as typeof runtime & {
      applyPatchDraftPlan: () => Promise<MainPanelState>;
    }).applyPatchDraftPlan();

    assert.equal(patchDraftPlanCalls, 1);
    assert.equal(applied.agentRunState, "completed");
    assert.equal(applied.draftPatchPlan, undefined);
    assert.equal(applied.appliedDraftSnapshot?.title, "LED Driver v2");
    assert.equal(applied.appliedDraftSnapshot?.rationale, "patched");
    assert.equal(applied.appliedDraftSnapshot?.applyTransactionId, "tx-patch-1");
    assert.equal(applied.appliedDraftSnapshot?.pageId, "page-42");
    assert.deepEqual(applied.appliedDraftSnapshot?.components, nextPlan.components);
    assert.deepEqual(applied.draftObjectBindings, {
      pageId: "page-42",
      authoritative: true,
      componentBindings: [
        {
          draftComponentId: "draft-r1",
          ref: "R1",
          primitiveId: "sch-r1",
          deviceUuid: "dev-r-2k",
          libraryUuid: "lib-r",
        },
        {
          draftComponentId: "draft-c1",
          ref: "C1",
          primitiveId: "sch-c1",
          deviceUuid: "dev-c-100nf",
          libraryUuid: "lib-c",
        },
      ],
      wireBindings: [],
    });
    assert.match(applied.summary ?? "", /补丁|patch/i);

    const persistedStateRaw = storageMap.get("lceda_ai.panel.last_state");
    assert.ok(persistedStateRaw);
    const persistedState = JSON.parse(persistedStateRaw) as MainPanelState;
    assert.equal(persistedState.draftPatchPlan, undefined);
    assert.equal(persistedState.appliedDraftSnapshot?.applyTransactionId, "tx-patch-1");
    assert.equal(persistedState.draftObjectBindings?.authoritative, true);
  } finally {
    runtimeGlobals.LCEDA_HOST_BRIDGE = previousBridge;
    runtimeGlobals.__LCEDA_AI_ASSISTANT_RUNTIME__ = previousRuntime;
    runtimeGlobals.localStorage = previousStorage;
  }
});

test("applyPatchDraftPlan fails closed when current draft no longer matches the previewed patch", async () => {
  const runtimeGlobals = globalThis as typeof globalThis & {
    LCEDA_HOST_BRIDGE?: HostEditorBridge;
    __LCEDA_AI_ASSISTANT_RUNTIME__?: ReturnType<typeof getAssistantRuntime>;
    localStorage?: Storage;
  };
  const previousBridge = runtimeGlobals.LCEDA_HOST_BRIDGE;
  const previousRuntime = runtimeGlobals.__LCEDA_AI_ASSISTANT_RUNTIME__;
  const previousStorage = runtimeGlobals.localStorage;

  const storageMap = new Map<string, string>();
  runtimeGlobals.localStorage = {
    getItem: (key: string) => storageMap.get(key) ?? null,
    setItem: (key: string, value: string) => {
      storageMap.set(key, String(value));
    },
    removeItem: (key: string) => {
      storageMap.delete(key);
    },
    clear: () => {
      storageMap.clear();
    },
    key: (index: number) => Array.from(storageMap.keys())[index] ?? null,
    get length() {
      return storageMap.size;
    },
  } as Storage;

  const previousPlan: DraftPlan = {
    title: "LED Driver",
    rationale: "previous",
    components: [
      {
        id: "draft-r1",
        kind: "resistor",
        ref: "R1",
        value: "1k",
        properties: {
          device_uuid: "dev-r-1k",
          library_uuid: "lib-r",
        },
      },
    ],
    pins: [],
    nets: [],
  };

  const nextPlan: DraftPlan = {
    title: "LED Driver v2",
    rationale: "patched",
    components: [
      {
        id: "draft-r1",
        kind: "resistor",
        ref: "R1",
        value: "2k",
        properties: {
          device_uuid: "dev-r-2k",
          library_uuid: "lib-r",
        },
      },
    ],
    pins: [],
    nets: [],
  };

  storageMap.set(
    "lceda_ai.panel.last_state",
    JSON.stringify({
      loggedIn: false,
      agentRunState: "awaiting_confirmation",
      agentRunRoute: "draft",
      summary: "草案待应用",
      chatMessages: [],
      draftPlan: nextPlan,
      draftPreview: {
        title: nextPlan.title,
        rationale: nextPlan.rationale,
        componentRefs: ["R1"],
        netNames: [],
        componentCount: 1,
        netCount: 0,
      },
      appliedDraftSnapshot: {
        draftVersionId: "draft_prev",
        applyTransactionId: "tx-prev",
        title: previousPlan.title,
        rationale: previousPlan.rationale,
        appliedAt: "2026-04-25T00:00:00.000Z",
        pageId: "page-42",
        components: previousPlan.components,
        pins: previousPlan.pins,
        nets: previousPlan.nets,
      },
      draftObjectBindings: {
        pageId: "page-42",
        authoritative: true,
        componentBindings: [
          {
            draftComponentId: "draft-r1",
            ref: "R1",
            primitiveId: "sch-r1",
            deviceUuid: "dev-r-1k",
            libraryUuid: "lib-r",
          },
        ],
        wireBindings: [],
      },
    } satisfies Partial<MainPanelState>)
  );

  let patchDraftPlanCalls = 0;
  runtimeGlobals.LCEDA_HOST_BRIDGE = {
    getChannel: () => "standard",
    isAvailable: async () => true,
    getCapabilityReport: async () => ({
      channel: "standard",
      available: true,
      missing: [],
      optionalMissing: [],
    }),
    getCurrentContext: async () => ({
      project: {
        projectId: "p1",
        projectName: "demo",
        pageId: "page-42",
        pageName: "Sheet 1",
      },
      components: [],
      pins: [],
      nets: [],
    }),
    getSelection: async () => ({ objectIds: [] }),
    locate: async () => {},
    patchDraftPlan: async () => {
      patchDraftPlanCalls += 1;
      return {
        applied: true,
        transactionId: "tx-patch-1",
      };
    },
  } as HostEditorBridge & {
    patchDraftPlan: NonNullable<HostEditorBridge["patchDraftPlan"]>;
  };

  try {
    const runtime = getAssistantRuntime();
    await runtime.openPanel();
    const previewed = await runtime.applyDraftPlan();
    assert.ok(previewed.draftPatchPlan);

    const mutableState = runtime.getLastState();
    assert.ok(mutableState?.draftPlan);
    mutableState!.draftPlan!.components[0]!.value = "4.7k";

    const result = await runtime.applyPatchDraftPlan();

    assert.equal(patchDraftPlanCalls, 0);
    assert.equal(result.agentRunState, "failed");
    assert.match(result.summary ?? "", /补丁预览已过期|重新生成补丁预览/);
    assert.equal(result.draftPatchPlan?.nextDraftVersionId, previewed.draftPatchPlan?.nextDraftVersionId);
    assert.equal(result.appliedDraftSnapshot?.title, "LED Driver");
  } finally {
    runtimeGlobals.LCEDA_HOST_BRIDGE = previousBridge;
    runtimeGlobals.__LCEDA_AI_ASSISTANT_RUNTIME__ = previousRuntime;
    runtimeGlobals.localStorage = previousStorage;
  }
});

test("applyPatchDraftPlan preserves previous rollback transaction and marks fallback bindings non-authoritative when patch result omits both", async () => {
  const runtimeGlobals = globalThis as typeof globalThis & {
    LCEDA_HOST_BRIDGE?: HostEditorBridge;
    __LCEDA_AI_ASSISTANT_RUNTIME__?: ReturnType<typeof getAssistantRuntime>;
    localStorage?: Storage;
  };
  const previousBridge = runtimeGlobals.LCEDA_HOST_BRIDGE;
  const previousRuntime = runtimeGlobals.__LCEDA_AI_ASSISTANT_RUNTIME__;
  const previousStorage = runtimeGlobals.localStorage;

  const storageMap = new Map<string, string>();
  runtimeGlobals.localStorage = {
    getItem: (key: string) => storageMap.get(key) ?? null,
    setItem: (key: string, value: string) => {
      storageMap.set(key, String(value));
    },
    removeItem: (key: string) => {
      storageMap.delete(key);
    },
    clear: () => {
      storageMap.clear();
    },
    key: (index: number) => Array.from(storageMap.keys())[index] ?? null,
    get length() {
      return storageMap.size;
    },
  } as Storage;

  const previousPlan: DraftPlan = {
    title: "LED Driver",
    rationale: "previous",
    components: [
      {
        id: "draft-r1",
        kind: "resistor",
        ref: "R1",
        value: "1k",
        properties: {
          device_uuid: "dev-r-1k",
          library_uuid: "lib-r",
        },
      },
    ],
    pins: [],
    nets: [],
  };

  const nextPlan: DraftPlan = {
    title: "LED Driver v2",
    rationale: "patched",
    components: [
      {
        id: "draft-r1",
        kind: "resistor",
        ref: "R1",
        value: "2k",
        properties: {
          device_uuid: "dev-r-2k",
          library_uuid: "lib-r",
        },
      },
    ],
    pins: [],
    nets: [],
  };

  storageMap.set(
    "lceda_ai.panel.last_state",
    JSON.stringify({
      loggedIn: false,
      agentRunState: "awaiting_confirmation",
      agentRunRoute: "draft",
      summary: "草案待应用",
      chatMessages: [],
      draftPlan: nextPlan,
      draftPreview: {
        title: nextPlan.title,
        rationale: nextPlan.rationale,
        componentRefs: ["R1"],
        netNames: [],
        componentCount: 1,
        netCount: 0,
      },
      appliedDraftSnapshot: {
        draftVersionId: "draft_prev",
        applyTransactionId: "tx-prev",
        title: previousPlan.title,
        rationale: previousPlan.rationale,
        appliedAt: "2026-04-25T00:00:00.000Z",
        pageId: "page-42",
        components: previousPlan.components,
        pins: previousPlan.pins,
        nets: previousPlan.nets,
      },
      draftObjectBindings: {
        pageId: "page-42",
        authoritative: true,
        componentBindings: [
          {
            draftComponentId: "draft-r1",
            ref: "R1",
            primitiveId: "sch-r1",
            deviceUuid: "dev-r-1k",
            libraryUuid: "lib-r",
          },
        ],
        wireBindings: [],
      },
    } satisfies Partial<MainPanelState>)
  );

  let rollbackCalledWith: string | undefined;
  runtimeGlobals.LCEDA_HOST_BRIDGE = {
    getChannel: () => "standard",
    isAvailable: async () => true,
    getCapabilityReport: async () => ({
      channel: "standard",
      available: true,
      missing: [],
      optionalMissing: [],
    }),
    getCurrentContext: async () => ({
      project: {
        projectId: "p1",
        projectName: "demo",
        pageId: "page-42",
        pageName: "Sheet 1",
      },
      components: [],
      pins: [],
      nets: [],
    }),
    getSelection: async () => ({ objectIds: [] }),
    locate: async () => {},
    patchDraftPlan: async () => ({
      applied: true,
    }),
    rollbackApplyPlan: async (transactionId: string) => {
      rollbackCalledWith = transactionId;
      return { rolledBack: true, transactionId };
    },
  } as HostEditorBridge & {
    patchDraftPlan: NonNullable<HostEditorBridge["patchDraftPlan"]>;
  };

  try {
    const runtime = getAssistantRuntime();
    await runtime.openPanel();
    await runtime.applyDraftPlan();

    const applied = await runtime.applyPatchDraftPlan();
    assert.equal(applied.agentRunState, "completed");
    assert.equal(applied.appliedDraftSnapshot?.applyTransactionId, "tx-prev");
    assert.equal(applied.draftObjectBindings?.authoritative, false);
    assert.match(applied.summary ?? "", /未返回新的对象绑定|回退为非权威绑定/);
    assert.doesNotMatch(applied.summary ?? "", /对象绑定已刷新/);

    const rolledBack = await runtime.rollbackLastApply();
    assert.equal(rollbackCalledWith, "tx-prev");
    assert.equal(rolledBack.agentRunState, "completed");

    const persistedStateRaw = storageMap.get("lceda_ai.panel.last_state");
    assert.ok(persistedStateRaw);
    const persistedState = JSON.parse(persistedStateRaw) as MainPanelState;
    assert.equal(persistedState.appliedDraftSnapshot, undefined);
    assert.equal(persistedState.draftObjectBindings, undefined);
  } finally {
    runtimeGlobals.LCEDA_HOST_BRIDGE = previousBridge;
    runtimeGlobals.__LCEDA_AI_ASSISTANT_RUNTIME__ = previousRuntime;
    runtimeGlobals.localStorage = previousStorage;
  }
});

test("applyPatchDraftPlan preserves previous rollback transaction when patch result omits transactionId but returns bindings", async () => {
  const runtimeGlobals = globalThis as typeof globalThis & {
    LCEDA_HOST_BRIDGE?: HostEditorBridge;
    __LCEDA_AI_ASSISTANT_RUNTIME__?: ReturnType<typeof getAssistantRuntime>;
    localStorage?: Storage;
  };
  const previousBridge = runtimeGlobals.LCEDA_HOST_BRIDGE;
  const previousRuntime = runtimeGlobals.__LCEDA_AI_ASSISTANT_RUNTIME__;
  const previousStorage = runtimeGlobals.localStorage;

  const storageMap = new Map<string, string>();
  runtimeGlobals.localStorage = {
    getItem: (key: string) => storageMap.get(key) ?? null,
    setItem: (key: string, value: string) => {
      storageMap.set(key, String(value));
    },
    removeItem: (key: string) => {
      storageMap.delete(key);
    },
    clear: () => {
      storageMap.clear();
    },
    key: (index: number) => Array.from(storageMap.keys())[index] ?? null,
    get length() {
      return storageMap.size;
    },
  } as Storage;

  const previousPlan: DraftPlan = {
    title: "LED Driver",
    rationale: "previous",
    components: [
      {
        id: "draft-r1",
        kind: "resistor",
        ref: "R1",
        value: "1k",
        properties: {
          device_uuid: "dev-r-1k",
          library_uuid: "lib-r",
        },
      },
    ],
    pins: [],
    nets: [],
  };

  const nextPlan: DraftPlan = {
    title: "LED Driver v2",
    rationale: "patched",
    components: [
      {
        id: "draft-r1",
        kind: "resistor",
        ref: "R1",
        value: "2k",
        properties: {
          device_uuid: "dev-r-2k",
          library_uuid: "lib-r",
        },
      },
    ],
    pins: [],
    nets: [],
  };

  storageMap.set(
    "lceda_ai.panel.last_state",
    JSON.stringify({
      loggedIn: false,
      agentRunState: "awaiting_confirmation",
      agentRunRoute: "draft",
      summary: "草案待应用",
      chatMessages: [],
      draftPlan: nextPlan,
      draftPreview: {
        title: nextPlan.title,
        rationale: nextPlan.rationale,
        componentRefs: ["R1"],
        netNames: [],
        componentCount: 1,
        netCount: 0,
      },
      appliedDraftSnapshot: {
        draftVersionId: "draft_prev",
        applyTransactionId: "tx-prev",
        title: previousPlan.title,
        rationale: previousPlan.rationale,
        appliedAt: "2026-04-25T00:00:00.000Z",
        pageId: "page-42",
        components: previousPlan.components,
        pins: previousPlan.pins,
        nets: previousPlan.nets,
      },
      draftObjectBindings: {
        pageId: "page-42",
        authoritative: true,
        componentBindings: [
          {
            draftComponentId: "draft-r1",
            ref: "R1",
            primitiveId: "sch-r1",
            deviceUuid: "dev-r-1k",
            libraryUuid: "lib-r",
          },
        ],
        wireBindings: [],
      },
    } satisfies Partial<MainPanelState>)
  );

  let patchDraftPlanCalls = 0;
  runtimeGlobals.LCEDA_HOST_BRIDGE = {
    getChannel: () => "standard",
    isAvailable: async () => true,
    getCapabilityReport: async () => ({
      channel: "standard",
      available: true,
      missing: [],
      optionalMissing: [],
    }),
    getCurrentContext: async () => ({
      project: {
        projectId: "p1",
        projectName: "demo",
        pageId: "page-42",
        pageName: "Sheet 1",
      },
      components: [],
      pins: [],
      nets: [],
    }),
    getSelection: async () => ({ objectIds: [] }),
    locate: async () => {},
    patchDraftPlan: async () => {
      patchDraftPlanCalls += 1;
      return {
        applied: true,
        bindings: {
          pageId: "page-42",
          authoritative: true,
          componentBindings: [
            {
              draftComponentId: "draft-r1",
              ref: "R1",
              primitiveId: "sch-r1",
              deviceUuid: "dev-r-2k",
              libraryUuid: "lib-r",
            },
          ],
          wireBindings: [],
        },
      };
    },
  } as HostEditorBridge & {
    patchDraftPlan: NonNullable<HostEditorBridge["patchDraftPlan"]>;
  };

  try {
    const runtime = getAssistantRuntime();
    await runtime.openPanel();
    await runtime.applyDraftPlan();
    const applied = await runtime.applyPatchDraftPlan();

    assert.equal(patchDraftPlanCalls, 1);
    assert.equal(applied.agentRunState, "completed");
    assert.equal(applied.appliedDraftSnapshot?.applyTransactionId, "tx-prev");
    assert.equal(applied.appliedDraftSnapshot?.title, "LED Driver v2");
    assert.equal(applied.draftObjectBindings?.authoritative, true);
  } finally {
    runtimeGlobals.LCEDA_HOST_BRIDGE = previousBridge;
    runtimeGlobals.__LCEDA_AI_ASSISTANT_RUNTIME__ = previousRuntime;
    runtimeGlobals.localStorage = previousStorage;
  }
});

test("re-applying after a full apply with non-authoritative bindings should keep using full apply", async () => {
  const runtimeGlobals = globalThis as typeof globalThis & {
    LCEDA_HOST_BRIDGE?: HostEditorBridge;
    __LCEDA_AI_ASSISTANT_RUNTIME__?: ReturnType<typeof getAssistantRuntime>;
    localStorage?: Storage;
  };
  const previousBridge = runtimeGlobals.LCEDA_HOST_BRIDGE;
  const previousRuntime = runtimeGlobals.__LCEDA_AI_ASSISTANT_RUNTIME__;
  const previousStorage = runtimeGlobals.localStorage;

  const storageMap = new Map<string, string>();
  runtimeGlobals.localStorage = {
    getItem: (key: string) => storageMap.get(key) ?? null,
    setItem: (key: string, value: string) => {
      storageMap.set(key, String(value));
    },
    removeItem: (key: string) => {
      storageMap.delete(key);
    },
    clear: () => {
      storageMap.clear();
    },
    key: (index: number) => Array.from(storageMap.keys())[index] ?? null,
    get length() {
      return storageMap.size;
    },
  } as Storage;

  const initialDraftPlan: DraftPlan = {
    title: "LED Driver",
    rationale: "initial",
    components: [
      {
        id: "draft-r1",
        kind: "resistor",
        ref: "R1",
        value: "1k",
        properties: {
          device_uuid: "dev-r-1k",
          library_uuid: "lib-r",
        },
      },
    ],
    pins: [],
    nets: [],
  };

  storageMap.set(
    "lceda_ai.panel.last_state",
    JSON.stringify({
      loggedIn: false,
      agentRunState: "awaiting_confirmation",
      agentRunRoute: "draft",
      summary: "草案待应用",
      chatMessages: [],
      draftPlan: initialDraftPlan,
      draftPreview: {
        title: initialDraftPlan.title,
        rationale: initialDraftPlan.rationale,
        componentRefs: ["R1"],
        netNames: [],
        componentCount: 1,
        netCount: 0,
      },
    } satisfies Partial<MainPanelState>)
  );

  let applyPlanCalls = 0;
  runtimeGlobals.LCEDA_HOST_BRIDGE = {
    getChannel: () => "standard",
    isAvailable: async () => true,
    getCapabilityReport: async () => ({
      channel: "standard",
      available: true,
      missing: [],
      optionalMissing: [],
    }),
    getCurrentContext: async () => ({
      project: {
        projectId: "p1",
        projectName: "demo",
        pageId: "page-42",
        pageName: "Sheet 1",
      },
      components: [],
      pins: [],
      nets: [],
    }),
    getSelection: async () => ({ objectIds: [] }),
    locate: async () => {},
    applyPlan: async () => {
      applyPlanCalls += 1;
      return {
        applied: true,
        componentCount: 1,
        netCount: 0,
        transactionId: `tx-${applyPlanCalls}`,
      };
    },
  };

  try {
    const runtime = getAssistantRuntime();
    const opened = await runtime.openPanel();
    assert.equal(opened.agentRunState, "awaiting_confirmation");

    const firstApply = await runtime.applyDraftPlan();
    assert.equal(firstApply.agentRunState, "completed");
    assert.equal(firstApply.draftObjectBindings?.authoritative, false);
    assert.equal(applyPlanCalls, 1);

    const lastState = runtime.getLastState();
    assert.ok(lastState?.draftPlan);
    lastState.draftPlan = {
      ...lastState.draftPlan,
      title: "LED Driver v2",
      components: [
        {
          id: "draft-r1",
          kind: "resistor",
          ref: "R1",
          value: "2k",
          properties: {
            device_uuid: "dev-r-2k",
            library_uuid: "lib-r",
          },
        },
      ],
    };

    const reapplied = await runtime.applyDraftPlan();
    assert.equal(applyPlanCalls, 2);
    assert.equal(reapplied.agentRunState, "completed");
    assert.equal(reapplied.draftPatchPlan, undefined);
    assert.doesNotMatch(reapplied.summary ?? "", /patch|补丁|预览/i);
  } finally {
    runtimeGlobals.LCEDA_HOST_BRIDGE = previousBridge;
    runtimeGlobals.__LCEDA_AI_ASSISTANT_RUNTIME__ = previousRuntime;
    runtimeGlobals.localStorage = previousStorage;
  }
});

test("stale page mismatch should not enter patch preview", async () => {
  const runtimeGlobals = globalThis as typeof globalThis & {
    LCEDA_HOST_BRIDGE?: HostEditorBridge;
    __LCEDA_AI_ASSISTANT_RUNTIME__?: ReturnType<typeof getAssistantRuntime>;
    localStorage?: Storage;
  };
  const previousBridge = runtimeGlobals.LCEDA_HOST_BRIDGE;
  const previousRuntime = runtimeGlobals.__LCEDA_AI_ASSISTANT_RUNTIME__;
  const previousStorage = runtimeGlobals.localStorage;

  const storageMap = new Map<string, string>();
  runtimeGlobals.localStorage = {
    getItem: (key: string) => storageMap.get(key) ?? null,
    setItem: (key: string, value: string) => {
      storageMap.set(key, String(value));
    },
    removeItem: (key: string) => {
      storageMap.delete(key);
    },
    clear: () => {
      storageMap.clear();
    },
    key: (index: number) => Array.from(storageMap.keys())[index] ?? null,
    get length() {
      return storageMap.size;
    },
  } as Storage;

  const draftPlan: DraftPlan = {
    title: "LED Driver v2",
    rationale: "page mismatch",
    components: [
      {
        id: "draft-r1",
        kind: "resistor",
        ref: "R1",
        value: "2k",
        properties: {
          device_uuid: "dev-r-2k",
          library_uuid: "lib-r",
        },
      },
    ],
    pins: [],
    nets: [],
  };

  storageMap.set(
    "lceda_ai.panel.last_state",
    JSON.stringify({
      loggedIn: false,
      agentRunState: "awaiting_confirmation",
      agentRunRoute: "draft",
      summary: "草案待应用",
      chatMessages: [],
      draftPlan,
      draftPreview: {
        title: draftPlan.title,
        rationale: draftPlan.rationale,
        componentRefs: ["R1"],
        netNames: [],
        componentCount: 1,
        netCount: 0,
      },
      appliedDraftSnapshot: {
        draftVersionId: "draft_prev",
        applyTransactionId: "tx-prev",
        title: "LED Driver v1",
        rationale: "previous",
        appliedAt: new Date().toISOString(),
        pageId: "page-old",
        components: [
          {
            id: "draft-r1",
            kind: "resistor",
            ref: "R1",
            value: "1k",
            properties: {
              device_uuid: "dev-r-1k",
              library_uuid: "lib-r",
            },
          },
        ],
        pins: [],
        nets: [],
      },
      draftObjectBindings: {
        pageId: "page-old",
        authoritative: true,
        componentBindings: [
          {
            draftComponentId: "draft-r1",
            ref: "R1",
            primitiveId: "prim-r1",
            deviceUuid: "dev-r-1k",
            libraryUuid: "lib-r",
          },
        ],
        wireBindings: [],
      },
    } satisfies Partial<MainPanelState>)
  );

  let applyPlanCalls = 0;
  runtimeGlobals.LCEDA_HOST_BRIDGE = {
    getChannel: () => "standard",
    isAvailable: async () => true,
    getCapabilityReport: async () => ({
      channel: "standard",
      available: true,
      missing: [],
      optionalMissing: [],
    }),
    getCurrentContext: async () => ({
      project: {
        projectId: "p1",
        projectName: "demo",
        pageId: "page-current",
        pageName: "Sheet 2",
      },
      components: [],
      pins: [],
      nets: [],
    }),
    getSelection: async () => ({ objectIds: [] }),
    locate: async () => {},
    applyPlan: async () => {
      applyPlanCalls += 1;
      return {
        applied: true,
        componentCount: 1,
        netCount: 0,
        transactionId: "tx-new",
      };
    },
  };

  try {
    const runtime = getAssistantRuntime();
    await runtime.openPanel();

    const result = await runtime.applyDraftPlan();

    assert.equal(applyPlanCalls, 1);
    assert.equal(result.agentRunState, "completed");
    assert.equal(result.draftPatchPlan, undefined);
    assert.doesNotMatch(result.summary ?? "", /patch|补丁|预览/i);
  } finally {
    runtimeGlobals.LCEDA_HOST_BRIDGE = previousBridge;
    runtimeGlobals.__LCEDA_AI_ASSISTANT_RUNTIME__ = previousRuntime;
    runtimeGlobals.localStorage = previousStorage;
  }
});

test("draft confirmation follow-up summary requests should not auto-apply", () => {
  assert.equal(
    shouldAutoApplyDraftFromChatInput({
      agentRunState: "awaiting_confirmation",
      input: "给我生成一个列表展示用哪些主要的元器件",
      hasDraftPlan: true,
      draftBlocked: false,
    }),
    false
  );
});

test("shouldUseDraftReplyLeadNarrative falls back to naturalReply when draftNarrative is empty", () => {
  assert.equal(
    shouldUseDraftReplyLeadNarrative({
      draftNarrative: undefined,
      naturalReply: "先回答：J1 / power_connector 是外部电源输入接口。",
    }),
    "先回答：J1 / power_connector 是外部电源输入接口。"
  );
});

test("appendAssistantMessages preserves prior chat history when adding apply result", () => {
  const history = [
    { role: "user" as const, title: "你", content: "帮我设计一个点亮LED的电路" },
    { role: "assistant" as const, title: "草案草图", content: "我已经生成一版草案。" },
  ];
  const applied = [
    { role: "assistant" as const, title: "已应用草案", content: "草案已成功应用到画布。", tone: "success" as const },
  ];

  const merged = appendAssistantMessages(history, applied);
  assert.equal(merged.length, 3);
  assert.equal(merged[0]?.content, "帮我设计一个点亮LED的电路");
  assert.equal(merged[1]?.title, "草案草图");
  assert.equal(merged[2]?.title, "已应用草案");
  assert.equal(merged[2]?.tone, "success");
});

test("appendUserChatMessage preserves the confirm prompt before auto-applying a draft", () => {
  const history = [
    { role: "user" as const, title: "你", content: "帮我设计一个点亮LED的电路" },
    { role: "assistant" as const, title: "草案草图", content: "下一步应进入人工确认。" },
  ];

  const merged = appendUserChatMessage(history, "确认");
  assert.equal(merged.length, 3);
  assert.equal(merged[2]?.role, "user");
  assert.equal(merged[2]?.content, "确认");
});

test("mergeAssistantFinalMessage fully replaces streamed content while preserving progress metadata", () => {
  const pending = {
    role: "assistant" as const,
    title: "分析中",
    content: "{\"type\":\"final\",\"route\":\"analysis\"}",
    streaming: true,
    reactEvents: [
      { kind: "thought" as const, label: "Reasoning", status: "done" as const, text: "思考中", stepKind: "llm" as const },
    ],
    stepStates: [
      { kind: "llm" as const, required: true, note: "生成最终报告", status: "done" as const },
    ],
    workingMemory: {
      hasContext: true,
      mcpReady: false,
      libraryReady: false,
      llmReady: true,
      rulesReady: false,
      draftReady: false,
      lastObservation: "已有最终结论",
    },
  };
  const finalMessage = {
    role: "assistant" as const,
    title: "分析结果",
    content: "# 原理图审查报告\n\n最终正文",
    tone: "warning" as const,
    structuredContent: [
      { kind: "paragraph" as const, text: "最终结构化内容" },
    ],
  };

  const merged = mergeAssistantFinalMessage(pending, finalMessage);

  assert.equal(merged.streaming, false);
  assert.equal(merged.title, "分析结果");
  assert.equal(merged.content, "# 原理图审查报告\n\n最终正文");
  assert.equal(Array.isArray(merged.structuredContent), true);
  assert.equal(merged.reactEvents?.length, 1);
  assert.equal(merged.stepStates?.length, 1);
  assert.equal(merged.workingMemory?.lastObservation, "已有最终结论");
});

test("mergeAssistantFinalMessage preserves pending process stepItems when final message omits them", () => {
  const pending = {
    role: "assistant" as const,
    title: "分析中",
    content: "streaming...",
    streaming: true,
    stepItems: [
      {
        id: "step-1",
        phase: "llm" as const,
        type: "thought" as const,
        status: "running" as const,
        title: "Reasoning",
        text: "正在思考",
        startedAt: "2026-04-14T10:00:00.000Z",
        streaming: true,
      },
    ],
  };
  const finalMessage = {
    role: "assistant" as const,
    title: "分析结果",
    content: "最终答案",
  };

  const merged = mergeAssistantFinalMessage(pending, finalMessage);

  assert.equal(Array.isArray(merged.stepItems), true);
  assert.equal(merged.stepItems?.length, 1);
  assert.equal(merged.stepItems?.[0]?.id, "step-1");
  assert.equal(merged.stepItems?.[0]?.type, "thought");
  assert.equal(merged.stepItems?.[0]?.text, "正在思考");
});

test("mergeAssistantFinalMessage does not preserve partial streaming body as final content", () => {
  const pending = {
    role: "assistant" as const,
    title: "草案生成中",
    content: "我来并让我信息",
    streaming: true,
    iterationSteps: [
      {
        id: "react-iteration-1",
        iteration: 1,
        status: "running" as const,
        thoughtText: "正在整理模块信息",
        streaming: true,
        toolEvents: [],
        observationTexts: [],
      },
    ],
  };
  const finalMessage = {
    role: "assistant" as const,
    title: "草案结果",
    content: "",
  };

  const merged = mergeAssistantFinalMessage(pending, finalMessage);

  assert.equal(merged.streaming, false);
  assert.equal(merged.content, "");
  assert.equal(merged.iterationSteps?.[0]?.thoughtText, "正在整理模块信息");
});

test("mergeAssistantFinalMessage preserves pending iterationSteps when final message omits them", () => {
  const pending = {
    role: "assistant" as const,
    title: "分析中",
    content: "streaming...",
    streaming: true,
    iterationSteps: [
      {
        id: "react-iteration-4",
        iteration: 4,
        status: "running" as const,
        thoughtText: "Reviewing key components",
        streaming: true,
        toolEvents: [
          {
            toolName: "editor_get_current_context",
            label: "editor_get_current_context",
            status: "done" as const,
          },
        ],
        observationTexts: [],
      },
    ],
  };
  const finalMessage = {
    role: "assistant" as const,
    title: "分析结果",
    content: "最终答案",
  };

  const merged = mergeAssistantFinalMessage(pending, finalMessage);

  assert.equal(Array.isArray(merged.iterationSteps), true);
  assert.equal(merged.iterationSteps?.length, 1);
  assert.equal(merged.iterationSteps?.[0]?.iteration, 4);
  assert.equal(merged.iterationSteps?.[0]?.thoughtText, "Reviewing key components");
  assert.equal(merged.iterationSteps?.[0]?.toolEvents?.[0]?.toolName, "editor_get_current_context");
});

test("mergeAssistantFinalMessage converts legacy reactEvents into stepItems without final entries", () => {
  const pending = {
    role: "assistant" as const,
    title: "分析中",
    content: "streaming...",
    streaming: true,
    reactEvents: [
      {
        kind: "thought" as const,
        label: "Reasoning",
        status: "running" as const,
        text: "正在思考",
        stepKind: "llm" as const,
      },
      {
        kind: "final" as const,
        label: "完成",
        status: "done" as const,
        text: "最终结论",
        stepKind: "llm" as const,
      },
    ],
  };
  const finalMessage = {
    role: "assistant" as const,
    title: "分析结果",
    content: "最终答案",
  };

  const merged = mergeAssistantFinalMessage(pending, finalMessage);

  assert.equal(Array.isArray(merged.stepItems), true);
  assert.equal(merged.stepItems?.length, 1);
  assert.equal(merged.stepItems?.[0]?.type, "thought");
  assert.equal(merged.stepItems?.[0]?.title, "Reasoning");
});

test("mergeAssistantFinalMessage respects explicit empty final stepItems without fallback", () => {
  const pending = {
    role: "assistant" as const,
    title: "分析中",
    content: "streaming...",
    streaming: true,
    stepItems: [
      {
        id: "step-1",
        phase: "llm" as const,
        type: "thought" as const,
        status: "running" as const,
        title: "Reasoning",
        text: "正在思考",
      },
    ],
  };
  const finalMessage = {
    role: "assistant" as const,
    title: "分析结果",
    content: "最终答案",
    stepItems: [],
  };

  const merged = mergeAssistantFinalMessage(pending, finalMessage);

  assert.equal(Array.isArray(merged.stepItems), true);
  assert.equal(merged.stepItems?.length, 0);
});

test("mergeAssistantFinalMessage strips final-control-like text from converted stepItems", () => {
  const pending = {
    role: "assistant" as const,
    title: "分析中",
    content: "streaming...",
    streaming: true,
    reactEvents: [
      {
        kind: "thought" as const,
        label: "Reasoning",
        status: "done" as const,
        text: "先输出概览。\n\n```json\n{\n  \"type\": \"final\",\n  \"route\": \"analysis\"\n}",
        stepKind: "llm" as const,
      },
    ],
  };
  const finalMessage = {
    role: "assistant" as const,
    title: "分析结果",
    content: "最终答案",
  };

  const merged = mergeAssistantFinalMessage(pending, finalMessage);

  assert.equal(merged.stepItems?.[0]?.text, "先输出概览。");
});

test("stripFinalControlLikeText removes partial final control payload", () => {
  assert.equal(
    stripFinalControlLikeText("已整理完证据\n{\"type\":\"final"),
    "已整理完证据"
  );
});

test("mergeAssistantFinalMessage keeps explicit empty final reactEvents without fallback", () => {
  const pending = {
    role: "assistant" as const,
    title: "分析中",
    content: "streaming...",
    streaming: true,
    reactEvents: [
      {
        kind: "thought" as const,
        label: "Reasoning",
        status: "running" as const,
        text: "正在思考",
        stepKind: "llm" as const,
      },
    ],
  };
  const finalMessage = {
    role: "assistant" as const,
    title: "分析结果",
    content: "最终答案",
    reactEvents: [],
  };

  const merged = mergeAssistantFinalMessage(pending, finalMessage);

  assert.equal(Array.isArray(merged.reactEvents), true);
  assert.equal(merged.reactEvents?.length, 0);
});

test("mergeAssistantFinalMessage keeps explicit empty final stepStates without fallback", () => {
  const pending = {
    role: "assistant" as const,
    title: "分析中",
    content: "streaming...",
    streaming: true,
    stepStates: [
      {
        kind: "llm" as const,
        required: true,
        note: "生成最终报告",
        status: "running" as const,
      },
    ],
  };
  const finalMessage = {
    role: "assistant" as const,
    title: "分析结果",
    content: "最终答案",
    stepStates: [],
  };

  const merged = mergeAssistantFinalMessage(pending, finalMessage);

  assert.equal(Array.isArray(merged.stepStates), true);
  assert.equal(merged.stepStates?.length, 0);
});

test("clampStreamingAssistantContent keeps short streamed text unchanged", () => {
  const text = "正在为你分析点亮 LED 的基础电路。";
  const next = clampStreamingAssistantContent("", text);
  assert.equal(next, text);
});

test("clampStreamingAssistantContent strips partial final control payload leaked during streaming", () => {
  const message = {
    role: "assistant" as const,
    title: "处理中",
    content: "",
    streaming: true,
  };

  applyStreamingAssistantContentDelta(message, "这是一个简单的点亮 LED 电路。\n\n", "append");
  applyStreamingAssistantContentDelta(message, "{\n", "append");
  applyStreamingAssistantContentDelta(message, '  "type"', "append");
  applyStreamingAssistantContentDelta(message, ': "final"', "append");

  assert.equal(message.content, "这是一个简单的点亮 LED 电路。");
});

test("mergeStreamProcessFields does not append reasoning delta twice when iteration step already contains it", () => {
  const message: NonNullable<MainPanelState["chatMessages"]>[number] = {
    role: "assistant",
    title: "分析中",
    content: "",
    streaming: true,
    iterationSteps: [
      {
        id: "react-iteration-1",
        iteration: 1,
        status: "running",
        thoughtText: "Let",
        toolEvents: [],
        observationTexts: [],
        streaming: true,
      },
    ],
  };

  mergeStreamProcessFields({
    lastMessage: message,
    reasoningDelta: "Let",
    iterationSteps: [
      {
        id: "react-iteration-1",
        iteration: 1,
        status: "running",
        thoughtText: "Let",
        toolEvents: [],
        observationTexts: [],
        streaming: true,
      },
    ],
  });

  assert.equal(message.iterationSteps?.[0]?.thoughtText, "Let");
});

test("mergeStreamProcessFields upserts lightweight iteration step without dropping prior steps", () => {
  const message: NonNullable<MainPanelState["chatMessages"]>[number] = {
    role: "assistant",
    title: "分析中",
    content: "",
    streaming: true,
    iterationSteps: [
      {
        id: "react-iteration-1",
        iteration: 1,
        status: "done",
        thoughtText: "one",
        toolEvents: [],
        observationTexts: [],
      },
      {
        id: "react-iteration-2",
        iteration: 2,
        status: "running",
        thoughtText: "two",
        toolEvents: [],
        observationTexts: [],
      },
    ],
  };

  mergeStreamProcessFields({
    lastMessage: message,
    reasoningDelta: " x",
    iterationSteps: [
      {
        id: "react-iteration-2",
        iteration: 2,
        status: "running",
        thoughtText: "two x",
        toolEvents: [],
        observationTexts: [],
        streaming: true,
      },
    ],
  });

  assert.equal(message.iterationSteps?.length, 2);
  assert.equal(message.iterationSteps?.[0]?.iteration, 1);
  assert.equal(message.iterationSteps?.[1]?.iteration, 2);
  assert.equal(message.iterationSteps?.[1]?.thoughtText, "two x");
  assert.equal(message.iterationSteps?.[1]?.streaming, true);
});

test("mergeStreamProcessFields applies analysis text stream to the active iteration step without mirroring body text", () => {
  const message: NonNullable<MainPanelState["chatMessages"]>[number] = {
    role: "assistant",
    title: "分析中",
    content: "",
    streaming: true,
    iterationSteps: [
      {
        id: "react-iteration-8",
        iteration: 8,
        status: "running",
        thoughtText: "正在分析",
        toolEvents: [],
        observationTexts: [],
        streaming: true,
      },
    ],
  };

  mergeStreamProcessFields({
    lastMessage: message,
    text: "正在分析当前电源拓扑并定位关键路径",
    iterationSteps: [
      {
        id: "react-iteration-8",
        iteration: 8,
        status: "running",
        thoughtText: "正在分析当前电源拓扑并定位关键路径",
        toolEvents: [],
        observationTexts: [],
        streaming: true,
      },
    ],
  });

  assert.equal(message.content, "");
  assert.equal(message.iterationSteps?.[0]?.thoughtText, "正在分析当前电源拓扑并定位关键路径");
});

test("shouldMirrorStreamingTextToAssistantBody keeps plain natural chat streaming in the assistant body", () => {
  assert.equal(
    shouldMirrorStreamingTextToAssistantBody({
      route: "chat",
      hasStepItems: false,
      hasIterationSteps: false,
      hasReactEvents: false,
      hasReasoningDelta: false,
    }),
    true
  );
});

test("shouldMirrorStreamingTextToAssistantBody suppresses ReAct step tokens even when route is chat", () => {
  assert.equal(
    shouldMirrorStreamingTextToAssistantBody({
      route: "chat",
      hasStepItems: false,
      hasIterationSteps: true,
      hasReactEvents: false,
      hasReasoningDelta: false,
    }),
    false
  );
});

test("shouldMirrorStreamingTextToAssistantBody suppresses duplicate body streaming for draft reasoning when steps are present", () => {
  assert.equal(
    shouldMirrorStreamingTextToAssistantBody({
      route: "draft",
      hasStepItems: false,
      hasIterationSteps: true,
      hasReactEvents: false,
      hasReasoningDelta: true,
    }),
    false
  );
});

test("shouldMirrorStreamingTextToAssistantBody suppresses raw draft token streaming even without steps", () => {
  assert.equal(
    shouldMirrorStreamingTextToAssistantBody({
      route: "draft",
      hasStepItems: false,
      hasIterationSteps: false,
      hasReactEvents: false,
      hasReasoningDelta: false,
    }),
    false
  );
});

test("shouldSanitizeFullStreamingText only sanitizes full text when it will be mirrored", () => {
  assert.equal(shouldSanitizeFullStreamingText({ route: "chat", mirrorTextToBody: true }), true);
  assert.equal(shouldSanitizeFullStreamingText({ route: "draft", mirrorTextToBody: false }), false);
  assert.equal(shouldSanitizeFullStreamingText({ route: "analysis", mirrorTextToBody: false }), false);
  assert.equal(shouldSanitizeFullStreamingText({ route: "modify", mirrorTextToBody: false }), false);
});

test("isPerfDebugEnabled reads the global flag dynamically", () => {
  const runtime = globalThis as typeof globalThis & { __LCEDA_AI_PERF_DEBUG__?: boolean };
  const previous = runtime.__LCEDA_AI_PERF_DEBUG__;
  runtime.__LCEDA_AI_PERF_DEBUG__ = true;
  assert.equal(isPerfDebugEnabled(), true);
  runtime.__LCEDA_AI_PERF_DEBUG__ = false;
  assert.equal(isPerfDebugEnabled(), false);
  runtime.__LCEDA_AI_PERF_DEBUG__ = previous;
});

test("isPerfDebugEnabled also reads the localStorage flag when available", () => {
  const runtime = globalThis as typeof globalThis & {
    __LCEDA_AI_PERF_DEBUG__?: boolean;
    localStorage?: { getItem(key: string): string | null };
  };
  const previousFlag = runtime.__LCEDA_AI_PERF_DEBUG__;
  const previousStorage = runtime.localStorage;
  runtime.__LCEDA_AI_PERF_DEBUG__ = false;
  runtime.localStorage = {
    getItem(key: string) {
      return key === "lceda_ai.perf_debug" ? "1" : null;
    },
  };
  assert.equal(isPerfDebugEnabled(), true);
  runtime.__LCEDA_AI_PERF_DEBUG__ = previousFlag;
  runtime.localStorage = previousStorage;
});

test("shouldApplyStreamingReactEvents skips react events when stepItems are present", () => {
  assert.equal(
    shouldApplyStreamingReactEvents({
      reactEvents: [{ kind: "thought" as const, text: "x" }],
      stepItems: [{ id: "step-1", phase: "llm" as const, type: "thought" as const, status: "running" as const, title: "t", text: "x" }],
      iterationSteps: undefined,
    }),
    false
  );
});

test("shouldApplyStreamingReactEvents skips react events when iterationSteps are present", () => {
  assert.equal(
    shouldApplyStreamingReactEvents({
      reactEvents: [{ kind: "thought" as const, text: "x" }],
      stepItems: undefined,
      iterationSteps: [{ id: "react-iteration-1", iteration: 1, status: "running" as const, thoughtText: "x", toolEvents: [], observationTexts: [] }],
    }),
    false
  );
});

test("shouldApplyStreamingReactEvents keeps react events only when no structured step payload exists", () => {
  assert.equal(
    shouldApplyStreamingReactEvents({
      reactEvents: [{ kind: "thought" as const, text: "x" }],
      stepItems: undefined,
      iterationSteps: undefined,
    }),
    true
  );
});

test("buildStreamingProcessSignature is stable for identical tail state", () => {
  const signature = buildStreamingProcessSignature({
    stepItems: undefined,
    iterationSteps: [
      {
        id: "react-iteration-7",
        iteration: 7,
        status: "running" as const,
        thoughtText: "abc",
        toolEvents: [],
        observationTexts: [],
      },
    ],
    reactEvents: undefined,
    stepStates: undefined,
    workingMemory: undefined,
  });
  assert.equal(
    signature,
    buildStreamingProcessSignature({
      stepItems: undefined,
      iterationSteps: [
        {
          id: "react-iteration-7",
          iteration: 7,
          status: "running" as const,
          thoughtText: "abc",
          toolEvents: [],
          observationTexts: [],
        },
      ],
      reactEvents: undefined,
      stepStates: undefined,
      workingMemory: undefined,
    })
  );
});

test("buildStreamingProcessSignature detects cloned iteration step changes even when source object is later mutated", () => {
  const sharedStep = {
    id: "react-iteration-7",
    iteration: 7,
    status: "running" as const,
    thoughtText: "abc",
    toolEvents: [],
    observationTexts: [],
  };
  const previousSnapshot = structuredClone
    ? structuredClone([sharedStep])
    : JSON.parse(JSON.stringify([sharedStep]));
  const previousSignature = buildStreamingProcessSignature({
    stepItems: undefined,
    iterationSteps: previousSnapshot,
    reactEvents: undefined,
    stepStates: undefined,
    workingMemory: undefined,
  });

  sharedStep.thoughtText = "abcd";

  const nextSignature = buildStreamingProcessSignature({
    stepItems: undefined,
    iterationSteps: [sharedStep],
    reactEvents: undefined,
    stepStates: undefined,
    workingMemory: undefined,
  });

  assert.notEqual(previousSignature, nextSignature);
});

test("limitStreamProcessItems trims old process events before streaming state commit", () => {
  const oldStepItems = Array.from({ length: 90 }, (_, index) => ({
    id: `old-${index}`,
    phase: "llm" as const,
    type: "thought" as const,
    status: "done" as const,
    title: `old-${index}`,
    text: `old-${index}`,
  }));
  const newStepItems = [
    ...oldStepItems,
    {
      id: "latest",
      phase: "llm" as const,
      type: "thought" as const,
      status: "running" as const,
      title: "latest",
      text: "latest",
    },
  ];

  const limited = limitStreamProcessItems({ stepItems: newStepItems });
  assert.equal(limited.stepItems?.length, 80);
  assert.equal(limited.stepItems?.[0]?.id, "old-11");
  assert.equal(limited.stepItems?.[79]?.id, "latest");
});

test("clampStreamingAssistantContent keeps oversized streamed text unchanged", () => {
  const chunk = "A".repeat(9000);
  const next = clampStreamingAssistantContent("", chunk);
  assert.equal(next, chunk);
});

test("upsertLlmReasoningStepItem fills the active llm thought step item with streamed reasoning text", () => {
  const message = {
    role: "assistant" as const,
    title: "分析中",
    content: "正在思考...",
    stepItems: [
      {
        id: "react-task-1",
        phase: "llm" as const,
        type: "task" as const,
        status: "running" as const,
        title: "迭代 1",
        text: "ReAct 第 1/10 轮",
      },
      {
        id: "react-thought-1",
        phase: "llm" as const,
        type: "thought" as const,
        status: "running" as const,
        title: "迭代 1-thought",
        text: "",
        streaming: true,
      },
    ],
  } as const;

  (message as typeof message & { __llmReasoningText?: string }).__llmReasoningText = "先检查上下文，再决定是否调用工具。";

  upsertLlmReasoningStepItem(message);

  assert.equal(message.stepItems[1]?.type, "thought");
  assert.equal(message.stepItems[1]?.text, "先检查上下文，再决定是否调用工具。");
  assert.equal(message.stepItems[1]?.streaming, true);
});

test("stripFinalControlLikeText removes fenced final payload from UI text", () => {
  assert.equal(
    stripFinalControlLikeText("先输出概览。\n\n```json\n{\n  \"type\": \"final\",\n  \"route\": \"analysis\"\n}"),
    "先输出概览。"
  );
});

test("stripFinalControlLikeText removes split final control prefix", () => {
  assert.equal(stripFinalControlLikeText("{\n\"type\""), "");
});

test("applyCustomLlmConfigSavedState keeps existing chat messages and uses toast instead", () => {
  const state = {
    chatMessages: [
      { role: "user" as const, title: "你", content: "之前的对话" },
      { role: "assistant" as const, title: "分析结果", content: "这里已经有内容" },
    ],
    summary: "旧状态",
  } as MainPanelState;

  const next = applyCustomLlmConfigSavedState(state, 123);

  assert.equal(next.summary, "自定义 LLM 配置已保存。");
  assert.equal(next.toast?.id, 123);
  assert.equal(next.toast?.message, "自定义 LLM 配置已保存。");
  assert.equal(next.chatMessages?.length, 2);
  assert.equal(next.chatMessages?.[0]?.content, "之前的对话");
  assert.equal(next.chatMessages?.[1]?.content, "这里已经有内容");
});

test("buildDraftApplyUnavailableMessage explains adapter source and missing apply capability", () => {
  const message = buildDraftApplyUnavailableMessage({
    adapterSource: "host",
    capabilityReport: {
      channel: "professional",
      available: true,
      missing: [],
      optionalMissing: ["applyPlan", "rollbackApplyPlan"],
    },
  });

  assert.equal(
    message,
    "应用草案失败：宿主未真正执行原理图应用。当前适配器来源：host；缺少能力：applyPlan、rollbackApplyPlan。请先检查宿主 applyPlan 能力是否已接通。"
  );
});

test("getAssistantCardLayout places the final report after expanded steps when execution is complete", () => {
  const layout = getAssistantCardLayout({
    streaming: false,
    hasThinking: false,
    hasSteps: true,
    hasReport: true,
    stepsOpen: true,
  });

  assert.deepEqual(layout.sectionOrder, ["header", "steps", "report"]);
  assert.equal(layout.showSteps, true);
  assert.equal(layout.showReport, true);
  assert.equal(layout.useSplitLayout, false);
});

test("getAssistantCardLayout hides steps and keeps only the final report when execution is complete and collapsed", () => {
  const layout = getAssistantCardLayout({
    streaming: false,
    hasThinking: false,
    hasSteps: true,
    hasReport: true,
    stepsOpen: false,
  });

  assert.deepEqual(layout.sectionOrder, ["header", "report"]);
  assert.equal(layout.showSteps, false);
  assert.equal(layout.showReport, true);
  assert.equal(layout.reportFillsRemainingHeight, true);
});

test("getAssistantCardLayout hides report while execution is still streaming", () => {
  const layout = getAssistantCardLayout({
    streaming: true,
    hasThinking: true,
    hasSteps: false,
    hasReport: true,
    stepsOpen: true,
  });

  assert.deepEqual(layout.sectionOrder, ["header", "thinking"]);
  assert.equal(layout.showThinking, true);
  assert.equal(layout.showReport, false);
  assert.equal(layout.useSplitLayout, true);
  assert.equal(layout.reportFillsRemainingHeight, false);
});

test("getAssistantCardLayout keeps both thinking and steps visible while streaming", () => {
  const layout = getAssistantCardLayout({
    streaming: true,
    hasThinking: true,
    hasSteps: true,
    hasReport: false,
    stepsOpen: true,
  });

  assert.deepEqual(layout.sectionOrder, ["header", "steps", "thinking"]);
  assert.equal(layout.showThinking, true);
  assert.equal(layout.showSteps, true);
  assert.equal(layout.useSplitLayout, true);
});

test("draftPreview state shape preserves selected device and guidance details", () => {
  const draftPreview: MainPanelState["draftPreview"] = {
    title: "5V LED Indicator Draft",
    rationale: "Generated a minimal LED indicator draft based on the user request.",
    componentRefs: ["J1", "R1", "D1"],
    netNames: ["5V", "LED_ANODE", "GND"],
    componentCount: 3,
    netCount: 3,
    selectedDeviceDetails: ["power_connector: CONN_1X2 [HDR-TH_1X2]"],
    guidanceSummary: {
      templateId: "led_indicator_minimal",
      rationale: "依据知识库模板，推荐使用 2Pin 电源口 + 150Ω + 红色 LED。",
      evidence: ["LED indicator：推荐使用 2Pin header、150Ω 限流电阻、红色 LED。 (kb://led_indicator)"],
    },
  };

  assert.equal(draftPreview.selectedDeviceDetails?.[0], "power_connector: CONN_1X2 [HDR-TH_1X2]");
  assert.equal(draftPreview.guidanceSummary?.templateId, "led_indicator_minimal");
});

test("device picker items can carry manual query ui state", () => {
  const state: MainPanelState = {
    loggedIn: true,
    devicePicker: {
      open: true,
      items: [
        {
          componentId: "draft-u1",
          componentRef: "U1",
          role: "generic",
          status: "unresolved",
          manualQueryExpanded: true,
          manualQueryDraft: "STM32F103C8T6",
        },
      ],
    },
  };

  assert.equal(state.devicePicker?.items[0]?.manualQueryExpanded, true);
  assert.equal(state.devicePicker?.items[0]?.manualQueryDraft, "STM32F103C8T6");
});

test("openDevicePicker keeps existing candidates after picker state rebuild", async () => {
  const runtimeGlobals = globalThis as typeof globalThis & {
    LCEDA_HOST_BRIDGE?: HostEditorBridge;
    __LCEDA_AI_ASSISTANT_RUNTIME__?: ReturnType<typeof getAssistantRuntime>;
    localStorage?: Storage;
  };
  const previousBridge = runtimeGlobals.LCEDA_HOST_BRIDGE;
  const previousRuntime = runtimeGlobals.__LCEDA_AI_ASSISTANT_RUNTIME__;
  const previousStorage = runtimeGlobals.localStorage;

  const storageMap = new Map<string, string>();
  runtimeGlobals.localStorage = {
    getItem: (key: string) => storageMap.get(key) ?? null,
    setItem: (key: string, value: string) => {
      storageMap.set(key, String(value));
    },
    removeItem: (key: string) => {
      storageMap.delete(key);
    },
    clear: () => {
      storageMap.clear();
    },
    key: (index: number) => Array.from(storageMap.keys())[index] ?? null,
    get length() {
      return storageMap.size;
    },
  } as Storage;

  runtimeGlobals.LCEDA_HOST_BRIDGE = {
    getChannel: () => "professional",
    isAvailable: () => true,
    getCurrentContext: async () => ({
      project: { channel: "professional", projectId: "p1", pageId: "pg1", pageName: "P1" },
      selection: { objectIds: [] },
      components: [],
      pins: [],
      nets: [],
    }),
    getSelection: async () => ({ objectIds: [] }),
    locate: async () => {},
  };

  try {
    const runtime = getAssistantRuntime();
    await runtime.openPanel();
    const state = runtime.getLastState() as MainPanelState & { draftPlan?: DraftPlan };
    state.draftPlan = {
      title: "device picker preserve",
      rationale: "test",
      components: [
        {
          id: "draft-u1",
          ref: "U1",
          name: "IP5306",
          value: "IP5306",
          properties: {
            preferred_search_query: "IP5306",
            device_resolution_status: "unresolved",
            device_resolution_reason: "manual",
          },
        } as any,
      ],
      pins: [],
      nets: [],
    };
    state.devicePicker = {
      open: true,
      items: [
        {
          componentId: "draft-u1",
          componentRef: "U1",
          role: "ldo_regulator",
          roleLabel: "稳压/电源器件",
          query: "IP5306",
          status: "unresolved",
          attemptedQueries: ["IP5306"],
          searchDiagnostics: {
            route: "query_search",
            normalizedCount: 1,
          },
          candidates: [
            {
              uuid: "49a464100aba46e28c3d78994480a888",
              name: "IP5306",
              libraryUuid: "0819f05c4eef4c71ace90d822a990e87",
              supplierId: "C181692",
              footprintName: "ESOP-8",
              manufacturer: "INJOINIC(英集芯)",
              description: "电池管理",
              ...buildDevicePickerCandidatePresentation(
                { role: inferDraftComponentRole("U1"), query: "IP5306" },
                {
                  uuid: "49a464100aba46e28c3d78994480a888",
                  name: "IP5306",
                  libraryUuid: "0819f05c4eef4c71ace90d822a990e87",
                  supplierId: "C181692",
                  footprintName: "ESOP-8",
                  manufacturer: "INJOINIC(英集芯)",
                  description: "电池管理",
                } as any,
                0
              ),
            },
          ],
        },
      ],
    };

    const reopened = await runtime.openDevicePicker();
    assert.equal(reopened.devicePicker?.items[0]?.candidates?.length, 1);
    assert.equal(reopened.devicePicker?.items[0]?.candidates?.[0]?.name, "IP5306");
    assert.equal(reopened.devicePicker?.items[0]?.searchDiagnostics?.normalizedCount, 1);
  } finally {
    runtimeGlobals.LCEDA_HOST_BRIDGE = previousBridge;
    runtimeGlobals.__LCEDA_AI_ASSISTANT_RUNTIME__ = previousRuntime;
    runtimeGlobals.localStorage = previousStorage;
  }
});

test("choosing the final unresolved device updates draft message action to apply draft", async () => {
  const runtimeGlobals = globalThis as typeof globalThis & {
    LCEDA_HOST_BRIDGE?: HostEditorBridge;
    __LCEDA_AI_ASSISTANT_RUNTIME__?: ReturnType<typeof getAssistantRuntime>;
    localStorage?: Storage;
  };
  const previousBridge = runtimeGlobals.LCEDA_HOST_BRIDGE;
  const previousRuntime = runtimeGlobals.__LCEDA_AI_ASSISTANT_RUNTIME__;
  const previousStorage = runtimeGlobals.localStorage;

  const storageMap = new Map<string, string>();
  runtimeGlobals.localStorage = {
    getItem: (key: string) => storageMap.get(key) ?? null,
    setItem: (key: string, value: string) => {
      storageMap.set(key, String(value));
    },
    removeItem: (key: string) => {
      storageMap.delete(key);
    },
    clear: () => {
      storageMap.clear();
    },
    key: (index: number) => Array.from(storageMap.keys())[index] ?? null,
    get length() {
      return storageMap.size;
    },
  } as Storage;

  runtimeGlobals.LCEDA_HOST_BRIDGE = {
    getChannel: () => "professional",
    isAvailable: () => true,
    getCurrentContext: async () => ({
      project: { channel: "professional", projectId: "p1", pageId: "pg1", pageName: "P1" },
      selection: { objectIds: [] },
      components: [],
      pins: [],
      nets: [],
    }),
    getSelection: async () => ({ objectIds: [] }),
    locate: async () => {},
    getLibraryDevice: async () => ({
      uuid: "49a464100aba46e28c3d78994480a888",
      pins: [],
    }),
  };

  try {
    const runtime = getAssistantRuntime();
    await runtime.openPanel();
    const state = runtime.getLastState() as MainPanelState & { draftPlan?: DraftPlan };
    state.draftPlan = {
      title: "ip5306 draft",
      rationale: "test",
      components: [
        {
          id: "draft-u1",
          ref: "U1",
          name: "IP5306",
          value: "IP5306",
          properties: {
            preferred_search_query: "IP5306",
            device_resolution_status: "unresolved",
            device_resolution_reason: "manual",
          },
        } as any,
      ],
      pins: [],
      nets: [],
    };
    state.draftPreview = {
      title: "ip5306 draft",
      rationale: "test",
      componentRefs: ["U1"],
      netNames: [],
      componentCount: 1,
      netCount: 0,
      unresolvedDeviceDetails: ["U1：充放电管理，暂未自动匹配到可直接放置的器件。建议搜索：IP5306"],
    };
    state.devicePicker = {
      open: true,
      items: [
        {
          componentId: "draft-u1",
          componentRef: "U1",
          role: "charger_powerbank",
          roleLabel: "充放电管理",
          query: "IP5306",
          status: "unresolved",
          candidates: [
            {
              uuid: "49a464100aba46e28c3d78994480a888",
              name: "IP5306",
              libraryUuid: "0819f05c4eef4c71ace90d822a990e87",
              supplierId: "C181692",
              footprintName: "ESOP-8",
              manufacturer: "INJOINIC(英集芯)",
            },
          ],
        },
      ],
    };
    state.chatMessages = [
      {
        role: "assistant",
        title: "草案草图",
        tone: "success",
        content: "我已经生成一版草案。\n\n当前可用操作：选择器件",
        structuredContent: [{ kind: "paragraph", text: "结构化草案内容" }],
        actions: [{ label: "选择器件", action: "select_devices" }],
      },
    ];
    await runtime.openDevicePicker();

    const updated = await runtime.chooseDraftDeviceCandidate({
      componentId: "draft-u1",
      candidateIndex: 0,
    });
    const lastMessage = updated.chatMessages?.at(-1);

    assert.equal(hasUnresolvedDraftDevices(updated.draftPlan), false);
    assert.equal(lastMessage?.actions?.some((item) => item.action === "apply_draft"), true);
    assert.equal(lastMessage?.actions?.some((item) => item.action === "select_devices"), false);
    assert.match(lastMessage?.content ?? "", /应用草案/);
    assert.match(lastMessage?.content ?? "", /器件确认状态/);
    assert.deepEqual(lastMessage?.structuredContent, [{ kind: "paragraph", text: "结构化草案内容" }]);
  } finally {
    runtimeGlobals.LCEDA_HOST_BRIDGE = previousBridge;
    runtimeGlobals.__LCEDA_AI_ASSISTANT_RUNTIME__ = previousRuntime;
    runtimeGlobals.localStorage = previousStorage;
  }
});

test("device picker role labels prefer explicit draft component roles over U-prefix fallback", async () => {
  const runtimeGlobals = globalThis as typeof globalThis & {
    LCEDA_HOST_BRIDGE?: HostEditorBridge;
    __LCEDA_AI_ASSISTANT_RUNTIME__?: ReturnType<typeof getAssistantRuntime>;
    localStorage?: Storage;
  };
  const previousBridge = runtimeGlobals.LCEDA_HOST_BRIDGE;
  const previousRuntime = runtimeGlobals.__LCEDA_AI_ASSISTANT_RUNTIME__;
  const previousStorage = runtimeGlobals.localStorage;
  const storageMap = new Map<string, string>();
  runtimeGlobals.localStorage = {
    getItem: (key: string) => storageMap.get(key) ?? null,
    setItem: (key: string, value: string) => {
      storageMap.set(key, String(value));
    },
    removeItem: (key: string) => {
      storageMap.delete(key);
    },
    clear: () => {
      storageMap.clear();
    },
    key: (index: number) => Array.from(storageMap.keys())[index] ?? null,
    get length() {
      return storageMap.size;
    },
  } as Storage;
  runtimeGlobals.LCEDA_HOST_BRIDGE = {
    getChannel: () => "standard",
    isAvailable: async () => true,
    getCapabilityReport: () => ({
      channel: "standard",
      available: true,
      missing: [],
      optionalMissing: [],
    }),
    getCurrentContext: async () => ({
      project: { channel: "standard", projectId: "p1", projectName: "demo", pageId: "page-role", pageName: "Sheet 1" },
      components: [],
      pins: [],
      nets: [],
      selection: { objectIds: [] },
    }),
    getSelection: async () => ({ objectIds: [] }),
    locate: async () => {},
  };

  try {
    const runtime = getAssistantRuntime();
    await runtime.openPanel();
    const state = runtime.getLastState();
    assert.ok(state);
    state.draftPlan = {
      title: "voice",
      rationale: "test",
      components: [
        {
          id: "draft-u4",
          ref: "U4",
          name: "INMP441",
          value: "INMP441",
          properties: {
            role: "microphone",
            preferred_search_query: "INMP441 I2S MEMS microphone",
            device_resolution_status: "unresolved",
          },
        },
      ],
      pins: [],
      nets: [],
    };

    const opened = await runtime.openDevicePicker();
    assert.equal(opened.devicePicker?.items[0]?.role, "microphone");
    assert.equal(opened.devicePicker?.items[0]?.roleLabel, "麦克风");
  } finally {
    runtimeGlobals.LCEDA_HOST_BRIDGE = previousBridge;
    runtimeGlobals.__LCEDA_AI_ASSISTANT_RUNTIME__ = previousRuntime;
    runtimeGlobals.localStorage = previousStorage;
  }
});

test("device picker search calls keyword search before LCSC fallback and merges both result sets", async () => {
  const runtimeGlobals = globalThis as typeof globalThis & {
    LCEDA_HOST_BRIDGE?: HostEditorBridge;
    __LCEDA_AI_ASSISTANT_RUNTIME__?: ReturnType<typeof getAssistantRuntime>;
    localStorage?: Storage;
  };
  const previousBridge = runtimeGlobals.LCEDA_HOST_BRIDGE;
  const previousRuntime = runtimeGlobals.__LCEDA_AI_ASSISTANT_RUNTIME__;
  const previousStorage = runtimeGlobals.localStorage;

  const storageMap = new Map<string, string>();
  runtimeGlobals.localStorage = {
    getItem: (key: string) => storageMap.get(key) ?? null,
    setItem: (key: string, value: string) => {
      storageMap.set(key, String(value));
    },
    removeItem: (key: string) => {
      storageMap.delete(key);
    },
    clear: () => {
      storageMap.clear();
    },
    key: (index: number) => Array.from(storageMap.keys())[index] ?? null,
    get length() {
      return storageMap.size;
    },
  } as Storage;

  try {
    const runtime = getAssistantRuntime();
    runtimeGlobals.LCEDA_HOST_BRIDGE = {
      getChannel: () => "professional",
      isAvailable: async () => true,
      getCapabilityReport: () => ({
        channel: "professional",
        available: true,
        missing: [],
        optionalMissing: [],
      }),
      getCurrentContext: async () => ({
        project: { channel: "professional", projectId: "p1", projectName: "demo", pageId: "page-ip5306", pageName: "Sheet 1" },
        components: [],
        pins: [],
        nets: [],
        selection: { objectIds: [] },
      }),
      getSelection: async () => ({ objectIds: [] }),
      locate: async () => {},
      searchLibraryDevices: async () => ({
        success: true,
        code: 0,
        result: {
          lists: {
            lcsc: [
              {
                uuid: "ip5306-device",
                title: "IP5306",
                owner: { uuid: "0819f05c4eef4c71ace90d822a990e87" },
                product_code: "C181692",
                attributes: {
                  "Supplier Part": "C181692",
                  "Manufacturer": "INJOINIC(英集芯)",
                  "Supplier Footprint": "ESOP-8",
                },
              },
              {
                uuid: "ip5306-alt-device",
                title: "IP5306-variant",
                owner: { uuid: "0819f05c4eef4c71ace90d822a990e87" },
                product_code: "C999999",
                attributes: {
                  "Supplier Part": "C999999",
                  "Manufacturer": "INJOINIC(英集芯)",
                  "Supplier Footprint": "ESOP-8",
                },
              },
            ],
          },
        },
      }) as unknown as Awaited<ReturnType<NonNullable<HostEditorBridge["searchLibraryDevices"]>>>,
      getLibraryDevicesByLcscIds: async () => [
        {
          uuid: "ip5306-device",
          name: "IP5306",
          libraryUuid: "0819f05c4eef4c71ace90d822a990e87",
          lcscId: "C181692",
          supplierId: "C181692",
          description: "power bank charge boost power management",
          footprint: {
            name: "ESOP-8",
          },
        },
      ],
    };

    await runtime.openPanel();
    const state = runtime.getLastState();
    assert.ok(state);
    state.draftPlan = {
      title: "power",
      rationale: "test",
      components: [
        {
          id: "draft-u2",
          ref: "U2",
          name: "IP5306",
          value: "IP5306",
          properties: {
            role: "charger_powerbank",
            preferred_search_query: "IP5306 lithium battery charge boost power management",
            device_resolution_status: "unresolved",
          },
        },
      ],
      pins: [],
      nets: [],
    };

    await runtime.openDevicePicker();
    const searched = await runtime.searchDraftDeviceCandidates("draft-u2", "IP5306");

    assert.equal(searched.devicePicker?.items[0]?.candidates?.length, 2);
    assert.equal(searched.devicePicker?.items[0]?.candidates?.[0]?.name, "IP5306");
    assert.equal(searched.devicePicker?.items[0]?.candidates?.[1]?.name, "IP5306-variant");
    assert.equal(searched.devicePicker?.items[0]?.searchDiagnostics?.route, "merged_search");
    assert.deepEqual(searched.devicePicker?.items[0]?.searchDiagnostics?.attemptedLcscIds, ["C181692"]);
    assert.equal(searched.devicePicker?.items[0]?.searchDiagnostics?.attemptedQueries?.[0], "IP5306");
  } finally {
    runtimeGlobals.LCEDA_HOST_BRIDGE = previousBridge;
    runtimeGlobals.__LCEDA_AI_ASSISTANT_RUNTIME__ = previousRuntime;
    runtimeGlobals.localStorage = previousStorage;
  }
});

test("resolveDraftDeviceSearchQuery prefers manual query over default", () => {
  assert.equal(
    resolveDraftDeviceSearchQuery({
      defaultQuery: "USB Type-C 16PIN",
      manualQuery: "  TYPE-C 母座 ",
    }),
    "TYPE-C 母座"
  );
});

test("resolveDraftDeviceSearchQuery falls back to default when manual query is blank", () => {
  assert.equal(
    resolveDraftDeviceSearchQuery({
      defaultQuery: "  KT-0805R  ",
      manualQuery: "   ",
    }),
    "KT-0805R"
  );
});

test("resolveDraftDeviceSearchQuery returns null when both manual and default queries are unavailable", () => {
  assert.equal(
    resolveDraftDeviceSearchQuery({
      defaultQuery: " ",
      manualQuery: "",
    }),
    null
  );
});

test("buildDraftDeviceSearchQueries adds role-based fallbacks for confusing LLM search targets", () => {
  assert.deepEqual(
    buildDraftDeviceSearchQueries({
      role: "ldo_regulator",
      defaultQuery: "3.3V LDO regulator 500mA",
    }),
    ["3.3V LDO regulator 500mA", "LDO regulator 500mA", "3.3V LDO", "ME6211", "XC6206", "AMS1117-3.3"]
  );

  assert.deepEqual(
    buildDraftDeviceSearchQueries({
      role: "microphone",
      defaultQuery: "INMP441 I2S MEMS microphone",
    }).slice(0, 4),
    ["INMP441 I2S MEMS microphone", "INMP441", "I2S MEMS microphone", "MEMS microphone"]
  );
});

test("updateDevicePickerManualQueryState only updates manual query fields for target item", () => {
  const picker: MainPanelState["devicePicker"] = {
    open: true,
    items: [
      {
        componentId: "draft-u1",
        componentRef: "U1",
        role: "ldo_regulator",
        status: "unresolved",
        query: "ME6211",
        manualQueryExpanded: false,
        manualQueryDraft: "",
      },
      {
        componentId: "draft-j1",
        componentRef: "J1",
        role: "power_connector",
        status: "unresolved",
        query: "USB Type-C 16PIN",
        manualQueryExpanded: true,
        manualQueryDraft: "Type-C 16PIN",
      },
    ],
  };

  const next = updateDevicePickerManualQueryState(picker, {
    componentId: "draft-u1",
    manualQueryExpanded: true,
    manualQueryDraft: "AMS1117-3.3",
  });

  assert.equal(next?.items[0]?.manualQueryExpanded, true);
  assert.equal(next?.items[0]?.manualQueryDraft, "AMS1117-3.3");
  assert.equal(next?.items[0]?.query, "ME6211");
  assert.equal(next?.items[1]?.manualQueryExpanded, true);
  assert.equal(next?.items[1]?.manualQueryDraft, "Type-C 16PIN");
  assert.equal(next?.items[1]?.query, "USB Type-C 16PIN");
});

test("manual query override state update does not mutate default query source", () => {
  const picker: MainPanelState["devicePicker"] = {
    open: true,
    items: [
      {
        componentId: "draft-d1",
        componentRef: "D1",
        role: "led",
        status: "unresolved",
        query: "KT-0805R",
      },
    ],
  };

  const next = updateDevicePickerManualQueryState(picker, {
    componentId: "draft-d1",
    manualQueryExpanded: true,
    manualQueryDraft: "LED 0805 红色",
  });

  assert.equal(next?.items[0]?.manualQueryDraft, "LED 0805 红色");
  assert.equal(next?.items[0]?.manualQueryExpanded, true);
  assert.equal(next?.items[0]?.query, "KT-0805R");
});

test("manual query override flow does not mutate draftPlan preferred_search_query source field", () => {
  const draftPlan = {
    title: "manual-query-override",
    rationale: "test",
    components: [
      {
        id: "draft-d1",
        ref: "D1",
        properties: {
          preferred_search_query: "KT-0805R",
        },
      },
    ],
    pins: [],
    nets: [],
  } as DraftPlan;

  const originalPreferredQuery = draftPlan.components[0]?.properties?.preferred_search_query;
  const picker: MainPanelState["devicePicker"] = {
    open: true,
    items: [
      {
        componentId: "draft-d1",
        componentRef: "D1",
        role: "led",
        status: "unresolved",
        query: draftPlan.components[0]?.properties?.preferred_search_query,
      },
    ],
  };

  const nextPicker = updateDevicePickerManualQueryState(picker, {
    componentId: "draft-d1",
    manualQueryExpanded: true,
    manualQueryDraft: "LED 0805 红色",
  });
  const resolvedQuery = resolveDraftDeviceSearchQuery({
    defaultQuery: draftPlan.components[0]?.properties?.preferred_search_query,
    manualQuery: nextPicker?.items[0]?.manualQueryDraft,
  });

  assert.equal(resolvedQuery, "LED 0805 红色");
  assert.equal(draftPlan.components[0]?.properties?.preferred_search_query, originalPreferredQuery);
  assert.equal(draftPlan.components[0]?.properties?.preferred_search_query, "KT-0805R");
});

test("resolveDevicePickerManualQueryStateForSearch keeps manual override when previous picker item is missing", () => {
  const state = resolveDevicePickerManualQueryStateForSearch({
    item: {
      componentId: "draft-u1",
      componentRef: "U1",
      role: "ldo_regulator",
      status: "unresolved",
    },
    previousItem: undefined,
    manualQuery: "AMS1117-3.3",
  });

  assert.equal(state.manualQueryExpanded, true);
  assert.equal(state.manualQueryDraft, "AMS1117-3.3");
});

test("hasUnresolvedDraftDevices returns true when draft contains unresolved components", () => {
  assert.equal(
    hasUnresolvedDraftDevices({
      title: "draft",
      rationale: "",
      components: [
        {
          id: "draft-j1",
          properties: {
            device_resolution_status: "unresolved",
          },
        },
      ],
      pins: [],
      nets: [],
    } as any),
    true
  );
});

test("buildDevicePickerSearchProgressText returns expected progress text", () => {
  assert.equal(buildDevicePickerSearchProgressText(2, 5), "正在搜索待确认器件候选（2/5）...");
});

test("buildDevicePickerApplyProgressText returns expected progress text", () => {
  assert.equal(buildDevicePickerApplyProgressText(3, 7), "正在确认待确认器件（3/7）...");
});

test("buildDevicePickerRoleLabel humanizes internal role names", () => {
  assert.equal(buildDevicePickerRoleLabel("power_connector"), "电源输入接口");
  assert.equal(buildDevicePickerRoleLabel("battery_connector"), "电池接口");
  assert.equal(buildDevicePickerRoleLabel("ldo_regulator"), "稳压器");
  assert.equal(buildDevicePickerRoleLabel("generic"), "待确认器件");
});

test("inferDraftComponentRole recognizes LED-style refs instead of treating them as generic", () => {
  assert.equal(inferDraftComponentRole("LED1"), "led");
  assert.equal(inferDraftComponentRole("LED2"), "led");
  assert.equal(inferDraftComponentRole("D1"), "led");
  assert.equal(inferDraftComponentRole("BT1"), "battery_connector");
});

test("buildDevicePickerReasonLabel translates internal unresolved reasons into user-facing language", () => {
  assert.equal(
    buildDevicePickerReasonLabel({
      reason: "all_candidates_filtered",
      role: "power_connector",
      query: "USB Type-C 16PIN",
    }),
    "自动筛选后没有找到完全符合当前用途的器件，下面展示的是接近的候选。"
  );
  assert.equal(
    buildDevicePickerReasonLabel({
      reason: "unresolved",
      role: "battery_connector",
      query: "JST PH 2P",
    }),
    "还没有找到可直接确认的电池接口。"
  );
});

test("previewDraftPlan hides internal unresolved markers for battery connectors", () => {
  const preview = previewDraftPlan({
    title: "battery preview",
    rationale: "test",
    components: [
      {
        id: "draft-bt1",
        ref: "BT1",
        name: "Battery Connector",
        componentType: "part",
        addIntoBom: true,
        addIntoPcb: true,
        properties: {
          device_resolution_status: "unresolved",
          device_resolution_reason: "no_search_results",
          preferred_search_query: "JST PH 2P battery connector",
        },
      },
    ],
    pins: [],
    nets: [],
  } as any);

  assert.deepEqual(preview.unresolvedDeviceDetails, ["BT1：电池接口，暂未自动匹配到可直接放置的器件。建议搜索：JST PH 2P battery connector"]);
});

test("buildDevicePickerCandidatePresentation explains why a usb-c receptacle fits a power connector slot", () => {
  const presentation = buildDevicePickerCandidatePresentation(
    {
      role: "power_connector",
      query: "USB Type-C 16PIN",
    },
    {
      uuid: "cand-1",
      name: "TYPE-C16PIN母座 板上四脚三次molding",
      libraryUuid: "lib-1",
      footprintName: "USB-SMD_TYPE-C16PIN",
      supplierId: "C9900000202",
      description: "Type-C receptacle connector",
    },
    1
  );

  assert.equal(presentation.fitLevel, "recommended");
  assert.equal(presentation.fitLabel, "较匹配");
  assert.equal(presentation.typeLabel, "USB Type-C 接口");
  assert.equal(
    presentation.summary,
    "可作为电源输入接口使用，和当前“USB Type-C 16PIN”的查询目标基本一致。"
  );
  assert.equal(
    presentation.reasons.includes("接口外形与查询目标接近，更可能适合作为当前接口位。"),
    true
  );
});

test("normalizeDevicePickerCandidates unwraps wrapped host payload and maps title-based fields", () => {
  const candidates = normalizeDevicePickerCandidates({
    success: true,
    code: 0,
    result: [
      {
        uuid: "8eee80085aeb4c14ba56d613c645ea4b",
        title: "rps6045-47mt",
        owner: {
          uuid: "0819f05c4eef4c71ace90d822a990e87",
          username: "LCSC",
          nickname: "LCSC",
        },
        description: "4.7uH power inductor",
      },
    ],
  });

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0]?.uuid, "8eee80085aeb4c14ba56d613c645ea4b");
  assert.equal(candidates[0]?.name, "rps6045-47mt");
  assert.equal(candidates[0]?.libraryUuid, "0819f05c4eef4c71ace90d822a990e87");
  assert.equal(candidates[0]?.description, "4.7uH power inductor");
});

test("normalizeDevicePickerCandidates unwraps LCEDA search payload lists", () => {
  const candidates = normalizeDevicePickerCandidates({
    success: true,
    code: 0,
    result: {
      facets: {
        lcsc: 8,
      },
      lists: {
        lcsc: [
          {
            uuid: "49a464100aba46e28c3d78994480a888",
            title: "ip5306",
            owner: {
              uuid: "0819f05c4eef4c71ace90d822a990e87",
              username: "LCSC",
              nickname: "LCSC",
            },
            description: "power bank charge boost power management",
          },
        ],
      },
    },
  });

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0]?.uuid, "49a464100aba46e28c3d78994480a888");
  assert.equal(candidates[0]?.name, "ip5306");
  assert.equal(candidates[0]?.libraryUuid, "0819f05c4eef4c71ace90d822a990e87");
});

test("normalizeDevicePickerCandidates handles raw LCEDA list objects and json strings", () => {
  const payload = JSON.stringify({
    success: true,
    code: 0,
    result: {
      lists: {
        lcsc: [
          {
            uuid: "3c7529e264044fad8ab981491bd5501c",
            creator: {
              uuid: "0819f05c4eef4c71ace90d822a990e87",
              username: "LCSC",
              nickname: "LCSC",
            },
            title: "xc6206p332mr-g",
            lcsc: "C5446",
            dataStr: "Low dropout voltage regulator",
          },
        ],
      },
    },
  });

  const candidates = normalizeDevicePickerCandidates(payload);

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0]?.uuid, "3c7529e264044fad8ab981491bd5501c");
  assert.equal(candidates[0]?.name, "xc6206p332mr-g");
  assert.equal(candidates[0]?.libraryUuid, "0819f05c4eef4c71ace90d822a990e87");
  assert.equal(candidates[0]?.supplierId, "C5446");
  assert.equal(candidates[0]?.description, "Low dropout voltage regulator");
});

test("normalizeDevicePickerCandidates reads symbol and footprint ids from searchByCodes-style attributes payload", () => {
  const candidates = normalizeDevicePickerCandidates({
    success: true,
    code: 0,
    result: [
      {
        uuid: "49a464100aba46e28c3d78994480a888",
        product_code: "C181692",
        attributes: {
          "Supplier Part": "C181692",
          "Manufacturer": "INJOINIC(英集芯)",
          "Manufacturer Part": "IP5306",
          "Supplier Footprint": "ESOP-8",
          "Symbol": "286af622b93c4ec5b0ad7c348ee7f8aa",
          "Footprint": "236714646ca442a4843d26e3285daa73",
          "LCSC Part Name": "集成2.1A充电器和2.1A放电器的移动电源系统级芯片",
        },
        footprint: {
          uuid: "236714646ca442a4843d26e3285daa73",
          title: "esop-8_l4.9-w3.9-p1.27-ls6.0-bl-ep",
          display_title: "ESOP-8_L4.9-W3.9-P1.27-LS6.0-BL-EP",
        },
      },
    ],
  });

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0]?.uuid, "49a464100aba46e28c3d78994480a888");
  assert.equal(candidates[0]?.supplierId, "C181692");
  assert.equal(candidates[0]?.symbolUuid, "286af622b93c4ec5b0ad7c348ee7f8aa");
  assert.equal(candidates[0]?.footprintUuid, "236714646ca442a4843d26e3285daa73");
  assert.equal(candidates[0]?.footprintName, "ESOP-8_L4.9-W3.9-P1.27-LS6.0-BL-EP");
  assert.match(String(candidates[0]?.description || ""), /系统级芯片/);
});

test("device picker lcsc detail candidates are kept even when detail payload omits libraryUuid", async () => {
  const runtimeGlobals = globalThis as typeof globalThis & {
    LCEDA_HOST_BRIDGE?: HostEditorBridge;
    __LCEDA_AI_ASSISTANT_RUNTIME__?: ReturnType<typeof getAssistantRuntime>;
    localStorage?: Storage;
  };
  const previousBridge = runtimeGlobals.LCEDA_HOST_BRIDGE;
  const previousRuntime = runtimeGlobals.__LCEDA_AI_ASSISTANT_RUNTIME__;
  const previousStorage = runtimeGlobals.localStorage;

  const storageMap = new Map<string, string>();
  runtimeGlobals.localStorage = {
    getItem: (key: string) => storageMap.get(key) ?? null,
    setItem: (key: string, value: string) => {
      storageMap.set(key, String(value));
    },
    removeItem: (key: string) => {
      storageMap.delete(key);
    },
    clear: () => {
      storageMap.clear();
    },
    key: (index: number) => Array.from(storageMap.keys())[index] ?? null,
    get length() {
      return storageMap.size;
    },
  } as Storage;

  try {
    const runtime = getAssistantRuntime();
    runtimeGlobals.LCEDA_HOST_BRIDGE = {
      getChannel: () => "professional",
      isAvailable: async () => true,
      getCapabilityReport: () => ({
        channel: "professional",
        available: true,
        missing: [],
        optionalMissing: [],
      }),
      getCurrentContext: async () => ({
        project: { channel: "professional", projectId: "p1", projectName: "demo", pageId: "page-ip5306", pageName: "Sheet 1" },
        components: [],
        pins: [],
        nets: [],
        selection: { objectIds: [] },
      }),
      getSelection: async () => ({ objectIds: [] }),
      locate: async () => {},
      searchLibraryDevices: async () => [],
      getLibraryDevicesByLcscIds: async () => [
        {
          uuid: "ip5306-device",
          name: "IP5306",
          lcscId: "C181692",
          supplierId: "C181692",
          description: "power bank charge boost power management",
          footprint: {
            name: "ESOP-8",
          },
        },
      ],
    };

    await runtime.openPanel();
    const state = runtime.getLastState();
    assert.ok(state);
    state.draftPlan = {
      title: "power",
      rationale: "test",
      components: [
        {
          id: "draft-u2",
          ref: "U2",
          name: "IP5306",
          value: "IP5306",
          properties: {
            role: "charger_powerbank",
            preferred_search_query: "IP5306",
            device_resolution_status: "unresolved",
          },
        },
      ],
      pins: [],
      nets: [],
    };

    await runtime.openDevicePicker();
    const searched = await runtime.searchDraftDeviceCandidates("draft-u2");

    assert.equal(searched.devicePicker?.items[0]?.candidates?.length, 1);
    assert.equal(searched.devicePicker?.items[0]?.candidates?.[0]?.name, "IP5306");
    assert.equal(searched.devicePicker?.items[0]?.candidates?.[0]?.supplierId, "C181692");
  } finally {
    runtimeGlobals.LCEDA_HOST_BRIDGE = previousBridge;
    runtimeGlobals.__LCEDA_AI_ASSISTANT_RUNTIME__ = previousRuntime;
    runtimeGlobals.localStorage = previousStorage;
  }
});

test("device picker query candidates can be enriched from getLibraryDevice when search payload misses library metadata", async () => {
  const runtimeGlobals = globalThis as typeof globalThis & {
    LCEDA_HOST_BRIDGE?: HostEditorBridge;
    __LCEDA_AI_ASSISTANT_RUNTIME__?: ReturnType<typeof getAssistantRuntime>;
    localStorage?: Storage;
  };
  const previousBridge = runtimeGlobals.LCEDA_HOST_BRIDGE;
  const previousRuntime = runtimeGlobals.__LCEDA_AI_ASSISTANT_RUNTIME__;
  const previousStorage = runtimeGlobals.localStorage;

  const storageMap = new Map<string, string>();
  runtimeGlobals.localStorage = {
    getItem: (key: string) => storageMap.get(key) ?? null,
    setItem: (key: string, value: string) => {
      storageMap.set(key, String(value));
    },
    removeItem: (key: string) => {
      storageMap.delete(key);
    },
    clear: () => {
      storageMap.clear();
    },
    key: (index: number) => Array.from(storageMap.keys())[index] ?? null,
    get length() {
      return storageMap.size;
    },
  } as Storage;

  try {
    const runtime = getAssistantRuntime();
    runtimeGlobals.LCEDA_HOST_BRIDGE = {
      getChannel: () => "professional",
      isAvailable: async () => true,
      getCapabilityReport: () => ({
        channel: "professional",
        available: true,
        missing: [],
        optionalMissing: [],
      }),
      getCurrentContext: async () => ({
        project: { channel: "professional", projectId: "p1", projectName: "demo", pageId: "page-typec", pageName: "Sheet 1" },
        components: [],
        pins: [],
        nets: [],
        selection: { objectIds: [] },
      }),
      getSelection: async () => ({ objectIds: [] }),
      locate: async () => {},
      searchLibraryDevices: async () => ({
        success: true,
        code: 0,
        result: {
          lists: {
            lcsc: [
              {
                uuid: "typec-device",
                title: "TYPE-C 16PIN",
                description: "usb type-c receptacle",
              },
            ],
          },
        },
      }) as unknown as Awaited<ReturnType<NonNullable<HostEditorBridge["searchLibraryDevices"]>>>,
      getLibraryDevice: async () => ({
        uuid: "typec-device",
        name: "TYPE-C 16PIN",
        libraryUuid: "0819f05c4eef4c71ace90d822a990e87",
        supplierId: "C2988369",
        description: "usb type-c receptacle",
        footprint: {
          name: "TYPE-C-SMD_16P",
        },
      }),
    };

    await runtime.openPanel();
    const state = runtime.getLastState();
    assert.ok(state);
    state.draftPlan = {
      title: "usb",
      rationale: "test",
      components: [
        {
          id: "draft-j1",
          ref: "J1",
          name: "USB-C",
          value: "TYPE-C",
          properties: {
            role: "power_connector",
            preferred_search_query: "USB Type-C",
            device_resolution_status: "unresolved",
          },
        },
      ],
      pins: [],
      nets: [],
    };

    await runtime.openDevicePicker();
    const searched = await runtime.searchDraftDeviceCandidates("draft-j1");

    assert.equal(searched.devicePicker?.items[0]?.candidates?.length, 1);
    assert.equal(searched.devicePicker?.items[0]?.candidates?.[0]?.libraryUuid, "0819f05c4eef4c71ace90d822a990e87");
    assert.equal(searched.devicePicker?.items[0]?.candidates?.[0]?.footprintName, "TYPE-C-SMD_16P");
    assert.equal(searched.devicePicker?.items[0]?.searchDiagnostics?.detailHits, 1);
  } finally {
    runtimeGlobals.LCEDA_HOST_BRIDGE = previousBridge;
    runtimeGlobals.__LCEDA_AI_ASSISTANT_RUNTIME__ = previousRuntime;
    runtimeGlobals.localStorage = previousStorage;
  }
});

test("device picker prefers structured property search when host supports it", async () => {
  const runtimeGlobals = globalThis as typeof globalThis & {
    LCEDA_HOST_BRIDGE?: HostEditorBridge;
    __LCEDA_AI_ASSISTANT_RUNTIME__?: ReturnType<typeof getAssistantRuntime>;
    localStorage?: Storage;
  };
  const previousBridge = runtimeGlobals.LCEDA_HOST_BRIDGE;
  const previousRuntime = runtimeGlobals.__LCEDA_AI_ASSISTANT_RUNTIME__;
  const previousStorage = runtimeGlobals.localStorage;

  const storageMap = new Map<string, string>();
  runtimeGlobals.localStorage = {
    getItem: (key: string) => storageMap.get(key) ?? null,
    setItem: (key: string, value: string) => {
      storageMap.set(key, String(value));
    },
    removeItem: (key: string) => {
      storageMap.delete(key);
    },
    clear: () => {
      storageMap.clear();
    },
    key: (index: number) => Array.from(storageMap.keys())[index] ?? null,
    get length() {
      return storageMap.size;
    },
  } as Storage;

  const propertyCalls: Array<Record<string, string>> = [];
  let queryCalls = 0;

  try {
    const runtime = getAssistantRuntime();
    runtimeGlobals.LCEDA_HOST_BRIDGE = {
      getChannel: () => "professional",
      isAvailable: async () => true,
      getCapabilityReport: () => ({
        channel: "professional",
        available: true,
        missing: [],
        optionalMissing: [],
      }),
      getCurrentContext: async () => ({
        project: { channel: "professional", projectId: "p1", projectName: "demo", pageId: "page-ip5306", pageName: "Sheet 1" },
        components: [],
        pins: [],
        nets: [],
        selection: { objectIds: [] },
      }),
      getSelection: async () => ({ objectIds: [] }),
      locate: async () => {},
      searchLibraryDevicesByProperties: async ({ properties }) => {
        propertyCalls.push(properties as Record<string, string>);
        return [
          {
            uuid: "ip5306-device",
            name: "IP5306",
            libraryUuid: "0819f05c4eef4c71ace90d822a990e87",
            footprintName: "ESOP-8",
            description: "charge boost power management",
            supplierId: "C181692",
          },
        ];
      },
      searchLibraryDevices: async () => {
        queryCalls += 1;
        return [];
      },
    };

    await runtime.openPanel();
    const state = runtime.getLastState();
    assert.ok(state);
    state.draftPlan = {
      title: "power",
      rationale: "test",
      components: [
        {
          id: "draft-u2",
          ref: "U2",
          name: "IP5306",
          value: "IP5306",
          properties: {
            role: "charger_powerbank",
            preferred_search_query: "IP5306 lithium battery charge boost power management",
            device_resolution_status: "unresolved",
          },
        },
      ],
      pins: [],
      nets: [],
    };

    await runtime.openDevicePicker();
    const searched = await runtime.searchDraftDeviceCandidates("draft-u2");

    assert.equal(searched.devicePicker?.items[0]?.candidates?.length, 1);
    assert.equal(searched.devicePicker?.items[0]?.searchDiagnostics?.route, "property_search");
    assert.equal(propertyCalls.length > 0, true);
    assert.equal(queryCalls > 0, true);
  } finally {
    runtimeGlobals.LCEDA_HOST_BRIDGE = previousBridge;
    runtimeGlobals.__LCEDA_AI_ASSISTANT_RUNTIME__ = previousRuntime;
    runtimeGlobals.localStorage = previousStorage;
  }
});

test("manual candidate selection persists resolved symbol and footprint ids from device detail", async () => {
  const runtimeGlobals = globalThis as typeof globalThis & {
    LCEDA_HOST_BRIDGE?: HostEditorBridge;
    __LCEDA_AI_ASSISTANT_RUNTIME__?: ReturnType<typeof getAssistantRuntime>;
    localStorage?: Storage;
  };
  const previousBridge = runtimeGlobals.LCEDA_HOST_BRIDGE;
  const previousRuntime = runtimeGlobals.__LCEDA_AI_ASSISTANT_RUNTIME__;
  const previousStorage = runtimeGlobals.localStorage;

  const storageMap = new Map<string, string>();
  runtimeGlobals.localStorage = {
    getItem: (key: string) => storageMap.get(key) ?? null,
    setItem: (key: string, value: string) => {
      storageMap.set(key, String(value));
    },
    removeItem: (key: string) => {
      storageMap.delete(key);
    },
    clear: () => {
      storageMap.clear();
    },
    key: (index: number) => Array.from(storageMap.keys())[index] ?? null,
    get length() {
      return storageMap.size;
    },
  } as Storage;

  try {
    const runtime = getAssistantRuntime();
    runtimeGlobals.LCEDA_HOST_BRIDGE = {
      getChannel: () => "professional",
      isAvailable: async () => true,
      getCapabilityReport: () => ({
        channel: "professional",
        available: true,
        missing: [],
        optionalMissing: [],
      }),
      getCurrentContext: async () => ({
        project: { channel: "professional", projectId: "p1", projectName: "demo", pageId: "page-ip5306", pageName: "Sheet 1" },
        components: [],
        pins: [],
        nets: [],
        selection: { objectIds: [] },
      }),
      getSelection: async () => ({ objectIds: [] }),
      locate: async () => {},
      searchLibraryDevices: async () => ({
        success: true,
        code: 0,
        result: {
          lists: {
            lcsc: [
              {
                uuid: "49a464100aba46e28c3d78994480a888",
                title: "ip5306",
                owner: { uuid: "0819f05c4eef4c71ace90d822a990e87" },
              },
            ],
          },
        },
      }) as unknown as Awaited<ReturnType<NonNullable<HostEditorBridge["searchLibraryDevices"]>>>,
      getLibraryDevice: async () => ({
        uuid: "49a464100aba46e28c3d78994480a888",
        name: "IP5306",
        libraryUuid: "0819f05c4eef4c71ace90d822a990e87",
        supplierId: "C181692",
        manufacturer: "INJOINIC",
        symbol: {
          uuid: "286af622b93c4ec5b0ad7c348ee7f8aa",
          name: "IP5306",
          libraryUuid: "0819f05c4eef4c71ace90d822a990e87",
        },
        footprint: {
          uuid: "236714646ca442a4843d26e3285daa73",
          name: "ESOP-8_L4.9-W3.9-P1.27-LS6.0-BL-EP",
          libraryUuid: "0819f05c4eef4c71ace90d822a990e87",
        },
        description: "charge boost power management",
      }),
    };

    await runtime.openPanel();
    const state = runtime.getLastState();
    assert.ok(state);
    state.draftPlan = {
      title: "power",
      rationale: "test",
      components: [
        {
          id: "draft-u2",
          ref: "U2",
          name: "IP5306",
          value: "IP5306",
          properties: {
            role: "charger_powerbank",
            preferred_search_query: "IP5306",
            device_resolution_status: "unresolved",
          },
        },
      ],
      pins: [],
      nets: [],
    };

    await runtime.openDevicePicker();
    const searched = await runtime.searchDraftDeviceCandidates("draft-u2");
    assert.equal(searched.devicePicker?.items[0]?.candidates?.[0]?.symbolUuid, "286af622b93c4ec5b0ad7c348ee7f8aa");
    assert.equal(searched.devicePicker?.items[0]?.candidates?.[0]?.footprintUuid, "236714646ca442a4843d26e3285daa73");

    const selected = await runtime.chooseDraftDeviceCandidate({ componentId: "draft-u2", candidateIndex: 0 });
    const component = selected.draftPlan?.components[0];
    assert.equal(component?.properties?.device_uuid, "49a464100aba46e28c3d78994480a888");
    assert.equal(component?.properties?.library_uuid, "0819f05c4eef4c71ace90d822a990e87");
    assert.equal(component?.properties?.symbol_uuid, "286af622b93c4ec5b0ad7c348ee7f8aa");
    assert.equal(component?.properties?.footprint_uuid, "236714646ca442a4843d26e3285daa73");
    assert.equal(selected.draftPlan?.selectedDevices?.[0]?.symbolUuid, "286af622b93c4ec5b0ad7c348ee7f8aa");
    assert.equal(selected.draftPlan?.selectedDevices?.[0]?.footprintUuid, "236714646ca442a4843d26e3285daa73");
  } finally {
    runtimeGlobals.LCEDA_HOST_BRIDGE = previousBridge;
    runtimeGlobals.__LCEDA_AI_ASSISTANT_RUNTIME__ = previousRuntime;
    runtimeGlobals.localStorage = previousStorage;
  }
});

test("deriveSessionHistoryEntries migrates last_state into history when session index is empty", () => {
  const lastState: MainPanelState = {
    loggedIn: true,
    sessionTitle: "LED 电源检查",
    summary: "已恢复上次会话。",
    chatMessages: [
      { role: "user", title: "你", content: "帮我检查 LED 供电" },
      { role: "assistant", title: "分析结果", content: "发现限流电阻缺失。" },
    ],
  };

  const entries = deriveSessionHistoryEntries(undefined, lastState);
  assert.equal(entries.length, 1);
  assert.equal(entries[0]?.sessionTitle, "LED 电源检查");
  assert.ok(entries[0]?.sessionId);
});
