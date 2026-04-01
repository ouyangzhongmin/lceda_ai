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
      name: "schematic.summarize_bom",
      description: "基于当前上下文汇总原理图 BOM 分类",
      riskLevel: "low",
      execute: async (input: { context: SchematicContext }) => summarizeBom(input.context),
    },
    {
      name: "schematic.identify_key_components",
      description: "识别主控、电源、接口、传感器等关键器件",
      riskLevel: "low",
      execute: async (input: { context: SchematicContext }) => identifyKeyComponentsSummary(input.context),
    },
    {
      name: "schematic.identify_functional_blocks",
      description: "从原理图上下文中识别功能模块及代表证据",
      riskLevel: "low",
      execute: async (input: { context: SchematicContext }) => identifyFunctionalBlocksSummary(input.context),
    },
    {
      name: "schematic.identify_power_domains",
      description: "识别主要电源域及其关联器件",
      riskLevel: "low",
      execute: async (input: { context: SchematicContext }) => identifyPowerDomainsSummary(input.context),
    },
    {
      name: "schematic.summarize_connectivity",
      description: "汇总整张原理图的连接性与网络分布",
      riskLevel: "low",
      execute: async (input: { context: SchematicContext }) => summarizeConnectivity(input.context),
    },
    {
      name: "schematic.trace_power_paths",
      description: "追踪从电源网络到关键器件的主要电源路径",
      riskLevel: "low",
      execute: async (input: { context: SchematicContext }) => tracePowerPaths(input.context),
    },
    {
      name: "schematic.trace_signal_paths",
      description: "追踪关键功能模块的代表性信号路径",
      riskLevel: "low",
      execute: async (input: { context: SchematicContext }) => traceSignalPaths(input.context),
    },
    {
      name: "schematic.trace_control_paths",
      description: "追踪从主控到主要外设的控制链路",
      riskLevel: "low",
      execute: async (input: { context: SchematicContext }) => traceControlPaths(input.context),
    },
    {
      name: "schematic.build_analysis_evidence",
      description: "构建适合分析的原理图证据，输出人类可读的器件、网络与引脚映射",
      riskLevel: "low",
      execute: async (input: { context: SchematicContext }) => buildAnalysisEvidence(input.context),
    },
  ];
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
        nodeCount: net.nodeIds.length,
        attachedComponents: Array.from(
          new Set(
            net.nodeIds
              .map((nodeId) => context.pins.find((pin) => pin.id === nodeId))
              .filter(Boolean)
              .map((pin) => componentById.get(pin!.componentId))
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
  const isolatedNets = context.nets.filter((net) => net.nodeIds.length <= 1).length;
  const powerNets = context.nets.filter((net) => net.isPower || isLikelyPowerNet(net)).length;
  const largeSignalNets = context.nets.filter(
    (net) => net.nodeIds.length >= 4 && !(net.isPower || isLikelyPowerNet(net))
  ).length;
  return {
    netCount: context.nets.length,
    selectionCount: context.selection.objectIds.length,
    connectivityNotes: [
      `检测到 ${powerNets} 条电源域相关网络。`,
      isolatedNets > 0 ? `有 ${isolatedNets} 条网络仅连接 1 个节点，可能需要进一步确认是否悬空。` : "未发现明显孤立网络。",
      largeSignalNets > 0 ? `有 ${largeSignalNets} 条多节点信号网络，存在总线或复用连接。` : "多节点信号网络较少，连接关系相对集中。",
    ],
  };
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

  const representativeNets = context.nets
    .filter((net) => Boolean(net.name) || net.nodeIds.length > 1)
    .sort((a, b) => {
      const aScore = (a.isPower ? 1000 : 0) + a.nodeIds.length;
      const bScore = (b.isPower ? 1000 : 0) + b.nodeIds.length;
      return bScore - aScore;
    })
    .slice(0, 12)
    .map((net) => ({
      name: net.name || net.id,
      isPower: Boolean(net.isPower || isLikelyPowerNet(net)),
      members: getComponentsOnNet(context, net, new Map(context.components.map((component) => [component.id, component])))
        .slice(0, 8)
        .map((component) => formatComponentLabel(component)),
    }))
    .filter((item) => item.members.length > 0 || item.name);

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
  const pinById = new Map(context.pins.map((pin) => [pin.id, pin]));
  return Array.from(
    new Set(
      net.nodeIds
        .map((nodeId) => pinById.get(nodeId))
        .filter(Boolean)
        .map((pin) => pin!.componentId)
    )
  )
    .map((componentId) => componentById.get(componentId))
    .filter(Boolean) as SchematicComponent[];
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
  const name = (net.name || net.id || "").toUpperCase();
  return /^(3V3|5V|VBUS|VBAT|VIN|VOUT|GND|VCC|AVDD|DVDD|VSYS|SYS)$/.test(name);
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
  return context.nets.find((net) => net.nodeIds.includes(pinId))?.name;
}
