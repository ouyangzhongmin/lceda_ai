# UI 显示问题修复方案

## 问题分析

### 问题 1：用户输入后 AI 生成中的卡片延迟几秒才出现

**根本原因：**
1. `commitState` 虽然会分发事件，但如果紧接着执行 `planUserTurn` 等异步操作，iframe 可能还没来得及处理第一次的状态更新
2. JavaScript 事件循环机制：同步代码会一直执行到完成，才会处理事件队列中的事件
3. `syncUI()` 中的版本检查：如果版本号相同会跳过更新

**解决方案：**
在 `commitState` 后添加微任务延迟，让浏览器有机会处理事件队列和渲染：

```typescript
// 在 assistantRuntime.ts 的 sendChat 中
current.chatMessages = nextMessages;
current.agentRunState = "planning";
current.agentRunDetail = "正在规划本轮 agent 执行";

if (typeof console !== "undefined") {
  console.log(`${LOG_PREFIX} sendChat.pending-message-added`, {
    messageCount: nextMessages.length,
    agentRunState: current.agentRunState,
  });
}

commitState(internals, current, storage);

if (typeof console !== "undefined") {
  console.log(`${LOG_PREFIX} sendChat.state-committed`, {
    version: internals.stateVersion,
    willWait: true,
  });
}

// 关键修复：使用 setTimeout 让出执行权，让浏览器处理事件和渲染
// 50ms 足够让 iframe 接收事件、更新状态、渲染 DOM
await new Promise(resolve => setTimeout(resolve, 50));

if (typeof console !== "undefined") {
  console.log(`${LOG_PREFIX} sendChat.after-delay`, {
    version: internals.stateVersion,
    proceedingToPlanning: true,
  });
}

// 继续执行后续操作
internals.pendingChatInput = trimmed;
// ...
```

**工作原理：**
1. 添加 pending 消息 → `commitState` → 分发 `FRAME_STATE_EVENT` 事件
2. `await setTimeout(50)` → **将后续代码放入宏任务队列**
3. **浏览器处理当前事件队列**：iframe 接收事件 → `syncUI()` → `renderChat()` → 渲染 DOM
4. **浏览器执行渲染**：用户看到"处理中"卡片
5. 50ms 后继续执行 `planUserTurn` 等操作

### 问题 2：Step 的样式一直在变化

**根本原因：**
- 存在多个步骤渲染函数：
  - `renderStepsSection()` - 旧版本，带折叠按钮
  - `renderPhaseGroupedSteps()` - 分组渲染
  - `ensureStepsUI()` - 增量渲染
  - `renderPhaseGroupedStepsIncremental()` - 增量更新
- 这些函数在不同时机被调用，导致样式不一致
- 流式更新时会重建 DOM 结构，导致闪烁

**解决方案：**
1. 统一使用一个简洁的渲染函数 `renderStepsSimple()`
2. 固定样式，不再动态切换
3. 使用增量更新而不是重建整个 DOM
4. 移除所有折叠/展开逻辑，保持简洁

```typescript
function renderStepsSimple(reactEvents) {
  if (!reactEvents || reactEvents.length === 0) return null;
  
  const container = document.createElement("div");
  container.className = "steps-container-simple"; // 固定 class
  
  reactEvents.forEach((event, idx) => {
    const item = document.createElement("div");
    item.className = "step-item-simple"; // 固定 class
    
    // 简洁的图标 + 标题 + 状态
    const icon = document.createElement("div");
    icon.className = "step-icon-simple";
    icon.textContent = event.kind === "thought" ? "💭" : "🔧";
    
    const title = document.createElement("div");
    title.className = "step-title-simple";
    title.textContent = event.label || event.toolName || `步骤 ${idx + 1}`;
    
    const status = document.createElement("div");
    status.className = `step-status-simple ${event.status || "done"}`;
    status.textContent = event.status === "running" ? "进行中" : "完成";
    
    item.appendChild(icon);
    item.appendChild(title);
    item.appendChild(status);
    container.appendChild(item);
  });
  
  return container;
}
```

### 问题 3：完成后 Step 显示的卡片直接消失了

**根本原因：**
1. 在 `patchMessageDom` 函数中，当 `nextStreaming` 为 false 时会调用 `activeUI.setOpen(false)` 自动折叠
2. CSS 中 `.steps-container` 默认是 `display: none`，只有添加 `.open` class 才显示
3. `ensureStepsUI(dom, nextStreaming)` 传递 `nextStreaming` 作为初始展开状态，完成时会初始化为折叠

**解决方案：**

1. **移除自动折叠逻辑**（第 1586 行）：
```typescript
// 移除这段代码：
if (!nextStreaming) {
  activeUI.setOpen && activeUI.setOpen(false);
  updateStepsCounter(activeUI);
}

// 改为：保持展开状态，让用户可以查看执行过程
```

2. **修改 CSS 默认显示**（第 399 行）：
```css
/* 原代码 */
.steps-container {
  display: none; /* 默认隐藏 */
}

/* 修改为 */
.steps-container {
  display: block; /* 默认显示 */
}
```

3. **始终以展开状态初始化**（第 1508、1521 行）：
```typescript
// 原代码
const stepsUI = ensureStepsUI(dom, nextStreaming); // 完成时为 false

// 修改为
const stepsUI = ensureStepsUI(dom, true); // 始终展开
```

**效果：**
- ✅ 执行过程中步骤展开显示
- ✅ 完成后步骤保持展开，用户可以查看执行历史
- ✅ 用户可以手动点击按钮折叠/展开步骤

## 实施步骤

### 1. 修复 assistantRuntime.ts

在 `sendChat` 方法中，添加立即触发状态事件的代码：

```typescript
// 文件：plugin/src/app/assistantRuntime.ts
// 位置：sendChat 方法中添加 pending 消息后

current.chatMessages = nextMessages;
current.agentRunState = "planning";
current.agentRunDetail = "正在规划本轮 agent 执行";
const immediateState = commitState(internals, current, storage);

// 新增：立即触发状态事件
if (typeof window !== "undefined") {
  window.dispatchEvent(new CustomEvent(FRAME_STATE_EVENT, { detail: immediateState }));
}
```

### 2. 简化 iframe 渲染逻辑

替换 `plugin/iframe/index.html` 中的步骤渲染逻辑：

1. 移除所有旧的渲染函数：
   - `renderStepsSection`
   - `renderPhaseGroupedSteps`
   - `renderPhaseGroupedStepsIncremental`
   - `ensureStepsUI`

2. 使用新的简洁渲染函数 `renderStepsSimple`

3. 在 `patchMessageDom` 中移除自动折叠逻辑

### 3. 简化 CSS 样式

移除复杂的步骤样式，使用固定的简洁样式：

```css
/* 简洁的步骤展示 - 固定样式 */
.steps-container-simple {
  margin-top: 12px;
  padding: 12px;
  border-radius: 8px;
  background: #F8FAFC;
  border: 1px solid var(--border);
}

.step-item-simple {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 0;
  font-size: 13px;
  color: var(--text);
  border-bottom: 1px dashed rgba(226, 232, 240, 0.6);
}

.step-item-simple:last-child {
  border-bottom: none;
}

.step-icon-simple {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  color: var(--text-sec);
}

.step-title-simple {
  flex: 1;
  font-weight: 500;
}

.step-status-simple {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 4px;
  font-weight: 600;
}

.step-status-simple.running {
  background: rgba(59, 130, 246, 0.12);
  color: #2563EB;
}

.step-status-simple.done {
  background: rgba(16, 185, 129, 0.12);
  color: #059669;
}
```

## 测试验证

### 测试场景 1：立即显示处理中卡片
1. 输入消息并点击发送
2. 验证：助手消息卡片应立即出现（< 100ms）
3. 验证：卡片显示"处理中"状态

### 测试场景 2：步骤样式保持一致
1. 观察步骤渲染过程
2. 验证：步骤样式从开始到结束保持一致
3. 验证：没有闪烁或重建

### 测试场景 3：完成后步骤保持显示
1. 等待任务完成
2. 验证：步骤列表仍然可见
3. 验证：状态从"进行中"变为"完成"
4. 验证：没有自动折叠

## 附加优化

### 1. 提高状态同步频率

在 iframe 中增加轮询频率：

```javascript
// 从 500ms 提高到 100ms
setInterval(syncUI, 100);
```

### 2. 移除不必要的动画

简化动画效果，减少视觉干扰：

```css
@keyframes slideIn {
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: translateY(0); }
}

.message-row {
  animation: slideIn 200ms ease; /* 从 300ms 减少到 200ms */
}
```

### 3. 优化滚动行为

确保新消息出现时自动滚动到底部：

```javascript
function scrollToBottom(list, force) {
  if (!list || !list.parentElement) return;
  const scroller = list.parentElement;
  const nearBottom = scroller.scrollHeight - (scroller.scrollTop + scroller.clientHeight) < 160;
  if (force || nearBottom) {
    scroller.scrollTop = scroller.scrollHeight;
  }
}
```

## 总结

这三个问题的根本原因都是：
1. **延迟问题**：状态更新没有立即触发 UI 刷新
2. **样式变化**：多个渲染函数导致样式不一致
3. **步骤消失**：自动折叠逻辑导致完成后步骤隐藏

解决方案的核心思路：
1. **立即响应**：状态更新后立即触发事件
2. **统一样式**：使用单一简洁的渲染函数
3. **保持显示**：移除自动折叠，完成后保持步骤可见

修复后的效果：
- ✅ 用户输入后立即看到"处理中"卡片
- ✅ 步骤样式从开始到结束保持一致
- ✅ 完成后步骤列表保持显示，方便用户查看执行过程
