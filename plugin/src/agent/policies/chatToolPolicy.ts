export interface ChatToolPolicyDecision {
  useEditorContext: boolean;
  useSelection: boolean;
  useLibrary: boolean;
  useRag: boolean;
  objectQuery: string;
}

export interface ChatFollowupPolicyDecision {
  enrichComponentLibrary: boolean;
  enrichObjectKnowledge: boolean;
}

export function decideChatToolPolicy(query: string): ChatToolPolicyDecision {
  return {
    useEditorContext: /当前|这个图|这张图|这个原理图|页面|图里|图中|现在的图|当前电路/.test(query),
    useSelection: /选中|当前选中|这个器件|这个元件|这个对象|所选/.test(query),
    useLibrary: /元件|器件|封装|型号|LCSC|料号|库里|库中|symbol|footprint|package/i.test(query),
    useRag: /为什么|原理|规范|规则|怎么接|如何接|推荐|注意事项|设计要求|标准|区别|用途/.test(query),
    objectQuery: extractObjectQuery(query),
  };
}

export function decideChatFollowupPolicy(input: {
  objectFound: boolean;
  objectType?: "component" | "pin" | "net";
  objectKnowledgeQuery: string;
  ragSummaryCount: number;
}): ChatFollowupPolicyDecision {
  return {
    enrichComponentLibrary: input.objectFound && input.objectType === "component",
    enrichObjectKnowledge: Boolean(input.objectKnowledgeQuery) && input.ragSummaryCount === 0,
  };
}

export function shouldUseToolBackedPrompt(input: {
  contextSummary: string;
  selectionSummary: string;
  ragSummary: string[];
  librarySummary: string[];
  objectSummary: string[];
}): boolean {
  const hasSelection = Boolean(input.selectionSummary) && input.selectionSummary !== "当前没有选中对象";
  const hasContext = Boolean(input.contextSummary) && !/channel=unknown,\s*components=0,\s*nets=0/.test(input.contextSummary);
  return Boolean(
    hasContext ||
      hasSelection ||
      input.ragSummary.length > 0 ||
      input.librarySummary.length > 0 ||
      input.objectSummary.length > 0
  );
}

export function buildLibraryQuery(query: string): string {
  const lcsc = query.match(/C\d{3,}/i);
  if (lcsc) return lcsc[0];
  const token = query.match(/[A-Za-z]+[A-Za-z0-9_-]{1,}/);
  if (token) return token[0];
  return query.trim();
}

function extractObjectQuery(query: string): string {
  const pinMatch = query.match(/\b([A-Za-z]+\d+)[\s.]?(PIN|pin|脚)?[\s.]?([A-Za-z0-9_+-]+)\b/);
  if (pinMatch && pinMatch[2]) {
    return `${pinMatch[1]}.${pinMatch[3]}`;
  }
  const refMatch = query.match(/\b[A-Za-z]+\d+\b/);
  if (refMatch) {
    return refMatch[0];
  }
  const netMatch = query.match(/\b(3V3|5V|VBUS|GND|VIN|VOUT|SDA|SCL|GPIO[_-]?[A-Za-z0-9]*)\b/i);
  if (netMatch) {
    return netMatch[0];
  }
  return "";
}
