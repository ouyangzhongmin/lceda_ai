import type { SchematicComponent, SchematicContext, SchematicNet, SchematicPin } from "../../types/schematic";
import type { AgentTool } from "./toolRegistry";

export interface SchematicBomSummary {
  componentCount: number;
  categories: Array<{
    category: string;
    count: number;
    examples: string[];
  }>;
}

export interface SchematicKeyComponentsSummary {
  keyComponents: Array<{
    ref: string;
    label: string;
    reason: string;
  }>;
}

export interface SchematicFunctionalBlocksSummary {
  functionalBlocks: Array<{
    name: string;
    evidence: string[];
    netHints: string[];
  }>;
}

export interface SchematicPowerDomainsSummary {
  powerDomains: Array<{
    name: string;
    nodeCount: number;
    attachedComponents: string[];
  }>;
}

export interface SchematicConnectivitySummary {
  netCount: number;
  selectionCount: number;
  connectivityNotes: string[];
}

export interface SchematicNetlistReviewSummary {
  stats: {
    componentCount: number;
    pinCount: number;
    pinsWithNetName: number;
    pinsNoConnect: number;
    uniqueNetNameCount: number;
  };
  notes: string[];
  keyComponents: Array<{
    ref: string;
    label: string;
    pins: Array<{
      pin: string;
      name?: string;
      electricalType?: string;
      net?: string;
      noConnect?: boolean;
    }>;
  }>;
  networks: Array<{
    networkName: string;
    isPower: boolean;
    pinCount: number;
    connectedPinRefs: string[];
  }>;
  omittedNetworksCount: number;
}

export interface SchematicPowerPathSummary {
  paths: Array<{
    sourceNet: string;
    path: string[];
    note: string;
  }>;
}

export interface SchematicSignalPathSummary {
  paths: Array<{
    block: string;
    path: string[];
    note: string;
  }>;
}

export interface SchematicControlPathSummary {
  paths: Array<{
    controller: string;
    target: string;
    path: string[];
    note: string;
  }>;
}

export interface SchematicAnalysisEvidence {
  project: {
    pageName?: string;
    projectId?: string;
    pageId?: string;
    channel: string;
  };
  stats: {
    componentCount: number;
    netCount: number;
    pinCount: number;
    selectionCount: number;
  };
  keyComponents: Array<{
    ref: string;
    name?: string;
    value?: string;
    packageName?: string;
    category: string;
    reasons: string[];
    pins: Array<{
      pin: string;
      net?: string;
      electricalType?: string;
    }>;
  }>;
  representativeNets: Array<{
    name: string;
    isPower: boolean;
    members: string[];
  }>;
  notableComponents: Array<{
    label: string;
    category: string;
    nets: string[];
  }>;
}

export function createSchematicSummaryTools(): AgentTool[] {
  return [
    {
      name: "schematic_review",
      description: "基于 pin.netName 构建网表级连接证据（networks->connectedPinRefs）用于分析提示",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false,
        description: "上下文由宿主自动注入，无需手动传 context。",
      },
      riskLevel: "low",
      execute: async (input: { context: SchematicContext }) => reviewNetlist(input.context),
    },
    {
      name: "schematic_summarize_bom",
      description: "基于当前上下文汇总原理图 BOM 分类",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false,
        description: "上下文由宿主自动注入，无需手动传 context。",
      },
      riskLevel: "low",
      execute: async (input: { context: SchematicContext }) => summarizeBom(input.context),
    },
    {
      name: "schematic_identify_key_components",
      description: "识别主控、电源、接口、传感器等关键器件",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false,
        description: "上下文由宿主自动注入，无需手动传 context。",
      },
      riskLevel: "low",
      execute: async (input: { context: SchematicContext }) => identifyKeyComponentsSummary(input.context),
    },
    {
      name: "schematic_identify_functional_blocks",
      description: "从原理图上下文中识别功能模块及代表证据",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false,
        description: "上下文由宿主自动注入，无需手动传 context。",
      },
      riskLevel: "low",
      execute: async (input: { context: SchematicContext }) => identifyFunctionalBlocksSummary(input.context),
    },
    {
      name: "schematic_identify_power_domains",
      description: "识别主要电源域及其关联器件",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false,
        description: "上下文由宿主自动注入，无需手动传 context。",
      },
      riskLevel: "low",
      execute: async (input: { context: SchematicContext }) => identifyPowerDomainsSummary(input.context),
    },
    {
      name: "schematic_summarize_connectivity",
      description: "汇总整张原理图的连接性与网络分布",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false,
        description: "上下文由宿主自动注入，无需手动传 context。",
      },
      riskLevel: "low",
      execute: async (input: { context: SchematicContext }) => summarizeConnectivity(input.context),
    },
    {
      name: "schematic_trace_power_paths",
      description: "追踪从电源网络到关键器件的主要电源路径",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false,
        description: "上下文由宿主自动注入，无需手动传 context。",
      },
      riskLevel: "low",
      execute: async (input: { context: SchematicContext }) => tracePowerPaths(input.context),
    },
    {
      name: "schematic_trace_signal_paths",
      description: "追踪关键功能模块的代表性信号路径",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false,
        description: "上下文由宿主自动注入，无需手动传 context。",
      },
      riskLevel: "low",
      execute: async (input: { context: SchematicContext }) => traceSignalPaths(input.context),
    },
    {
      name: "schematic_trace_control_paths",
      description: "追踪从主控到主要外设的控制链路",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false,
        description: "上下文由宿主自动注入，无需手动传 context。",
      },
      riskLevel: "low",
      execute: async (input: { context: SchematicContext }) => traceControlPaths(input.context),
    },
    {
      name: "schematic_build_analysis_evidence",
      description: "构建适合分析的原理图证据，输出人类可读的器件、网络与引脚映射",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false,
        description: "上下文由宿主自动注入，无需手动传 context。",
      },
      riskLevel: "low",
      execute: async (input: { context: SchematicContext }) => buildAnalysisEvidence(input.context),
    },
  ];
}

export function reviewNetlist(context: SchematicContext): SchematicNetlistReviewSummary {
  const componentById = new Map(context.components.map((component) => [component.id, component]));
  const pinsByComponentId = new Map<string, SchematicPin[]>();
  for (const pin of context.pins) {
    const arr = pinsByComponentId.get(pin.componentId) ?? [];
    arr.push(pin);
    pinsByComponentId.set(pin.componentId, arr);
  }

  let pinsWithNetName = 0;
  let pinsNoConnect = 0;
  const pinsByNetName = new Map<string, SchematicPin[]>();
  for (const pin of context.pins) {
    if (pin.noConnected) {
      pinsNoConnect += 1;
      continue;
    }
    const name = String(pin.netName || "").trim();
    if (!name) continue;
    pinsWithNetName += 1;
    const bucket = pinsByNetName.get(name) ?? [];
    bucket.push(pin);
    pinsByNetName.set(name, bucket);
  }

  const netEntries = Array.from(pinsByNetName.entries()).map(([networkName, pins]) => {
    const refs: string[] = [];
    const seen = new Set<string>();
    for (const pin of pins) {
      const comp = componentById.get(pin.componentId);
      const compRef = comp ? String(comp.ref || "").trim() : "";
      const compLabel = compRef && !looksLikeOpaqueId(compRef) ? compRef : safeComponentRef(comp || ({ id: pin.componentId, properties: {} } as SchematicComponent));
      const pinId = String(pin.pinNumber || pin.pinName || "").trim();
      const pinLabel = pinId || "?";
      const ref = `${compLabel}.${pinLabel}`;
      if (seen.has(ref)) continue;
      seen.add(ref);
      refs.push(ref);
    }
    refs.sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
    const isPower = isPowerNetName(networkName);
    return {
      networkName,
      isPower,
      pinCount: refs.length,
      connectedPinRefs: refs,
    };
  });

  const scoreNet = (entry: { networkName: string; isPower: boolean; pinCount: number }) => {
    const raw = normalizeNetName(entry.networkName);
    let score = 0;
    if (/^(GND|AGND|DGND)(_|$|\d)/.test(raw)) score += 10_000;
    if (/^(3V3|5V|1V8|VBUS|VBAT|VIN|VOUT|VCC|AVDD|DVDD|VSYS|SYS)(_|$|\d)/.test(raw)) score += 9_000;
    if (/USB_(DP|DM)$/.test(raw) || /(^|_)D(P|M)$/.test(raw)) score += 8_500;
    if (/UART_(TX|RX)$/.test(raw) || /(^|_)T(X|XD|X D)$/.test(raw) || /(^|_)R(X|XD|X D)$/.test(raw)) score += 8_000;
    if (/^(EN|RST|RESET|BOOT|IO0)(_|$|\d)/.test(raw)) score += 6_000;
    score += entry.isPower ? 500 : 0;
    score += Math.min(600, entry.pinCount * 20);
    return score;
  };

  const sorted = netEntries.sort((a, b) => scoreNet(b) - scoreNet(a));
  const picked = sorted.slice(0, 28).map((entry) => ({
    ...entry,
    connectedPinRefs: entry.connectedPinRefs.slice(0, 36),
  }));

  const keyRefs = new Set(
    identifyKeyComponentsSummary(context).keyComponents
      .map((item) => String(item.ref || "").trim())
      .filter(Boolean)
  );
  const keyComponents = context.components
    .filter((component) => {
      const ref = String(component.ref || "").trim();
      return ref && keyRefs.has(ref);
    })
    .slice(0, 8)
    .map((component) => {
      const pins = (pinsByComponentId.get(component.id) ?? [])
        .slice()
        .sort((a, b) => String(a.pinNumber || "").localeCompare(String(b.pinNumber || "")))
        .slice(0, 48)
        .map((pin) => ({
          pin: String(pin.pinNumber || "").trim() || "?",
          name: String(pin.pinName || "").trim() || undefined,
          electricalType: String(pin.electricalType || "").trim() || undefined,
          net: String(pin.netName || "").trim() || undefined,
          noConnect: Boolean(pin.noConnected) || undefined,
        }));
      return {
        ref: safeComponentRef(component),
        label: formatComponentDescriptor(component) || safeComponentRef(component),
        pins,
      };
    });

  const notes: string[] = [];
  notes.push("网表证据说明：本工具基于 pin.netName 推断网络成员，无法覆盖复用块/隐藏线/跨页等宿主未暴露连接。");
  if (pinsWithNetName === 0 && context.pins.length > 0) {
    notes.push("提示：所有引脚 netName 为空，无法生成有效网表证据；请优先检查宿主上下文映射。");
  }
  if (keyComponents.length === 0) {
    notes.push("提示：未识别到可稳定引用的关键器件位号，关键器件引脚证据可能不足。");
  }

  return {
    stats: {
      componentCount: context.components.length,
      pinCount: context.pins.length,
      pinsWithNetName,
      pinsNoConnect,
      uniqueNetNameCount: pinsByNetName.size,
    },
    notes: notes.slice(0, 6),
    keyComponents,
    networks: picked,
    omittedNetworksCount: Math.max(0, netEntries.length - picked.length),
  };
}

export function summarizeBom(context: SchematicContext): SchematicBomSummary {
  const counters = new Map<string, { count: number; examples: string[] }>();
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
    categories: Array.from(counters.entries())
      .map(([category, data]) => ({
        category,
        count: data.count,
        examples: data.examples,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8),
  };
}

export function identifyKeyComponentsSummary(context: SchematicContext): SchematicKeyComponentsSummary {
  return {
    keyComponents: context.components
      .map((component) => {
        const score = scoreKeyComponent(component);
        return {
          component,
          score: score.score,
          reason: score.reason,
        };
      })
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 6)
      .map((item) => ({
        ref: safeComponentRef(item.component),
        label: formatComponentDescriptor(item.component),
        reason: item.reason,
      })),
  };
}

export function identifyFunctionalBlocksSummary(context: SchematicContext): SchematicFunctionalBlocksSummary {
  const pinById = new Map(context.pins.map((pin) => [pin.id, pin]));
  const netHintsByComponent = buildNetHintsByComponent(context.nets, pinById);
  const blockKeywords: Array<{ name: string; patterns: RegExp[] }> = [
    { name: "主控与计算", patterns: [/esp32|stm32|mcu|soc|processor|cpu/i] },
    { name: "电源管理", patterns: [/ldo|buck|boost|charger|pmic|battery|tp4056|ry3715|me6211/i] },
    { name: "USB与通信", patterns: [/usb|uart|serial|ch340|cp210|type-c|connector/i] },
    { name: "音频链路", patterns: [/audio|codec|mic|speaker|amp|es8311|max98357|i2s/i] },
    { name: "传感与输入", patterns: [/sensor|hall|imu|touch|key|button|switch/i] },
    { name: "显示与指示", patterns: [/led|display|screen|rgb|indicator/i] },
  ];

  return {
    functionalBlocks: blockKeywords
      .map((block) => {
        const matches = context.components.filter((component) =>
          block.patterns.some((pattern) => pattern.test(buildSearchText(component)))
        );
        const netHints = Array.from(
          new Set(
            matches.flatMap((component) => netHintsByComponent.get(component.id) ?? [])
          )
        ).slice(0, 5);
        return {
          name: block.name,
          evidence: matches.slice(0, 4).map((component) => formatComponentLabel(component)),
          netHints,
        };
      })
      .filter((block) => block.evidence.length > 0),
  };
}

export function identifyPowerDomainsSummary(context: SchematicContext): SchematicPowerDomainsSummary {
  const componentById = new Map(context.components.map((component) => [component.id, component]));
  return {
    powerDomains: context.nets
      .filter((net) => net.isPower || isLikelyPowerNet(net))
      .map((net) => ({
        name: net.name || net.id,
        nodeCount: getPinsOnNet(context, net).length,
        attachedComponents: Array.from(
          new Set(
            getPinsOnNet(context, net)
              .map((pin) => componentById.get(pin.componentId))
              .filter(Boolean)
              .map((component) => formatComponentLabel(component!))
          )
        ).slice(0, 6),
      }))
      .filter((item) => item.nodeCount > 0)
      .sort((a, b) => b.nodeCount - a.nodeCount)
      .slice(0, 6),
  };
}

export function summarizeConnectivity(context: SchematicContext): SchematicConnectivitySummary {
  const pinCountByNetId = new Map<string, number>();
  context.nets.forEach((net) => {
    pinCountByNetId.set(net.id, getPinsOnNet(context, net).length);
  });
  const zeroNodeNets = context.nets.filter((net) => (pinCountByNetId.get(net.id) ?? 0) === 0).length;
  const isolatedNets = context.nets.filter((net) => (pinCountByNetId.get(net.id) ?? 0) === 1).length;
  const twoNodeNets = context.nets.filter((net) => (pinCountByNetId.get(net.id) ?? 0) === 2).length;
  const multiNodeNets = context.nets.filter((net) => (pinCountByNetId.get(net.id) ?? 0) >= 3).length;

  const powerNets = context.nets.filter((net) => net.isPower || isLikelyPowerNet(net)).length;
  const largeSignalNets = context.nets.filter(
    (net) => (pinCountByNetId.get(net.id) ?? 0) >= 4 && !(net.isPower || isLikelyPowerNet(net))
  ).length;

  // Best-effort diagnostics: detect when net.nodeIds do not match pin ids (common in host adapters).
  const pinById = new Map(context.pins.map((pin) => [pin.id, pin]));
  let totalNodeIds = 0;
  let matchedNodeIds = 0;
  context.nets.forEach((net) => {
    totalNodeIds += net.nodeIds.length;
    net.nodeIds.forEach((id) => {
      if (pinById.has(id)) matchedNodeIds += 1;
    });
  });
  const mappingWeak = totalNodeIds > 0 && matchedNodeIds / totalNodeIds < 0.3;
  const hasNetNameMapping = context.pins.some((pin) => Boolean(String(pin.netName || "").trim()));

  // If host net mapping is completely missing, fall back to pin.netName grouping for a coarse distribution.
  // This is less precise than explicit net objects but avoids reporting "all nets are 0 nodes".
  let fallbackDist: { namedNetCount: number; isolated: number; twoNode: number; multiNode: number } | null = null;
  if (zeroNodeNets === context.nets.length && hasNetNameMapping) {
    const counts = new Map<string, number>();
    for (const pin of context.pins) {
      const name = String(pin.netName || "").trim();
      if (!name) continue;
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    const values = Array.from(counts.values());
    const isolated = values.filter((n) => n === 1).length;
    const twoNode = values.filter((n) => n === 2).length;
    const multiNode = values.filter((n) => n >= 3).length;
    fallbackDist = { namedNetCount: counts.size, isolated, twoNode, multiNode };
  }

  const notes: string[] = [
    fallbackDist
      ? `网络规模分布(基于 pin.netName 推断)：网络 ${fallbackDist.namedNetCount} 条，单节点 ${fallbackDist.isolated} 条，双节点 ${fallbackDist.twoNode} 条，多节点(>=3) ${fallbackDist.multiNode} 条。`
      : `网络规模分布：0节点(无法解析) ${zeroNodeNets} 条，单节点 ${isolatedNets} 条，双节点 ${twoNodeNets} 条，多节点(>=3) ${multiNodeNets} 条。`,
    `检测到 ${powerNets} 条电源域相关网络。`,
    fallbackDist
      ? (fallbackDist.isolated > 0 ? `有 ${fallbackDist.isolated} 条网络仅连接 1 个节点，可能需要进一步确认是否悬空。` : "未发现明显孤立网络。")
      : (isolatedNets > 0 ? `有 ${isolatedNets} 条网络仅连接 1 个节点，可能需要进一步确认是否悬空。` : "未发现明显孤立网络。"),
    largeSignalNets > 0 ? `有 ${largeSignalNets} 条多节点信号网络，存在总线或复用连接。` : "多节点信号网络较少，连接关系相对集中。",
    mappingWeak ? "提示：当前上下文的 net.nodeIds 与 pin.id 映射可能不完整，网络成员统计可能偏保守。" : "",
    zeroNodeNets > 0 && !fallbackDist ? "提示：存在 0 节点网络，通常意味着 host 上下文未能提供足够的 net->pin 映射；请优先修复上下文映射后再解读连接性统计。" : "",
  ].filter(Boolean);

  // Power-path evidence (graph traversal). Keep it conservative: only traverse through power-transfer components
  // and only across power-like nets.
  notes.push(...buildPowerPathEvidenceNotes(context, pinCountByNetId));

  return {
    netCount: context.nets.length,
    selectionCount: context.selection.objectIds.length,
    connectivityNotes: notes.slice(0, 8),
  };
}

function buildPowerPathEvidenceNotes(
  context: SchematicContext,
  pinCountByNetId: Map<string, number>
): string[] {
  const notes: string[] = [];
  const netById = new Map(context.nets.map((net) => [net.id, net]));
  const componentById = new Map(context.components.map((component) => [component.id, component]));

  const netToComponents = new Map<string, Set<string>>();
  const componentToNets = new Map<string, Set<string>>();
  context.nets.forEach((net) => {
    const pins = getPinsOnNet(context, net);
    pins.forEach((pin) => {
      const set = netToComponents.get(net.id) ?? new Set<string>();
      set.add(pin.componentId);
      netToComponents.set(net.id, set);

      const nets = componentToNets.get(pin.componentId) ?? new Set<string>();
      nets.add(net.id);
      componentToNets.set(pin.componentId, nets);
    });
  });

  const pickNet = (pattern: RegExp): string | undefined => {
    const candidates = context.nets
      .filter((net) => pattern.test(String(net.name || net.id || "")))
      .map((net) => ({
        id: net.id,
        score:
          (net.isPower || isLikelyPowerNet(net) ? 1000 : 0) +
          (pinCountByNetId.get(net.id) ?? 0),
      }))
      .sort((a, b) => b.score - a.score);
    return candidates[0]?.id;
  };

  const gndId = pickNet(/(^|[_-])gnd([_-]|$)/i) ?? pickNet(/^gnd$/i);
  const v3Id = pickNet(/3v3|vcc3\.?3|vdd3\.?3/i);
  const v5Id = pickNet(/vb?us|vcc_?5v|usb_?5v|5v(_|$)|5v_in/i);
  const batId = pickNet(/\bbat\+?\b|vbat|battery/i);

  const netName = (netId: string | undefined): string => {
    if (!netId) return "";
    const net = netById.get(netId);
    return String(net?.name || net?.id || "").trim();
  };

  if (!gndId) {
    notes.push("电源连通性提示：未识别到明确的 GND 网络名（可能命名不同或映射不完整）。");
  }
  if (!v3Id) {
    notes.push("电源连通性提示：未识别到明确的 3V3/VCC3.3 电源网络名（可能命名不同或映射不完整）。");
  }

  const findPath = (sourceNetId: string, targetNetId: string): string[] | null => {
    const visitedNets = new Set<string>([sourceNetId]);
    const queue: Array<{ netId: string; chain: string[] }> = [
      { netId: sourceNetId, chain: [netName(sourceNetId) || sourceNetId] },
    ];

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (current.netId === targetNetId) return current.chain;

      const comps = netToComponents.get(current.netId);
      if (!comps) continue;
      for (const compId of comps) {
        const comp = componentById.get(compId);
        if (!comp) continue;
        if (!isPowerTransferComponent(comp)) continue;

        const nets = componentToNets.get(compId);
        if (!nets) continue;
        for (const nextNetId of nets) {
          if (visitedNets.has(nextNetId)) continue;
          if (nextNetId !== targetNetId) {
            const nextNet = netById.get(nextNetId);
            if (!(nextNet && (nextNet.isPower || isLikelyPowerNet(nextNet)))) {
              continue;
            }
          }
          visitedNets.add(nextNetId);
          queue.push({
            netId: nextNetId,
            chain: [
              ...current.chain,
              formatComponentLabel(comp),
              netName(nextNetId) || nextNetId,
            ],
          });
        }
      }
      if (visitedNets.size > 200) break;
    }
    return null;
  };

  const pushPathNote = (label: string, sourceId?: string, targetId?: string) => {
    if (!sourceId || !targetId) return;
    const chain = findPath(sourceId, targetId);
    if (chain && chain.length >= 3) {
      notes.push(`${label}：${chain.join(" -> ")}`);
    } else {
      notes.push(
        `${label}：未找到从 ${netName(sourceId) || "源网络"} 到 ${netName(targetId) || "目标网络"} 的可解释电源路径（仅穿越二极管/MOSFET/LDO/BUCK/BOOST/电感/开关等器件）。可能需要人工确认或检查上下文映射完整性。`
      );
    }
  };

  // Prefer showing at most 2 paths to avoid noise.
  pushPathNote("电源路径证据(5V->3V3)", v5Id, v3Id);
  pushPathNote("电源路径证据(BAT->5V)", batId, v5Id);

  return notes.filter(Boolean).slice(0, 3);
}

function isPowerTransferComponent(component: SchematicComponent): boolean {
  const text = [
    component.ref,
    component.name,
    component.value,
    component.packageName,
    component.libraryId,
    ...Object.values(component.properties || {}),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (!text) return false;
  if (/tp4056|me6211|ry3715|ldo|buck|boost|pmic|charger|regulator/.test(text)) return true;
  if (/mosfet|si2301|ao\d+|irf|transistor/.test(text) && /\bq\d+\b/.test((component.ref || "").toLowerCase())) return true;
  if (/diode|schottky|tvs/.test(text) || /\bd\d+\b/.test((component.ref || "").toLowerCase())) return true;
  if (/inductor/.test(text) || /\bl\d+\b/.test((component.ref || "").toLowerCase())) return true;
  if (/switch|button|key/.test(text) || /\bsw\d+\b/.test((component.ref || "").toLowerCase())) return true;
  return false;
}

export function tracePowerPaths(context: SchematicContext): SchematicPowerPathSummary {
  const componentById = new Map(context.components.map((component) => [component.id, component]));
  const adjacency = buildComponentAdjacency(context);
  const keyComponents = identifyKeyComponentsSummary(context).keyComponents
    .map((item) => context.components.find((component) => (component.ref || component.id) === item.ref))
    .filter(Boolean) as SchematicComponent[];
  const allPowerNets = context.nets.filter((net) => net.isPower || isLikelyPowerNet(net)).slice(0, 6);
  return {
    paths: allPowerNets.map((net) => {
        const attachedComponents = getComponentsOnNet(context, net, componentById);
        const target = attachedComponents.find((component) => keyComponents.some((item) => item.id === component.id));
        const traversed = target
          ? traceComponentPath(context, adjacency, attachedComponents[0]?.id, target.id, componentById, 4, "power")
          : attachedComponents.slice(0, 4).map((component) => formatComponentLabel(component));
        const criticalLoads = attachedComponents
          .filter((component) => keyComponents.some((item) => item.id === component.id))
          .slice(0, 3)
          .map((component) => formatComponentLabel(component));
        return {
          sourceNet: net.name || net.id,
          path: [net.name || net.id, ...traversed],
          note:
            criticalLoads.length > 0
              ? `该电源域驱动关键器件：${criticalLoads.join("、")}`
              : `该电源域连接 ${attachedComponents.length} 个主要器件`,
        };
      }).filter((item) => item.path.length > 1 || !/连接 0 个主要器件$/.test(item.note)),
  };
}

export function traceSignalPaths(context: SchematicContext): SchematicSignalPathSummary {
  const blocks = identifyFunctionalBlocksSummary(context).functionalBlocks;
  const componentById = new Map(context.components.map((component) => [component.id, component]));
  const adjacency = buildComponentAdjacency(context);
  return {
    paths: blocks.slice(0, 5).map((block) => ({
      block: block.name,
      path: traceBlockPath(block, context, adjacency, componentById),
      note:
        block.netHints.length > 0
          ? `模块主要关联网络：${block.netHints.join("、")}`
          : `模块主要器件：${block.evidence.join("、")}`,
    })).filter((item) => item.path.length > 0),
  };
}

export function traceControlPaths(context: SchematicContext): SchematicControlPathSummary {
  const componentById = new Map(context.components.map((component) => [component.id, component]));
  const controller = context.components.find((component) => /esp32|stm32|mcu|soc|processor|cpu|wroom/i.test(buildSearchText(component)));
  if (!controller) {
    return { paths: [] };
  }
  const adjacency = buildComponentAdjacency(context);
  const targets = context.components
    .filter((component) => component.id !== controller.id)
    .filter((component) => /sensor|codec|amp|uart|usb|driver|flash|memory|touch|imu|display|led/i.test(buildSearchText(component)))
    .slice(0, 5);
  return {
    paths: targets.map((target) => ({
      controller: safeComponentRef(controller),
      target: safeComponentRef(target),
      path: traceComponentPath(context, adjacency, controller.id, target.id, componentById, 4, "signal"),
      note: `${safeComponentRef(controller)} 到 ${safeComponentRef(target)} 的主控链路`,
    })).filter((item) => item.path.length > 0),
  };
}

export function buildAnalysisEvidence(context: SchematicContext): SchematicAnalysisEvidence {
  const pinById = new Map(context.pins.map((pin) => [pin.id, pin]));
  const netsByComponent = buildNetHintsByComponent(context.nets, pinById);
  const keyIds = new Set(
    identifyKeyComponentsSummary(context).keyComponents
      .map((item) => context.components.find((component) => (component.ref || component.id) === item.ref)?.id)
      .filter(Boolean) as string[]
  );

  const keyComponents = context.components
    .filter((component) => keyIds.has(component.id))
    .slice(0, 8)
    .map((component) => ({
      ref: safeComponentRef(component),
      name: sanitizeDisplayText(component.name),
      value: sanitizeDisplayText(component.value),
      packageName: sanitizeDisplayText(component.packageName),
      category: classifyComponent(component),
      reasons: summarizeComponentReasons(component),
      pins: context.pins
        .filter((pin) => pin.componentId === component.id)
        .slice(0, 10)
        .map((pin) => ({
          pin: [pin.pinName, pin.pinNumber].filter(Boolean).join(" ") || pin.id,
          net: findNetNameForPin(context, pin.id),
          electricalType: pin.electricalType,
        })),
    }));

  const representativeNets = pickRepresentativeNets(context)
    .slice(0, 12)
    .map((net) => {
      const componentById = new Map(context.components.map((component) => [component.id, component]));
      const pins = getPinsOnNet(context, net);
      const members = getComponentsOnNet(context, net, componentById)
        .slice(0, 10)
        .map((component) => formatComponentLabel(component));
      const safeMembers =
        members.length > 0
          ? members
          : pins.length > 0
            ? [`引脚数=${pins.length}`]
            : ["注：成员信息暂不可解析（上下文映射可能不完整）"];
      return {
        name: net.name || net.id,
        isPower: Boolean(net.isPower || isLikelyPowerNet(net)),
        members: safeMembers,
      };
    });

  const notableComponents = context.components
    .filter((component) => {
      const category = classifyComponent(component);
      return category === "集成电路" || category === "连接器" || category === "开关/按键";
    })
    .slice(0, 20)
    .map((component) => ({
      label: formatComponentLabel(component),
      category: classifyComponent(component),
      nets: (netsByComponent.get(component.id) ?? []).slice(0, 6),
    }));

  return {
    project: {
      pageName: context.project.pageName,
      projectId: context.project.projectId,
      pageId: context.project.pageId,
      channel: context.project.channel,
    },
    stats: {
      componentCount: context.components.length,
      netCount: context.nets.length,
      pinCount: context.pins.length,
      selectionCount: context.selection.objectIds.length,
    },
    keyComponents,
    representativeNets,
    notableComponents,
  };
}

function buildNetHintsByComponent(nets: SchematicNet[], pinById: Map<string, SchematicPin>): Map<string, string[]> {
  const result = new Map<string, string[]>();
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

type TraversalMode = "power" | "signal";

function buildComponentAdjacency(context: SchematicContext): Map<string, Set<string>> {
  const pinById = new Map(context.pins.map((pin) => [pin.id, pin]));
  const adjacency = new Map<string, Set<string>>();
  context.components.forEach((component) => adjacency.set(component.id, new Set<string>()));
  context.nets.forEach((net) => {
    const netPins = net.nodeIds.map((nodeId) => pinById.get(nodeId)).filter(Boolean) as SchematicPin[];
    const componentIds = Array.from(new Set(netPins.map((pin) => pin.componentId)));
    componentIds.forEach((sourceId) => {
      const neighbors = adjacency.get(sourceId) ?? new Set<string>();
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

function getComponentsOnNet(
  context: SchematicContext,
  net: SchematicNet,
  componentById: Map<string, SchematicComponent>
): SchematicComponent[] {
  const pins = getPinsOnNet(context, net);
  return Array.from(
    new Set(
      pins.map((pin) => pin.componentId)
    )
  )
    .map((componentId) => componentById.get(componentId))
    .filter(Boolean) as SchematicComponent[];
}

function getPinsOnNet(context: SchematicContext, net: SchematicNet): SchematicPin[] {
  // Prefer nodeIds->pin.id mapping when available.
  const pinById = new Map(context.pins.map((pin) => [pin.id, pin]));
  const fromNodeIds = net.nodeIds.map((id) => pinById.get(id)).filter(Boolean) as SchematicPin[];
  if (fromNodeIds.length > 0) {
    const seen = new Set<string>();
    return fromNodeIds.filter((pin) => (seen.has(pin.id) ? false : (seen.add(pin.id), true)));
  }

  // Fallback: host may only provide pin.netName, while net.nodeIds are primitive/node ids.
  // Use `net.id` as a fallback name as some hosts store the visible net name in the id field.
  const netName = String(net.name || net.id || "").trim();
  if (!netName) return [];
  const byNetName = context.pins.filter((pin) => String(pin.netName || "").trim() === netName);
  if (byNetName.length === 0) {
    // Loose match for minor name normalization differences.
    const normalized = netName.toLowerCase();
    return context.pins.filter((pin) => String(pin.netName || "").trim().toLowerCase() === normalized);
  }
  return byNetName;
}

function traceComponentPath(
  context: SchematicContext,
  adjacency: Map<string, Set<string>>,
  startId: string | undefined,
  targetId: string,
  componentById: Map<string, SchematicComponent>,
  maxDepth: number,
  mode: TraversalMode
): string[] {
  if (!startId) {
    return [formatComponentLabel(componentById.get(targetId) || { id: targetId, properties: {} } as SchematicComponent)];
  }
  if (startId === targetId) {
    return [formatComponentLabel(componentById.get(startId) || { id: startId, properties: {} } as SchematicComponent)];
  }
  const queue: Array<{ id: string; path: string[]; depth: number }> = [{ id: startId, path: [startId], depth: 0 }];
  const visited = new Set<string>([startId]);
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current.id === targetId) {
      return current.path
        .map((componentId) => componentById.get(componentId))
        .filter(Boolean)
        .map((component) => formatComponentLabel(component!));
    }
    if (current.depth >= maxDepth) {
      continue;
    }
    const neighbors = adjacency.get(current.id) ?? new Set<string>();
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
        depth: current.depth + 1,
      });
    });
  }
  return [formatComponentLabel(componentById.get(startId) || { id: startId, properties: {} } as SchematicComponent)];
}

function traceBlockPath(
  block: SchematicFunctionalBlocksSummary["functionalBlocks"][number],
  context: SchematicContext,
  adjacency: Map<string, Set<string>>,
  componentById: Map<string, SchematicComponent>
): string[] {
  const blockComponentIds = context.components
    .filter((component) => block.evidence.includes(formatComponentLabel(component)))
    .map((component) => component.id);
  const anchor = blockComponentIds[0];
  const next = blockComponentIds[1];
  const traced = anchor && next ? traceComponentPath(context, adjacency, anchor, next, componentById, 3, "signal") : [];
  const netHints = block.netHints.slice(0, 2);
  return [...netHints, ...traced, ...block.evidence.slice(0, 2)].filter(Boolean).slice(0, 6);
}

function hasCompatibleTraversal(
  context: SchematicContext,
  sourceId: string,
  targetId: string,
  mode: TraversalMode
): boolean {
  const sourcePins = context.pins.filter((pin) => pin.componentId === sourceId);
  const targetPins = context.pins.filter((pin) => pin.componentId === targetId);
  if (sourcePins.length === 0 || targetPins.length === 0) {
    return true;
  }
  return sourcePins.some((sourcePin) =>
    targetPins.some((targetPin) => isTraversalPairAllowed(sourcePin.electricalType, targetPin.electricalType, mode))
  );
}

function allowTraversalBetween(
  sourceId: string,
  targetId: string,
  pins: SchematicPin[],
  mode: TraversalMode
): boolean {
  const sourcePins = pins.filter((pin) => pin.componentId === sourceId);
  const targetPins = pins.filter((pin) => pin.componentId === targetId);
  if (sourcePins.length === 0 || targetPins.length === 0) {
    return true;
  }
  return sourcePins.some((sourcePin) =>
    targetPins.some((targetPin) => isTraversalPairAllowed(sourcePin.electricalType, targetPin.electricalType, mode))
  );
}

function isTraversalPairAllowed(
  sourceType: string | undefined,
  targetType: string | undefined,
  mode: TraversalMode
): boolean {
  const source = normalizeElectricalType(sourceType);
  const target = normalizeElectricalType(targetType);
  if (!source && !target) {
    return true;
  }
  if (mode === "power") {
    const sourceTypes = new Set(["power_out", "output", "passive", "bidirectional"]);
    const targetTypes = new Set(["power_in", "input", "passive", "bidirectional"]);
    return sourceTypes.has(source) || targetTypes.has(target);
  }
  const sourceTypes = new Set(["output", "bidirectional", "passive", "tri_state"]);
  const targetTypes = new Set(["input", "bidirectional", "passive", "tri_state"]);
  return sourceTypes.has(source) || targetTypes.has(target);
}

function normalizeElectricalType(value: string | undefined): string {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, "_");
}

function classifyComponent(component: SchematicComponent): string {
  const text = buildSearchText(component);
  if (/\bres\b|resistor|ohm|r\d+/i.test(text)) return "电阻";
  if (/\bcap\b|capacitor|uf|nf|pf|c\d+/i.test(text)) return "电容";
  if (/\bind\b|inductor|uh|mh|l\d+/i.test(text)) return "电感";
  if (/\bled\b|led|indicator/i.test(text)) return "LED";
  if (/diode|schottky|tvs|esd|d\d+/i.test(text)) return "二极管";
  if (/mosfet|transistor|bjt|q\d+/i.test(text)) return "晶体管";
  if (/connector|header|usb|type-c|jack|battery holder|socket/i.test(text)) return "连接器";
  if (/switch|button|key/i.test(text)) return "开关/按键";
  if (/esp32|stm32|ic|amp|codec|charger|ldo|buck|boost|pmic|sensor|driver|uart|mcu|wroom/i.test(text)) return "集成电路";
  return "其他器件";
}

function scoreKeyComponent(component: SchematicComponent): { score: number; reason: string } {
  const text = buildSearchText(component);
  if (/esp32|stm32|mcu|soc|processor|cpu|wroom/i.test(text)) {
    return { score: 100, reason: "疑似主控或核心处理器件" };
  }
  if (/charger|ldo|buck|boost|pmic|battery|tp4056|ry3715|me6211/i.test(text)) {
    return { score: 85, reason: "疑似电源管理关键器件" };
  }
  if (/audio|codec|mic|speaker|amp|es8311|max98357|i2s/i.test(text)) {
    return { score: 78, reason: "疑似音频链路关键器件" };
  }
  if (/usb|uart|serial|type-c|cp210|ch340/i.test(text)) {
    return { score: 72, reason: "疑似接口或通信关键器件" };
  }
  if (/sensor|hall|imu|accelerometer|gyro/i.test(text)) {
    return { score: 68, reason: "疑似传感器关键器件" };
  }
  return { score: 0, reason: "" };
}

function isLikelyPowerNet(net: SchematicNet): boolean {
  const raw = String(net.name || net.id || "").trim();
  if (!raw) return false;
  const name = raw.toUpperCase().replace(/[^A-Z0-9]+/g, "_");
  return (
    /^(GND|AGND|DGND)(_|$|\d)/.test(name) ||
    /^(3V3|5V|1V8|VBUS|VBAT|VIN|VOUT|GND|VCC|AVDD|DVDD|VSYS|SYS)(_|$|\d)/.test(name)
  );
}

function isPowerNetName(netName: string): boolean {
  const raw = String(netName || "").trim();
  if (!raw) return false;
  const name = raw.toUpperCase().replace(/[^A-Z0-9]+/g, "_");
  return (
    /^(GND|AGND|DGND)(_|$|\d)/.test(name) ||
    /^(3V3|5V|1V8|VBUS|VBAT|VIN|VOUT|GND|VCC|AVDD|DVDD|VSYS|SYS)(_|$|\d)/.test(name)
  );
}

function normalizeNetName(value: string | undefined): string {
  return String(value || "").trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_");
}

function netPriorityScore(net: SchematicNet): number {
  const name = normalizeNetName(net.name || net.id);
  if (!name) return 0;
  if (/^(GND|AGND|DGND)(_|$|\d)/.test(name)) return 10_000;
  if (/^(3V3|5V|VBUS|VBAT|VIN|VCC|VSYS|SYS)(_|$|\d)/.test(name)) return 9_000;
  if (/USB_(DP|DM)$/.test(name) || /^(DP|DM)$/.test(name) || /D[PM]$/.test(name)) return 8_000;
  if (/UART_(TX|RX)$/.test(name) || /^(TX|RX|TXD|RXD)$/.test(name)) return 7_800;
  if (/^(SCL|SDA|I2C_SCL|I2C_SDA)(_|$|\d)/.test(name)) return 7_500;
  if (/^(SCK|MOSI|MISO|CS|CLK|SDI|SDO)(_|$|\d)/.test(name)) return 7_000;
  if (/^(EN|RST|RESET|BOOT|IO0)(_|$|\d)/.test(name)) return 6_500;
  return 0;
}

function pickRepresentativeNets(context: SchematicContext): SchematicNet[] {
  const seen = new Set<string>();
  const all = context.nets.slice();
  const pinCount = new Map<string, number>();
  all.forEach((net) => {
    pinCount.set(net.id, getPinsOnNet(context, net).length);
  });
  const score = (net: SchematicNet): number => {
    const base = netPriorityScore(net);
    const pins = pinCount.get(net.id) ?? 0;
    const isPower = net.isPower || isLikelyPowerNet(net);
    return base + (isPower ? 500 : 0) + Math.min(200, pins);
  };
  const sorted = all
    .filter((net) => Boolean(net.name) || (pinCount.get(net.id) ?? 0) > 1)
    .sort((a, b) => score(b) - score(a));
  const picked: SchematicNet[] = [];
  for (const net of sorted) {
    const key = normalizeNetName(net.name || net.id) || net.id;
    if (seen.has(key)) continue;
    seen.add(key);
    picked.push(net);
    if (picked.length >= 16) break;
  }
  return picked;
}

function buildSearchText(component: SchematicComponent): string {
  return [
    component.id,
    component.ref,
    component.name,
    component.value,
    component.packageName,
    ...Object.values(component.properties || {}),
  ]
    .filter(Boolean)
    .join(" ");
}

function formatComponentLabel(component: SchematicComponent): string {
  return [safeComponentRef(component), formatComponentDescriptor(component)]
    .filter(Boolean)
    .join(" ");
}

function formatComponentDescriptor(component: SchematicComponent): string {
  return [
    sanitizeDisplayText(component.name),
    sanitizeDisplayText(component.value),
    sanitizeDisplayText(component.packageName),
  ]
    .filter(Boolean)
    .join(" / ");
}

function safeComponentRef(component: SchematicComponent): string {
  const ref = String(component.ref || "").trim();
  return ref && !looksLikeOpaqueId(ref) ? ref : classifyComponent(component);
}

function sanitizeDisplayText(value: string | undefined): string | undefined {
  const text = String(value || "").trim();
  if (!text) return undefined;
  if (text.includes("={Manufacturer Part}")) return undefined;
  if (looksLikeOpaqueId(text)) return undefined;
  return text;
}

function looksLikeOpaqueId(value: string): boolean {
  const text = value.trim();
  return /^[0-9a-f]{12,}$/i.test(text) || /^\{?=?[A-Za-z ]+\}?$/.test(text) === false && /^[A-Z0-9_-]{10,}$/i.test(text);
}

function summarizeComponentReasons(component: SchematicComponent): string[] {
  const text = buildSearchText(component);
  const reasons: string[] = [];
  if (/esp32|stm32|mcu|soc|processor|cpu|wroom/i.test(text)) reasons.push("主控/处理器");
  if (/charger|ldo|buck|boost|pmic|battery|tp4056|ry3715|me6211/i.test(text)) reasons.push("电源管理");
  if (/audio|codec|mic|speaker|amp|es8311|max98357|i2s/i.test(text)) reasons.push("音频链路");
  if (/usb|uart|serial|type-c|cp210|ch340/i.test(text)) reasons.push("接口通信");
  if (/sensor|hall|imu|accelerometer|gyro/i.test(text)) reasons.push("传感器");
  if (reasons.length === 0) reasons.push(classifyComponent(component));
  return reasons;
}

function findNetNameForPin(context: SchematicContext, pinId: string): string | undefined {
  const pin = context.pins.find((item) => item.id === pinId);
  if (pin?.netName) {
    return pin.netName;
  }
  return context.nets.find((net) => net.nodeIds.includes(pinId))?.name;
}
