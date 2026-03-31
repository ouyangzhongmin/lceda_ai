package handlers

const loginPageHTML = `<!doctype html>
<html lang="zh-Hans">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>LCEDA AI 助手 - 登录</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    :root {
      /* Soft UI Evolution Design System */
      --color-bg: #F8FAFC;
      --color-surface: #FFFFFF;
      --color-primary: #0EA5E9;
      --color-primary-hover: #0284C7;
      --color-primary-light: #E0F2FE;
      --color-text: #0F172A;
      --color-text-secondary: #64748B;
      --color-text-tertiary: #94A3B8;
      --color-border: #E2E8F0;
      --color-success: #10B981;
      --color-error: #EF4444;
      --color-warning: #F59E0B;
      
      --shadow-sm: 0 2px 4px -1px rgb(0 0 0 / 0.06);
      --shadow-md: 0 4px 6px -1px rgb(0 0 0 / 0.08);
      --shadow-lg: 0 10px 15px -3px rgb(0 0 0 / 0.08);
      --shadow-xl: 0 20px 25px -5px rgb(0 0 0 / 0.1);
      
      --radius-md: 10px;
      --radius-lg: 14px;
      --radius-xl: 18px;
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif;
      background: linear-gradient(135deg, #F8FAFC 0%, #E0F2FE 100%);
      color: var(--color-text);
      line-height: 1.6;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
      -webkit-font-smoothing: antialiased;
    }

    .login-container {
      width: 100%;
      max-width: 420px;
    }

    .login-card {
      background: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-xl);
      padding: 48px 40px;
      box-shadow: var(--shadow-xl);
    }

    .logo-section {
      text-align: center;
      margin-bottom: 32px;
    }

    .logo {
      width: 64px;
      height: 64px;
      margin: 0 auto 20px;
      border-radius: var(--radius-lg);
      background: linear-gradient(135deg, #0EA5E9 0%, #0284C7 100%);
      display: flex;
      align-items: center;
      justify-content: center;
      color: white;
      font-size: 28px;
      font-weight: 700;
      box-shadow: 0 8px 16px rgba(14, 165, 233, 0.3);
    }

    .logo-title {
      font-size: 24px;
      font-weight: 600;
      color: var(--color-text);
      margin-bottom: 8px;
      letter-spacing: -0.02em;
    }

    .logo-subtitle {
      font-size: 14px;
      color: var(--color-text-secondary);
    }

    .session-info {
      background: var(--color-bg);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-md);
      padding: 12px 16px;
      margin-bottom: 32px;
      font-family: 'Fira Code', 'SF Mono', monospace;
      font-size: 12px;
      color: var(--color-text-tertiary);
      text-align: center;
      word-break: break-all;
    }

    .form-group {
      margin-bottom: 20px;
    }

    .form-label {
      display: block;
      font-size: 14px;
      font-weight: 500;
      color: var(--color-text);
      margin-bottom: 8px;
    }

    .form-input {
      width: 100%;
      height: 44px;
      padding: 0 16px;
      border: 1.5px solid var(--color-border);
      border-radius: var(--radius-md);
      font-size: 14px;
      font-family: inherit;
      color: var(--color-text);
      background: var(--color-surface);
      transition: all 200ms ease;
    }

    .form-input:focus {
      outline: none;
      border-color: var(--color-primary);
      box-shadow: 0 0 0 4px var(--color-primary-light);
    }

    .form-input::placeholder {
      color: var(--color-text-tertiary);
    }

    .input-with-button {
      display: flex;
      gap: 8px;
      align-items: flex-end;
    }

    .input-with-button .form-input {
      flex: 1;
    }

    .button-group {
      display: flex;
      gap: 12px;
      margin-bottom: 24px;
    }

    .button-full {
      width: 100%;
    }

    .btn {
      height: 44px;
      border: 0;
      border-radius: var(--radius-md);
      font-size: 14px;
      font-weight: 600;
      font-family: inherit;
      cursor: pointer;
      transition: all 200ms cubic-bezier(0.4, 0, 0.2, 1);
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      white-space: nowrap;
    }

    .btn-sm {
      height: 36px;
      padding: 0 16px;
      font-size: 13px;
    }

    .btn-primary {
      background: linear-gradient(135deg, #0EA5E9 0%, #0284C7 100%);
      color: white;
      box-shadow: 0 2px 8px rgba(14, 165, 233, 0.3);
    }

    .btn-primary:hover:not(:disabled) {
      box-shadow: 0 4px 12px rgba(14, 165, 233, 0.4);
      transform: translateY(-1px);
    }

    .btn-primary:active:not(:disabled) {
      transform: translateY(0);
    }

    .btn-secondary {
      background: var(--color-bg);
      color: var(--color-text);
      border: 1px solid var(--color-border);
    }

    .btn-secondary:hover:not(:disabled) {
      background: white;
      border-color: var(--color-primary);
      color: var(--color-primary);
    }

    .btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
      transform: none !important;
    }

    .divider {
      position: relative;
      text-align: center;
      margin: 28px 0;
    }

    .divider::before {
      content: '';
      position: absolute;
      top: 50%;
      left: 0;
      right: 0;
      height: 1px;
      background: var(--color-border);
    }

    .divider-text {
      position: relative;
      display: inline-block;
      background: var(--color-surface);
      padding: 0 16px;
      font-size: 13px;
      color: var(--color-text-secondary);
    }

    .alert {
      padding: 12px 16px;
      border-radius: var(--radius-md);
      font-size: 13px;
      margin-top: 20px;
      display: none;
      animation: slideDown 300ms ease;
    }

    .alert.show {
      display: block;
    }

    @keyframes slideDown {
      from {
        opacity: 0;
        transform: translateY(-8px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }

    .alert-success {
      background: rgba(16, 185, 129, 0.1);
      color: var(--color-success);
      border: 1px solid rgba(16, 185, 129, 0.2);
    }

    .alert-error {
      background: rgba(239, 68, 68, 0.1);
      color: var(--color-error);
      border: 1px solid rgba(239, 68, 68, 0.2);
    }

    .alert-warning {
      background: rgba(245, 158, 11, 0.1);
      color: var(--color-warning);
      border: 1px solid rgba(245, 158, 11, 0.2);
    }

    .wechat-icon {
      width: 18px;
      height: 18px;
    }

    @media (max-width: 480px) {
      .login-card {
        padding: 32px 24px;
      }

      .button-group {
        grid-template-columns: 1fr;
      }
    }

    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after {
        animation-duration: 0.01ms !important;
        transition-duration: 0.01ms !important;
      }
    }
  </style>
</head>
<body>
  <div class="login-container">
    <div class="login-card">
      <div class="logo-section">
        <div class="logo">AI</div>
        <h1 class="logo-title">LCEDA AI 助手</h1>
        <p class="logo-subtitle">在浏览器中完成登录，然后返回插件</p>
      </div>

      <div class="session-info" id="sessionInfo">正在加载会话信息...</div>

      <div class="form-group">
        <label class="form-label" for="email">邮箱地址</label>
        <div class="input-with-button">
          <input 
            id="email" 
            type="email" 
            class="form-input" 
            placeholder="请输入您的邮箱"
            autocomplete="email"
          />
          <button id="sendCode" class="btn btn-primary btn-sm">发送验证码</button>
        </div>
      </div>

      <div class="divider">
        <span class="divider-text">输入验证码</span>
      </div>

      <div class="form-group">
        <label class="form-label" for="code">验证码</label>
        <input 
          id="code" 
          type="text" 
          class="form-input" 
          placeholder="请输入 6 位验证码"
          maxlength="6"
          autocomplete="one-time-code"
        />
      </div>

      <div class="button-group">
        <button id="verifyCode" class="btn btn-primary button-full">验证登录</button>
      </div>

      <div class="divider">
        <span class="divider-text">或</span>
      </div>

      <button id="wechatLogin" class="btn btn-secondary button-full">
        <svg class="wechat-icon" viewBox="0 0 24 24" fill="currentColor">
          <path d="M8.691 2.188C3.891 2.188 0 5.476 0 9.53c0 2.212 1.17 4.203 3.002 5.55a.59.59 0 0 1 .213.665l-.39 1.48c-.019.07-.048.141-.048.213 0 .163.13.295.29.295a.326.326 0 0 0 .167-.054l1.903-1.114a.864.864 0 0 1 .717-.098 10.16 10.16 0 0 0 2.837.403c.276 0 .543-.027.811-.05-.857-2.578.157-4.972 1.932-6.446 1.703-1.415 3.882-1.98 5.853-1.838-.576-3.583-4.196-6.348-8.596-6.348zM5.785 5.991c.642 0 1.162.529 1.162 1.18a1.17 1.17 0 0 1-1.162 1.178A1.17 1.17 0 0 1 4.623 7.17c0-.651.52-1.18 1.162-1.18zm5.813 0c.642 0 1.162.529 1.162 1.18a1.17 1.17 0 0 1-1.162 1.178 1.17 1.17 0 0 1-1.162-1.178c0-.651.52-1.18 1.162-1.18zm5.34 2.867c-1.797-.052-3.746.512-5.28 1.786-1.72 1.428-2.687 3.72-1.78 6.22.942 2.453 3.666 4.229 6.884 4.229.826 0 1.622-.12 2.361-.336a.722.722 0 0 1 .598.082l1.584.926a.272.272 0 0 0 .14.047c.134 0 .24-.111.24-.247 0-.06-.023-.12-.038-.177l-.327-1.233a.582.582 0 0 1-.023-.156.49.49 0 0 1 .201-.398C23.024 18.48 24 16.82 24 14.98c0-3.21-2.931-5.837-6.656-6.088V8.89c-.135-.01-.27-.027-.407-.03zm-2.53 3.274c.535 0 .969.44.969.982a.976.976 0 0 1-.969.983.976.976 0 0 1-.969-.983c0-.542.434-.982.969-.982zm4.844 0c.535 0 .969.44.969.982a.976.976 0 0 1-.969.983.976.976 0 0 1-.969-.983c0-.542.434-.982.969-.982z"/>
        </svg>
        微信登录
      </button>

      <div id="status" class="alert"></div>
    </div>
  </div>
  <script>
    const statusEl = document.getElementById("status");
    const sessionInfo = document.getElementById("sessionInfo");
    const params = new URLSearchParams(window.location.search);
    const sessionId = params.get("session");
    const pollToken = params.get("poll_token");

    if (!sessionId || !pollToken) {
      sessionInfo.textContent = "缺少登录会话或轮询令牌";
      statusEl.textContent = "请从插件登录流程中打开此页面";
      statusEl.className = "alert alert-error show";
    } else {
      sessionInfo.textContent = "会话 ID: " + sessionId;
    }

    function setStatus(message, type) {
      statusEl.textContent = message;
      statusEl.className = "alert alert-" + (type || "warning") + " show";
    }

    async function sendCode() {
      const email = document.getElementById("email").value.trim();
      if (!sessionId || !pollToken) {
        setStatus("缺少会话或轮询令牌", "error");
        return;
      }
      if (!email) {
        setStatus("请输入邮箱地址", "error");
        return;
      }
      const res = await fetch("/api/v1/auth/email/send-code", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ login_session_id: sessionId, email, scene: "login" })
      });
      const json = await res.json();
      if (json.code !== 0) {
        setStatus(json.message || "发送验证码失败", "error");
        return;
      }
      setStatus("验证码已发送，请查收邮件", "success");
    }

    async function verifyCode() {
      const email = document.getElementById("email").value.trim();
      const code = document.getElementById("code").value.trim();
      if (!sessionId || !pollToken) {
        setStatus("缺少会话或轮询令牌", "error");
        return;
      }
      if (!email || !code) {
        setStatus("请输入邮箱和验证码", "error");
        return;
      }
      const res = await fetch("/api/v1/auth/email/verify-code", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ login_session_id: sessionId, email, code })
      });
      const json = await res.json();
      if (json.code !== 0) {
        setStatus(json.message || "验证失败", "error");
        return;
      }
      setStatus("登录成功！页面即将关闭...", "success");
      setTimeout(() => {
        window.close();
      }, 1500);
    }

    async function wechatLogin() {
      if (!sessionId || !pollToken) {
        setStatus("缺少会话或轮询令牌", "error");
        return;
      }
      const res = await fetch("/api/v1/auth/wechat/login-url", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ login_session_id: sessionId })
      });
      const json = await res.json();
      if (json.code !== 0) {
        setStatus(json.message || "微信登录不可用", "error");
        return;
      }
      window.location.href = json.data.authorize_url;
    }

    document.getElementById("sendCode").addEventListener("click", sendCode);
    document.getElementById("verifyCode").addEventListener("click", verifyCode);
    document.getElementById("wechatLogin").addEventListener("click", wechatLogin);
  </script>
</body>
</html>`
