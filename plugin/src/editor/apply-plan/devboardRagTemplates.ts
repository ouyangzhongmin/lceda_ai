export interface DevboardRagTemplateComponent {
  ref: string;
  name: string;
  value?: string;
  completionRole: string;
  attachToNet?: string;
}

export interface DevboardRagTemplateSource {
  kind: "local_seed" | "lceda_open_source_extract";
  projectId: string;
  sheetRef: string;
  extractionRevision: string;
}

export type DevboardRagTemplateType =
  | "mcu_power_core"
  | "mcu_boot_reset"
  | "uart_download_header"
  | "usb_power_input"
  | "power_indicator"
  | "status_indicator"
  | "button_reset"
  | "button_boot"
  | "expansion_header";

export interface DevboardRagTemplate {
  templateId: string;
  templateType: DevboardRagTemplateType;
  anchorDeviceFamily: string;
  anchorDeviceModel?: string;
  scenarioTags: string[];
  qualityScore: number;
  components: DevboardRagTemplateComponent[];
  source: DevboardRagTemplateSource;
}

export interface DevboardRagTemplateCorpusEntry {
  template_id: string;
  template_type: DevboardRagTemplateType;
  anchor_device_family: string;
  anchor_device_model?: string;
  scenario_tags: string[];
  components: Array<{
    ref: string;
    name: string;
    value?: string;
    completion_role: string;
    attach_to_net?: string;
  }>;
  pin_bindings: Array<{
    component_ref: string;
    completion_role: string;
    net_name: string;
  }>;
  default_values: Array<{
    role: string;
    value: string;
  }>;
  source: {
    kind: DevboardRagTemplateSource["kind"];
    project_id: string;
    sheet_ref: string;
    extraction_revision: string;
  };
  quality_score: number;
}

const DEVBOARD_RAG_TEMPLATE_TYPES = new Set<DevboardRagTemplateType>([
  "mcu_power_core",
  "mcu_boot_reset",
  "uart_download_header",
  "usb_power_input",
  "power_indicator",
  "status_indicator",
  "button_reset",
  "button_boot",
  "expansion_header",
]);

const DEVBOARD_RAG_TEMPLATES: DevboardRagTemplate[] = [
  {
    templateId: "esp32s3-mcu-power-core",
    templateType: "mcu_power_core",
    anchorDeviceFamily: "ESP32",
    anchorDeviceModel: "ESP32-S3",
    scenarioTags: ["devboard", "usb", "3v3"],
    qualityScore: 0.98,
    source: {
      kind: "local_seed",
      projectId: "local-devboard-seed",
      sheetRef: "esp32s3-core-power",
      extractionRevision: "v1",
    },
    components: [
      {
        ref: "C_AUTO_10U",
        name: "capacitor",
        value: "10uF",
        completionRole: "mcu_bulk_decoupling",
        attachToNet: "3V3",
      },
      {
        ref: "C_AUTO_100N",
        name: "capacitor",
        value: "100nF",
        completionRole: "mcu_local_decoupling",
        attachToNet: "3V3",
      },
    ],
  },
  {
    templateId: "esp32s3-boot-reset",
    templateType: "mcu_boot_reset",
    anchorDeviceFamily: "ESP32",
    anchorDeviceModel: "ESP32-S3",
    scenarioTags: ["devboard", "boot", "reset"],
    qualityScore: 0.97,
    source: {
      kind: "local_seed",
      projectId: "local-devboard-seed",
      sheetRef: "esp32s3-boot-reset",
      extractionRevision: "v1",
    },
    components: [
      {
        ref: "R_AUTO_EN",
        name: "resistor",
        value: "10k",
        completionRole: "mcu_en_pullup",
        attachToNet: "MCU_EN",
      },
      {
        ref: "C_AUTO_EN",
        name: "capacitor",
        value: "1uF",
        completionRole: "mcu_en_rc",
        attachToNet: "MCU_EN",
      },
    ],
  },
  {
    templateId: "rp2040-mcu-power-core",
    templateType: "mcu_power_core",
    anchorDeviceFamily: "RP2040",
    anchorDeviceModel: "RP2040",
    scenarioTags: ["devboard", "usb", "3v3"],
    qualityScore: 0.96,
    source: {
      kind: "local_seed",
      projectId: "local-devboard-seed",
      sheetRef: "rp2040-core-power",
      extractionRevision: "v1",
    },
    components: [
      {
        ref: "C_AUTO_VREG_IN",
        name: "capacitor",
        value: "1uF",
        completionRole: "mcu_vreg_input_decoupling",
        attachToNet: "3V3",
      },
      {
        ref: "C_AUTO_VREG_OUT",
        name: "capacitor",
        value: "1uF",
        completionRole: "mcu_vreg_output_decoupling",
        attachToNet: "3V3",
      },
    ],
  },
  {
    templateId: "esp32c3-mcu-power-core",
    templateType: "mcu_power_core",
    anchorDeviceFamily: "ESP32",
    anchorDeviceModel: "ESP32-C3",
    scenarioTags: ["devboard", "usb", "3v3"],
    qualityScore: 0.97,
    source: {
      kind: "local_seed",
      projectId: "local-devboard-seed",
      sheetRef: "esp32c3-core-power",
      extractionRevision: "v1",
    },
    components: [
      {
        ref: "C_AUTO_C3_10U",
        name: "capacitor",
        value: "10uF",
        completionRole: "mcu_bulk_decoupling",
        attachToNet: "3V3",
      },
      {
        ref: "C_AUTO_C3_100N",
        name: "capacitor",
        value: "100nF",
        completionRole: "mcu_local_decoupling",
        attachToNet: "3V3",
      },
    ],
  },
  {
    templateId: "stm32f103-mcu-power-core",
    templateType: "mcu_power_core",
    anchorDeviceFamily: "STM32",
    anchorDeviceModel: "STM32F103",
    scenarioTags: ["devboard", "3v3", "core_power"],
    qualityScore: 0.96,
    source: {
      kind: "local_seed",
      projectId: "local-devboard-seed",
      sheetRef: "stm32f103-core-power",
      extractionRevision: "v1",
    },
    components: [
      {
        ref: "C_AUTO_VDD_100N",
        name: "capacitor",
        value: "100nF",
        completionRole: "mcu_local_decoupling",
        attachToNet: "3V3",
      },
      {
        ref: "C_AUTO_VDD_4U7",
        name: "capacitor",
        value: "4.7uF",
        completionRole: "mcu_bulk_decoupling",
        attachToNet: "3V3",
      },
    ],
  },
  {
    templateId: "esp32-uart-download-header",
    templateType: "uart_download_header",
    anchorDeviceFamily: "ESP32",
    scenarioTags: ["devboard", "uart", "download"],
    qualityScore: 0.92,
    source: {
      kind: "local_seed",
      projectId: "local-devboard-seed",
      sheetRef: "esp32-uart-download",
      extractionRevision: "v1",
    },
    components: [
      {
        ref: "J_AUTO_UART",
        name: "pin_header",
        value: "1x6",
        completionRole: "uart_download_header",
      },
    ],
  },
  {
    templateId: "stm32f103-power-indicator",
    templateType: "power_indicator",
    anchorDeviceFamily: "STM32",
    anchorDeviceModel: "STM32F103",
    scenarioTags: ["devboard", "power", "indicator"],
    qualityScore: 0.93,
    source: {
      kind: "local_seed",
      projectId: "local-devboard-seed",
      sheetRef: "stm32f103-power-indicator",
      extractionRevision: "v1",
    },
    components: [
      {
        ref: "D_AUTO_PWR",
        name: "led",
        value: "GREEN",
        completionRole: "power_led",
        attachToNet: "3V3",
      },
      {
        ref: "R_AUTO_PWR",
        name: "resistor",
        value: "1k",
        completionRole: "power_led_resistor",
        attachToNet: "3V3",
      },
    ],
  },
  {
    templateId: "esp32-family-expansion-header",
    templateType: "expansion_header",
    anchorDeviceFamily: "ESP32",
    scenarioTags: ["devboard", "expansion", "gpio"],
    qualityScore: 0.9,
    source: {
      kind: "local_seed",
      projectId: "local-devboard-seed",
      sheetRef: "esp32-family-expansion",
      extractionRevision: "v1",
    },
    components: [
      {
        ref: "J_AUTO_GPIO",
        name: "pin_header",
        value: "2x10",
        completionRole: "gpio_expansion_header",
      },
    ],
  },
  {
    templateId: "esp32s3-usb-5v-input",
    templateType: "usb_power_input",
    anchorDeviceFamily: "ESP32",
    anchorDeviceModel: "ESP32-S3",
    scenarioTags: ["devboard", "usb", "5v", "input"],
    qualityScore: 0.95,
    source: {
      kind: "local_seed",
      projectId: "local-devboard-seed",
      sheetRef: "esp32s3-usb-vbus",
      extractionRevision: "v1",
    },
    components: [
      {
        ref: "F_AUTO_USB",
        name: "polyfuse",
        value: "500mA",
        completionRole: "usb_vbus_protection",
        attachToNet: "VBUS",
      },
      {
        ref: "D_AUTO_ESD",
        name: "tvs_diode",
        value: "5V",
        completionRole: "usb_vbus_esd",
        attachToNet: "VBUS",
      },
    ],
  },
  {
    templateId: "esp32s3-3v3-ldo",
    templateType: "mcu_power_core",
    anchorDeviceFamily: "ESP32",
    anchorDeviceModel: "ESP32-S3",
    scenarioTags: ["devboard", "3v3", "ldo", "power"],
    qualityScore: 0.96,
    source: {
      kind: "local_seed",
      projectId: "local-devboard-seed",
      sheetRef: "esp32s3-ldo-3v3",
      extractionRevision: "v1",
    },
    components: [
      {
        ref: "U_AUTO_LDO",
        name: "ldo_regulator",
        value: "3.3V",
        completionRole: "ldo_3v3_regulator",
      },
      {
        ref: "C_AUTO_LDO_IN",
        name: "capacitor",
        value: "10uF",
        completionRole: "ldo_input_cap",
        attachToNet: "5V",
      },
      {
        ref: "C_AUTO_LDO_OUT",
        name: "capacitor",
        value: "10uF",
        completionRole: "ldo_output_cap",
        attachToNet: "3V3",
      },
    ],
  },
  {
    templateId: "esp32s3-uart-download-header",
    templateType: "uart_download_header",
    anchorDeviceFamily: "ESP32",
    anchorDeviceModel: "ESP32-S3",
    scenarioTags: ["devboard", "uart", "download", "esp32s3"],
    qualityScore: 0.94,
    source: {
      kind: "local_seed",
      projectId: "local-devboard-seed",
      sheetRef: "esp32s3-uart-download",
      extractionRevision: "v1",
    },
    components: [
      {
        ref: "J_AUTO_UART_DL",
        name: "pin_header",
        value: "1x6",
        completionRole: "uart_download_header",
      },
    ],
  },
  {
    templateId: "esp32s3-power-indicator",
    templateType: "power_indicator",
    anchorDeviceFamily: "ESP32",
    anchorDeviceModel: "ESP32-S3",
    scenarioTags: ["devboard", "power", "indicator", "3v3"],
    qualityScore: 0.94,
    source: {
      kind: "local_seed",
      projectId: "local-devboard-seed",
      sheetRef: "esp32s3-power-indicator",
      extractionRevision: "v1",
    },
    components: [
      {
        ref: "D_AUTO_3V3",
        name: "led",
        value: "GREEN",
        completionRole: "power_led",
        attachToNet: "3V3",
      },
      {
        ref: "R_AUTO_3V3_LED",
        name: "resistor",
        value: "1k",
        completionRole: "power_led_resistor",
        attachToNet: "3V3",
      },
    ],
  },
  {
    templateId: "esp32s3-expansion-header",
    templateType: "expansion_header",
    anchorDeviceFamily: "ESP32",
    anchorDeviceModel: "ESP32-S3",
    scenarioTags: ["devboard", "expansion", "gpio", "esp32s3"],
    qualityScore: 0.93,
    source: {
      kind: "local_seed",
      projectId: "local-devboard-seed",
      sheetRef: "esp32s3-expansion",
      extractionRevision: "v1",
    },
    components: [
      {
        ref: "J_AUTO_EXP",
        name: "pin_header",
        value: "2x10",
        completionRole: "gpio_expansion_header",
      },
    ],
  },
  {
    templateId: "rp2040-reset-button",
    templateType: "button_reset",
    anchorDeviceFamily: "RP2040",
    anchorDeviceModel: "RP2040",
    scenarioTags: ["devboard", "reset", "button", "control"],
    qualityScore: 0.93,
    source: {
      kind: "local_seed",
      projectId: "local-devboard-seed",
      sheetRef: "rp2040-reset-button",
      extractionRevision: "v1",
    },
    components: [
      {
        ref: "S_AUTO_RUN",
        name: "tact_switch",
        completionRole: "reset_button",
        attachToNet: "RUN",
      },
      {
        ref: "R_AUTO_RUN",
        name: "resistor",
        value: "10k",
        completionRole: "reset_pullup",
        attachToNet: "RUN",
      },
    ],
  },
  {
    templateId: "rp2040-status-indicator",
    templateType: "status_indicator",
    anchorDeviceFamily: "RP2040",
    anchorDeviceModel: "RP2040",
    scenarioTags: ["devboard", "status", "indicator", "led"],
    qualityScore: 0.91,
    source: {
      kind: "local_seed",
      projectId: "local-devboard-seed",
      sheetRef: "rp2040-status-indicator",
      extractionRevision: "v1",
    },
    components: [
      {
        ref: "D_AUTO_STAT",
        name: "led",
        value: "GREEN",
        completionRole: "status_led",
        attachToNet: "GPIO25",
      },
      {
        ref: "R_AUTO_STAT",
        name: "resistor",
        value: "1k",
        completionRole: "status_led_resistor",
        attachToNet: "GPIO25",
      },
    ],
  },
  {
    templateId: "stm32f103-reset-button",
    templateType: "button_reset",
    anchorDeviceFamily: "STM32",
    anchorDeviceModel: "STM32F103",
    scenarioTags: ["devboard", "reset", "button", "control"],
    qualityScore: 0.94,
    source: {
      kind: "local_seed",
      projectId: "local-devboard-seed",
      sheetRef: "stm32f103-reset-button",
      extractionRevision: "v1",
    },
    components: [
      {
        ref: "S_AUTO_NRST",
        name: "tact_switch",
        completionRole: "reset_button",
        attachToNet: "NRST",
      },
      {
        ref: "R_AUTO_NRST",
        name: "resistor",
        value: "10k",
        completionRole: "reset_pullup",
        attachToNet: "NRST",
      },
    ],
  },
  {
    templateId: "stm32f103-boot-button",
    templateType: "button_boot",
    anchorDeviceFamily: "STM32",
    anchorDeviceModel: "STM32F103",
    scenarioTags: ["devboard", "boot", "button", "control"],
    qualityScore: 0.92,
    source: {
      kind: "local_seed",
      projectId: "local-devboard-seed",
      sheetRef: "stm32f103-boot-button",
      extractionRevision: "v1",
    },
    components: [
      {
        ref: "S_AUTO_BOOT0",
        name: "tact_switch",
        completionRole: "boot_button",
        attachToNet: "BOOT0",
      },
      {
        ref: "R_AUTO_BOOT0",
        name: "resistor",
        value: "10k",
        completionRole: "boot_pulldown",
        attachToNet: "BOOT0",
      },
    ],
  },
  {
    templateId: "stm32f103-status-indicator",
    templateType: "status_indicator",
    anchorDeviceFamily: "STM32",
    anchorDeviceModel: "STM32F103",
    scenarioTags: ["devboard", "status", "indicator", "led"],
    qualityScore: 0.91,
    source: {
      kind: "local_seed",
      projectId: "local-devboard-seed",
      sheetRef: "stm32f103-status-indicator",
      extractionRevision: "v1",
    },
    components: [
      {
        ref: "D_AUTO_STAT",
        name: "led",
        value: "BLUE",
        completionRole: "status_led",
        attachToNet: "PA5",
      },
      {
        ref: "R_AUTO_STAT",
        name: "resistor",
        value: "1k",
        completionRole: "status_led_resistor",
        attachToNet: "PA5",
      },
    ],
  },
];

export function getDevboardRagTemplates(): DevboardRagTemplate[] {
  return DEVBOARD_RAG_TEMPLATES.map((item) => ({
    ...item,
    scenarioTags: [...item.scenarioTags],
    source: { ...item.source },
    components: item.components.map((component) => ({ ...component })),
  }));
}

export function exportDevboardRagTemplateCorpus(): DevboardRagTemplateCorpusEntry[] {
  return getDevboardRagTemplates().map((item) => ({
    template_id: item.templateId,
    template_type: item.templateType,
    anchor_device_family: item.anchorDeviceFamily,
    anchor_device_model: item.anchorDeviceModel,
    scenario_tags: [...item.scenarioTags],
    components: item.components.map((component) => ({
      ref: component.ref,
      name: component.name,
      value: component.value,
      completion_role: component.completionRole,
      attach_to_net: component.attachToNet,
    })),
    pin_bindings: item.components
      .filter((component) => component.attachToNet)
      .map((component) => ({
        component_ref: component.ref,
        completion_role: component.completionRole,
        net_name: String(component.attachToNet),
      })),
    default_values: item.components
      .filter((component): component is DevboardRagTemplateComponent & { value: string } => Boolean(component.value))
      .map((component) => ({
        role: component.completionRole,
        value: component.value,
      })),
    source: {
      kind: item.source.kind,
      project_id: item.source.projectId,
      sheet_ref: item.source.sheetRef,
      extraction_revision: item.source.extractionRevision,
    },
    quality_score: item.qualityScore,
  }));
}

export function importDevboardRagTemplateCorpus(rawEntries: unknown[]): DevboardRagTemplate[] {
  return rawEntries.flatMap((entry) => {
    if (!entry || typeof entry !== "object") {
      return [];
    }
    const record = entry as Record<string, unknown>;
    const templateType = String(record.template_type ?? "").trim() as DevboardRagTemplateType;
    if (!DEVBOARD_RAG_TEMPLATE_TYPES.has(templateType)) {
      return [];
    }
    const templateId = String(record.template_id ?? "").trim();
    const anchorDeviceFamily = String(record.anchor_device_family ?? "").trim();
    const qualityScore = Number(record.quality_score);
    const sourceRecord = record.source && typeof record.source === "object" ? (record.source as Record<string, unknown>) : null;
    const rawComponents = Array.isArray(record.components) ? record.components : [];
    if (!templateId || !anchorDeviceFamily || !Number.isFinite(qualityScore) || !sourceRecord || rawComponents.length === 0) {
      return [];
    }
    const sourceKind = String(sourceRecord.kind ?? "").trim() as DevboardRagTemplateSource["kind"];
    if (sourceKind !== "local_seed" && sourceKind !== "lceda_open_source_extract") {
      return [];
    }
    const projectId = String(sourceRecord.project_id ?? "").trim();
    const sheetRef = String(sourceRecord.sheet_ref ?? "").trim();
    const extractionRevision = String(sourceRecord.extraction_revision ?? "").trim();
    if (!projectId || !sheetRef || !extractionRevision) {
      return [];
    }
    const components = rawComponents.flatMap((component) => {
      if (!component || typeof component !== "object") {
        return [];
      }
      const componentRecord = component as Record<string, unknown>;
      const ref = String(componentRecord.ref ?? "").trim();
      const name = String(componentRecord.name ?? "").trim();
      const completionRole = String(componentRecord.completion_role ?? "").trim();
      if (!ref || !name || !completionRole) {
        return [];
      }
      return [
        {
          ref,
          name,
          value: componentRecord.value ? String(componentRecord.value) : undefined,
          completionRole,
          attachToNet: componentRecord.attach_to_net ? String(componentRecord.attach_to_net) : undefined,
        },
      ];
    });
    if (components.length === 0) {
      return [];
    }
    return [
      {
        templateId,
        templateType,
        anchorDeviceFamily,
        anchorDeviceModel: record.anchor_device_model ? String(record.anchor_device_model) : undefined,
        scenarioTags: Array.isArray(record.scenario_tags)
          ? record.scenario_tags.map((tag) => String(tag).trim()).filter(Boolean)
          : [],
        qualityScore,
        components,
        source: {
          kind: sourceKind,
          projectId,
          sheetRef,
          extractionRevision,
        },
      },
    ];
  });
}
