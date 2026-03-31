"use strict";
var edaEsbuildExportName = (() => {
  // src/config/env.ts
  function loadConfigFromEnv() {
    const serverBaseUrl = "http://127.0.0.1:28080";
    const channel = false ? "professional" : "standard";
    const nodeEnv = "development";
    return {
      serverBaseUrl,
      channel,
      nodeEnv
    };
  }
  var config = null;
  function initConfig(customConfig) {
    config = {
      ...loadConfigFromEnv(),
      ...customConfig
    };
  }
  function getConfig() {
    if (!config) {
      initConfig();
    }
    return config;
  }

  // src/editor/adapters/mockData.ts
  function buildMockContext(channel) {
    return {
      project: {
        projectId: `${channel}-demo-project`,
        pageId: `${channel}-page-1`,
        channel
      },
      components: [
        {
          id: "cmp-u1",
          ref: "U1",
          name: "ESP32-S3",
          libraryId: "lib-esp32-s3",
          packageName: "QFN-56",
          value: "ESP32-S3",
          properties: {
            footprint: "QFN-56",
            expected_net_3V3: "3V3"
          }
        },
        {
          id: "cmp-u2",
          ref: "U2",
          name: "LDO",
          libraryId: "lib-ldo",
          packageName: "SOT-223",
          value: "3.3V",
          properties: {
            output: "3.3V",
            expected_net_VIN: "3V3"
          }
        },
        {
          id: "cmp-d1",
          ref: "D1",
          name: "Schottky Diode",
          libraryId: "lib-diode-schottky",
          packageName: "SOD-123",
          value: "SS14",
          properties: {
            expected_net_ANODE: "5V",
            expected_net_CATHODE: "3V3",
            polarity_sensitive: "true"
          }
        },
        {
          id: "cmp-u3",
          ref: "U3",
          name: "Sensor",
          libraryId: "lib-sensor-demo",
          value: "Hall Sensor",
          properties: {
            expected_net_GND: "GND"
          }
        },
        {
          id: "cmp-u4",
          ref: "U4",
          name: "Power Monitor",
          libraryId: "lib-power-monitor",
          packageName: "SOT-23-5",
          value: "INA-demo",
          properties: {
            expected_net_VOUT: "5V"
          }
        },
        {
          id: "cmp-u5",
          ref: "U5",
          name: "MCU GPIO Source",
          libraryId: "lib-gpio-demo",
          packageName: "QFN-16",
          value: "GPIO",
          properties: {}
        }
      ],
      pins: [
        {
          id: "pin-u1-1",
          componentId: "cmp-u1",
          pinNumber: "1",
          pinName: "3V3",
          electricalType: "power_in"
        },
        {
          id: "pin-u2-1",
          componentId: "cmp-u2",
          pinNumber: "1",
          pinName: "VIN",
          electricalType: "power_in"
        },
        {
          id: "pin-d1-1",
          componentId: "cmp-d1",
          pinNumber: "1",
          pinName: "ANODE",
          electricalType: "passive"
        },
        {
          id: "pin-d1-2",
          componentId: "cmp-d1",
          pinNumber: "2",
          pinName: "CATHODE",
          electricalType: "passive"
        },
        {
          id: "pin-u3-1",
          componentId: "cmp-u3",
          pinNumber: "1",
          pinName: "GND",
          electricalType: "power_in"
        },
        {
          id: "pin-u3-2",
          componentId: "cmp-u3",
          pinNumber: "2",
          pinName: "SDA",
          electricalType: "input"
        },
        {
          id: "pin-u4-1",
          componentId: "cmp-u4",
          pinNumber: "1",
          pinName: "VOUT",
          electricalType: "power_out"
        },
        {
          id: "pin-u5-1",
          componentId: "cmp-u5",
          pinNumber: "1",
          pinName: "GPIO_OUT",
          electricalType: "output"
        },
        {
          id: "pin-u5-2",
          componentId: "cmp-u5",
          pinNumber: "2",
          pinName: "GPIO_FB",
          electricalType: "bidirectional"
        }
      ],
      nets: [
        {
          id: "net-3v3",
          name: "3V3",
          nodeIds: ["pin-u1-1"],
          isPower: true
        },
        {
          id: "net-5v",
          name: "5V",
          nodeIds: ["pin-u2-1", "pin-d1-2", "pin-u3-1", "pin-u4-1"],
          isPower: true
        },
        {
          id: "net-vbus",
          name: "VBUS",
          nodeIds: ["pin-d1-1"],
          isPower: true
        },
        {
          id: "net-gpio-bus",
          name: "GPIO_BUS",
          nodeIds: ["pin-u5-1", "pin-u5-2"]
        }
      ],
      selection: {
        objectIds: ["cmp-u1"]
      }
    };
  }
  var mockStandardContext = buildMockContext("standard");
  var mockProfessionalContext = buildMockContext("professional");

  // src/editor/host/professionalHostApi.ts
  function resolveProfessionalHostCapabilities(rawApi) {
    return {
      getCurrentDocument: rawApi?.editor?.getActiveSchematicContext ? async () => rawApi.editor.getActiveSchematicContext() : void 0,
      getSelection: rawApi?.editor?.getCurrentSelection ? async () => rawApi.editor.getCurrentSelection() : void 0,
      locateObject: rawApi?.editor?.locateEntity ? async (target) => {
        await rawApi.editor.locateEntity(target);
      } : void 0,
      openExternal: rawApi?.system?.openBrowser ? async (url) => {
        await rawApi.system.openBrowser(url);
      } : void 0,
      searchLibraryDevices: rawApi?.library?.searchDevices ? async (input) => rawApi.library.searchDevices(input) : void 0,
      getLibraryDevice: rawApi?.library?.getDevice ? async (input) => rawApi.library.getDevice(input) : void 0,
      getLibraryDevicesByLcscIds: rawApi?.library?.getDevicesByLcscIds ? async (input) => rawApi.library.getDevicesByLcscIds(input) : void 0,
      previewApplyPlan: rawApi?.applyPlan?.preview ? async (plan) => rawApi.applyPlan.preview(plan) : void 0,
      applyPlan: rawApi?.applyPlan?.apply ? async (plan) => rawApi.applyPlan.apply(plan) : void 0,
      rollbackApplyPlan: rawApi?.applyPlan?.rollback ? async (transactionId) => rawApi.applyPlan.rollback(transactionId) : void 0
    };
  }
  function isProfessionalSchematicContext(value) {
    if (typeof value !== "object" || value === null) {
      return false;
    }
    const candidate = value;
    return Array.isArray(candidate.components) && Array.isArray(candidate.nets) && Array.isArray(candidate.pins);
  }
  function isProfessionalSelection(value) {
    return typeof value === "object" && value !== null && Array.isArray(value.objectIds);
  }

  // src/editor/host/proHostProbe.ts
  function hasTypedHostRuntime() {
    return typeof eda !== "undefined" && typeof eda.sch_SelectControl?.getAllSelectedPrimitives_PrimitiveId === "function" && typeof eda.dmt_SelectControl?.getCurrentDocumentInfo === "function";
  }
  async function getTypedSelectedPrimitiveIds() {
    if (!hasTypedHostRuntime()) {
      return [];
    }
    try {
      return await eda.sch_SelectControl.getAllSelectedPrimitives_PrimitiveId();
    } catch {
      return [];
    }
  }
  async function getTypedSelection() {
    const objectIds = await getTypedSelectedPrimitiveIds();
    if (objectIds.length === 0) {
      return null;
    }
    return { objectIds };
  }
  function openTypedHostWindow(url) {
    if (typeof eda === "undefined") {
      return false;
    }
    try {
      eda.sys_Window.open(url);
      return true;
    } catch {
      return false;
    }
  }
  function hasTypedWindowOpenCapability() {
    return typeof eda !== "undefined" && typeof eda.sys_Window?.open === "function";
  }
  async function locateTypedHostObject(target) {
    if (typeof eda === "undefined" || typeof eda.sch_SelectControl?.doSelectPrimitives !== "function" || typeof eda.sch_Primitive?.getPrimitivesBBox !== "function" || typeof eda.sch_Document?.navigateToRegion !== "function") {
      return false;
    }
    try {
      const selected = await eda.sch_SelectControl.doSelectPrimitives(target.objectId);
      if (!selected) {
        return false;
      }
      const bbox = await eda.sch_Primitive.getPrimitivesBBox([target.objectId]);
      if (bbox) {
        await eda.sch_Document.navigateToRegion(bbox.minX, bbox.maxX, bbox.maxY, bbox.minY);
      }
      return true;
    } catch {
      return false;
    }
  }
  async function getTypedDocumentContext(channel) {
    if (!hasTypedHostRuntime()) {
      return null;
    }
    try {
      const [currentDocument, currentSchematic, currentPage, selection] = await Promise.all([
        eda.dmt_SelectControl.getCurrentDocumentInfo(),
        eda.dmt_Schematic.getCurrentSchematicInfo().catch(() => void 0),
        eda.dmt_Schematic.getCurrentSchematicPageInfo().catch(() => void 0),
        getTypedSelection()
      ]);
      return {
        project: {
          channel,
          projectId: currentSchematic?.parentProjectUuid ?? currentDocument?.parentProjectUuid,
          pageId: currentPage?.uuid ?? currentDocument?.uuid
        },
        selection: selection ?? { objectIds: [] }
      };
    } catch {
      return null;
    }
  }
  function resolveScopeLibraryUuid(scope) {
    if (typeof eda === "undefined" || typeof eda.lib_LibrariesList === "undefined") {
      return Promise.resolve(void 0);
    }
    try {
      switch (scope) {
        case "project":
          return eda.lib_LibrariesList.getProjectLibraryUuid();
        case "personal":
          return eda.lib_LibrariesList.getPersonalLibraryUuid();
        case "favorite":
          return eda.lib_LibrariesList.getFavoriteLibraryUuid();
        case "system":
        default:
          return eda.lib_LibrariesList.getSystemLibraryUuid();
      }
    } catch {
      return Promise.resolve(void 0);
    }
  }
  function hasTypedLibraryRuntime() {
    return typeof eda !== "undefined" && typeof eda.lib_Device?.search === "function" && typeof eda.lib_LibrariesList?.getSystemLibraryUuid === "function";
  }
  function hasTypedSchematicPlacementRuntime() {
    return typeof eda !== "undefined" && typeof eda.sch_PrimitiveComponent?.create === "function" && typeof eda.sch_PrimitiveWire?.create === "function";
  }
  async function typedSearchLibraryDevices(input) {
    if (!hasTypedLibraryRuntime()) {
      return null;
    }
    const query = input.query.trim();
    if (!query) {
      return [];
    }
    try {
      const libraryUuid = input.libraryUuid ?? await resolveScopeLibraryUuid(input.scope ?? "system");
      const results = await eda.lib_Device.search(
        query,
        libraryUuid,
        input.classification && input.classification.length > 0 ? input.classification : void 0,
        input.symbolType,
        input.pageSize,
        input.page
      );
      return Array.isArray(results) ? results.map(normalizeLibrarySearchResult) : [];
    } catch {
      return null;
    }
  }
  async function typedGetLibraryDevice(input) {
    if (typeof eda === "undefined" || typeof eda.lib_Device?.get !== "function" || typeof eda.lib_LibrariesList?.getSystemLibraryUuid !== "function") {
      return null;
    }
    try {
      const libraryUuid = input.libraryUuid ?? await resolveScopeLibraryUuid(input.scope ?? "system");
      const result = await eda.lib_Device.get(input.deviceUuid, libraryUuid);
      return normalizeLibraryDeviceDetail(result);
    } catch {
      return null;
    }
  }
  async function typedGetLibraryDevicesByLcscIds(input) {
    if (typeof eda === "undefined" || typeof eda.lib_Device?.getByLcscIds !== "function" || typeof eda.lib_LibrariesList?.getSystemLibraryUuid !== "function") {
      return null;
    }
    const lcscIds = input.lcscIds.map((item) => item.trim()).filter(Boolean);
    if (lcscIds.length === 0) {
      return [];
    }
    try {
      const libraryUuid = input.libraryUuid ?? await resolveScopeLibraryUuid(input.scope ?? "system");
      const results = await eda.lib_Device.getByLcscIds(lcscIds, libraryUuid, input.allowMultiMatch);
      return Array.isArray(results) ? results.map(normalizeLibraryDeviceDetail) : [];
    } catch {
      return null;
    }
  }
  function normalizeLibrarySearchResult(value) {
    const record = typeof value === "object" && value !== null ? value : {};
    return {
      uuid: readStringRecord(record, ["uuid"]) ?? "",
      name: readStringRecord(record, ["name"]) ?? "",
      libraryUuid: readStringRecord(record, ["libraryUuid"]) ?? "",
      symbolUuid: readStringRecord(record, ["symbolUuid"]),
      symbolName: readStringRecord(record, ["symbolName"]),
      footprintUuid: readStringRecord(record, ["footprintUuid"]),
      footprintName: readStringRecord(record, ["footprintName"]),
      manufacturer: readStringRecord(record, ["manufacturer"]),
      supplier: readStringRecord(record, ["supplier"]),
      supplierId: readStringRecord(record, ["supplierId"]),
      lcscInventory: readNumberRecord(record, ["lcscInventory"]),
      lcscPrice: readNumberRecord(record, ["lcscPrice"]),
      jlcInventory: readNumberRecord(record, ["jlcInventory", "jlcInventory"]),
      jlcPrice: readNumberRecord(record, ["jlcPrice"]),
      description: readStringRecord(record, ["description"])
    };
  }
  function normalizeLibraryDeviceDetail(value) {
    const record = typeof value === "object" && value !== null ? value : {};
    return {
      uuid: readStringRecord(record, ["uuid"]) ?? "",
      name: readStringRecord(record, ["name"]),
      libraryUuid: readStringRecord(record, ["libraryUuid"]),
      lcscId: readStringRecord(record, ["supplierId", "lcscId"]),
      manufacturer: readStringRecord(record, ["manufacturer"]),
      supplier: readStringRecord(record, ["supplier"]),
      supplierId: readStringRecord(record, ["supplierId"]),
      description: readStringRecord(record, ["description"]),
      symbol: normalizeLinkedLibraryItem(record.symbol),
      footprint: normalizeLinkedLibraryItem(record.footprint),
      model3D: normalizeLinkedLibraryItem(record.model3D),
      otherProperty: typeof record.otherProperty === "object" && record.otherProperty !== null ? record.otherProperty : void 0,
      raw: value
    };
  }
  function normalizeLinkedLibraryItem(value) {
    if (typeof value !== "object" || value === null) {
      return void 0;
    }
    const record = value;
    return {
      uuid: readStringRecord(record, ["uuid"]),
      name: readStringRecord(record, ["name"]),
      libraryUuid: readStringRecord(record, ["libraryUuid"])
    };
  }
  function readStringRecord(record, keys) {
    for (const key of keys) {
      const value = record[key];
      if (typeof value === "string" && value.trim()) {
        return value;
      }
    }
    return void 0;
  }
  function readNumberRecord(record, keys) {
    for (const key of keys) {
      const value = record[key];
      if (typeof value === "number" && Number.isFinite(value)) {
        return value;
      }
    }
    return void 0;
  }

  // src/editor/host/standardHostApi.ts
  function resolveStandardHostCapabilities(rawApi) {
    return {
      getCurrentDocument: rawApi?.schematic?.getCurrentDocument ? async () => rawApi.schematic.getCurrentDocument() : void 0,
      getSelection: rawApi?.schematic?.getSelection ? async () => rawApi.schematic.getSelection() : void 0,
      locateObject: rawApi?.schematic?.locateObject ? async (target) => {
        await rawApi.schematic.locateObject(target);
      } : void 0,
      openExternal: rawApi?.shell?.openExternal ? async (url) => {
        await rawApi.shell.openExternal(url);
      } : void 0,
      previewApplyPlan: rawApi?.applyPlan?.preview ? async (plan) => rawApi.applyPlan.preview(plan) : void 0,
      applyPlan: rawApi?.applyPlan?.apply ? async (plan) => rawApi.applyPlan.apply(plan) : void 0,
      rollbackApplyPlan: rawApi?.applyPlan?.rollback ? async (transactionId) => rawApi.applyPlan.rollback(transactionId) : void 0
    };
  }
  function isStandardSchematicContext(value) {
    if (typeof value !== "object" || value === null) {
      return false;
    }
    const candidate = value;
    return Array.isArray(candidate.components) && Array.isArray(candidate.nets) && Array.isArray(candidate.pins);
  }
  function isStandardSelection(value) {
    return typeof value === "object" && value !== null && Array.isArray(value.objectIds);
  }

  // src/editor/host/bridgeFactory.ts
  function createHostBridge(options) {
    const { channel, rawApi } = options;
    if (channel === "professional") {
      return createProfessionalHostBridge(rawApi);
    }
    return createStandardHostBridge(rawApi);
  }
  function createStandardHostBridge(rawApi) {
    const capabilities = resolveStandardHostCapabilities(rawApi);
    const typedWindowAvailable = hasTypedWindowOpenCapability();
    const capabilityReport = buildCapabilityReport(
      "standard",
      Boolean(capabilities.getCurrentDocument || capabilities.getSelection),
      {
        getCurrentContext: Boolean(capabilities.getCurrentDocument),
        getSelection: Boolean(capabilities.getSelection),
        locate: Boolean(capabilities.locateObject)
      },
      {
        previewApplyPlan: Boolean(capabilities.previewApplyPlan),
        applyPlan: Boolean(capabilities.applyPlan),
        rollbackApplyPlan: Boolean(capabilities.rollbackApplyPlan),
        openExternal: Boolean(capabilities.openExternal || typedWindowAvailable),
        searchLibraryDevices: false,
        getLibraryDevice: false,
        getLibraryDevicesByLcscIds: false
      }
    );
    return {
      getChannel: () => "standard",
      isAvailable: () => Boolean(capabilities.getCurrentDocument || capabilities.getSelection),
      getCurrentContext: async () => mapRawDocumentToContext("standard", capabilities.getCurrentDocument, mockStandardContext),
      getSelection: async () => mapRawSelection(capabilities.getSelection, mockStandardContext.selection),
      locate: async (target) => {
        if (capabilities.locateObject) {
          await capabilities.locateObject(target);
          return;
        }
        ensureKnownTarget(mockStandardContext, target, "standard");
      },
      previewApplyPlan: capabilities.previewApplyPlan,
      applyPlan: capabilities.applyPlan,
      rollbackApplyPlan: capabilities.rollbackApplyPlan,
      openExternal: capabilities.openExternal,
      searchLibraryDevices: void 0,
      getLibraryDevice: void 0,
      getLibraryDevicesByLcscIds: void 0,
      getCapabilityReport: () => capabilityReport
    };
  }
  function createProfessionalHostBridge(rawApi) {
    const capabilities = resolveProfessionalHostCapabilities(rawApi);
    const typedWindowAvailable = hasTypedWindowOpenCapability();
    const capabilityReport = buildCapabilityReport(
      "professional",
      Boolean(capabilities.getCurrentDocument || capabilities.getSelection),
      {
        getCurrentContext: Boolean(capabilities.getCurrentDocument),
        getSelection: Boolean(capabilities.getSelection),
        locate: Boolean(capabilities.locateObject)
      },
      {
        previewApplyPlan: Boolean(capabilities.previewApplyPlan),
        applyPlan: Boolean(capabilities.applyPlan),
        rollbackApplyPlan: Boolean(capabilities.rollbackApplyPlan),
        openExternal: Boolean(capabilities.openExternal || typedWindowAvailable),
        searchLibraryDevices: Boolean(capabilities.searchLibraryDevices),
        getLibraryDevice: Boolean(capabilities.getLibraryDevice),
        getLibraryDevicesByLcscIds: Boolean(capabilities.getLibraryDevicesByLcscIds)
      }
    );
    return {
      getChannel: () => "professional",
      isAvailable: () => Boolean(capabilities.getCurrentDocument || capabilities.getSelection),
      getCurrentContext: async () => mapRawDocumentToContext("professional", capabilities.getCurrentDocument, mockProfessionalContext),
      getSelection: async () => mapRawSelection(capabilities.getSelection, mockProfessionalContext.selection),
      locate: async (target) => {
        if (capabilities.locateObject) {
          await capabilities.locateObject(target);
          return;
        }
        ensureKnownTarget(mockProfessionalContext, target, "professional");
      },
      previewApplyPlan: capabilities.previewApplyPlan,
      applyPlan: capabilities.applyPlan,
      rollbackApplyPlan: capabilities.rollbackApplyPlan,
      openExternal: capabilities.openExternal,
      searchLibraryDevices: capabilities.searchLibraryDevices,
      getLibraryDevice: capabilities.getLibraryDevice,
      getLibraryDevicesByLcscIds: capabilities.getLibraryDevicesByLcscIds,
      getCapabilityReport: () => capabilityReport
    };
  }
  async function mapRawDocumentToContext(channel, getCurrentDocument, fallback) {
    const typedDocumentContext = await getTypedDocumentContext(channel);
    if (!getCurrentDocument) {
      if (typedDocumentContext) {
        return {
          ...fallback,
          project: typedDocumentContext.project,
          selection: typedDocumentContext.selection
        };
      }
      return fallback;
    }
    const rawDocument = await getCurrentDocument();
    if (channel === "standard" && isStandardSchematicContext(rawDocument)) {
      return rawDocument;
    }
    if (channel === "professional" && isProfessionalSchematicContext(rawDocument)) {
      return rawDocument;
    }
    const normalized = normalizeSchematicContext(rawDocument, channel);
    if (normalized) {
      if (typedDocumentContext) {
        return {
          ...normalized,
          project: {
            ...normalized.project,
            projectId: typedDocumentContext.project.projectId ?? normalized.project.projectId,
            pageId: typedDocumentContext.project.pageId ?? normalized.project.pageId,
            channel
          },
          selection: typedDocumentContext.selection.objectIds.length > 0 ? typedDocumentContext.selection : normalized.selection
        };
      }
      return normalized;
    }
    if (typedDocumentContext) {
      return {
        ...fallback,
        project: typedDocumentContext.project,
        selection: typedDocumentContext.selection
      };
    }
    throw new Error(`${channel} host bridge could not map raw current document to schematic context`);
  }
  async function mapRawSelection(getSelection, fallback) {
    if (!getSelection) {
      return fallback;
    }
    const rawSelection = await getSelection();
    if (isStandardSelection(rawSelection) || isProfessionalSelection(rawSelection)) {
      return rawSelection;
    }
    const normalized = normalizeSelection(rawSelection);
    if (normalized) {
      return normalized;
    }
    return fallback;
  }
  function ensureKnownTarget(context, target, channel) {
    const knownObjectIds = /* @__PURE__ */ new Set([
      ...context.components.map((item) => item.id),
      ...context.pins.map((item) => item.id),
      ...context.nets.map((item) => item.id)
    ]);
    if (!knownObjectIds.has(target.objectId)) {
      throw new Error(`${channel} host bridge could not locate ${target.objectId}`);
    }
  }
  function normalizeSelection(raw) {
    if (Array.isArray(raw)) {
      const objectIds = raw.filter((item) => typeof item === "string");
      if (objectIds.length > 0) {
        return { objectIds };
      }
    }
    if (typeof raw !== "object" || raw === null) {
      return void 0;
    }
    const candidate = raw;
    const fromKnownKey = ["ids", "selectedIds", "shapeIds"].map((key) => candidate[key]).find((value) => Array.isArray(value));
    if (Array.isArray(fromKnownKey)) {
      return {
        objectIds: fromKnownKey.filter((item) => typeof item === "string")
      };
    }
    return void 0;
  }
  function normalizeSchematicContext(raw, channel) {
    if (typeof raw !== "object" || raw === null) {
      return void 0;
    }
    const candidate = raw;
    const components = pickArray(candidate, ["components", "compList", "symbols"]);
    const nets = pickArray(candidate, ["nets", "netList"]);
    const pins = pickArray(candidate, ["pins", "pinList"]);
    const selection = normalizeSelection(
      candidate.selection ?? candidate.selected ?? candidate.currentSelection ?? []
    ) ?? { objectIds: [] };
    const normalizedComponents = components.map((item, index) => normalizeComponent(item, index)).filter((item) => Boolean(item));
    const normalizedPins = pins.map((item, index) => normalizePin(item, index)).filter((item) => Boolean(item));
    const normalizedNets = nets.map((item, index) => normalizeNet(item, index)).filter((item) => Boolean(item));
    if (normalizedComponents.length === 0 && normalizedPins.length === 0 && normalizedNets.length === 0) {
      return void 0;
    }
    return {
      project: {
        channel,
        projectId: readString(candidate, ["projectId", "project_id"]),
        pageId: readString(candidate, ["pageId", "page_id", "sheetId"])
      },
      components: normalizedComponents,
      pins: normalizedPins,
      nets: normalizedNets,
      selection
    };
  }
  function buildCapabilityReport(channel, available, required, optional) {
    return {
      channel,
      available,
      missing: Object.entries(required).filter(([, value]) => !value).map(([key]) => key),
      optionalMissing: Object.entries(optional).filter(([, value]) => !value).map(([key]) => key)
    };
  }
  function normalizeComponent(item, index) {
    if (typeof item !== "object" || item === null) {
      return void 0;
    }
    const value = item;
    const id = readString(value, ["id", "uuid", "uid", "gId", "gid"]) ?? `cmp_auto_${index}`;
    return {
      id,
      ref: readString(value, ["ref", "designator", "name"]),
      name: readString(value, ["name", "title", "symbol"]),
      libraryId: readString(value, ["libraryId", "lib", "libId"]),
      packageName: readString(value, ["package", "footprint", "packageName"]),
      value: readString(value, ["value", "val"]),
      properties: normalizeProperties(value.properties)
    };
  }
  function normalizePin(item, index) {
    if (typeof item !== "object" || item === null) {
      return void 0;
    }
    const value = item;
    const id = readString(value, ["id", "uuid", "uid", "gId", "gid"]) ?? `pin_auto_${index}`;
    const componentId = readString(value, ["componentId", "component_id", "ownerId", "symbolId"]) ?? "cmp_unknown";
    return {
      id,
      componentId,
      pinNumber: readString(value, ["pinNumber", "num", "number"]),
      pinName: readString(value, ["pinName", "name", "label"]),
      electricalType: readString(value, ["electricalType", "type"])
    };
  }
  function normalizeNet(item, index) {
    if (typeof item !== "object" || item === null) {
      return void 0;
    }
    const value = item;
    const id = readString(value, ["id", "uuid", "uid", "gId", "gid"]) ?? `net_auto_${index}`;
    const nodeIds = pickArray(value, ["nodeIds", "nodes", "pins", "pinIds"]).filter(
      (node) => typeof node === "string"
    );
    return {
      id,
      name: readString(value, ["name", "netName", "label"]),
      nodeIds,
      isPower: readBoolean(value, ["isPower", "power"])
    };
  }
  function normalizeProperties(raw) {
    if (typeof raw !== "object" || raw === null) {
      return {};
    }
    const output = {};
    for (const [key, value] of Object.entries(raw)) {
      if (typeof value === "string") {
        output[key] = value;
        continue;
      }
      if (typeof value === "number" || typeof value === "boolean") {
        output[key] = String(value);
      }
    }
    return output;
  }
  function pickArray(target, keys) {
    for (const key of keys) {
      const value = target[key];
      if (Array.isArray(value)) {
        return value;
      }
    }
    return [];
  }
  function readString(target, keys) {
    for (const key of keys) {
      const value = target[key];
      if (typeof value === "string" && value.length > 0) {
        return value;
      }
    }
    return void 0;
  }
  function readBoolean(target, keys) {
    for (const key of keys) {
      const value = target[key];
      if (typeof value === "boolean") {
        return value;
      }
    }
    return void 0;
  }

  // src/editor/host/installHostBridge.ts
  function installHostBridge(options) {
    globalThis.LCEDA_PLUGIN_CHANNEL = options.channel;
    globalThis.LCEDA_HOST_BRIDGE = createHostBridge(options);
  }

  // src/editor/apply-plan/previewDraftPlan.ts
  function previewDraftPlan(plan) {
    return {
      title: plan.title,
      rationale: plan.selectedDevices && plan.selectedDevices.length > 0 ? `${plan.rationale} \u5DF2\u9009\u5668\u4EF6: ${plan.selectedDevices.map((item) => `${item.role}=${item.name}`).join(", ")}` : plan.rationale,
      componentRefs: plan.components.map((component) => component.ref ?? component.id),
      netNames: plan.nets.map((net) => net.name ?? net.id),
      componentCount: plan.components.length,
      netCount: plan.nets.length
    };
  }

  // src/editor/host/applyPlanByApi.ts
  var applyTransactions = /* @__PURE__ */ new Map();
  function createApiApplyPlanAdapter(invoker, options) {
    return {
      preview: async (plan) => previewDraftPlan(plan),
      apply: async (plan) => {
        const transactionId = createTransactionId();
        if (options?.typedPlacementEnabled && canApplyByTypedPlacement(plan)) {
          const placed = await applyTypedSchematicPlan(plan);
          applyTransactions.set(transactionId, {
            kind: "typed_schematic",
            componentIds: placed.componentIds,
            wireIds: placed.wireIds
          });
          return summarizeApply(plan, transactionId, true);
        }
        if (!invoker) {
          return summarizeApply(plan, transactionId, false);
        }
        const sourceRead = await tryInvokeCandidates(invoker, [
          ["getSource"],
          ["getSchSource"],
          ["getCurrentSchematic"]
        ]);
        if (sourceRead.called) {
          const mergedSource = mergeDraftIntoSource(sourceRead.value, plan);
          const sourceWrite = await tryInvokeCandidates(invoker, [
            ["applySource", mergedSource],
            ["applySource", JSON.stringify(mergedSource)],
            ["setSource", mergedSource],
            ["setSource", JSON.stringify(mergedSource)],
            ["updateSource", mergedSource],
            ["updateSource", JSON.stringify(mergedSource)]
          ]);
          if (!sourceWrite.called) {
            throw new Error("host api apply source failed: applySource/setSource/updateSource unavailable");
          }
          applyTransactions.set(transactionId, {
            kind: "source",
            sourceSnapshot: sourceRead.value
          });
          return summarizeApply(plan, transactionId, true);
        }
        const shapes = draftToShapes(plan);
        const createdShapeIds = [];
        for (const shape of shapes) {
          const existingResult = await tryInvokeCandidates(invoker, [
            ["getShape", shape.id],
            ["getShape", shape.kind, shape.id]
          ]);
          if (existingResult.called && existingResult.value !== void 0 && existingResult.value !== null) {
            const updated = await tryInvokeCandidates(invoker, [
              ["updateShape", shape.id, shape.payload],
              ["updateShape", shape.payload],
              ["updateShape", shape.kind, shape.id, shape.payload]
            ]);
            if (updated.called) {
              continue;
            }
          }
          const created = await tryInvokeCandidates(invoker, [
            ["createShape", shape.payload],
            ["createShape", shape.kind, shape.payload]
          ]);
          if (!created.called) {
            throw new Error(`host api apply shape failed: cannot create shape ${shape.id}`);
          }
          if (!(existingResult.called && existingResult.value !== void 0 && existingResult.value !== null)) {
            createdShapeIds.push(shape.id);
          }
        }
        applyTransactions.set(transactionId, {
          kind: "shape",
          shapeIds: createdShapeIds
        });
        return summarizeApply(plan, transactionId, createdShapeIds.length > 0);
      },
      rollback: async (transactionId) => {
        const tx = applyTransactions.get(transactionId);
        if (!tx) {
          return { rolledBack: false, transactionId };
        }
        if (tx.kind === "source") {
          if (!invoker) {
            return { rolledBack: false, transactionId };
          }
          const reverted = await tryInvokeCandidates(invoker, [
            ["applySource", tx.sourceSnapshot],
            ["setSource", tx.sourceSnapshot],
            ["updateSource", tx.sourceSnapshot]
          ]);
          if (reverted.called) {
            applyTransactions.delete(transactionId);
            return { rolledBack: true, transactionId };
          }
          return { rolledBack: false, transactionId };
        }
        if (tx.kind === "typed_schematic") {
          const deletedWire = await deleteTypedSchematicWires(tx.wireIds);
          const deletedComponent = await deleteTypedSchematicComponents(tx.componentIds);
          applyTransactions.delete(transactionId);
          return { rolledBack: deletedWire || deletedComponent, transactionId };
        }
        for (const shapeId of tx.shapeIds) {
          await tryInvokeCandidates(invoker, [
            ["deleteShape", shapeId],
            ["removeShape", shapeId]
          ]);
        }
        applyTransactions.delete(transactionId);
        return { rolledBack: tx.shapeIds.length > 0, transactionId };
      }
    };
  }
  function canApplyByTypedPlacement(plan) {
    if (typeof eda === "undefined") {
      return false;
    }
    if (typeof eda.sch_PrimitiveComponent?.create !== "function") {
      return false;
    }
    if (typeof eda.sch_PrimitiveWire?.create !== "function") {
      return false;
    }
    return plan.components.some((component) => {
      const deviceUuid = component.properties.device_uuid;
      const libraryUuid = component.properties.library_uuid;
      return typeof deviceUuid === "string" && deviceUuid && typeof libraryUuid === "string" && libraryUuid;
    });
  }
  async function applyTypedSchematicPlan(plan) {
    const componentIds = [];
    const wireIds = [];
    const placedPins = /* @__PURE__ */ new Map();
    const gridX = 140;
    const gridY = 100;
    for (const [index, component] of plan.components.entries()) {
      const deviceUuid = component.properties.device_uuid;
      const libraryUuid = component.properties.library_uuid;
      if (!deviceUuid || !libraryUuid) {
        continue;
      }
      const x = parsePlacementNumber(component.properties.placement_x) ?? 200 + index % 3 * gridX;
      const y = parsePlacementNumber(component.properties.placement_y) ?? 200 + Math.floor(index / 3) * gridY;
      const rotation = parsePlacementNumber(component.properties.placement_rotation) ?? 0;
      const created = await eda.sch_PrimitiveComponent.create(
        {
          uuid: deviceUuid,
          libraryUuid
        },
        x,
        y,
        void 0,
        rotation,
        false,
        true,
        true
      );
      if (!created) {
        continue;
      }
      const primitiveId = created.getState_PrimitiveId();
      componentIds.push(primitiveId);
      const pins = await eda.sch_PrimitiveComponent.getAllPinsByPrimitiveId(primitiveId);
      if (pins) {
        for (const pin of pins) {
          const pinName = pin.getState_PinName();
          const pinNumber = pin.getState_PinNumber();
          const planPin = findBestMatchingPlanPin(plan.pins, component.id, pinName, pinNumber);
          if (!planPin) {
            continue;
          }
          placedPins.set(planPin.id, {
            x: pin.getState_X(),
            y: pin.getState_Y(),
            primitiveId: pin.getState_PrimitiveId()
          });
        }
      }
    }
    for (const net of plan.nets) {
      const nodePoints = net.nodeIds.map((nodeId) => placedPins.get(nodeId)).filter((item) => Boolean(item));
      if (nodePoints.length < 2) {
        continue;
      }
      const line = buildOrthogonalPolyline(nodePoints);
      const createdWire = await eda.sch_PrimitiveWire.create(line, net.name);
      if (!createdWire) {
        continue;
      }
      wireIds.push(createdWire.getState_PrimitiveId());
    }
    return { componentIds, wireIds };
  }
  function parsePlacementNumber(value) {
    if (!value) {
      return void 0;
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : void 0;
  }
  function findBestMatchingPlanPin(pins, componentId, pinName, pinNumber) {
    const candidates = pins.filter((item) => item.componentId === componentId);
    if (candidates.length === 0) {
      return void 0;
    }
    const runtimeAliases = normalizePinSemantic(pinName, pinNumber);
    let bestScore = -1;
    let bestMatch;
    for (const candidate of candidates) {
      let score = 0;
      if (candidate.pinNumber && pinNumber && candidate.pinNumber === pinNumber) {
        score += 100;
      }
      if (candidate.pinName && pinName && candidate.pinName === pinName) {
        score += 90;
      }
      const candidateAliases = normalizePinSemantic(candidate.pinName, candidate.pinNumber);
      if (candidateAliases.some((alias) => runtimeAliases.includes(alias))) {
        score += 60;
      }
      if (candidate.electricalType) {
        const electricalAlias = normalizeElectricalType(candidate.electricalType);
        if (electricalAlias && runtimeAliases.includes(electricalAlias)) {
          score += 25;
        }
      }
      if (score > bestScore) {
        bestScore = score;
        bestMatch = candidate;
      }
    }
    return bestScore > 0 ? bestMatch : void 0;
  }
  function normalizePinSemantic(name, pinNumber) {
    const aliases = /* @__PURE__ */ new Set();
    const addAlias = (value) => {
      const normalized = normalizeToken(value);
      if (!normalized) {
        return;
      }
      aliases.add(normalized);
      const semantic = PIN_SEMANTIC_ALIASES[normalized];
      if (semantic) {
        aliases.add(semantic);
      }
    };
    if (name) {
      addAlias(name);
      for (const token of splitTokens(name)) {
        addAlias(token);
      }
    }
    if (pinNumber) {
      addAlias(pinNumber);
    }
    return [...aliases];
  }
  function normalizeElectricalType(type) {
    switch (type.toLowerCase()) {
      case "power_in":
        return "power_in";
      case "power_out":
        return "power_out";
      case "passive":
        return "passive";
      default:
        return void 0;
    }
  }
  function normalizeToken(value) {
    return value.trim().toLowerCase().replace(/[^a-z0-9+_-]+/g, "");
  }
  function splitTokens(value) {
    return value.split(/[\s/()[\]-]+/g).map((item) => item.trim()).filter((item) => item.length > 0);
  }
  var PIN_SEMANTIC_ALIASES = {
    vin: "power_in",
    in: "power_in",
    vi: "power_in",
    vcc: "power_in",
    vdd: "power_in",
    dcin: "power_in",
    pwrin: "power_in",
    vout: "power_out",
    out: "power_out",
    vo: "power_out",
    vreg: "power_out",
    "3v3": "power_out",
    "5v": "power_out",
    gnd: "ground",
    pgnd: "ground",
    agnd: "ground",
    ground: "ground",
    vss: "ground",
    neg: "negative",
    minus: "negative",
    n: "negative",
    "-": "negative",
    pos: "positive",
    plus: "positive",
    p: "positive",
    "+": "positive"
  };
  function buildOrthogonalPolyline(points) {
    if (points.length < 2) {
      return points.flatMap((point) => [point.x, point.y]);
    }
    const line = [points[0].x, points[0].y];
    for (let index = 1; index < points.length; index += 1) {
      const previous = points[index - 1];
      const current = points[index];
      const middleX = current.x;
      const middleY = previous.y;
      if (line[line.length - 2] !== middleX || line[line.length - 1] !== middleY) {
        line.push(middleX, middleY);
      }
      if (line[line.length - 2] !== current.x || line[line.length - 1] !== current.y) {
        line.push(current.x, current.y);
      }
    }
    return line;
  }
  async function deleteTypedSchematicComponents(componentIds) {
    if (typeof eda === "undefined" || typeof eda.sch_PrimitiveComponent?.delete !== "function") {
      return false;
    }
    if (componentIds.length === 0) {
      return false;
    }
    return eda.sch_PrimitiveComponent.delete(componentIds);
  }
  async function deleteTypedSchematicWires(wireIds) {
    if (typeof eda === "undefined" || typeof eda.sch_PrimitiveWire?.delete !== "function") {
      return false;
    }
    if (wireIds.length === 0) {
      return false;
    }
    return eda.sch_PrimitiveWire.delete(wireIds);
  }
  function summarizeApply(plan, transactionId, rollbackSupported) {
    return {
      applied: true,
      componentCount: plan.components.length,
      netCount: plan.nets.length,
      transactionId,
      rollbackSupported
    };
  }
  function mergeDraftIntoSource(rawSource, plan) {
    const base = normalizeSourceObject(rawSource);
    const components = normalizeArray(base.components);
    const pins = normalizeArray(base.pins);
    const nets = normalizeArray(base.nets);
    base.components = mergeById(components, plan.components);
    base.pins = mergeById(pins, plan.pins);
    base.nets = mergeById(nets, plan.nets);
    return base;
  }
  function normalizeSourceObject(rawSource) {
    const source = tryParseJsonString(rawSource);
    if (typeof source === "object" && source !== null) {
      return { ...source };
    }
    return {};
  }
  function normalizeArray(value) {
    if (!Array.isArray(value)) {
      return [];
    }
    return value.filter(
      (item) => typeof item === "object" && item !== null
    );
  }
  function mergeById(existing, incoming) {
    const map = /* @__PURE__ */ new Map();
    for (const item of existing) {
      const id = readId(item);
      if (id) {
        map.set(id, item);
      }
    }
    for (const item of incoming) {
      const id = readId(item);
      if (!id) {
        continue;
      }
      map.set(id, item);
    }
    return [...map.values()];
  }
  function readId(value) {
    const candidates = ["id", "uuid", "uid", "gId", "gid"];
    for (const key of candidates) {
      const raw = value[key];
      if (typeof raw === "string" && raw.length > 0) {
        return raw;
      }
    }
    return void 0;
  }
  function draftToShapes(plan) {
    const output = [];
    for (const component of plan.components) {
      output.push({
        id: component.id,
        kind: "component",
        payload: {
          type: "component",
          ...component
        }
      });
    }
    for (const net of plan.nets) {
      output.push({
        id: net.id,
        kind: "net",
        payload: {
          type: "net",
          ...net
        }
      });
    }
    return output;
  }
  async function tryInvokeCandidates(invoker, candidates) {
    for (const candidate of candidates) {
      const [name, arg1, arg2, arg3] = candidate;
      const args = [arg1, arg2, arg3].filter((item) => item !== void 0);
      try {
        return {
          called: true,
          value: await invoker(name, ...args)
        };
      } catch {
      }
    }
    return {
      called: false
    };
  }
  function tryParseJsonString(value) {
    if (typeof value !== "string") {
      return value;
    }
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }
  function createTransactionId() {
    return `apt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }

  // src/editor/host/professionalHostBridgeSource.ts
  function resolveProfessionalRawHostApi() {
    const runtime = globalThis;
    const callApi = resolveApiInvoker(runtime);
    const applyPlanAdapter = createApiApplyPlanAdapter(callApi, {
      typedPlacementEnabled: hasTypedSchematicPlacementRuntime()
    });
    const fromNamespace = runtime.lcPro;
    if (!fromNamespace && !callApi && !hasTypedHostRuntime()) {
      return void 0;
    }
    return {
      editor: {
        getActiveSchematicContext: fromNamespace?.editor?.getActiveSchematicContext ? fromNamespace.editor.getActiveSchematicContext : async () => {
          const typedDocumentContext = await getTypedDocumentContext("professional");
          if (typedDocumentContext) {
            return typedDocumentContext;
          }
          const result = await callApiCandidate(callApi, [
            ["getSource"],
            ["getSchSource"],
            ["getCurrentSchematic"]
          ]);
          return tryParseJsonString2(result);
        },
        getCurrentSelection: fromNamespace?.editor?.getCurrentSelection ? fromNamespace.editor.getCurrentSelection : async () => {
          const typedSelection = await getTypedSelection();
          if (typedSelection) {
            return typedSelection;
          }
          return callApiCandidate(callApi, [
            ["getSelectShape"],
            ["getSelection"],
            ["getSelected"]
          ]);
        },
        locateEntity: fromNamespace?.editor?.locateEntity ? fromNamespace.editor.locateEntity : async (target) => {
          if (await locateTypedHostObject(target)) {
            return;
          }
          await callApiCandidate(callApi, [
            ["selectShape", [target.objectId]],
            ["selectShape", target.objectId],
            ["locateShape", target.objectId],
            ["focusShape", target.objectId]
          ]);
        }
      },
      system: {
        openBrowser: fromNamespace?.system?.openBrowser ? fromNamespace.system.openBrowser : runtime.shell?.openBrowser ? runtime.shell.openBrowser : runtime.shell?.openExternal ? runtime.shell.openExternal : async (url) => {
          if (openTypedHostWindow(url)) {
            return;
          }
          await callApiCandidate(callApi, [
            ["openBrowser", url],
            ["openExternal", url],
            ["openUrl", url]
          ]);
        }
      },
      library: {
        searchDevices: fromNamespace?.library?.searchDevices ? fromNamespace.library.searchDevices : async (input) => {
          const typedResults = await typedSearchLibraryDevices(input);
          if (typedResults) {
            return typedResults;
          }
          if (!hasTypedLibraryRuntime()) {
            throw new Error("professional host library search is not available");
          }
          return [];
        },
        getDevice: fromNamespace?.library?.getDevice ? fromNamespace.library.getDevice : async (input) => {
          const typedResult = await typedGetLibraryDevice(input);
          if (typedResult) {
            return typedResult;
          }
          throw new Error("professional host library get is not available");
        },
        getDevicesByLcscIds: fromNamespace?.library?.getDevicesByLcscIds ? fromNamespace.library.getDevicesByLcscIds : async (input) => {
          const typedResults = await typedGetLibraryDevicesByLcscIds(input);
          if (typedResults) {
            return typedResults;
          }
          throw new Error("professional host library getByLcscIds is not available");
        }
      },
      applyPlan: {
        preview: fromNamespace?.applyPlan?.preview ? fromNamespace.applyPlan.preview : applyPlanAdapter.preview,
        apply: fromNamespace?.applyPlan?.apply ? fromNamespace.applyPlan.apply : applyPlanAdapter.apply,
        rollback: fromNamespace?.applyPlan?.rollback ? fromNamespace.applyPlan.rollback : applyPlanAdapter.rollback
      }
    };
  }
  function resolveApiInvoker(runtime) {
    if (!runtime.api) {
      return void 0;
    }
    return async (name, ...args) => runtime.api(name, ...args);
  }
  async function callApiCandidate(invoker, candidates) {
    if (!invoker) {
      return void 0;
    }
    for (const candidate of candidates) {
      const [name] = candidate;
      let args = [];
      if (candidate.length > 1) {
        const payload = candidate[1];
        args = Array.isArray(payload) ? payload : [payload];
      }
      try {
        return await invoker(name, ...args);
      } catch {
      }
    }
    return void 0;
  }
  function tryParseJsonString2(value) {
    if (typeof value !== "string") {
      return value;
    }
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }

  // src/editor/host/standardHostBridgeSource.ts
  function resolveStandardRawHostApi() {
    const runtime = globalThis;
    const callApi = resolveApiInvoker2(runtime);
    const applyPlanAdapter = createApiApplyPlanAdapter(callApi);
    const fromNamespace = runtime.lc;
    if (!fromNamespace && !callApi && !hasTypedHostRuntime()) {
      return void 0;
    }
    return {
      schematic: {
        getCurrentDocument: fromNamespace?.schematic?.getCurrentDocument ? fromNamespace.schematic.getCurrentDocument : async () => {
          const typedDocumentContext = await getTypedDocumentContext("standard");
          if (typedDocumentContext) {
            return typedDocumentContext;
          }
          const result = await callApiCandidate2(callApi, [
            ["getSource"],
            ["getSchSource"],
            ["getCurrentSchematic"]
          ]);
          return tryParseJsonString3(result);
        },
        getSelection: fromNamespace?.schematic?.getSelection ? fromNamespace.schematic.getSelection : async () => {
          const typedSelection = await getTypedSelection();
          if (typedSelection) {
            return typedSelection;
          }
          return callApiCandidate2(callApi, [
            ["getSelectShape"],
            ["getSelection"],
            ["getSelected"]
          ]);
        },
        locateObject: fromNamespace?.schematic?.locateObject ? fromNamespace.schematic.locateObject : async (target) => {
          if (await locateTypedHostObject(target)) {
            return;
          }
          await callApiCandidate2(callApi, [
            ["selectShape", [target.objectId]],
            ["selectShape", target.objectId],
            ["locateShape", target.objectId],
            ["focusShape", target.objectId]
          ]);
        }
      },
      shell: {
        openExternal: fromNamespace?.shell?.openExternal ? fromNamespace.shell.openExternal : runtime.shell?.openExternal ? runtime.shell.openExternal : runtime.shell?.openBrowser ? runtime.shell.openBrowser : async (url) => {
          if (openTypedHostWindow(url)) {
            return;
          }
          await callApiCandidate2(callApi, [
            ["openExternal", url],
            ["openBrowser", url],
            ["openUrl", url]
          ]);
        }
      },
      applyPlan: {
        preview: fromNamespace?.applyPlan?.preview ? fromNamespace.applyPlan.preview : applyPlanAdapter.preview,
        apply: fromNamespace?.applyPlan?.apply ? fromNamespace.applyPlan.apply : applyPlanAdapter.apply,
        rollback: fromNamespace?.applyPlan?.rollback ? fromNamespace.applyPlan.rollback : applyPlanAdapter.rollback
      }
    };
  }
  function resolveApiInvoker2(runtime) {
    if (!runtime.api) {
      return void 0;
    }
    return async (name, ...args) => runtime.api(name, ...args);
  }
  async function callApiCandidate2(invoker, candidates) {
    if (!invoker) {
      return void 0;
    }
    for (const candidate of candidates) {
      const [name] = candidate;
      let args = [];
      if (candidate.length > 1) {
        const payload = candidate[1];
        args = Array.isArray(payload) ? payload : [payload];
      }
      try {
        return await invoker(name, ...args);
      } catch {
      }
    }
    return void 0;
  }
  function tryParseJsonString3(value) {
    if (typeof value !== "string") {
      return value;
    }
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }

  // src/editor/host/autoInstallHostBridge.ts
  function autoInstallHostBridge(preferredChannel) {
    if (preferredChannel === "professional") {
      const professionalApi2 = resolveProfessionalRawHostApi();
      if (professionalApi2) {
        installHostBridge({
          channel: "professional",
          rawApi: professionalApi2
        });
        return "professional";
      }
    }
    if (preferredChannel === "standard") {
      const standardApi2 = resolveStandardRawHostApi();
      if (standardApi2) {
        installHostBridge({
          channel: "standard",
          rawApi: standardApi2
        });
        return "standard";
      }
    }
    const professionalApi = resolveProfessionalRawHostApi();
    if (professionalApi) {
      installHostBridge({
        channel: "professional",
        rawApi: professionalApi
      });
      return "professional";
    }
    const standardApi = resolveStandardRawHostApi();
    if (standardApi) {
      installHostBridge({
        channel: "standard",
        rawApi: standardApi
      });
      return "standard";
    }
    return void 0;
  }

  // src/agent/intent/intentClassifier.ts
  function classifyAgentIntent(input) {
    const trimmed = input.trim();
    const lower = trimmed.toLowerCase();
    const isDraftRequest = /生成(?:一版|一个|电路|原理图|草案)?|画(?:一个|一版|出)?|设计(?:一个|一版)?|搭一个|帮我做一个/.test(trimmed) || lower.includes("draft") || lower.includes("generate schematic") || lower.includes("draw");
    if (isDraftRequest) {
      return "draft";
    }
    const isAnalysisRequest = /分析|检查|排查|review|analy[sz]e|检查当前|分析当前|看看问题|有什么问题|帮我看下|哪里有问题|有无问题/.test(trimmed) || lower.includes("analyze") || lower.includes("review") || lower.includes("check");
    if (isAnalysisRequest) {
      return "analysis";
    }
    return "chat";
  }

  // src/agent/agentRunner.ts
  function planUserTurn(userQuery) {
    const intent = classifyAgentIntent(userQuery);
    if (intent === "draft") {
      return {
        intent,
        route: "draft",
        requiresContext: true,
        steps: [
          planStep("context", true, "read current schematic context"),
          planStep("mcp", true, "load engineering knowledge references"),
          planStep("library", true, "search library devices and candidate parts"),
          planStep("llm", true, "ask llm to plan the draft structure"),
          planStep("rules", true, "validate draft constraints against schematic state"),
          planStep("draft", true, "build draft plan and preview")
        ]
      };
    }
    if (intent === "analysis") {
      return {
        intent,
        route: "analysis",
        requiresContext: true,
        steps: [
          planStep("context", true, "read current schematic context"),
          planStep("mcp", true, "load relevant engineering knowledge references"),
          planStep("rules", true, "run schematic checks and issue location")
        ]
      };
    }
    return {
      intent,
      route: "chat",
      requiresContext: false,
      steps: [planStep("llm", true, "reply naturally with conversation memory and optional host context")]
    };
  }
  async function executeAgentTurn(input, deps) {
    const stepStates = input.plan.steps.map((step2) => ({
      ...step2,
      status: "pending"
    }));
    const workingMemory = {
      hasContext: Boolean(input.context && input.adapter),
      mcpReady: false,
      libraryReady: false,
      llmReady: false,
      rulesReady: false,
      draftReady: false
    };
    const plannerTraces = [
      {
        phase: "reason",
        message: buildPlanTraceMessage(input.plan)
      }
    ];
    const plannerUiEvents = [
      {
        kind: "plan",
        label: "Plan",
        status: "done",
        text: buildPlanUiMessage(input.plan),
        source: "planner"
      }
    ];
    for (const [index, step2] of input.plan.steps.entries()) {
      if (!step2.required) {
        stepStates[index].status = "skipped";
        stepStates[index].observation = "optional step skipped by planner";
        plannerTraces.push({
          phase: "observe",
          message: `planner skipped optional step=${step2.kind}`
        });
        plannerUiEvents.push({
          kind: mapPlannerStepKind(step2.kind),
          label: mapPlannerStepLabel(step2.kind),
          status: "skipped",
          text: "optional step skipped by planner",
          source: "planner",
          stepKind: step2.kind
        });
        continue;
      }
      stepStates[index].status = "running";
      plannerTraces.push({
        phase: "reason",
        message: `planner selected step=${step2.kind} note=${step2.note}; memory=${summarizeMemory(workingMemory)}`
      });
      plannerUiEvents.push({
        kind: mapPlannerStepKind(step2.kind),
        label: mapPlannerStepLabel(step2.kind),
        status: "running",
        text: step2.note,
        source: "planner",
        stepKind: step2.kind
      });
      try {
        if (step2.kind === "context") {
          assertContextAvailable(input.plan, input.context, input.adapter);
          workingMemory.hasContext = true;
          markStepObserved(stepStates, index, "done", "schematic context ready");
          workingMemory.lastObservation = "schematic context ready";
          plannerTraces.push({
            phase: "observe",
            message: "planner confirmed schematic context is available"
          });
          plannerUiEvents.push({
            kind: "read",
            label: "Context",
            status: "done",
            text: "schematic context ready",
            source: "planner",
            stepKind: "context"
          });
          continue;
        }
        if (step2.kind === "mcp") {
          workingMemory.mcpReady = true;
          markStepObserved(stepStates, index, "done", "mcp capability delegated to executor");
          workingMemory.lastObservation = "mcp capability delegated";
          plannerTraces.push({
            phase: "observe",
            message: "planner delegated mcp collection to executor"
          });
          plannerUiEvents.push({
            kind: "read",
            label: "Knowledge",
            status: "done",
            text: "mcp capability delegated to executor",
            source: "planner",
            stepKind: "mcp"
          });
          continue;
        }
        if (step2.kind === "library") {
          workingMemory.libraryReady = true;
          markStepObserved(stepStates, index, "done", "library capability delegated to executor");
          workingMemory.lastObservation = "library capability delegated";
          plannerTraces.push({
            phase: "observe",
            message: "planner delegated library lookup to executor"
          });
          plannerUiEvents.push({
            kind: "search",
            label: "Library",
            status: "done",
            text: "library capability delegated to executor",
            source: "planner",
            stepKind: "library"
          });
          continue;
        }
        if (step2.kind === "llm") {
          workingMemory.llmReady = true;
          if (input.plan.route === "chat") {
            const result = await deps.runNaturalChat(input.userQuery, input.panelState);
            return finalizePlanResult({
              plan: input.plan,
              route: input.plan.route,
              result,
              userQuery: input.userQuery,
              panelState: input.panelState,
              context: input.context,
              adapter: input.adapter,
              deps,
              plannerTraces,
              plannerUiEvents,
              stepStates,
              workingMemory
            });
          }
          markStepObserved(stepStates, index, "done", "llm capability delegated to executor");
          workingMemory.lastObservation = "llm capability delegated";
          plannerTraces.push({
            phase: "observe",
            message: "planner delegated llm reasoning to executor"
          });
          plannerUiEvents.push({
            kind: "call",
            label: "LLM",
            status: "done",
            text: "llm capability delegated to executor",
            source: "planner",
            stepKind: "llm"
          });
          continue;
        }
        if (step2.kind === "rules") {
          workingMemory.rulesReady = true;
          if (input.plan.route === "analysis") {
            assertContextAvailable(input.plan, input.context, input.adapter);
            const result = await deps.runAnalysis(input.userQuery, input.context, input.adapter);
            return finalizePlanResult({
              plan: input.plan,
              route: input.plan.route,
              result,
              userQuery: input.userQuery,
              panelState: input.panelState,
              context: input.context,
              adapter: input.adapter,
              deps,
              plannerTraces,
              plannerUiEvents,
              stepStates,
              workingMemory
            });
          }
          markStepObserved(stepStates, index, "done", "rules validation delegated to executor");
          workingMemory.lastObservation = "rules validation delegated";
          plannerTraces.push({
            phase: "observe",
            message: "planner delegated rules validation to executor"
          });
          plannerUiEvents.push({
            kind: "validate",
            label: "Validate",
            status: "done",
            text: "rules validation delegated to executor",
            source: "planner",
            stepKind: "rules"
          });
          continue;
        }
        if (step2.kind === "draft") {
          workingMemory.draftReady = true;
          if (input.plan.route === "draft") {
            assertContextAvailable(input.plan, input.context, input.adapter);
            const result = await deps.runDraft(input.userQuery, input.context, input.adapter);
            return finalizePlanResult({
              plan: input.plan,
              route: input.plan.route,
              result,
              userQuery: input.userQuery,
              panelState: input.panelState,
              context: input.context,
              adapter: input.adapter,
              deps,
              plannerTraces,
              plannerUiEvents,
              stepStates,
              workingMemory
            });
          }
          markStepObserved(stepStates, index, "done", "draft capability marked ready");
          workingMemory.lastObservation = "draft capability marked ready";
          plannerTraces.push({
            phase: "observe",
            message: "planner confirmed draft capability is ready"
          });
          plannerUiEvents.push({
            kind: "update",
            label: "Draft",
            status: "done",
            text: "draft capability marked ready",
            source: "planner",
            stepKind: "draft"
          });
          continue;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        markStepObserved(stepStates, index, "failed", message);
        workingMemory.lastObservation = message;
        plannerUiEvents.push({
          kind: mapPlannerStepKind(step2.kind),
          label: mapPlannerStepLabel(step2.kind),
          status: "failed",
          text: message,
          source: "planner",
          stepKind: step2.kind
        });
        throw error;
      }
    }
    return prependPlannerState(
      {
        summary: "planner produced no executable terminal step",
        toolTraceNames: [],
        executionTraces: [
          {
            phase: "finish",
            message: "planner produced no executable terminal step"
          }
        ],
        uiEvents: [
          ...plannerUiEvents,
          {
            kind: "finish",
            label: "Finish",
            status: "done",
            text: "planner produced no executable terminal step",
            source: "planner"
          }
        ]
      },
      plannerTraces,
      plannerUiEvents,
      stepStates,
      workingMemory
    );
  }
  async function finalizePlanResult(input) {
    const baseResult = prependPlannerState(
      input.result,
      input.plannerTraces,
      input.plannerUiEvents,
      input.stepStates,
      input.workingMemory
    );
    const followup = input.plan.followup;
    if (!shouldExecuteFollowup(input.plan.route, followup, baseResult)) {
      return baseResult;
    }
    if (followup.requiresContext) {
      assertContextAvailable(
        {
          ...input.plan,
          route: followup.route,
          requiresContext: followup.requiresContext,
          steps: followup.steps
        },
        input.context,
        input.adapter
      );
    }
    const followupStart = createFollowupStartTrace(input.plan.route, followup);
    let followupResult;
    if (followup.route === "draft") {
      followupResult = await input.deps.runDraft(input.userQuery, input.context, input.adapter);
    } else if (followup.route === "analysis") {
      followupResult = await input.deps.runAnalysis(input.userQuery, input.context, input.adapter);
    } else {
      followupResult = await input.deps.runNaturalChat(input.userQuery, input.panelState);
    }
    return mergeFollowupResult(baseResult, followupResult, followupStart, input.plan.route, followup.route);
  }
  function assertContextAvailable(plan, context, adapter) {
    if (!context || !adapter) {
      throw new Error(`context and adapter are required for ${plan.route} route`);
    }
  }
  function prependPlannerState(result, plannerTraces, plannerUiEvents, stepStates, workingMemory) {
    const mergedStepStates = mergeStepStates(stepStates, result.stepStates ?? []);
    const mergedWorkingMemory = {
      ...workingMemory,
      ...result.workingMemory ?? {}
    };
    return {
      ...result,
      executionTraces: [...plannerTraces, ...result.executionTraces ?? []],
      uiEvents: [...plannerUiEvents, ...result.uiEvents ?? []],
      stepStates: mergedStepStates,
      workingMemory: mergedWorkingMemory
    };
  }
  function shouldExecuteFollowup(route, followup, result) {
    if (!followup) {
      return false;
    }
    if (route === "analysis" && followup.route === "draft") {
      return !result.draftRisk || result.draftRisk.level !== "blocked";
    }
    return false;
  }
  function createFollowupStartTrace(route, followup) {
    const requiredSteps = followup.steps.filter((step2) => step2.required).map((step2) => step2.kind).join(">") || "none";
    return {
      execution: [
        {
          phase: "reason",
          message: `planner followup executing ${route}->${followup.route} steps=${requiredSteps}${followup.when ? ` when=${followup.when}` : ""}`
        }
      ],
      ui: [
        {
          kind: "plan",
          label: "Follow-up",
          status: "running",
          text: `\u6267\u884C\u540E\u7EED\u9636\u6BB5 ${route} -> ${followup.route}`,
          source: "planner"
        }
      ]
    };
  }
  function mergeFollowupResult(primary, followup, startTrace, fromRoute, toRoute) {
    const summary = followup.summary || primary.summary;
    const executionTraces = [
      ...primary.executionTraces ?? [],
      ...startTrace.execution,
      ...followup.executionTraces ?? [],
      {
        phase: "finish",
        message: `planner followup executed ${fromRoute}->${toRoute}`
      }
    ];
    const uiEvents = [
      ...primary.uiEvents ?? [],
      ...startTrace.ui,
      ...followup.uiEvents ?? [],
      {
        kind: "finish",
        label: "Follow-up",
        status: "done",
        text: `\u540E\u7EED\u9636\u6BB5\u5DF2\u5B8C\u6210\uFF1A${fromRoute} -> ${toRoute}`,
        source: "planner"
      }
    ];
    return {
      ...primary,
      ...followup,
      summary,
      toolTraceNames: dedupeStrings([...primary.toolTraceNames ?? [], ...followup.toolTraceNames ?? []]),
      toolTraces: [...primary.toolTraces ?? [], ...followup.toolTraces ?? []],
      executionTraces,
      uiEvents,
      reactEvents: [...primary.reactEvents ?? [], ...followup.reactEvents ?? []],
      stepStates: mergeStepStates(primary.stepStates, followup.stepStates),
      workingMemory: {
        ...primary.workingMemory ?? emptyWorkingMemory(),
        ...followup.workingMemory ?? {}
      },
      nextSuggestions: dedupeStrings([...primary.nextSuggestions ?? [], ...followup.nextSuggestions ?? []]),
      structuredSuggestions: [...primary.structuredSuggestions ?? [], ...followup.structuredSuggestions ?? []],
      mcpResources: [...primary.mcpResources ?? [], ...followup.mcpResources ?? []],
      mcpResourceReads: [...primary.mcpResourceReads ?? [], ...followup.mcpResourceReads ?? []],
      libraryInsights: [...primary.libraryInsights ?? [], ...followup.libraryInsights ?? []]
    };
  }
  function buildPlanTraceMessage(plan) {
    const mainSteps = plan.steps.filter((step2) => step2.required).map((step2) => step2.kind).join(">") || "none";
    const followup = plan.followup ? ` followup=${plan.followup.route}:${plan.followup.steps.filter((step2) => step2.required).map((step2) => step2.kind).join(">") || "none"}` : "";
    return `planner route=${plan.route} context=${plan.requiresContext} steps=${mainSteps}${followup}`;
  }
  function buildPlanUiMessage(plan) {
    const steps = plan.steps.filter((step2) => step2.required).map((step2) => mapPlannerStepLabel(step2.kind)).join(" -> ");
    const followup = plan.followup ? `; Follow-up ${plan.followup.route}${plan.followup.when ? ` (${plan.followup.when})` : ""}` : "";
    return `Route ${plan.route}${steps ? `, steps: ${steps}` : ""}${followup}`;
  }
  function planStep(kind, required, note) {
    return { kind, required, note };
  }
  function markStepObserved(stepStates, index, status, observation) {
    stepStates[index].status = status;
    stepStates[index].observation = observation;
  }
  function summarizeMemory(memory) {
    return [
      `ctx=${memory.hasContext}`,
      `mcp=${memory.mcpReady}`,
      `library=${memory.libraryReady}`,
      `llm=${memory.llmReady}`,
      `rules=${memory.rulesReady}`,
      `draft=${memory.draftReady}`
    ].join(",");
  }
  function mapPlannerStepKind(kind) {
    switch (kind) {
      case "context":
        return "read";
      case "mcp":
        return "read";
      case "library":
        return "search";
      case "llm":
        return "call";
      case "rules":
        return "validate";
      case "draft":
        return "update";
      default:
        return "update";
    }
  }
  function mapPlannerStepLabel(kind) {
    switch (kind) {
      case "context":
        return "Context";
      case "mcp":
        return "Knowledge";
      case "library":
        return "Library";
      case "llm":
        return "LLM";
      case "rules":
        return "Validate";
      case "draft":
        return "Draft";
      default:
        return kind;
    }
  }
  function mergeStepStates(plannerStates, executorStates) {
    const plannerList = Array.isArray(plannerStates) ? plannerStates : [];
    const executorList = Array.isArray(executorStates) ? executorStates : [];
    const merged = /* @__PURE__ */ new Map();
    for (const step2 of plannerList) {
      merged.set(step2.kind, { ...step2 });
    }
    for (const step2 of executorList) {
      const existing = merged.get(step2.kind);
      merged.set(step2.kind, {
        ...existing ?? step2,
        ...step2
      });
    }
    return Array.from(merged.values());
  }
  function dedupeStrings(values) {
    return Array.from(new Set(values.filter(Boolean)));
  }
  function emptyWorkingMemory() {
    return {
      hasContext: false,
      mcpReady: false,
      libraryReady: false,
      llmReady: false,
      rulesReady: false,
      draftReady: false
    };
  }

  // src/agent/prompts/plannerPrompts.ts
  function buildPlannerSystemPrompt() {
    return [
      "\u4F60\u662F\u5609\u7ACB\u521B EDA \u63D2\u4EF6\u7AEF agent \u7684 planner\u3002",
      "\u4F60\u7684\u804C\u8D23\u662F\u6839\u636E\u7528\u6237\u8F93\u5165\u5224\u65AD\u672C\u8F6E\u4E3B route\u3001\u662F\u5426\u9700\u8981\u4E0A\u4E0B\u6587\u3001\u6267\u884C\u6B65\u9AA4\uFF0C\u4EE5\u53CA\u662F\u5426\u5B58\u5728\u540E\u7EED\u9636\u6BB5\u3002",
      "\u4F18\u5148\u8F93\u51FA\u80FD\u8986\u76D6\u7528\u6237\u771F\u5B9E\u610F\u56FE\u7684 plan\uFF1B\u5982\u679C\u7528\u6237\u8BF7\u6C42\u662F\u591A\u6B65\u9AA4\u4EFB\u52A1\uFF0C\u8BF7\u8F93\u51FA followup\u3002",
      "analysis \u7528\u4E8E\u5206\u6790\u3001\u68C0\u67E5\u3001\u6392\u67E5\u3001\u89E3\u91CA\u5F53\u524D\u539F\u7406\u56FE\u95EE\u9898\u3002",
      "draft \u7528\u4E8E\u751F\u6210\u3001\u4FEE\u6539\u3001\u8BBE\u8BA1\u539F\u7406\u56FE\u8349\u6848\u3002",
      "chat \u7528\u4E8E\u81EA\u7136\u95EE\u7B54\u3001\u6F84\u6E05\u9700\u6C42\u3001\u89E3\u91CA\u6982\u5FF5\u3002",
      "\u5982\u679C\u8BF7\u6C42\u5305\u542B\u5148\u5206\u6790\u518D\u751F\u6210\u8349\u6848\u3001\u5148\u68C0\u67E5\u518D\u5EFA\u8BAE\u4FEE\u6539\uFF0C\u4F18\u5148\u4E3B route=analysis\uFF0C\u5E76\u8BBE\u7F6E followup.route=draft\u3002",
      "\u5982\u679C\u8BF7\u6C42\u660E\u786E\u8981\u6C42\u8BBE\u8BA1\u3001\u751F\u6210\u3001\u7ED8\u5236\u7535\u8DEF\uFF0Croute=draft\u3002",
      "\u8F93\u51FA\u5FC5\u987B\u662F JSON\uFF1A",
      '{"intent":"chat|analysis|draft","route":"chat|analysis|draft","requiresContext":true,"steps":["context","mcp","rules","library","llm","draft"],"followup":{"route":"chat|analysis|draft","requiresContext":true,"steps":["context","mcp","rules","library","llm","draft"],"when":"..."}}',
      "steps \u53EA\u80FD\u4F7F\u7528 context,mcp,rules,library,llm,draft\u3002",
      "\u5982\u679C\u6CA1\u6709\u540E\u7EED\u9636\u6BB5\uFF0Cfollowup \u7701\u7565\u3002"
    ].join("\n");
  }
  function buildPlannerUserPrompt(userQuery) {
    return [`\u7528\u6237\u8F93\u5165\uFF1A${userQuery}`, "\u8BF7\u8F93\u51FA JSON plan\u3002"].join("\n\n");
  }
  function normalizePlannerPlan(rawText) {
    if (!rawText) return void 0;
    try {
      const parsed = JSON.parse(extractJson(rawText));
      if (!parsed.intent || !parsed.route || !Array.isArray(parsed.steps)) {
        return void 0;
      }
      const allowed = ["context", "mcp", "rules", "library", "llm", "draft"];
      const steps = parsed.steps.filter((item) => allowed.includes(item));
      if (steps.length === 0) return void 0;
      return {
        intent: parsed.intent,
        route: parsed.route,
        requiresContext: Boolean(parsed.requiresContext),
        steps: steps.map((kind) => step(kind, `planner selected ${kind}`)),
        followup: parsed.followup && parsed.followup.route && Array.isArray(parsed.followup.steps) && parsed.followup.steps.length > 0 ? {
          route: parsed.followup.route,
          requiresContext: Boolean(parsed.followup.requiresContext),
          steps: parsed.followup.steps.filter((item) => allowed.includes(item)).map((kind) => step(kind, `planner followup selected ${kind}`)),
          when: parsed.followup.when
        } : void 0
      };
    } catch {
      return void 0;
    }
  }
  function step(kind, note) {
    return { kind, required: true, note };
  }
  function extractJson(text) {
    const match = text.match(/\{[\s\S]*\}/);
    return match ? match[0] : text;
  }

  // src/agent/skills/skillLoader.ts
  var SKILLS = {
    "natural-chat-skill": {
      name: "natural-chat-skill",
      description: "Handle natural conversation and requirement clarification",
      allowedTools: [
        "llm.generate",
        "editor.get_current_context",
        "editor.get_selection",
        "editor.describe_selection",
        "editor.describe_object",
        "editor.find_object",
        "rag.search",
        "rag.build_citations",
        "library.search_devices",
        "library.get_device"
      ],
      outputMode: "chat_result",
      promptKey: "chat"
    },
    "schematic-analysis-skill": {
      name: "schematic-analysis-skill",
      description: "Analyze schematic issues with evidence",
      allowedTools: [
        "editor.get_current_context",
        "schematic.summarize_bom",
        "schematic.identify_key_components",
        "schematic.identify_functional_blocks",
        "schematic.identify_power_domains",
        "schematic.summarize_connectivity",
        "schematic.trace_power_paths",
        "schematic.trace_signal_paths",
        "schematic.trace_control_paths",
        "rules.run_schematic_checks",
        "issues.locate_first",
        "library.search_devices",
        "library.get_device",
        "mcp.list_resources",
        "mcp.read_resource",
        "rag.search",
        "rag.build_citations",
        "llm.generate"
      ],
      outputMode: "analysis_result",
      promptKey: "analysis"
    },
    "component-explain-skill": {
      name: "component-explain-skill",
      description: "Explain selected components with RAG evidence",
      allowedTools: ["editor.get_selection", "mcp.list_resources", "mcp.read_resource", "rag.search", "rag.build_citations", "llm.generate"],
      outputMode: "analysis_result",
      promptKey: "analysis"
    },
    "wiring-standards-check-skill": {
      name: "wiring-standards-check-skill",
      description: "Run wiring standards checks and explain risks",
      allowedTools: ["editor.get_current_context", "rules.run_schematic_checks", "issues.locate_first", "mcp.list_resources", "mcp.read_resource", "rag.search"],
      outputMode: "analysis_result",
      promptKey: "analysis"
    },
    "power-module-draft-skill": {
      name: "power-module-draft-skill",
      description: "Generate power-related draft with citations and validation",
      allowedTools: [
        "editor.get_current_context",
        "rag.search",
        "rag.build_citations",
        "llm.generate",
        "mcp.list_resources",
        "mcp.read_resource",
        "library.search_devices",
        "library.get_device",
        "library.get_devices_by_lcsc_ids",
        "draft.generate_plan",
        "draft.preview_plan",
        "rules.validate_draft",
        "editor.preview_apply_plan"
      ],
      outputMode: "draft_result",
      promptKey: "draft"
    },
    "generic-schematic-draft-skill": {
      name: "generic-schematic-draft-skill",
      description: "Generate generic schematic draft and validate before apply",
      allowedTools: [
        "editor.get_current_context",
        "mcp.list_resources",
        "mcp.read_resource",
        "library.search_devices",
        "library.get_device",
        "library.get_devices_by_lcsc_ids",
        "draft.generate_plan",
        "draft.preview_plan",
        "rules.validate_draft",
        "editor.preview_apply_plan"
      ],
      outputMode: "draft_result",
      promptKey: "draft"
    }
  };
  var SkillLoader = class {
    get(name) {
      return SKILLS[name];
    }
    selectForTask(taskType, userQuery) {
      if (taskType === "natural_chat") {
        return SKILLS["natural-chat-skill"];
      }
      if (taskType === "schematic_draft") {
        const normalized = userQuery.toLowerCase();
        if (normalized.includes("ldo") || normalized.includes("power") || normalized.includes("5v")) {
          return SKILLS["power-module-draft-skill"];
        }
        return SKILLS["generic-schematic-draft-skill"];
      }
      if (userQuery.includes("\u63A5\u7EBF\u6807\u51C6") || userQuery.toLowerCase().includes("wiring")) {
        return SKILLS["wiring-standards-check-skill"];
      }
      if (userQuery.includes("\u5143\u4EF6") || userQuery.toLowerCase().includes("component")) {
        return SKILLS["component-explain-skill"];
      }
      return SKILLS["schematic-analysis-skill"];
    }
  };

  // src/agent/tools/toolRegistry.ts
  var ToolRegistry = class {
    tools = /* @__PURE__ */ new Map();
    register(tool) {
      this.tools.set(tool.name, tool);
    }
    get(name) {
      return this.tools.get(name);
    }
    list() {
      return Array.from(this.tools.values());
    }
    async invoke(name, input) {
      const tool = this.tools.get(name);
      if (!tool) {
        throw new Error(`tool not found: ${name}`);
      }
      return tool.execute(input);
    }
  };

  // src/agent/tools/editorTools.ts
  function createEditorTools(adapter) {
    return [
      {
        name: "editor.get_current_context",
        description: "Read the current schematic context from editor",
        riskLevel: "low",
        execute: async () => adapter.getCurrentContext()
      },
      {
        name: "editor.get_selection",
        description: "Read the current selection from editor",
        riskLevel: "low",
        execute: async () => adapter.getSelection()
      },
      {
        name: "editor.describe_selection",
        description: "Describe the currently selected schematic objects with contextual details",
        riskLevel: "low",
        execute: async () => describeSelection(await adapter.getCurrentContext(), await adapter.getSelection())
      },
      {
        name: "editor.describe_object",
        description: "Describe a schematic object by objectId and objectType using current context",
        riskLevel: "low",
        execute: async (input) => describeObject(await adapter.getCurrentContext(), input.objectId, input.objectType)
      },
      {
        name: "editor.find_object",
        description: "Find a schematic object by ref, pin label, net name, or object id using current context",
        riskLevel: "low",
        execute: async (input) => findObject(await adapter.getCurrentContext(), input.query)
      },
      {
        name: "editor.locate",
        description: "Locate a schematic object in editor",
        riskLevel: "low",
        execute: async (input) => adapter.locate(input)
      },
      {
        name: "editor.preview_apply_plan",
        description: "Preview the result of applying a draft plan into the editor",
        riskLevel: "medium",
        execute: async (input) => adapter.previewApplyPlan(input.plan)
      },
      {
        name: "editor.apply_plan",
        description: "Apply a confirmed draft plan into the editor",
        riskLevel: "high",
        requiresConfirmation: true,
        execute: async (input) => adapter.applyPlan(input.plan)
      },
      {
        name: "editor.rollback_apply_plan",
        description: "Rollback a previous apply_plan transaction by transactionId",
        riskLevel: "high",
        requiresConfirmation: true,
        execute: async (input) => adapter.rollbackApplyPlan(input.transactionId)
      }
    ];
  }
  function describeSelection(context, selection) {
    const items = selection.objectIds.map((objectId) => describeObject(context, objectId, inferObjectType(context, objectId))).filter((item) => item.found);
    return {
      count: items.length,
      summary: items.length > 0 ? items.map((item) => item.summary).join("\uFF1B") : "\u5F53\u524D\u6CA1\u6709\u53EF\u89E3\u91CA\u7684\u9009\u4E2D\u5BF9\u8C61",
      items
    };
  }
  function describeObject(context, objectId, objectType) {
    const resolvedType = objectType || inferObjectType(context, objectId);
    if (resolvedType === "component") {
      const component = context.components.find((item) => item.id === objectId);
      if (!component) {
        return { found: false, objectId, objectType: resolvedType, summary: `\u672A\u627E\u5230\u5668\u4EF6 ${objectId}` };
      }
      const relatedPins = context.pins.filter((pin) => pin.componentId === component.id).slice(0, 6);
      return {
        found: true,
        objectId,
        objectType: resolvedType,
        ref: component.ref,
        name: component.name,
        value: component.value,
        packageName: component.packageName,
        summary: [
          component.ref || component.id,
          component.name || "\u672A\u547D\u540D\u5668\u4EF6",
          component.value || "",
          component.packageName ? `\u5C01\u88C5 ${component.packageName}` : "",
          relatedPins.length > 0 ? `\u5F15\u811A ${relatedPins.map((pin) => pin.pinName || pin.pinNumber || pin.id).join(", ")}` : ""
        ].filter(Boolean).join("\uFF0C"),
        pins: relatedPins.map((pin) => ({
          id: pin.id,
          pinNumber: pin.pinNumber,
          pinName: pin.pinName,
          electricalType: pin.electricalType
        })),
        properties: component.properties
      };
    }
    if (resolvedType === "pin") {
      const pin = context.pins.find((item) => item.id === objectId);
      if (!pin) {
        return { found: false, objectId, objectType: resolvedType, summary: `\u672A\u627E\u5230\u5F15\u811A ${objectId}` };
      }
      const component = context.components.find((item) => item.id === pin.componentId);
      const net = context.nets.find((item) => item.nodeIds.includes(pin.id));
      return {
        found: true,
        objectId,
        objectType: resolvedType,
        componentId: pin.componentId,
        componentRef: component?.ref,
        pinNumber: pin.pinNumber,
        pinName: pin.pinName,
        electricalType: pin.electricalType,
        netName: net?.name,
        summary: [
          component?.ref ? `${component.ref} \u7684 ${pin.pinNumber || pin.pinName || pin.id} \u811A` : pin.id,
          pin.pinName || "",
          pin.electricalType ? `\u7C7B\u578B ${pin.electricalType}` : "",
          net?.name ? `\u8FDE\u63A5\u7F51\u7EDC ${net.name}` : ""
        ].filter(Boolean).join("\uFF0C")
      };
    }
    if (resolvedType === "net") {
      const net = context.nets.find((item) => item.id === objectId);
      if (!net) {
        return { found: false, objectId, objectType: resolvedType, summary: `\u672A\u627E\u5230\u7F51\u7EDC ${objectId}` };
      }
      const nodePins = net.nodeIds.map((nodeId) => context.pins.find((pin) => pin.id === nodeId)).filter(Boolean).slice(0, 8);
      return {
        found: true,
        objectId,
        objectType: resolvedType,
        name: net.name,
        isPower: net.isPower,
        nodeCount: net.nodeIds.length,
        summary: [
          net.name || net.id,
          net.isPower ? "\u7535\u6E90\u7F51\u7EDC" : "\u4FE1\u53F7\u7F51\u7EDC",
          `\u8FDE\u63A5\u8282\u70B9 ${net.nodeIds.length} \u4E2A`,
          nodePins.length > 0 ? `\u5305\u542B ${nodePins.map((pin) => formatPinRef(context, pin)).filter(Boolean).join(", ")}` : ""
        ].filter(Boolean).join("\uFF0C")
      };
    }
    return { found: false, objectId, objectType: resolvedType || "component", summary: `\u65E0\u6CD5\u8BC6\u522B\u5BF9\u8C61 ${objectId}` };
  }
  function inferObjectType(context, objectId) {
    if (context.components.some((item) => item.id === objectId)) {
      return "component";
    }
    if (context.pins.some((item) => item.id === objectId)) {
      return "pin";
    }
    return "net";
  }
  function formatPinRef(context, pin) {
    if (!pin) {
      return "";
    }
    const component = context.components.find((item) => item.id === pin.componentId);
    return [component?.ref || pin.componentId, pin.pinNumber || pin.pinName || pin.id].filter(Boolean).join(".");
  }
  function findObject(context, query) {
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
      return {
        found: false,
        query,
        summary: "\u672A\u63D0\u4F9B\u53EF\u641C\u7D22\u5BF9\u8C61",
        matches: []
      };
    }
    const matches = [
      ...context.components.map((item) => ({
        score: scoreAliases(normalized, [item.id, item.ref, item.name, item.value]),
        objectId: item.id,
        objectType: "component",
        object: describeObject(context, item.id, "component")
      })).filter((item) => item.score > 0),
      ...context.pins.map((item) => {
        const componentRef = context.components.find((component) => component.id === item.componentId)?.ref;
        return {
          score: scoreAliases(normalized, [
            item.id,
            item.pinNumber,
            item.pinName,
            componentRef && item.pinNumber ? `${componentRef}.${item.pinNumber}` : "",
            componentRef && item.pinName ? `${componentRef}.${item.pinName}` : "",
            componentRef && item.pinNumber ? `${componentRef} ${item.pinNumber}` : "",
            componentRef && item.pinName ? `${componentRef} ${item.pinName}` : ""
          ]),
          objectId: item.id,
          objectType: "pin",
          object: describeObject(context, item.id, "pin")
        };
      }).filter((item) => item.score > 0),
      ...context.nets.map((item) => ({
        score: scoreAliases(normalized, [item.id, item.name]),
        objectId: item.id,
        objectType: "net",
        object: describeObject(context, item.id, "net")
      })).filter((item) => item.score > 0)
    ].sort((a, b) => b.score - a.score).slice(0, 5).map((item) => ({
      objectId: item.objectId,
      objectType: item.objectType,
      summary: item.object.summary,
      score: item.score
    }));
    if (matches.length > 0) {
      const top = matches[0];
      return {
        found: true,
        query,
        objectId: top.objectId,
        objectType: top.objectType,
        summary: top.summary,
        object: describeObject(context, top.objectId, top.objectType),
        matches
      };
    }
    return {
      found: false,
      query,
      summary: `\u672A\u627E\u5230\u4E0E ${query} \u5BF9\u5E94\u7684\u5668\u4EF6\u3001\u5F15\u811A\u6216\u7F51\u7EDC`,
      matches: []
    };
  }
  function scoreAliases(normalizedQuery, aliases) {
    let score = 0;
    for (const value of aliases) {
      const normalizedValue = String(value || "").trim().toLowerCase();
      if (!normalizedValue) {
        continue;
      }
      if (normalizedValue === normalizedQuery) {
        score = Math.max(score, 100);
        continue;
      }
      if (normalizedValue.startsWith(normalizedQuery) || normalizedQuery.startsWith(normalizedValue)) {
        score = Math.max(score, 70);
        continue;
      }
      if (normalizedValue.includes(normalizedQuery) || normalizedQuery.includes(normalizedValue)) {
        score = Math.max(score, 40);
      }
    }
    return score;
  }

  // src/agent/tools/issueTools.ts
  function createIssueTools(tools) {
    return [
      {
        name: "issues.locate_first",
        description: "Locate the first issue that can be mapped to an editor object",
        execute: async (input) => {
          const firstLocatable = input.issues.find(
            (issue) => issue.objectId && issue.objectType
          );
          if (!firstLocatable || !firstLocatable.objectId || !firstLocatable.objectType) {
            return {
              located: false,
              issueId: void 0
            };
          }
          await tools.invoke("editor.locate", {
            objectId: firstLocatable.objectId,
            objectType: firstLocatable.objectType
          });
          return {
            located: true,
            issueId: firstLocatable.id,
            objectId: firstLocatable.objectId,
            objectType: firstLocatable.objectType
          };
        }
      }
    ];
  }

  // src/agent/tools/libraryTools.ts
  function createLibraryTools(bridge) {
    return [
      {
        name: "library.search_devices",
        description: "Search component devices from JLCEDA professional integrated libraries",
        riskLevel: "low",
        execute: async (input) => {
          if (!bridge?.searchLibraryDevices) {
            throw new Error("library search is not available in current host");
          }
          return bridge.searchLibraryDevices(input);
        }
      },
      {
        name: "library.get_device",
        description: "Get detailed component device info from JLCEDA professional integrated libraries",
        riskLevel: "low",
        execute: async (input) => {
          if (!bridge?.getLibraryDevice) {
            throw new Error("library get_device is not available in current host");
          }
          return bridge.getLibraryDevice(input);
        }
      },
      {
        name: "library.get_devices_by_lcsc_ids",
        description: "Find component devices by LCSC ids from JLCEDA professional integrated libraries",
        riskLevel: "low",
        execute: async (input) => {
          if (!bridge?.getLibraryDevicesByLcscIds) {
            throw new Error("library get_devices_by_lcsc_ids is not available in current host");
          }
          return bridge.getLibraryDevicesByLcscIds(input);
        }
      }
    ];
  }

  // src/editor/apply-plan/generateDraftPlan.ts
  function withPlacement(x, y, rotation = 0) {
    return {
      placement_x: String(x),
      placement_y: String(y),
      placement_rotation: String(rotation)
    };
  }
  function generateDraftPlanFromPrompt(userQuery, options = {}) {
    const normalized = userQuery.toLowerCase();
    const selectedDevices = options.selectedDevices ?? [];
    const pickSelected = (role) => selectedDevices.find((item) => item.role === role);
    const ldoDevice = pickSelected("ldo_regulator");
    const inputCapacitorDevice = pickSelected("input_capacitor");
    const outputCapacitorDevice = pickSelected("output_capacitor") ?? inputCapacitorDevice;
    if (normalized.includes("ldo") || normalized.includes("5v") || normalized.includes("3.3v")) {
      return {
        title: "5V to 3.3V LDO Draft",
        rationale: "Generated a minimal regulated power-path draft based on the user request." + (selectedDevices.length > 0 ? ` Matched ${selectedDevices.length} integrated-library device candidate(s) for later placement.` : ""),
        components: [
          {
            id: "draft-u1",
            ref: "U1",
            name: ldoDevice?.name ?? "LDO",
            libraryId: ldoDevice?.deviceUuid ?? "lib-ldo",
            packageName: ldoDevice?.footprintName ?? "SOT-223",
            value: "3.3V",
            properties: {
              expected_net_VIN: "5V",
              expected_net_VOUT: "3V3",
              expected_net_GND: "GND",
              device_uuid: ldoDevice?.deviceUuid ?? "",
              library_uuid: ldoDevice?.libraryUuid ?? "",
              symbol_uuid: ldoDevice?.symbolUuid ?? "",
              footprint_uuid: ldoDevice?.footprintUuid ?? "",
              ...withPlacement(220, 220, 0)
            }
          },
          {
            id: "draft-c1",
            ref: "C1",
            name: inputCapacitorDevice?.name ?? "Capacitor",
            libraryId: inputCapacitorDevice?.deviceUuid ?? "lib-cap",
            packageName: inputCapacitorDevice?.footprintName ?? "0603",
            value: "10uF",
            properties: {
              expected_net_POS: "5V",
              expected_net_NEG: "GND",
              polarity_sensitive: "true",
              device_uuid: inputCapacitorDevice?.deviceUuid ?? "",
              library_uuid: inputCapacitorDevice?.libraryUuid ?? "",
              symbol_uuid: inputCapacitorDevice?.symbolUuid ?? "",
              footprint_uuid: inputCapacitorDevice?.footprintUuid ?? "",
              ...withPlacement(120, 220, 0)
            }
          },
          {
            id: "draft-c2",
            ref: "C2",
            name: outputCapacitorDevice?.name ?? "Capacitor",
            libraryId: outputCapacitorDevice?.deviceUuid ?? "lib-cap",
            packageName: outputCapacitorDevice?.footprintName ?? "0603",
            value: "10uF",
            properties: {
              expected_net_POS: "3V3",
              expected_net_NEG: "GND",
              polarity_sensitive: "true",
              device_uuid: outputCapacitorDevice?.deviceUuid ?? "",
              library_uuid: outputCapacitorDevice?.libraryUuid ?? "",
              symbol_uuid: outputCapacitorDevice?.symbolUuid ?? "",
              footprint_uuid: outputCapacitorDevice?.footprintUuid ?? "",
              ...withPlacement(320, 220, 0)
            }
          }
        ],
        pins: [
          {
            id: "draft-u1-vin",
            componentId: "draft-u1",
            pinName: "VIN",
            electricalType: "power_in"
          },
          {
            id: "draft-u1-vout",
            componentId: "draft-u1",
            pinName: "VOUT",
            electricalType: "power_out"
          },
          {
            id: "draft-u1-gnd",
            componentId: "draft-u1",
            pinName: "GND",
            electricalType: "power_in"
          },
          {
            id: "draft-c1-pos",
            componentId: "draft-c1",
            pinName: "POS",
            electricalType: "passive"
          },
          {
            id: "draft-c1-neg",
            componentId: "draft-c1",
            pinName: "NEG",
            electricalType: "passive"
          },
          {
            id: "draft-c2-pos",
            componentId: "draft-c2",
            pinName: "POS",
            electricalType: "passive"
          },
          {
            id: "draft-c2-neg",
            componentId: "draft-c2",
            pinName: "NEG",
            electricalType: "passive"
          }
        ],
        nets: [
          {
            id: "draft-net-5v",
            name: "5V",
            nodeIds: ["draft-u1-vin", "draft-c1-pos"],
            isPower: true
          },
          {
            id: "draft-net-3v3",
            name: "3V3",
            nodeIds: ["draft-u1-vout", "draft-c2-pos"],
            isPower: true
          },
          {
            id: "draft-net-gnd",
            name: "GND",
            nodeIds: ["draft-u1-gnd", "draft-c1-neg", "draft-c2-neg"],
            isPower: true
          }
        ],
        selectedDevices
      };
    }
    return {
      title: "Generic Draft",
      rationale: "Generated a placeholder draft plan from the prompt." + (selectedDevices.length > 0 ? ` Captured ${selectedDevices.length} selected library candidate(s).` : ""),
      components: [],
      pins: [],
      nets: [],
      selectedDevices
    };
  }

  // src/agent/tools/draftTools.ts
  function createDraftTools() {
    return [
      {
        name: "draft.generate_plan",
        description: "Generate a minimal schematic draft plan from the user's prompt",
        execute: async (input) => generateDraftPlanFromPrompt(input.userQuery, {
          selectedDevices: input.selectedDevices
        })
      },
      {
        name: "draft.preview_plan",
        description: "Build a preview summary from a draft plan",
        execute: async (input) => previewDraftPlan(input.plan)
      }
    ];
  }

  // src/agent/tools/mcpTools.ts
  function createMcpTools(client) {
    if (!client) {
      return [];
    }
    return client.toTools();
  }

  // src/rules/checks/componentAttributesCheck.ts
  function runComponentAttributesCheck(context) {
    const issues = [];
    for (const component of context.components) {
      if (!component.ref) {
        issues.push({
          id: `issue-${component.id}-missing-ref`,
          ruleId: "component.missing-ref",
          severity: "high",
          title: "\u5668\u4EF6\u7F3A\u5C11\u4F4D\u53F7",
          message: `${component.name ?? component.id} \u7F3A\u5C11\u4F4D\u53F7\u6807\u8BC6\u3002`,
          objectId: component.id,
          objectType: "component",
          suggestion: "\u8BF7\u4E3A\u8BE5\u5668\u4EF6\u8865\u5145\u552F\u4E00\u4F4D\u53F7\u3002"
        });
      }
      if (!component.packageName) {
        issues.push({
          id: `issue-${component.id}-missing-package`,
          ruleId: "component.missing-package",
          severity: "medium",
          title: "\u5668\u4EF6\u7F3A\u5C11\u5C01\u88C5\u4FE1\u606F",
          message: `${component.ref ?? component.id} \u7F3A\u5C11\u5C01\u88C5\u6216 footprint \u4FE1\u606F\u3002`,
          objectId: component.id,
          objectType: "component",
          suggestion: "\u8BF7\u5728\u8BC4\u5BA1\u6216\u5BFC\u51FA\u524D\u8865\u5145\u5C01\u88C5\u4FE1\u606F\u3002"
        });
      }
      if (!component.value) {
        issues.push({
          id: `issue-${component.id}-missing-value`,
          ruleId: "component.missing-value",
          severity: "medium",
          title: "\u5668\u4EF6\u7F3A\u5C11\u6570\u503C\u6216\u578B\u53F7",
          message: `${component.ref ?? component.id} \u7F3A\u5C11\u6570\u503C\u6216\u578B\u53F7\u63CF\u8FF0\u3002`,
          objectId: component.id,
          objectType: "component",
          suggestion: "\u8BF7\u8865\u5145\u5668\u4EF6\u6570\u503C\u6216\u578B\u53F7\u4FE1\u606F\u3002"
        });
      }
    }
    return issues;
  }

  // src/rules/checks/electricalConflictCheck.ts
  var DRIVER_TYPES = /* @__PURE__ */ new Set(["output", "power_out", "bidirectional"]);
  function runElectricalConflictCheck(context) {
    const pinById = new Map(context.pins.map((pin) => [pin.id, pin]));
    const issues = [];
    for (const net of context.nets) {
      const drivers = net.nodeIds.map((nodeId) => pinById.get(nodeId)).filter((pin) => Boolean(pin)).filter((pin) => pin.electricalType && DRIVER_TYPES.has(pin.electricalType));
      if (drivers.length < 2) {
        continue;
      }
      const labels = drivers.map(
        (pin) => `${pin.componentId}:${pin.pinName ?? pin.pinNumber ?? pin.id}:${pin.electricalType}`
      );
      const netName = net.name ?? net.id;
      issues.push({
        id: `issue-${net.id}-electrical-conflict`,
        ruleId: "wiring.electrical-conflict",
        severity: "high",
        title: "\u7F51\u7EDC\u5B58\u5728\u9A71\u52A8\u51B2\u7A81",
        message: `\u7F51\u7EDC ${netName} \u4E0A\u5B58\u5728\u591A\u4E2A\u8F93\u51FA\u9A71\u52A8\u5F15\u811A\uFF1A${labels.join("\u3001")}\u3002`,
        objectId: net.id,
        objectType: "net",
        suggestion: `\u8BF7\u786E\u8BA4 ${netName} \u662F\u5426\u5141\u8BB8\u5171\u9A71\u52A8\uFF0C\u6216\u5728\u9A71\u52A8\u7AEF\u4E4B\u95F4\u589E\u52A0\u9694\u79BB\u4E0E\u65B9\u5411\u63A7\u5236\u3002`
      });
    }
    return issues;
  }

  // src/rules/checks/floatingPinsCheck.ts
  function runFloatingPinsCheck(context) {
    const connectedPinIds = new Set(context.nets.flatMap((net) => net.nodeIds));
    return context.pins.filter((pin) => !connectedPinIds.has(pin.id)).map((pin) => ({
      id: `issue-${pin.id}-floating`,
      ruleId: "wiring.floating-pin",
      severity: pin.electricalType === "input" || pin.electricalType === "power_in" ? "high" : "medium",
      title: "\u5F15\u811A\u60AC\u7A7A\u672A\u8FDE\u63A5",
      message: `${pin.pinName ?? pin.pinNumber ?? pin.id} \u811A\u5F53\u524D\u6CA1\u6709\u8FDE\u63A5\u5230\u4EFB\u4F55\u7F51\u7EDC\u3002`,
      objectId: pin.id,
      objectType: "pin",
      suggestion: `\u8BF7\u8FDE\u63A5 ${pin.pinName ?? pin.pinNumber ?? pin.id} \u811A\uFF0C\u6216\u660E\u786E\u6807\u8BB0\u4E3A\u6709\u610F\u60AC\u7A7A\u3002`
    }));
  }

  // src/rules/checks/powerConflictCheck.ts
  function runPowerConflictCheck(context) {
    const pinById = new Map(context.pins.map((pin) => [pin.id, pin]));
    const componentById = new Map(context.components.map((component) => [component.id, component]));
    const issues = [];
    for (const net of context.nets) {
      if (!net.isPower || net.nodeIds.length < 2) {
        continue;
      }
      const expectedPowerNames = /* @__PURE__ */ new Set();
      for (const nodeId of net.nodeIds) {
        const pin = pinById.get(nodeId);
        if (!pin) {
          continue;
        }
        const component = componentById.get(pin.componentId);
        if (!component) {
          continue;
        }
        const expected = component.properties[`expected_net_${pin.pinName ?? pin.pinNumber ?? ""}`];
        if (expected) {
          expectedPowerNames.add(expected);
        }
      }
      const netName = net.name ?? net.id;
      const mismatchedExpected = Array.from(expectedPowerNames).filter((expected) => expected !== netName);
      if (mismatchedExpected.length > 0) {
        issues.push({
          id: `issue-${net.id}-power-conflict`,
          ruleId: "wiring.power-conflict",
          severity: "high",
          title: "\u7535\u6E90\u7F51\u7EDC\u5B9A\u4E49\u51B2\u7A81",
          message: `\u7535\u6E90\u7F51\u7EDC ${netName} \u4E0A\u5B58\u5728\u671F\u671B\u8FDE\u63A5\u5230\u5176\u4ED6\u7535\u6E90\u57DF\u7684\u5F15\u811A\uFF1A${mismatchedExpected.join("\u3001")}\u3002`,
          objectId: net.id,
          objectType: "net",
          suggestion: `\u8BF7\u62C6\u5206 ${netName}\uFF0C\u6216\u5C06\u4E0D\u5339\u914D\u7684\u5F15\u811A\u91CD\u65B0\u8FDE\u63A5\u5230\u5404\u81EA\u9884\u671F\u7684\u7535\u6E90\u7F51\u7EDC\u3002`
        });
      }
    }
    return issues;
  }

  // src/rules/checks/shortCircuitCheck.ts
  function runShortCircuitCheck(context) {
    const pinById = new Map(context.pins.map((pin) => [pin.id, pin]));
    const componentById = new Map(context.components.map((component) => [component.id, component]));
    const issues = [];
    for (const net of context.nets) {
      const expectedPowerDomains = /* @__PURE__ */ new Set();
      for (const nodeId of net.nodeIds) {
        const pin = pinById.get(nodeId);
        if (!pin) {
          continue;
        }
        const component = componentById.get(pin.componentId);
        if (!component) {
          continue;
        }
        const expectedNetName = component.properties[`expected_net_${pin.pinName ?? pin.pinNumber ?? ""}`];
        if (expectedNetName) {
          expectedPowerDomains.add(expectedNetName);
        }
      }
      if (expectedPowerDomains.size < 2) {
        continue;
      }
      const netName = net.name ?? net.id;
      issues.push({
        id: `issue-${net.id}-short-circuit-risk`,
        ruleId: "wiring.short-circuit-risk",
        severity: "high",
        title: "\u7F51\u7EDC\u5B58\u5728\u77ED\u8DEF\u98CE\u9669",
        message: `\u7F51\u7EDC ${netName} \u5408\u5E76\u4E86\u591A\u4E2A\u9884\u671F\u7535\u6E90\u57DF\uFF1A${Array.from(expectedPowerDomains).join("\u3001")}\u3002`,
        objectId: net.id,
        objectType: "net",
        suggestion: `\u8BF7\u62C6\u5206 ${netName}\uFF0C\u6216\u901A\u8FC7\u7A33\u538B\u5668\u3001\u4E8C\u6781\u7BA1\u3001\u5F00\u5173\u7B49\u5668\u4EF6\u9694\u79BB\u4E0D\u540C\u7535\u6E90\u57DF\u3002`
      });
    }
    return issues;
  }

  // src/rules/checks/wiringStandardsCheck.ts
  function runWiringStandardsCheck(context) {
    const issues = [];
    const pinToNetName = buildPinToNetNameMap(context);
    for (const component of context.components) {
      const componentPins = context.pins.filter((pin) => pin.componentId === component.id);
      for (const pin of componentPins) {
        const expectedNetName = component.properties[`expected_net_${pin.pinName ?? pin.pinNumber ?? ""}`];
        if (!expectedNetName) {
          continue;
        }
        const actualNetName = pinToNetName.get(pin.id);
        if (!actualNetName) {
          issues.push({
            id: `issue-${component.id}-${pin.id}-missing-net`,
            ruleId: "wiring.expected-net.missing",
            severity: "high",
            title: "\u5F15\u811A\u672A\u8FDE\u63A5\u5230\u9884\u671F\u7F51\u7EDC",
            message: `${component.ref ?? component.id} \u7684 ${pin.pinName ?? pin.pinNumber ?? pin.id} \u811A\u672A\u8FDE\u63A5\u5230\u9884\u671F\u7F51\u7EDC ${expectedNetName}\u3002`,
            objectId: pin.id,
            objectType: "pin",
            suggestion: `\u8BF7\u5C06 ${component.ref ?? component.id} \u7684 ${pin.pinName ?? pin.pinNumber ?? pin.id} \u811A\u8FDE\u63A5\u5230 ${expectedNetName}\u3002`
          });
          continue;
        }
        if (actualNetName !== expectedNetName) {
          issues.push({
            id: `issue-${component.id}-${pin.id}-wrong-net`,
            ruleId: "wiring.expected-net.mismatch",
            severity: "high",
            title: "\u5F15\u811A\u8FDE\u63A5\u4E0E\u9884\u671F\u4E0D\u4E00\u81F4",
            message: `${component.ref ?? component.id} \u7684 ${pin.pinName ?? pin.pinNumber ?? pin.id} \u811A\u5E94\u8FDE\u63A5\u5230 ${expectedNetName}\uFF0C\u5F53\u524D\u5B9E\u9645\u8FDE\u63A5\u5230 ${actualNetName}\u3002`,
            objectId: pin.id,
            objectType: "pin",
            suggestion: `\u8BF7\u5C06 ${component.ref ?? component.id} \u7684 ${pin.pinName ?? pin.pinNumber ?? pin.id} \u811A\u4ECE ${actualNetName} \u8C03\u6574\u5230 ${expectedNetName}\u3002`
          });
        }
      }
      if (component.properties.polarity_sensitive === "true") {
        const polarityIssue = detectPolarityReversed(component.id, componentPins, component.properties, pinToNetName);
        if (polarityIssue) {
          issues.push(polarityIssue);
        }
      }
    }
    return issues;
  }
  function buildPinToNetNameMap(context) {
    const pinToNetName = /* @__PURE__ */ new Map();
    for (const net of context.nets) {
      for (const nodeId of net.nodeIds) {
        pinToNetName.set(nodeId, net.name ?? net.id);
      }
    }
    return pinToNetName;
  }
  function detectPolarityReversed(componentId, pins, properties, pinToNetName) {
    const anodePin = pins.find((pin) => pin.pinName === "ANODE");
    const cathodePin = pins.find((pin) => pin.pinName === "CATHODE");
    const expectedAnode = properties.expected_net_ANODE;
    const expectedCathode = properties.expected_net_CATHODE;
    if (!anodePin || !cathodePin || !expectedAnode || !expectedCathode) {
      return void 0;
    }
    const actualAnode = pinToNetName.get(anodePin.id);
    const actualCathode = pinToNetName.get(cathodePin.id);
    if (actualAnode === expectedCathode && actualCathode === expectedAnode) {
      return {
        id: `issue-${componentId}-polarity-reversed`,
        ruleId: "wiring.polarity.reversed",
        severity: "high",
        title: "\u6781\u6027\u8FDE\u63A5\u53EF\u80FD\u63A5\u53CD",
        message: `\u6781\u6027\u654F\u611F\u5668\u4EF6 ${componentId} \u53EF\u80FD\u63A5\u53CD\uFF1AANODE \u5F53\u524D\u5728 ${actualAnode}\uFF0CCATHODE \u5F53\u524D\u5728 ${actualCathode}\u3002`,
        objectId: componentId,
        objectType: "component",
        suggestion: `\u8BF7\u5C06 ANODE / CATHODE \u5206\u522B\u8C03\u6574\u5230 ${expectedAnode} / ${expectedCathode}\u3002`
      };
    }
    return void 0;
  }

  // src/rules/engine/runSchematicChecks.ts
  function runSchematicChecks(context) {
    const issues = [
      ...runWiringStandardsCheck(context),
      ...runFloatingPinsCheck(context),
      ...runShortCircuitCheck(context),
      ...runElectricalConflictCheck(context),
      ...runComponentAttributesCheck(context),
      ...runPowerConflictCheck(context)
    ];
    return {
      issues,
      summary: issues.length === 0 ? "no schematic rule issues detected" : `detected ${issues.length} schematic rule issue(s)`
    };
  }

  // src/rules/engine/validateDraft.ts
  function validateDraft(draft) {
    return runSchematicChecks({
      project: {
        channel: "standard"
      },
      components: draft.components,
      pins: draft.pins,
      nets: draft.nets,
      selection: {
        objectIds: []
      }
    });
  }

  // src/agent/tools/ruleTools.ts
  function createRuleTools() {
    return [
      {
        name: "rules.run_schematic_checks",
        description: "Run local schematic rule checks for wiring and attribute issues",
        riskLevel: "low",
        execute: async (input) => runSchematicChecks(input.context)
      },
      {
        name: "rules.validate_draft",
        description: "Validate a generated schematic draft before apply",
        riskLevel: "high",
        execute: async (input) => validateDraft(input.draft)
      }
    ];
  }

  // src/agent/tools/schematicSummaryTools.ts
  function createSchematicSummaryTools() {
    return [
      {
        name: "schematic.summarize_bom",
        description: "Summarize schematic BOM categories from current context",
        riskLevel: "low",
        execute: async (input) => summarizeBom(input.context)
      },
      {
        name: "schematic.identify_key_components",
        description: "Identify key components such as MCU, power IC, interface IC, and sensor",
        riskLevel: "low",
        execute: async (input) => identifyKeyComponentsSummary(input.context)
      },
      {
        name: "schematic.identify_functional_blocks",
        description: "Identify functional blocks and representative evidence from schematic context",
        riskLevel: "low",
        execute: async (input) => identifyFunctionalBlocksSummary(input.context)
      },
      {
        name: "schematic.identify_power_domains",
        description: "Identify major power domains and attached components from schematic context",
        riskLevel: "low",
        execute: async (input) => identifyPowerDomainsSummary(input.context)
      },
      {
        name: "schematic.summarize_connectivity",
        description: "Summarize connectivity and network distribution of the whole schematic",
        riskLevel: "low",
        execute: async (input) => summarizeConnectivity(input.context)
      },
      {
        name: "schematic.trace_power_paths",
        description: "Trace major power paths from power nets to critical components",
        riskLevel: "low",
        execute: async (input) => tracePowerPaths(input.context)
      },
      {
        name: "schematic.trace_signal_paths",
        description: "Trace representative signal paths for key functional blocks",
        riskLevel: "low",
        execute: async (input) => traceSignalPaths(input.context)
      },
      {
        name: "schematic.trace_control_paths",
        description: "Trace controller-centric paths from main MCU/SoC to major peripherals",
        riskLevel: "low",
        execute: async (input) => traceControlPaths(input.context)
      }
    ];
  }
  function summarizeBom(context) {
    const counters = /* @__PURE__ */ new Map();
    for (const component of context.components) {
      const category = classifyComponent(component);
      const bucket = counters.get(category) ?? { count: 0, examples: [] };
      bucket.count += 1;
      const example = formatComponentLabel(component);
      if (example && bucket.examples.length < 4 && !bucket.examples.includes(example)) {
        bucket.examples.push(example);
      }
      counters.set(category, bucket);
    }
    return {
      componentCount: context.components.length,
      categories: Array.from(counters.entries()).map(([category, data]) => ({
        category,
        count: data.count,
        examples: data.examples
      })).sort((a, b) => b.count - a.count).slice(0, 8)
    };
  }
  function identifyKeyComponentsSummary(context) {
    return {
      keyComponents: context.components.map((component) => {
        const score = scoreKeyComponent(component);
        return {
          component,
          score: score.score,
          reason: score.reason
        };
      }).filter((item) => item.score > 0).sort((a, b) => b.score - a.score).slice(0, 6).map((item) => ({
        ref: item.component.ref || item.component.id,
        label: [item.component.name, item.component.value, item.component.packageName].filter(Boolean).join(" / ") || formatComponentLabel(item.component),
        reason: item.reason
      }))
    };
  }
  function identifyFunctionalBlocksSummary(context) {
    const pinById = new Map(context.pins.map((pin) => [pin.id, pin]));
    const netHintsByComponent = buildNetHintsByComponent(context.nets, pinById);
    const blockKeywords = [
      { name: "\u4E3B\u63A7\u4E0E\u8BA1\u7B97", patterns: [/esp32|stm32|mcu|soc|processor|cpu/i] },
      { name: "\u7535\u6E90\u7BA1\u7406", patterns: [/ldo|buck|boost|charger|pmic|battery|tp4056|ry3715|me6211/i] },
      { name: "USB\u4E0E\u901A\u4FE1", patterns: [/usb|uart|serial|ch340|cp210|type-c|connector/i] },
      { name: "\u97F3\u9891\u94FE\u8DEF", patterns: [/audio|codec|mic|speaker|amp|es8311|max98357|i2s/i] },
      { name: "\u4F20\u611F\u4E0E\u8F93\u5165", patterns: [/sensor|hall|imu|touch|key|button|switch/i] },
      { name: "\u663E\u793A\u4E0E\u6307\u793A", patterns: [/led|display|screen|rgb|indicator/i] }
    ];
    return {
      functionalBlocks: blockKeywords.map((block) => {
        const matches = context.components.filter(
          (component) => block.patterns.some((pattern) => pattern.test(buildSearchText(component)))
        );
        const netHints = Array.from(
          new Set(
            matches.flatMap((component) => netHintsByComponent.get(component.id) ?? [])
          )
        ).slice(0, 5);
        return {
          name: block.name,
          evidence: matches.slice(0, 4).map((component) => formatComponentLabel(component)),
          netHints
        };
      }).filter((block) => block.evidence.length > 0)
    };
  }
  function identifyPowerDomainsSummary(context) {
    const componentById = new Map(context.components.map((component) => [component.id, component]));
    return {
      powerDomains: context.nets.filter((net) => net.isPower || isLikelyPowerNet(net)).map((net) => ({
        name: net.name || net.id,
        nodeCount: net.nodeIds.length,
        attachedComponents: Array.from(
          new Set(
            net.nodeIds.map((nodeId) => context.pins.find((pin) => pin.id === nodeId)).filter(Boolean).map((pin) => componentById.get(pin.componentId)).filter(Boolean).map((component) => formatComponentLabel(component))
          )
        ).slice(0, 6)
      })).sort((a, b) => b.nodeCount - a.nodeCount).slice(0, 6)
    };
  }
  function summarizeConnectivity(context) {
    const isolatedNets = context.nets.filter((net) => net.nodeIds.length <= 1).length;
    const powerNets = context.nets.filter((net) => net.isPower || isLikelyPowerNet(net)).length;
    const largeSignalNets = context.nets.filter(
      (net) => net.nodeIds.length >= 4 && !(net.isPower || isLikelyPowerNet(net))
    ).length;
    return {
      netCount: context.nets.length,
      selectionCount: context.selection.objectIds.length,
      connectivityNotes: [
        `\u68C0\u6D4B\u5230 ${powerNets} \u6761\u7535\u6E90\u57DF\u76F8\u5173\u7F51\u7EDC\u3002`,
        isolatedNets > 0 ? `\u6709 ${isolatedNets} \u6761\u7F51\u7EDC\u4EC5\u8FDE\u63A5 1 \u4E2A\u8282\u70B9\uFF0C\u53EF\u80FD\u9700\u8981\u8FDB\u4E00\u6B65\u786E\u8BA4\u662F\u5426\u60AC\u7A7A\u3002` : "\u672A\u53D1\u73B0\u660E\u663E\u5B64\u7ACB\u7F51\u7EDC\u3002",
        largeSignalNets > 0 ? `\u6709 ${largeSignalNets} \u6761\u591A\u8282\u70B9\u4FE1\u53F7\u7F51\u7EDC\uFF0C\u5B58\u5728\u603B\u7EBF\u6216\u590D\u7528\u8FDE\u63A5\u3002` : "\u591A\u8282\u70B9\u4FE1\u53F7\u7F51\u7EDC\u8F83\u5C11\uFF0C\u8FDE\u63A5\u5173\u7CFB\u76F8\u5BF9\u96C6\u4E2D\u3002"
      ]
    };
  }
  function tracePowerPaths(context) {
    const componentById = new Map(context.components.map((component) => [component.id, component]));
    const adjacency = buildComponentAdjacency(context);
    const keyComponents = identifyKeyComponentsSummary(context).keyComponents.map((item) => context.components.find((component) => (component.ref || component.id) === item.ref)).filter(Boolean);
    const allPowerNets = context.nets.filter((net) => net.isPower || isLikelyPowerNet(net)).slice(0, 6);
    return {
      paths: allPowerNets.map((net) => {
        const attachedComponents = getComponentsOnNet(context, net, componentById);
        const target = attachedComponents.find((component) => keyComponents.some((item) => item.id === component.id));
        const traversed = target ? traceComponentPath(context, adjacency, attachedComponents[0]?.id, target.id, componentById, 4, "power") : attachedComponents.slice(0, 4).map((component) => formatComponentLabel(component));
        const criticalLoads = attachedComponents.filter((component) => keyComponents.some((item) => item.id === component.id)).slice(0, 3).map((component) => formatComponentLabel(component));
        return {
          sourceNet: net.name || net.id,
          path: [net.name || net.id, ...traversed],
          note: criticalLoads.length > 0 ? `\u8BE5\u7535\u6E90\u57DF\u9A71\u52A8\u5173\u952E\u5668\u4EF6\uFF1A${criticalLoads.join("\u3001")}` : `\u8BE5\u7535\u6E90\u57DF\u8FDE\u63A5 ${attachedComponents.length} \u4E2A\u4E3B\u8981\u5668\u4EF6`
        };
      })
    };
  }
  function traceSignalPaths(context) {
    const blocks = identifyFunctionalBlocksSummary(context).functionalBlocks;
    const componentById = new Map(context.components.map((component) => [component.id, component]));
    const adjacency = buildComponentAdjacency(context);
    return {
      paths: blocks.slice(0, 5).map((block) => ({
        block: block.name,
        path: traceBlockPath(block, context, adjacency, componentById),
        note: block.netHints.length > 0 ? `\u6A21\u5757\u4E3B\u8981\u5173\u8054\u7F51\u7EDC\uFF1A${block.netHints.join("\u3001")}` : `\u6A21\u5757\u4E3B\u8981\u5668\u4EF6\uFF1A${block.evidence.join("\u3001")}`
      }))
    };
  }
  function traceControlPaths(context) {
    const componentById = new Map(context.components.map((component) => [component.id, component]));
    const controller = context.components.find((component) => /esp32|stm32|mcu|soc|processor|cpu|wroom/i.test(buildSearchText(component)));
    if (!controller) {
      return { paths: [] };
    }
    const adjacency = buildComponentAdjacency(context);
    const targets = context.components.filter((component) => component.id !== controller.id).filter((component) => /sensor|codec|amp|uart|usb|driver|flash|memory|touch|imu|display|led/i.test(buildSearchText(component))).slice(0, 5);
    return {
      paths: targets.map((target) => ({
        controller: controller.ref || controller.id,
        target: target.ref || target.id,
        path: traceComponentPath(context, adjacency, controller.id, target.id, componentById, 4, "signal"),
        note: `${controller.ref || controller.id} \u5230 ${target.ref || target.id} \u7684\u4E3B\u63A7\u94FE\u8DEF`
      }))
    };
  }
  function buildNetHintsByComponent(nets, pinById) {
    const result = /* @__PURE__ */ new Map();
    nets.forEach((net) => {
      net.nodeIds.forEach((nodeId) => {
        const pin = pinById.get(nodeId);
        if (!pin) {
          return;
        }
        const list = result.get(pin.componentId) ?? [];
        const netName = net.name || net.id;
        if (netName && !list.includes(netName) && list.length < 6) {
          list.push(netName);
        }
        result.set(pin.componentId, list);
      });
    });
    return result;
  }
  function buildComponentAdjacency(context) {
    const pinById = new Map(context.pins.map((pin) => [pin.id, pin]));
    const adjacency = /* @__PURE__ */ new Map();
    context.components.forEach((component) => adjacency.set(component.id, /* @__PURE__ */ new Set()));
    context.nets.forEach((net) => {
      const netPins = net.nodeIds.map((nodeId) => pinById.get(nodeId)).filter(Boolean);
      const componentIds = Array.from(new Set(netPins.map((pin) => pin.componentId)));
      componentIds.forEach((sourceId) => {
        const neighbors = adjacency.get(sourceId) ?? /* @__PURE__ */ new Set();
        componentIds.forEach((targetId) => {
          if (targetId !== sourceId && allowTraversalBetween(sourceId, targetId, netPins, "signal")) {
            neighbors.add(targetId);
          }
        });
        adjacency.set(sourceId, neighbors);
      });
    });
    return adjacency;
  }
  function getComponentsOnNet(context, net, componentById) {
    const pinById = new Map(context.pins.map((pin) => [pin.id, pin]));
    return Array.from(
      new Set(
        net.nodeIds.map((nodeId) => pinById.get(nodeId)).filter(Boolean).map((pin) => pin.componentId)
      )
    ).map((componentId) => componentById.get(componentId)).filter(Boolean);
  }
  function traceComponentPath(context, adjacency, startId, targetId, componentById, maxDepth, mode) {
    if (!startId) {
      return [formatComponentLabel(componentById.get(targetId) || { id: targetId, properties: {} })];
    }
    if (startId === targetId) {
      return [formatComponentLabel(componentById.get(startId) || { id: startId, properties: {} })];
    }
    const queue = [{ id: startId, path: [startId], depth: 0 }];
    const visited = /* @__PURE__ */ new Set([startId]);
    while (queue.length > 0) {
      const current = queue.shift();
      if (current.id === targetId) {
        return current.path.map((componentId) => componentById.get(componentId)).filter(Boolean).map((component) => formatComponentLabel(component));
      }
      if (current.depth >= maxDepth) {
        continue;
      }
      const neighbors = adjacency.get(current.id) ?? /* @__PURE__ */ new Set();
      neighbors.forEach((neighborId) => {
        if (!hasCompatibleTraversal(context, current.id, neighborId, mode)) {
          return;
        }
        if (visited.has(neighborId)) {
          return;
        }
        visited.add(neighborId);
        queue.push({
          id: neighborId,
          path: [...current.path, neighborId],
          depth: current.depth + 1
        });
      });
    }
    return [formatComponentLabel(componentById.get(startId) || { id: startId, properties: {} })];
  }
  function traceBlockPath(block, context, adjacency, componentById) {
    const blockComponentIds = context.components.filter((component) => block.evidence.includes(formatComponentLabel(component))).map((component) => component.id);
    const anchor = blockComponentIds[0];
    const next = blockComponentIds[1];
    const traced = anchor && next ? traceComponentPath(context, adjacency, anchor, next, componentById, 3, "signal") : [];
    const netHints = block.netHints.slice(0, 2);
    return [...netHints, ...traced, ...block.evidence.slice(0, 2)].filter(Boolean).slice(0, 6);
  }
  function hasCompatibleTraversal(context, sourceId, targetId, mode) {
    const sourcePins = context.pins.filter((pin) => pin.componentId === sourceId);
    const targetPins = context.pins.filter((pin) => pin.componentId === targetId);
    if (sourcePins.length === 0 || targetPins.length === 0) {
      return true;
    }
    return sourcePins.some(
      (sourcePin) => targetPins.some((targetPin) => isTraversalPairAllowed(sourcePin.electricalType, targetPin.electricalType, mode))
    );
  }
  function allowTraversalBetween(sourceId, targetId, pins, mode) {
    const sourcePins = pins.filter((pin) => pin.componentId === sourceId);
    const targetPins = pins.filter((pin) => pin.componentId === targetId);
    if (sourcePins.length === 0 || targetPins.length === 0) {
      return true;
    }
    return sourcePins.some(
      (sourcePin) => targetPins.some((targetPin) => isTraversalPairAllowed(sourcePin.electricalType, targetPin.electricalType, mode))
    );
  }
  function isTraversalPairAllowed(sourceType, targetType, mode) {
    const source = normalizeElectricalType2(sourceType);
    const target = normalizeElectricalType2(targetType);
    if (!source && !target) {
      return true;
    }
    if (mode === "power") {
      const sourceTypes2 = /* @__PURE__ */ new Set(["power_out", "output", "passive", "bidirectional"]);
      const targetTypes2 = /* @__PURE__ */ new Set(["power_in", "input", "passive", "bidirectional"]);
      return sourceTypes2.has(source) || targetTypes2.has(target);
    }
    const sourceTypes = /* @__PURE__ */ new Set(["output", "bidirectional", "passive", "tri_state"]);
    const targetTypes = /* @__PURE__ */ new Set(["input", "bidirectional", "passive", "tri_state"]);
    return sourceTypes.has(source) || targetTypes.has(target);
  }
  function normalizeElectricalType2(value) {
    return String(value || "").trim().toLowerCase().replace(/\s+/g, "_");
  }
  function classifyComponent(component) {
    const text = buildSearchText(component);
    if (/\bres\b|resistor|ohm|r\d+/i.test(text)) return "\u7535\u963B";
    if (/\bcap\b|capacitor|uf|nf|pf|c\d+/i.test(text)) return "\u7535\u5BB9";
    if (/\bind\b|inductor|uh|mh|l\d+/i.test(text)) return "\u7535\u611F";
    if (/\bled\b|led|indicator/i.test(text)) return "LED";
    if (/diode|schottky|tvs|esd|d\d+/i.test(text)) return "\u4E8C\u6781\u7BA1";
    if (/mosfet|transistor|bjt|q\d+/i.test(text)) return "\u6676\u4F53\u7BA1";
    if (/connector|header|usb|type-c|jack|battery holder|socket/i.test(text)) return "\u8FDE\u63A5\u5668";
    if (/switch|button|key/i.test(text)) return "\u5F00\u5173/\u6309\u952E";
    if (/esp32|stm32|ic|amp|codec|charger|ldo|buck|boost|pmic|sensor|driver|uart|mcu|wroom/i.test(text)) return "\u96C6\u6210\u7535\u8DEF";
    return "\u5176\u4ED6\u5668\u4EF6";
  }
  function scoreKeyComponent(component) {
    const text = buildSearchText(component);
    if (/esp32|stm32|mcu|soc|processor|cpu|wroom/i.test(text)) {
      return { score: 100, reason: "\u7591\u4F3C\u4E3B\u63A7\u6216\u6838\u5FC3\u5904\u7406\u5668\u4EF6" };
    }
    if (/charger|ldo|buck|boost|pmic|battery|tp4056|ry3715|me6211/i.test(text)) {
      return { score: 85, reason: "\u7591\u4F3C\u7535\u6E90\u7BA1\u7406\u5173\u952E\u5668\u4EF6" };
    }
    if (/audio|codec|mic|speaker|amp|es8311|max98357|i2s/i.test(text)) {
      return { score: 78, reason: "\u7591\u4F3C\u97F3\u9891\u94FE\u8DEF\u5173\u952E\u5668\u4EF6" };
    }
    if (/usb|uart|serial|type-c|cp210|ch340/i.test(text)) {
      return { score: 72, reason: "\u7591\u4F3C\u63A5\u53E3\u6216\u901A\u4FE1\u5173\u952E\u5668\u4EF6" };
    }
    if (/sensor|hall|imu|accelerometer|gyro/i.test(text)) {
      return { score: 68, reason: "\u7591\u4F3C\u4F20\u611F\u5668\u5173\u952E\u5668\u4EF6" };
    }
    return { score: 0, reason: "" };
  }
  function isLikelyPowerNet(net) {
    const name = (net.name || net.id || "").toUpperCase();
    return /^(3V3|5V|VBUS|VBAT|VIN|VOUT|GND|VCC|AVDD|DVDD|VSYS|SYS)$/.test(name);
  }
  function buildSearchText(component) {
    return [
      component.id,
      component.ref,
      component.name,
      component.value,
      component.packageName,
      ...Object.values(component.properties || {})
    ].filter(Boolean).join(" ");
  }
  function formatComponentLabel(component) {
    return [component.ref || component.id, component.name || component.value || component.packageName || ""].filter(Boolean).join(" ");
  }

  // src/agent/tools/serverTools.ts
  function createServerTools(ragClient, llmClient, sessionStore) {
    return [
      {
        name: "rag.search",
        description: "Search knowledge evidence from the Go server",
        execute: async (input) => ragClient.search(input.query, input.topK ?? 3)
      },
      {
        name: "rag.build_citations",
        description: "Build a standard citation package from the Go server",
        execute: async (input) => ragClient.buildCitations(input.query, input.topK ?? 3)
      },
      {
        name: "llm.generate",
        description: "Generate an AI answer from the Go server LLM proxy",
        execute: async (input) => {
          const session = await sessionStore.get();
          if (!session) {
            throw new Error("not logged in");
          }
          if (input.stream) {
            let outputText = "";
            let finalEvent;
            await llmClient.generateStream(
              session.accessToken,
              {
                provider: input.provider,
                model: input.model,
                messages: input.messages
              },
              (event) => {
                if (event.type === "delta") {
                  outputText += event.delta ?? "";
                }
                if (event.type === "done") {
                  finalEvent = event;
                }
                if (input.onEvent) {
                  input.onEvent(event);
                }
              }
            );
            if (finalEvent?.type === "error") {
              throw new Error(finalEvent.error || "stream failed");
            }
            return {
              request_id: finalEvent?.request_id ?? "",
              provider: input.provider,
              model: finalEvent?.model ?? input.model ?? "",
              output_text: finalEvent?.output_text ?? outputText,
              prompt_tokens: finalEvent?.prompt_tokens ?? 0,
              completion_tokens: finalEvent?.completion_tokens ?? 0,
              cost_credits: finalEvent?.cost_credits ?? 0,
              remaining_credits: finalEvent?.remaining_credits ?? 0,
              billing_transaction: finalEvent?.billing_transaction ?? ""
            };
          }
          return llmClient.generate(session.accessToken, {
            provider: input.provider,
            model: input.model,
            messages: input.messages
          });
        }
      }
    ];
  }

  // src/agent/prompts/analysisPrompts.ts
  function buildAnalysisSummaryPrompt(context) {
    return [
      `channel=${context.project.channel}`,
      `components=${context.components.length}`,
      `nets=${context.nets.length}`,
      `selection=${context.selection.objectIds.length}`
    ].join(", ");
  }
  function buildAnalysisSystemPrompt() {
    return [
      "\u4F60\u662F\u5609\u7ACB\u521B EDA \u539F\u7406\u56FE\u5206\u6790\u52A9\u624B\u3002",
      "\u4F60\u7684\u4EFB\u52A1\u662F\u5148\u7406\u89E3\u6574\u5F20\u539F\u7406\u56FE\u7684\u529F\u80FD\u4E0E\u6A21\u5757\uFF0C\u518D\u7ED3\u5408\u89C4\u5219\u68C0\u67E5\u7ED3\u679C\u6574\u7406\u6210\u9762\u5411\u5DE5\u7A0B\u5E08\u7684\u4E2D\u6587\u5206\u6790\u7ED3\u8BBA\u3002",
      "\u4E0D\u8981\u8F93\u51FA\u5185\u90E8\u5BF9\u8C61 ID\uFF0C\u4E0D\u8981\u8F93\u51FA mcp:// URI\uFF0C\u4E0D\u8981\u66B4\u9732\u8C03\u8BD5\u5B57\u6BB5\u3002",
      "\u5982\u679C\u6709\u5F15\u811A\u5BF9\u8C61\uFF0C\u4F18\u5148\u5199\u6210\u7C7B\u4F3C\u201CU2 \u7684 1 \u811A\u201D\u3002",
      "\u4F60\u5FC5\u987B\u4F18\u5148\u4F7F\u7528\u63D2\u4EF6\u7AEF agent \u5DF2\u7ECF\u89C2\u6D4B\u5230\u7684\u56FE\u7EA7\u6458\u8981\u3001\u5143\u4EF6\u4E8B\u5B9E\u3001\u89C4\u5219\u7ED3\u679C\u548C\u77E5\u8BC6\u6458\u8981\uFF0C\u4E0D\u80FD\u8DF3\u8FC7\u8BC1\u636E\u76F4\u63A5\u731C\u6D4B\u3002",
      "\u8F93\u51FA\u5FC5\u987B\u662F JSON\uFF0C\u683C\u5F0F\u5982\u4E0B\uFF1A",
      '{"overview":"", "executiveSummary":"", "ercSummary":[""], "bomOverview":[""], "functionalBlocks":[""], "powerDomains":[""], "powerPaths":[""], "signalPaths":[""], "controlPaths":[""], "keyComponents":[""], "riskGroups":{"high":[""],"medium":[""],"low":[""]}, "keyFindings":[""], "nextSteps":[""]}',
      "\u8981\u6C42\uFF1A",
      "1. overview 1-2 \u53E5\uFF0C\u603B\u7ED3\u6574\u56FE\u7528\u9014\u4E0E\u603B\u4F53\u72B6\u6001\u3002",
      "2. executiveSummary 1 \u6BB5\uFF0C\u4F18\u5148\u8BF4\u660E\u6574\u673A\u7528\u9014\u3001\u4E3B\u63A7\u3001\u7535\u6E90\u94FE\u8DEF\u548C\u5F53\u524D\u4E3B\u8981\u98CE\u9669\u3002",
      "3. ercSummary 2-4 \u6761\uFF0C\u6982\u62EC\u89C4\u5219\u68C0\u67E5\u7ED3\u679C\uFF0C\u4E0D\u8981\u53EA\u5199 passed/failed\u3002",
      "4. bomOverview 3-6 \u6761\uFF0C\u6309\u5668\u4EF6\u7C7B\u522B\u6982\u62EC\u6570\u91CF\u548C\u4EE3\u8868\u5668\u4EF6\u3002",
      "5. functionalBlocks 2-5 \u6761\uFF0C\u8BF4\u660E\u4E3B\u8981\u529F\u80FD\u6A21\u5757\u53CA\u5176\u8BC1\u636E\u3002",
      "6. powerDomains 2-4 \u6761\uFF0C\u8BF4\u660E\u4E3B\u8981\u7535\u6E90\u57DF\u4E0E\u5173\u952E\u8D1F\u8F7D\u3002",
      "7. powerPaths 2-4 \u6761\uFF0C\u8BF4\u660E\u5173\u952E\u4F9B\u7535\u8DEF\u5F84\u3002",
      "8. signalPaths 2-4 \u6761\uFF0C\u8BF4\u660E\u4E3B\u8981\u4FE1\u53F7\u94FE\u8DEF\u6216\u63A5\u53E3\u94FE\u8DEF\u3002",
      "9. controlPaths 2-4 \u6761\uFF0C\u8BF4\u660E\u4E3B\u63A7\u5230\u5173\u952E\u5916\u8BBE\u7684\u94FE\u8DEF\u3002",
      "10. keyComponents 3-6 \u6761\uFF0C\u8BF4\u660E\u5173\u952E\u5668\u4EF6\u4E0E\u804C\u8D23\u3002",
      "11. riskGroups \u6309\u98CE\u9669\u6574\u7406\u95EE\u9898\uFF1BkeyFindings 2-4 \u6761\uFF1BnextSteps 2-4 \u6761\u3002"
    ].join("\n");
  }
  function buildAnalysisUserPrompt(input) {
    const issueLines = input.checkResult.issues.slice(0, 6).map((issue, index) => {
      const location = formatIssueLocation(issue.objectType, issue.objectId);
      return `${index + 1}. [${issue.severity}] ${issue.title}${location ? `\uFF0C\u4F4D\u7F6E\uFF1A${location}` : ""}\u3002\u8BF4\u660E\uFF1A${issue.message}${issue.suggestion ? `\u3002\u5EFA\u8BAE\uFF1A${issue.suggestion}` : ""}`;
    });
    const mcpHints = (input.mcpSummaries ?? []).slice(0, 2).map((item, index) => `${index + 1}. ${item.title}\uFF1A${item.summary}`);
    const libraryHints = (input.libraryInsights ?? []).slice(0, 2).map((item, index) => `${index + 1}. ${item.title}\uFF1A${item.summary}`);
    const overviewSummary = input.overviewSummary;
    const categoryHints = (overviewSummary?.categories ?? []).slice(0, 6).map((item, index) => `${index + 1}. ${item.category}\uFF1A${item.count} \u4E2A\uFF08\u4F8B\u5982\uFF1A${item.examples.join("\u3001") || "\u65E0"}\uFF09`);
    const keyComponentHints = (overviewSummary?.keyComponents ?? []).slice(0, 6).map((item, index) => `${index + 1}. ${item.ref}\uFF1A${item.label}\uFF1B${item.reason}`);
    const functionalBlockHints = (overviewSummary?.functionalBlocks ?? []).slice(0, 5).map((item, index) => `${index + 1}. ${item.name}\uFF1A${item.evidence.join("\u3001")}`);
    const powerDomainHints = (overviewSummary?.powerDomains ?? []).slice(0, 5).map((item, index) => `${index + 1}. ${item.name}\uFF1A\u8FDE\u63A5 ${item.nodeCount} \u4E2A\u8282\u70B9\uFF1B\u5173\u952E\u5668\u4EF6 ${item.attachedComponents.join("\u3001") || "\u65E0"}`);
    const powerPathHints = (overviewSummary?.powerPaths ?? []).slice(0, 4).map((item, index) => `${index + 1}. ${item.sourceNet}\uFF1A${item.path.join(" -> ")}\uFF1B${item.note}`);
    const signalPathHints = (overviewSummary?.signalPaths ?? []).slice(0, 4).map((item, index) => `${index + 1}. ${item.block}\uFF1A${item.path.join(" -> ")}\uFF1B${item.note}`);
    const controlPathHints = (overviewSummary?.controlPaths ?? []).slice(0, 4).map((item, index) => `${index + 1}. ${item.controller} -> ${item.target}\uFF1A${item.path.join(" -> ")}\uFF1B${item.note}`);
    return [
      `\u7528\u6237\u95EE\u9898\uFF1A${input.userQuery}`,
      `\u4E0A\u4E0B\u6587\uFF1A${buildAnalysisSummaryPrompt(input.context)}`,
      `\u68C0\u67E5\u7ED3\u679C\uFF1A\u5171 ${input.checkResult.issues.length} \u4E2A\u95EE\u9898\u3002`,
      input.locateLabel ? `\u4F18\u5148\u5B9A\u4F4D\uFF1A${input.locateLabel}` : "",
      overviewSummary ? `\u6574\u56FE\u6458\u8981\uFF1A\u5668\u4EF6 ${overviewSummary.componentCount} \u4E2A\uFF0C\u7F51\u7EDC ${overviewSummary.netCount} \u6761\uFF0C\u9009\u533A ${overviewSummary.selectionCount} \u4E2A\u3002` : "",
      categoryHints.length > 0 ? `\u5668\u4EF6\u5206\u7C7B\u6982\u89C8\uFF1A
${categoryHints.join("\n")}` : "",
      keyComponentHints.length > 0 ? `\u5173\u952E\u5668\u4EF6\uFF1A
${keyComponentHints.join("\n")}` : "",
      functionalBlockHints.length > 0 ? `\u529F\u80FD\u6A21\u5757\uFF1A
${functionalBlockHints.join("\n")}` : "",
      powerDomainHints.length > 0 ? `\u7535\u6E90\u57DF\uFF1A
${powerDomainHints.join("\n")}` : "",
      powerPathHints.length > 0 ? `\u7535\u6E90\u8DEF\u5F84\uFF1A
${powerPathHints.join("\n")}` : "",
      signalPathHints.length > 0 ? `\u4FE1\u53F7\u8DEF\u5F84\uFF1A
${signalPathHints.join("\n")}` : "",
      controlPathHints.length > 0 ? `\u4E3B\u63A7\u94FE\u8DEF\uFF1A
${controlPathHints.join("\n")}` : "",
      overviewSummary?.connectivityNotes?.length ? `\u8FDE\u63A5\u6027\u5907\u6CE8\uFF1A
${overviewSummary.connectivityNotes.join("\n")}` : "",
      issueLines.length > 0 ? `\u95EE\u9898\u5217\u8868\uFF1A
${issueLines.join("\n")}` : "\u95EE\u9898\u5217\u8868\uFF1A\u65E0",
      libraryHints.length > 0 ? `\u5173\u8054\u5143\u4EF6\u5E93\u4FE1\u606F\uFF1A
${libraryHints.join("\n")}` : "",
      mcpHints.length > 0 ? `\u77E5\u8BC6\u53C2\u8003\uFF1A
${mcpHints.join("\n")}` : "",
      "\u8BF7\u8F93\u51FA JSON\u3002"
    ].filter(Boolean).join("\n\n");
  }
  function formatIssueLocation(objectType, objectId) {
    if (!objectType || !objectId) {
      return "";
    }
    if (objectType === "pin") {
      const pinMatch = objectId.match(/^pin-([^-]+)-(.+)$/i);
      if (pinMatch) {
        return `${pinMatch[1].toUpperCase()} \u7684 ${pinMatch[2].toUpperCase()} \u811A`;
      }
    }
    if (objectType === "component") {
      const ref = objectId.replace(/^component-/i, "").toUpperCase();
      return `\u5668\u4EF6 ${ref}`;
    }
    if (objectType === "net") {
      return `\u7F51\u7EDC ${objectId.replace(/^net-/i, "")}`;
    }
    return `${objectType}:${objectId}`;
  }

  // src/agent/core/analysisReactAgent.ts
  async function runAnalysisReactAgent(deps) {
    assertContext(deps.task);
    const state = {
      toolTraces: [],
      stepStates: [],
      workingMemory: createWorkingMemory(deps.task),
      reactEvents: []
    };
    const context = deps.task.context;
    const mcpResources = [];
    const mcpResourceReads = [];
    const libraryInsights = [];
    let bomSummary;
    let keyComponentsSummary;
    let functionalBlocksSummary;
    let powerDomainsSummary;
    let connectivitySummary;
    let powerPathSummary;
    let signalPathSummary;
    let controlPathSummary;
    let overviewSummary;
    let liveContext = context;
    let checkResult;
    let locateResult = { located: false };
    let analysisReport;
    const tasks = {
      context: pushTask(state, "context", "\u8BFB\u53D6\u5F53\u524D\u539F\u7406\u56FE\u4E0A\u4E0B\u6587\u5E76\u51C6\u5907\u68C0\u67E5\u8F93\u5165"),
      mcp: pushTask(state, "mcp", "\u63D0\u53D6\u6574\u56FE\u6458\u8981\u3001\u6A21\u5757\u4E0E\u77E5\u8BC6\u8BC1\u636E"),
      rules: pushTask(state, "rules", "\u8C03\u7528 jlceda_schematic_check \u5B8C\u6210\u539F\u7406\u56FE\u89C4\u5219\u68C0\u67E5"),
      library: pushTask(state, "library", "\u6839\u636E\u5DF2\u53D1\u73B0\u7684\u95EE\u9898\u5668\u4EF6\u67E5\u8BE2 EDA \u5143\u4EF6\u5E93\u4FE1\u606F"),
      llm: pushTask(state, "llm", "\u6574\u7406\u68C0\u67E5\u7ED3\u679C\u5E76\u751F\u6210\u95EE\u9898\u62A5\u544A")
    };
    emitProgress(deps, state, "\u5F00\u59CB\u5206\u6790\u539F\u7406\u56FE");
    if (canUse(deps, "schematic.summarize_bom") || canUse(deps, "schematic.identify_key_components") || canUse(deps, "schematic.identify_functional_blocks") || canUse(deps, "schematic.identify_power_domains") || canUse(deps, "schematic.summarize_connectivity") || canUse(deps, "schematic.trace_power_paths") || canUse(deps, "schematic.trace_signal_paths") || canUse(deps, "schematic.trace_control_paths")) {
      updateTask(state, tasks.mcp, "running");
      thought(state, "Overview", "\u5148\u6309\u5668\u4EF6\u5206\u7C7B\u3001\u5173\u952E\u5668\u4EF6\u3001\u529F\u80FD\u6A21\u5757\u548C\u7535\u6E90\u57DF\u62C6\u5206\u63D0\u53D6\u6574\u56FE\u89C2\u6D4B\u8BC1\u636E\u3002", "mcp");
      emitProgress(deps, state, "\u6B63\u5728\u63D0\u53D6\u6574\u56FE\u7406\u89E3\u4E0E\u77E5\u8BC6\u8BC1\u636E");
      if (canUse(deps, "schematic.summarize_bom")) {
        bomSummary = await invokeObserved(
          deps,
          state,
          "schematic.summarize_bom",
          { context: liveContext },
          "\u63D0\u53D6 BOM \u5206\u7C7B\u6982\u89C8"
        );
      }
      if (canUse(deps, "schematic.identify_key_components")) {
        keyComponentsSummary = await invokeObserved(
          deps,
          state,
          "schematic.identify_key_components",
          { context: liveContext },
          "\u8BC6\u522B\u5173\u952E\u5668\u4EF6"
        );
      }
      if (canUse(deps, "schematic.identify_functional_blocks")) {
        functionalBlocksSummary = await invokeObserved(
          deps,
          state,
          "schematic.identify_functional_blocks",
          { context: liveContext },
          "\u8BC6\u522B\u529F\u80FD\u6A21\u5757"
        );
      }
      if (canUse(deps, "schematic.identify_power_domains")) {
        powerDomainsSummary = await invokeObserved(
          deps,
          state,
          "schematic.identify_power_domains",
          { context: liveContext },
          "\u8BC6\u522B\u7535\u6E90\u57DF"
        );
      }
      if (canUse(deps, "schematic.summarize_connectivity")) {
        connectivitySummary = await invokeObserved(
          deps,
          state,
          "schematic.summarize_connectivity",
          { context: liveContext },
          "\u63D0\u53D6\u8FDE\u63A5\u6027\u6458\u8981"
        );
      }
      if (canUse(deps, "schematic.trace_power_paths")) {
        powerPathSummary = await invokeObserved(
          deps,
          state,
          "schematic.trace_power_paths",
          { context: liveContext },
          "\u8FFD\u8E2A\u5173\u952E\u7535\u6E90\u8DEF\u5F84"
        );
      }
      if (canUse(deps, "schematic.trace_signal_paths")) {
        signalPathSummary = await invokeObserved(
          deps,
          state,
          "schematic.trace_signal_paths",
          { context: liveContext },
          "\u8FFD\u8E2A\u4E3B\u8981\u4FE1\u53F7\u8DEF\u5F84"
        );
      }
      if (canUse(deps, "schematic.trace_control_paths")) {
        controlPathSummary = await invokeObserved(
          deps,
          state,
          "schematic.trace_control_paths",
          { context: liveContext },
          "\u8FFD\u8E2A\u4E3B\u63A7\u4E2D\u5FC3\u94FE\u8DEF"
        );
      }
      overviewSummary = {
        componentCount: bomSummary?.componentCount ?? liveContext.components.length,
        netCount: connectivitySummary?.netCount ?? liveContext.nets.length,
        selectionCount: connectivitySummary?.selectionCount ?? liveContext.selection.objectIds.length,
        categories: bomSummary?.categories ?? [],
        keyComponents: keyComponentsSummary?.keyComponents ?? [],
        functionalBlocks: functionalBlocksSummary?.functionalBlocks.map((item) => ({ name: item.name, evidence: item.evidence })) ?? [],
        powerDomains: powerDomainsSummary?.powerDomains ?? [],
        powerPaths: powerPathSummary?.paths ?? [],
        signalPaths: signalPathSummary?.paths ?? [],
        controlPaths: controlPathSummary?.paths ?? [],
        connectivityNotes: connectivitySummary?.connectivityNotes ?? []
      };
      markStep(
        state,
        "mcp",
        "done",
        `\u5DF2\u63D0\u53D6\u6574\u56FE\u6458\u8981\uFF1A\u5668\u4EF6 ${overviewSummary.componentCount} \u4E2A\uFF0C\u529F\u80FD\u6A21\u5757 ${overviewSummary.functionalBlocks.length} \u4E2A\uFF0C\u7535\u6E90\u57DF ${overviewSummary.powerDomains.length} \u4E2A`
      );
      state.workingMemory.mcpReady = true;
      state.workingMemory.lastObservation = "\u5DF2\u63D0\u53D6\u6574\u56FE\u6458\u8981";
      updateTask(state, tasks.mcp, "done", "\u6574\u56FE\u6458\u8981\u5DF2\u5C31\u7EEA");
      emitProgress(deps, state, "\u6574\u56FE\u7406\u89E3\u4E0E\u77E5\u8BC6\u8BC1\u636E\u5DF2\u5C31\u7EEA");
    }
    if (canUse(deps, "mcp.list_resources")) {
      thought(state, "Knowledge", "\u5148\u8BFB\u53D6\u5DE5\u7A0B\u77E5\u8BC6\u548C\u89C4\u8303\u6458\u8981\uFF0C\u907F\u514D\u53EA\u770B\u5C40\u90E8\u8FDE\u63A5\u3002", "mcp");
      const resources = await invokeObserved(deps, state, "mcp.list_resources", void 0, "\u5217\u51FA\u77E5\u8BC6\u8D44\u6E90");
      resources.resources.forEach((item) => mcpResources.push(item));
      markStep(state, "mcp", mcpResources.length > 0 ? "done" : "skipped", `\u77E5\u8BC6\u8D44\u6E90 ${mcpResources.length} \u6761`);
      state.workingMemory.mcpReady = mcpResources.length > 0;
      if (canUse(deps, "mcp.read_resource")) {
        for (const resource of mcpResources.slice(0, 2)) {
          try {
            const read = await invokeObserved(
              deps,
              state,
              "mcp.read_resource",
              { uri: resource.uri },
              `\u8BFB\u53D6\u77E5\u8BC6\u8D44\u6E90 ${resource.uri}`
            );
            mcpResourceReads.push({ uri: read.uri, title: read.title, summary: read.summary });
          } catch {
          }
        }
        if (mcpResourceReads.length > 0) {
          markStep(state, "mcp", "done", `\u77E5\u8BC6\u6458\u8981 ${mcpResourceReads.length} \u6761`);
          state.workingMemory.mcpReady = true;
        }
      }
    }
    updateTask(state, tasks.context, "running");
    thought(state, "Context", "\u540C\u6B65\u7F16\u8F91\u5668\u91CC\u7684\u6700\u65B0\u539F\u7406\u56FE\u4E0A\u4E0B\u6587\uFF0C\u786E\u4FDD\u68C0\u67E5\u57FA\u4E8E\u5F53\u524D\u753B\u5E03\u3002", "context");
    emitProgress(deps, state, "\u6B63\u5728\u8BFB\u53D6\u5F53\u524D\u539F\u7406\u56FE\u4E0A\u4E0B\u6587");
    if (canUse(deps, "editor.get_current_context")) {
      liveContext = await invokeObserved(
        deps,
        state,
        "editor.get_current_context",
        void 0,
        "\u83B7\u53D6\u5F53\u524D\u539F\u7406\u56FE\u4E0A\u4E0B\u6587"
      );
    }
    updateTask(state, tasks.context, "done", "\u5F53\u524D\u539F\u7406\u56FE\u4E0A\u4E0B\u6587\u5DF2\u5C31\u7EEA");
    emitProgress(deps, state, "\u539F\u7406\u56FE\u4E0A\u4E0B\u6587\u5DF2\u5C31\u7EEA");
    markStep(state, "context", "done", "\u5F53\u524D\u539F\u7406\u56FE\u4E0A\u4E0B\u6587\u5DF2\u5C31\u7EEA");
    state.workingMemory.hasContext = true;
    state.workingMemory.lastObservation = "\u5F53\u524D\u539F\u7406\u56FE\u4E0A\u4E0B\u6587\u5DF2\u5C31\u7EEA";
    updateTask(state, tasks.rules, "running");
    thought(state, "Rules", "\u5F00\u59CB\u6267\u884C\u539F\u7406\u56FE\u68C0\u67E5\u5DE5\u5177\uFF0C\u5B9A\u4F4D\u8FDE\u63A5\u3001\u5C5E\u6027\u548C\u7535\u6E90\u7F51\u7EDC\u95EE\u9898\u3002", "rules");
    emitProgress(deps, state, "\u6B63\u5728\u6267\u884C\u89C4\u5219\u68C0\u67E5\u5E76\u5B9A\u4F4D\u95EE\u9898");
    checkResult = await invokeObserved(
      deps,
      state,
      "rules.run_schematic_checks",
      { context: liveContext },
      "\u6267\u884C\u539F\u7406\u56FE\u89C4\u5219\u68C0\u67E5"
    );
    state.workingMemory.rulesReady = true;
    state.workingMemory.lastObservation = checkResult?.summary || `\u53D1\u73B0 ${checkResult?.issues.length ?? 0} \u4E2A\u95EE\u9898`;
    if (checkResult && checkResult.issues.length > 0 && canUse(deps, "issues.locate_first")) {
      thought(state, "Locate", `\u5DF2\u53D1\u73B0 ${checkResult.issues.length} \u4E2A\u95EE\u9898\uFF0C\u7EE7\u7EED\u5B9A\u4F4D\u9996\u4E2A\u53EF\u64CD\u4F5C\u95EE\u9898\u3002`, "rules");
      locateResult = await invokeObserved(
        deps,
        state,
        "issues.locate_first",
        { issues: checkResult.issues },
        "\u5B9A\u4F4D\u9996\u4E2A\u95EE\u9898\u5BF9\u8C61"
      );
    }
    updateTask(
      state,
      tasks.rules,
      "done",
      `\u89C4\u5219\u68C0\u67E5\u5B8C\u6210\uFF0C\u95EE\u9898 ${checkResult?.issues.length ?? 0} \u4E2A${locateResult?.located ? "\uFF0C\u5DF2\u5B9A\u4F4D\u9996\u4E2A\u95EE\u9898" : ""}`
    );
    emitProgress(
      deps,
      state,
      `\u89C4\u5219\u68C0\u67E5\u5B8C\u6210\uFF0C\u53D1\u73B0 ${checkResult?.issues.length ?? 0} \u4E2A\u95EE\u9898${locateResult?.located ? "\uFF0C\u5DF2\u5B9A\u4F4D\u9996\u4E2A\u95EE\u9898" : ""}`
    );
    markStep(
      state,
      "rules",
      "done",
      `\u89C4\u5219\u68C0\u67E5\u5B8C\u6210\uFF0C\u95EE\u9898 ${checkResult?.issues.length ?? 0} \u4E2A${locateResult?.located ? "\uFF0C\u5DF2\u5B9A\u4F4D\u9996\u4E2A\u95EE\u9898" : ""}`
    );
    if (canUse(deps, "library.search_devices")) {
      updateTask(state, tasks.library, "running");
      thought(state, "Library", "\u56F4\u7ED5\u547D\u4E2D\u7684\u9AD8\u98CE\u9669\u5668\u4EF6\u8865\u5145\u5143\u4EF6\u5E93\u4E8B\u5B9E\uFF0C\u907F\u514D\u53EA\u51ED\u89C4\u5219\u6458\u8981\u4E0B\u5224\u65AD\u3002", "library");
      emitProgress(deps, state, "\u6B63\u5728\u8865\u5145\u5668\u4EF6\u5E93\u4E0E\u5C01\u88C5\u4FE1\u606F");
      const queries = buildAnalysisLibraryQueries(deps.task.userQuery, liveContext, checkResult);
      for (const query of queries) {
        try {
          const results = await invokeObserved(
            deps,
            state,
            "library.search_devices",
            { query, scope: "system", pageSize: 8, page: 1 },
            `\u67E5\u8BE2\u5143\u4EF6\u5E93\uFF1A${query}`
          );
          if (!results.length) {
            continue;
          }
          const top = results[0];
          let summary = [top.name, top.manufacturer, top.footprintName ? `\u5C01\u88C5 ${top.footprintName}` : ""].filter(Boolean).join("\uFF0C");
          if (canUse(deps, "library.get_device") && top.uuid) {
            try {
              const detail = await invokeObserved(
                deps,
                state,
                "library.get_device",
                { deviceUuid: top.uuid, libraryUuid: top.libraryUuid, scope: "system" },
                `\u8BFB\u53D6\u5668\u4EF6\u8BE6\u60C5\uFF1A${top.name}`
              );
              summary = [
                detail.name || top.name,
                detail.lcscId ? `LCSC ${detail.lcscId}` : "",
                detail.footprint?.name ? `\u5C01\u88C5 ${detail.footprint.name}` : top.footprintName ? `\u5C01\u88C5 ${top.footprintName}` : "",
                detail.description || top.description || ""
              ].filter(Boolean).join("\uFF0C");
            } catch {
            }
          }
          libraryInsights.push({ query, title: top.name, summary });
        } catch {
        }
      }
      updateTask(
        state,
        tasks.library,
        libraryInsights.length > 0 ? "done" : "skipped",
        libraryInsights.length > 0 ? `\u8865\u5145 ${libraryInsights.length} \u6761\u5143\u4EF6\u5E93\u4FE1\u606F` : "\u672A\u627E\u5230\u53EF\u8865\u5145\u7684\u5143\u4EF6\u5E93\u4FE1\u606F"
      );
      markStep(
        state,
        "library",
        libraryInsights.length > 0 ? "done" : "skipped",
        libraryInsights.length > 0 ? `\u8865\u5145 ${libraryInsights.length} \u6761\u5143\u4EF6\u5E93\u4FE1\u606F` : "\u672A\u627E\u5230\u53EF\u8865\u5145\u7684\u5143\u4EF6\u5E93\u4FE1\u606F"
      );
      state.workingMemory.libraryReady = libraryInsights.length > 0;
      emitProgress(
        deps,
        state,
        libraryInsights.length > 0 ? `\u5DF2\u8865\u5145 ${libraryInsights.length} \u6761\u5668\u4EF6\u5E93\u4FE1\u606F` : "\u672A\u627E\u5230\u53EF\u8865\u5145\u7684\u5668\u4EF6\u5E93\u4FE1\u606F"
      );
    } else {
      updateTask(state, tasks.library, "skipped", "\u5F53\u524D\u5BBF\u4E3B\u672A\u63D0\u4F9B\u5143\u4EF6\u641C\u7D22\u80FD\u529B");
      markStep(state, "library", "skipped", "\u5F53\u524D\u5BBF\u4E3B\u672A\u63D0\u4F9B\u5143\u4EF6\u641C\u7D22\u80FD\u529B");
    }
    updateTask(state, tasks.llm, canUse(deps, "llm.generate") ? "running" : "skipped");
    if (canUse(deps, "llm.generate")) {
      thought(state, "LLM", "\u57FA\u4E8E\u68C0\u67E5\u7ED3\u679C\u548C\u77E5\u8BC6\u6458\u8981\uFF0C\u6574\u7406\u6210\u7528\u6237\u53EF\u8BFB\u7684\u95EE\u9898\u62A5\u544A\u3002", "llm");
      emitProgress(deps, state, "\u6B63\u5728\u751F\u6210\u5206\u6790\u62A5\u544A");
      const llmResult = await invokeObserved(
        deps,
        state,
        "llm.generate",
        {
          stream: true,
          onEvent: (event) => {
            if (event.type === "delta" && event.delta) {
              emitProgress(deps, state, "\u6B63\u5728\u751F\u6210\u5206\u6790\u62A5\u544A", event.delta);
            }
            if (event.type === "done") {
              emitProgress(deps, state, "\u5206\u6790\u62A5\u544A\u5DF2\u751F\u6210", void 0, event.output_text);
            }
          },
          messages: [
            { role: "system", content: buildAnalysisSystemPrompt() },
            {
              role: "user",
              content: buildAnalysisUserPrompt({
                userQuery: deps.task.userQuery,
                context: liveContext,
                checkResult,
                locateLabel: locateResult?.located ? formatLocateLabel(locateResult.objectType, locateResult.objectId) : void 0,
                libraryInsights,
                overviewSummary,
                mcpSummaries: mcpResourceReads
              })
            }
          ]
        },
        "\u751F\u6210\u6700\u7EC8\u5206\u6790\u62A5\u544A"
      );
      analysisReport = parseAnalysisReport(llmResult.output_text, checkResult, locateResult);
      state.workingMemory.llmReady = true;
      state.workingMemory.lastObservation = "\u5206\u6790\u62A5\u544A\u5DF2\u751F\u6210";
      updateTask(state, tasks.llm, "done", "\u5206\u6790\u62A5\u544A\u5DF2\u751F\u6210");
      markStep(state, "llm", "done", "\u5206\u6790\u62A5\u544A\u5DF2\u751F\u6210");
      emitProgress(deps, state, "\u5206\u6790\u62A5\u544A\u5DF2\u751F\u6210");
    } else {
      analysisReport = buildFallbackAnalysisReport(checkResult, locateResult);
      markStep(state, "llm", "skipped", "LLM \u4E0D\u53EF\u7528\uFF0C\u5DF2\u56DE\u9000\u5230\u89C4\u5219\u7ED3\u679C\u6458\u8981");
    }
    final(state, `\u5206\u6790\u5B8C\u6210\uFF0C\u5171\u53D1\u73B0 ${checkResult?.issues.length ?? 0} \u4E2A\u95EE\u9898`);
    emitProgress(deps, state, `\u5206\u6790\u5B8C\u6210\uFF0C\u5171\u53D1\u73B0 ${checkResult?.issues.length ?? 0} \u4E2A\u95EE\u9898`);
    return {
      reactEvents: state.reactEvents,
      result: {
        summary: `collected schematic context for schematic_analysis; ${checkResult?.summary ?? "no result"}; locate_first=${locateResult?.located ?? false}; mcp_resources=${mcpResources.length}`,
        analysisReport,
        nextSuggestions: buildAnalysisSuggestions(checkResult, locateResult),
        structuredSuggestions: buildAnalysisStructuredSuggestions(checkResult),
        toolTraceNames: deps.listToolNames(),
        toolTraces: state.toolTraces,
        mcpResources,
        mcpResourceReads,
        libraryInsights,
        checkResult,
        locateResult,
        contextDigest: {
          channel: liveContext.project.channel,
          componentCount: liveContext.components.length,
          netCount: liveContext.nets.length,
          selectionCount: liveContext.selection.objectIds.length
        },
        stepStates: state.stepStates,
        workingMemory: state.workingMemory
      }
    };
  }
  function emitProgress(deps, state, detail, textDelta, text) {
    deps.onProgress?.({
      detail,
      textDelta,
      text,
      reactEvents: state.reactEvents.map((item) => ({ ...item })),
      stepStates: state.stepStates.map((item) => ({ ...item })),
      workingMemory: { ...state.workingMemory }
    });
  }
  function canUse(deps, toolName) {
    return deps.allowedTools.includes(toolName);
  }
  function assertContext(task) {
    if (!task.context) {
      throw new Error(`task context missing: ${task.type}`);
    }
  }
  function createWorkingMemory(task) {
    return {
      hasContext: Boolean(task.context),
      mcpReady: false,
      libraryReady: false,
      llmReady: false,
      rulesReady: false,
      draftReady: false
    };
  }
  function pushTask(state, stepKind, text) {
    const id = `${stepKind}:${text}`;
    state.reactEvents.push({ kind: "task", label: "Task", status: "pending", text, stepKind });
    return id;
  }
  function updateTask(state, id, status, text) {
    const event = state.reactEvents.find((item) => item.kind === "task" && `${item.stepKind}:${item.text}` === id);
    if (!event) return;
    event.status = status;
    if (text) {
      event.text = text;
    }
  }
  function thought(state, label, text, stepKind) {
    state.reactEvents.push({ kind: "thought", label, status: "done", text, stepKind });
  }
  function final(state, text) {
    state.reactEvents.push({ kind: "final", label: "Finish", status: "done", text });
  }
  function markStep(state, kind, status, observation) {
    const existing = state.stepStates.find((step2) => step2.kind === kind);
    if (existing) {
      existing.status = status;
      existing.observation = observation;
      return;
    }
    state.stepStates.push({ kind, required: true, note: `react agent step ${kind}`, status, observation });
  }
  async function invokeObserved(deps, state, toolName, input, goal) {
    const inputSummary = summarizeToolInput(toolName, input);
    state.reactEvents.push({
      kind: "tool_call",
      label: mapToolNameToLabel(toolName),
      status: "running",
      text: goal,
      toolName,
      inputSummary
    });
    try {
      const output = await deps.invokeTool(toolName, input);
      const outputSummary = summarizeToolOutput(toolName, output);
      state.toolTraces.push({ toolName, status: "success", note: outputSummary || void 0 });
      state.reactEvents.push({
        kind: "observation",
        label: mapToolNameToLabel(toolName),
        status: "done",
        text: outputSummary || `${mapToolNameToLabel(toolName)} completed`,
        toolName,
        outputSummary
      });
      return output;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      state.toolTraces.push({ toolName, status: "blocked", note: message });
      state.reactEvents.push({
        kind: "observation",
        label: mapToolNameToLabel(toolName),
        status: "failed",
        text: message,
        toolName,
        outputSummary: message
      });
      throw error;
    }
  }
  function buildAnalysisSuggestions(checkResult, locateResult) {
    const issueCount = checkResult?.issues.length ?? 0;
    if (issueCount === 0) {
      return ["\u53EF\u4EE5\u7EE7\u7EED\u751F\u6210\u8349\u6848\uFF0C\u6216\u9488\u5BF9\u5C40\u90E8\u6A21\u5757\u53D1\u8D77\u66F4\u6DF1\u5165\u95EE\u7B54\u3002"];
    }
    const suggestions = [`\u5EFA\u8BAE\u5148\u4FEE\u590D\u5F53\u524D ${issueCount} \u4E2A\u95EE\u9898\u540E\u518D\u751F\u6210\u8349\u6848\u3002`];
    if (locateResult?.located && locateResult.objectType && locateResult.objectId) {
      suggestions.push(`\u4F18\u5148\u68C0\u67E5\u5DF2\u5B9A\u4F4D\u5BF9\u8C61 ${formatLocateLabel(locateResult.objectType, locateResult.objectId)}\u3002`);
    }
    const highCount = (checkResult?.issues ?? []).filter((issue) => issue.severity === "high").length;
    if (highCount > 0) {
      suggestions.push(`\u68C0\u6D4B\u5230 ${highCount} \u4E2A\u9AD8\u98CE\u9669\u95EE\u9898\uFF0C\u5EFA\u8BAE\u5148\u91CD\u65B0\u5206\u6790\u786E\u8BA4\u4FEE\u590D\u7ED3\u679C\u3002`);
    }
    return suggestions;
  }
  function buildAnalysisStructuredSuggestions(checkResult) {
    const issueCount = checkResult?.issues.length ?? 0;
    if (issueCount === 0) {
      return [
        { label: "\u751F\u6210\u8349\u6848", actionType: "regenerate_draft", prompt: "\u8BF7\u57FA\u4E8E\u5F53\u524D\u539F\u7406\u56FE\u751F\u6210\u4E0B\u4E00\u7248\u8349\u6848" },
        { label: "\u7EE7\u7EED\u95EE\u7B54", actionType: "ask_followup", prompt: "\u8BF7\u7EE7\u7EED\u89E3\u91CA\u5F53\u524D\u539F\u7406\u56FE\u8FD8\u53EF\u4EE5\u4F18\u5316\u54EA\u4E9B\u5730\u65B9" }
      ];
    }
    return [
      { label: "\u91CD\u65B0\u5206\u6790", actionType: "rerun_analysis" },
      { label: "\u4FEE\u590D\u540E\u91CD\u68C0", actionType: "ask_followup", prompt: "\u6211\u5DF2\u7ECF\u4FEE\u590D\u4E00\u90E8\u5206\u95EE\u9898\uFF0C\u8BF7\u91CD\u65B0\u68C0\u67E5\u5F53\u524D\u539F\u7406\u56FE" }
    ];
  }
  function parseAnalysisReport(rawText, checkResult, locateResult) {
    const fallback = buildFallbackAnalysisReport(checkResult, locateResult);
    if (!rawText) return fallback;
    try {
      const parsed = JSON.parse(extractJsonBlock(rawText));
      return {
        overview: typeof parsed.overview === "string" && parsed.overview.trim() ? parsed.overview.trim() : fallback.overview,
        executiveSummary: typeof parsed.executiveSummary === "string" && parsed.executiveSummary.trim() ? parsed.executiveSummary.trim() : fallback.executiveSummary,
        ercSummary: Array.isArray(parsed.ercSummary) && parsed.ercSummary.length > 0 ? parsed.ercSummary.map(String).map((item) => item.trim()).filter(Boolean).slice(0, 4) : fallback.ercSummary,
        bomOverview: Array.isArray(parsed.bomOverview) && parsed.bomOverview.length > 0 ? parsed.bomOverview.map(String).map((item) => item.trim()).filter(Boolean).slice(0, 6) : fallback.bomOverview,
        functionalBlocks: Array.isArray(parsed.functionalBlocks) && parsed.functionalBlocks.length > 0 ? parsed.functionalBlocks.map(String).map((item) => item.trim()).filter(Boolean).slice(0, 5) : fallback.functionalBlocks,
        powerDomains: Array.isArray(parsed.powerDomains) && parsed.powerDomains.length > 0 ? parsed.powerDomains.map(String).map((item) => item.trim()).filter(Boolean).slice(0, 5) : fallback.powerDomains,
        powerPaths: Array.isArray(parsed.powerPaths) && parsed.powerPaths.length > 0 ? parsed.powerPaths.map(String).map((item) => item.trim()).filter(Boolean).slice(0, 4) : fallback.powerPaths,
        signalPaths: Array.isArray(parsed.signalPaths) && parsed.signalPaths.length > 0 ? parsed.signalPaths.map(String).map((item) => item.trim()).filter(Boolean).slice(0, 4) : fallback.signalPaths,
        controlPaths: Array.isArray(parsed.controlPaths) && parsed.controlPaths.length > 0 ? parsed.controlPaths.map(String).map((item) => item.trim()).filter(Boolean).slice(0, 4) : fallback.controlPaths,
        keyComponents: Array.isArray(parsed.keyComponents) && parsed.keyComponents.length > 0 ? parsed.keyComponents.map(String).map((item) => item.trim()).filter(Boolean).slice(0, 6) : fallback.keyComponents,
        riskGroups: {
          high: Array.isArray(parsed.riskGroups?.high) ? parsed.riskGroups.high.map(String).map((item) => item.trim()).filter(Boolean).slice(0, 3) : fallback.riskGroups?.high ?? [],
          medium: Array.isArray(parsed.riskGroups?.medium) ? parsed.riskGroups.medium.map(String).map((item) => item.trim()).filter(Boolean).slice(0, 3) : fallback.riskGroups?.medium ?? [],
          low: Array.isArray(parsed.riskGroups?.low) ? parsed.riskGroups.low.map(String).map((item) => item.trim()).filter(Boolean).slice(0, 3) : fallback.riskGroups?.low ?? []
        },
        keyFindings: Array.isArray(parsed.keyFindings) && parsed.keyFindings.length > 0 ? parsed.keyFindings.map(String).map((item) => item.trim()).filter(Boolean).slice(0, 3) : fallback.keyFindings,
        nextSteps: Array.isArray(parsed.nextSteps) && parsed.nextSteps.length > 0 ? parsed.nextSteps.map(String).map((item) => item.trim()).filter(Boolean).slice(0, 3) : fallback.nextSteps
      };
    } catch {
      return fallback;
    }
  }
  function buildFallbackAnalysisReport(checkResult, locateResult) {
    const issues = checkResult?.issues ?? [];
    const firstThree = issues.slice(0, 3).map((issue) => {
      const location = formatLocateLabel(issue.objectType, issue.objectId);
      return `${issue.title}${location ? `\uFF1A${location}` : ""}`;
    });
    const nextSteps = buildAnalysisSuggestions(checkResult, locateResult).slice(0, 3);
    return {
      overview: issues.length > 0 ? `\u5DF2\u5B8C\u6210\u5F53\u524D\u539F\u7406\u56FE\u68C0\u67E5\uFF0C\u53D1\u73B0 ${issues.length} \u4E2A\u9700\u8981\u5173\u6CE8\u7684\u95EE\u9898\uFF0C\u5EFA\u8BAE\u4F18\u5148\u5904\u7406\u9AD8\u98CE\u9669\u8FDE\u63A5\u9519\u8BEF\u3002` : "\u5DF2\u5B8C\u6210\u5F53\u524D\u539F\u7406\u56FE\u68C0\u67E5\uFF0C\u6682\u672A\u53D1\u73B0\u660E\u663E\u89C4\u5219\u95EE\u9898\u3002",
      executiveSummary: issues.length > 0 ? "\u5DF2\u5B8C\u6210\u6574\u56FE\u9996\u8F6E\u7406\u89E3\u4E0E\u89C4\u5219\u8BCA\u65AD\u3002\u5F53\u524D\u4E3B\u8981\u98CE\u9669\u96C6\u4E2D\u5728\u9AD8\u98CE\u9669\u63A5\u7EBF\u3001\u7535\u6E90\u57DF\u51B2\u7A81\u6216\u5173\u952E\u5F15\u811A\u8FDE\u63A5\u9519\u8BEF\uFF0C\u5EFA\u8BAE\u5148\u4FEE\u590D\u6838\u5FC3\u98CE\u9669\u518D\u7EE7\u7EED\u529F\u80FD\u6269\u5C55\u3002" : "\u5DF2\u5B8C\u6210\u6574\u56FE\u9996\u8F6E\u7406\u89E3\u4E0E\u89C4\u5219\u8BCA\u65AD\u3002\u5F53\u524D\u672A\u53D1\u73B0\u660E\u663E\u89C4\u5219\u95EE\u9898\uFF0C\u53EF\u4EE5\u7EE7\u7EED\u505A\u6A21\u5757\u5316\u590D\u6838\u4E0E\u8BBE\u8BA1\u4F18\u5316\u3002",
      ercSummary: issues.length > 0 ? [
        `\u89C4\u5219\u68C0\u67E5\u5171\u53D1\u73B0 ${issues.length} \u4E2A\u95EE\u9898\u3002`,
        `${issues.filter((issue) => issue.severity === "high").length} \u4E2A\u9AD8\u98CE\u9669\u95EE\u9898\u9700\u8981\u4F18\u5148\u5904\u7406\u3002`
      ] : ["\u89C4\u5219\u68C0\u67E5\u672A\u53D1\u73B0\u660E\u663E ERC \u98CE\u9669\u3002"],
      bomOverview: [],
      functionalBlocks: [],
      powerDomains: [],
      powerPaths: [],
      signalPaths: [],
      controlPaths: [],
      keyComponents: [],
      riskGroups: {
        high: issues.filter((issue) => issue.severity === "high").slice(0, 3).map((issue) => `${issue.title}${formatLocateLabel(issue.objectType, issue.objectId) ? `\uFF1A${formatLocateLabel(issue.objectType, issue.objectId)}` : ""}`),
        medium: issues.filter((issue) => issue.severity === "medium").slice(0, 3).map((issue) => `${issue.title}${formatLocateLabel(issue.objectType, issue.objectId) ? `\uFF1A${formatLocateLabel(issue.objectType, issue.objectId)}` : ""}`),
        low: issues.filter((issue) => issue.severity === "low").slice(0, 3).map((issue) => `${issue.title}${formatLocateLabel(issue.objectType, issue.objectId) ? `\uFF1A${formatLocateLabel(issue.objectType, issue.objectId)}` : ""}`)
      },
      keyFindings: firstThree.length > 0 ? firstThree : ["\u672A\u53D1\u73B0\u9700\u8981\u4F18\u5148\u5904\u7406\u7684\u95EE\u9898"],
      nextSteps: nextSteps.length > 0 ? nextSteps : ["\u5982\u9700\u66F4\u6DF1\u5165\u786E\u8BA4\uFF0C\u53EF\u4EE5\u7EE7\u7EED\u8BE2\u95EE\u5177\u4F53\u5668\u4EF6\u6216\u7F51\u7EDC\u95EE\u9898"]
    };
  }
  function extractJsonBlock(text) {
    const match = text.match(/\{[\s\S]*\}/);
    return match ? match[0] : text;
  }
  function formatLocateLabel(objectType, objectId) {
    if (!objectType || !objectId) return "";
    if (objectType === "pin") {
      const match = objectId.match(/^pin-([^-]+)-(.+)$/i);
      if (match) return `${match[1].toUpperCase()} \u7684 ${match[2].toUpperCase()} \u811A`;
    }
    if (objectType === "component") return `\u5668\u4EF6 ${objectId.replace(/^component-/i, "").toUpperCase()}`;
    if (objectType === "net") return `\u7F51\u7EDC ${objectId.replace(/^net-/i, "")}`;
    return `${objectType}:${objectId}`;
  }
  function buildAnalysisLibraryQueries(userQuery, context, checkResult) {
    const queries = [];
    const seen = /* @__PURE__ */ new Set();
    const push = (value) => {
      const normalized = String(value || "").trim();
      if (!normalized) return;
      const key = normalized.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      queries.push(normalized);
    };
    const componentById = new Map(context.components.map((component) => [component.id, component]));
    const pinById = new Map(context.pins.map((pin) => [pin.id, pin]));
    const prioritized = [...checkResult?.issues ?? []].sort((a, b) => {
      const order = { high: 0, medium: 1, low: 2 };
      return (order[a.severity] ?? 9) - (order[b.severity] ?? 9);
    });
    prioritized.slice(0, 6).forEach((issue) => {
      if (issue.objectType === "component" && issue.objectId) {
        const component = componentById.get(issue.objectId);
        push([component?.ref, component?.name, component?.value].filter(Boolean).join(" "));
        push(component?.name);
        push(component?.value);
        return;
      }
      if (issue.objectType === "pin" && issue.objectId) {
        const pin = pinById.get(issue.objectId);
        const component = pin ? componentById.get(pin.componentId) : void 0;
        push([component?.ref, component?.name, component?.value].filter(Boolean).join(" "));
        push(component?.name);
        push(component?.value);
      }
    });
    if (queries.length === 0) {
      const tokens = userQuery.match(/[A-Za-z]+\d+[A-Za-z0-9_-]*|[A-Z]{2,}[A-Za-z0-9_-]*/g) ?? [];
      tokens.slice(0, 3).forEach(push);
    }
    if (queries.length === 0) {
      context.components.slice(0, 8).forEach((component) => {
        push(component.ref);
        push(component.name);
        push(component.value);
      });
    }
    return queries.slice(0, 3);
  }
  function summarizeToolInput(toolName, input) {
    if (toolName === "rules.run_schematic_checks" && input && typeof input === "object") {
      const context = input.context;
      return context ? buildAnalysisSummaryPrompt(context) : "\u4F7F\u7528\u5F53\u524D\u539F\u7406\u56FE\u4E0A\u4E0B\u6587";
    }
    if (toolName === "library.search_devices" && input && typeof input === "object") {
      return `query=${String(input.query || "")}`;
    }
    if (toolName === "mcp.read_resource" && input && typeof input === "object") {
      return `uri=${String(input.uri || "")}`;
    }
    if (toolName === "issues.locate_first" && input && typeof input === "object") {
      return `issues=${(input.issues || []).length}`;
    }
    if (toolName.startsWith("schematic.") && input && typeof input === "object") {
      return "\u4F7F\u7528\u5F53\u524D\u539F\u7406\u56FE\u4E0A\u4E0B\u6587\u751F\u6210\u6574\u56FE\u6458\u8981";
    }
    if (toolName === "llm.generate" && input && typeof input === "object") {
      return `messages=${(input.messages || []).length}`;
    }
    return "";
  }
  function summarizeToolOutput(toolName, output) {
    if (toolName === "library.search_devices" && Array.isArray(output)) {
      if (output.length === 0) return "\u672A\u627E\u5230\u5339\u914D\u5668\u4EF6";
      const first = output[0];
      return [`\u627E\u5230 ${output.length} \u4E2A\u5019\u9009`, first?.name ? `\u9996\u9879 ${first.name}` : "", first?.manufacturer || "", first?.footprintName ? `\u5C01\u88C5 ${first.footprintName}` : ""].filter(Boolean).join("\uFF0C");
    }
    if (toolName === "library.get_device" && output && typeof output === "object") {
      const detail = output;
      return [detail.name ?? "", detail.lcscId ? `LCSC ${detail.lcscId}` : "", detail.footprint?.name ? `\u5C01\u88C5 ${detail.footprint.name}` : "", detail.description ? detail.description.slice(0, 48) : ""].filter(Boolean).join("\uFF0C");
    }
    if (toolName === "rules.run_schematic_checks" && output && typeof output === "object") {
      const result = output;
      return result.summary || `\u53D1\u73B0 ${result.issues?.length ?? 0} \u4E2A\u95EE\u9898`;
    }
    if (toolName === "issues.locate_first" && output && typeof output === "object") {
      const locate = output;
      return locate.located ? `\u5DF2\u5B9A\u4F4D ${formatLocateLabel(locate.objectType, locate.objectId)}` : "\u672A\u627E\u5230\u53EF\u5B9A\u4F4D\u5BF9\u8C61";
    }
    if (toolName === "schematic.summarize_bom" && output && typeof output === "object") {
      const result = output;
      return `BOM \u6458\u8981\uFF1A\u5668\u4EF6 ${result.componentCount} \u4E2A\uFF0C\u7C7B\u522B ${result.categories.length} \u7C7B`;
    }
    if (toolName === "schematic.identify_key_components" && output && typeof output === "object") {
      const result = output;
      return `\u5173\u952E\u5668\u4EF6 ${result.keyComponents.length} \u4E2A`;
    }
    if (toolName === "schematic.identify_functional_blocks" && output && typeof output === "object") {
      const result = output;
      return `\u529F\u80FD\u6A21\u5757 ${result.functionalBlocks.length} \u4E2A`;
    }
    if (toolName === "schematic.identify_power_domains" && output && typeof output === "object") {
      const result = output;
      return `\u7535\u6E90\u57DF ${result.powerDomains.length} \u4E2A`;
    }
    if (toolName === "schematic.summarize_connectivity" && output && typeof output === "object") {
      const result = output;
      return `\u8FDE\u63A5\u6027\u6458\u8981\uFF1A\u7F51\u7EDC ${result.netCount} \u6761`;
    }
    if (toolName === "schematic.trace_power_paths" && output && typeof output === "object") {
      const result = output;
      return `\u5173\u952E\u7535\u6E90\u8DEF\u5F84 ${result.paths.length} \u6761`;
    }
    if (toolName === "schematic.trace_signal_paths" && output && typeof output === "object") {
      const result = output;
      return `\u4E3B\u8981\u4FE1\u53F7\u8DEF\u5F84 ${result.paths.length} \u6761`;
    }
    if (toolName === "schematic.trace_control_paths" && output && typeof output === "object") {
      const result = output;
      return `\u4E3B\u63A7\u94FE\u8DEF ${result.paths.length} \u6761`;
    }
    if (toolName === "mcp.list_resources" && output && typeof output === "object") {
      const result = output;
      return `\u5DF2\u52A0\u8F7D ${result.resources?.length ?? 0} \u6761\u77E5\u8BC6\u8D44\u6E90`;
    }
    if (toolName === "mcp.read_resource" && output && typeof output === "object") {
      const result = output;
      return [result.title, result.summary].filter(Boolean).join("\uFF1A");
    }
    if (toolName === "llm.generate" && output && typeof output === "object") {
      const result = output;
      return result.output_text ? `\u5DF2\u751F\u6210 ${result.output_text.length} \u5B57\u5206\u6790\u62A5\u544A` : "\u5DF2\u751F\u6210\u5206\u6790\u62A5\u544A";
    }
    return "";
  }
  function mapToolNameToLabel(toolName) {
    const map = {
      "editor.get_current_context": "jlceda_get_schematic_context",
      "schematic.summarize_bom": "jlceda_summarize_bom",
      "schematic.identify_key_components": "jlceda_identify_key_components",
      "schematic.identify_functional_blocks": "jlceda_identify_functional_blocks",
      "schematic.identify_power_domains": "jlceda_identify_power_domains",
      "schematic.summarize_connectivity": "jlceda_summarize_connectivity",
      "schematic.trace_power_paths": "jlceda_trace_power_paths",
      "schematic.trace_signal_paths": "jlceda_trace_signal_paths",
      "schematic.trace_control_paths": "jlceda_trace_control_paths",
      "library.search_devices": "jlceda_search_component_library",
      "library.get_device": "jlceda_get_component_detail",
      "mcp.list_resources": "jlceda_list_knowledge_resources",
      "mcp.read_resource": "jlceda_read_knowledge_resource",
      "rules.run_schematic_checks": "jlceda_schematic_check",
      "issues.locate_first": "jlceda_locate_issue",
      "llm.generate": "llm_generate_report"
    };
    return map[toolName] ?? toolName;
  }

  // src/agent/prompts/chatPrompts.ts
  function buildNaturalChatMessages(state, userInput) {
    const contextSummary = [
      `channel=${state.channel ?? "unknown"}`,
      `components=${state.componentCount ?? 0}`,
      `nets=${state.netCount ?? 0}`,
      `issues=${state.issueCount ?? 0}`,
      `selection=${state.selectionCount ?? 0}`
    ].join(", ");
    const recentTurns = (state.chatMessages ?? []).filter((message) => message.role === "user" || message.role === "assistant").slice(-6).map((message) => ({
      role: message.role,
      content: message.content
    }));
    return [
      {
        role: "system",
        content: `\u4F60\u662F\u5609\u7ACB\u521B EDA \u63D2\u4EF6\u4E2D\u7684 AI \u52A9\u624B\u3002\u9ED8\u8BA4\u5148\u81EA\u7136\u804A\u5929\u3001\u7406\u89E3\u9700\u6C42\u3001\u7B80\u6D01\u56DE\u7B54\u3002\u5982\u679C\u63D2\u4EF6\u7AEF\u5DF2\u7ECF\u63D0\u4F9B\u4E86\u7F16\u8F91\u5668\u4E0A\u4E0B\u6587\u3001\u9009\u533A\u6458\u8981\u3001RAG \u8BC1\u636E\u6216\u5143\u4EF6\u5E93\u67E5\u8BE2\u7ED3\u679C\uFF0C\u4F60\u5FC5\u987B\u4F18\u5148\u57FA\u4E8E\u8FD9\u4E9B\u4E8B\u5B9E\u56DE\u7B54\uFF0C\u4E0D\u80FD\u5FFD\u7565\u5DE5\u5177\u89C2\u6D4B\u3002\u4E0D\u8981\u628A\u95EE\u5019\u3001\u5BD2\u6684\u6216\u666E\u901A\u95F2\u804A\u8BEF\u5224\u6210\u5206\u6790\u8BF7\u6C42\uFF0C\u4E5F\u4E0D\u8981\u5047\u88C5\u5DF2\u7ECF\u6267\u884C\u4E86\u539F\u7406\u56FE\u68C0\u67E5\u3002\u5982\u679C\u7528\u6237\u76EE\u6807\u8FD8\u4E0D\u660E\u786E\uFF0C\u5148\u8FFD\u95EE\u6F84\u6E05\uFF0C\u4E0D\u8981\u76F4\u63A5\u8F93\u51FA\u5206\u6790\u7ED3\u8BBA\u3002\u5F53\u524D\u7F16\u8F91\u5668\u4E0A\u4E0B\u6587\u6458\u8981\uFF1A${contextSummary}\u3002`
      },
      ...recentTurns,
      {
        role: "user",
        content: userInput
      }
    ];
  }
  function buildChatToolUserPrompt(input) {
    return [
      `\u7528\u6237\u95EE\u9898\uFF1A${input.userQuery}`,
      input.editorContextSummary ? `\u539F\u7406\u56FE\u4E0A\u4E0B\u6587\uFF1A${input.editorContextSummary}` : "",
      input.selectionSummary ? `\u5F53\u524D\u9009\u533A\uFF1A${input.selectionSummary}` : "",
      input.librarySummary && input.librarySummary.length > 0 ? `\u5143\u4EF6\u5E93\u4FE1\u606F\uFF1A
${input.librarySummary.map((item, index) => `${index + 1}. ${item}`).join("\n")}` : "",
      input.ragSummary && input.ragSummary.length > 0 ? `\u77E5\u8BC6\u8BC1\u636E\uFF1A
${input.ragSummary.map((item, index) => `${index + 1}. ${item}`).join("\n")}` : "",
      "\u8BF7\u57FA\u4E8E\u4EE5\u4E0A\u4E8B\u5B9E\u81EA\u7136\u56DE\u590D\u7528\u6237\u3002\u82E5\u4FE1\u606F\u4ECD\u4E0D\u8DB3\uFF0C\u660E\u786E\u6307\u51FA\u7F3A\u4EC0\u4E48\u3002\u4E0D\u8981\u7F16\u9020\u672A\u89C2\u6D4B\u5230\u7684\u539F\u7406\u56FE\u7EC6\u8282\u3002"
    ].filter(Boolean).join("\n\n");
  }

  // src/agent/policies/chatToolPolicy.ts
  function decideChatToolPolicy(query) {
    return {
      useEditorContext: /当前|这个图|这张图|这个原理图|页面|图里|图中|现在的图|当前电路/.test(query),
      useSelection: /选中|当前选中|这个器件|这个元件|这个对象|所选/.test(query),
      useLibrary: /元件|器件|封装|型号|LCSC|料号|库里|库中|symbol|footprint|package/i.test(query),
      useRag: /为什么|原理|规范|规则|怎么接|如何接|推荐|注意事项|设计要求|标准|区别|用途/.test(query),
      objectQuery: extractObjectQuery(query)
    };
  }
  function decideChatFollowupPolicy(input) {
    return {
      enrichComponentLibrary: input.objectFound && input.objectType === "component",
      enrichObjectKnowledge: Boolean(input.objectKnowledgeQuery) && input.ragSummaryCount === 0
    };
  }
  function shouldUseToolBackedPrompt(input) {
    return Boolean(
      input.contextSummary || input.selectionSummary || input.ragSummary.length > 0 || input.librarySummary.length > 0 || input.objectSummary.length > 0
    );
  }
  function buildLibraryQuery(query) {
    const lcsc = query.match(/C\d{3,}/i);
    if (lcsc) return lcsc[0];
    const token = query.match(/[A-Za-z]+[A-Za-z0-9_-]{1,}/);
    if (token) return token[0];
    return query.trim();
  }
  function extractObjectQuery(query) {
    const pinMatch = query.match(/\b([A-Za-z]+\d+)[\s.]?(PIN|pin|脚)?[\s.]?([A-Za-z0-9_+-]+)\b/);
    if (pinMatch && pinMatch[2]) {
      return `${pinMatch[1]}.${pinMatch[3]}`;
    }
    const refMatch = query.match(/\b[A-Za-z]+\d+\b/);
    if (refMatch) {
      return refMatch[0];
    }
    const netMatch = query.match(/\b(3V3|5V|VBUS|GND|VIN|VOUT|SDA|SCL|GPIO[_-]?[A-Za-z0-9]*)\b/i);
    if (netMatch) {
      return netMatch[0];
    }
    return "";
  }

  // src/agent/core/chatReactAgent.ts
  async function runChatReactAgent(deps, options) {
    const state = {
      toolTraces: [],
      stepStates: [],
      workingMemory: createWorkingMemory2(deps.task),
      reactEvents: []
    };
    const taskId = pushTask2(state, "llm", "\u7406\u89E3\u7528\u6237\u81EA\u7136\u8BED\u8A00\u95EE\u9898\u5E76\u751F\u6210\u56DE\u590D");
    updateTask2(state, taskId, "running");
    let contextSummary = summarizePanelContext(deps.panelState);
    let selectionSummary = summarizeSelection(deps.panelState);
    const ragSummary = [];
    const librarySummary = [];
    const objectSummary = [];
    let objectKnowledgeQuery = "";
    const policy = decideChatToolPolicy(deps.task.userQuery);
    if (policy.useEditorContext && canUse2(deps, "editor.get_current_context")) {
      thought2(state, "Context", "\u7528\u6237\u95EE\u9898\u6D89\u53CA\u5F53\u524D\u539F\u7406\u56FE\u6216\u5F53\u524D\u9875\u9762\uFF0C\u5148\u8865\u5145\u7F16\u8F91\u5668\u4E0A\u4E0B\u6587\u3002", "context");
      const context = await invokeObserved2(
        deps,
        state,
        "editor.get_current_context",
        void 0,
        "\u8BFB\u53D6\u5F53\u524D\u539F\u7406\u56FE\u4E0A\u4E0B\u6587"
      );
      contextSummary = [
        `channel=${context.project?.channel ?? "unknown"}`,
        `components=${context.components?.length ?? 0}`,
        `nets=${context.nets?.length ?? 0}`,
        `selection=${context.selection?.objectIds?.length ?? 0}`
      ].join(", ");
      state.workingMemory.hasContext = true;
      markStep2(state, "context", "done", "\u5DF2\u8BFB\u53D6\u5F53\u524D\u539F\u7406\u56FE\u4E0A\u4E0B\u6587");
      state.workingMemory.lastObservation = "\u5DF2\u8BFB\u53D6\u5F53\u524D\u539F\u7406\u56FE\u4E0A\u4E0B\u6587";
    }
    if (policy.useSelection && canUse2(deps, "editor.describe_selection")) {
      thought2(state, "Selection", "\u7528\u6237\u63D0\u5230\u4E86\u5F53\u524D\u9009\u4E2D\u5BF9\u8C61\uFF0C\u5148\u8BFB\u53D6\u9009\u533A\u3002", "context");
      const selection = await invokeObserved2(
        deps,
        state,
        "editor.describe_selection",
        void 0,
        "\u89E3\u91CA\u5F53\u524D\u9009\u533A"
      );
      selectionSummary = selection.summary;
    }
    const objectQuery = policy.objectQuery;
    if (objectQuery && canUse2(deps, "editor.find_object")) {
      thought2(state, "Object", "\u7528\u6237\u76F4\u63A5\u63D0\u5230\u4E86\u5668\u4EF6\u3001\u5F15\u811A\u6216\u7F51\u7EDC\u6807\u8BC6\uFF0C\u5148\u5728\u5F53\u524D\u539F\u7406\u56FE\u91CC\u67E5\u5BF9\u8C61\u3002", "context");
      const found = await invokeObserved2(
        deps,
        state,
        "editor.find_object",
        { query: objectQuery },
        `\u67E5\u627E\u539F\u7406\u56FE\u5BF9\u8C61\uFF1A${objectQuery}`
      );
      if (found.found && found.summary) {
        objectSummary.push(found.summary);
        if ((found.matches ?? []).length > 1) {
          objectSummary.push(`\u5019\u9009\u5BF9\u8C61\uFF1A${(found.matches ?? []).slice(0, 3).map((item) => item.summary).join("\uFF1B")}`);
        }
        selectionSummary = selectionSummary && selectionSummary !== "\u5F53\u524D\u6CA1\u6709\u9009\u4E2D\u5BF9\u8C61" ? `${selectionSummary}\uFF1B${found.summary}` : found.summary;
        const followupPolicy = decideChatFollowupPolicy({
          objectFound: found.found,
          objectType: found.objectType,
          objectKnowledgeQuery,
          ragSummaryCount: ragSummary.length
        });
        if (followupPolicy.enrichComponentLibrary && canUse2(deps, "library.search_devices")) {
          thought2(state, "Library", "\u5DF2\u5B9A\u4F4D\u5230\u56FE\u4E2D\u5668\u4EF6\uFF0C\u7EE7\u7EED\u8865\u5145\u5143\u4EF6\u5E93\u4E8B\u5B9E\u3002", "library");
          const libraryResults = await invokeObserved2(
            deps,
            state,
            "library.search_devices",
            { query: objectQuery, scope: "system", pageSize: 5, page: 1 },
            `\u6309\u5BF9\u8C61\u68C0\u7D22\u5143\u4EF6\u5E93\uFF1A${objectQuery}`
          );
          if (libraryResults.length > 0) {
            const top = libraryResults[0];
            let detailSummary = [
              top.name,
              top.manufacturer,
              top.footprintName ? `\u5C01\u88C5 ${top.footprintName}` : "",
              top.description || ""
            ].filter(Boolean).join("\uFF0C");
            if (canUse2(deps, "library.get_device")) {
              try {
                const detail = await invokeObserved2(
                  deps,
                  state,
                  "library.get_device",
                  { deviceUuid: top.uuid, libraryUuid: top.libraryUuid, scope: "system" },
                  `\u8BFB\u53D6\u5143\u4EF6\u5E93\u8BE6\u60C5\uFF1A${top.name}`
                );
                detailSummary = [
                  detail.name || top.name,
                  detail.lcscId ? `LCSC ${detail.lcscId}` : "",
                  detail.manufacturer || top.manufacturer || "",
                  detail.footprint?.name ? `\u5C01\u88C5 ${detail.footprint.name}` : top.footprintName ? `\u5C01\u88C5 ${top.footprintName}` : "",
                  detail.description || top.description || ""
                ].filter(Boolean).join("\uFF0C");
              } catch {
              }
            }
            librarySummary.push(detailSummary);
            state.workingMemory.libraryReady = true;
            markStep2(state, "library", "done", "\u5DF2\u8865\u5145\u5143\u4EF6\u5E93\u8BE6\u60C5");
            state.workingMemory.lastObservation = "\u5DF2\u8865\u5145\u5143\u4EF6\u5E93\u8BE6\u60C5";
            objectKnowledgeQuery = [objectQuery, top.name, top.description || "", detailSummary].filter(Boolean).join(" ");
          }
        }
      }
    }
    if (policy.useLibrary && canUse2(deps, "library.search_devices")) {
      thought2(state, "Library", "\u7528\u6237\u95EE\u9898\u50CF\u662F\u5728\u95EE\u5143\u4EF6\u6216\u5C01\u88C5\u4FE1\u606F\uFF0C\u5148\u67E5\u5143\u4EF6\u5E93\u4E8B\u5B9E\u3002", "library");
      const query = buildLibraryQuery(deps.task.userQuery);
      const results = await invokeObserved2(
        deps,
        state,
        "library.search_devices",
        { query, scope: "system", pageSize: 6, page: 1 },
        `\u67E5\u8BE2\u5143\u4EF6\u5E93\uFF1A${query}`
      );
      librarySummary.push(
        ...results.slice(0, 3).map(
          (item) => [item.name, item.manufacturer, item.footprintName ? `\u5C01\u88C5 ${item.footprintName}` : "", item.description || ""].filter(Boolean).join("\uFF0C")
        )
      );
      if (librarySummary.length > 0) {
        state.workingMemory.libraryReady = true;
        markStep2(state, "library", "done", `\u5143\u4EF6\u5E93\u8FD4\u56DE ${librarySummary.length} \u6761\u6458\u8981`);
        state.workingMemory.lastObservation = `\u5143\u4EF6\u5E93\u8FD4\u56DE ${librarySummary.length} \u6761\u6458\u8981`;
      }
    }
    if (policy.useRag && canUse2(deps, "rag.search")) {
      thought2(state, "RAG", "\u7528\u6237\u95EE\u9898\u50CF\u662F\u5728\u95EE\u539F\u7406\u6216\u89C4\u8303\uFF0C\u5148\u67E5\u77E5\u8BC6\u8BC1\u636E\u3002", "mcp");
      const rag = await invokeObserved2(
        deps,
        state,
        "rag.search",
        { query: deps.task.userQuery, topK: 3 },
        "\u67E5\u8BE2\u77E5\u8BC6\u8BC1\u636E"
      );
      ragSummary.push(
        ...(rag.results ?? []).slice(0, 3).map(
          (item) => [item.title, item.kb_type ? `\u7C7B\u578B ${item.kb_type}` : "", item.source_ref ? `\u6765\u6E90 ${item.source_ref}` : "", item.snippet || item.content || ""].filter(Boolean).join("\uFF0C")
        )
      );
      if (ragSummary.length > 0) {
        state.workingMemory.mcpReady = true;
        markStep2(state, "mcp", "done", `\u77E5\u8BC6\u8BC1\u636E ${ragSummary.length} \u6761`);
        state.workingMemory.lastObservation = `\u77E5\u8BC6\u8BC1\u636E ${ragSummary.length} \u6761`;
      }
    }
    const objectFollowupPolicy = decideChatFollowupPolicy({
      objectFound: Boolean(objectSummary.length),
      objectKnowledgeQuery,
      ragSummaryCount: ragSummary.length
    });
    if (objectFollowupPolicy.enrichObjectKnowledge && canUse2(deps, "rag.search")) {
      thought2(state, "RAG", "\u5DF2\u8BC6\u522B\u5230\u5177\u4F53\u5668\u4EF6\uFF0C\u7EE7\u7EED\u8865\u5145\u8FD9\u7C7B\u5668\u4EF6\u7684\u7528\u9014\u548C\u8BBE\u8BA1\u6CE8\u610F\u4E8B\u9879\u3002", "mcp");
      const rag = await invokeObserved2(
        deps,
        state,
        "rag.search",
        { query: `${objectKnowledgeQuery} \u5668\u4EF6\u7528\u9014 \u4F7F\u7528\u6CE8\u610F\u4E8B\u9879 \u5178\u578B\u63A5\u6CD5`, topK: 3 },
        `\u67E5\u8BE2\u5668\u4EF6\u77E5\u8BC6\u8BF4\u660E\uFF1A${objectQuery}`
      );
      ragSummary.push(
        ...(rag.results ?? []).slice(0, 3).map(
          (item) => [item.title, item.kb_type ? `\u7C7B\u578B ${item.kb_type}` : "", item.source_ref ? `\u6765\u6E90 ${item.source_ref}` : "", item.snippet || item.content || ""].filter(Boolean).join("\uFF0C")
        )
      );
      if (ragSummary.length > 0) {
        state.workingMemory.mcpReady = true;
        markStep2(state, "mcp", "done", `\u5DF2\u8865\u5145\u5668\u4EF6\u77E5\u8BC6 ${ragSummary.length} \u6761`);
        state.workingMemory.lastObservation = `\u5DF2\u8865\u5145\u5668\u4EF6\u77E5\u8BC6 ${ragSummary.length} \u6761`;
      }
    }
    thought2(state, "Chat", "\u57FA\u4E8E\u6700\u8FD1\u5BF9\u8BDD\u548C\u5DF2\u89C2\u6D4B\u5230\u7684\u5DE5\u5177\u7ED3\u679C\u751F\u6210\u81EA\u7136\u56DE\u590D\u3002", "llm");
    markStep2(state, "llm", "running", "\u51C6\u5907\u81EA\u7136\u5BF9\u8BDD\u8BF7\u6C42");
    const llmMessages = shouldUseToolBackedPrompt({
      contextSummary,
      selectionSummary,
      ragSummary,
      librarySummary,
      objectSummary
    }) ? [
      {
        role: "system",
        content: "\u4F60\u662F\u5609\u7ACB\u521B EDA \u63D2\u4EF6\u4E2D\u7684 AI \u52A9\u624B\u3002\u73B0\u5728\u63D2\u4EF6\u7AEF agent \u5DF2\u7ECF\u63D0\u4F9B\u4E86\u90E8\u5206\u5DE5\u5177\u89C2\u6D4B\u7ED3\u679C\u3002\u4F60\u5FC5\u987B\u4F18\u5148\u4F7F\u7528\u8FD9\u4E9B\u89C2\u6D4B\u7ED3\u679C\u56DE\u7B54\uFF0C\u4E0D\u80FD\u5FFD\u7565\u4E8B\u5B9E\u540E\u81EA\u7531\u53D1\u6325\u3002"
      },
      {
        role: "user",
        content: buildChatToolUserPrompt({
          userQuery: deps.task.userQuery,
          editorContextSummary: contextSummary,
          selectionSummary,
          ragSummary,
          librarySummary: [...objectSummary, ...librarySummary]
        })
      }
    ] : buildNaturalChatMessages(deps.panelState, deps.task.userQuery);
    const result = await invokeObserved2(
      deps,
      state,
      "llm.generate",
      {
        stream: true,
        onEvent: (event) => {
          if (event.type === "delta" && event.delta) {
            options?.onStreamEvent?.({ route: "chat", stage: "llm", textDelta: event.delta, detail: "\u6B63\u5728\u751F\u6210\u56DE\u590D..." });
          }
          if (event.type === "done") {
            options?.onStreamEvent?.({ route: "chat", stage: "llm", text: event.output_text, detail: "\u56DE\u590D\u5DF2\u751F\u6210" });
          }
        },
        messages: llmMessages
      },
      "\u751F\u6210\u81EA\u7136\u8BED\u8A00\u56DE\u590D"
    );
    updateTask2(state, taskId, "done", "\u81EA\u7136\u8BED\u8A00\u56DE\u590D\u5DF2\u751F\u6210");
    markStep2(state, "llm", "done", "\u81EA\u7136\u8BED\u8A00\u56DE\u590D\u5DF2\u751F\u6210");
    state.workingMemory.llmReady = true;
    state.workingMemory.lastObservation = "\u81EA\u7136\u8BED\u8A00\u56DE\u590D\u5DF2\u751F\u6210";
    final2(state, "\u81EA\u7136\u5BF9\u8BDD\u5B8C\u6210");
    return {
      reactEvents: state.reactEvents,
      result: {
        summary: "natural chat reply generated",
        naturalReply: result.output_text?.trim() || "\u6211\u6682\u65F6\u6CA1\u6709\u751F\u6210\u53EF\u5C55\u793A\u7684\u56DE\u590D\u3002",
        toolTraceNames: deps.listToolNames(),
        toolTraces: state.toolTraces,
        stepStates: state.stepStates,
        workingMemory: state.workingMemory
      }
    };
  }
  function createWorkingMemory2(task) {
    return { hasContext: Boolean(task.context), mcpReady: false, libraryReady: false, llmReady: false, rulesReady: false, draftReady: false };
  }
  function canUse2(deps, toolName) {
    return deps.allowedTools.includes(toolName);
  }
  function summarizePanelContext(state) {
    return [
      `channel=${state.channel ?? "unknown"}`,
      `components=${state.componentCount ?? 0}`,
      `nets=${state.netCount ?? 0}`,
      `issues=${state.issueCount ?? 0}`,
      `selection=${state.selectionCount ?? 0}`
    ].join(", ");
  }
  function summarizeSelection(state) {
    if (!state.selectionCount) {
      return "\u5F53\u524D\u6CA1\u6709\u9009\u4E2D\u5BF9\u8C61";
    }
    return `\u5F53\u524D\u9009\u4E2D ${state.selectionCount} \u4E2A\u5BF9\u8C61`;
  }
  function pushTask2(state, stepKind, text) {
    const id = `${stepKind}:${text}`;
    state.reactEvents.push({ kind: "task", label: "Task", status: "pending", text, stepKind });
    return id;
  }
  function updateTask2(state, id, status, text) {
    const event = state.reactEvents.find((item) => item.kind === "task" && `${item.stepKind}:${item.text}` === id);
    if (!event) return;
    event.status = status;
    if (text) event.text = text;
  }
  function thought2(state, label, text, stepKind) {
    state.reactEvents.push({ kind: "thought", label, status: "done", text, stepKind });
  }
  function final2(state, text) {
    state.reactEvents.push({ kind: "final", label: "Finish", status: "done", text });
  }
  function markStep2(state, kind, status, observation) {
    const existing = state.stepStates.find((step2) => step2.kind === kind);
    if (existing) {
      existing.status = status;
      existing.observation = observation;
      return;
    }
    state.stepStates.push({ kind, required: true, note: `react agent step ${kind}`, status, observation });
  }
  async function invokeObserved2(deps, state, toolName, input, goal) {
    const inputSummary = summarizeToolInput2(toolName, input);
    state.reactEvents.push({ kind: "tool_call", label: mapToolNameToLabel2(toolName), status: "running", text: goal, toolName, inputSummary });
    try {
      const output = await deps.invokeTool(toolName, input);
      const outputSummary = summarizeToolOutput2(toolName, output);
      state.toolTraces.push({ toolName, status: "success", note: outputSummary || void 0 });
      state.reactEvents.push({ kind: "observation", label: mapToolNameToLabel2(toolName), status: "done", text: outputSummary || `${mapToolNameToLabel2(toolName)} completed`, toolName, outputSummary });
      return output;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      state.toolTraces.push({ toolName, status: "blocked", note: message });
      state.reactEvents.push({ kind: "observation", label: mapToolNameToLabel2(toolName), status: "failed", text: message, toolName, outputSummary: message });
      throw error;
    }
  }
  function summarizeToolInput2(toolName, input) {
    if ((toolName === "llm.generate" || toolName === "rag.search") && input && typeof input === "object") {
      if (toolName === "llm.generate") return `messages=${(input.messages || []).length}`;
      return `query=${String(input.query || "")}`;
    }
    if (toolName === "library.search_devices" && input && typeof input === "object") {
      return `query=${String(input.query || "")}`;
    }
    return "";
  }
  function summarizeToolOutput2(toolName, output) {
    if (toolName === "llm.generate" && output && typeof output === "object") {
      const text = output.output_text || "";
      return text ? `\u5DF2\u751F\u6210 ${text.length} \u5B57\u56DE\u590D` : "\u5DF2\u751F\u6210\u56DE\u590D";
    }
    if (toolName === "editor.get_current_context" && output && typeof output === "object") {
      const context = output;
      return `\u4E0A\u4E0B\u6587\uFF1A\u5668\u4EF6 ${context.components?.length ?? 0} \u4E2A\uFF0C\u7F51\u7EDC ${context.nets?.length ?? 0} \u6761\uFF0C\u9009\u533A ${(context.selection?.objectIds || []).length} \u4E2A`;
    }
    if (toolName === "editor.get_selection" && output && typeof output === "object") {
      const selection = output;
      return selection.objectIds?.length ? `\u9009\u4E2D ${selection.objectIds.length} \u4E2A\u5BF9\u8C61${selection.objectType ? `\uFF0C\u7C7B\u578B ${selection.objectType}` : ""}` : "\u5F53\u524D\u6CA1\u6709\u9009\u4E2D\u5BF9\u8C61";
    }
    if (toolName === "editor.describe_selection" && output && typeof output === "object") {
      return output.summary || "\u5DF2\u89E3\u91CA\u5F53\u524D\u9009\u533A";
    }
    if (toolName === "editor.find_object" && output && typeof output === "object") {
      const result = output;
      if ((result.matches ?? []).length > 1) {
        return `${result.summary}\uFF1B\u5019\u9009 ${(result.matches ?? []).length} \u4E2A`;
      }
      return result.summary || "\u5DF2\u627E\u5230\u76F8\u5173\u5BF9\u8C61";
    }
    if (toolName === "rag.search" && output && typeof output === "object") {
      return `\u77E5\u8BC6\u8BC1\u636E ${(output.results || []).length} \u6761`;
    }
    if (toolName === "library.search_devices" && Array.isArray(output)) {
      if (output.length === 0) return "\u672A\u627E\u5230\u5339\u914D\u5143\u4EF6";
      const first = output[0];
      return [`\u627E\u5230 ${output.length} \u4E2A\u5019\u9009`, first.name ? `\u9996\u9879 ${first.name}` : "", first.manufacturer || "", first.footprintName ? `\u5C01\u88C5 ${first.footprintName}` : ""].filter(Boolean).join("\uFF0C");
    }
    if (toolName === "library.get_device" && output && typeof output === "object") {
      const detail = output;
      return [
        detail.name || "",
        detail.lcscId ? `LCSC ${detail.lcscId}` : "",
        detail.manufacturer || "",
        detail.footprint?.name ? `\u5C01\u88C5 ${detail.footprint.name}` : "",
        detail.description || ""
      ].filter(Boolean).join("\uFF0C");
    }
    return "";
  }
  function mapToolNameToLabel2(toolName) {
    const map = {
      "llm.generate": "llm_generate_reply",
      "editor.get_current_context": "jlceda_get_schematic_context",
      "editor.get_selection": "jlceda_get_selection",
      "editor.describe_selection": "jlceda_describe_selection",
      "editor.describe_object": "jlceda_describe_object",
      "editor.find_object": "jlceda_find_object",
      "rag.search": "rag_search",
      "library.search_devices": "jlceda_search_component_library",
      "library.get_device": "jlceda_get_component_detail"
    };
    return map[toolName] ?? toolName;
  }

  // src/agent/prompts/draftPrompts.ts
  function buildDraftPlannerSystemPrompt() {
    return [
      "\u4F60\u662F\u5609\u7ACB\u521B EDA \u63D2\u4EF6\u4E2D\u7684\u539F\u7406\u56FE\u8349\u6848\u89C4\u5212\u52A9\u624B\u3002",
      "\u4F60\u7684\u4EFB\u52A1\u662F\u5148\u7ED9\u51FA\u7B80\u6D01\u3001\u5DE5\u7A0B\u5316\u7684\u62D3\u6251\u5EFA\u8BAE\u548C\u5173\u952E\u7F51\u7EDC\u63D0\u793A\uFF0C\u4F9B\u63D2\u4EF6\u7AEF draft planner \u7EE7\u7EED\u751F\u6210\u7ED3\u6784\u5316\u8349\u6848\u3002",
      "\u4E0D\u8981\u8F93\u51FA\u957F\u7BC7\u80CC\u666F\u77E5\u8BC6\uFF0C\u4E0D\u8981\u5047\u88C5\u5DF2\u7ECF\u5728\u7F16\u8F91\u5668\u4E2D\u843D\u56FE\u3002",
      "\u5982\u679C\u7528\u6237\u9700\u6C42\u4ECD\u4E0D\u660E\u786E\uFF0C\u4F18\u5148\u6307\u51FA\u8FD8\u7F3A\u54EA\u4E9B\u7EA6\u675F\u6761\u4EF6\u3002"
    ].join("");
  }
  function buildDraftPlannerUserPrompt(userQuery, libraryHint) {
    return libraryHint ? `${userQuery}

${libraryHint}` : userQuery;
  }

  // src/agent/core/draftReactAgent.ts
  async function runDraftReactAgent(deps) {
    assertContext2(deps.task);
    const state = {
      toolTraces: [],
      stepStates: [],
      workingMemory: createWorkingMemory3(deps.task),
      reactEvents: []
    };
    const mcpResources = [];
    const mcpResourceReads = [];
    const selectedDevices = [];
    let liveContext = deps.task.context;
    let llmDraftHint;
    let libraryHint = "";
    let draftPlan;
    let draftPreview;
    let draftValidation;
    let draftRisk;
    const tasks = {
      context: pushTask3(state, "context", "\u8BFB\u53D6\u5F53\u524D\u539F\u7406\u56FE\u4E0A\u4E0B\u6587\u5E76\u540C\u6B65\u5230\u8349\u6848\u89C4\u5212"),
      library: pushTask3(state, "library", "\u67E5\u8BE2\u5019\u9009\u5143\u4EF6\u4E0E\u5C01\u88C5\u4FE1\u606F"),
      llm: pushTask3(state, "llm", "\u8BA9\u6A21\u578B\u751F\u6210\u8349\u6848\u62D3\u6251\u63D0\u793A"),
      draft: pushTask3(state, "draft", "\u751F\u6210\u8349\u6848\u5E76\u6784\u5EFA\u9884\u89C8"),
      rules: pushTask3(state, "rules", "\u6821\u9A8C\u8349\u6848\u7EA6\u675F\u4E0E\u98CE\u9669")
    };
    emitProgress2(deps, state, "\u5F00\u59CB\u751F\u6210\u8349\u6848");
    if (canUse3(deps, "mcp.list_resources")) {
      thought3(state, "Knowledge", "\u5148\u8865\u5145\u5DE5\u7A0B\u77E5\u8BC6\u4E0E\u8BBE\u8BA1\u7EA6\u675F\uFF0C\u518D\u8FDB\u5165\u8349\u6848\u89C4\u5212\u3002", "mcp");
      emitProgress2(deps, state, "\u6B63\u5728\u8BFB\u53D6\u77E5\u8BC6\u4E0E\u8BBE\u8BA1\u7EA6\u675F");
      const resources = await invokeObserved3(deps, state, "mcp.list_resources", void 0, "\u5217\u51FA\u77E5\u8BC6\u8D44\u6E90");
      resources.resources.forEach((item) => mcpResources.push(item));
      markStep3(state, "mcp", mcpResources.length > 0 ? "done" : "skipped", `\u77E5\u8BC6\u8D44\u6E90 ${mcpResources.length} \u6761`);
      state.workingMemory.mcpReady = mcpResources.length > 0;
      if (canUse3(deps, "mcp.read_resource")) {
        for (const resource of mcpResources.slice(0, 2)) {
          try {
            const read = await invokeObserved3(deps, state, "mcp.read_resource", { uri: resource.uri }, `\u8BFB\u53D6\u77E5\u8BC6\u8D44\u6E90 ${resource.uri}`);
            mcpResourceReads.push({ uri: read.uri, title: read.title, summary: read.summary });
          } catch {
          }
        }
        if (mcpResourceReads.length > 0) {
          markStep3(state, "mcp", "done", `\u77E5\u8BC6\u6458\u8981 ${mcpResourceReads.length} \u6761`);
          state.workingMemory.mcpReady = true;
        }
      }
      emitProgress2(deps, state, mcpResourceReads.length > 0 ? `\u5DF2\u8BFB\u53D6 ${mcpResourceReads.length} \u6761\u77E5\u8BC6\u6458\u8981` : `\u77E5\u8BC6\u8D44\u6E90 ${mcpResources.length} \u6761`);
    }
    updateTask3(state, tasks.context, "running");
    thought3(state, "Context", "\u540C\u6B65\u7F16\u8F91\u5668\u91CC\u7684\u6700\u65B0\u4E0A\u4E0B\u6587\uFF0C\u786E\u4FDD\u8349\u6848\u57FA\u4E8E\u5F53\u524D\u753B\u5E03\u72B6\u6001\u3002", "context");
    emitProgress2(deps, state, "\u6B63\u5728\u540C\u6B65\u539F\u7406\u56FE\u4E0A\u4E0B\u6587");
    if (canUse3(deps, "editor.get_current_context")) {
      liveContext = await invokeObserved3(deps, state, "editor.get_current_context", void 0, "\u83B7\u53D6\u5F53\u524D\u539F\u7406\u56FE\u4E0A\u4E0B\u6587");
    }
    updateTask3(state, tasks.context, "done", "\u8349\u6848\u4E0A\u4E0B\u6587\u5DF2\u5C31\u7EEA");
    emitProgress2(deps, state, "\u8349\u6848\u4E0A\u4E0B\u6587\u5DF2\u5C31\u7EEA");
    markStep3(state, "context", "done", "\u8349\u6848\u4E0A\u4E0B\u6587\u5DF2\u5C31\u7EEA");
    state.workingMemory.hasContext = true;
    state.workingMemory.lastObservation = "\u8349\u6848\u4E0A\u4E0B\u6587\u5DF2\u5C31\u7EEA";
    if (canUse3(deps, "library.search_devices")) {
      updateTask3(state, tasks.library, "running");
      thought3(state, "Library", "\u5148\u627E\u5019\u9009\u5668\u4EF6\u4E0E\u5C01\u88C5\uFF0C\u518D\u8BA9\u6A21\u578B\u7ED9\u51FA\u66F4\u5177\u4F53\u7684\u62D3\u6251\u5EFA\u8BAE\u3002", "library");
      emitProgress2(deps, state, "\u6B63\u5728\u67E5\u8BE2\u5019\u9009\u5143\u4EF6\u4E0E\u5C01\u88C5");
      const libraryResults = await invokeObserved3(
        deps,
        state,
        "library.search_devices",
        { query: deps.task.userQuery, scope: "system", pageSize: 12, page: 1 },
        "\u67E5\u8BE2\u5019\u9009\u5143\u4EF6"
      );
      if (libraryResults.length > 0) {
        libraryHint = buildLibraryHint(libraryResults);
        selectedDevices.push(...pickSelectedDevices(deps.task.userQuery, libraryResults));
        if (/ldo|稳压|regulator|3\.3v|5v/i.test(deps.task.userQuery)) {
          try {
            const capacitorResults = await invokeObserved3(
              deps,
              state,
              "library.search_devices",
              { query: "10uF capacitor 0603", scope: "system", pageSize: 12, page: 1 },
              "\u67E5\u8BE2\u8F93\u5165\u8F93\u51FA\u7535\u5BB9"
            );
            const capacitor = pickBestLibraryCandidate(capacitorResults, ["capacitor", "10uf", "0603"]);
            if (capacitor?.uuid && capacitor.libraryUuid) {
              for (const role of ["input_capacitor", "output_capacitor"]) {
                selectedDevices.push({
                  role,
                  query: "10uF capacitor",
                  deviceUuid: capacitor.uuid,
                  libraryUuid: capacitor.libraryUuid,
                  name: capacitor.name,
                  manufacturer: capacitor.manufacturer,
                  symbolUuid: capacitor.symbolUuid,
                  symbolName: capacitor.symbolName,
                  footprintUuid: capacitor.footprintUuid,
                  footprintName: capacitor.footprintName
                });
              }
            }
          } catch {
          }
        }
      }
      updateTask3(state, tasks.library, libraryResults.length > 0 ? "done" : "skipped", libraryResults.length > 0 ? `\u5DF2\u83B7\u53D6 ${libraryResults.length} \u4E2A\u5019\u9009\u5143\u4EF6` : "\u672A\u627E\u5230\u5339\u914D\u5143\u4EF6");
      markStep3(state, "library", libraryResults.length > 0 ? "done" : "skipped", libraryResults.length > 0 ? `\u5DF2\u83B7\u53D6 ${libraryResults.length} \u4E2A\u5019\u9009\u5143\u4EF6` : "\u672A\u627E\u5230\u5339\u914D\u5143\u4EF6");
      state.workingMemory.libraryReady = libraryResults.length > 0;
      state.workingMemory.lastObservation = libraryResults.length > 0 ? `\u5019\u9009\u5143\u4EF6 ${libraryResults.length} \u4E2A` : state.workingMemory.lastObservation;
      emitProgress2(deps, state, libraryResults.length > 0 ? `\u5DF2\u83B7\u53D6 ${libraryResults.length} \u4E2A\u5019\u9009\u5143\u4EF6` : "\u672A\u627E\u5230\u5339\u914D\u5143\u4EF6");
    } else {
      updateTask3(state, tasks.library, "skipped", "\u5F53\u524D\u5BBF\u4E3B\u672A\u63D0\u4F9B\u5143\u4EF6\u641C\u7D22\u80FD\u529B");
      markStep3(state, "library", "skipped", "\u5F53\u524D\u5BBF\u4E3B\u672A\u63D0\u4F9B\u5143\u4EF6\u641C\u7D22\u80FD\u529B");
    }
    updateTask3(state, tasks.llm, canUse3(deps, "llm.generate") ? "running" : "skipped");
    if (canUse3(deps, "llm.generate")) {
      thought3(state, "LLM", "\u5148\u8BA9\u6A21\u578B\u7ED9\u51FA\u8349\u6848\u62D3\u6251\u63D0\u793A\uFF0C\u518D\u8FDB\u5165\u7ED3\u6784\u5316\u843D\u56FE\u8BA1\u5212\u3002", "llm");
      emitProgress2(deps, state, "\u6B63\u5728\u751F\u6210\u8349\u6848\u62D3\u6251\u63D0\u793A");
      const llmResult = await invokeObserved3(
        deps,
        state,
        "llm.generate",
        {
          stream: true,
          onEvent: (event) => {
            if (event.type === "delta" && event.delta) {
              emitProgress2(deps, state, "\u6B63\u5728\u751F\u6210\u8349\u6848\u62D3\u6251\u63D0\u793A", event.delta);
            }
            if (event.type === "done") {
              emitProgress2(deps, state, "\u8349\u6848\u62D3\u6251\u63D0\u793A\u5DF2\u751F\u6210", void 0, event.output_text);
            }
          },
          messages: [
            { role: "system", content: buildDraftPlannerSystemPrompt() },
            { role: "user", content: buildDraftPlannerUserPrompt(deps.task.userQuery, libraryHint || void 0) }
          ]
        },
        "\u751F\u6210\u8349\u6848\u62D3\u6251\u63D0\u793A"
      );
      llmDraftHint = llmResult.output_text;
      updateTask3(state, tasks.llm, "done", llmDraftHint ? "\u5DF2\u751F\u6210\u8349\u6848\u62D3\u6251\u63D0\u793A" : "\u6A21\u578B\u672A\u8FD4\u56DE\u6709\u6548\u63D0\u793A");
      markStep3(state, "llm", "done", llmDraftHint ? "\u5DF2\u751F\u6210\u8349\u6848\u62D3\u6251\u63D0\u793A" : "\u6A21\u578B\u672A\u8FD4\u56DE\u6709\u6548\u63D0\u793A");
      state.workingMemory.llmReady = true;
      state.workingMemory.lastObservation = llmDraftHint ? "\u5DF2\u751F\u6210\u8349\u6848\u62D3\u6251\u63D0\u793A" : state.workingMemory.lastObservation;
      emitProgress2(deps, state, llmDraftHint ? "\u8349\u6848\u62D3\u6251\u63D0\u793A\u5DF2\u751F\u6210" : "\u6A21\u578B\u672A\u8FD4\u56DE\u6709\u6548\u63D0\u793A");
    } else {
      markStep3(state, "llm", "skipped", "LLM \u4E0D\u53EF\u7528\uFF0C\u76F4\u63A5\u8FDB\u5165\u8349\u6848\u751F\u6210");
    }
    updateTask3(state, tasks.draft, "running");
    thought3(state, "Draft", "\u5C06\u9700\u6C42\u3001\u5143\u4EF6\u5019\u9009\u548C\u6A21\u578B\u63D0\u793A\u7EC4\u5408\u4E3A\u7ED3\u6784\u5316\u8349\u6848\u8BA1\u5212\u3002", "draft");
    emitProgress2(deps, state, "\u6B63\u5728\u751F\u6210\u7ED3\u6784\u5316\u8349\u6848\u4E0E\u9884\u89C8");
    draftPlan = await invokeObserved3(
      deps,
      state,
      "draft.generate_plan",
      { userQuery: llmDraftHint ? `${deps.task.userQuery}
${llmDraftHint}` : deps.task.userQuery, selectedDevices },
      "\u751F\u6210\u7ED3\u6784\u5316\u8349\u6848\u8BA1\u5212"
    );
    draftPreview = await invokeObserved3(
      deps,
      state,
      "draft.preview_plan",
      { plan: draftPlan },
      "\u6784\u5EFA\u8349\u6848\u9884\u89C8"
    );
    updateTask3(state, tasks.draft, "done", `\u5DF2\u751F\u6210\u8349\u6848\uFF0C\u5668\u4EF6 ${draftPlan?.components.length ?? 0} \u4E2A\uFF0C\u7F51\u7EDC ${draftPlan?.nets.length ?? 0} \u6761`);
    markStep3(state, "draft", "done", `\u5DF2\u751F\u6210\u8349\u6848\uFF0C\u5668\u4EF6 ${draftPlan?.components.length ?? 0} \u4E2A\uFF0C\u7F51\u7EDC ${draftPlan?.nets.length ?? 0} \u6761`);
    state.workingMemory.draftReady = true;
    state.workingMemory.lastObservation = `\u8349\u6848\u5668\u4EF6 ${draftPlan?.components.length ?? 0} \u4E2A\uFF0C\u7F51\u7EDC ${draftPlan?.nets.length ?? 0} \u6761`;
    emitProgress2(deps, state, `\u8349\u6848\u5DF2\u751F\u6210\uFF0C\u5668\u4EF6 ${draftPlan?.components.length ?? 0} \u4E2A\uFF0C\u7F51\u7EDC ${draftPlan?.nets.length ?? 0} \u6761`);
    updateTask3(state, tasks.rules, "running");
    thought3(state, "Validate", "\u5728\u9884\u89C8\u524D\u6267\u884C\u89C4\u5219\u6821\u9A8C\uFF0C\u786E\u4FDD\u9AD8\u98CE\u9669\u8349\u6848\u4E0D\u4F1A\u76F4\u63A5\u8FDB\u5165\u5E94\u7528\u3002", "rules");
    emitProgress2(deps, state, "\u6B63\u5728\u6821\u9A8C\u8349\u6848\u98CE\u9669");
    draftValidation = await invokeObserved3(
      deps,
      state,
      "rules.validate_draft",
      { draft: { components: draftPlan.components, pins: draftPlan.pins, nets: draftPlan.nets } },
      "\u6821\u9A8C\u8349\u6848\u7EA6\u675F"
    );
    draftRisk = evaluateDraftRisk(draftValidation);
    if (canUse3(deps, "editor.preview_apply_plan")) {
      await invokeObserved3(deps, state, "editor.preview_apply_plan", { plan: draftPlan }, "\u6E32\u67D3\u8349\u6848\u9884\u89C8");
    }
    updateTask3(state, tasks.rules, draftRisk.level === "blocked" ? "failed" : "done", draftRisk.message);
    markStep3(state, "rules", "done", draftValidation?.summary ?? draftRisk.message);
    state.workingMemory.rulesReady = true;
    state.workingMemory.lastObservation = draftValidation?.summary ?? draftRisk.message;
    emitProgress2(deps, state, draftRisk.message);
    final3(state, `\u8349\u6848\u6D41\u7A0B\u5B8C\u6210\uFF0C\u98CE\u9669\u7EA7\u522B ${draftRisk.level}`);
    emitProgress2(deps, state, `\u8349\u6848\u6D41\u7A0B\u5B8C\u6210\uFF0C\u98CE\u9669\u7EA7\u522B ${draftRisk.level}`);
    return {
      reactEvents: state.reactEvents,
      result: {
        summary: `generated draft plan; ${draftValidation?.summary ?? "no validation result"}; mcp_resources=${mcpResources.length}`,
        nextSuggestions: buildDraftSuggestions(draftRisk, draftValidation),
        structuredSuggestions: buildDraftStructuredSuggestions(draftRisk),
        llmDraftHint,
        toolTraceNames: deps.listToolNames(),
        toolTraces: state.toolTraces,
        mcpResources,
        mcpResourceReads,
        draftPlan,
        draftPreview,
        draftValidation,
        draftRisk,
        contextDigest: {
          channel: liveContext.project.channel,
          componentCount: liveContext.components.length,
          netCount: liveContext.nets.length,
          selectionCount: liveContext.selection.objectIds.length
        },
        stepStates: state.stepStates,
        workingMemory: state.workingMemory
      }
    };
  }
  function emitProgress2(deps, state, detail, textDelta, text) {
    deps.onProgress?.({
      detail,
      textDelta,
      text,
      reactEvents: state.reactEvents.map((item) => ({ ...item })),
      stepStates: state.stepStates.map((item) => ({ ...item })),
      workingMemory: { ...state.workingMemory }
    });
  }
  function assertContext2(task) {
    if (!task.context) throw new Error(`task context missing: ${task.type}`);
  }
  function createWorkingMemory3(task) {
    return { hasContext: Boolean(task.context), mcpReady: false, libraryReady: false, llmReady: false, rulesReady: false, draftReady: false };
  }
  function canUse3(deps, toolName) {
    return deps.allowedTools.includes(toolName);
  }
  function pushTask3(state, stepKind, text) {
    const id = `${stepKind}:${text}`;
    state.reactEvents.push({ kind: "task", label: "Task", status: "pending", text, stepKind });
    return id;
  }
  function updateTask3(state, id, status, text) {
    const event = state.reactEvents.find((item) => item.kind === "task" && `${item.stepKind}:${item.text}` === id);
    if (!event) return;
    event.status = status;
    if (text) event.text = text;
  }
  function thought3(state, label, text, stepKind) {
    state.reactEvents.push({ kind: "thought", label, status: "done", text, stepKind });
  }
  function final3(state, text) {
    state.reactEvents.push({ kind: "final", label: "Finish", status: "done", text });
  }
  function markStep3(state, kind, status, observation) {
    const existing = state.stepStates.find((step2) => step2.kind === kind);
    if (existing) {
      existing.status = status;
      existing.observation = observation;
      return;
    }
    state.stepStates.push({ kind, required: true, note: `react agent step ${kind}`, status, observation });
  }
  async function invokeObserved3(deps, state, toolName, input, goal) {
    const inputSummary = summarizeToolInput3(toolName, input);
    state.reactEvents.push({ kind: "tool_call", label: mapToolNameToLabel3(toolName), status: "running", text: goal, toolName, inputSummary });
    try {
      const output = await deps.invokeTool(toolName, input);
      const outputSummary = summarizeToolOutput3(toolName, output);
      state.toolTraces.push({ toolName, status: "success", note: outputSummary || void 0 });
      state.reactEvents.push({ kind: "observation", label: mapToolNameToLabel3(toolName), status: "done", text: outputSummary || `${mapToolNameToLabel3(toolName)} completed`, toolName, outputSummary });
      return output;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      state.toolTraces.push({ toolName, status: "blocked", note: message });
      state.reactEvents.push({ kind: "observation", label: mapToolNameToLabel3(toolName), status: "failed", text: message, toolName, outputSummary: message });
      throw error;
    }
  }
  function pickSelectedDevices(userQuery, items) {
    const selected = [];
    if (/ldo|稳压|regulator|3\.3v|5v/i.test(userQuery)) {
      const ldo = pickBestLibraryCandidate(items, ["ldo", "regulator", "3.3v", "5v", "sot-23", "sot23"]);
      if (ldo?.uuid && ldo.libraryUuid) {
        selected.push({
          role: "ldo_regulator",
          query: userQuery,
          deviceUuid: ldo.uuid,
          libraryUuid: ldo.libraryUuid,
          name: ldo.name,
          manufacturer: ldo.manufacturer,
          symbolUuid: ldo.symbolUuid,
          symbolName: ldo.symbolName,
          footprintUuid: ldo.footprintUuid,
          footprintName: ldo.footprintName
        });
      }
    }
    return selected;
  }
  function buildLibraryHint(items) {
    return "\u53EF\u53C2\u8003\u7684\u7EFC\u5408\u5E93\u5019\u9009\u5668\u4EF6\uFF1A\n" + items.slice(0, 5).map((item) => `- ${item.name} (uuid=${item.uuid}${item.manufacturer ? `, manufacturer=${item.manufacturer}` : ""}${item.footprintName ? `, footprint=${item.footprintName}` : ""}${item.symbolName ? `, symbol=${item.symbolName}` : ""})`).join("\n");
  }
  function pickBestLibraryCandidate(items, keywords) {
    return items.map((item) => ({ item, score: scoreLibraryCandidate(item, keywords) })).sort((a, b) => b.score - a.score)[0]?.item;
  }
  function scoreLibraryCandidate(item, keywords) {
    const haystack = [item.name ?? "", item.description ?? "", item.footprintName ?? "", item.manufacturer ?? ""].join(" ").toLowerCase();
    return keywords.reduce((score, keyword) => haystack.includes(keyword.toLowerCase()) ? score + 10 : score, 0);
  }
  function evaluateDraftRisk(draftValidation) {
    const issues = draftValidation?.issues ?? [];
    const highSeverityCount = issues.filter((issue) => issue.severity === "high").length;
    if (highSeverityCount > 0) {
      return { level: "blocked", issueCount: issues.length, highSeverityCount, message: `\u5B58\u5728 ${highSeverityCount} \u4E2A\u9AD8\u98CE\u9669\u95EE\u9898\uFF0C\u963B\u65AD\u76F4\u63A5\u5E94\u7528` };
    }
    if (issues.length > 0) {
      return { level: "warning", issueCount: issues.length, highSeverityCount: 0, message: `\u5B58\u5728 ${issues.length} \u4E2A\u5F85\u786E\u8BA4\u95EE\u9898\uFF0C\u5141\u8BB8\u4EBA\u5DE5\u590D\u6838\u540E\u51B3\u5B9A\u662F\u5426\u5E94\u7528` };
    }
    return { level: "safe", issueCount: 0, highSeverityCount: 0, message: "\u9A8C\u8BC1\u901A\u8FC7\uFF0C\u53EF\u8FDB\u5165\u5E94\u7528\u786E\u8BA4" };
  }
  function buildDraftSuggestions(draftRisk, draftValidation) {
    if (!draftRisk) return [];
    if (draftRisk.level === "blocked") {
      return ["\u5EFA\u8BAE\u5148\u91CD\u65B0\u5206\u6790\u5F53\u524D\u539F\u7406\u56FE\u7EA6\u675F\uFF0C\u518D\u91CD\u65B0\u751F\u6210\u8349\u6848\u3002", "\u5982\u679C\u662F\u5668\u4EF6\u9009\u62E9\u5BFC\u81F4\u98CE\u9669\uFF0C\u4F18\u5148\u8C03\u6574\u5E93\u5019\u9009\u6216\u4FEE\u6539\u9700\u6C42\u63CF\u8FF0\u3002"];
    }
    if (draftRisk.level === "warning") {
      return ["\u5EFA\u8BAE\u5148\u4EBA\u5DE5\u590D\u6838\u9A8C\u8BC1\u95EE\u9898\uFF0C\u518D\u51B3\u5B9A\u662F\u5426\u5E94\u7528\u8349\u6848\u3002", `\u5F53\u524D\u4ECD\u6709 ${draftValidation?.issues.length ?? 0} \u4E2A\u5F85\u786E\u8BA4\u95EE\u9898\u3002`];
    }
    return ["\u8349\u6848\u9A8C\u8BC1\u901A\u8FC7\uFF0C\u53EF\u4EE5\u8FDB\u5165\u4EBA\u5DE5\u786E\u8BA4\u5E76\u51B3\u5B9A\u662F\u5426\u5E94\u7528\u3002"];
  }
  function buildDraftStructuredSuggestions(draftRisk) {
    if (!draftRisk) return [];
    if (draftRisk.level === "blocked") {
      return [
        { label: "\u91CD\u65B0\u5206\u6790\u7EA6\u675F", actionType: "rerun_analysis" },
        { label: "\u91CD\u65B0\u751F\u6210\u8349\u6848", actionType: "regenerate_draft", prompt: "\u8BF7\u57FA\u4E8E\u5F53\u524D\u95EE\u9898\u91CD\u65B0\u751F\u6210\u4E00\u7248\u66F4\u4FDD\u5B88\u7684\u8349\u6848" }
      ];
    }
    if (draftRisk.level === "warning") {
      return [
        { label: "\u5E26\u4FEE\u6B63\u91CD\u751F\u6210", actionType: "regenerate_draft", prompt: "\u8BF7\u7ED3\u5408\u5F53\u524D\u9A8C\u8BC1\u95EE\u9898\u91CD\u65B0\u751F\u6210\u5E76\u89C4\u907F\u8FD9\u4E9B\u98CE\u9669" },
        { label: "\u7EE7\u7EED\u8BC4\u5BA1", actionType: "ask_followup", prompt: "\u8BF7\u89E3\u91CA\u5F53\u524D\u8349\u6848\u91CC\u7684\u98CE\u9669\u70B9\uFF0C\u5E76\u7ED9\u51FA\u4FEE\u6539\u5EFA\u8BAE" }
      ];
    }
    return [{ label: "\u7EE7\u7EED\u4F18\u5316\u8349\u6848", actionType: "ask_followup", prompt: "\u8BF7\u7EE7\u7EED\u4F18\u5316\u5F53\u524D\u8349\u6848\u7684\u5668\u4EF6\u9009\u62E9\u548C\u8FDE\u63A5\u7EC6\u8282" }];
  }
  function summarizeToolInput3(toolName, input) {
    if (toolName === "library.search_devices" && input && typeof input === "object") return `query=${String(input.query || "")}`;
    if (toolName === "draft.generate_plan" && input && typeof input === "object") return `selected_devices=${(input.selectedDevices || []).length}`;
    if (toolName === "draft.preview_plan" && input && typeof input === "object") return `plan_components=${(input.plan?.components || []).length}`;
    if (toolName === "rules.validate_draft" && input && typeof input === "object") return `draft_components=${(input.draft?.components || []).length}`;
    if (toolName === "llm.generate" && input && typeof input === "object") return `messages=${(input.messages || []).length}`;
    return "";
  }
  function summarizeToolOutput3(toolName, output) {
    if (toolName === "library.search_devices" && Array.isArray(output)) {
      if (output.length === 0) return "\u672A\u627E\u5230\u5339\u914D\u5668\u4EF6";
      const first = output[0];
      return [`\u627E\u5230 ${output.length} \u4E2A\u5019\u9009`, first?.name ? `\u9996\u9879 ${first.name}` : "", first?.manufacturer || "", first?.footprintName ? `\u5C01\u88C5 ${first.footprintName}` : ""].filter(Boolean).join("\uFF0C");
    }
    if (toolName === "mcp.list_resources" && output && typeof output === "object") return `\u5DF2\u52A0\u8F7D ${(output.resources || []).length} \u6761\u77E5\u8BC6\u8D44\u6E90`;
    if (toolName === "mcp.read_resource" && output && typeof output === "object") return [output.title || "", output.summary || ""].filter(Boolean).join("\uFF1A");
    if (toolName === "draft.generate_plan" && output && typeof output === "object") return `\u751F\u6210\u8349\u6848\u8BA1\u5212\uFF0C\u5668\u4EF6 ${(output.components || []).length} \u4E2A\uFF0C\u7F51\u7EDC ${(output.nets || []).length} \u6761`;
    if (toolName === "draft.preview_plan" && output && typeof output === "object") return `\u751F\u6210\u8349\u6848\u9884\u89C8\uFF0C\u5668\u4EF6 ${Number(output.componentCount || 0)} \u4E2A\uFF0C\u7F51\u7EDC ${Number(output.netCount || 0)} \u6761`;
    if (toolName === "rules.validate_draft" && output && typeof output === "object") return output.summary || `\u53D1\u73B0 ${(output.issues || []).length} \u4E2A\u95EE\u9898`;
    if (toolName === "editor.preview_apply_plan") return "\u5DF2\u6E32\u67D3\u8349\u6848\u9884\u89C8";
    if (toolName === "llm.generate" && output && typeof output === "object") return output.output_text ? `\u5DF2\u751F\u6210 ${output.output_text?.length || 0} \u5B57\u8349\u6848\u63D0\u793A` : "\u5DF2\u751F\u6210\u8349\u6848\u63D0\u793A";
    return "";
  }
  function mapToolNameToLabel3(toolName) {
    const map = {
      "editor.get_current_context": "jlceda_get_schematic_context",
      "library.search_devices": "jlceda_search_component_library",
      "mcp.list_resources": "jlceda_list_knowledge_resources",
      "mcp.read_resource": "jlceda_read_knowledge_resource",
      "llm.generate": "llm_generate_draft_hint",
      "draft.generate_plan": "jlceda_generate_draft_plan",
      "draft.preview_plan": "jlceda_preview_draft",
      "rules.validate_draft": "jlceda_validate_draft",
      "editor.preview_apply_plan": "jlceda_preview_apply_plan"
    };
    return map[toolName] ?? toolName;
  }

  // src/agent/index.ts
  function createPluginAgent(deps) {
    const skillLoader = new SkillLoader();
    return {
      createToolRegistry: (adapter, options) => createAgentToolRegistry(adapter, deps, options),
      run: async (input) => {
        if (input.type === "natural_chat") {
          if (!input.panelState) {
            throw new Error("panelState is required for natural_chat");
          }
          return runNaturalChatInternal(input.userQuery, input.panelState);
        }
        if (input.type === "schematic_analysis") {
          if (!input.context || !input.adapter) {
            throw new Error("context and adapter are required for schematic_analysis");
          }
          return runAnalysisInternal(input.userQuery, input.context, input.adapter);
        }
        if (!input.context || !input.adapter) {
          throw new Error("context and adapter are required for schematic_draft");
        }
        return runDraftInternal(input.userQuery, input.context, input.adapter);
      },
      planUserTurn: async (input) => planUserTurnInternal(input.userQuery),
      handleUserTurn: async (input) => {
        const plan = await planUserTurnInternal(input.userQuery);
        const initialResult = await executeAgentTurn(
          {
            plan,
            userQuery: input.userQuery,
            panelState: input.panelState,
            context: input.context,
            adapter: input.adapter
          },
          {
            runNaturalChat: (userQuery, panelState) => runNaturalChatInternal(userQuery, panelState, input.onStreamEvent),
            runAnalysis: (userQuery, context, adapter) => runAnalysisInternal(userQuery, context, adapter, input.onStreamEvent),
            runDraft: (userQuery, context, adapter) => runDraftInternal(userQuery, context, adapter, input.onStreamEvent)
          }
        );
        const turn = await maybeReplanBlockedDraft(plan, initialResult, input);
        const finalRoute = resolveFinalRoute(turn.plan, turn.result, turn.route);
        return {
          route: finalRoute,
          intent: turn.plan.intent,
          plan: turn.plan,
          result: turn.result
        };
      },
      buildNaturalChatMessage: (result) => ({
        role: "assistant",
        title: "\u52A9\u624B",
        content: result.summary === "missing access token for natural chat" ? "\u5F53\u524D\u672A\u68C0\u6D4B\u5230\u6709\u6548\u767B\u5F55\u6001\uFF0C\u65E0\u6CD5\u8C03\u7528\u5728\u7EBF\u6A21\u578B\u3002\u8BF7\u5148\u767B\u5F55\u3002" : result.naturalReply ?? "\u6211\u6682\u65F6\u6CA1\u6709\u751F\u6210\u53EF\u5C55\u793A\u7684\u56DE\u590D\u3002",
        toolTraces: result.toolTraces,
        executionTraces: result.executionTraces,
        uiEvents: result.uiEvents,
        reactEvents: result.reactEvents,
        stepStates: result.stepStates,
        workingMemory: result.workingMemory,
        suggestions: result.structuredSuggestions,
        actions: result.summary === "missing access token for natural chat" ? [
          {
            label: "\u53BB\u767B\u5F55",
            action: "login"
          }
        ] : void 0
      }),
      buildAnalysisMessages: (input) => {
        const report = input.analysisReport;
        const libraryHint = input.libraryInsights && input.libraryInsights.length > 0 ? `

\u5173\u8054\u5668\u4EF6\u4FE1\u606F\uFF1A
${input.libraryInsights.slice(0, 2).map((item, index) => `${index + 1}. ${item.title}\uFF1A${item.summary}`).join("\n")}` : "";
        const executiveSummaryHint = report?.executiveSummary ? `

\u6574\u56FE\u7406\u89E3\uFF1A
${report.executiveSummary}` : "";
        const ercSummaryHint = report?.ercSummary && report.ercSummary.length > 0 ? `

ERC \u57FA\u7840\u68C0\u67E5\uFF1A
${report.ercSummary.map((item) => `- ${item}`).join("\n")}` : "";
        const bomOverviewHint = report?.bomOverview && report.bomOverview.length > 0 ? `

\u5143\u4EF6\u6E05\u5355\u6982\u89C8\uFF1A
${report.bomOverview.map((item) => `- ${item}`).join("\n")}` : "";
        const functionalBlocksHint = report?.functionalBlocks && report.functionalBlocks.length > 0 ? `

\u7535\u8DEF\u529F\u80FD\u5206\u6790\uFF1A
${report.functionalBlocks.map((item) => `- ${item}`).join("\n")}` : "";
        const powerDomainsHint = report?.powerDomains && report.powerDomains.length > 0 ? `

\u7535\u6E90\u57DF\u5206\u6790\uFF1A
${report.powerDomains.map((item) => `- ${item}`).join("\n")}` : "";
        const powerPathsHint = report?.powerPaths && report.powerPaths.length > 0 ? `

\u5173\u952E\u7535\u6E90\u8DEF\u5F84\uFF1A
${report.powerPaths.map((item) => `- ${item}`).join("\n")}` : "";
        const signalPathsHint = report?.signalPaths && report.signalPaths.length > 0 ? `

\u4E3B\u8981\u4FE1\u53F7\u8DEF\u5F84\uFF1A
${report.signalPaths.map((item) => `- ${item}`).join("\n")}` : "";
        const controlPathsHint = report?.controlPaths && report.controlPaths.length > 0 ? `

\u4E3B\u63A7\u4E2D\u5FC3\u94FE\u8DEF\uFF1A
${report.controlPaths.map((item) => `- ${item}`).join("\n")}` : "";
        const keyComponentsHint = report?.keyComponents && report.keyComponents.length > 0 ? `

\u5173\u952E\u5668\u4EF6\uFF1A
${report.keyComponents.map((item) => `- ${item}`).join("\n")}` : "";
        const riskHint = report?.riskGroups && (report.riskGroups.high && report.riskGroups.high.length > 0 || report.riskGroups.medium && report.riskGroups.medium.length > 0 || report.riskGroups.low && report.riskGroups.low.length > 0) ? `

\u98CE\u9669\u5206\u7EC4\uFF1A
${[
          report.riskGroups.high?.length ? `\u9AD8\u98CE\u9669\uFF1A${report.riskGroups.high.join("\uFF1B")}` : "",
          report.riskGroups.medium?.length ? `\u4E2D\u98CE\u9669\uFF1A${report.riskGroups.medium.join("\uFF1B")}` : "",
          report.riskGroups.low?.length ? `\u4F4E\u98CE\u9669\uFF1A${report.riskGroups.low.join("\uFF1B")}` : ""
        ].filter(Boolean).join("\n")}` : "";
        const issueLines = (report?.keyFindings?.length ? report.keyFindings : (input.issueItems ?? []).slice(0, 3).map((item) => `${item.title}${formatIssueLocationSuffix(item.objectType, item.objectId)}`)).map((item, index) => `${index + 1}. ${item}`).join("\n");
        const suggestionHint = (report?.nextSteps?.length ? report.nextSteps : input.nextSuggestions) && (report?.nextSteps?.length ? report.nextSteps : input.nextSuggestions).length > 0 ? `

\u4E0B\u4E00\u6B65\u5EFA\u8BAE\uFF1A
${(report?.nextSteps?.length ? report.nextSteps : input.nextSuggestions).map((item, index) => `${index + 1}. ${item}`).join("\n")}` : "";
        const actions = input.issueCount > 0 ? [
          {
            label: "\u91CD\u65B0\u5206\u6790",
            action: "rerun"
          },
          {
            label: "\u7ACB\u5373\u767B\u5F55",
            action: "login"
          }
        ] : [
          {
            label: "\u751F\u6210\u8349\u6848",
            action: "rerun"
          }
        ];
        const structuredContent = buildAnalysisStructuredContent({
          report,
          issueCount: input.issueCount,
          topIssueTitle: input.topIssueTitle,
          locateStatus: input.locateStatus,
          issueItems: input.issueItems,
          nextSuggestions: input.nextSuggestions,
          libraryInsights: input.libraryInsights
        });
        return [
          {
            role: "assistant",
            title: "\u5206\u6790\u7ED3\u679C",
            tone: input.issueCount > 0 ? "warning" : "success",
            content: input.issueCount > 0 ? `${report?.overview ?? `\u6211\u5DF2\u7ECF\u5B8C\u6210\u5F53\u524D\u539F\u7406\u56FE\u7684\u9996\u8F6E\u68C0\u67E5\uFF0C\u53D1\u73B0 ${input.issueCount} \u4E2A\u9700\u8981\u5173\u6CE8\u7684\u95EE\u9898\u3002`}${executiveSummaryHint}${ercSummaryHint}${bomOverviewHint}${functionalBlocksHint}${powerDomainsHint}${powerPathsHint}${signalPathsHint}${controlPathsHint}${keyComponentsHint}

\u4F18\u5148\u95EE\u9898\uFF1A${input.topIssueTitle ?? "\u672A\u547D\u540D\u95EE\u9898"}
\u5B9A\u4F4D\u7ED3\u679C\uFF1A${formatLocateStatus(input.locateStatus)}

${issueLines || "\u6682\u65E0\u53EF\u5B9A\u4F4D\u95EE\u9898\u3002"}${riskHint}${libraryHint}${suggestionHint}` : `${report?.overview ?? "\u5F53\u524D\u539F\u7406\u56FE\u672A\u53D1\u73B0\u660E\u663E\u89C4\u5219\u95EE\u9898\uFF0C\u53EF\u4EE5\u7EE7\u7EED\u8FDB\u884C\u8349\u6848\u751F\u6210\u6216\u66F4\u6DF1\u5165\u95EE\u7B54\u3002"}${executiveSummaryHint}${ercSummaryHint}${bomOverviewHint}${functionalBlocksHint}${powerDomainsHint}${powerPathsHint}${signalPathsHint}${controlPathsHint}${keyComponentsHint}${riskHint}${libraryHint}${suggestionHint}`,
            structuredContent,
            evidenceItems: buildEvidenceItems({
              toolTraces: input.toolTraces,
              reactEvents: input.reactEvents,
              uiEvents: input.uiEvents
            }),
            toolTraces: input.toolTraces,
            executionTraces: input.executionTraces,
            uiEvents: input.uiEvents,
            reactEvents: input.reactEvents,
            stepStates: input.stepStates,
            workingMemory: input.workingMemory,
            suggestions: input.structuredSuggestions,
            actions
          }
        ];
      },
      buildDraftMessages: (input) => {
        const preview = input.draftPreview;
        if (!preview) {
          return [
            {
              role: "assistant",
              title: "\u72B6\u6001\u66F4\u65B0",
              tone: "warning",
              content: "\u8349\u6848\u751F\u6210\u5B8C\u6210\uFF0C\u4F46\u672A\u8FD4\u56DE\u53EF\u5C55\u793A\u5185\u5BB9\u3002"
            }
          ];
        }
        const mcpHint = input.mcpResources && input.mcpResources.length > 0 ? `
MCP\u8D44\u6E90\uFF1A${input.mcpResources.map((item) => item.uri).join("\u3001")}` : "";
        const mcpReadHint = input.mcpResourceReads && input.mcpResourceReads.length > 0 ? `
MCP\u6458\u8981\uFF1A${input.mcpResourceReads.map((item) => `${item.title}(${item.summary})`).join("\uFF1B")}` : "";
        const riskHint = input.draftRisk ? `
\u9A8C\u8BC1\u7ED3\u8BBA\uFF1A${input.draftRisk.message}` : "";
        const suggestionHint = input.nextSuggestions && input.nextSuggestions.length > 0 ? `

\u4E0B\u4E00\u6B65\u5EFA\u8BAE\uFF1A
${input.nextSuggestions.map((item, index) => `${index + 1}. ${item}`).join("\n")}` : "";
        const actions = input.draftRisk?.level === "blocked" ? [
          {
            label: "\u91CD\u65B0\u5206\u6790",
            action: "rerun"
          }
        ] : [
          {
            label: "\u5E94\u7528\u8349\u6848",
            action: "apply_draft"
          },
          {
            label: "\u56DE\u6EDA\u5E94\u7528",
            action: "rollback"
          }
        ];
        const structuredContent = buildDraftStructuredContent(input);
        return [
          {
            role: "assistant",
            title: "\u8349\u6848\u8349\u56FE",
            tone: input.draftRisk?.level === "blocked" ? "warning" : "success",
            content: `\u6211\u5DF2\u7ECF\u751F\u6210\u4E00\u7248\u8349\u6848\u3002

\u6807\u9898\uFF1A${preview.title}
\u8BF4\u660E\uFF1A${preview.rationale}
\u5668\u4EF6\uFF1A${preview.componentRefs.join(
              "\u3001"
            )}
\u7F51\u7EDC\uFF1A${preview.netNames.join("\u3001")}${mcpHint}${mcpReadHint}${riskHint}${suggestionHint}

\u4E0B\u4E00\u6B65\u5E94\u8FDB\u5165\u4EBA\u5DE5\u786E\u8BA4\uFF0C\u518D\u51B3\u5B9A\u662F\u5426 apply-plan\u3002`,
            structuredContent,
            evidenceItems: buildEvidenceItems({
              toolTraces: input.toolTraces,
              reactEvents: input.reactEvents,
              uiEvents: input.uiEvents
            }),
            toolTraces: input.toolTraces,
            executionTraces: input.executionTraces,
            uiEvents: input.uiEvents,
            reactEvents: input.reactEvents,
            stepStates: input.stepStates,
            workingMemory: input.workingMemory,
            suggestions: input.structuredSuggestions,
            actions
          }
        ];
      },
      buildStatusMessages: (input) => [
        {
          role: "assistant",
          title: input.title ?? "\u72B6\u6001\u66F4\u65B0",
          tone: input.tone ?? "warning",
          content: input.content,
          evidenceItems: void 0,
          actions: input.actions
        }
      ],
      buildDraftAppliedMessages: (componentCount, netCount) => [
        {
          role: "assistant",
          title: "\u5DF2\u5E94\u7528\u8349\u6848",
          tone: "success",
          content: `\u8349\u6848\u5DF2\u6210\u529F\u5E94\u7528\u5230\u753B\u5E03\u3002
\u5668\u4EF6\u6570\uFF1A${componentCount}
\u7F51\u7EDC\u6570\uFF1A${netCount}
\u5982\u4E0D\u7B26\u5408\u9884\u671F\u53EF\u4EE5\u7ACB\u5373\u56DE\u6EDA\u3002`,
          evidenceItems: void 0,
          actions: [
            {
              label: "\u56DE\u6EDA\u5E94\u7528",
              action: "rollback"
            }
          ]
        }
      ],
      buildRollbackMessages: (message) => [
        {
          role: "assistant",
          title: "\u56DE\u6EDA\u7ED3\u679C",
          tone: "warning",
          content: message,
          evidenceItems: void 0,
          actions: [
            {
              label: "\u91CD\u65B0\u5206\u6790",
              action: "rerun"
            }
          ]
        }
      ],
      buildConfigSavedMessages: () => [
        {
          role: "assistant",
          title: "\u914D\u7F6E\u5DF2\u4FDD\u5B58",
          tone: "success",
          content: "\u81EA\u5B9A\u4E49 LLM \u914D\u7F6E\u5DF2\u66F4\u65B0\uFF0C\u540E\u7EED\u5BF9\u8BDD\u5C06\u6309\u5F53\u524D\u914D\u7F6E\u6267\u884C\u3002",
          evidenceItems: void 0
        }
      ]
    };
    function runNaturalChatInternal(input, panelState, onStreamEvent) {
      const tools = createBaseToolRegistry(deps);
      const skill = skillLoader.selectForTask("natural_chat", input);
      return runChatReactAgent(
        {
          task: {
            type: "natural_chat",
            userQuery: input
          },
          panelState,
          allowedTools: skill.allowedTools,
          invokeTool: (toolName, toolInput) => tools.invoke(toolName, toolInput),
          listToolNames: () => tools.list().map((tool) => tool.name)
        },
        { onStreamEvent }
      ).then(({ result, reactEvents }) => ({
        ...result,
        selectedSkill: skill.name,
        reactEvents
      }));
    }
    async function planUserTurnInternal(userQuery) {
      const fallbackIntent = planUserTurn(userQuery);
      try {
        const session = await deps.sessionStore.get();
        if (!session?.accessToken) {
          return fallbackIntent;
        }
        const plannerResult = await deps.llmClient.generate(session.accessToken, {
          messages: [
            { role: "system", content: buildPlannerSystemPrompt() },
            { role: "user", content: buildPlannerUserPrompt(userQuery) }
          ]
        });
        return normalizePlannerPlan(plannerResult.output_text) ?? fallbackIntent;
      } catch {
        return fallbackIntent;
      }
    }
    function runAnalysisInternal(input, context, adapter, onStreamEvent) {
      const tools = createAgentToolRegistry(adapter, deps, { includeIssueTools: true, includeLibraryTools: true });
      for (const tool of createMcpTools(deps.mcpClient)) {
        tools.register(tool);
      }
      const skill = skillLoader.selectForTask("schematic_analysis", input);
      return runAnalysisReactAgent({
        task: {
          type: "schematic_analysis",
          userQuery: input,
          context
        },
        allowedTools: skill.allowedTools,
        invokeTool: (toolName, toolInput) => tools.invoke(toolName, toolInput),
        listToolNames: () => tools.list().map((tool) => tool.name),
        onProgress: (payload) => {
          onStreamEvent?.({
            route: "analysis",
            stage: "progress",
            detail: payload.detail,
            textDelta: payload.textDelta,
            text: payload.text,
            reactEvents: payload.reactEvents,
            stepStates: payload.stepStates,
            workingMemory: payload.workingMemory
          });
        }
      }).then(({ result, reactEvents }) => ({
        ...result,
        selectedSkill: skill.name,
        reactEvents
      }));
    }
    function runDraftInternal(input, context, adapter, onStreamEvent) {
      const tools = createAgentToolRegistry(adapter, deps, { includeLibraryTools: true });
      for (const tool of createMcpTools(deps.mcpClient)) {
        tools.register(tool);
      }
      const skill = skillLoader.selectForTask("schematic_draft", input);
      return runDraftReactAgent({
        task: {
          type: "schematic_draft",
          userQuery: input,
          context
        },
        allowedTools: skill.allowedTools,
        invokeTool: (toolName, toolInput) => tools.invoke(toolName, toolInput),
        listToolNames: () => tools.list().map((tool) => tool.name),
        onProgress: (payload) => {
          onStreamEvent?.({
            route: "draft",
            stage: "progress",
            detail: payload.detail,
            textDelta: payload.textDelta,
            text: payload.text,
            reactEvents: payload.reactEvents,
            stepStates: payload.stepStates,
            workingMemory: payload.workingMemory
          });
        }
      }).then(({ result, reactEvents }) => ({
        ...result,
        selectedSkill: skill.name,
        reactEvents
      }));
    }
    async function maybeReplanBlockedDraft(plan, result, input) {
      if (plan.route !== "draft" || result.draftRisk?.level !== "blocked") {
        return { route: plan.route, plan, result };
      }
      if (!input.context || !input.adapter) {
        return { route: plan.route, plan, result };
      }
      const replannedPlan = {
        intent: "analysis",
        route: "analysis",
        requiresContext: true,
        steps: [
          { kind: "context", required: true, note: "replan uses existing schematic context" },
          { kind: "mcp", required: true, note: "replan loads engineering references for blocked draft" },
          { kind: "rules", required: true, note: "replan inspects constraints that blocked draft apply" }
        ]
      };
      const analysisResult = await runAnalysisInternal(
        "analyze current schematic constraints for blocked draft",
        input.context,
        input.adapter
      );
      return {
        route: "analysis",
        plan: replannedPlan,
        result: {
          ...analysisResult,
          executionTraces: [
            ...result.executionTraces ?? [],
            {
              phase: "reason",
              message: `replan from=draft to=analysis because ${result.draftRisk.message}`
            },
            ...analysisResult.executionTraces ?? []
          ]
        }
      };
    }
    function formatLocateStatus(locateStatus) {
      if (!locateStatus || locateStatus === "none") {
        return "\u672A\u5B9A\u4F4D";
      }
      const [objectType, ...rest] = locateStatus.split(":");
      return formatObjectReference(objectType, rest.join(":"));
    }
    function formatIssueLocationSuffix(objectType, objectId) {
      const label = formatObjectReference(objectType, objectId);
      return label ? `\uFF08${label}\uFF09` : "";
    }
    function formatObjectReference(objectType, objectId) {
      if (!objectType && !objectId) {
        return "";
      }
      const type = (objectType ?? "").trim().toLowerCase();
      const id = (objectId ?? "").trim();
      if (!id) {
        return type || "";
      }
      if (type === "pin") {
        const pinMatch = id.match(/^pin-([^-]+)-(.+)$/i);
        if (pinMatch) {
          const ref = pinMatch[1].toUpperCase();
          const pinNo = pinMatch[2].toUpperCase();
          return `${ref} \u7684 ${pinNo} \u811A`;
        }
      }
      if (type === "component") {
        const compMatch = id.match(/^component-(.+)$/i);
        if (compMatch) {
          return `\u5668\u4EF6 ${compMatch[1].toUpperCase()}`;
        }
        return `\u5668\u4EF6 ${id.toUpperCase()}`;
      }
      if (type === "net") {
        const netMatch = id.match(/^net-(.+)$/i);
        if (netMatch) {
          return `\u7F51\u7EDC ${netMatch[1]}`;
        }
        return `\u7F51\u7EDC ${id}`;
      }
      return `${type || "\u5BF9\u8C61"} ${id}`;
    }
    function buildAnalysisStructuredContent(input) {
      const blocks = [];
      const report = input.report;
      blocks.push({
        kind: "paragraph",
        text: report?.overview ?? (input.issueCount > 0 ? `\u6211\u5DF2\u7ECF\u5B8C\u6210\u5F53\u524D\u539F\u7406\u56FE\u7684\u9996\u8F6E\u68C0\u67E5\uFF0C\u53D1\u73B0 ${input.issueCount} \u4E2A\u9700\u8981\u5173\u6CE8\u7684\u95EE\u9898\u3002` : "\u5F53\u524D\u539F\u7406\u56FE\u672A\u53D1\u73B0\u660E\u663E\u89C4\u5219\u95EE\u9898\uFF0C\u53EF\u4EE5\u7EE7\u7EED\u8FDB\u884C\u8349\u6848\u751F\u6210\u6216\u66F4\u6DF1\u5165\u95EE\u7B54\u3002")
      });
      if (report?.executiveSummary) {
        blocks.push({
          kind: "section",
          title: "\u6574\u56FE\u7406\u89E3",
          text: report.executiveSummary
        });
      }
      if (input.issueCount > 0) {
        blocks.push({
          kind: "kv",
          title: "\u5FEB\u901F\u5B9A\u4F4D",
          entries: [
            { key: "\u4F18\u5148\u95EE\u9898", value: input.topIssueTitle ?? "\u672A\u547D\u540D\u95EE\u9898" },
            { key: "\u5B9A\u4F4D\u7ED3\u679C", value: formatLocateStatus(input.locateStatus) }
          ]
        });
      }
      const findings = report?.keyFindings?.length ? report.keyFindings : (input.issueItems ?? []).slice(0, 5).map((item) => `${item.title}${formatIssueLocationSuffix(item.objectType, item.objectId)}`);
      if (findings && findings.length > 0) {
        blocks.push({
          kind: "list",
          title: input.issueCount > 0 ? "\u5173\u952E\u95EE\u9898" : "\u5173\u952E\u89C2\u5BDF",
          items: findings
        });
      }
      pushStructuredList(blocks, "ERC \u57FA\u7840\u68C0\u67E5", report?.ercSummary);
      pushStructuredList(blocks, "\u5143\u4EF6\u6E05\u5355\u6982\u89C8", report?.bomOverview);
      pushStructuredList(blocks, "\u7535\u8DEF\u529F\u80FD\u5206\u6790", report?.functionalBlocks);
      pushStructuredList(blocks, "\u7535\u6E90\u57DF\u5206\u6790", report?.powerDomains);
      pushStructuredList(blocks, "\u5173\u952E\u7535\u6E90\u8DEF\u5F84", report?.powerPaths);
      pushStructuredList(blocks, "\u4E3B\u8981\u4FE1\u53F7\u8DEF\u5F84", report?.signalPaths);
      pushStructuredList(blocks, "\u4E3B\u63A7\u4E2D\u5FC3\u94FE\u8DEF", report?.controlPaths);
      pushStructuredList(blocks, "\u5173\u952E\u5668\u4EF6", report?.keyComponents);
      const riskEntries = [
        report?.riskGroups?.high?.length ? { key: "\u9AD8\u98CE\u9669", value: report.riskGroups.high.join("\uFF1B") } : null,
        report?.riskGroups?.medium?.length ? { key: "\u4E2D\u98CE\u9669", value: report.riskGroups.medium.join("\uFF1B") } : null,
        report?.riskGroups?.low?.length ? { key: "\u4F4E\u98CE\u9669", value: report.riskGroups.low.join("\uFF1B") } : null
      ].filter(Boolean);
      if (riskEntries.length > 0) {
        blocks.push({
          kind: "kv",
          title: "\u98CE\u9669\u5206\u7EC4",
          entries: riskEntries
        });
      }
      if (input.libraryInsights && input.libraryInsights.length > 0) {
        blocks.push({
          kind: "list",
          title: "\u5173\u8054\u5668\u4EF6\u4FE1\u606F",
          items: input.libraryInsights.slice(0, 3).map((item) => `${item.title}\uFF1A${item.summary}`)
        });
      }
      const nextSteps = report?.nextSteps?.length ? report.nextSteps : input.nextSuggestions;
      if (nextSteps && nextSteps.length > 0) {
        blocks.push({
          kind: "list",
          title: "\u4E0B\u4E00\u6B65\u5EFA\u8BAE",
          items: nextSteps
        });
      }
      return blocks;
    }
    function buildDraftStructuredContent(input) {
      const preview = input.draftPreview;
      if (!preview) {
        return [{ kind: "paragraph", text: "\u8349\u6848\u751F\u6210\u5B8C\u6210\uFF0C\u4F46\u672A\u8FD4\u56DE\u53EF\u5C55\u793A\u5185\u5BB9\u3002" }];
      }
      const blocks = [
        { kind: "paragraph", text: "\u6211\u5DF2\u7ECF\u751F\u6210\u4E00\u7248\u8349\u6848\u3002" },
        {
          kind: "kv",
          title: "\u8349\u6848\u6458\u8981",
          entries: [
            { key: "\u6807\u9898", value: preview.title },
            { key: "\u8BF4\u660E", value: preview.rationale },
            { key: "\u5668\u4EF6\u6570\u91CF", value: String(preview.componentCount) },
            { key: "\u7F51\u7EDC\u6570\u91CF", value: String(preview.netCount) }
          ]
        },
        {
          kind: "list",
          title: "\u6D89\u53CA\u5668\u4EF6",
          items: preview.componentRefs.length > 0 ? preview.componentRefs : ["\u672A\u8FD4\u56DE\u5668\u4EF6\u5217\u8868"]
        },
        {
          kind: "list",
          title: "\u6D89\u53CA\u7F51\u7EDC",
          items: preview.netNames.length > 0 ? preview.netNames : ["\u672A\u8FD4\u56DE\u7F51\u7EDC\u5217\u8868"]
        }
      ];
      if (input.mcpResourceReads && input.mcpResourceReads.length > 0) {
        blocks.push({
          kind: "list",
          title: "\u53C2\u8003\u77E5\u8BC6",
          items: input.mcpResourceReads.map((item) => `${item.title}\uFF1A${item.summary}`)
        });
      }
      if (input.draftRisk) {
        blocks.push({
          kind: "kv",
          title: "\u9A8C\u8BC1\u7ED3\u8BBA",
          entries: [
            { key: "\u98CE\u9669\u7B49\u7EA7", value: input.draftRisk.level },
            { key: "\u7ED3\u8BBA", value: input.draftRisk.message }
          ]
        });
      }
      if (input.nextSuggestions && input.nextSuggestions.length > 0) {
        blocks.push({
          kind: "list",
          title: "\u4E0B\u4E00\u6B65\u5EFA\u8BAE",
          items: input.nextSuggestions
        });
      }
      blocks.push({
        kind: "paragraph",
        text: "\u4E0B\u4E00\u6B65\u5E94\u8FDB\u5165\u4EBA\u5DE5\u786E\u8BA4\uFF0C\u518D\u51B3\u5B9A\u662F\u5426 apply-plan\u3002"
      });
      return blocks;
    }
    function pushStructuredList(blocks, title, items) {
      if (!items || items.length === 0) {
        return;
      }
      blocks.push({
        kind: "list",
        title,
        items
      });
    }
    function buildEvidenceItems(input) {
      const items = [];
      const seen = /* @__PURE__ */ new Set();
      for (const trace of input.toolTraces ?? []) {
        const label = humanizeEvidenceLabel(trace.toolName);
        const detail = trace.note || (trace.status === "success" ? "\u5DE5\u5177\u8C03\u7528\u6210\u529F" : "\u5DE5\u5177\u8C03\u7528\u5931\u8D25");
        const key = `tool:${label}:${detail}`;
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        items.push({ label, detail, source: "tool" });
        if (items.length >= 6) {
          return items;
        }
      }
      for (const event of input.reactEvents ?? []) {
        if (event.kind !== "observation" || event.status === "failed") {
          continue;
        }
        const label = event.label || humanizeEvidenceLabel(event.toolName);
        const detail = event.outputSummary || event.text;
        if (!detail) {
          continue;
        }
        const key = `react:${label}:${detail}`;
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        items.push({ label, detail, source: "react" });
        if (items.length >= 6) {
          return items;
        }
      }
      for (const event of input.uiEvents ?? []) {
        if (event.status !== "done" || event.kind === "task" || !event.text) {
          continue;
        }
        const source = event.source === "planner" ? "planner" : "executor";
        const key = `ui:${event.label}:${event.text}`;
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        items.push({ label: event.label, detail: event.text, source });
        if (items.length >= 6) {
          break;
        }
      }
      return items.length > 0 ? items : void 0;
    }
    function humanizeEvidenceLabel(value) {
      if (!value) {
        return "\u8BC1\u636E";
      }
      const label = value.replace(/\./g, " / ").replace(/_/g, " ").trim();
      return label || "\u8BC1\u636E";
    }
    function resolveFinalRoute(plan, result, fallbackRoute) {
      if (result.draftPreview || result.draftPlan) {
        return "draft";
      }
      if (result.analysisReport || result.checkResult) {
        return "analysis";
      }
      if (result.naturalReply) {
        return "chat";
      }
      if (plan.followup?.route === "draft" && (result.draftRisk || result.draftValidation)) {
        return "draft";
      }
      return fallbackRoute;
    }
  }
  function createAgentToolRegistry(adapter, deps, options) {
    const tools = createBaseToolRegistry(deps);
    for (const tool of createEditorTools(adapter)) {
      tools.register(tool);
    }
    for (const tool of createSchematicSummaryTools()) {
      tools.register(tool);
    }
    if (options?.includeLibraryTools) {
      for (const tool of createLibraryTools(deps.hostBridge)) {
        tools.register(tool);
      }
    }
    for (const tool of createDraftTools()) {
      tools.register(tool);
    }
    for (const tool of createRuleTools()) {
      tools.register(tool);
    }
    if (options?.includeIssueTools) {
      for (const tool of createIssueTools(tools)) {
        tools.register(tool);
      }
    }
    return tools;
  }
  function createBaseToolRegistry(deps) {
    const tools = new ToolRegistry();
    for (const tool of createServerTools(deps.ragClient, deps.llmClient, deps.sessionStore)) {
      tools.register(tool);
    }
    for (const tool of createLibraryTools(deps.hostBridge)) {
      tools.register(tool);
    }
    return tools;
  }

  // src/agent/mcp/mcpClient.ts
  var MCPClient = class {
    resources = [
      {
        uri: "mcp://knowledge/electronics_principles",
        description: "Electronics principles knowledge snippets"
      },
      {
        uri: "mcp://knowledge/component_knowledge",
        description: "Component usage and pin behavior snippets"
      }
    ];
    resourceDocuments = {
      "mcp://knowledge/electronics_principles": {
        uri: "mcp://knowledge/electronics_principles",
        title: "Electronics Principles",
        summary: "Power-path, decoupling, grounding, and signal integrity quick notes for schematic planning.",
        content: "Power paths should keep source, regulation, and load relationships explicit. Decoupling capacitors should be placed close to the consuming device. Ground return paths should remain short and unambiguous. Input and output capacitors around regulators should match the datasheet topology and ESR constraints."
      },
      "mcp://knowledge/component_knowledge": {
        uri: "mcp://knowledge/component_knowledge",
        title: "Component Knowledge",
        summary: "Common component usage guidance, pin-role reminders, and library selection notes.",
        content: "When selecting parts from a library, confirm footprint, symbol, and pin naming consistency before placement. LDOs usually require VIN, VOUT, and GND pin validation. Capacitors should be checked for polarity, package, capacitance, and voltage rating. Prefer components whose metadata clearly identifies manufacturer and package."
      }
    };
    listResources() {
      return this.resources;
    }
    readResource(uri) {
      const document = this.resourceDocuments[uri];
      if (!document) {
        throw new Error(`mcp resource not found: ${uri}`);
      }
      return document;
    }
    toTools() {
      return [
        {
          name: "mcp.list_resources",
          description: "List MCP resources available to the plugin agent",
          riskLevel: "low",
          execute: async () => ({
            resources: this.listResources()
          })
        },
        {
          name: "mcp.read_resource",
          description: "Read a specific MCP resource document by URI",
          riskLevel: "low",
          execute: async (input) => this.readResource(input.uri)
        }
      ];
    }
    registerTools(registry, tools) {
      for (const tool of this.toTools()) {
        registry.register(tool);
      }
      for (const tool of tools) {
        const wrapped = {
          name: `mcp.${tool.name}`,
          description: tool.description,
          riskLevel: "low",
          execute: async (input) => tool.execute(input)
        };
        registry.register(wrapped);
      }
    }
  };

  // src/editor/host/runtime.ts
  function resolveHostEditorBridge() {
    const runtime = globalThis;
    return runtime.LCEDA_HOST_BRIDGE;
  }
  function resolveRuntimeChannel(fallback = "standard") {
    const runtime = globalThis;
    const hostChannel = runtime.LCEDA_HOST_BRIDGE?.getChannel?.();
    if (hostChannel === "professional" || hostChannel === "standard") {
      return hostChannel;
    }
    if (runtime.LCEDA_PLUGIN_CHANNEL === "professional") {
      return "professional";
    }
    return fallback;
  }

  // src/editor/adapters/editorAdapter.ts
  var HostBackedEditorAdapter = class {
    constructor(channel, bridge) {
      this.channel = channel;
      this.bridge = bridge;
    }
    source = "host";
    async assertCapability(capability) {
      if (!this.bridge.getCapabilityReport) {
        return;
      }
      const report = await this.bridge.getCapabilityReport();
      if (!report) {
        return;
      }
      const missing = /* @__PURE__ */ new Set([...report.missing, ...report.optionalMissing]);
      if (missing.has(capability)) {
        throw new Error(`host missing capability: ${capability}`);
      }
    }
    async isAvailable() {
      if (!this.bridge.isAvailable) {
        return true;
      }
      return Boolean(await this.bridge.isAvailable());
    }
    async getCurrentContext() {
      return this.bridge.getCurrentContext();
    }
    async getCapabilityReport() {
      if (!this.bridge.getCapabilityReport) {
        return null;
      }
      return this.bridge.getCapabilityReport();
    }
    async getSelection() {
      return this.bridge.getSelection();
    }
    async locate(target) {
      await this.bridge.locate(target);
    }
    async previewApplyPlan(plan) {
      if (!this.bridge.previewApplyPlan) {
        await this.assertCapability("previewApplyPlan");
        throw new Error("host preview_apply_plan is not available");
      }
      return this.bridge.previewApplyPlan(plan);
    }
    async applyPlan(plan) {
      if (!this.bridge.applyPlan) {
        await this.assertCapability("applyPlan");
        throw new Error("host apply_plan is not available");
      }
      return this.bridge.applyPlan(plan);
    }
    async rollbackApplyPlan(transactionId) {
      if (!this.bridge.rollbackApplyPlan) {
        await this.assertCapability("rollbackApplyPlan");
        throw new Error("host rollback_apply_plan is not available");
      }
      return this.bridge.rollbackApplyPlan(transactionId);
    }
  };
  var UnimplementedEditorAdapter = class {
    constructor(channel) {
      this.channel = channel;
    }
    source = "unimplemented";
    async isAvailable() {
      return false;
    }
    async getCurrentContext() {
      throw new Error(`editor adapter not implemented for ${this.channel}`);
    }
    async getCapabilityReport() {
      return {
        channel: this.channel,
        available: false,
        missing: ["getCurrentContext", "getSelection", "locate"],
        optionalMissing: ["previewApplyPlan", "applyPlan", "rollbackApplyPlan", "openExternal"]
      };
    }
    async getSelection() {
      throw new Error(`editor selection not implemented for ${this.channel}`);
    }
    async locate(_target) {
      throw new Error(`editor locate not implemented for ${this.channel}`);
    }
    async previewApplyPlan(_plan) {
      return {
        title: _plan.title,
        rationale: _plan.rationale,
        componentRefs: _plan.components.map((component) => component.ref ?? component.id),
        netNames: _plan.nets.map((net) => net.name ?? net.id),
        componentCount: _plan.components.length,
        netCount: _plan.nets.length
      };
    }
    async applyPlan(_plan) {
      return {
        applied: true,
        componentCount: _plan.components.length,
        netCount: _plan.nets.length,
        rollbackSupported: false
      };
    }
    async rollbackApplyPlan(transactionId) {
      return { rolledBack: false, transactionId };
    }
  };

  // src/editor/adapters/professionalEditorAdapter.ts
  var ProfessionalEditorAdapter = class {
    channel = "professional";
    source = "mock";
    async isAvailable() {
      return true;
    }
    async getCapabilityReport() {
      return {
        channel: "professional",
        available: true,
        missing: [],
        optionalMissing: ["previewApplyPlan", "applyPlan", "rollbackApplyPlan", "openExternal"]
      };
    }
    async getCurrentContext() {
      return mockProfessionalContext;
    }
    async getSelection() {
      return mockProfessionalContext.selection;
    }
    async locate(target) {
      const knownObjectIds = /* @__PURE__ */ new Set([
        ...mockProfessionalContext.components.map((item) => item.id),
        ...mockProfessionalContext.pins.map((item) => item.id),
        ...mockProfessionalContext.nets.map((item) => item.id)
      ]);
      if (!knownObjectIds.has(target.objectId)) {
        throw new Error(`professional adapter could not locate ${target.objectId}`);
      }
    }
    async previewApplyPlan(plan) {
      return {
        title: plan.title,
        rationale: plan.rationale,
        componentRefs: plan.components.map((component) => component.ref ?? component.id),
        netNames: plan.nets.map((net) => net.name ?? net.id),
        componentCount: plan.components.length,
        netCount: plan.nets.length
      };
    }
    async applyPlan(plan) {
      return {
        applied: true,
        componentCount: plan.components.length,
        netCount: plan.nets.length,
        rollbackSupported: false
      };
    }
    async rollbackApplyPlan(transactionId) {
      return { rolledBack: false, transactionId };
    }
  };

  // src/editor/adapters/standardEditorAdapter.ts
  var StandardEditorAdapter = class {
    channel = "standard";
    source = "mock";
    async isAvailable() {
      return true;
    }
    async getCapabilityReport() {
      return {
        channel: "standard",
        available: true,
        missing: [],
        optionalMissing: ["previewApplyPlan", "applyPlan", "rollbackApplyPlan", "openExternal"]
      };
    }
    async getCurrentContext() {
      return mockStandardContext;
    }
    async getSelection() {
      return mockStandardContext.selection;
    }
    async locate(target) {
      const knownObjectIds = /* @__PURE__ */ new Set([
        ...mockStandardContext.components.map((item) => item.id),
        ...mockStandardContext.pins.map((item) => item.id),
        ...mockStandardContext.nets.map((item) => item.id)
      ]);
      if (!knownObjectIds.has(target.objectId)) {
        throw new Error(`standard adapter could not locate ${target.objectId}`);
      }
    }
    async previewApplyPlan(plan) {
      return {
        title: plan.title,
        rationale: plan.rationale,
        componentRefs: plan.components.map((component) => component.ref ?? component.id),
        netNames: plan.nets.map((net) => net.name ?? net.id),
        componentCount: plan.components.length,
        netCount: plan.nets.length
      };
    }
    async applyPlan(plan) {
      return {
        applied: true,
        componentCount: plan.components.length,
        netCount: plan.nets.length,
        rollbackSupported: false
      };
    }
    async rollbackApplyPlan(transactionId) {
      return { rolledBack: false, transactionId };
    }
  };

  // src/editor/adapters/createEditorAdapter.ts
  function createEditorAdapter(channel) {
    const runtime = globalThis;
    const hostBridge = resolveHostEditorBridge();
    if (hostBridge) {
      return new HostBackedEditorAdapter(channel, hostBridge);
    }
    if (runtime.LCEDA_REQUIRE_HOST_BRIDGE) {
      return new UnimplementedEditorAdapter(channel);
    }
    if (channel === "professional") {
      return new ProfessionalEditorAdapter();
    }
    return new StandardEditorAdapter();
  }

  // src/editor/host/capabilityGuard.ts
  var REQUIRED_CONTEXT_CAPABILITIES = ["getCurrentContext", "getSelection", "locate"];
  function getMissingRequiredCapabilities(report, required) {
    if (!report) {
      return [];
    }
    return required.filter((capability) => report.missing.includes(capability));
  }
  function formatMissingCapabilityError(missing) {
    return `host missing required capabilities: ${missing.join(",")}`;
  }

  // src/editor/context/buildSchematicContext.ts
  async function buildSchematicContext(adapter) {
    const report = await adapter.getCapabilityReport();
    const missing = getMissingRequiredCapabilities(report, REQUIRED_CONTEXT_CAPABILITIES);
    if (missing.length > 0) {
      throw new Error(formatMissingCapabilityError(missing));
    }
    const available = await adapter.isAvailable();
    if (!available) {
      throw new Error("host editor is not available");
    }
    return adapter.getCurrentContext();
  }

  // src/services/api-client/httpClient.ts
  var HttpError = class extends Error {
    constructor(message, status, responseBody) {
      super(message);
      this.status = status;
      this.responseBody = responseBody;
      this.name = "HttpError";
    }
  };
  var FetchHttpClient = class {
    constructor(baseUrl, clientOptions = {}) {
      this.baseUrl = baseUrl;
      this.clientOptions = clientOptions;
    }
    async request(path, options = {}) {
      const response = await fetch(`${this.baseUrl}${path}`, {
        method: options.method ?? "GET",
        headers: options.headers,
        body: options.body
      });
      const responseText = await response.text();
      const responseBody = responseText ? safeJsonParse(responseText) : void 0;
      if (!response.ok) {
        const error = new HttpError(
          buildHttpErrorMessage(response.status, responseBody),
          response.status,
          responseBody
        );
        if (response.status === 401) {
          await this.clientOptions.onUnauthorized?.(error);
        }
        throw error;
      }
      return responseBody;
    }
    async openEventStream(path, options) {
      const response = await fetch(`${this.baseUrl}${path}`, {
        method: options.method ?? "GET",
        headers: options.headers,
        body: options.body
      });
      if (!response.ok) {
        const responseText = await response.text();
        const responseBody = responseText ? safeJsonParse(responseText) : void 0;
        const error = new HttpError(
          buildHttpErrorMessage(response.status, responseBody),
          response.status,
          responseBody
        );
        if (response.status === 401) {
          await this.clientOptions.onUnauthorized?.(error);
        }
        throw error;
      }
      if (!response.body) {
        throw new Error("stream response body is empty");
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) {
          break;
        }
        buffer += decoder.decode(chunk.value, { stream: true });
        let boundary = buffer.indexOf("\n\n");
        while (boundary >= 0) {
          const rawEvent = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          const parsed = parseEventStreamChunk(rawEvent);
          if (parsed) {
            options.onEvent(parsed);
          }
          boundary = buffer.indexOf("\n\n");
        }
      }
    }
  };
  function safeJsonParse(input) {
    try {
      return JSON.parse(input);
    } catch {
      return input;
    }
  }
  function buildHttpErrorMessage(status, responseBody) {
    if (responseBody && typeof responseBody === "object") {
      const payload = responseBody;
      return payload.error?.detail ?? payload.message ?? `request failed: ${status}`;
    }
    return `request failed: ${status}`;
  }
  function parseEventStreamChunk(input) {
    const lines = input.split(/\r?\n/);
    let event = "message";
    const dataLines = [];
    for (const line of lines) {
      if (line.startsWith("event:")) {
        event = line.slice("event:".length).trim();
        continue;
      }
      if (line.startsWith("data:")) {
        dataLines.push(line.slice("data:".length).trim());
      }
    }
    if (dataLines.length === 0) {
      return null;
    }
    const raw = dataLines.join("\n");
    return {
      event,
      data: safeJsonParse(raw)
    };
  }

  // src/services/auth/authClient.ts
  var AuthClient = class {
    constructor(httpClient) {
      this.httpClient = httpClient;
    }
    async createLoginSession(channel) {
      const response = await this.httpClient.request(
        "/api/v1/auth/login-sessions",
        {
          method: "POST",
          headers: {
            "content-type": "application/json"
          },
          body: JSON.stringify({
            client_type: "lceda_plugin",
            plugin_channel: channel,
            plugin_version: "0.1.0",
            platform: "darwin",
            login_methods: ["email", "wechat"]
          })
        }
      );
      return unwrap(response);
    }
    async getLoginSession(loginSessionId, pollToken, waitSeconds = 0) {
      const safeWait = Number.isFinite(waitSeconds) ? Math.max(0, Math.min(20, Math.floor(waitSeconds))) : 0;
      const response = await this.httpClient.request(
        `/api/v1/auth/login-sessions/${loginSessionId}?poll_token=${pollToken}&wait_seconds=${safeWait}`
      );
      return unwrap(response);
    }
    async sendEmailCode(loginSessionId, email) {
      const response = await this.httpClient.request(
        "/api/v1/auth/email/send-code",
        {
          method: "POST",
          headers: {
            "content-type": "application/json"
          },
          body: JSON.stringify({
            login_session_id: loginSessionId,
            email,
            scene: "login"
          })
        }
      );
      return unwrap(response);
    }
    async verifyEmailCode(loginSessionId, email, code) {
      const response = await this.httpClient.request(
        "/api/v1/auth/email/verify-code",
        {
          method: "POST",
          headers: {
            "content-type": "application/json"
          },
          body: JSON.stringify({
            login_session_id: loginSessionId,
            email,
            code
          })
        }
      );
      return unwrap(response);
    }
    async getWechatLoginUrl(loginSessionId) {
      const response = await this.httpClient.request(
        "/api/v1/auth/wechat/login-url",
        {
          method: "POST",
          headers: {
            "content-type": "application/json"
          },
          body: JSON.stringify({
            login_session_id: loginSessionId
          })
        }
      );
      return unwrap(response);
    }
    async bindWechat(accessToken, bindTicket) {
      const response = await this.httpClient.request(
        "/api/v1/auth/wechat/bind",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "content-type": "application/json"
          },
          body: JSON.stringify({
            bind_ticket: bindTicket
          })
        }
      );
      return unwrap(response);
    }
    async completeWechatCallback(state, code) {
      await this.httpClient.request(
        `/api/v1/auth/wechat/callback?state=${encodeURIComponent(state)}&code=${encodeURIComponent(code)}`
      );
    }
    async exchangeToken(loginSessionId, exchangeToken) {
      const response = await this.httpClient.request(
        "/api/v1/auth/tokens:action?action=tokens%3Aexchange",
        {
          method: "POST",
          headers: {
            "content-type": "application/json"
          },
          body: JSON.stringify({
            login_session_id: loginSessionId,
            exchange_token: exchangeToken
          })
        }
      );
      return unwrap(response);
    }
    async refreshToken(refreshToken) {
      const response = await this.httpClient.request(
        "/api/v1/auth/tokens:action?action=tokens%3Arefresh",
        {
          method: "POST",
          headers: {
            "content-type": "application/json"
          },
          body: JSON.stringify({
            refresh_token: refreshToken
          })
        }
      );
      return unwrap(response);
    }
    async getCurrentUser(accessToken) {
      const response = await this.httpClient.request("/api/v1/users/me", {
        headers: {
          Authorization: `Bearer ${accessToken}`
        }
      });
      return unwrap(response);
    }
    async logout(accessToken, allDevices = false) {
      const response = await this.httpClient.request("/api/v1/auth/logout", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "content-type": "application/json"
        },
        body: JSON.stringify({
          all_devices: allDevices
        })
      });
      return unwrap(response);
    }
  };
  function unwrap(response) {
    if (response.code !== 0) {
      throw new Error(response.error?.detail ?? response.message);
    }
    return response.data;
  }

  // src/services/auth/browserLauncher.ts
  var HostBrowserLauncher = class {
    async open(url) {
      const hostBridge = resolveHostEditorBridge();
      if (!hostBridge?.openExternal) {
        throw new Error("host browser launcher is not available");
      }
      await hostBridge.openExternal(url);
    }
  };

  // src/services/auth/sessionStore.ts
  var PersistentSessionStore = class {
    constructor(storage, storageKey = "lceda_ai.auth.session") {
      this.storage = storage;
      this.storageKey = storageKey;
    }
    async set(session) {
      await this.storage.setItem(this.storageKey, JSON.stringify(session));
    }
    async get() {
      const raw = await this.storage.getItem(this.storageKey);
      if (!raw) {
        return void 0;
      }
      const parsed = JSON.parse(raw);
      if (typeof parsed.accessToken !== "string" || parsed.accessToken.trim() === "" || typeof parsed.refreshToken !== "string" || parsed.refreshToken.trim() === "" || typeof parsed.expiresAt !== "string" || parsed.expiresAt.trim() === "") {
        return void 0;
      }
      return {
        accessToken: parsed.accessToken,
        refreshToken: parsed.refreshToken,
        expiresAt: parsed.expiresAt,
        user: parsed.user
      };
    }
    async clear() {
      await this.storage.removeItem(this.storageKey);
    }
  };

  // src/services/credits/creditsClient.ts
  var CreditsClient = class {
    constructor(httpClient) {
      this.httpClient = httpClient;
    }
    async getBalance(accessToken) {
      const response = await this.httpClient.request(
        "/api/v1/credits/balance",
        {
          headers: {
            Authorization: `Bearer ${accessToken}`
          }
        }
      );
      if (response.code !== 0) {
        throw new Error(response.error?.detail ?? response.message);
      }
      return response.data;
    }
    async listTransactions(accessToken, limit = 20) {
      const response = await this.httpClient.request(
        `/api/v1/credits/transactions?limit=${limit}`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`
          }
        }
      );
      if (response.code !== 0) {
        throw new Error(response.error?.detail ?? response.message);
      }
      return response.data;
    }
  };

  // src/services/llm/customLlmConfigStore.ts
  var CustomLlmConfigStore = class {
    constructor(storage, storageKey = "lceda_ai.llm.custom_config") {
      this.storage = storage;
      this.storageKey = storageKey;
    }
    async get() {
      const raw = await this.storage.getItem(this.storageKey);
      if (!raw) {
        return void 0;
      }
      const parsed = JSON.parse(raw);
      if (typeof parsed.provider !== "string" || typeof parsed.baseUrl !== "string" || typeof parsed.apiKey !== "string" || typeof parsed.model !== "string") {
        return void 0;
      }
      return {
        provider: parsed.provider,
        baseUrl: parsed.baseUrl,
        apiKey: parsed.apiKey,
        model: parsed.model
      };
    }
    async set(config2) {
      await this.storage.setItem(this.storageKey, JSON.stringify(config2));
    }
    async clear() {
      await this.storage.removeItem(this.storageKey);
    }
  };

  // src/services/llm/llmProxyClient.ts
  var LlmProxyClient = class {
    constructor(httpClient) {
      this.httpClient = httpClient;
    }
    async generate(accessToken, input) {
      const response = await this.httpClient.request(
        "/api/v1/llm/generate",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "content-type": "application/json"
          },
          body: JSON.stringify({
            scene: "schematic_analysis",
            billing_mode: "credits",
            provider: input.provider,
            model: input.model,
            messages: input.messages
          })
        }
      );
      if (response.code !== 0) {
        throw new Error(response.error?.detail ?? response.message);
      }
      return response.data;
    }
    async generateStream(accessToken, input, onEvent) {
      await this.httpClient.openEventStream("/api/v1/llm/generate/stream", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "content-type": "application/json",
          Accept: "text/event-stream"
        },
        body: JSON.stringify({
          scene: "schematic_analysis",
          billing_mode: "credits",
          provider: input.provider,
          model: input.model,
          messages: input.messages
        }),
        onEvent: (event) => {
          onEvent(event.data);
        }
      });
    }
    async listLogs(accessToken, limit = 20) {
      const response = await this.httpClient.request(
        `/api/v1/llm/logs?limit=${limit}`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`
          }
        }
      );
      if (response.code !== 0) {
        throw new Error(response.error?.detail ?? response.message);
      }
      return response.data;
    }
    async listProviders(accessToken) {
      const response = await this.httpClient.request(
        "/api/v1/llm/providers",
        {
          headers: {
            Authorization: `Bearer ${accessToken}`
          }
        }
      );
      if (response.code !== 0) {
        throw new Error(response.error?.detail ?? response.message);
      }
      return response.data;
    }
  };

  // src/services/rag/ragClient.ts
  var RagClient = class {
    constructor(httpClient) {
      this.httpClient = httpClient;
    }
    async search(query, topK = 3) {
      const response = await this.httpClient.request(
        "/api/v1/rag/search",
        {
          method: "POST",
          headers: {
            "content-type": "application/json"
          },
          body: JSON.stringify({
            query,
            top_k: topK
          })
        }
      );
      if (response.code !== 0) {
        throw new Error(response.error?.detail ?? response.message);
      }
      return response.data;
    }
    async buildCitations(query, topK = 3) {
      const response = await this.httpClient.request(
        "/api/v1/rag/citations:build",
        {
          method: "POST",
          headers: {
            "content-type": "application/json"
          },
          body: JSON.stringify({
            query,
            top_k: topK
          })
        }
      );
      if (response.code !== 0) {
        throw new Error(response.error?.detail ?? response.message);
      }
      return response.data;
    }
  };

  // src/storage/keyValueStore.ts
  var LocalStorageKeyValueStore = class {
    async getItem(key) {
      const storage = resolveLocalStorage();
      if (!storage) {
        return void 0;
      }
      const value = storage.getItem(key);
      return value === null ? void 0 : value;
    }
    async setItem(key, value) {
      const storage = resolveLocalStorage();
      if (!storage) {
        throw new Error("localStorage is not available");
      }
      storage.setItem(key, value);
    }
    async removeItem(key) {
      const storage = resolveLocalStorage();
      if (!storage) {
        return;
      }
      storage.removeItem(key);
    }
  };
  function resolveLocalStorage() {
    if (typeof globalThis === "undefined") {
      return void 0;
    }
    const candidate = globalThis;
    return candidate.localStorage;
  }

  // src/app/assistantRuntime.ts
  var GLOBAL_KEY = "__LCEDA_AI_ASSISTANT_RUNTIME__";
  var FRAME_STATE_EVENT = "lceda-ai-assistant:state";
  var PANEL_STATE_STORAGE_KEY = "lceda_ai.panel.last_state";
  var LOG_PREFIX = "[LCEDA-AI][runtime]";
  function getAssistantRuntime() {
    const runtime = globalThis;
    if (!runtime[GLOBAL_KEY]) {
      runtime[GLOBAL_KEY] = createAssistantRuntime();
    }
    return runtime[GLOBAL_KEY];
  }
  function createAssistantRuntime() {
    const internals = {
      currentState: null,
      stateVersion: 0,
      issueItems: []
    };
    const storage = new LocalStorageKeyValueStore();
    const sessionStore = new PersistentSessionStore(storage);
    const customLlmConfigStore = new CustomLlmConfigStore(storage);
    const config2 = getConfig();
    let refreshInFlight = null;
    const authHttpClient = new FetchHttpClient(config2.serverBaseUrl);
    const httpClient = new FetchHttpClient(config2.serverBaseUrl, {
      onUnauthorized: async (error) => {
        await handleUnauthorizedSession(error);
      }
    });
    const authClient = new AuthClient(authHttpClient);
    const creditsClient = new CreditsClient(httpClient);
    const llmClient = new LlmProxyClient(httpClient);
    const ragClient = new RagClient(httpClient);
    const mcpClient = new MCPClient();
    const pluginAgent = createPluginAgent({
      llmClient,
      ragClient,
      sessionStore,
      customLlmConfigStore,
      hostBridge: resolveHostEditorBridge(),
      mcpClient
    });
    async function buildBaseState() {
      const channel = resolveRuntimeChannel();
      const adapter = createEditorAdapter(channel);
      const capabilityReport = await adapter.getCapabilityReport();
      const state = {
        loggedIn: false,
        capabilityReport: capabilityReport ?? void 0
      };
      const existingSession = await sessionStore.get();
      if (existingSession && !hasUsableSession(existingSession) && existingSession.refreshToken) {
        await refreshSessionIfNeeded("startup_restore");
      }
      await fillSettingsState(state, sessionStore, creditsClient, customLlmConfigStore);
      return state;
    }
    async function openIdlePanelState() {
      const restored = await restorePanelState(storage);
      if (restored) {
        await fillSettingsState(restored, sessionStore, creditsClient, customLlmConfigStore);
        if (restored.agentRunState === "planning" || restored.agentRunState === "running_tools" || restored.agentRunState === "waiting_llm") {
          restored.agentRunState = "idle";
          restored.agentRunDetail = "\u5DF2\u6062\u590D\u4E0A\u6B21\u4F1A\u8BDD";
          restored.summary = restored.summary || "\u5DF2\u6062\u590D\u4E0A\u6B21\u4F1A\u8BDD\u3002";
        }
        restored.nextActions = buildNextActions(restored);
        return commitState(internals, restored, storage);
      }
      const state = await buildBaseState();
      state.sessionTitle = "New Session";
      state.agentRunState = "idle";
      state.agentRunDetail = "\u7B49\u5F85\u7528\u6237\u8F93\u5165";
      state.summary = "\u52A9\u624B\u5DF2\u5C31\u7EEA\u3002\u53EF\u4EE5\u5148\u81EA\u7136\u804A\u5929\uFF0C\u4E5F\u53EF\u4EE5\u8BA9\u6211\u68C0\u67E5\u5F53\u524D\u539F\u7406\u56FE\u6216\u751F\u6210\u8349\u6848\u3002";
      state.chatMessages = [];
      state.nextActions = buildNextActions(state);
      return commitState(internals, state, storage);
    }
    async function refreshSessionIfNeeded(reason) {
      if (refreshInFlight) {
        return refreshInFlight;
      }
      refreshInFlight = (async () => {
        const session = await sessionStore.get();
        if (!session?.refreshToken) {
          if (typeof console !== "undefined") {
            console.warn(`${LOG_PREFIX} session.refresh.skipped`, { reason, hasSession: Boolean(session) });
          }
          return false;
        }
        try {
          if (typeof console !== "undefined") {
            console.log(`${LOG_PREFIX} session.refresh.start`, { reason, ...summarizeSessionForLog(session) });
          }
          const tokenData = await authClient.refreshToken(session.refreshToken);
          const nextSession = toSession(tokenData);
          await sessionStore.set(nextSession);
          if (typeof console !== "undefined") {
            console.log(`${LOG_PREFIX} session.refresh.success`, summarizeSessionForLog(nextSession));
          }
          return true;
        } catch (error) {
          if (typeof console !== "undefined") {
            console.warn(`${LOG_PREFIX} session.refresh.failed`, {
              reason,
              error: error instanceof Error ? error.message : String(error)
            });
          }
          try {
            await sessionStore.clear();
          } catch {
          }
          return false;
        } finally {
          refreshInFlight = null;
        }
      })();
      return refreshInFlight;
    }
    async function computeAnalysisState() {
      const channel = resolveRuntimeChannel();
      const adapter = createEditorAdapter(channel);
      const state = await buildBaseState();
      try {
        const context = await buildSchematicContext(adapter);
        const result = await pluginAgent.run({
          type: "schematic_analysis",
          userQuery: "collect current schematic context",
          context,
          adapter
        });
        if (typeof console !== "undefined") {
          console.log(`${LOG_PREFIX} analysis.react.trace`, result.executionTraces ?? []);
        }
        state.agentRunState = "completed";
        state.agentRunRoute = "analysis";
        state.agentRunDetail = result.summary;
        state.channel = result.contextDigest?.channel;
        state.componentCount = result.contextDigest?.componentCount;
        state.netCount = result.contextDigest?.netCount;
        state.selectionCount = result.contextDigest?.selectionCount;
        state.issueCount = result.checkResult?.issues.length;
        state.topIssueTitle = result.checkResult?.issues[0]?.title;
        state.locateStatus = result.locateResult?.located ? `${result.locateResult.objectType}:${result.locateResult.objectId}` : "none";
        state.issueItems = result.checkResult?.issues.slice(0, 6).map((issue) => ({
          title: issue.title,
          severity: issue.severity,
          objectId: issue.objectId,
          objectType: normalizeIssueObjectType(issue.objectType)
        })) ?? [];
        state.summary = buildAnalysisSummary(state, adapter.source);
        state.chatMessages = pluginAgent.buildAnalysisMessages({
          issueCount: state.issueCount ?? 0,
          topIssueTitle: state.topIssueTitle,
          locateStatus: state.locateStatus,
          analysisReport: result.analysisReport,
          libraryInsights: result.libraryInsights,
          issueItems: state.issueItems,
          mcpResources: result.mcpResources,
          mcpResourceReads: result.mcpResourceReads,
          toolTraces: result.toolTraces,
          executionTraces: result.executionTraces,
          reactEvents: result.reactEvents,
          stepStates: result.stepStates,
          workingMemory: result.workingMemory,
          nextSuggestions: result.nextSuggestions,
          structuredSuggestions: result.structuredSuggestions
        });
        internals.issueItems = state.issueItems.map((item) => ({
          objectId: item.objectId,
          objectType: normalizeIssueObjectType(item.objectType)
        })).filter((item) => Boolean(item.objectId && item.objectType));
      } catch (error) {
        const resultError = error instanceof Error ? error.message : String(error);
        state.agentRunState = "failed";
        state.agentRunRoute = "analysis";
        state.agentRunDetail = resultError;
        state.summary = `\u5206\u6790\u672A\u5B8C\u6210\uFF1A${resultError}\uFF08adapter_source=${adapter.source}\uFF09`;
        state.chatMessages = buildErrorChatMessages(state.summary);
        state.issueItems = [];
        internals.issueItems = [];
      }
      state.nextActions = buildNextActions(state);
      return commitState(internals, state, storage);
    }
    async function handleUnauthorizedSession(error) {
      const refreshed = await refreshSessionIfNeeded("http_401");
      if (refreshed) {
        if (internals.currentState) {
          await fillSettingsState(internals.currentState, sessionStore, creditsClient, customLlmConfigStore);
          internals.currentState.summary = "\u767B\u5F55\u72B6\u6001\u5DF2\u81EA\u52A8\u5237\u65B0\u3002";
          internals.currentState.nextActions = buildNextActions(internals.currentState);
          commitState(internals, internals.currentState, storage);
        }
        return;
      }
      try {
        await sessionStore.clear();
      } catch {
      }
      if (typeof console !== "undefined") {
        console.warn(`${LOG_PREFIX} session.invalidated`, {
          status: error.status,
          message: error.message
        });
      }
      if (!internals.currentState) {
        return;
      }
      internals.currentState.loggedIn = false;
      internals.currentState.loginStatus = "\u767B\u5F55\u5DF2\u5931\u6548";
      internals.currentState.userDisplayName = void 0;
      internals.currentState.userEmail = void 0;
      internals.currentState.creditsBalance = void 0;
      internals.currentState.creditsCurrency = void 0;
      internals.currentState.creditsTransactions = [];
      internals.currentState.summary = "\u767B\u5F55\u72B6\u6001\u5DF2\u5931\u6548\uFF0C\u8BF7\u91CD\u65B0\u767B\u5F55\u3002";
      if (internals.pendingChatInput) {
        internals.currentState.summary = "\u767B\u5F55\u72B6\u6001\u5DF2\u5931\u6548\uFF0C\u8BF7\u91CD\u65B0\u767B\u5F55\u3002\u767B\u5F55\u6210\u529F\u540E\u4F1A\u81EA\u52A8\u7EE7\u7EED\u521A\u624D\u7684\u5BF9\u8BDD\u3002";
      }
      internals.currentState.nextActions = buildNextActions(internals.currentState);
      commitState(internals, internals.currentState, storage);
    }
    return {
      openPanel: openIdlePanelState,
      rerunAnalysis: computeAnalysisState,
      locateIssue: async (index) => {
        const currentState = internals.currentState ?? await computeAnalysisState();
        const channel = resolveRuntimeChannel();
        const adapter = createEditorAdapter(channel);
        const issue = internals.issueItems[index];
        if (!issue?.objectId || !issue.objectType) {
          currentState.summary = "\u5B9A\u4F4D\u5931\u8D25\uFF1A\u672A\u627E\u5230\u76EE\u6807\u95EE\u9898\u3002";
          return commitState(internals, currentState, storage);
        }
        try {
          await adapter.locate({
            objectId: issue.objectId,
            objectType: issue.objectType
          });
          currentState.locateStatus = `${issue.objectType}:${issue.objectId}`;
          currentState.summary = `\u5DF2\u5B9A\u4F4D\u5230\u5BF9\u8C61 ${issue.objectType}:${issue.objectId}\u3002`;
          currentState.chatMessages = buildLocateChatMessages(currentState, issue.objectType, issue.objectId);
        } catch (error) {
          currentState.summary = `\u5B9A\u4F4D\u5931\u8D25\uFF1A${error instanceof Error ? error.message : String(error)}`;
          currentState.chatMessages = buildErrorChatMessages(currentState.summary);
        }
        currentState.nextActions = buildNextActions(currentState);
        return commitState(internals, currentState, storage);
      },
      startLogin: async () => {
        const state = internals.currentState ?? await computeAnalysisState();
        const channel = resolveRuntimeChannel();
        const launcher = new HostBrowserLauncher();
        try {
          const loginSession = await authClient.createLoginSession(channel);
          await launcher.open(loginSession.login_url);
          if (internals.activeLoginSession) {
            internals.activeLoginSession.stopped = true;
          }
          internals.activeLoginSession = {
            loginSessionId: loginSession.login_session_id,
            pollToken: loginSession.poll_token,
            stopped: false
          };
          state.loginStatus = "\u7B49\u5F85\u6D4F\u89C8\u5668\u5B8C\u6210\u767B\u5F55";
          state.summary = "\u5DF2\u6253\u5F00\u767B\u5F55\u9875\u9762\uFF0C\u8BF7\u5728\u6D4F\u89C8\u5668\u5B8C\u6210\u90AE\u7BB1\u6216\u5FAE\u4FE1\u767B\u5F55\u3002";
          state.nextActions = buildNextActions(state);
          commitState(internals, state, storage);
          void pollLoginSessionUntilDone(
            internals,
            authClient,
            sessionStore,
            creditsClient,
            customLlmConfigStore,
            storage
          );
        } catch (error) {
          state.loginStatus = "\u767B\u5F55\u542F\u52A8\u5931\u8D25";
          state.summary = `\u767B\u5F55\u542F\u52A8\u5931\u8D25\uFF1A${error instanceof Error ? error.message : String(error)}`;
          state.chatMessages = pluginAgent.buildStatusMessages({ content: state.summary, tone: "warning" });
          state.nextActions = buildNextActions(state);
          commitState(internals, state, storage);
        }
        return internals.currentState;
      },
      resetSession: async () => {
        internals.currentState = null;
        internals.issueItems = [];
        internals.draftPlan = void 0;
        internals.draftBlocked = void 0;
        internals.lastApplyTransactionId = void 0;
        internals.pendingChatInput = void 0;
        await clearPanelState(storage);
        return openIdlePanelState();
      },
      generateDraft: async (prompt) => {
        const state = internals.currentState ?? await computeAnalysisState();
        const channel = resolveRuntimeChannel();
        const adapter = createEditorAdapter(channel);
        try {
          const context = await buildSchematicContext(adapter);
          const result = await pluginAgent.run({
            type: "schematic_draft",
            userQuery: prompt,
            context,
            adapter
          });
          if (typeof console !== "undefined") {
            console.log(`${LOG_PREFIX} draft.react.trace`, result.executionTraces ?? []);
          }
          if (result.draftPreview) {
            state.agentRunState = "awaiting_confirmation";
            state.agentRunRoute = "draft";
            state.agentRunDetail = result.summary;
            internals.draftPlan = result.draftPlan;
            internals.draftBlocked = result.draftRisk?.level === "blocked";
            state.draftPreview = {
              title: result.draftPreview.title,
              rationale: result.draftPreview.rationale,
              componentRefs: result.draftPreview.componentRefs,
              netNames: result.draftPreview.netNames,
              componentCount: result.draftPreview.componentCount,
              netCount: result.draftPreview.netCount
            };
            state.summary = `\u8349\u6848\u5DF2\u751F\u6210\uFF1A${result.draftPreview.title}\uFF0C\u5171 ${result.draftPreview.componentCount} \u4E2A\u5668\u4EF6\uFF0C${result.draftPreview.netCount} \u6761\u7F51\u7EDC\u3002`;
            state.chatMessages = pluginAgent.buildDraftMessages({
              draftPreview: state.draftPreview,
              mcpResources: result.mcpResources,
              mcpResourceReads: result.mcpResourceReads,
              toolTraces: result.toolTraces,
              executionTraces: result.executionTraces,
              uiEvents: result.uiEvents,
              reactEvents: result.reactEvents,
              stepStates: result.stepStates,
              workingMemory: result.workingMemory,
              draftRisk: result.draftRisk,
              nextSuggestions: result.nextSuggestions,
              structuredSuggestions: result.structuredSuggestions
            });
          } else {
            state.agentRunState = "completed";
            state.agentRunRoute = "draft";
            state.agentRunDetail = "\u8349\u6848\u672A\u8FD4\u56DE\u9884\u89C8";
            state.summary = "\u8349\u6848\u751F\u6210\u5B8C\u6210\uFF0C\u4F46\u672A\u8FD4\u56DE\u9884\u89C8\u4FE1\u606F\u3002";
            state.chatMessages = pluginAgent.buildStatusMessages({ content: state.summary, tone: "warning" });
          }
        } catch (error) {
          state.agentRunState = "failed";
          state.agentRunRoute = "draft";
          state.agentRunDetail = error instanceof Error ? error.message : String(error);
          state.summary = `\u8349\u6848\u751F\u6210\u5931\u8D25\uFF1A${error instanceof Error ? error.message : String(error)}`;
          state.chatMessages = pluginAgent.buildStatusMessages({ content: state.summary, tone: "warning" });
        }
        state.nextActions = buildNextActions(state);
        return commitState(internals, state, storage);
      },
      sendChat: async (input) => {
        const trimmed = input.trim();
        if (!trimmed) {
          if (typeof console !== "undefined") {
            console.warn(`${LOG_PREFIX} sendChat.empty-input`);
          }
          return internals.currentState ?? computeAnalysisState();
        }
        if (typeof console !== "undefined") {
          console.log(`${LOG_PREFIX} sendChat.start`, {
            promptLength: trimmed.length,
            hasState: Boolean(internals.currentState)
          });
        }
        const current = internals.currentState ?? await computeAnalysisState();
        const session = await sessionStore.get();
        if (!session?.accessToken) {
          await fillSettingsState(current, sessionStore, creditsClient, customLlmConfigStore);
          current.agentRunState = "failed";
          current.agentRunRoute = "chat";
          current.agentRunDetail = "\u672A\u767B\u5F55";
          current.summary = "\u8BF7\u5148\u767B\u5F55\u540E\u518D\u7EE7\u7EED\u81EA\u7136\u804A\u5929";
          current.nextActions = buildNextActions(current);
          if (typeof console !== "undefined") {
            console.warn(`${LOG_PREFIX} sendChat.not-logged-in`, {
              promptLength: trimmed.length
            });
          }
          return commitState(internals, current, storage);
        }
        if (!current.sessionTitle || current.sessionTitle === "New Session") {
          current.sessionTitle = buildSessionTitleFromPrompt(trimmed);
        }
        const historyMessages = stripInitialWelcomeMessages(sanitizeChatMessages(current.chatMessages));
        const nextMessages = historyMessages.slice();
        const userMessage = {
          role: "user",
          title: "\u4F60",
          content: trimmed
        };
        nextMessages.push(userMessage);
        current.chatMessages = nextMessages;
        current.agentRunState = "planning";
        current.agentRunDetail = "\u6B63\u5728\u89C4\u5212\u672C\u8F6E agent \u6267\u884C";
        commitState(internals, current, storage);
        internals.pendingChatInput = trimmed;
        try {
          const channel = resolveRuntimeChannel();
          const adapter = createEditorAdapter(channel);
          const plan = await pluginAgent.planUserTurn({ userQuery: trimmed });
          let context;
          if (plan.requiresContext) {
            context = await buildSchematicContext(adapter);
          } else {
            try {
              context = await buildSchematicContext(adapter);
            } catch (error) {
              if (typeof console !== "undefined") {
                console.warn(`${LOG_PREFIX} sendChat.context.optional-failed`, {
                  error: error instanceof Error ? error.message : String(error)
                });
              }
            }
          }
          current.agentRunState = plan.route === "chat" ? "waiting_llm" : "running_tools";
          current.agentRunRoute = plan.route;
          current.agentRunDetail = buildPendingAgentDetail(plan.route);
          current.summary = buildPendingAgentSummary(plan.route);
          current.chatMessages = [...nextMessages, createPendingAssistantMessage(plan.route)];
          commitState(internals, current, storage);
          const turn = await pluginAgent.handleUserTurn({
            userQuery: trimmed,
            panelState: current,
            context,
            adapter,
            onStreamEvent: (event) => {
              const messages = current.chatMessages ?? [];
              const lastMessage = messages[messages.length - 1];
              if (!lastMessage || lastMessage.role !== "assistant") {
                return;
              }
              if (event.detail) {
                current.agentRunDetail = event.detail;
              }
              if (event.stage === "llm") {
                if (event.textDelta) {
                  lastMessage.content = `${lastMessage.content || ""}${event.textDelta}`;
                  lastMessage.streaming = true;
                }
                if (event.text !== void 0) {
                  lastMessage.content = event.text || lastMessage.content || "";
                }
              } else if (event.stage === "progress") {
                lastMessage.streaming = true;
                lastMessage.title = event.route === "draft" ? "\u8349\u6848\u751F\u6210\u4E2D" : "\u5206\u6790\u4E2D";
                if (event.textDelta) {
                  lastMessage.content = `${lastMessage.content || ""}${event.textDelta}`;
                } else if (event.text !== void 0) {
                  lastMessage.content = event.text || lastMessage.content || "";
                } else if (event.detail) {
                  lastMessage.content = event.detail;
                }
                if (event.reactEvents) {
                  lastMessage.reactEvents = event.reactEvents;
                }
                if (event.stepStates) {
                  lastMessage.stepStates = event.stepStates;
                }
                if (event.workingMemory) {
                  lastMessage.workingMemory = event.workingMemory;
                }
              }
              commitState(internals, current, storage);
            }
          });
          if (typeof console !== "undefined") {
            console.log(`${LOG_PREFIX} sendChat.plan`, turn.plan);
            console.log(`${LOG_PREFIX} sendChat.intent`, { intent: turn.intent });
            console.log(`${LOG_PREFIX} sendChat.route`, { route: turn.route });
            console.log(`${LOG_PREFIX} sendChat.react.trace`, turn.result.executionTraces ?? []);
          }
          internals.pendingChatInput = void 0;
          const finalState = await applyTurnResultToState({
            baseState: current,
            userMessages: nextMessages,
            requestedRoute: plan.route,
            finalRoute: turn.route,
            plan: turn.plan,
            result: turn.result
          });
          if (typeof console !== "undefined") {
            console.log(`${LOG_PREFIX} sendChat.success`, { route: turn.route });
          }
          return commitState(internals, finalState, storage);
        } catch (error) {
          if (error instanceof HttpError && error.status === 401) {
            const unauthorizedState = internals.currentState ?? current;
            unauthorizedState.agentRunState = "failed";
            unauthorizedState.agentRunDetail = "\u767B\u5F55\u5931\u6548";
            unauthorizedState.nextActions = buildNextActions(unauthorizedState);
            return commitState(internals, unauthorizedState, storage);
          }
          if (typeof console !== "undefined") {
            console.error(`${LOG_PREFIX} sendChat.failed`, {
              error: error instanceof Error ? error.message : String(error)
            });
          }
          internals.pendingChatInput = void 0;
          current.agentRunState = "failed";
          current.agentRunDetail = error instanceof Error ? error.message : String(error);
          current.summary = `\u5BF9\u8BDD\u5904\u7406\u5931\u8D25\uFF1A${error instanceof Error ? error.message : String(error)}`;
          current.chatMessages = [
            ...nextMessages,
            ...pluginAgent.buildStatusMessages({ content: current.summary, tone: "warning" })
          ];
          return commitState(internals, current, storage);
        }
      },
      applyDraftPlan: async () => {
        const state = internals.currentState ?? await computeAnalysisState();
        const draftPlan = internals.draftPlan;
        if (!draftPlan) {
          state.agentRunState = "failed";
          state.agentRunRoute = "draft";
          state.agentRunDetail = "\u5F53\u524D\u6CA1\u6709\u53EF\u5E94\u7528\u8349\u6848";
          state.summary = "\u5F53\u524D\u6CA1\u6709\u53EF\u5E94\u7528\u7684\u8349\u6848\uFF0C\u8BF7\u5148\u751F\u6210\u8349\u6848\u3002";
          state.chatMessages = pluginAgent.buildStatusMessages({ content: state.summary, tone: "warning" });
          return commitState(internals, state, storage);
        }
        if (internals.draftBlocked) {
          state.agentRunState = "awaiting_confirmation";
          state.agentRunRoute = "draft";
          state.agentRunDetail = "\u8349\u6848\u5B58\u5728\u9AD8\u98CE\u9669\u95EE\u9898\uFF0C\u5DF2\u963B\u65AD\u76F4\u63A5\u5E94\u7528";
          state.summary = "\u8349\u6848\u5B58\u5728\u9AD8\u98CE\u9669\u95EE\u9898\uFF0C\u8BF7\u5148\u4FEE\u6539\u6216\u91CD\u65B0\u751F\u6210\u540E\u518D\u5E94\u7528\u3002";
          state.chatMessages = pluginAgent.buildStatusMessages({ content: state.summary, tone: "warning" });
          return commitState(internals, state, storage);
        }
        const adapter = createEditorAdapter(resolveRuntimeChannel());
        try {
          const result = await adapter.applyPlan(draftPlan);
          internals.lastApplyTransactionId = result.transactionId;
          internals.draftBlocked = false;
          state.agentRunState = "completed";
          state.agentRunRoute = "draft";
          state.agentRunDetail = "\u8349\u6848\u5DF2\u5E94\u7528";
          state.summary = `\u8349\u6848\u5DF2\u5E94\u7528\uFF1A\u5668\u4EF6 ${result.componentCount}\uFF0C\u7F51\u7EDC ${result.netCount}\u3002`;
          state.chatMessages = pluginAgent.buildDraftAppliedMessages(result.componentCount, result.netCount);
        } catch (error) {
          state.agentRunState = "failed";
          state.agentRunRoute = "draft";
          state.agentRunDetail = error instanceof Error ? error.message : String(error);
          state.summary = `\u5E94\u7528\u8349\u6848\u5931\u8D25\uFF1A${error instanceof Error ? error.message : String(error)}`;
          state.chatMessages = pluginAgent.buildStatusMessages({ content: state.summary, tone: "warning" });
        }
        state.nextActions = buildNextActions(state);
        return commitState(internals, state, storage);
      },
      rollbackLastApply: async () => {
        const state = internals.currentState ?? await computeAnalysisState();
        if (!internals.lastApplyTransactionId) {
          state.agentRunState = "failed";
          state.agentRunDetail = "\u6CA1\u6709\u53EF\u56DE\u6EDA\u4E8B\u52A1";
          state.summary = "\u6CA1\u6709\u53EF\u56DE\u6EDA\u7684\u5E94\u7528\u4E8B\u52A1\u3002";
          state.chatMessages = pluginAgent.buildStatusMessages({ content: state.summary, tone: "warning" });
          return commitState(internals, state, storage);
        }
        const adapter = createEditorAdapter(resolveRuntimeChannel());
        try {
          const result = await adapter.rollbackApplyPlan(internals.lastApplyTransactionId);
          state.agentRunState = "completed";
          state.agentRunDetail = result.rolledBack ? "\u5DF2\u56DE\u6EDA\u6700\u8FD1\u4E00\u6B21\u8349\u6848\u5E94\u7528" : "\u56DE\u6EDA\u672A\u751F\u6548";
          state.summary = result.rolledBack ? "\u5DF2\u56DE\u6EDA\u6700\u8FD1\u4E00\u6B21\u8349\u6848\u5E94\u7528\u3002" : "\u56DE\u6EDA\u672A\u751F\u6548\u3002";
          state.chatMessages = pluginAgent.buildRollbackMessages(state.summary);
        } catch (error) {
          state.agentRunState = "failed";
          state.agentRunDetail = error instanceof Error ? error.message : String(error);
          state.summary = `\u56DE\u6EDA\u5931\u8D25\uFF1A${error instanceof Error ? error.message : String(error)}`;
          state.chatMessages = pluginAgent.buildStatusMessages({ content: state.summary, tone: "warning" });
        }
        state.nextActions = buildNextActions(state);
        return commitState(internals, state, storage);
      },
      saveCustomLlmConfig: async (input) => {
        const state = internals.currentState ?? await computeAnalysisState();
        try {
          await customLlmConfigStore.set({
            provider: input.provider.trim(),
            baseUrl: input.baseUrl.trim(),
            apiKey: input.apiKey.trim(),
            model: input.model.trim()
          });
          await fillSettingsState(state, sessionStore, creditsClient, customLlmConfigStore);
          state.summary = "\u81EA\u5B9A\u4E49 LLM \u914D\u7F6E\u5DF2\u4FDD\u5B58\u3002";
          state.chatMessages = pluginAgent.buildConfigSavedMessages();
        } catch (error) {
          state.summary = `\u4FDD\u5B58 LLM \u914D\u7F6E\u5931\u8D25\uFF1A${error instanceof Error ? error.message : String(error)}`;
          state.chatMessages = pluginAgent.buildStatusMessages({ content: state.summary, tone: "warning" });
        }
        state.nextActions = buildNextActions(state);
        return commitState(internals, state, storage);
      },
      syncState: async () => {
        if (!internals.currentState) {
          return computeAnalysisState();
        }
        return attachStateVersion(internals.currentState, internals.stateVersion);
      },
      getLastState: () => internals.currentState
    };
    async function generateDraftState(prompt) {
      const state = internals.currentState ?? await computeAnalysisState();
      const channel = resolveRuntimeChannel();
      const adapter = createEditorAdapter(channel);
      try {
        const context = await buildSchematicContext(adapter);
        const result = await pluginAgent.run({
          type: "schematic_draft",
          userQuery: prompt,
          context,
          adapter
        });
        if (typeof console !== "undefined") {
          console.log(`${LOG_PREFIX} draft.react.trace`, result.executionTraces ?? []);
        }
        if (result.draftPreview) {
          state.agentRunState = "awaiting_confirmation";
          state.agentRunRoute = "draft";
          state.agentRunDetail = result.summary;
          internals.draftPlan = result.draftPlan;
          internals.draftBlocked = result.draftRisk?.level === "blocked";
          state.draftPreview = {
            title: result.draftPreview.title,
            rationale: result.draftPreview.rationale,
            componentRefs: result.draftPreview.componentRefs,
            netNames: result.draftPreview.netNames,
            componentCount: result.draftPreview.componentCount,
            netCount: result.draftPreview.netCount
          };
          state.summary = `\u8349\u6848\u5DF2\u751F\u6210\uFF1A${result.draftPreview.title}\uFF0C\u5171 ${result.draftPreview.componentCount} \u4E2A\u5668\u4EF6\uFF0C${result.draftPreview.netCount} \u6761\u7F51\u7EDC\u3002`;
          state.chatMessages = pluginAgent.buildDraftMessages({
            draftPreview: state.draftPreview,
            mcpResources: result.mcpResources,
            mcpResourceReads: result.mcpResourceReads,
            toolTraces: result.toolTraces,
            executionTraces: result.executionTraces,
            reactEvents: result.reactEvents,
            stepStates: result.stepStates,
            workingMemory: result.workingMemory,
            draftRisk: result.draftRisk,
            nextSuggestions: result.nextSuggestions,
            structuredSuggestions: result.structuredSuggestions
          });
        } else {
          state.agentRunState = "completed";
          state.agentRunRoute = "draft";
          state.agentRunDetail = "\u8349\u6848\u672A\u8FD4\u56DE\u9884\u89C8";
          state.summary = "\u8349\u6848\u751F\u6210\u5B8C\u6210\uFF0C\u4F46\u672A\u8FD4\u56DE\u9884\u89C8\u4FE1\u606F\u3002";
          state.chatMessages = pluginAgent.buildStatusMessages({ content: state.summary, tone: "warning" });
        }
      } catch (error) {
        state.agentRunState = "failed";
        state.agentRunRoute = "draft";
        state.agentRunDetail = error instanceof Error ? error.message : String(error);
        state.summary = `\u8349\u6848\u751F\u6210\u5931\u8D25\uFF1A${error instanceof Error ? error.message : String(error)}`;
        state.chatMessages = pluginAgent.buildStatusMessages({ content: state.summary, tone: "warning" });
      }
      state.nextActions = buildNextActions(state);
      return commitState(internals, state, storage);
    }
    async function generateDraftStateFromResult(result, previousMessages) {
      const state = internals.currentState ?? await computeAnalysisState();
      if (result.draftPreview) {
        internals.draftPlan = result.draftPlan;
        state.draftPreview = {
          title: result.draftPreview.title,
          rationale: result.draftPreview.rationale,
          componentRefs: result.draftPreview.componentRefs,
          netNames: result.draftPreview.netNames,
          componentCount: result.draftPreview.componentCount,
          netCount: result.draftPreview.netCount
        };
        state.summary = `\u8349\u6848\u5DF2\u751F\u6210\uFF1A${result.draftPreview.title}\uFF0C\u5171 ${result.draftPreview.componentCount} \u4E2A\u5668\u4EF6\uFF0C${result.draftPreview.netCount} \u6761\u7F51\u7EDC\u3002`;
        state.chatMessages = [
          ...previousMessages,
          ...pluginAgent.buildDraftMessages({
            draftPreview: state.draftPreview,
            mcpResources: result.mcpResources,
            mcpResourceReads: result.mcpResourceReads,
            toolTraces: result.toolTraces,
            executionTraces: result.executionTraces,
            uiEvents: result.uiEvents,
            reactEvents: result.reactEvents,
            stepStates: result.stepStates,
            workingMemory: result.workingMemory,
            draftRisk: result.draftRisk
          })
        ];
      } else {
        state.agentRunState = "completed";
        state.agentRunRoute = "draft";
        state.agentRunDetail = "\u8349\u6848\u672A\u8FD4\u56DE\u9884\u89C8";
        state.summary = "\u8349\u6848\u751F\u6210\u5B8C\u6210\uFF0C\u4F46\u672A\u8FD4\u56DE\u9884\u89C8\u4FE1\u606F\u3002";
        state.chatMessages = [
          ...previousMessages,
          ...pluginAgent.buildStatusMessages({ content: state.summary, tone: "warning" })
        ];
      }
      state.nextActions = buildNextActions(state);
      return state;
    }
    async function applyTurnResultToState(input) {
      if (input.finalRoute === "chat") {
        const nextState = input.baseState;
        nextState.agentRunRoute = "chat";
        nextState.agentRunState = "completed";
        nextState.agentRunDetail = input.result.summary;
        nextState.summary = "\u5DF2\u5B8C\u6210\u4E00\u6B21\u81EA\u7136\u5BF9\u8BDD\u56DE\u590D\u3002";
        nextState.chatMessages = replaceTrailingPendingAssistant(input.userMessages, pluginAgent.buildNaturalChatMessage(input.result));
        nextState.nextActions = buildNextActions(nextState);
        return nextState;
      }
      if (input.finalRoute === "draft") {
        const drafted = await generateDraftStateFromResult(input.result, input.userMessages);
        drafted.agentRunRoute = "draft";
        drafted.agentRunState = input.result.draftPreview ? "awaiting_confirmation" : "completed";
        drafted.agentRunDetail = input.result.summary;
        drafted.chatMessages = replaceTrailingPendingAssistant(input.userMessages, drafted.chatMessages ?? []);
        drafted.nextActions = buildNextActions(drafted);
        return drafted;
      }
      const analyzed = await computeAnalysisStateFromResult(input.result);
      const replannedFromDraft = input.plan.route === "analysis" && input.plan.intent === "analysis" && input.requestedRoute === "draft";
      analyzed.agentRunRoute = "analysis";
      analyzed.agentRunState = "completed";
      analyzed.agentRunDetail = replannedFromDraft ? `draft blocked -> analysis: ${input.result.summary}` : input.result.summary;
      analyzed.chatMessages = replaceTrailingPendingAssistant(input.userMessages, [
        ...replannedFromDraft ? pluginAgent.buildStatusMessages({
          title: "\u81EA\u52A8\u91CD\u89C4\u5212",
          tone: "warning",
          content: "\u8349\u6848\u56E0\u9AD8\u98CE\u9669\u95EE\u9898\u88AB\u963B\u65AD\uFF0C\u5DF2\u81EA\u52A8\u5207\u6362\u5230\u5206\u6790\u6A21\u5F0F\u3002"
        }) : [],
        ...analyzed.chatMessages ?? []
      ]);
      analyzed.nextActions = buildNextActions(analyzed);
      return analyzed;
    }
    async function computeAnalysisStateFromResult(result) {
      const state = await buildBaseState();
      state.channel = result.contextDigest?.channel;
      state.componentCount = result.contextDigest?.componentCount;
      state.netCount = result.contextDigest?.netCount;
      state.selectionCount = result.contextDigest?.selectionCount;
      state.issueCount = result.checkResult?.issues.length;
      state.topIssueTitle = result.checkResult?.issues[0]?.title;
      state.locateStatus = result.locateResult?.located ? `${result.locateResult.objectType}:${result.locateResult.objectId}` : "none";
      state.issueItems = result.checkResult?.issues.slice(0, 6).map((issue) => ({
        title: issue.title,
        severity: issue.severity,
        objectId: issue.objectId,
        objectType: normalizeIssueObjectType(issue.objectType)
      })) ?? [];
      state.agentRunState = "completed";
      state.agentRunRoute = "analysis";
      state.agentRunDetail = result.summary;
      state.summary = result.summary;
      state.chatMessages = pluginAgent.buildAnalysisMessages({
        issueCount: state.issueCount ?? 0,
        topIssueTitle: state.topIssueTitle,
        locateStatus: state.locateStatus,
        analysisReport: result.analysisReport,
        libraryInsights: result.libraryInsights,
        issueItems: state.issueItems,
        mcpResources: result.mcpResources,
        mcpResourceReads: result.mcpResourceReads,
        toolTraces: result.toolTraces,
        executionTraces: result.executionTraces,
        uiEvents: result.uiEvents,
        stepStates: result.stepStates,
        workingMemory: result.workingMemory,
        nextSuggestions: result.nextSuggestions,
        structuredSuggestions: result.structuredSuggestions
      });
      state.nextActions = buildNextActions(state);
      return state;
    }
  }
  function commitState(internals, state, storage) {
    internals.stateVersion += 1;
    const nextState = attachStateVersion(state, internals.stateVersion);
    internals.currentState = nextState;
    if (storage) {
      void persistPanelState(storage, nextState);
    }
    try {
      const runtime = globalThis;
      if (typeof runtime.dispatchEvent === "function" && typeof CustomEvent === "function") {
        runtime.dispatchEvent(new CustomEvent(FRAME_STATE_EVENT, { detail: nextState }));
      }
    } catch {
    }
    return nextState;
  }
  function attachStateVersion(state, stateVersion) {
    state.__stateVersion = stateVersion;
    return state;
  }
  function sanitizeChatMessages(messages) {
    return (messages ?? []).filter((message) => !message.__typing);
  }
  function stripInitialWelcomeMessages(messages) {
    return messages;
  }
  function createPendingAssistantMessage(route) {
    return {
      role: "assistant",
      title: route === "chat" ? "\u52A9\u624B" : route === "draft" ? "\u8349\u6848\u751F\u6210\u4E2D" : "\u5206\u6790\u4E2D",
      content: route === "chat" ? "\u6B63\u5728\u601D\u8003\u5E76\u8BF7\u6C42\u6A21\u578B\u56DE\u590D..." : route === "draft" ? "\u6B63\u5728\u89C4\u5212\u8349\u6848\u4E0E\u6821\u9A8C\u7EA6\u675F..." : "\u6B63\u5728\u8BFB\u53D6\u539F\u7406\u56FE\u5E76\u6267\u884C\u5206\u6790...",
      streaming: true
    };
  }
  function buildPendingAgentDetail(route) {
    if (route === "chat") {
      return "\u6B63\u5728\u89C4\u5212\u5BF9\u8BDD\u5E76\u7B49\u5F85\u6A21\u578B\u56DE\u590D";
    }
    return route === "draft" ? "\u6B63\u5728\u89C4\u5212\u8349\u6848\u4E0E\u6267\u884C\u89C4\u5219\u6821\u9A8C" : "\u6B63\u5728\u6536\u96C6\u4E0A\u4E0B\u6587\u5E76\u6267\u884C\u5206\u6790";
  }
  function buildPendingAgentSummary(route) {
    if (route === "chat") {
      return "\u6B63\u5728\u751F\u6210\u56DE\u590D...";
    }
    return route === "draft" ? "\u6B63\u5728\u751F\u6210\u8349\u6848..." : "\u6B63\u5728\u5206\u6790\u5F53\u524D\u539F\u7406\u56FE...";
  }
  function replaceTrailingPendingAssistant(messages, replacements) {
    const list = messages.slice();
    const last = list[list.length - 1];
    const normalized = Array.isArray(replacements) ? replacements : [replacements];
    if (last?.role === "assistant" && last.streaming) {
      list.pop();
    }
    return [...list, ...normalized];
  }
  async function fillSettingsState(state, sessionStore, creditsClient, customLlmConfigStore) {
    state.loggedIn = false;
    state.userDisplayName = void 0;
    state.userEmail = void 0;
    state.creditsBalance = void 0;
    state.creditsCurrency = void 0;
    state.creditsTransactions = [];
    try {
      const session = await sessionStore.get();
      if (typeof console !== "undefined") {
        console.log(`${LOG_PREFIX} session.restore`, summarizeSessionForLog(session));
      }
      if (session && !hasUsableSession(session) && session.refreshToken) {
        if (typeof console !== "undefined") {
          console.log(`${LOG_PREFIX} session.restore.refresh-needed`, summarizeSessionForLog(session));
        }
      }
      if (!hasUsableSession(session)) {
        if (session) {
          await sessionStore.clear();
          if (typeof console !== "undefined") {
            console.warn(`${LOG_PREFIX} session.restore.invalid`, summarizeSessionForLog(session));
          }
        }
        state.loginStatus = "\u672A\u767B\u5F55";
      } else {
        state.loggedIn = true;
        state.userDisplayName = session.user?.display_name;
        state.userEmail = session.user?.email;
        state.loginStatus = "\u5DF2\u767B\u5F55";
        try {
          const balance = await creditsClient.getBalance(session.accessToken);
          state.creditsBalance = balance.balance;
          state.creditsCurrency = balance.currency;
          try {
            const tx = await creditsClient.listTransactions(session.accessToken, 8);
            state.creditsTransactions = tx.transactions.map((item) => ({
              id: item.transaction_id,
              type: item.transaction_type,
              amount: item.amount,
              balanceAfter: item.balance_after,
              remark: item.remark,
              createdAt: item.created_at
            }));
          } catch {
            state.creditsTransactions = [];
          }
        } catch (error) {
          state.loginStatus = "\u5DF2\u767B\u5F55\uFF0CCredits \u672A\u540C\u6B65";
          if (typeof console !== "undefined") {
            console.warn(`${LOG_PREFIX} credits.sync.failed`, {
              error: error instanceof Error ? error.message : String(error)
            });
          }
        }
      }
    } catch (error) {
      if (typeof console !== "undefined") {
        console.warn(`${LOG_PREFIX} session.restore.failed`, {
          error: error instanceof Error ? error.message : String(error)
        });
      }
      state.loginStatus = "\u672A\u767B\u5F55";
    }
    try {
      const llmConfig = await customLlmConfigStore.get();
      if (llmConfig) {
        state.customLlmConfig = {
          provider: llmConfig.provider,
          baseUrl: llmConfig.baseUrl,
          apiKeyMasked: maskApiKey(llmConfig.apiKey),
          model: llmConfig.model
        };
      }
    } catch {
      state.customLlmConfig = void 0;
    }
  }
  async function pollLoginSessionUntilDone(internals, authClient, sessionStore, creditsClient, customLlmConfigStore, storage) {
    const active = internals.activeLoginSession;
    if (!active) {
      return;
    }
    for (let i = 0; i < 40; i += 1) {
      if (active.stopped) {
        return;
      }
      try {
        const status = await authClient.getLoginSession(active.loginSessionId, active.pollToken, 15);
        if (status.status === "success" && status.exchange_token) {
          const tokenData = await authClient.exchangeToken(active.loginSessionId, status.exchange_token);
          await sessionStore.set(toSession(tokenData));
          const state2 = internals.currentState ?? {
            loggedIn: false
          };
          await fillSettingsState(state2, sessionStore, creditsClient, customLlmConfigStore);
          state2.summary = `\u767B\u5F55\u6210\u529F\uFF0C\u6B22\u8FCE\u56DE\u6765 ${tokenData.user.display_name || tokenData.user.email}\u3002`;
          state2.nextActions = buildNextActions(state2);
          commitState(internals, state2, storage);
          active.stopped = true;
          if (internals.pendingChatInput) {
            void retryPendingChatAfterLogin(internals, chatOrchestrator, storage);
          }
          return;
        }
        if (status.status === "failed" || status.status === "expired" || status.status === "cancelled") {
          const state2 = internals.currentState ?? {
            loggedIn: false
          };
          state2.loginStatus = `\u767B\u5F55\u672A\u5B8C\u6210\uFF08${status.status}\uFF09`;
          state2.summary = "\u6D4F\u89C8\u5668\u767B\u5F55\u4F1A\u8BDD\u5DF2\u7ED3\u675F\uFF0C\u8BF7\u91CD\u65B0\u53D1\u8D77\u767B\u5F55\u3002";
          state2.nextActions = buildNextActions(state2);
          commitState(internals, state2, storage);
          active.stopped = true;
          return;
        }
      } catch (error) {
        const state2 = internals.currentState ?? {
          loggedIn: false
        };
        state2.loginStatus = "\u767B\u5F55\u8F6E\u8BE2\u5931\u8D25";
        state2.summary = `\u767B\u5F55\u72B6\u6001\u540C\u6B65\u5931\u8D25\uFF1A${error instanceof Error ? error.message : String(error)}`;
        state2.nextActions = buildNextActions(state2);
        commitState(internals, state2, storage);
        active.stopped = true;
        return;
      }
    }
    const state = internals.currentState ?? {
      loggedIn: false
    };
    state.loginStatus = "\u767B\u5F55\u7B49\u5F85\u8D85\u65F6";
    state.summary = "\u767B\u5F55\u7B49\u5F85\u8D85\u65F6\uFF0C\u8BF7\u5728\u6D4F\u89C8\u5668\u5B8C\u6210\u540E\u91CD\u65B0\u70B9\u51FB\u767B\u5F55\u3002";
    state.nextActions = buildNextActions(state);
    commitState(internals, state, storage);
    active.stopped = true;
  }
  async function retryPendingChatAfterLogin(internals, chatOrchestrator2, storage) {
    const pendingInput = internals.pendingChatInput?.trim();
    const currentState = internals.currentState;
    if (!pendingInput || !currentState) {
      return;
    }
    if (typeof console !== "undefined") {
      console.log(`${LOG_PREFIX} sendChat.retry-after-login`, {
        promptLength: pendingInput.length
      });
    }
    try {
      const assistantReply = await chatOrchestrator2.replyNaturally(currentState, pendingInput);
      const nextMessages = sanitizeChatMessages(currentState.chatMessages);
      currentState.summary = "\u767B\u5F55\u6062\u590D\u6210\u529F\uFF0C\u5DF2\u7EE7\u7EED\u521A\u624D\u7684\u5BF9\u8BDD\u3002";
      currentState.chatMessages = [
        ...nextMessages,
        assistantReply
      ];
      internals.pendingChatInput = void 0;
      commitState(internals, currentState, storage);
    } catch (error) {
      if (typeof console !== "undefined") {
        console.error(`${LOG_PREFIX} sendChat.retry-after-login.failed`, {
          error: error instanceof Error ? error.message : String(error)
        });
      }
      currentState.summary = `\u767B\u5F55\u6210\u529F\uFF0C\u4F46\u81EA\u52A8\u6062\u590D\u5BF9\u8BDD\u5931\u8D25\uFF1A${error instanceof Error ? error.message : String(error)}`;
      currentState.chatMessages = [
        ...sanitizeChatMessages(currentState.chatMessages),
        ...buildErrorChatMessages(currentState.summary)
      ];
      commitState(internals, currentState, storage);
    }
  }
  function toSession(data) {
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: new Date(Date.now() + data.expires_in * 1e3).toISOString(),
      user: data.user
    };
  }
  function hasUsableSession(session) {
    if (!session) {
      return false;
    }
    if (typeof session.accessToken !== "string" || session.accessToken.trim() === "" || typeof session.refreshToken !== "string" || session.refreshToken.trim() === "" || typeof session.expiresAt !== "string" || session.expiresAt.trim() === "") {
      return false;
    }
    const expiresAtMs = Date.parse(session.expiresAt);
    if (!Number.isFinite(expiresAtMs)) {
      return false;
    }
    return expiresAtMs > Date.now() + 3e4;
  }
  function summarizeSessionForLog(session) {
    return {
      exists: Boolean(session),
      hasAccessToken: Boolean(session?.accessToken),
      hasRefreshToken: Boolean(session?.refreshToken),
      expiresAt: session?.expiresAt,
      isExpired: session?.expiresAt ? Date.parse(session.expiresAt) <= Date.now() : void 0,
      hasUser: Boolean(session?.user),
      userEmail: session?.user?.email
    };
  }
  function normalizeIssueObjectType(value) {
    if (value === "component" || value === "pin" || value === "net") {
      return value;
    }
    return void 0;
  }
  function buildAnalysisSummary(state, adapterSource) {
    const issueCount = state.issueCount ?? 0;
    const componentCount = state.componentCount ?? 0;
    const netCount = state.netCount ?? 0;
    if (issueCount > 0) {
      return `\u5DF2\u5B8C\u6210\u5206\u6790\uFF1A\u53D1\u73B0 ${issueCount} \u4E2A\u95EE\u9898\uFF0C\u5F53\u524D\u4F18\u5148\u95EE\u9898\u4E3A\u201C${state.topIssueTitle ?? "\u672A\u547D\u540D\u95EE\u9898"}\u201D\u3002\uFF08components=${componentCount}, nets=${netCount}, source=${adapterSource}\uFF09`;
    }
    return `\u5DF2\u5B8C\u6210\u5206\u6790\uFF1A\u5F53\u524D\u672A\u53D1\u73B0\u660E\u663E\u89C4\u5219\u95EE\u9898\u3002\uFF08components=${componentCount}, nets=${netCount}, source=${adapterSource}\uFF09`;
  }
  function buildSessionTitleFromPrompt(prompt) {
    const normalized = prompt.replace(/\s+/g, " ").trim();
    const cleaned = stripSessionTitlePrefix(normalized);
    const distilled = distillSessionTitle(cleaned);
    if (!distilled) {
      return "New Session";
    }
    const maxVisualWidth = 26;
    let visualWidth = 0;
    let result = "";
    for (const char of distilled) {
      const width = isWideCharacter(char) ? 2 : 1;
      if (visualWidth + width > maxVisualWidth) {
        break;
      }
      result += char;
      visualWidth += width;
    }
    if (!result) {
      return "New Session";
    }
    return result.length < distilled.length ? `${result}...` : result;
  }
  function stripSessionTitlePrefix(text) {
    return text.replace(/^(请你|请先|请|麻烦你|麻烦|帮我|请帮我|能否|可以|帮忙|想请你)\s*/u, "").replace(/^(分析一下|分析|看一下|看下|检查一下|检查|帮我分析一下|帮我看一下|帮我检查一下)\s*/u, "").replace(/^(当前|这个|这张|这个原理图|当前原理图)\s*/u, "").replace(/^(一下|一下子)\s*/u, "").trim();
  }
  function distillSessionTitle(text) {
    if (!text) {
      return "";
    }
    const compact = text.replace(/^(分析|检查|看看|查看|确认|判断|评估|优化|生成|设计|绘制|修改|排查|定位)\s*/u, "").replace(/(一下|一下子|是否|有无|有没有|怎么|怎样|如何)$/u, "").replace(/\b(please|help|check|analyze|review)\b/giu, "").replace(/\s+/g, " ").trim();
    const keywords = extractSessionKeywords(compact);
    if (keywords.length >= 2) {
      const candidate = keywords.join(" ");
      if (candidate.length >= 4) {
        return candidate;
      }
    }
    return compact;
  }
  function extractSessionKeywords(text) {
    const matches = text.match(/[A-Za-z]+\d+[A-Za-z0-9_-]*|[A-Z]{2,}[A-Za-z0-9_-]*|\d+(?:\.\d+)?[kKmMuUnNpPfF]?|[\u4e00-\u9fff]{2,}/gu) ?? [];
    const seen = /* @__PURE__ */ new Set();
    const results = [];
    for (const raw of matches) {
      const token = raw.trim();
      if (!token) {
        continue;
      }
      const normalized = token.toLowerCase();
      if (seen.has(normalized)) {
        continue;
      }
      seen.add(normalized);
      results.push(token);
      if (results.length >= 4) {
        break;
      }
    }
    return results;
  }
  function isWideCharacter(char) {
    return /[^\u0000-\u00ff]/u.test(char);
  }
  async function restorePanelState(storage) {
    try {
      const raw = await storage.getItem(PANEL_STATE_STORAGE_KEY);
      if (!raw) {
        return void 0;
      }
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") {
        return void 0;
      }
      parsed.chatMessages = sanitizeChatMessages(parsed.chatMessages);
      return parsed;
    } catch {
      return void 0;
    }
  }
  async function persistPanelState(storage, state) {
    try {
      const snapshot = {
        ...state,
        __stateVersion: void 0,
        chatMessages: sanitizeChatMessages(state.chatMessages).map((message) => ({
          ...message,
          streaming: false
        }))
      };
      await storage.setItem(PANEL_STATE_STORAGE_KEY, JSON.stringify(snapshot));
    } catch {
    }
  }
  async function clearPanelState(storage) {
    try {
      await storage.removeItem(PANEL_STATE_STORAGE_KEY);
    } catch {
    }
  }
  function buildLocateChatMessages(state, objectType, objectId) {
    return [
      {
        role: "assistant",
        title: "\u5B9A\u4F4D\u5B8C\u6210",
        tone: "success",
        content: `\u6211\u5DF2\u7ECF\u5728\u753B\u5E03\u4E2D\u5B9A\u4F4D\u5230 ${objectType}:${objectId}\u3002
\u5982\u679C\u8FD8\u9700\u8981\uFF0C\u6211\u53EF\u4EE5\u7EE7\u7EED\u91CD\u65B0\u5206\u6790\u6216\u751F\u6210\u8349\u6848\u3002`,
        actions: [
          {
            label: "\u91CD\u65B0\u5206\u6790",
            action: "rerun"
          }
        ]
      },
      ...state.chatMessages ?? []
    ];
  }
  function maskApiKey(value) {
    if (value.length <= 8) {
      return "********";
    }
    return `${value.slice(0, 4)}********${value.slice(-4)}`;
  }
  function buildNextActions(state) {
    const actions = [];
    if (!state.loggedIn) {
      actions.push("\u70B9\u51FB\u201C\u767B\u5F55\u201D\u540E\u7528\u6D4F\u89C8\u5668\u5B8C\u6210\u90AE\u7BB1\u6216\u5FAE\u4FE1\u767B\u5F55\u3002");
    }
    if ((state.issueCount ?? 0) > 0) {
      actions.push("\u70B9\u51FB\u95EE\u9898\u5217\u8868\u4E2D\u7684\u201C\u5B9A\u4F4D\u201D\u4F18\u5148\u68C0\u67E5\u63A5\u7EBF\u6807\u51C6\u3001\u7535\u6E90\u51B2\u7A81\u4E0E\u5C5E\u6027\u7F3A\u5931\u3002");
    }
    if (state.capabilityReport && state.capabilityReport.missing.length > 0) {
      actions.push(`\u5F53\u524D\u5BBF\u4E3B\u80FD\u529B\u53D7\u9650\uFF1A${state.capabilityReport.missing.join("\u3001")}\u3002`);
    }
    actions.push("\u8F93\u5165\u9879\u76EE\u9700\u6C42\u540E\u53EF\u751F\u6210\u8349\u6848\uFF0C\u786E\u8BA4\u540E\u518D\u8FDB\u5165 apply-plan\u3002");
    return actions;
  }

  // src/iframe.ts
  var LOG_PREFIX2 = "[LCEDA-AI][iframe-entry]";
  var FRAME_STATE_EVENT2 = "lceda-ai-assistant:state";
  async function bootstrapIframeApp() {
    initConfig();
    autoInstallHostBridge();
    const runtime = getAssistantRuntime();
    const state = await runtime.openPanel();
    window.__LCEDA_AI_ASSISTANT_FRAME_RUNTIME__ = runtime;
    window.__LCEDA_AI_ASSISTANT_FRAME_STATE__ = state;
    if (typeof console !== "undefined") {
      console.log(`${LOG_PREFIX2} ready`, {
        hasRuntime: true,
        messageCount: state.chatMessages?.length ?? 0,
        loggedIn: state.loggedIn
      });
    }
  }
  window.addEventListener(FRAME_STATE_EVENT2, (event) => {
    const customEvent = event;
    window.__LCEDA_AI_ASSISTANT_FRAME_STATE__ = customEvent.detail;
  });
  void bootstrapIframeApp().catch((error) => {
    if (typeof console !== "undefined") {
      console.error(`${LOG_PREFIX2} failed`, error instanceof Error ? error.message : String(error));
    }
  });
})();
