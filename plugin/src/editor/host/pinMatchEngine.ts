import type { TransientPinRecord } from "./transientPinResolver";

type PlanPin = { id: string; pinName?: string; pinNumber?: string };

export type PinMatchResult = {
  resolvedPinName?: string;
  resolvedPinNumber?: string;
  confidence: number;
  reason: string;
};

export function matchDraftPinsToRealPins(input: {
  role?: string;
  planPins: PlanPin[];
  realPins: TransientPinRecord[];
}): Map<string, PinMatchResult> {
  const out = new Map<string, PinMatchResult>();
  const used = new Set<string>();

  for (const planPin of input.planPins) {
    let best: TransientPinRecord | undefined;
    let bestScore = -1;
    for (const realPin of input.realPins) {
      const key = `${realPin.pinNumber || ""}:${realPin.pinName || ""}`;
      if (used.has(key)) {
        continue;
      }
      let score = 0;
      const planPinNumberCandidate = inferPlanPinNumber(planPin);
      if (planPinNumberCandidate && realPin.pinNumber && planPinNumberCandidate === realPin.pinNumber) {
        score += 100;
      }
      if (planPin.pinName && realPin.pinName && planPin.pinName === realPin.pinName) {
        score += 100;
      }
      if (score > bestScore) {
        bestScore = score;
        best = realPin;
      }
    }
    if (best && bestScore > 0) {
      used.add(`${best.pinNumber || ""}:${best.pinName || ""}`);
      out.set(planPin.id, {
        resolvedPinName: best.pinName,
        resolvedPinNumber: best.pinNumber,
        confidence: Math.min(1, bestScore / 100),
        reason: bestScore >= 100 ? "matched_pin_number" : "matched_pin_name",
      });
    }
  }

  return out;
}

function inferPlanPinNumber(planPin: PlanPin): string | undefined {
  if (planPin.pinNumber) {
    return planPin.pinNumber;
  }
  if (planPin.pinName && /^\d+$/.test(planPin.pinName)) {
    return planPin.pinName;
  }
  return undefined;
}
