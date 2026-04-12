import { FetchHttpClient } from "../services/api-client/httpClient";
import { AuthClient } from "../services/auth/authClient";
import { runEmailLoginFlow } from "../services/auth/loginFlow";
import { PersistentSessionStore } from "../services/auth/sessionStore";
import { CustomLlmConfigStore } from "../services/llm/customLlmConfigStore";
import { LlmProxyClient } from "../services/llm/llmProxyClient";
import { RagClient } from "../services/rag/ragClient";
import { CreditsClient } from "../services/credits/creditsClient";
import { MemoryKeyValueStore } from "../storage/keyValueStore";
import { createEditorAdapter } from "../editor/adapters/createEditorAdapter";
import { buildSchematicContext } from "../editor/context/buildSchematicContext";
import { ToolRegistry } from "../agent/tools/toolRegistry";
import { createEditorTools } from "../agent/tools/editorTools";
import { createIssueTools } from "../agent/tools/issueTools";
import { createRuleTools } from "../agent/tools/ruleTools";
import { createServerTools } from "../agent/tools/serverTools";
import { createAccountTools } from "../agent/tools/accountTools";
import { MCPClient } from "../agent/mcp/mcpClient";
import { renderDebugPanel } from "../ui/panels/debugPanel";
import { createInitialMainPanelState } from "../ui/panels/mainPanel";
import { installFakeHostBridge } from "./installFakeHostBridge";
import { resolveRuntimeChannel } from "../editor/host/runtime";
import { createPluginAgent } from "../agent";

async function main(): Promise<void> {
  const envChannel = process.env.LCEDA_PLUGIN_CHANNEL === "professional" ? "professional" : "standard";
  const useFakeHost = process.env.POC_USE_FAKE_HOST === "1";
  const requireHostBridge = process.env.LCEDA_REQUIRE_HOST_BRIDGE === "1";
  (globalThis as typeof globalThis & { LCEDA_PLUGIN_CHANNEL?: "standard" | "professional" }).LCEDA_PLUGIN_CHANNEL =
    envChannel;
  (globalThis as typeof globalThis & { LCEDA_REQUIRE_HOST_BRIDGE?: boolean }).LCEDA_REQUIRE_HOST_BRIDGE =
    requireHostBridge;
  if (useFakeHost) {
    installFakeHostBridge(envChannel);
  }
  const channel = resolveRuntimeChannel(envChannel);
  const baseUrl = process.env.BASE_URL ?? "http://127.0.0.1:18081";
  const email = process.env.POC_EMAIL ?? "demo@example.com";
  const code = process.env.POC_CODE ?? "123456";
  const storage = new MemoryKeyValueStore();
  const sessionStore = new PersistentSessionStore(storage);
  const llmConfigStore = new CustomLlmConfigStore(storage);

  const adapter = createEditorAdapter(channel);
  const capabilityReport = await adapter.getCapabilityReport();
  const tools = new ToolRegistry();
  for (const tool of createEditorTools(adapter)) {
    tools.register(tool);
  }
  for (const tool of createRuleTools()) {
    tools.register(tool);
  }
  for (const tool of createIssueTools(tools)) {
    tools.register(tool);
  }
  const ragClient = new RagClient(new FetchHttpClient(baseUrl));
  const llmClient = new LlmProxyClient(new FetchHttpClient(baseUrl));
  const creditsClient = new CreditsClient(new FetchHttpClient(baseUrl));
  const mcpClient = new MCPClient();
  const pluginAgent = createPluginAgent({
    llmClient,
    ragClient,
    sessionStore,
    customLlmConfigStore: llmConfigStore,
    mcpClient,
  });
  for (const tool of createServerTools(ragClient, llmClient, sessionStore)) {
    tools.register(tool);
  }
  mcpClient.registerTools(tools, [
    {
      name: "knowledge_resource_overview",
      description: "List MCP knowledge resource URIs available to the plugin agent",
      execute: async () => ({
        resources: mcpClient.listResources(),
      }),
    },
  ]);

  let agentResult: Awaited<ReturnType<typeof pluginAgent.run>> | null = null;
  let agentError: string | undefined;
  try {
    const context = await buildSchematicContext(adapter);
    agentResult = await pluginAgent.run({
      type: "schematic_analysis",
      userQuery: "collect current schematic context",
      context,
      adapter,
    });
  } catch (error) {
    // 允许在宿主能力缺失时继续完成登录与服务端调用验证。
    agentError = error instanceof Error ? error.message : String(error);
  }

  const authClient = new AuthClient(new FetchHttpClient(baseUrl));
  const loginResult = await runEmailLoginFlow(authClient, sessionStore, channel, email, code);
  for (const tool of createAccountTools(sessionStore, creditsClient)) {
    tools.register(tool);
  }
  const currentUser = await authClient.getCurrentUser(loginResult.accessToken);
  const creditsBalance = await creditsClient.getBalance(loginResult.accessToken);
  const accountSession = await tools.invoke<undefined, { loggedIn: boolean }>("account.get_session", undefined);
  const accountCredits = await tools.invoke<undefined, { balance: number; currency: string }>(
    "credits.get_balance",
    undefined
  );
  await llmConfigStore.set({
    provider: "openai-compatible",
    baseUrl: "https://api.example.com/v1",
    apiKey: "local-demo-key",
    model: "gpt-4.1-mini",
    preferredOutputLanguage: "zh-CN",
  });
  const restoredSession = await sessionStore.get();
  const restoredLlmConfig = await llmConfigStore.get();
  const ragResult = await tools.invoke<
    { query: string; topK?: number },
    { results: Array<{ title: string; source_ref: string; kb_type: string }> }
  >("rag_search", {
    query: "How should I check LDO input and diode polarity in a power path?",
    topK: 2,
  });
  const citationPackage = await tools.invoke<
    { query: string; topK?: number },
    { query: string; results: Array<{ title: string; source_ref: string; kb_type: string }> }
  >("rag_build_citations", {
    query: "Build citations for LDO and diode polarity review.",
    topK: 2,
  });
  const llmResult = await tools.invoke<
    { model: string; messages: Array<{ role: "system" | "user" | "assistant"; content: string }> },
    {
      model: string;
      output_text: string;
      prompt_tokens: number;
      completion_tokens: number;
      cost_credits: number;
      remaining_credits: number;
      billing_transaction: string;
    }
  >("llm_generate", {
    model: "",
    messages: [
      {
        role: "system",
        content: "You are an EDA assistant.",
      },
      {
        role: "user",
        content: "Summarize the likely issue in this power path.",
      },
    ],
  });
  const creditsTransactions = await creditsClient.listTransactions(loginResult.accessToken);
  const llmLogs = await llmClient.listLogs(loginResult.accessToken);

  const state = createInitialMainPanelState();
  state.loggedIn = true;
  state.userDisplayName = currentUser.display_name;
  state.userEmail = currentUser.email;
  state.creditsBalance = creditsBalance.balance;
  state.creditsCurrency = creditsBalance.currency;
  state.channel = agentResult?.contextDigest?.channel;
  state.componentCount = agentResult?.contextDigest?.componentCount;
  state.netCount = agentResult?.contextDigest?.netCount;
  state.selectionCount = agentResult?.contextDigest?.selectionCount;
  state.issueCount = agentResult?.checkResult?.issues.length;
  state.topIssueTitle = agentResult?.checkResult?.issues[0]?.title;
  state.locateStatus = agentResult?.locateResult?.located
    ? `${agentResult?.locateResult.objectType}:${agentResult?.locateResult.objectId}`
    : "none";
  state.capabilityReport = capabilityReport ?? undefined;
  state.summary = agentResult
    ? `${agentResult.summary}; adapter_source=${adapter.source}; ${loginResult.summary}; user=${loginResult.userEmail}; credits=${creditsBalance.balance}`
    : `analysis blocked; adapter_source=${adapter.source}; error=${agentError ?? "unknown"}; ${loginResult.summary}; user=${loginResult.userEmail}; credits=${creditsBalance.balance}`;

  console.log(renderDebugPanel(state));
  console.log("selected skill", agentResult?.selectedSkill ?? "none");
  console.log("tool traces", agentResult?.toolTraces ?? []);
  console.log("host bridge enabled", useFakeHost);
  console.log("mcp resources", mcpClient.listResources());
  console.log("locate result", agentResult?.locateResult ?? { located: false });
  console.log("rule issues", agentResult?.checkResult?.issues ?? []);
  console.log("rag result", ragResult);
  console.log("citation package", citationPackage);
  console.log("llm result", llmResult);
  console.log("credits transactions", creditsTransactions);
  console.log("llm logs", llmLogs);
  console.log("account session", accountSession);
  console.log("account credits", accountCredits);
  console.log("stored session", restoredSession);
  console.log("stored llm config", restoredLlmConfig);
  const logoutResult = await authClient.logout(loginResult.accessToken);
  await sessionStore.clear();
  let postLogoutAccessRejected = false;
  try {
    await authClient.getCurrentUser(loginResult.accessToken);
  } catch (error) {
    postLogoutAccessRejected = true;
    console.log("post logout access check", error instanceof Error ? error.message : String(error));
  }
  console.log("current user", currentUser);
  console.log("credits balance", creditsBalance);
  console.log("logout result", logoutResult);
  console.log("post logout access rejected", postLogoutAccessRejected);
}

void main();
