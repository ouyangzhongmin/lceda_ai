import { test } from "node:test";
import * as assert from "node:assert/strict";

import { generateDraftPlanFromPrompt } from "../generateDraftPlan";
import { buildDraftDeviceSearchQuery, resolveDraftPlanDevices } from "../resolveDraftPlanDevices";

test("buildDraftDeviceSearchQuery infers practical library queries for LED drafts", () => {
  const draft = generateDraftPlanFromPrompt("帮我设计一个点亮LED的电路");

  assert.equal(buildDraftDeviceSearchQuery(draft.components[0]!), "header 2pin HDR-TH_1X2");
  assert.equal(buildDraftDeviceSearchQuery(draft.components[1]!), "150Ω resistor R0805");
  assert.equal(buildDraftDeviceSearchQuery(draft.components[2]!), "RED LED LED-TH_BD3.9-P2.54-RD_RED");
});

test("resolveDraftPlanDevices fills device/library UUIDs for unresolved draft components", async () => {
  const draft = generateDraftPlanFromPrompt("帮我设计一个点亮LED的电路");
  const resolved = await resolveDraftPlanDevices(draft, async (query) => {
    if (query.includes("header 2pin")) {
      return [{ uuid: "dev-j1", name: "HDR2", libraryUuid: "lib-j1", footprintName: "HDR-TH_1X2" }];
    }
    if (query.includes("resistor")) {
      return [{ uuid: "dev-r1", name: "R150", libraryUuid: "lib-r1", footprintName: "R0805" }];
    }
    if (query.includes("LED")) {
      return [{ uuid: "dev-d1", name: "LED", libraryUuid: "lib-d1", footprintName: "LED-TH_BD3.9-P2.54-RD_RED" }];
    }
    return [];
  });

  assert.equal(resolved.components[0]?.properties.device_uuid, "dev-j1");
  assert.equal(resolved.components[1]?.properties.device_uuid, "dev-r1");
  assert.equal(resolved.components[2]?.properties.device_uuid, "dev-d1");
  assert.equal(resolved.selectedDevices?.length, 3);
});
