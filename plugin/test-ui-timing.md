# UI 时序测试指南

## 测试目的
验证用户输入后 AI 助手卡片是否立即显示（< 100ms）

## 测试步骤

### 1. 编译插件
```bash
cd plugin
npm run build
```

### 2. 在 EDA 中加载插件
重新加载或重启 EDA 应用

### 3. 打开浏览器开发者工具
- 打开 EDA 的开发者工具（通常是 F12 或 Cmd+Option+I）
- 切换到 Console 标签页

### 4. 执行测试

#### 测试 1：发送简单消息
1. 在输入框输入："测试"
2. 点击发送按钮
3. **立即观察**：助手卡片是否立即出现

#### 预期日志顺序：
```
[LCEDA-AI][runtime] sendChat.start { promptLength: 2, hasState: true }
[LCEDA-AI][runtime] sendChat.pending-message-added { messageCount: 2, ... }
[LCEDA-AI][runtime] state.commit { version: X, agentRunState: "planning", ... }
[LCEDA-AI][runtime] sendChat.state-committed { version: X, willWait: true }
[LCEDA-AI][iframe] state.update { version: X, agentRunState: "planning", ... }
[LCEDA-AI][iframe] renderChat.start { messageCount: 2, ... }
[LCEDA-AI][iframe] renderChat.append-new { newCount: 2 }
[LCEDA-AI][iframe] renderChat.appended { index: 0, role: "user", ... }
[LCEDA-AI][iframe] renderChat.appended { index: 1, role: "assistant", streaming: true, ... }
[LCEDA-AI][runtime] sendChat.after-delay { version: X, proceedingToPlanning: true }
```

### 5. 验证点

#### ✅ 成功标志：
1. **时间差 < 100ms**：从 `sendChat.state-committed` 到 `renderChat.appended` 的时间差应该很小
2. **卡片立即可见**：用户点击发送后，立即看到"处理中"的助手卡片
3. **状态正确**：卡片显示"处理中"状态，内容为"正在思考..."

#### ❌ 失败标志：
1. **延迟 > 500ms**：从点击发送到卡片出现有明显延迟
2. **卡片不出现**：直到 agent 开始执行才出现卡片
3. **日志顺序错误**：`sendChat.after-delay` 出现在 `renderChat.appended` 之前

## 调试技巧

### 如果卡片仍然延迟出现：

#### 方案 1：增加延迟时间
在 `assistantRuntime.ts` 中修改：
```typescript
await new Promise(resolve => setTimeout(resolve, 100)); // 从 50ms 增加到 100ms
```

#### 方案 2：强制触发 UI 更新
在 `commitState` 后立即调用：
```typescript
commitState(internals, current, storage);

// 强制触发多次事件确保 iframe 接收到
if (typeof window !== "undefined") {
  window.dispatchEvent(new CustomEvent(FRAME_STATE_EVENT, { detail: current }));
  requestAnimationFrame(() => {
    window.dispatchEvent(new CustomEvent(FRAME_STATE_EVENT, { detail: current }));
  });
}
```

#### 方案 3：检查 iframe 轮询
确认 iframe 中的轮询间隔：
```javascript
// 在 iframe/index.html 中查找
setInterval(() => {
  try { syncUI(); } catch {}
}, 250); // 可以减少到 100ms
```

### 如果日志显示正常但 UI 不更新：

1. **检查 CSS 动画**：可能动画延迟导致视觉上的延迟
   - 在浏览器开发者工具中检查 `.message-row` 的动画
   - 临时禁用动画测试：在 Console 中执行
     ```javascript
     document.querySelectorAll('.message-row').forEach(el => {
       el.style.animation = 'none';
     });
     ```

2. **检查 DOM 是否真的添加了**：
   ```javascript
   // 在 Console 中执行
   document.querySelectorAll('.message-row').length
   ```

3. **检查滚动位置**：可能卡片添加了但被滚动隐藏
   ```javascript
   // 在 Console 中执行
   const scroller = document.querySelector('.chat-scroll');
   console.log({
     scrollTop: scroller.scrollTop,
     scrollHeight: scroller.scrollHeight,
     clientHeight: scroller.clientHeight,
   });
   ```

## 性能测量

### 使用 Performance API 测量精确时间：

在 `assistantRuntime.ts` 的 `sendChat` 开始处添加：
```typescript
const perfStart = performance.now();
console.log(`${LOG_PREFIX} sendChat.perf.start`, { time: perfStart });
```

在 iframe 的 `renderChat` 中添加：
```typescript
const perfRender = performance.now();
console.log(`${LOG_PREFIX} renderChat.perf`, { time: perfRender });
```

计算时间差：
```
渲染延迟 = perfRender - perfStart
```

**目标：< 100ms**

## 常见问题

### Q1: 日志显示 "state.update" 但没有 "renderChat"
**原因**：`syncUI` 的版本检查跳过了更新
**解决**：检查 `forceUpdate` 参数是否正确传递

### Q2: "renderChat.append-new" 显示 newCount: 0
**原因**：消息已经在之前的渲染中添加了
**解决**：检查是否有重复的 `commitState` 调用

### Q3: 卡片闪烁或重复渲染
**原因**：多次触发 `renderChat`
**解决**：检查事件监听器是否重复注册

## 回归测试

修复后需要测试的场景：

1. ✅ 发送第一条消息
2. ✅ 连续发送多条消息
3. ✅ 在 agent 执行过程中发送消息（应该被阻止）
4. ✅ 刷新页面后发送消息
5. ✅ 新建会话后发送消息

## 报告问题

如果问题仍然存在，请提供：
1. 完整的 Console 日志（从 `sendChat.start` 到 `renderChat.appended`）
2. 时间戳差异
3. 浏览器和操作系统版本
4. 是否有其他插件或扩展干扰
