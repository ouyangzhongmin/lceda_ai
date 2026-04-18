import type { SchematicComponent, SchematicNet } from "../../types/schematic";
import type { DraftPlan } from "./draftPlan";

type CompletionTemplateId =
  | "esp32_s3_support"
  | "usb_c_power_input"
  | "i2s_mic_support"
  | "max98357a_support"
  | "indicator_led_support"
  | "button_input_support"
  | "hall_sensor_support";

type CompletionComponentInput = {
  ref: string;
  name: string;
  value?: string;
  packageName?: string;
  completionRole: string;
  preferredSearchQuery?: string;
};

type CompletionTemplate = {
  id: CompletionTemplateId;
  detect: (text: string) => boolean;
  components: CompletionComponentInput[];
  nets?: string[];
};

function buildCompletionComponent(
  input: CompletionComponentInput,
  index: number,
  templateId: CompletionTemplateId
): SchematicComponent {
  return {
    id: `completion-${templateId}-${input.ref.toLowerCase() || index + 1}`,
    ref: input.ref,
    name: input.name,
    packageName: input.packageName,
    value: input.value,
    addIntoBom: true,
    addIntoPcb: true,
    properties: {
      generated_by: "rule_completion",
      completion_template: templateId,
      completion_role: input.completionRole,
      preferred_search_query: input.preferredSearchQuery ?? input.name,
    },
  };
}

function buildCompletionNet(name: string): SchematicNet {
  return {
    id: `completion-net-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    name,
    nodeIds: [],
    isPower: /^(gnd|vbus|vbat|3v3|5v)$/iu.test(name),
  };
}

function normalizeText(plan: DraftPlan): string {
  return [
    ...plan.components.map((item) =>
      [
        item.ref,
        item.name,
        item.value,
        item.packageName,
        item.properties?.device_name,
        item.properties?.preferred_search_query,
        item.properties?.completion_role,
      ]
        .filter(Boolean)
        .join(" ")
    ),
    ...plan.nets.map((item) => item.name || item.id),
  ]
    .join(" ")
    .toLowerCase();
}

function inferTemplates(plan: DraftPlan): CompletionTemplateId[] {
  const text = normalizeText(plan);
  return COMPLETION_TEMPLATES.filter((template) => template.detect(text)).map((template) => template.id);
}

function hasEquivalentComponent(plan: DraftPlan, templateId: CompletionTemplateId, component: CompletionComponentInput): boolean {
  const targetRef = component.ref.toUpperCase();
  const targetRole = component.completionRole.toLowerCase();
  return plan.components.some((entry) => {
    const ref = String(entry.ref || "").toUpperCase();
    const role = String(entry.properties?.completion_role || "").toLowerCase();
    const name = String(entry.name || "").toLowerCase();
    const value = String(entry.value || "").toLowerCase();
    const template = String(entry.properties?.completion_template || "").toLowerCase();
    return (
      ref === targetRef ||
      role === targetRole ||
      template === templateId.toLowerCase() && role === targetRole ||
      (targetRole.includes("decoupling") && /^c\d+$/iu.test(ref)) ||
      (targetRole.includes("pull") && /^r\d+$/iu.test(ref) && `${name} ${value}`.includes("10k")) ||
      (targetRole.includes("cc") && /^r\d+$/iu.test(ref) && `${name} ${value}`.includes("5.1k"))
    );
  });
}

function hasNet(plan: DraftPlan, name: string): boolean {
  return plan.nets.some((net) => String(net.name || "").trim().toUpperCase() === name.trim().toUpperCase());
}

const COMPLETION_TEMPLATES: CompletionTemplate[] = [
  {
    id: "esp32_s3_support",
    detect: (text) => /esp32-s3|esp32 s3|esp32s3/iu.test(text),
    components: [
      { ref: "C1", name: "Capacitor", value: "0.1uF", packageName: "C0603", completionRole: "mcu_decoupling_small" },
      { ref: "C2", name: "Capacitor", value: "1uF", packageName: "C0603", completionRole: "mcu_decoupling_mid" },
      { ref: "C3", name: "Capacitor", value: "10uF", packageName: "C0805", completionRole: "mcu_bulk_cap" },
      { ref: "R1", name: "Resistor", value: "10k", packageName: "R0603", completionRole: "en_pullup" },
      { ref: "S1", name: "Tact Switch", packageName: "SW-SMD_4P-L3.0-W2.0-P3.50-LS4.0", completionRole: "reset_button" },
      { ref: "R2", name: "Resistor", value: "10k", packageName: "R0603", completionRole: "boot_pullup" },
      { ref: "S2", name: "Tact Switch", packageName: "SW-SMD_4P-L3.0-W2.0-P3.50-LS4.0", completionRole: "boot_button" },
      { ref: "Y1", name: "Crystal", value: "40MHz", packageName: "X3225", completionRole: "main_clock" },
      { ref: "C4", name: "Capacitor", value: "22pF", packageName: "C0603", completionRole: "xtal_load_cap_a" },
      { ref: "C5", name: "Capacitor", value: "22pF", packageName: "C0603", completionRole: "xtal_load_cap_b" },
    ],
    nets: ["3V3", "EN", "GPIO0", "XTAL_IN", "XTAL_OUT"],
  },
  {
    id: "usb_c_power_input",
    detect: (text) => /usb-c|usb c|type-c|type c/iu.test(text),
    components: [
      { ref: "R3", name: "Resistor", value: "5.1k", packageName: "R0603", completionRole: "usb_cc1_pulldown" },
      { ref: "R4", name: "Resistor", value: "5.1k", packageName: "R0603", completionRole: "usb_cc2_pulldown" },
      { ref: "C6", name: "Capacitor", value: "10uF", packageName: "C0805", completionRole: "vbus_bulk_cap" },
      { ref: "D1", name: "ESD Diode", packageName: "SOT-23-6", completionRole: "usb_esd_protection" },
    ],
    nets: ["VBUS", "CC1", "CC2", "GND"],
  },
  {
    id: "i2s_mic_support",
    detect: (text) => /inmp441|i2s mic|microphone|mic/iu.test(text),
    components: [
      { ref: "C7", name: "Capacitor", value: "0.1uF", packageName: "C0603", completionRole: "mic_decoupling" },
      { ref: "R5", name: "Resistor", value: "10k", packageName: "R0603", completionRole: "mic_lr_select" },
    ],
    nets: ["I2S_WS", "I2S_SCK", "I2S_SD", "3V3"],
  },
  {
    id: "max98357a_support",
    detect: (text) => /max98357/iu.test(text),
    components: [
      { ref: "C8", name: "Capacitor", value: "0.1uF", packageName: "C0603", completionRole: "amp_decoupling_small" },
      { ref: "C9", name: "Capacitor", value: "10uF", packageName: "C0805", completionRole: "amp_bulk_cap" },
      { ref: "R6", name: "Resistor", value: "100k", packageName: "R0603", completionRole: "amp_gain_config" },
      { ref: "J2", name: "Speaker Header", packageName: "HDR-TH_1X2", completionRole: "speaker_output" },
    ],
    nets: ["SPK_P", "SPK_N", "I2S_DOUT", "5V"],
  },
  {
    id: "indicator_led_support",
    detect: (text) => /indicator|status led|指示灯|状态灯/iu.test(text),
    components: [{ ref: "R7", name: "Resistor", value: "1k", packageName: "R0603", completionRole: "led_current_limit" }],
  },
  {
    id: "button_input_support",
    detect: (text) => /button|key|switch/iu.test(text),
    components: [{ ref: "R8", name: "Resistor", value: "10k", packageName: "R0603", completionRole: "button_pullup" }],
  },
  {
    id: "hall_sensor_support",
    detect: (text) => /hall/iu.test(text),
    components: [
      { ref: "R9", name: "Resistor", value: "10k", packageName: "R0603", completionRole: "hall_pullup" },
      { ref: "C10", name: "Capacitor", value: "0.1uF", packageName: "C0603", completionRole: "hall_decoupling" },
    ],
  },
];

export function completeDraftPlanPeripherals(plan: DraftPlan): DraftPlan {
  const templateIds = inferTemplates(plan);
  if (templateIds.length === 0) {
    const existingRefs = plan.components
      .filter((item) => item.properties?.generated_by === "rule_completion")
      .map((item) => item.ref)
      .filter((item): item is string => Boolean(item));
    const existingTemplates = Array.from(
      new Set(
        plan.components
          .map((item) => item.properties?.completion_template)
          .filter((item): item is string => Boolean(item))
      )
    );
    return {
      ...plan,
      completionSummary: {
        addedComponentCount: existingRefs.length,
        templateIds: existingTemplates,
        addedRefs: existingRefs,
      },
    };
  }

  const nextPlan: DraftPlan = {
    ...plan,
    components: [...plan.components],
    pins: [...plan.pins],
    nets: [...plan.nets],
  };
  const addedRefs: string[] = [];
  const appliedTemplates = new Set<string>();

  for (const templateId of templateIds) {
    const template = COMPLETION_TEMPLATES.find((item) => item.id === templateId);
    if (!template) {
      continue;
    }
    let templateAdded = false;
    template.components.forEach((component, index) => {
      if (hasEquivalentComponent(nextPlan, template.id, component)) {
        return;
      }
      nextPlan.components.push(buildCompletionComponent(component, index, template.id));
      addedRefs.push(component.ref);
      templateAdded = true;
    });
    (template.nets ?? []).forEach((netName) => {
      if (!hasNet(nextPlan, netName)) {
        nextPlan.nets.push(buildCompletionNet(netName));
      }
    });
    if (templateAdded) {
      appliedTemplates.add(template.id);
    }
  }

  const effectiveAddedRefs =
    addedRefs.length > 0
      ? addedRefs
      : nextPlan.components
          .filter((item) => item.properties?.generated_by === "rule_completion")
          .map((item) => item.ref)
          .filter((item): item is string => Boolean(item));
  const effectiveTemplates =
    appliedTemplates.size > 0
      ? Array.from(appliedTemplates)
      : Array.from(
          new Set(
            nextPlan.components
              .map((item) => item.properties?.completion_template)
              .filter((item): item is string => Boolean(item))
          )
        );

  return {
    ...nextPlan,
    completionSummary: {
      addedComponentCount: effectiveAddedRefs.length,
      templateIds: effectiveTemplates,
      addedRefs: effectiveAddedRefs,
    },
  };
}
