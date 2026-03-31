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

export function createSchematicSummaryTools(): AgentTool[] {
  return [
    {
      name: "schematic.summarize_bom",
      description: "Summarize schematic BOM categories from current context",
      riskLevel: "low",
      execute: async (input: { context: SchematicContext }) => summarizeBom(input.context),
    },
    {
      name: "schematic.identify_key_components",
      description: "Identify key components such as MCU, power IC, interface IC, and sensor",
      riskLevel: "low",
      execute: async (input: { context: SchematicContext }) => identifyKeyComponentsSummary(input.context),
    },
    {
      name: "schematic.identify_functional_blocks",
      description: "Identify functional blocks and representative evidence from schematic context",
      riskLevel: "low",
      execute: async (input: { context: SchematicContext }) => identifyFunctionalBlocksSummary(input.context),
    },
    {
      name: "schematic.identify_power_domains",
      description: "Identify major power domains and attached components from schematic context",
      riskLevel: "low",
      execute: async (input: { context: SchematicContext }) => identifyPowerDomainsSummary(input.context),
    },
    {
      name: "schematic.summarize_connectivity",
      description: "Summarize connectivity and network distribution of the whole schematic",
      riskLevel: "low",
      execute: async (input: { context: SchematicContext }) => summarizeConnectivity(input.context),
    },
    {
      name: "schematic.trace_power_paths",
      description: "Trace major power paths from power nets to critical components",
      riskLevel: "low",
      execute: async (input: { context: SchematicContext }) => tracePowerPaths(input.context),
    },
    {
      name: "schematic.trace_signal_paths",
      description: "Trace representative signal paths for key functional blocks",
      riskLevel: "low",
      execute: async (input: { context: SchematicContext }) => traceSignalPaths(input.context),
    },
    {
      name: "schematic.trace_control_paths",
      description: "Trace controller-centric paths from main MCU/SoC to major peripherals",
      riskLevel: "low",
      execute: async (input: { context: SchematicContext }) => traceControlPaths(input.context),
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
        ref: item.component.ref || item.component.id,
        label:
          [item.component.name, item.component.value, item.component.packageName].filter(Boolean).join(" / ") ||
          formatComponentLabel(item.component),
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
      }),
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
    })),
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
      controller: controller.ref || controller.id,
      target: target.ref || target.id,
      path: traceComponentPath(context, adjacency, controller.id, target.id, componentById, 4, "signal"),
      note: `${controller.ref || controller.id} 到 ${target.ref || target.id} 的主控链路`,
    })),
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
  return [component.ref || component.id, component.name || component.value || component.packageName || ""]
    .filter(Boolean)
    .join(" ");
}
