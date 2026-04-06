import type { SchematicContext, SchematicPin } from "../../types/schematic";
import type { RuleIssue } from "../models/issue";

const MCU_PATTERNS = [/esp32/i, /stm32/i, /\bmcu\b/i, /wroom/i, /wrover/i, /rp2040/i, /nrf52/i, /gd32/i, /ch32/i, /atmega/i];

export function runMcuUnusedPinsCheck(context: SchematicContext): RuleIssue[] {
  const issues: RuleIssue[] = [];
  const connectedPinIds = buildConnectedPinIds(context);

  for (const component of context.components) {
    if (!looksLikeMcu(component)) continue;

    const pins = context.pins.filter((pin) => pin.componentId === component.id);
    if (pins.length === 0) continue;

    const unusedGpios = pins
      .filter((pin) => isGpioLike(pin))
      .filter((pin) => !pin.noConnected)
      .filter((pin) => !connectedPinIds.has(pin.id))
      .map((pin) => formatPinLabel(pin))
      .filter(Boolean);

    // Only surface when there are many; a couple unused GPIOs is normal.
    if (unusedGpios.length < 8) continue;

    const sample = unusedGpios.slice(0, 12).join("、");
    issues.push({
      id: `issue-${component.id}-mcu-unused-gpio`,
      ruleId: "design.mcu-unused-gpio",
      severity: "low",
      title: "主控存在大量未连接 GPIO",
      message: `${component.ref ?? component.id} 检测到 ${unusedGpios.length} 个 GPIO/IO 类引脚未连接（样例：${sample}${unusedGpios.length > 12 ? "…" : ""}）。这通常不是电气错误，但可能影响抗干扰/功耗/启动状态，需在软件或硬件上明确处理。`,
      objectId: component.id,
      objectType: "component",
      suggestion: "若这些引脚确实未使用，建议在软件中配置为输入并启用内部上拉/下拉；若作为预留接口，建议标注用途并加测试点或上拉/下拉电阻。",
    });
  }

  return issues;
}

function looksLikeMcu(component: { id: string; ref?: string; name?: string; value?: string; packageName?: string; properties: Record<string, string> }): boolean {
  const text = [component.id, component.ref, component.name, component.value, component.packageName, ...Object.values(component.properties || {})]
    .filter(Boolean)
    .join(" ");
  return MCU_PATTERNS.some((re) => re.test(text));
}

function isGpioLike(pin: SchematicPin): boolean {
  const text = [pin.pinName, pin.pinNumber].filter(Boolean).join(" ").toUpperCase();
  if (!text) return false;
  // ESP32 style: IO0/IO1... or GPIOxx.
  if (/\bIO\d+\b/.test(text)) return true;
  if (/\bGPIO\d+\b/.test(text)) return true;
  return false;
}

function formatPinLabel(pin: SchematicPin): string {
  const name = String(pin.pinName || "").trim();
  const no = String(pin.pinNumber || "").trim();
  if (name && no) return `${name}(${no})`;
  return name || no || pin.id;
}

function buildConnectedPinIds(context: SchematicContext): Set<string> {
  const pinById = new Map(context.pins.map((pin) => [pin.id, pin]));
  let totalNodeIds = 0;
  let matchedNodeIds = 0;
  context.nets.forEach((net) => {
    totalNodeIds += net.nodeIds.length;
    net.nodeIds.forEach((id) => {
      if (pinById.has(id)) matchedNodeIds += 1;
    });
  });
  const nodeIdMappingReliable = totalNodeIds > 0 && matchedNodeIds / totalNodeIds >= 0.3;
  const hasNetNameMapping = context.pins.some((pin) => Boolean(String(pin.netName || "").trim()));

  const connected = new Set<string>();
  if (nodeIdMappingReliable) {
    context.nets.forEach((net) => {
      net.nodeIds.forEach((id) => {
        if (pinById.has(id)) connected.add(id);
      });
    });
    return connected;
  }

  if (hasNetNameMapping) {
    context.pins.forEach((pin) => {
      if (String(pin.netName || "").trim()) connected.add(pin.id);
    });
  }
  return connected;
}

