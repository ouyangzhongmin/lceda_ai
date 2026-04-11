import type { RagSearchResult } from "../../services/rag/ragClient";
import type { DraftPlanGuidance } from "./draftPlan";

function buildHaystack(results: RagSearchResult[]): string {
  return results
    .flatMap((item) => [item.title, item.snippet, item.source_ref])
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
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
