import type { RagSearchResult } from "../../services/rag/ragClient";

export interface RagModuleEvidence {
  title: string;
  sourceRef: string;
  kbType: string;
  score: number;
  module_type: string;
  anchor_component: {
    ref?: string;
    part: string;
    role: string;
  };
  nets: string[];
  pin_bindings: Array<{
    component_role: string;
    pin: string;
    net: string;
  }>;
  connection_chains: Array<{
    from: string;
    via?: string;
    to: string;
    intent: string;
  }>;
  templateType?: string;
  scenarioTags: string[];
  components: Array<{
    ref?: string;
    role: string;
    value?: string;
  }>;
  lcscPartCodes: string[];
  rawPinBindings: string[];
  rawConnectionChains: Array<{
    label?: string;
    nodes: string[];
  }>;
  designUse: string;
}

function splitCsvList(value: string): string[] {
  return value
    .split(/[,;，；]/u)
    .map((item) => item.trim())
    .filter(Boolean);
}

function extractLineValue(snippet: string, label: string): string | undefined {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = snippet.match(new RegExp(`^${escaped}:\\s*(.+)$`, "imu"));
  return match?.[1]?.trim();
}

function uniqueStrings(values: string[]): string[] {
  return values
    .map((value) => value.trim())
    .filter(Boolean)
    .filter((value, index, list) => list.indexOf(value) === index);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
}

function tryParseJsonObject(value: string): Record<string, unknown> | undefined {
  try {
    return asRecord(JSON.parse(value));
  } catch {
    return undefined;
  }
}

function extractEmbeddedStructuredTemplate(item: RagSearchResult): Record<string, unknown> | undefined {
  const metadata = asRecord(item.metadata);
  if (metadata) {
    return metadata;
  }
  const snippet = item.snippet || "";
  const fenced = snippet.match(/```(?:json)?\s*([\s\S]*?)```/iu)?.[1];
  if (fenced) {
    const parsed = tryParseJsonObject(fenced.trim());
    if (parsed) return parsed;
  }
  const firstJson = snippet.match(/\{[\s\S]*\}/u)?.[0];
  return firstJson ? tryParseJsonObject(firstJson) : undefined;
}

function inferModuleType(input: {
  title: string;
  templateType?: string;
  sourceRef: string;
  snippet: string;
}): string {
  const haystack = [input.title, input.templateType, input.sourceRef, input.snippet].join(" ").toLowerCase();
  if (/esp32[-_ ]?s3/.test(haystack) && /(gpio_passive_power_chain|mcu_boot_reset|mcu_power_core|component_combo_bundle|en|io0|vbus|3v3)/i.test(haystack)) {
    return "esp32_s3_minimum_system";
  }
  if (/usb[_ -]?power|usb-c|type-c/.test(haystack)) return "usb_c_power_input";
  if (/battery|charger|charge|ip5306|tp4056|锂电|充电/.test(haystack)) return "battery_charge_power_path";
  if (/i2s|mic|microphone|inmp441|麦克风/.test(haystack)) return "i2s_microphone";
  if (/speaker|amplifier|max98357|ns4168|功放|扬声器/.test(haystack)) return "i2s_audio_amplifier";
  return input.templateType ? input.templateType.replace(/[^a-zA-Z0-9_]+/g, "_") : "reference_subcircuit";
}

function inferAnchorPart(input: { moduleType: string; title: string; sourceRef: string; snippet: string }): string {
  const haystack = [input.title, input.sourceRef, input.snippet].join(" ");
  if (/ESP32-S3-WROOM-1U/i.test(haystack)) return "ESP32-S3-WROOM-1U";
  if (/ESP32-S3-WROOM-1/i.test(haystack)) return "ESP32-S3-WROOM-1";
  if (/ESP32[-_ ]?S3/i.test(haystack)) return "ESP32-S3";
  if (/INMP441/i.test(haystack)) return "INMP441";
  if (/NS4168/i.test(haystack)) return "NS4168";
  if (/MAX98357/i.test(haystack)) return "MAX98357A";
  if (/IP5306/i.test(haystack)) return "IP5306";
  return input.moduleType;
}

function inferAnchorRole(moduleType: string): string {
  if (/esp32.*minimum|mcu/.test(moduleType)) return "mcu_module";
  if (/microphone/.test(moduleType)) return "microphone";
  if (/amplifier/.test(moduleType)) return "audio_amplifier";
  if (/battery|charge/.test(moduleType)) return "charger_powerbank";
  if (/usb/.test(moduleType)) return "usb_c_connector";
  return "module_anchor";
}

function inferComponentRole(refOrValue: string, left?: string, right?: string): string {
  const ref = refOrValue.toUpperCase();
  const from = String(left || "").toUpperCase();
  const to = String(right || "").toUpperCase();
  if (/^C\d+/.test(ref)) return "decoupling_capacitor";
  if (/^R\d+/.test(ref) && from === "EN" && /3V3|VCC|VDD|VBUS|5V/.test(to)) return "en_pullup";
  if (/^R\d+/.test(ref) && from === "IO0" && to === "GND") return "boot_pulldown_or_button_resistor";
  if (/^R\d+/.test(ref) && /EN|RESET|RST/.test(from) && to === "GND") return "reset_or_enable_pulldown";
  if (/^R\d+/.test(ref)) return "bias_resistor";
  if (/^J\d+|USB|TYPE-C/i.test(ref)) return "connector";
  if (/^U\d+/.test(ref)) return "ic";
  if (/^C\d{3,}/.test(ref) || /^C\d+$/i.test(refOrValue)) return "jlc_part_code";
  return "module_component";
}

function inferChainIntent(from: string, via: string | undefined, to: string): string {
  const source = from.toUpperCase();
  const target = to.toUpperCase();
  const middle = String(via || "").toUpperCase();
  if (/^C\d+/.test(middle) && target === "GND") return "decoupling";
  if (source === "EN" && /3V3|VCC|VDD|VBUS|5V/.test(target)) return "enable_pullup";
  if (source === "IO0" && target === "GND") return "boot_strap";
  if (/EN|RESET|RST/.test(source) && target === "GND") return "reset_or_enable_bias";
  if (/VBUS|VDD|VCC|3V3|5V|VBAT/.test(source) || /VBUS|VDD|VCC|3V3|5V|VBAT/.test(target)) return "power_path";
  return "signal_or_reference_chain";
}

function normalizeStructuredConnectionChains(value: unknown): RagModuleEvidence["connection_chains"] {
  if (!Array.isArray(value)) return [];
  const chains: RagModuleEvidence["connection_chains"] = [];
  for (const item of value) {
    const record = asRecord(item);
    if (!record) continue;
    const from = typeof record.from === "string" ? record.from : typeof record.anchor_net === "string" ? record.anchor_net : "";
    const to = typeof record.to === "string" ? record.to : typeof record.to_power_net === "string" ? record.to_power_net : "";
    const via =
      typeof record.via === "string"
        ? record.via
        : Array.isArray(record.passive_refdes) && typeof record.passive_refdes[0] === "string"
          ? record.passive_refdes[0]
          : undefined;
    if (!from || !to) continue;
    chains.push({
      from,
      via,
      to,
      intent: typeof record.intent === "string" ? record.intent : inferChainIntent(from, via, to),
    });
  }
  return chains;
}

function parsePinBindings(rawPinBindings: string[]): RagModuleEvidence["pin_bindings"] {
  const bindings: RagModuleEvidence["pin_bindings"] = [];
  for (const binding of rawPinBindings) {
    const viaMatch = binding.match(/^\s*([A-Z0-9_+.-]+)\s*->\s*([A-Z0-9_+.-]+)(?:\s+via\s+[A-Z0-9_+.-]+)?/iu);
    if (!viaMatch) continue;
    const pin = String(viaMatch[1] || "").trim();
    const net = String(viaMatch[1] || "").trim();
    if (!pin || !net) continue;
    bindings.push({ component_role: "mcu_module", pin, net });
  }
  return bindings.filter(
    (item, index, list) => list.findIndex((other) => other.component_role === item.component_role && other.pin === item.pin && other.net === item.net) === index
  );
}

function buildStructuredComponents(input: {
  rawComponents: string[];
  chains: RagModuleEvidence["connection_chains"];
  lcscPartCodes: string[];
}): RagModuleEvidence["components"] {
  const components: RagModuleEvidence["components"] = [];
  for (const chain of input.chains) {
    if (!chain.via) continue;
    components.push({
      ref: chain.via,
      role: inferComponentRole(chain.via, chain.from, chain.to),
      value: /^C\d{3,}$/i.test(chain.via) ? chain.via : undefined,
    });
  }
  for (const raw of input.rawComponents) {
    if (/^\s*[A-Z0-9_+.-]+\s*->/u.test(raw)) continue;
    if (components.some((item) => item.ref === raw || item.value === raw)) continue;
    components.push({
      ref: /^[A-Z]+\d+$/iu.test(raw) ? raw : undefined,
      role: inferComponentRole(raw),
      value: /^[A-Z]+\d+$/iu.test(raw) ? undefined : raw,
    });
  }
  for (const code of input.lcscPartCodes) {
    if (components.some((item) => item.value === code)) continue;
    components.push({ role: "jlc_part_code", value: code });
  }
  return components;
}

function inferDesignUse(input: {
  templateType?: string;
  scenarioTags: string[];
  pinBindings: string[];
  connectionChains: Array<{ nodes: string[] }>;
}): string {
  const haystack = [
    input.templateType,
    ...input.scenarioTags,
    ...input.pinBindings,
    ...input.connectionChains.flatMap((item) => item.nodes),
  ]
    .filter(Boolean)
    .join(" ")
    .toUpperCase();
  const uses: string[] = [];
  if (/VBUS|VDD|VCC|3V3|5V|POWER|DECOUP|C\d+/.test(haystack)) {
    uses.push("power decoupling / supply filtering");
  }
  if (/EN|RESET|RST/.test(haystack)) {
    uses.push("reset or enable bias network");
  }
  if (/IO0|BOOT/.test(haystack)) {
    uses.push("boot strap / download mode network");
  }
  if (/I2S|MIC|SPEAKER|AUDIO/.test(haystack)) {
    uses.push("audio interface support");
  }
  if (uses.length === 0) {
    uses.push("reference sub-circuit module");
  }
  return uses.join("; ");
}

export function buildRagModuleEvidence(results: RagSearchResult[]): RagModuleEvidence[] {
  return results.slice(0, 5).map((item) => {
    const snippet = item.snippet || "";
    const structured = extractEmbeddedStructuredTemplate(item);
    const templateType = extractLineValue(snippet, "Template type");
    const scenarioTags = splitCsvList(extractLineValue(snippet, "Scenario tags") || "");
    const rawComponents = splitCsvList(extractLineValue(snippet, "Components") || "");
    const lcscPartCodes = splitCsvList(extractLineValue(snippet, "LCSC part codes") || "");
    const rawPinBindings = splitCsvList(extractLineValue(snippet, "Pin bindings") || "");
    const rawConnectionChains = Array.from(
      snippet.matchAll(/(?:^|\n)\s*-\s*([^:\n]+):\s*([^\n]+?)(?=\n|$)/gu)
    )
      .map((match) => ({
        label: match[1]?.trim(),
        nodes: String(match[2] || "")
          .split(/\s*->\s*/u)
          .map((node) => node.trim())
          .filter(Boolean),
      }))
      .filter((chain) => chain.nodes.length >= 2);
    const moduleType =
      typeof structured?.module_type === "string"
        ? structured.module_type
        : inferModuleType({
            title: item.title,
            templateType: typeof structured?.template_type === "string" ? structured.template_type : templateType,
            sourceRef: item.source_ref,
            snippet,
          });
    const anchorComponentRecord = asRecord(structured?.anchor_component);
    const anchor_component = {
      ref: typeof anchorComponentRecord?.ref === "string" ? anchorComponentRecord.ref : undefined,
      part:
        typeof anchorComponentRecord?.part === "string"
          ? anchorComponentRecord.part
          : inferAnchorPart({ moduleType, title: item.title, sourceRef: item.source_ref, snippet }),
      role:
        typeof anchorComponentRecord?.role === "string"
          ? anchorComponentRecord.role
          : inferAnchorRole(moduleType),
    };
    const structuredChains = normalizeStructuredConnectionChains(
      structured?.connection_chains ??
        asRecord(structured?.default_values)?.connection_chains ??
        asRecord(structured?.quality_detail)?.connection_chains
    );
    const connection_chains =
      structuredChains.length > 0
        ? structuredChains
        : rawConnectionChains
            .map((chain) => ({
              from: chain.nodes[0] || "",
              via: chain.nodes.length > 2 ? chain.nodes[1] : undefined,
              to: chain.nodes[chain.nodes.length - 1] || "",
              intent: inferChainIntent(chain.nodes[0] || "", chain.nodes.length > 2 ? chain.nodes[1] : undefined, chain.nodes[chain.nodes.length - 1] || ""),
            }))
            .filter((chain) => chain.from && chain.to);
    const nets = uniqueStrings(connection_chains.flatMap((chain) => [chain.from, chain.to]));
    const pin_bindings = parsePinBindings(rawPinBindings);
    const components = buildStructuredComponents({
      rawComponents,
      chains: connection_chains,
      lcscPartCodes,
    });

    const evidence: RagModuleEvidence = {
      title: item.title,
      sourceRef: item.source_ref,
      kbType: item.kb_type,
      score: item.score,
      module_type: moduleType,
      anchor_component,
      nets,
      pin_bindings,
      connection_chains,
      templateType,
      scenarioTags,
      components,
      lcscPartCodes,
      rawPinBindings,
      rawConnectionChains,
      designUse: inferDesignUse({
        templateType,
        scenarioTags,
        pinBindings: rawPinBindings,
        connectionChains: rawConnectionChains,
      }),
    };
    return evidence;
  });
}

export function formatRagModuleEvidenceForModel(results: RagSearchResult[]): string {
  const modules = buildRagModuleEvidence(results);
  if (modules.length === 0) {
    return "";
  }
  return JSON.stringify(
    {
      instruction:
        "Use these structured RAG module evidences as reusable schematic sub-circuits. Compose the final DraftDesignSpec by selecting relevant modules by module_type, preserving anchor_component/components/nets/connection_chains/pin_bindings as concrete constraints, adding missing modules from the user request, and translating each chain into DraftDesignSpec components, pins, nets, and connections. Do not copy unrelated modules blindly.",
      modules,
    },
    null,
    2
  );
}
