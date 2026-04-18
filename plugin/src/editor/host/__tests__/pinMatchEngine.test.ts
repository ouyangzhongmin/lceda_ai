import { test } from "node:test";
import * as assert from "node:assert/strict";

import { matchDraftPinsToRealPins } from "../pinMatchEngine";

test("matchDraftPinsToRealPins resolves LED A/K pins by name", () => {
  const result = matchDraftPinsToRealPins({
    role: "led",
    planPins: [
      { id: "draft-led1-a", pinName: "A" },
      { id: "draft-led1-k", pinName: "K" },
    ],
    realPins: [
      { primitiveId: "pin-a", pinName: "A", pinNumber: "1", x: 0, y: 0 },
      { primitiveId: "pin-k", pinName: "K", pinNumber: "2", x: 0, y: 0 },
    ],
  });

  assert.equal(result.get("draft-led1-a")?.resolvedPinName, "A");
  assert.equal(result.get("draft-led1-k")?.resolvedPinName, "K");
  assert.equal(result.get("draft-led1-k")?.confidence, 1);
});

test("matchDraftPinsToRealPins resolves resistor pins by number fallback", () => {
  const result = matchDraftPinsToRealPins({
    role: "resistor",
    planPins: [
      { id: "draft-r1-1", pinName: "1" },
      { id: "draft-r1-2", pinName: "2" },
    ],
    realPins: [
      { primitiveId: "pin-1", pinName: "P1", pinNumber: "1", x: 0, y: 0 },
      { primitiveId: "pin-2", pinName: "P2", pinNumber: "2", x: 0, y: 0 },
    ],
  });

  assert.equal(result.get("draft-r1-1")?.resolvedPinNumber, "1");
  assert.equal(result.get("draft-r1-2")?.resolvedPinNumber, "2");
});
