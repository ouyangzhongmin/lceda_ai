#!/bin/bash

# UI 时序修复测试脚本

echo "🔨 开始编译插件..."
cd "$(dirname "$0")"

# 编译
npm run build

if [ $? -eq 0 ]; then
    echo "✅ 编译成功！"
    echo ""
    echo "📋 测试步骤："
    echo "1. 重新加载 EDA 应用"
    echo "2. 打开开发者工具 (F12 或 Cmd+Option+I)"
    echo "3. 切换到 Console 标签"
    echo "4. 发送一条测试消息"
    echo ""
    echo "🔍 观察日志顺序："
    echo "   [runtime] sendChat.pending-message-added"
    echo "   [runtime] state.commit"
    echo "   [runtime] sendChat.state-committed"
    echo "   [iframe] state.update"
    echo "   [iframe] renderChat.append-new"
    echo "   [iframe] renderChat.appended (role: assistant, streaming: true)"
    echo "   [runtime] sendChat.after-delay"
    echo ""
    echo "✅ 成功标志："
    echo "   - 从 state-committed 到 renderChat.appended < 100ms"
    echo "   - 助手卡片立即可见"
    echo "   - 显示'处理中'状态"
    echo ""
    echo "详细测试指南: plugin/test-ui-timing.md"
else
    echo "❌ 编译失败！"
    exit 1
fi
