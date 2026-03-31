# Codex 类编程智能体架构原理

## 概述

Codex 类编程智能体（如 GitHub Copilot、Cursor、Windsurf、Claude Code）的核心是一个**多轮对话 + 工具调用**的 Agent 系统，专门针对代码编辑场景优化。

## 核心架构

### 1. 整体流程

```
用户输入
  ↓
意图识别 (Intent Classification)
  ↓
上下文收集 (Context Gathering)
  ├─ 代码库索引 (Codebase Index)
  ├─ 文件内容 (File Content)
  ├─ 符号定义 (Symbol Definitions)
  ├─ 依赖关系 (Dependencies)
  └─ 历史对话 (Conversation History)
  ↓
规划阶段 (Planning)
  ├─ 分解任务 (Task Decomposition)
  ├─ 确定文件范围 (File Scope)
  └─ 生成执行计划 (Execution Plan)
  ↓
执行阶段 (Execution)
  ├─ 工具调用循环 (Tool Call Loop)
  │   ├─ 搜索代码 (Search Code)
  │   ├─ 读取文件 (Read File)
  │   ├─ 编辑文件 (Edit File)
  │   ├─ 运行命令 (Run Command)
  │   └─ 验证结果 (Verify Result)
  └─ 自我修正 (Self-Correction)
  ↓
验证阶段 (Verification)
  ├─ 语法检查 (Syntax Check)
  ├─ 类型检查 (Type Check)
  ├─ 测试运行 (Test Run)
  └─ Lint 检查 (Lint Check)
  ↓
输出结果
```

### 2. 关键组件

#### 2.1 上下文管理器 (Context Manager)

**职责：** 智能收集和管理代码上下文

**实现原理：**

```typescript
class ContextManager {
  // 1. 代码库索引（使用向量数据库）
  private codebaseIndex: VectorStore;
  
  // 2. 符号表（AST 解析）
  private symbolTable: Map<string, SymbolInfo>;
  
  // 3. 依赖图
  private dependencyGraph: DependencyGraph;
  
  async gatherContext(userQuery: string, currentFile?: string): Promise<Context> {
    // Step 1: 语义搜索相关代码
    const relevantFiles = await this.semanticSearch(userQuery);
    
    // Step 2: 分析当前文件的依赖
    const dependencies = await this.analyzeDependencies(currentFile);
    
    // Step 3: 提取符号定义
    const symbols = await this.extractSymbols([...relevantFiles, ...dependencies]);
    
    // Step 4: 构建上下文窗口（考虑 token 限制）
    return this.buildContextWindow({
      query: userQuery,
      currentFile,
      relevantFiles,
      dependencies,
      symbols,
      maxTokens: 100000, // Claude 的上下文窗口
    });
  }
  
  private async semanticSearch(query: string): Promise<string[]> {
    // 使用向量数据库搜索相关代码
    const embedding = await this.embedQuery(query);
    const results = await this.codebaseIndex.similaritySearch(embedding, 10);
    return results.map(r => r.filePath);
  }
  
  private async analyzeDependencies(file: string): Promise<string[]> {
    // 分析 import/require 语句
    const ast = await this.parseFile(file);
    const imports = this.extractImports(ast);
    
    // 递归分析依赖（限制深度）
    return this.resolveDependencies(imports, maxDepth: 2);
  }
}
```

**关键技术：**
- **向量数据库**：使用 Embeddings 进行语义搜索（如 Pinecone, Weaviate）
- **AST 解析**：使用 Tree-sitter 或语言特定的 parser
- **依赖分析**：静态分析 import/require 语句
- **智能截断**：根据相关性和 token 限制动态调整上下文

#### 2.2 规划器 (Planner)

**职责：** 将用户意图分解为可执行的步骤

**实现原理：**

```typescript
class Planner {
  async plan(userQuery: string, context: Context): Promise<ExecutionPlan> {
    // 使用 LLM 生成执行计划
    const planPrompt = `
You are a code editing planner. Given the user's request and codebase context,
create a step-by-step plan to accomplish the task.

User Request: ${userQuery}

Available Context:
${this.formatContext(context)}

Available Tools:
- search_code(query: string): Search for code snippets
- read_file(path: string, lines?: [start, end]): Read file content
- edit_file(path: string, edits: Edit[]): Apply edits to a file
- run_command(command: string): Execute shell command
- get_diagnostics(path: string): Get syntax/type errors

Generate a JSON plan with the following structure:
{
  "steps": [
    {
      "action": "search_code" | "read_file" | "edit_file" | "run_command",
      "params": {...},
      "reasoning": "Why this step is needed"
    }
  ],
  "estimated_files": ["list of files to modify"],
  "risks": ["potential issues to watch for"]
}
`;

    const response = await this.llm.generate(planPrompt);
    return this.parsePlan(response);
  }
}
```

**关键特点：**
- **任务分解**：将复杂任务拆分为小步骤
- **文件范围预测**：提前识别需要修改的文件
- **风险评估**：识别潜在的破坏性操作

#### 2.3 工具系统 (Tool System)

**职责：** 提供代码操作的原子能力

**核心工具：**

```typescript
// 1. 代码搜索工具
class SearchCodeTool {
  name = "search_code";
  description = "Search for code snippets using semantic or regex search";
  
  async execute(params: { query: string; type?: "semantic" | "regex" }): Promise<SearchResult[]> {
    if (params.type === "semantic") {
      return this.semanticSearch(params.query);
    } else {
      return this.regexSearch(params.query);
    }
  }
}

// 2. 文件读取工具
class ReadFileTool {
  name = "read_file";
  description = "Read file content with optional line range";
  
  async execute(params: { path: string; lines?: [number, number] }): Promise<string> {
    const content = await fs.readFile(params.path, "utf-8");
    if (params.lines) {
      const [start, end] = params.lines;
      return content.split("\n").slice(start - 1, end).join("\n");
    }
    return content;
  }
}

// 3. 文件编辑工具（最核心）
class EditFileTool {
  name = "edit_file";
  description = "Apply precise edits to a file";
  
  async execute(params: {
    path: string;
    edits: Array<{
      type: "insert" | "replace" | "delete";
      start_line: number;
      end_line?: number;
      content?: string;
    }>;
  }): Promise<EditResult> {
    // 1. 读取原文件
    const original = await fs.readFile(params.path, "utf-8");
    const lines = original.split("\n");
    
    // 2. 应用编辑（从后往前，避免行号偏移）
    const sortedEdits = params.edits.sort((a, b) => b.start_line - a.start_line);
    
    for (const edit of sortedEdits) {
      switch (edit.type) {
        case "insert":
          lines.splice(edit.start_line, 0, edit.content);
          break;
        case "replace":
          lines.splice(edit.start_line, edit.end_line - edit.start_line + 1, edit.content);
          break;
        case "delete":
          lines.splice(edit.start_line, edit.end_line - edit.start_line + 1);
          break;
      }
    }
    
    // 3. 写回文件
    const modified = lines.join("\n");
    await fs.writeFile(params.path, modified, "utf-8");
    
    // 4. 生成 diff
    const diff = this.generateDiff(original, modified);
    
    return {
      success: true,
      diff,
      path: params.path,
    };
  }
}

// 4. 命令执行工具
class RunCommandTool {
  name = "run_command";
  description = "Execute shell command and return output";
  
  async execute(params: { command: string; cwd?: string }): Promise<CommandResult> {
    const { stdout, stderr, exitCode } = await exec(params.command, {
      cwd: params.cwd || process.cwd(),
      timeout: 30000, // 30 秒超时
    });
    
    return {
      stdout,
      stderr,
      exitCode,
      success: exitCode === 0,
    };
  }
}

// 5. 诊断工具
class GetDiagnosticsTool {
  name = "get_diagnostics";
  description = "Get syntax, type, and lint errors for a file";
  
  async execute(params: { path: string }): Promise<Diagnostic[]> {
    // 使用 LSP (Language Server Protocol) 获取诊断信息
    const diagnostics = await this.lspClient.getDiagnostics(params.path);
    
    return diagnostics.map(d => ({
      severity: d.severity, // error, warning, info
      message: d.message,
      line: d.range.start.line,
      column: d.range.start.character,
      source: d.source, // typescript, eslint, etc.
    }));
  }
}
```

#### 2.4 执行引擎 (Execution Engine)

**职责：** 执行计划并处理工具调用循环

**实现原理（ReAct 模式）：**

```typescript
class ExecutionEngine {
  async execute(plan: ExecutionPlan, context: Context): Promise<ExecutionResult> {
    const state = {
      currentStep: 0,
      observations: [],
      modifiedFiles: new Set<string>(),
      errors: [],
    };
    
    // ReAct 循环：Reason → Act → Observe
    while (state.currentStep < plan.steps.length) {
      const step = plan.steps[state.currentStep];
      
      // 1. Reason: 生成当前步骤的推理
      const reasoning = await this.generateReasoning(step, state);
      
      // 2. Act: 执行工具调用
      const action = await this.executeTool(step.action, step.params);
      
      // 3. Observe: 观察结果
      const observation = await this.observeResult(action);
      state.observations.push(observation);
      
      // 4. 自我修正：如果出错，尝试修复
      if (observation.hasError) {
        const correction = await this.attemptCorrection(observation, state);
        if (correction.success) {
          state.observations.push(correction.observation);
        } else {
          state.errors.push(observation.error);
          break; // 无法修正，终止执行
        }
      }
      
      // 5. 验证：检查语法和类型错误
      if (step.action === "edit_file") {
        const diagnostics = await this.tools.get_diagnostics.execute({
          path: step.params.path,
        });
        
        if (diagnostics.some(d => d.severity === "error")) {
          // 尝试自动修复
          const fixed = await this.autoFix(step.params.path, diagnostics);
          if (!fixed) {
            state.errors.push({
              step: state.currentStep,
              message: "Introduced syntax/type errors",
              diagnostics,
            });
          }
        }
      }
      
      state.currentStep++;
    }
    
    return {
      success: state.errors.length === 0,
      modifiedFiles: Array.from(state.modifiedFiles),
      observations: state.observations,
      errors: state.errors,
    };
  }
  
  private async attemptCorrection(
    observation: Observation,
    state: ExecutionState
  ): Promise<CorrectionResult> {
    // 使用 LLM 分析错误并生成修正方案
    const correctionPrompt = `
The previous action failed with the following error:
${observation.error}

Previous observations:
${state.observations.map(o => o.summary).join("\n")}

Analyze the error and suggest a correction. You can:
1. Retry with different parameters
2. Use a different tool
3. Skip this step if it's not critical

Respond with a JSON correction plan.
`;

    const response = await this.llm.generate(correctionPrompt);
    const correction = this.parseCorrection(response);
    
    // 执行修正
    const result = await this.executeTool(correction.action, correction.params);
    
    return {
      success: !result.hasError,
      observation: result,
    };
  }
}
```

#### 2.5 验证器 (Validator)

**职责：** 确保代码修改不会破坏现有功能

**实现原理：**

```typescript
class Validator {
  async validate(modifiedFiles: string[]): Promise<ValidationResult> {
    const results = {
      syntax: [],
      types: [],
      tests: [],
      lint: [],
    };
    
    // 1. 语法检查
    for (const file of modifiedFiles) {
      const syntaxErrors = await this.checkSyntax(file);
      if (syntaxErrors.length > 0) {
        results.syntax.push({ file, errors: syntaxErrors });
      }
    }
    
    // 2. 类型检查（TypeScript/Python 等）
    const typeErrors = await this.checkTypes(modifiedFiles);
    results.types = typeErrors;
    
    // 3. 运行测试（如果有）
    const testResults = await this.runTests(modifiedFiles);
    results.tests = testResults;
    
    // 4. Lint 检查
    const lintErrors = await this.runLint(modifiedFiles);
    results.lint = lintErrors;
    
    return {
      passed: this.allChecksPassed(results),
      results,
    };
  }
  
  private async checkSyntax(file: string): Promise<SyntaxError[]> {
    // 使用语言特定的 parser
    const parser = this.getParser(file);
    const ast = await parser.parse(file);
    return ast.errors;
  }
  
  private async checkTypes(files: string[]): Promise<TypeError[]> {
    // 使用 LSP 或 tsc/mypy 等工具
    return this.lspClient.checkTypes(files);
  }
  
  private async runTests(files: string[]): Promise<TestResult[]> {
    // 查找相关测试文件
    const testFiles = await this.findRelatedTests(files);
    
    // 运行测试
    const results = await this.testRunner.run(testFiles);
    
    return results;
  }
}
```

### 3. 核心算法

#### 3.1 智能编辑算法

**问题：** 如何精确定位和修改代码？

**解决方案：** 使用 "搜索-替换" 模式

```typescript
interface EditInstruction {
  // 搜索模式（精确匹配）
  search: string;
  
  // 替换内容
  replace: string;
  
  // 可选：行号提示
  lineHint?: number;
}

class SmartEditor {
  async applyEdit(file: string, instruction: EditInstruction): Promise<EditResult> {
    const content = await fs.readFile(file, "utf-8");
    const lines = content.split("\n");
    
    // 1. 查找匹配位置
    const matches = this.findMatches(lines, instruction.search, instruction.lineHint);
    
    if (matches.length === 0) {
      return { success: false, error: "Search pattern not found" };
    }
    
    if (matches.length > 1) {
      // 多个匹配，使用行号提示或上下文消歧
      const bestMatch = this.disambiguate(matches, instruction);
      return this.replaceAt(lines, bestMatch, instruction.replace);
    }
    
    // 2. 单个匹配，直接替换
    return this.replaceAt(lines, matches[0], instruction.replace);
  }
  
  private findMatches(
    lines: string[],
    search: string,
    lineHint?: number
  ): Match[] {
    const searchLines = search.split("\n");
    const matches: Match[] = [];
    
    // 滑动窗口匹配
    for (let i = 0; i <= lines.length - searchLines.length; i++) {
      const window = lines.slice(i, i + searchLines.length);
      
      if (this.fuzzyMatch(window, searchLines)) {
        const score = lineHint ? this.scoreByDistance(i, lineHint) : 1.0;
        matches.push({ startLine: i, endLine: i + searchLines.length - 1, score });
      }
    }
    
    return matches.sort((a, b) => b.score - a.score);
  }
  
  private fuzzyMatch(actual: string[], expected: string[]): boolean {
    // 忽略前导/尾随空格，但保留缩进结构
    for (let i = 0; i < actual.length; i++) {
      const actualTrimmed = actual[i].trim();
      const expectedTrimmed = expected[i].trim();
      
      if (actualTrimmed !== expectedTrimmed) {
        return false;
      }
    }
    return true;
  }
}
```

**关键技术：**
- **模糊匹配**：忽略空格差异，但保留结构
- **上下文消歧**：使用行号提示和周围代码
- **原子性**：要么全部成功，要么全部回滚

#### 3.2 上下文窗口管理

**问题：** 如何在有限的 token 窗口内包含最相关的代码？

**解决方案：** 分层优先级系统

```typescript
class ContextWindowManager {
  async buildWindow(
    query: string,
    currentFile: string,
    maxTokens: number
  ): Promise<ContextWindow> {
    // 优先级分层
    const layers = {
      critical: [],    // 必须包含（当前文件、直接依赖）
      important: [],   // 重要（间接依赖、相关定义）
      helpful: [],     // 有帮助（相似代码、文档）
      optional: [],    // 可选（其他上下文）
    };
    
    // 1. Critical: 当前文件和直接依赖
    layers.critical.push({
      type: "file",
      path: currentFile,
      content: await this.readFile(currentFile),
      tokens: this.countTokens(currentFile),
    });
    
    const directDeps = await this.getDirectDependencies(currentFile);
    for (const dep of directDeps) {
      layers.critical.push({
        type: "dependency",
        path: dep,
        content: await this.readFile(dep),
        tokens: this.countTokens(dep),
      });
    }
    
    // 2. Important: 语义搜索结果
    const semanticResults = await this.semanticSearch(query, 5);
    layers.important.push(...semanticResults);
    
    // 3. Helpful: 符号定义
    const symbols = await this.extractRelevantSymbols(query);
    layers.helpful.push(...symbols);
    
    // 4. 按优先级填充窗口
    return this.fillWindow(layers, maxTokens);
  }
  
  private fillWindow(
    layers: ContextLayers,
    maxTokens: number
  ): ContextWindow {
    const window = [];
    let usedTokens = 0;
    
    // 按优先级顺序填充
    for (const layer of ["critical", "important", "helpful", "optional"]) {
      for (const item of layers[layer]) {
        if (usedTokens + item.tokens <= maxTokens) {
          window.push(item);
          usedTokens += item.tokens;
        } else {
          // 尝试截断
          const truncated = this.truncate(item, maxTokens - usedTokens);
          if (truncated) {
            window.push(truncated);
            usedTokens += truncated.tokens;
          }
          break;
        }
      }
    }
    
    return { items: window, totalTokens: usedTokens };
  }
}
```

#### 3.3 自我修正机制

**问题：** 如何处理 LLM 生成的错误代码？

**解决方案：** 多轮验证和修正

```typescript
class SelfCorrection {
  async correctErrors(
    file: string,
    diagnostics: Diagnostic[]
  ): Promise<CorrectionResult> {
    const maxAttempts = 3;
    let attempt = 0;
    
    while (attempt < maxAttempts && diagnostics.length > 0) {
      // 1. 分析错误
      const analysis = await this.analyzeErrors(file, diagnostics);
      
      // 2. 生成修正方案
      const correction = await this.generateCorrection(file, analysis);
      
      // 3. 应用修正
      await this.applyCorrection(file, correction);
      
      // 4. 重新验证
      diagnostics = await this.validator.checkFile(file);
      
      attempt++;
    }
    
    return {
      success: diagnostics.length === 0,
      attempts: attempt,
      remainingErrors: diagnostics,
    };
  }
  
  private async generateCorrection(
    file: string,
    analysis: ErrorAnalysis
  ): Promise<Correction> {
    const prompt = `
You previously edited this file but introduced errors:

File: ${file}

Errors:
${analysis.errors.map(e => `Line ${e.line}: ${e.message}`).join("\n")}

Original code around errors:
${analysis.context}

Fix these errors while preserving the intended functionality.
Use the edit_file tool with precise search-replace instructions.
`;

    const response = await this.llm.generate(prompt);
    return this.parseCorrection(response);
  }
}
```

### 4. 与你的项目对比

#### 你的项目（嘉立创 EDA AI）

```typescript
// 当前架构
runAnalysisReactAgent()
  → thought("Overview", "先按器件分类...")
  → invokeObserved("schematic.summarize_bom", ...)
  → thought("Knowledge", "先读取工程知识...")
  → invokeObserved("mcp.list_resources", ...)
  → thought("Rules", "开始执行原理图检查...")
  → invokeObserved("rules.run_schematic_checks", ...)
  → final("分析完成")
```

**特点：**
- 固定的执行流程
- 预定义的步骤顺序
- 工具调用是确定性的

#### Codex 类 Agent

```typescript
// Codex 架构
AgentExecutor.invoke()
  → LLM 决定下一步行动
  → 可能调用 search_code
  → LLM 分析搜索结果，决定读取哪些文件
  → 可能调用 read_file
  → LLM 分析文件内容，决定如何编辑
  → 可能调用 edit_file
  → LLM 检查编辑结果，决定是否需要修正
  → 可能再次调用 edit_file
  → LLM 决定任务完成
```

**特点：**
- 动态的执行流程
- LLM 自主决定步骤
- 工具调用是非确定性的

### 5. 关键差异

| 维度 | 你的项目 | Codex 类 Agent |
|------|---------|---------------|
| **执行模式** | 固定流程 | 动态规划 |
| **工具调用** | 预定义顺序 | LLM 自主决定 |
| **上下文管理** | 全量加载 | 智能检索 |
| **错误处理** | 手动回退 | 自我修正 |
| **适用场景** | 结构化分析 | 开放式编辑 |

### 6. 改进建议

如果要让你的项目更接近 Codex 的能力：

#### 6.1 引入动态规划

```typescript
// 不要固定步骤，让 LLM 决定
async function runDynamicAnalysisAgent(deps: ReactAgentDeps): Promise<ReactAgentRunResult> {
  const executor = new AgentExecutor({
    agent: createReactAgent({
      llm,
      tools: convertToolsToLangChain(deps),
      prompt: ChatPromptTemplate.fromMessages([
        ["system", `你是原理图分析专家。可用工具：
- schematic.summarize_bom: 提取 BOM
- schematic.identify_key_components: 识别关键器件
- rules.run_schematic_checks: 执行规则检查
- library.search_devices