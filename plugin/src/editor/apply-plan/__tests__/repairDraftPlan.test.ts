import { test } from "node:test";
import * as assert from "node:assert/strict";

import { classifyDraftApplyError, repairDraftPlanPowerConnectivity, shouldRepairDraftApplyError } from "../repairDraftPlan";
import type { DraftPlan } from "../draftPlan";

test("repairDraftPlanPowerConnectivity injects a power connector for orphan power nets", () => {
  const plan: DraftPlan = {
    title: "orphan power",
    rationale: "test",
    components: [
      {
        id: "draft-r1",
        ref: "R1",
        name: "220R",
        componentType: "part",
        addIntoBom: true,
        addIntoPcb: true,
        properties: { role: "resistor" },
      },
      {
        id: "draft-d1",
        ref: "D1",
        name: "LED",
        componentType: "part",
        addIntoBom: true,
        addIntoPcb: true,
        properties: { role: "led" },
      },
    ],
    pins: [
      { id: "draft-r1-1", componentId: "draft-r1", pinNumber: "1", pinName: "1", electricalType: "passive", netName: "3V3" },
      { id: "draft-r1-2", componentId: "draft-r1", pinNumber: "2", pinName: "2", electricalType: "passive", netName: "LED_ANODE" },
      { id: "draft-d1-a", componentId: "draft-d1", pinNumber: "1", pinName: "A", electricalType: "passive", netName: "LED_ANODE" },
      { id: "draft-d1-k", componentId: "draft-d1", pinNumber: "2", pinName: "K", electricalType: "passive", netName: "GND" },
    ],
    nets: [
      { id: "net-3v3", name: "3V3", isPower: true, nodeIds: ["draft-r1-1"] },
      { id: "net-led", name: "LED_ANODE", isPower: false, nodeIds: ["draft-r1-2", "draft-d1-a"] },
      { id: "net-gnd", name: "GND", isPower: true, nodeIds: ["draft-d1-k"] },
    ],
  };

  const repaired = repairDraftPlanPowerConnectivity(plan);

  assert.equal(repaired.changed, true);
  assert.equal(repaired.plan.components.some((component) => component.ref === "J1"), true);
  assert.deepEqual(repaired.plan.nets.find((net) => net.name === "3V3")?.nodeIds, ["draft-r1-1", "repair-j1-pos"]);
  assert.deepEqual(repaired.plan.nets.find((net) => net.name === "GND")?.nodeIds, ["draft-d1-k", "repair-j1-gnd"]);
});

test("shouldRepairDraftApplyError only matches unmapped required nets failures", () => {
  assert.equal(shouldRepairDraftApplyError(new Error("unmapped required nets: 3V3 (missing endpoints)")), true);
  assert.equal(shouldRepairDraftApplyError(new Error("required connection unresolved: U1.VOUT -> J1.1 (3V3)")), true);
  assert.equal(shouldRepairDraftApplyError(new Error("required connection net mismatch: U1.VOUT -> J1.1 (3V3)")), true);
  assert.equal(shouldRepairDraftApplyError(new Error("typed placement requires all draft components to have resolved devices: J1")), false);
});

test("classifyDraftApplyError extracts unresolved required connection details", () => {
  const result = classifyDraftApplyError("required connection unresolved: U1.VOUT -> J1.1 (3V3)");
  assert.deepEqual(result, {
    kind: "required_connection_unresolved",
    fromComponentRef: "U1",
    fromPin: "VOUT",
    toComponentRef: "J1",
    toPin: "1",
    netName: "3V3",
    rawMessage: "required connection unresolved: U1.VOUT -> J1.1 (3V3)",
  });
});

test("classifyDraftApplyError extracts required connection net mismatch details", () => {
  const result = classifyDraftApplyError("required connection net mismatch: U1.VOUT -> J1.1 (3V3)");
  assert.deepEqual(result, {
    kind: "required_connection_net_mismatch",
    fromComponentRef: "U1",
    fromPin: "VOUT",
    toComponentRef: "J1",
    toPin: "1",
    netName: "3V3",
    rawMessage: "required connection net mismatch: U1.VOUT -> J1.1 (3V3)",
  });
});

test("repairDraftPlanPowerConnectivity backfills required connection endpoints onto the requested net", () => {
  const plan: DraftPlan = {
    title: "ldo power path",
    rationale: "test",
    components: [
      {
        id: "draft-u1",
        ref: "U1",
        name: "LDO",
        componentType: "part",
        addIntoBom: true,
        addIntoPcb: true,
        properties: { role: "ldo" },
      },
      {
        id: "draft-j1",
        ref: "J1",
        name: "Header",
        componentType: "part",
        addIntoBom: true,
        addIntoPcb: true,
        properties: { role: "power_connector" },
      },
    ],
    pins: [
      { id: "draft-u1-vout", componentId: "draft-u1", pinNumber: "3", pinName: "VOUT", electricalType: "power_out", netName: "LDO_OUT" },
      { id: "draft-j1-1", componentId: "draft-j1", pinNumber: "1", pinName: "1", electricalType: "passive", netName: "VIN" },
      { id: "draft-j1-2", componentId: "draft-j1", pinNumber: "2", pinName: "GND", electricalType: "power_out", netName: "GND" },
    ],
    nets: [
      { id: "net-3v3", name: "3V3", isPower: true, nodeIds: [] },
      { id: "net-ldo-out", name: "LDO_OUT", isPower: true, nodeIds: ["draft-u1-vout"] },
      { id: "net-vin", name: "VIN", isPower: true, nodeIds: ["draft-j1-1"] },
      { id: "net-gnd", name: "GND", isPower: true, nodeIds: ["draft-j1-2"] },
    ],
    guidance: {
      templateId: "ldo_test",
      rationale: "test",
      requiredConnections: [
        {
          fromComponentRef: "U1",
          fromPin: "VOUT",
          toComponentRef: "J1",
          toPin: "1",
          netName: "3V3",
        },
      ],
    },
  };

  const repaired = repairDraftPlanPowerConnectivity(plan);

  assert.equal(repaired.changed, true);
  assert.deepEqual(repaired.plan.nets.find((net) => net.name === "3V3")?.nodeIds, ["draft-u1-vout", "draft-j1-1"]);
  assert.equal(repaired.plan.pins.find((pin) => pin.id === "draft-u1-vout")?.netName, "3V3");
  assert.equal(repaired.plan.pins.find((pin) => pin.id === "draft-j1-1")?.netName, "3V3");
});
