#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { createRequire } from 'node:module';
import readline from 'node:readline/promises';

function parseArgs(argv) {
  const args = {
    keyword: '',
    downloadDir: path.resolve(process.cwd(), 'downloads/oshwhub'),
    maxItems: 1,
    headless: false,
    timeoutMs: 20000,
    slowMo: 80,
    debugDir: path.resolve(process.cwd(), 'results/playwright'),
    storageState: path.resolve(process.cwd(), 'results/playwright/oshwhub-storage-state.json'),
    userDataDir: path.resolve(process.cwd(), 'results/playwright/chromium-user-data'),
    prepareLogin: false,
    loginOnly: false,
    editorReadyWaitMs: 12000,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;

    const [k, inlineVal] = token.split('=');
    const nextVal = inlineVal ?? argv[i + 1];

    switch (k) {
      case '--keyword':
        args.keyword = inlineVal ?? nextVal ?? '';
        if (inlineVal == null) i += 1;
        break;
      case '--download-dir':
        args.downloadDir = path.resolve(inlineVal ?? nextVal ?? args.downloadDir);
        if (inlineVal == null) i += 1;
        break;
      case '--max-items':
        args.maxItems = Number.parseInt(inlineVal ?? nextVal ?? '1', 10);
        if (inlineVal == null) i += 1;
        break;
      case '--headless':
        {
          const raw = (inlineVal ?? nextVal ?? 'false').toLowerCase();
          args.headless = raw === '1' || raw === 'true' || raw === 'yes';
          if (inlineVal == null) i += 1;
        }
        break;
      case '--timeout-ms':
        args.timeoutMs = Number.parseInt(inlineVal ?? nextVal ?? '20000', 10);
        if (inlineVal == null) i += 1;
        break;
      case '--slow-mo':
        args.slowMo = Number.parseInt(inlineVal ?? nextVal ?? '80', 10);
        if (inlineVal == null) i += 1;
        break;
      case '--debug-dir':
        args.debugDir = path.resolve(inlineVal ?? nextVal ?? args.debugDir);
        if (inlineVal == null) i += 1;
        break;
      case '--storage-state':
        args.storageState = path.resolve(inlineVal ?? nextVal ?? args.storageState);
        if (inlineVal == null) i += 1;
        break;
      case '--user-data-dir':
        args.userDataDir = path.resolve(inlineVal ?? nextVal ?? args.userDataDir);
        if (inlineVal == null) i += 1;
        break;
      case '--prepare-login':
        {
          const raw = (inlineVal ?? nextVal ?? 'false').toLowerCase();
          args.prepareLogin = raw === '1' || raw === 'true' || raw === 'yes';
          if (inlineVal == null) i += 1;
        }
        break;
      case '--login-only':
        {
          const raw = (inlineVal ?? nextVal ?? 'false').toLowerCase();
          args.loginOnly = raw === '1' || raw === 'true' || raw === 'yes';
          if (inlineVal == null) i += 1;
        }
        break;
      case '--editor-ready-wait-ms':
        args.editorReadyWaitMs = Number.parseInt(inlineVal ?? nextVal ?? '12000', 10);
        if (inlineVal == null) i += 1;
        break;
      default:
        break;
    }
  }

  if (!args.prepareLogin && !args.keyword.trim()) {
    throw new Error('缺少参数 --keyword，例如 --keyword="电源"');
  }
  if (!Number.isFinite(args.maxItems) || args.maxItems < 1) {
    throw new Error('--max-items 必须是 >= 1 的整数');
  }

  return args;
}

async function waitForEnter(message) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    await rl.question(`${message}\n`);
  } finally {
    rl.close();
  }
}

function logStep(msg) {
  const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
  console.log(`[${ts}] ${msg}`);
}

function buildItemStem(text) {
  return String(text).replace(/[\\/:*?"<>|]/g, '_').slice(0, 40);
}

async function dumpDebug(page, debugDir, name) {
  await fs.mkdir(debugDir, { recursive: true });
  const safe = name.replace(/[\\/:*?"<>|]/g, '_');
  const shot = path.join(debugDir, `${safe}.png`);
  const html = path.join(debugDir, `${safe}.html`);
  await page.screenshot({ path: shot, fullPage: true }).catch(() => {});
  const content = await page.content().catch(() => '');
  await fs.writeFile(html, content).catch(() => {});
  return { shot, html };
}

async function hasNotLoggedInDialog(page) {
  for (const frame of page.frames()) {
    const dialog = frame.getByText(/尚未登录|请登录后再试|未登录/i).first();
    if (await dialog.count()) return true;
  }
  return false;
}

async function clickByTextInAnyFrame(page, regexList, timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    for (const frame of page.frames()) {
      for (const rx of regexList) {
        const byRole = frame.getByRole('button', { name: rx }).first();
        if (await byRole.count()) {
          await byRole.click({ timeout: 1500 });
          return true;
        }

        const byText = frame.getByText(rx).first();
        if (await byText.count()) {
          try {
            await byText.click({ timeout: 1500 });
          } catch {
            await byText.click({ timeout: 1500, force: true });
          }
          return true;
        }

        const generic = frame.locator(`text=${rx.source}`).first();
        if (await generic.count()) {
          try {
            await generic.click({ timeout: 1500 });
          } catch {
            await generic.click({ timeout: 1500, force: true });
          }
          return true;
        }
      }
    }
    await page.waitForTimeout(500);
  }

  return false;
}

async function hoverOrClickByTextInAnyFrame(page, regexList, timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    for (const frame of page.frames()) {
      for (const rx of regexList) {
        const byText = frame.getByText(rx).first();
        if (await byText.count()) {
          try {
            await byText.hover({ timeout: 1500 });
          } catch {
            try {
              await byText.click({ timeout: 1500 });
            } catch {
              await byText.click({ timeout: 1500, force: true });
            }
          }
          return true;
        }
      }
    }
    await page.waitForTimeout(300);
  }
  return false;
}

async function findFirstMatchingHref(page, matcher) {
  const href = await page
    .locator('a[href]')
    .evaluateAll((anchors, patternSource) => {
      const rx = new RegExp(patternSource, 'i');
      for (const anchor of anchors) {
        const hrefValue = anchor.getAttribute('href') || '';
        if (rx.test(hrefValue)) return hrefValue;
      }
      return '';
    }, matcher.source)
    .catch(() => '');

  if (!href) return '';
  if (href.startsWith('http://') || href.startsWith('https://')) return href;
  if (href.startsWith('//')) return `https:${href}`;
  return href;
}

async function resolveDesignerPage(context, detailPage, timeoutMs) {
  let designerPage = null;
  try {
    designerPage = await context.waitForEvent('page', { timeout: 8000 });
    await designerPage.waitForLoadState('domcontentloaded', { timeout: timeoutMs }).catch(() => {});
    if (/pro\.lceda\.cn\/editor/i.test(designerPage.url())) {
      return designerPage;
    }
  } catch {
    // ignore and fall back to href extraction
  }

  const directHref = await findFirstMatchingHref(detailPage, /pro\.lceda\.cn\/editor/i);
  if (!directHref) {
    return designerPage && !designerPage.isClosed() ? designerPage : detailPage;
  }

  const openedPage = await context.newPage();
  await openedPage.goto(directHref, { waitUntil: 'domcontentloaded' });
  return openedPage;
}

async function ensureDesignerSurface(page, timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const url = page.url();
    if (/pro\.lceda\.cn\/editor/i.test(url)) {
      const hasFileMenu = await clickByTextInAnyFrame(page, [/^文件$/, /^File$/], 2500);
      if (hasFileMenu) {
        await page.keyboard.press('Escape').catch(() => {});
        return true;
      }
    }
    await page.waitForTimeout(1000);
  }
  return false;
}

async function cleanupResidualProjectPages(context, keepPages = []) {
  const keepSet = new Set(keepPages.filter(Boolean));
  for (const page of context.pages()) {
    if (keepSet.has(page) || page.isClosed()) continue;
    const url = page.url();
    const isDesignerPage = /pro\.lceda\.cn\/editor/i.test(url);
    const isProjectDetailPage =
      /oshwhub\.com/i.test(url) &&
      !/\/explore(?:[/?#]|$)/i.test(url) &&
      !/\/search(?:[/?#]|$)/i.test(url);

    if (!isDesignerPage && !isProjectDetailPage) continue;
    await page.close().catch(() => {});
  }
}

async function filterAlreadyDownloadedResults(downloadDir, results, limit) {
  const entries = await fs.readdir(downloadDir).catch(() => []);
  const existingNames = new Set(entries);
  const filtered = [];

  for (const item of results) {
    const stem = buildItemStem(item.text);
    const alreadyExists = Array.from(existingNames).some((name) => name.includes(`_${stem}_`));
    if (alreadyExists) {
      logStep(`跳过已存在工程: ${item.text}`);
      continue;
    }
    filtered.push(item);
    if (filtered.length >= limit) break;
  }

  return filtered;
}

async function closeNoise(page) {
  const closeLabels = [/关闭/, /知道了/, /我知道了/, /取消/, /^x$/i];
  for (const rx of closeLabels) {
    const el = page.getByRole('button', { name: rx }).first();
    if (await el.count()) {
      try {
        await el.click({ timeout: 1200 });
      } catch {
        // ignore
      }
    }
  }

  const modalCloseSelectors = [
    '.modal .close',
    '.modal [class*="close"]',
    '.ant-modal-close',
    '.el-dialog__close',
    '.dialog [class*="close"]',
    '.popup [class*="close"]',
  ];
  for (const sel of modalCloseSelectors) {
    const close = page.locator(sel).first();
    if (await close.count()) {
      try {
        await close.click({ timeout: 1200 });
      } catch {
        try {
          await close.click({ timeout: 1200, force: true });
        } catch {
          // ignore
        }
      }
    }
  }
}

async function snapshotResultLinks(page) {
  return page.$$eval('a[href]', (anchors) => {
    const seen = new Set();
    const out = [];
    const blockedFirstSeg = new Set([
      'explore',
      'activities',
      'market',
      'article',
      'fantasy',
      'education',
      'project',
      'page',
      'oshwhub',
    ]);

    for (const a of anchors) {
      const href = a.getAttribute('href') || '';
      const text = (a.textContent || '').trim();
      const fullHref = href.startsWith('http') ? href : `https://oshwhub.com${href}`;
      const pathOnly = href.startsWith('http') ? new URL(href).pathname : href;
      const seg = pathOnly.split('/').filter(Boolean);

      const isProjectLikePath = /\/project_[a-z0-9]+$/i.test(pathOnly) || seg.length >= 2;
      const firstSegAllowed = seg.length > 0 && !blockedFirstSeg.has(seg[0]);
      const textLooksLikeCard = text.includes('简介') || text.length > 20;

      const isCandidate =
        href &&
        !href.startsWith('javascript:') &&
        !href.startsWith('#') &&
        fullHref.includes('oshwhub.com') &&
        isProjectLikePath &&
        firstSegAllowed &&
        textLooksLikeCard;

      if (!isCandidate) continue;
      if (seen.has(fullHref)) continue;

      seen.add(fullHref);
      out.push({ href: fullHref, text });
    }

    return out;
  });
}

async function collectResultLinks(page, limit) {
  const collected = new Map();
  let stagnantRounds = 0;
  let lastCount = 0;

  for (let round = 0; round < 30; round += 1) {
    const snapshot = await snapshotResultLinks(page);
    for (const item of snapshot) {
      if (!collected.has(item.href)) {
        collected.set(item.href, item);
      }
    }

    const currentCount = collected.size;
    if (currentCount >= limit) break;

    if (currentCount === lastCount) {
      stagnantRounds += 1;
    } else {
      stagnantRounds = 0;
      lastCount = currentCount;
    }

    if (stagnantRounds >= 3) break;

    await page.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight);
    }).catch(() => {});
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(1500);
  }

  return Array.from(collected.values()).slice(0, limit);
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  await fs.mkdir(args.downloadDir, { recursive: true });
  await fs.mkdir(args.debugDir, { recursive: true });
  await fs.mkdir(path.dirname(args.storageState), { recursive: true });
  await fs.mkdir(args.userDataDir, { recursive: true });

  const playwright = await loadPlaywright();
  const context = await playwright.chromium.launchPersistentContext(args.userDataDir, {
    headless: args.prepareLogin ? false : args.headless,
    slowMo: args.slowMo,
    acceptDownloads: true,
    viewport: { width: 1600, height: 900 },
    locale: 'zh-CN',
  });
  context.setDefaultTimeout(args.timeoutMs);

  try {
    if (args.prepareLogin) {
      logStep('进入登录准备模式（持久化上下文），打开浏览器等待手动登录');
      const loginPage = await context.newPage();
      await loginPage.goto('https://oshwhub.com/explore', { waitUntil: 'domcontentloaded' });
      const proPage = await context.newPage();
      await proPage.goto('https://pro.lceda.cn/editor', { waitUntil: 'domcontentloaded' }).catch(() => {});
      await waitForEnter(
        '请在浏览器中完成登录，并确认在 oshwhub.com 与 pro.lceda.cn 页面都已登录，然后回到终端按 Enter 继续...',
      );
      await proPage.waitForTimeout(2000);
      await context.storageState({ path: args.storageState });
      logStep(`登录态已保存（同时持久化到用户目录）: ${args.storageState}`);
      if (args.loginOnly) {
        logStep('仅登录模式已完成，退出。');
        return;
      }
    }
    const page = await context.newPage();
    logStep(`使用持久化用户目录: ${args.userDataDir}`);

    logStep('打开探索页');
    await page.goto('https://oshwhub.com/explore', { waitUntil: 'domcontentloaded' });
    await closeNoise(page);

    logStep(`搜索关键词: ${args.keyword}`);
    const searchArea = page
      .locator(
        '.ant-select, .search, [class*="search"], [placeholder*="搜索"], [placeholder*="Search"], input[type="search"]',
      )
      .first();
    await searchArea.click({ timeout: args.timeoutMs }).catch(() => {});
    const searchInput = page
      .locator('input[placeholder*="搜索"], input[placeholder*="Search"], input[type="search"], .ant-select-selection-search-input')
      .first();
    await searchInput.fill(args.keyword, { force: true });
    await searchInput.press('Enter');

    await page.waitForLoadState('networkidle', { timeout: args.timeoutMs }).catch(() => {});
    await page.waitForTimeout(1500);

    logStep('收集搜索结果条目');
    const rawResults = await collectResultLinks(page, Math.max(args.maxItems * 3, args.maxItems));
    const results = await filterAlreadyDownloadedResults(args.downloadDir, rawResults, args.maxItems);
    if (!results.length) {
      throw new Error('未找到可进入详情的条目，请换关键词或手动检查页面是否需要先登录。');
    }

    logStep(`准备处理 ${results.length} 个条目`);
    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < results.length; i += 1) {
      const item = results[i];
      logStep(`(${i + 1}/${results.length}) 进入详情: ${item.text}`);
      let detailPage = null;
      let designerPage = null;
      try {
        detailPage = await context.newPage();
        await detailPage.goto(item.href, { waitUntil: 'domcontentloaded' });
        await closeNoise(detailPage);

        logStep(`(${i + 1}/${results.length}) 点击“打设计图”`);
        const gotoDesigner = await clickByTextInAnyFrame(
          detailPage,
          [/打设计图/, /去设计图/, /编辑设计图/, /打开设计图/],
          args.timeoutMs,
        );
        if (!gotoDesigner) {
          throw new Error(`条目 ${item.href} 未找到“打设计图”按钮`);
        }

        designerPage = await resolveDesignerPage(context, detailPage, args.timeoutMs);
        await designerPage.waitForLoadState('domcontentloaded', { timeout: args.timeoutMs }).catch(() => {});
        await designerPage.waitForTimeout(args.editorReadyWaitMs);
        await closeNoise(designerPage);

        const editorReady = await ensureDesignerSurface(designerPage, 45000);
        if (!editorReady) {
          const debug = await dumpDebug(designerPage, args.debugDir, `designer-not-ready-${Date.now()}`);
          throw new Error(`未真正进入设计图编辑器页。当前URL: ${designerPage.url()} 调试文件: ${debug.shot} , ${debug.html}`);
        }

        logStep(`(${i + 1}/${results.length}) 在设计图页执行 文件 -> 另存为 -> 工程另存为(本地)(A) -> 确认`);

        const clickedFile = await clickByTextInAnyFrame(designerPage, [/^文件$/, /^File$/], 30000);
        if (!clickedFile) {
          const debug = await dumpDebug(designerPage, args.debugDir, `file-menu-missing-${Date.now()}`);
          throw new Error(`未找到“文件(F)”菜单。调试文件: ${debug.shot} , ${debug.html}`);
        }

        await designerPage.waitForTimeout(600);
        const openedSaveAsSubmenu = await hoverOrClickByTextInAnyFrame(
          designerPage,
          [/^另存为$/, /Save\s*As/i],
          12000,
        );
        if (!openedSaveAsSubmenu) {
          const debug = await dumpDebug(designerPage, args.debugDir, `saveas-submenu-missing-${Date.now()}`);
          throw new Error(`未找到“另存为”子菜单入口。调试文件: ${debug.shot} , ${debug.html}`);
        }

        await designerPage.waitForTimeout(400);

        let download = null;
        for (let attempt = 1; attempt <= 2; attempt += 1) {
          const downloadPromise = designerPage.waitForEvent('download', { timeout: 25000 }).catch(() => null);
          const clickedLocal = await clickByTextInAnyFrame(
            designerPage,
            [/工程另存为\(本地\)\(A\)\.\.\./, /工程另存为\(本地\)\(A\)/, /工程另存为\(本地\)/, /另存为本地/, /本地保存/, /保存到本地/, /Save\s*to\s*Local/i],
            12000,
          );
          if (!clickedLocal) {
            const debug = await dumpDebug(designerPage, args.debugDir, `save-local-missing-${Date.now()}`);
            throw new Error(`未找到“工程另存为(本地)(A)”菜单项。调试文件: ${debug.shot} , ${debug.html}`);
          }

          await designerPage.waitForTimeout(300);
          await clickByTextInAnyFrame(designerPage, [/^确认$/, /^确定$/, /^OK$/i, /^Yes$/i], 2500).catch(() => false);

          download = await downloadPromise;
          if (download) break;

          const loginDialog = await hasNotLoggedInDialog(designerPage);
          if (attempt === 1 && loginDialog) {
            logStep('检测到“尚未登录”提示，刷新编辑器并重试一次导出');
            await closeNoise(designerPage);
            await designerPage.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
            await designerPage.waitForTimeout(args.editorReadyWaitMs);
            await closeNoise(designerPage);
            const retryFile = await clickByTextInAnyFrame(designerPage, [/^文件$/, /^File$/], 20000);
            if (retryFile) {
              await designerPage.waitForTimeout(600);
              await hoverOrClickByTextInAnyFrame(designerPage, [/^另存为$/, /Save\s*As/i], 12000);
              await designerPage.waitForTimeout(400);
            }
            continue;
          }
          break;
        }

        if (!download) {
          throw new Error('未捕获到下载事件，可能是登录态未同步到编辑器域，建议先执行 --prepare-login=true。');
        }
        const suggested = download.suggestedFilename();
        const prefix = `${String(i + 1).padStart(2, '0')}_${buildItemStem(item.text)}`;
        const finalName = `${prefix}_${suggested}`;
        const targetPath = path.join(args.downloadDir, finalName);

        await download.saveAs(targetPath);
        logStep(`(${i + 1}/${results.length}) 下载完成: ${targetPath}`);
        successCount += 1;
      } catch (err) {
        failCount += 1;
        logStep(`(${i + 1}/${results.length}) 失败并跳过: ${err.message}`);
      } finally {
        if (detailPage && !detailPage.isClosed()) {
          await detailPage.close().catch(() => {});
        }
        if (designerPage && designerPage !== detailPage && !designerPage.isClosed()) {
          await designerPage.close().catch(() => {});
        }
        await cleanupResidualProjectPages(context, [page]);
      }
    }

    logStep(`全部完成，成功 ${successCount}，失败 ${failCount}。文件目录: ${args.downloadDir}`);
    await context.storageState({ path: args.storageState }).catch(() => {});
  } finally {
    await context.close().catch(() => {});
  }
}

async function loadPlaywright() {
  try {
    return await import('playwright');
  } catch {}

  const require = createRequire(import.meta.url);
  const candidatePaths = [
    path.resolve(process.cwd(), 'node_modules/playwright'),
    path.resolve(path.dirname(new URL(import.meta.url).pathname), 'node_modules/playwright'),
    path.resolve(process.cwd(), 'plugin/node_modules/playwright'),
    path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../plugin/node_modules/playwright'),
  ];

  for (const candidate of candidatePaths) {
    try {
      return require(candidate);
    } catch {
      // try next
    }
  }

  throw new Error(
    '未找到 playwright 依赖。请先在仓库根目录执行: npm i -D playwright ，或在 plugin 目录执行: npm i',
  );
}

run().catch((err) => {
  console.error(`执行失败: ${err.message}`);
  process.exit(1);
});
