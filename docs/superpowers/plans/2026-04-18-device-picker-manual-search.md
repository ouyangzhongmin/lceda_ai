# Device Picker Manual Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a collapsible manual search fallback in the device picker so users can override the LLM-generated search text for one search without mutating the draft plan default query.

**Architecture:** Extend `MainPanelState.devicePicker.items` with UI-only manual query fields, then teach the runtime search entrypoint to accept an optional one-shot override query. Update the iframe device picker renderer to expose the new controls and wire them to runtime methods while keeping existing candidate selection and batch actions intact.

**Tech Stack:** TypeScript, existing runtime state management in `assistantRuntime.ts`, iframe DOM rendering in `plugin/iframe/index.html`, Node test runner in `plugin/src/app/__tests__/assistantRuntime.test.ts`

---

## File Map

**Modify**
- `plugin/src/ui/panels/mainPanel.ts`
  Add optional manual-query fields to `MainPanelState.devicePicker.items`.
- `plugin/src/app/assistantRuntime.ts`
  Add device picker item state updaters, extend candidate search to accept a manual query override, and preserve manual query UI state across picker rebuilds.
- `plugin/src/app/__tests__/assistantRuntime.test.ts`
  Add unit tests for manual-query precedence, fallback behavior, and state updates.
- `plugin/iframe/index.html`
  Render the manual input controls, wire runtime calls, and style the expanded manual search section.

**Do not modify for this feature**
- `plugin/src/editor/apply-plan/draftPlan.ts`
  Manual search must not touch draft plan search defaults.
- `plugin/src/editor/apply-plan/resolveDraftPlanDevices.ts`
  Search query generation rules stay unchanged.

## Task 1: Extend Device Picker State Model

**Files:**
- Modify: `plugin/src/ui/panels/mainPanel.ts`
- Test: `plugin/src/app/__tests__/assistantRuntime.test.ts`

- [ ] **Step 1: Add manual query fields to the typed panel state**

Update the `devicePicker.items` item type in `plugin/src/ui/panels/mainPanel.ts` to carry the UI-only fields:

```ts
  devicePicker?: {
    open: boolean;
    items: Array<{
      componentId: string;
      componentRef: string;
      role: string;
      roleLabel?: string;
      query?: string;
      manualQueryExpanded?: boolean;
      manualQueryDraft?: string;
      status: "resolved" | "unresolved";
      reason?: string;
      reasonLabel?: string;
      usageHint?: string;
      selectedDeviceLabel?: string;
      candidates?: Array<{
        uuid: string;
        name: string;
        libraryUuid: string;
        footprintName?: string;
        manufacturer?: string;
        supplier?: string;
        supplierId?: string;
        description?: string;
        typeLabel?: string;
        fitLabel?: string;
        fitLevel?: "recommended" | "possible" | "weak";
        summary?: string;
        reasons?: string[];
        cautions?: string[];
      }>;
    }>;
  };
```

- [ ] **Step 2: Add a regression test that state-only manual query fields are allowed**

Append a focused type-shape/runtime test in `plugin/src/app/__tests__/assistantRuntime.test.ts` that builds a `MainPanelState` with manual query fields and verifies they survive plain object usage:

```ts
test("device picker items can carry manual query ui state", () => {
  const state: MainPanelState = {
    loggedIn: false,
    devicePicker: {
      open: true,
      items: [
        {
          componentId: "draft-u5",
          componentRef: "U5",
          role: "ldo_regulator",
          query: "MEMS 麦克风 -26dB",
          manualQueryExpanded: true,
          manualQueryDraft: "MEMS microphone -26dB",
          status: "unresolved",
        },
      ],
    },
  };

  assert.equal(state.devicePicker?.items[0]?.manualQueryExpanded, true);
  assert.equal(state.devicePicker?.items[0]?.manualQueryDraft, "MEMS microphone -26dB");
});
```

- [ ] **Step 3: Run the focused test file to verify the new state shape compiles**

Run:

```bash
npm test -- plugin/src/app/__tests__/assistantRuntime.test.ts
```

Expected:
- The test run fails only because the new runtime behavior tests added later do not exist yet, or passes if this is the only change so far.
- There must be no TypeScript shape errors around `manualQueryExpanded` or `manualQueryDraft`.

- [ ] **Step 4: Commit the state model change**

```bash
git add plugin/src/ui/panels/mainPanel.ts plugin/src/app/__tests__/assistantRuntime.test.ts
git commit -m "feat: add manual query fields to device picker state"
```

## Task 2: Add Runtime Manual Query Search Support

**Files:**
- Modify: `plugin/src/app/assistantRuntime.ts`
- Test: `plugin/src/app/__tests__/assistantRuntime.test.ts`

- [ ] **Step 1: Export focused helper functions for manual query resolution and picker item updates**

In `plugin/src/app/assistantRuntime.ts`, add small exported helpers near the other exported pure helpers:

```ts
export function resolveDraftDeviceSearchQuery(input: {
  defaultQuery?: string;
  manualQuery?: string;
}): string | null {
  const manual = String(input.manualQuery || "").trim();
  if (manual) return manual;
  const fallback = String(input.defaultQuery || "").trim();
  return fallback || null;
}

export function updateDevicePickerManualQueryState(
  picker: MainPanelState["devicePicker"],
  input: {
    componentId: string;
    manualQueryExpanded?: boolean;
    manualQueryDraft?: string;
  }
): MainPanelState["devicePicker"] {
  if (!picker) return picker;
  return {
    ...picker,
    items: picker.items.map((item) =>
      item.componentId !== input.componentId
        ? item
        : {
            ...item,
            ...(typeof input.manualQueryExpanded === "boolean"
              ? { manualQueryExpanded: input.manualQueryExpanded }
              : {}),
            ...(typeof input.manualQueryDraft === "string"
              ? { manualQueryDraft: input.manualQueryDraft }
              : {}),
          }
    ),
  };
}
```

- [ ] **Step 2: Write failing tests for query precedence and picker state updates**

Append these tests to `plugin/src/app/__tests__/assistantRuntime.test.ts`:

```ts
test("resolveDraftDeviceSearchQuery prefers manual query over default query", () => {
  assert.equal(
    resolveDraftDeviceSearchQuery({
      defaultQuery: "MEMS 麦克风 -26dB",
      manualQuery: "MEMS microphone -26dB",
    }),
    "MEMS microphone -26dB"
  );
});

test("resolveDraftDeviceSearchQuery falls back to default query when manual query is blank", () => {
  assert.equal(
    resolveDraftDeviceSearchQuery({
      defaultQuery: "OPA1632",
      manualQuery: "   ",
    }),
    "OPA1632"
  );
});

test("resolveDraftDeviceSearchQuery returns null when both queries are unavailable", () => {
  assert.equal(
    resolveDraftDeviceSearchQuery({
      defaultQuery: "",
      manualQuery: " ",
    }),
    null
  );
});

test("updateDevicePickerManualQueryState updates only the targeted picker item", () => {
  const picker: NonNullable<MainPanelState["devicePicker"]> = {
    open: true,
    items: [
      {
        componentId: "draft-u5",
        componentRef: "U5",
        role: "ldo_regulator",
        query: "MEMS 麦克风 -26dB",
        status: "unresolved",
      },
      {
        componentId: "draft-u6",
        componentRef: "U6",
        role: "ldo_regulator",
        query: "OPA1632",
        status: "resolved",
      },
    ],
  };

  const updated = updateDevicePickerManualQueryState(picker, {
    componentId: "draft-u5",
    manualQueryExpanded: true,
    manualQueryDraft: "MEMS microphone -26dB",
  });

  assert.equal(updated?.items[0]?.manualQueryExpanded, true);
  assert.equal(updated?.items[0]?.manualQueryDraft, "MEMS microphone -26dB");
  assert.equal(updated?.items[1]?.manualQueryExpanded, undefined);
  assert.equal(updated?.items[1]?.manualQueryDraft, undefined);
});
```

- [ ] **Step 3: Run the tests to verify they fail before implementation is complete**

Run:

```bash
npm test -- plugin/src/app/__tests__/assistantRuntime.test.ts
```

Expected:
- FAIL with missing exports or failing assertions for manual-query helpers.

- [ ] **Step 4: Implement picker state preservation while rebuilding the device picker**

In `plugin/src/app/assistantRuntime.ts`, update the logic inside `searchDraftDeviceCandidatesInternal` so non-target items preserve prior manual query UI state, and the target item also keeps its existing manual query fields:

```ts
    const previousPicker = state.devicePicker;
    const picker = buildDevicePickerState(plan) ?? { open: true, items: [] };
    picker.open = true;
    picker.items = picker.items.map((item) => {
      const previousItem = previousPicker?.items.find((entry) => entry.componentId === item.componentId);
      const preservedManualState = previousItem
        ? {
            manualQueryExpanded: previousItem.manualQueryExpanded,
            manualQueryDraft: previousItem.manualQueryDraft,
          }
        : {};

      if (item.componentId !== componentId) {
        return previousItem?.candidates && previousItem.candidates.length > 0
          ? { ...item, ...preservedManualState, candidates: previousItem.candidates }
          : { ...item, ...preservedManualState };
      }

      return {
        ...item,
        ...preservedManualState,
        candidates: presentedCandidates,
      };
    });
```

- [ ] **Step 5: Implement manual-query-aware search resolution**

Change `searchDraftDeviceCandidatesInternal` signature and query resolution:

```ts
  async function searchDraftDeviceCandidatesInternal(
    state: MainPanelState,
    componentId: string,
    manualQuery?: string
  ): Promise<{ state: MainPanelState; updated: boolean; candidateCount: number }> {
    const plan = internals.draftPlan;
    const bridge = resolveHostEditorBridge();
    if (!plan || !bridge?.searchLibraryDevices) {
      state.summary = "当前宿主不支持器件库搜索。";
      state.toast = { id: Date.now(), message: state.summary };
      return { state, updated: false, candidateCount: 0 };
    }
    const component = plan.components.find((item) => item.id === componentId);
    const query = resolveDraftDeviceSearchQuery({
      defaultQuery: component?.properties?.preferred_search_query,
      manualQuery,
    });
    if (!component || !query) {
      state.summary = "当前器件缺少可用搜索条件，请手动输入搜索关键词。";
      state.toast = { id: Date.now(), message: state.summary };
      return { state, updated: false, candidateCount: 0 };
    }
    const rawCandidates = await bridge.searchLibraryDevices({ query, scope: "system", pageSize: 8 });
```

- [ ] **Step 6: Expose runtime methods for manual query open/edit/search actions**

Add runtime methods near the other device picker methods:

```ts
    setDraftDeviceManualQueryExpanded: async (
      input: { componentId: string; expanded: boolean }
    ): Promise<MainPanelState> => {
      const state = internals.currentState ?? (await computeAnalysisState());
      state.devicePicker = updateDevicePickerManualQueryState(state.devicePicker, {
        componentId: input.componentId,
        manualQueryExpanded: input.expanded,
      });
      return commitState(internals, state, storage);
    },
    setDraftDeviceManualQueryDraft: async (
      input: { componentId: string; value: string }
    ): Promise<MainPanelState> => {
      const state = internals.currentState ?? (await computeAnalysisState());
      state.devicePicker = updateDevicePickerManualQueryState(state.devicePicker, {
        componentId: input.componentId,
        manualQueryDraft: input.value,
      });
      return commitState(internals, state, storage);
    },
    searchDraftDeviceCandidates: async (
      componentId: string,
      manualQuery?: string
    ): Promise<MainPanelState> => {
      const state = internals.currentState ?? (await computeAnalysisState());
      if (typeof manualQuery === "string") {
        state.devicePicker = updateDevicePickerManualQueryState(state.devicePicker, {
          componentId,
          manualQueryExpanded: true,
          manualQueryDraft: manualQuery,
        });
      }
      await searchDraftDeviceCandidatesInternal(state, componentId, manualQuery);
      return commitState(internals, state, storage);
    },
```

- [ ] **Step 7: Add a test that manual query search does not imply draft plan mutation**

Append a pure-state regression test that proves the draft plan search query remains unchanged:

```ts
test("manual query override does not mutate the draft plan default query source", () => {
  const component = {
    id: "draft-u5",
    ref: "U5",
    properties: {
      preferred_search_query: "MEMS 麦克风 -26dB",
    },
  };

  const resolved = resolveDraftDeviceSearchQuery({
    defaultQuery: component.properties.preferred_search_query,
    manualQuery: "MEMS microphone -26dB",
  });

  assert.equal(resolved, "MEMS microphone -26dB");
  assert.equal(component.properties.preferred_search_query, "MEMS 麦克风 -26dB");
});
```

- [ ] **Step 8: Run the runtime test file to verify the behavior passes**

Run:

```bash
npm test -- plugin/src/app/__tests__/assistantRuntime.test.ts
```

Expected:
- PASS for the new manual query helper/state tests.

- [ ] **Step 9: Commit the runtime changes**

```bash
git add plugin/src/app/assistantRuntime.ts plugin/src/app/__tests__/assistantRuntime.test.ts
git commit -m "feat: support manual device picker search overrides"
```

## Task 3: Add Manual Search Controls To The Iframe Device Picker

**Files:**
- Modify: `plugin/iframe/index.html`

- [ ] **Step 1: Add styles for the collapsible manual search section**

In the device picker CSS section of `plugin/iframe/index.html`, add styles like:

```css
    .device-picker-actions-row {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 10px;
    }

    .device-picker-manual-toggle-btn {
      border: 1px solid #d8e1ec;
      background: #fff;
      color: #334155;
    }

    .device-picker-manual-box {
      margin-top: 10px;
      padding: 12px;
      border-radius: 12px;
      border: 1px solid #e2e8f0;
      background: #f8fafc;
      display: grid;
      gap: 8px;
    }

    .device-picker-manual-input {
      width: 100%;
      min-height: 40px;
      padding: 10px 12px;
      border-radius: 10px;
      border: 1px solid #cbd5e1;
      background: #fff;
      color: #0f172a;
      font: inherit;
    }

    .device-picker-manual-actions {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }
```

- [ ] **Step 2: Add the manual search controls in `syncDevicePicker`**

Replace the single-button block in `syncDevicePicker` with an action row plus conditional manual box:

```js
        const actionsRow = document.createElement("div");
        actionsRow.className = "device-picker-actions-row";

        const searchBtn = document.createElement("button");
        searchBtn.type = "button";
        searchBtn.className = "device-picker-search-btn";
        searchBtn.textContent = "搜索候选";
        searchBtn.addEventListener("click", () => {
          void runDevicePickerAction("searchDraftDeviceCandidates", item.componentId);
        });
        actionsRow.appendChild(searchBtn);

        if (item.status === "unresolved") {
          const manualToggleBtn = document.createElement("button");
          manualToggleBtn.type = "button";
          manualToggleBtn.className = "device-picker-search-btn device-picker-manual-toggle-btn";
          manualToggleBtn.textContent = item.manualQueryExpanded ? "收起手动输入" : "手动输入";
          manualToggleBtn.addEventListener("click", () => {
            void runDevicePickerAction("setDraftDeviceManualQueryExpanded", {
              componentId: item.componentId,
              expanded: !item.manualQueryExpanded,
            });
          });
          actionsRow.appendChild(manualToggleBtn);
        }

        card.appendChild(actionsRow);

        if (item.status === "unresolved" && item.manualQueryExpanded) {
          const manualBox = document.createElement("div");
          manualBox.className = "device-picker-manual-box";

          const manualInput = document.createElement("input");
          manualInput.type = "text";
          manualInput.className = "device-picker-manual-input";
          manualInput.placeholder = "输入你想搜索的器件关键字";
          manualInput.value = item.manualQueryDraft || "";
          manualInput.disabled = devicePickerBusy;
          manualInput.addEventListener("input", (event) => {
            void invokeRuntimeAsync("setDraftDeviceManualQueryDraft", {
              componentId: item.componentId,
              value: event.target && event.target.value ? event.target.value : "",
            });
          });

          const manualActions = document.createElement("div");
          manualActions.className = "device-picker-manual-actions";

          const manualSearchBtn = document.createElement("button");
          manualSearchBtn.type = "button";
          manualSearchBtn.className = "device-picker-search-btn";
          manualSearchBtn.textContent = "用此关键词搜索";
          manualSearchBtn.addEventListener("click", () => {
            void runDevicePickerAction(
              "searchDraftDeviceCandidates",
              item.componentId,
              item.manualQueryDraft || ""
            );
          });

          const manualCancelBtn = document.createElement("button");
          manualCancelBtn.type = "button";
          manualCancelBtn.className = "device-picker-close-btn";
          manualCancelBtn.textContent = "取消";
          manualCancelBtn.addEventListener("click", () => {
            void runDevicePickerAction("setDraftDeviceManualQueryExpanded", {
              componentId: item.componentId,
              expanded: false,
            });
          });

          manualActions.appendChild(manualSearchBtn);
          manualActions.appendChild(manualCancelBtn);
          manualBox.appendChild(manualInput);
          manualBox.appendChild(manualActions);
          card.appendChild(manualBox);
        }
```

- [ ] **Step 3: Preserve existing quick-use candidate flow**

After inserting the manual controls, keep the existing quick-use block intact immediately before candidate rendering:

```js
        const candidates = Array.isArray(item.candidates) ? item.candidates : [];
        if (item.status === "unresolved" && candidates.length > 0) {
          const quickUseBtn = document.createElement("button");
          quickUseBtn.type = "button";
          quickUseBtn.className = "device-picker-use-btn";
          quickUseBtn.textContent = "使用首选候选";
          quickUseBtn.addEventListener("click", () => {
            void runDevicePickerAction("chooseDraftDeviceCandidate", {
              componentId: item.componentId,
              candidateIndex: 0,
            });
          });
          card.appendChild(quickUseBtn);
        }
```

- [ ] **Step 4: Ensure busy-state disables the manual input**

Keep the existing `setDevicePickerBusy` button disabling, and rely on `syncDevicePicker` to set:

```js
manualInput.disabled = devicePickerBusy;
```

This avoids adding special-case logic outside the current full re-render of the picker body.

- [ ] **Step 5: Run the app test file to ensure the iframe-linked runtime contract still passes**

Run:

```bash
npm test -- plugin/src/app/__tests__/assistantRuntime.test.ts
```

Expected:
- PASS
- No runtime contract regressions caused by the new method names or changed search signature.

- [ ] **Step 6: Commit the iframe changes**

```bash
git add plugin/iframe/index.html
git commit -m "feat: add manual search controls to device picker"
```

## Task 4: End-to-End Verification

**Files:**
- Modify: `docs/superpowers/specs/2026-04-18-device-picker-manual-search-design.md` only if implementation discovered a real mismatch

- [ ] **Step 1: Run the focused runtime tests again after integrating all changes**

Run:

```bash
npm test -- plugin/src/app/__tests__/assistantRuntime.test.ts
```

Expected:
- PASS with the manual-query tests and existing runtime tests.

- [ ] **Step 2: Manually verify the device picker interaction in the plugin UI**

Run the plugin/dev flow you normally use for this repo, then verify:

```text
1. Generate a draft that opens the device picker with at least one unresolved device.
2. Confirm each unresolved card shows both “搜索候选” and “手动输入”.
3. Click “手动输入” and verify the input area expands only for that card.
4. Type a custom term, click “用此关键词搜索”, and verify candidates refresh.
5. Confirm the card still displays the original “搜索目标” text, not the manual override text.
6. Collapse and re-open the input and verify the typed value remains.
7. Click “取消” and verify the input area closes without clearing candidates.
8. Select a candidate and verify the existing “使用这个器件” flow still works.
```

Expected:
- The manual query affects one search only.
- The draft plan default query remains unchanged in UI and state.
- Existing candidate application flows are unchanged.

- [ ] **Step 3: If manual verification reveals a real spec mismatch, update the spec inline**

Only if needed, edit:

```text
docs/superpowers/specs/2026-04-18-device-picker-manual-search-design.md
```

The only allowed updates here are wording or behavior clarifications discovered during implementation. Do not expand scope.

- [ ] **Step 4: Commit the verification-complete state**

```bash
git add plugin/src/ui/panels/mainPanel.ts plugin/src/app/assistantRuntime.ts plugin/src/app/__tests__/assistantRuntime.test.ts plugin/iframe/index.html docs/superpowers/specs/2026-04-18-device-picker-manual-search-design.md
git commit -m "feat: add manual search fallback to device picker"
```

## Self-Review

Spec coverage check:
- Manual input default collapsed: covered in Task 3 rendering.
- Manual query only affects one search: covered in Task 2 query resolution and no-draft-mutation test.
- Preserve default `搜索目标`: covered in Task 3 manual verification and no UI overwrite behavior.
- Keep manual input value after search/collapse: covered in Task 2 state preservation and Task 3 rendering.
- Keep existing candidate selection flow: covered in Task 3 Step 3 and Task 4 manual verification.

Placeholder scan:
- No `TODO`/`TBD` markers.
- Every code-changing task includes the concrete code shape to add.
- Every verification step includes an exact command or explicit manual checklist.

Type consistency check:
- State fields use `manualQueryExpanded` and `manualQueryDraft` consistently across state, runtime, iframe, and tests.
- Search override parameter name is consistently `manualQuery`.
