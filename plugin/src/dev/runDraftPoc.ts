import { createEditorAdapter } from "../editor/adapters/createEditorAdapter";
import { buildSchematicContext } from "../editor/context/buildSchematicContext";
import { resolveRuntimeChannel } from "../editor/host/runtime";
import { installFakeHostBridge } from "./installFakeHostBridge";
import { createPluginAgent } from "../agent";
import { ToolRegistry } from "../agent/tools/toolRegistry";
import { createEditorTools } from "../agent/tools/editorTools";
import { createRuleTools } from "../agent/tools/ruleTools";
import { createDraftTools } from "../agent/tools/draftTools";
import { createServerTools } from "../agent/tools/serverTools";
import type { DraftPlan, DraftPreview } from "../editor/apply-plan/draftPlan";
import { FetchHttpClient } from "../services/api-client/httpClient";
import { RagClient } from "../services/rag/ragClient";
import { LlmProxyClient } from "../services/llm/llmProxyClient";
import { PersistentSessionStore } from "../services/auth/sessionStore";
import { MemoryKeyValueStore } from "../storage/keyValueStore";
import { AuthClient } from "../services/auth/authClient";
import { runEmailLoginFlow } from "../services/auth/loginFlow";
import { CustomLlmConfigStore } from "../services/llm/customLlmConfigStore";

async function main(): Promise<void> {
  const envChannel = process.env.LCEDA_PLUGIN_CHANNEL === "professional" ? "professional" : "standard";
  (globalThis as typeof globalThis & { LCEDA_PLUGIN_CHANNEL?: "standard" | "professional" }).LCEDA_PLUGIN_CHANNEL =
    envChannel;
  installFakeHostBridge(envChannel);
  const channel = resolveRuntimeChannel(envChannel);

  const adapter = createEditorAdapter(channel);
  const baseUrl = process.env.BASE_URL ?? "http://127.0.0.1:18093";
  const email = process.env.POC_EMAIL ?? "demo@example.com";
  const code = process.env.POC_CODE ?? "123456";
  const storage = new MemoryKeyValueStore();
  const sessionStore = new PersistentSessionStore(storage);
  const customLlmConfigStore = new CustomLlmConfigStore(storage);
  const ragClient = new RagClient(new FetchHttpClient(baseUrl));
  const tools = new ToolRegistry();
  for (const tool of createEditorTools(adapter)) {
    tools.register(tool);
  }
  for (const tool of createRuleTools()) {
    tools.register(tool);
  }
  for (const tool of createDraftTools(ragClient, globalThis.LCEDA_HOST_BRIDGE?.searchLibraryDevices)) {
    tools.register(tool);
  }
  const authClient = new AuthClient(new FetchHttpClient(baseUrl));
  await runEmailLoginFlow(authClient, sessionStore, channel, email, code);
  const llmClient = new LlmProxyClient(new FetchHttpClient(baseUrl));
  for (const tool of createServerTools(ragClient, llmClient, sessionStore)) {
    tools.register(tool);
  }
  const pluginAgent = createPluginAgent({
    llmClient,
    ragClient,
    sessionStore,
    customLlmConfigStore,
  });

  let result: Awaited<ReturnType<typeof pluginAgent.run>> | null = null;
  let agentError: string | undefined;
  try {
    const context = await buildSchematicContext(adapter);
    result = await pluginAgent.run({
      type: "schematic_draft",
      userQuery: process.env.DRAFT_QUERY ?? "画一个 5V 转 3.3V 的 LDO 供电模块",
      context,
      adapter,
    });
  } catch (error) {
    // 宿主能力不足时直接输出错误并跳过落图动作。
    agentError = error instanceof Error ? error.message : String(error);
  }
  if (!result?.draftPlan) {
    console.log("draft error", agentError ?? "unknown");
    return;
  }
  const applyPreview = await tools.invoke<{ plan: DraftPlan }, DraftPreview>("editor_preview_apply_plan", {
    plan: result.draftPlan as DraftPlan,
  });
  const applyResult = await tools.invoke<
    { plan: DraftPlan },
    {
      applied: boolean;
      componentCount: number;
      netCount: number;
      transactionId?: string;
      rollbackSupported?: boolean;
    }
  >("editor_apply_plan", {
    plan: result.draftPlan as DraftPlan,
  });
  const rollbackResult =
    applyResult.transactionId && applyResult.rollbackSupported
      ? await tools.invoke<
          { transactionId: string },
          { rolledBack: boolean; transactionId: string }
        >("editor_rollback_apply_plan", {
          transactionId: applyResult.transactionId,
        })
      : undefined;

  console.log("draft summary", result.summary);
  console.log("selected skill", result.selectedSkill);
  console.log("llm draft hint", result.llmDraftHint ?? "");
  console.log("draft preview", result.draftPreview);
  console.log("draft validation", result.draftValidation);
  console.log("apply preview", applyPreview);
  console.log("apply result", applyResult);
  console.log("rollback result", rollbackResult ?? "skipped");
}

void main();
