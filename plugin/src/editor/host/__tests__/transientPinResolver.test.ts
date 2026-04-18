import { test } from "node:test";
import * as assert from "node:assert/strict";

import { resolveTransientComponentPins } from "../transientPinResolver";

test("resolveTransientComponentPins places components, reads pins, and cleans up", async () => {
  const calls: string[] = [];
  const result = await resolveTransientComponentPins(
    {
      components: [
        { componentId: "draft-r1", ref: "R1", deviceUuid: "dev-r1", libraryUuid: "lib-r1" },
      ],
    },
    {
      createComponent: async () => {
        calls.push("create");
        return { primitiveId: "cmp-r1" };
      },
      getPinsByPrimitiveId: async () => {
        calls.push("getPins");
        return [
          { primitiveId: "pin-r1-1", pinName: "1", pinNumber: "1", x: 100, y: 100 },
          { primitiveId: "pin-r1-2", pinName: "2", pinNumber: "2", x: 140, y: 100 },
        ];
      },
      deleteComponents: async (ids) => {
        calls.push(`delete:${ids.join(",")}`);
        return true;
      },
    }
  );

  assert.deepEqual(result.componentPins.get("draft-r1"), [
    { primitiveId: "pin-r1-1", pinName: "1", pinNumber: "1", x: 100, y: 100 },
    { primitiveId: "pin-r1-2", pinName: "2", pinNumber: "2", x: 140, y: 100 },
  ]);
  assert.deepEqual(calls, ["create", "getPins", "delete:cmp-r1"]);
});

test("resolveTransientComponentPins cleans up already placed components when later reads fail", async () => {
  const deleted: string[][] = [];
  await assert.rejects(
    () =>
      resolveTransientComponentPins(
        {
          components: [
            { componentId: "draft-d1", ref: "D1", deviceUuid: "dev-d1", libraryUuid: "lib-d1" },
            { componentId: "draft-j1", ref: "J1", deviceUuid: "dev-j1", libraryUuid: "lib-j1" },
          ],
        },
        {
          createComponent: async ({ componentId }) => ({
            primitiveId: componentId === "draft-d1" ? "cmp-d1" : "cmp-j1",
          }),
          getPinsByPrimitiveId: async (primitiveId) => {
            if (primitiveId === "cmp-j1") {
              throw new Error("pin read failed");
            }
            return [{ primitiveId: "pin-d1-a", pinName: "A", pinNumber: "1", x: 50, y: 50 }];
          },
          deleteComponents: async (ids) => {
            deleted.push(ids.slice());
            return true;
          },
        }
      ),
    /pin read failed/
  );

  assert.deepEqual(deleted, [["cmp-d1", "cmp-j1"]]);
});
