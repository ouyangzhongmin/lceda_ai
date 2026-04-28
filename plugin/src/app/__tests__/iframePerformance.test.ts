import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import * as assert from "node:assert/strict";

const iframeHtml = readFileSync(resolve(process.cwd(), "iframe/index.html"), "utf8");

test("iframe skips streaming timeline rerender for running step text-only deltas", () => {
  assert.equal(
    iframeHtml.includes("function buildStepEntriesSignature(entries, latestRunningIndex, streaming)"),
    true
  );
  assert.equal(
    iframeHtml.includes("trackBody && !(streaming && index === latestRunningIndex)"),
    true
  );
  assert.equal(
    iframeHtml.includes("if (stepEntriesSourceChanged && !shouldThrottleStepUi)"),
    true
  );
});
