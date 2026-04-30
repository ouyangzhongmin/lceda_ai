import type { RagSearchResult } from "../../services/rag/ragClient";
import type { DraftPlanGuidance } from "./draftPlan";

function buildHaystack(results: RagSearchResult[]): string {
  return results
    .flatMap((item) => [item.title, item.snippet, item.source_ref])
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function uniqueStrings(values: string[]): string[] {
  return values
    .map((value) => value.trim())
    .filter(Boolean)
    .filter((value, index, list) => list.indexOf(value) === index);
}

function addTemplateConnection(
  connections: NonNullable<DraftPlanGuidance["requiredConnections"]>,
  fromComponentRef: string,
  fromPin: string,
  toComponentRef: string,
  toPin: string,
  netName: string
): void {
  const candidate = { fromComponentRef, fromPin, toComponentRef, toPin, netName };
  const key = `${fromComponentRef}.${fromPin}|${toComponentRef}.${toPin}|${netName}`;
  if (
    !connections.some(
      (item) => `${item.fromComponentRef}.${item.fromPin}|${item.toComponentRef}.${item.toPin}|${item.netName}` === key
    )
  ) {
    connections.push(candidate);
  }
}

function extractPassiveChainGuidance(results: RagSearchResult[]): NonNullable<DraftPlanGuidance["requiredConnections"]> {
  const connections: NonNullable<DraftPlanGuidance["requiredConnections"]> = [];
  for (const result of results) {
    const text = `${result.title || ""}\n${result.snippet || ""}`;
    const chainMatches = text.matchAll(/(?:^|\n)\s*-\s*[^:\n]+:\s*([A-Z0-9_+.-]+)\s*->\s*([A-Z]+\d+)\s*->\s*([A-Z0-9_+.-]+)/giu);
    for (const match of chainMatches) {
      const leftNet = String(match[1] || "").toUpperCase();
      const componentRef = String(match[2] || "").toUpperCase();
      const rightNet = String(match[3] || "").toUpperCase();
      if (!leftNet || !componentRef || !rightNet) continue;
      addTemplateConnection(connections, leftNet, leftNet, componentRef, "1", leftNet);
      addTemplateConnection(connections, componentRef, "2", rightNet, rightNet, rightNet);
    }
  }
  return connections;
}

export function buildDraftGuidanceFromRag(
  userQuery: string,
  results: RagSearchResult[]
): DraftPlanGuidance | undefined {
  const normalizedQuery = userQuery.toLowerCase();
  const haystack = buildHaystack(results);
  const looksLikeLedIndicator =
    /led|发光二极管|点亮|指示灯/u.test(userQuery) &&
    !/ldo|稳压|regulator|3\.3v|3v3/u.test(userQuery);

  const evidence = results.slice(0, 3).map((item) => ({
    title: item.title,
    snippet: item.snippet,
    sourceRef: item.source_ref,
  }));

  const looksLikeEsp32S3Voice =
    /(esp32-s3|esp32 s3|esp32s3)/iu.test(userQuery) &&
    /(小智|语音|聊天|voice|chat|mic|microphone|麦克风|音频|功放|speaker|扬声器)/iu.test(userQuery);
  const wantsBatteryCharging = /(锂电|电池|充电|battery|charger|charge|ip5306|tp4056)/iu.test(userQuery);

  if (looksLikeEsp32S3Voice) {
    const requiredConnections = extractPassiveChainGuidance(results);
    if (!requiredConnections.some((item) => item.netName === "EN")) {
      addTemplateConnection(requiredConnections, "U1", "EN", "R_EN", "1", "EN");
      addTemplateConnection(requiredConnections, "R_EN", "2", "3V3", "3V3", "3V3");
    }
    if (!requiredConnections.some((item) => item.netName === "IO0")) {
      addTemplateConnection(requiredConnections, "U1", "IO0", "R_BOOT", "1", "IO0");
      addTemplateConnection(requiredConnections, "R_BOOT", "2", "GND", "GND", "GND");
    }

    return {
      templateId: wantsBatteryCharging ? "esp32_s3_voice_battery_assistant" : "esp32_s3_voice_assistant",
      rationale:
        "依据 ESP32-S3 语音设备相关模板，将 RAG 命中的去耦、EN/IO0 偏置链路转成草案约束；同时补齐语音设备必须具备的电源管理、I2S 麦克风和音频输出检索目标。",
      evidence,
      preferredSearches: {
        mcu: "ESP32-S3-WROOM-1 ESP32-S3 module",
        charger_powerbank: wantsBatteryCharging
          ? "IP5306 lithium battery charge boost power management"
          : "5V to 3.3V power management",
        usb_c_connector: "USB Type-C 16P female connector",
        battery_connector: "JST PH 2P battery connector",
        ldo_regulator: "3.3V LDO regulator 500mA",
        microphone: "INMP441 I2S MEMS microphone",
        audio_amplifier: /(ns4168|NS4168)/u.test(haystack)
          ? "NS4168 I2S audio amplifier"
          : "MAX98357A NS4168 I2S audio amplifier",
        speaker_connector: "speaker connector 2pin 4ohm",
        decoupling_capacitor: /(C25744|C25794|0\.1u|100n)/iu.test(haystack)
          ? "0.1uF capacitor 0603"
          : "0.1uF capacitor 0603",
        boot_resistor: "10k resistor 0603",
      },
      requiredNets: uniqueStrings([
        "VBUS",
        ...(wantsBatteryCharging ? ["VBAT"] : []),
        "5V",
        "3V3",
        "GND",
        "EN",
        "IO0",
        "I2S_SCK",
        "I2S_LRCK",
        "I2S_SD",
        "I2S_DOUT",
        "SPK_P",
        "SPK_N",
      ]),
      requiredConnections,
    };
  }

  if (looksLikeLedIndicator) {
    const prefersTwoPinHeader = /(2pin|1x2|两针|2 针|2pin header)/i.test(haystack) || results.length === 0;
    const prefersRedLed = /(red|红色)/i.test(haystack) || results.length === 0;
    const resistorHint = /(150\s*(ω|ohm)|限流电阻.*150)/i.test(haystack) ? "150Ω resistor R0805" : "150Ω resistor R0805";

    return {
      templateId: "led_indicator_minimal",
      rationale: "依据知识库检索结果，建议使用最小 LED 指示灯拓扑：电源接口 + 限流电阻 + LED。",
      evidence,
      preferredSearches: {
        power_connector: prefersTwoPinHeader ? "header 1x2 2pin HDR-TH_1X2" : "power connector 2pin",
        resistor: resistorHint,
        led: prefersRedLed ? "red LED 3mm through hole" : "LED through hole",
      },
      requiredNets: ["5V", "LED_ANODE", "GND"],
      requiredConnections: [
        { fromComponentRef: "J1", fromPin: "1", toComponentRef: "R1", toPin: "1", netName: "5V" },
        { fromComponentRef: "R1", fromPin: "2", toComponentRef: "D1", toPin: "1", netName: "LED_ANODE" },
        { fromComponentRef: "D1", fromPin: "2", toComponentRef: "J1", toPin: "2", netName: "GND" },
      ],
    };
  }

  if (/ldo|稳压|3\.3v|3v3/u.test(userQuery)) {
    return {
      templateId: "ldo_minimal",
      rationale: "依据知识库检索结果，建议采用最小 LDO 拓扑，并配置输入/输出电容。",
      evidence,
      preferredSearches: {
        ldo_regulator: "ldo regulator 3.3V",
        input_capacitor: "10uF capacitor 0603",
        output_capacitor: "10uF capacitor 0603",
      },
      requiredNets: ["5V", "3V3", "GND"],
    };
  }

  if (normalizedQuery.trim()) {
    return {
      templateId: "generic",
      rationale: "已检索到知识依据，但未匹配到专用草案模板，回退到通用草案生成。",
      evidence,
    };
  }

  return undefined;
}
