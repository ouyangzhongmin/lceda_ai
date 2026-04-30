import { test } from "node:test";
import * as assert from "node:assert/strict";

import {
  __testNormalizeLibraryDeviceDetail,
  __testNormalizeLibrarySearchResults,
} from "../proHostProbe";

test("normalizeLibraryDeviceDetail keeps component-style symbol payload and nested dataStr/documentSource fields", () => {
  const detail = __testNormalizeLibraryDeviceDetail({
    uuid: "symbol-ip5306",
    owner: {
      uuid: "lib-lcsc",
    },
    title: "ip5306",
    result: {
      uuid: "symbol-ip5306",
    },
    dataStr: "{\"head\":{\"docType\":\"symbol\"}}",
    documentSource: "{\"shape\":[{\"pin\":\"VIN\",\"num\":\"1\"}]}",
  } as any);

  assert.equal(detail.uuid, "symbol-ip5306");
  assert.equal(detail.libraryUuid, "lib-lcsc");
  const raw = detail.raw as Record<string, unknown>;
  assert.equal(typeof raw.dataStr, "string");
  assert.equal(typeof raw.documentSource, "string");
});

test("normalizeLibrarySearchResults unwraps LCEDA search result list groups", () => {
  const results = __testNormalizeLibrarySearchResults({
    success: true,
    code: 0,
    result: {
      lists: {
        lcsc: [
          {
            uuid: "49a464100aba46e28c3d78994480a888",
            title: "IP5306",
            owner: { uuid: "0819f05c4eef4c71ace90d822a990e87" },
            product_code: "C181692",
            attributes: {
              "Supplier Part": "C181692",
              Manufacturer: "INJOINIC(英集芯)",
              "Supplier Footprint": "ESOP-8",
              Symbol: "286af622b93c4ec5b0ad7c348ee7f8aa",
              Footprint: "236714646ca442a4843d26e3285daa73",
            },
          },
          {
            uuid: "alt-device",
            title: "IP5306_ALT",
            owner: { uuid: "0819f05c4eef4c71ace90d822a990e87" },
            product_code: "C999999",
          },
        ],
      },
    },
  });

  assert.equal(results.length, 2);
  assert.equal(results[0]?.name, "IP5306");
  assert.equal(results[0]?.supplierId, "C181692");
  assert.equal(results[0]?.symbolUuid, "286af622b93c4ec5b0ad7c348ee7f8aa");
  assert.equal(results[1]?.name, "IP5306_ALT");
});
