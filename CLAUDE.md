# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

JLCEDA (嘉立创) EDA AI Assistant — a dual-layer architecture:
- **Plugin (TypeScript)**: Runs inside JLCEDA Standard/Professional EDA editor as a `.eext` extension
- **Server (Go)**: Provides auth, credits, RAG retrieval, LLM proxy, and knowledge management

## Commands

### Plugin (`plugin/`)

```bash
npm install
npm run build            # compile + package → plugin/build/dist/lceda-ai-assistant_v0.1.0.eext
npm run build:dev        # development build
npm run build:prod       # production build (NODE_ENV=production)
```

**Run PoCs (require server running):**
```bash
BASE_URL=http://127.0.0.1:18082 npm run poc:plugin
POC_USE_FAKE_HOST=1 BASE_URL=http://127.0.0.1:18082 npm run poc:plugin   # with injected host bridge
npm run poc:draft        # draft generation PoC
npm run poc:api-host     # API-style host bridge PoC
npm run poc:shape-host   # shape API PoC (no source API dependency)
```

**Run tests (Node.js built-in test runner — no jest/vitest):**
```bash
# Run a single test file
tsx --test plugin/src/agent/core/__tests__/reactLoopAgent.test.ts

# Run all tests matching a pattern
node --test --require tsx/cjs 'plugin/src/**/__tests__/*.test.ts'
```

### Server (`server/`)

```bash
docker compose up -d                                          # start PostgreSQL + Redis
APP_CONFIG=./configs/config.yaml PORT=18082 go run ./cmd     # start Go server
curl http://127.0.0.1:18082/healthz                          # health check
bash ./scripts/apply-migrations.sh                           # run DB migrations
```

## Architecture

### Plugin Layer (`plugin/src/`)

The plugin follows a ReAct (Reason + Act) agent loop. Key modules:

- **`agent/core/`** — `unifiedReactAgent.ts` orchestrates the ReAct loop; `reactLoopAgent.ts` handles per-step LLM calls and tool dispatch
- **`agent/tools/`** — `toolRegistry.ts` registers all tools; tools bridge editor operations, rule engine, RAG, draft generation
- **`agent/prompts/`** — system prompt construction, injecting schematic context and available tools
- **`app/assistantRuntime.ts`** — top-level runtime: manages conversation state, task lifecycle, context compaction
- **`editor/adapters/`** — wraps JLCEDA Standard/Professional SDK APIs behind a unified `EditorAdapter` interface
- **`editor/apply-plan/`** — draft plan lifecycle: `draftSpecToPlan.ts` (LLM spec → plan), `previewDraftPlan.ts`, `resolveDraftPlanDevices.ts` (library device resolution), `repairDraftPlan.ts`
- **`editor/host/`** — host bridge for `applyPlanByApi.ts` (placing components via typed API)
- **`services/llm/`** — `unifiedLlmClient.ts` routes between custom-LLM direct mode and server-proxy credits mode
- **`services/auth/`** — login session polling and token management
- **`types/schematic.ts`** — core schematic data model (components, nets, pins, properties)
- **`ui/iframe/`** — the embedded panel runs as an iframe (`plugin/iframe/index.html`); communication is via `postMessage`

### Server Layer (`server/internal/`)

Clean/hexagonal architecture:
- **`transport/http/`** — Gin routing and handlers
- **`usecase/`** — business logic: auth, credits, RAG search, LLM proxy, knowledge import
- **`repository/`** — PostgreSQL (pgx), Redis (go-redis), Qdrant (HTTP client)
- **`domain/`** — entity models
- **`wire/`** — dependency injection wiring

### Data Flow

1. Plugin reads schematic context (components, nets, selection) via `EditorAdapter`
2. `assistantRuntime` builds a task, invokes the ReAct agent with the context + tool registry
3. Agent calls tools (rule checks, RAG search via server, LLM generation, draft operations)
4. Draft plan flows through: `draftSpecToPlan` → `resolveDraftPlanDevices` → `previewDraftPlan` → `applyPlanByApi`
5. Results stream back to the iframe panel via postMessage

## Configuration

Plugin env vars are injected at **compile time** by esbuild. Edit `.env.development` / `.env.test` / `.env.production`:
- `SERVER_BASE_URL` — API endpoint (default: `http://127.0.0.1:8080`)
- `PLUGIN_CHANNEL` — `"standard"` or `"professional"`

See `plugin/CONFIG.md` for full list.

## Testing in JLCEDA Host

Load `plugin/build/dist/lceda-ai-assistant_v0.1.0.eext` into JLCEDA. Plugin entry is triggered via `headerMenus` → `activate()`. Check browser console filtered by `[lceda-ai-assistant]` for:
- `activate` → `capability_report` → `typed_host_probe` → `typed_document_context`

If `capability_missing` appears, the host API is missing required capabilities.

## Key Constraints

- The agent **must** use Tool Calling to interact with all external capabilities — never direct function calls from the LLM response handler
- The plugin runs in a browser-like sandboxed environment inside JLCEDA; no Node.js APIs available at runtime (PoCs use `tsx` but the built plugin cannot)
- Draft application requires all devices to be confirmed (resolved from library) before `applyPlan` is allowed
- Tests use `node:test` and `node:assert/strict` — not jest/vitest
