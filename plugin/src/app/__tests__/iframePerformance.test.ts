import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import * as assert from "node:assert/strict";

const iframeHtml = readFileSync(resolve(process.cwd(), "iframe/index.html"), "utf8");

test("iframe throttles streaming timeline updates with tail-based running step signatures", () => {
  assert.equal(
    iframeHtml.includes("function buildStepEntriesSignature(entries, latestRunningIndex, streaming)"),
    true
  );
  assert.equal(
    iframeHtml.includes("text.length > 48 ? text.slice(-48) : text"),
    true
  );
  assert.equal(
    iframeHtml.includes("title.length > 24 ? title.slice(-24) : title"),
    true
  );
  assert.equal(
    iframeHtml.includes("if (stepRenderStateChanged && !shouldThrottleStepUi)"),
    true
  );
});

test("iframe avoids eager step line formatting during streaming patch", () => {
  assert.equal(
    iframeHtml.includes("const hasLines = entries.length > 0;"),
    true
  );
  assert.equal(
    iframeHtml.includes("stepEntries.map(formatStepEntryLine).filter(Boolean);"),
    false
  );
});

test("iframe caps running thought text and coalesces step auto-scroll", () => {
  assert.equal(
    iframeHtml.includes("if (status === \"running\" && raw.length > 520)"),
    true
  );
  assert.equal(
    iframeHtml.includes("function scheduleStepsBodyScroll(ui)"),
    true
  );
  assert.equal(
    iframeHtml.includes("if (!ui || !ui.body || ui.scrollRaf) return;"),
    true
  );
});

test("iframe message signature tracks iteration step deltas during streaming", () => {
  assert.equal(
    iframeHtml.includes("const iterationStepsCount = Array.isArray(message.iterationSteps) ? message.iterationSteps.length : 0;"),
    true
  );
  assert.equal(
    iframeHtml.includes("lastIterationStep && lastIterationStep.thoughtText ? String(lastIterationStep.thoughtText).length : 0"),
    true
  );
});

test("iframe caches timeline node patch metadata so running step updates can patch in place", () => {
  assert.equal(
    iframeHtml.includes("nextNodeMap.set(key, { node, signature, meta });"),
    true
  );
  assert.equal(
    iframeHtml.includes("if (!meta || !meta.patchable) return false;"),
    true
  );
});
