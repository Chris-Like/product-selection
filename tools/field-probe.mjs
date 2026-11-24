/**
 * B0 一次性只读探针：输出真实页面结构摘要，供人工逐字段核对后回填 site-rules/*.json。
 * 不猜测选择器、不自动回填、不自动登录、不写业务数据。
 *
 * 用法：node tools/field-probe.mjs "<真实商品详情页或搜索结果页 URL>" [waitMs] [site]
 *   waitMs  等待异步数据渲染的毫秒数，默认 3000，上限 15000；仅影响读取时机。
 *   site    站点标识，默认 taobao，用于定位本机登录态文件。
 *
 * 登录态（D3=B′）：若本人在页面点「登录」后生成了 playwright/.auth/<site>.json，
 * 本探针只读复用它（browser.newContext({ storageState })），不录入密码、不代登录、
 * 不输出 cookies 内容、不上传任何第三方。没有登录态时照常只读打开，并如实标注。
 *
 * 重要：输出里的 usableForBackfill 只是「本次页面是否具备逐字段核对条件」的提示，
 * 不是选择器。命中骨架屏 / 空壳时禁止据此回填任何定位表达式。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPlaywright } from '../app/collector/driver.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [url, waitArg, siteArg] = process.argv.slice(2);
const site = siteArg || 'taobao';
const waitMs = Math.min(Math.max(Number(waitArg) || 3000, 0), 15000);

if (!url) {
  console.log('用法：node tools/field-probe.mjs "<真实商品详情页或搜索结果页 URL>" [waitMs] [site]');
  console.log('请先本人登录一次，再像平时一样搜一次、点开几个商品页，把当前地址贴进来。');
  process.exit(0);
}

const pw = await loadPlaywright();
if (!pw) {
  console.log('未安装 Playwright。先执行：npm install && npx playwright install chromium');
  process.exit(1);
}

const authFile = path.join(ROOT, 'playwright', '.auth', `${site}.json`);
const usedStorageState = fs.existsSync(authFile);

let browser;
try {
  browser = await pw.chromium.launch({ headless: true });
  const context = await browser.newContext(usedStorageState ? { storageState: authFile } : {});
  const page = await context.newPage();
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  if (waitMs) await page.waitForTimeout(waitMs);

  const summary = await page.evaluate(() => {
    const pick = (sel, limit = 8) => [...document.querySelectorAll(sel)].slice(0, limit).map((n) => ({
      tag: n.tagName,
      id: n.id || '',
      class: String(n.className || '').slice(0, 100),
      text: String(n.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 80),
    }));
    const skeletonNodes = document.querySelectorAll(
      '[class*="skeleton"],[class*="boneClass"],[class*="lightSlideAnimation"]',
    ).length;
    const priceLikeTextNodes = [...document.querySelectorAll('div,span')]
      .filter((n) => /^\s*[¥￥]?\s*\d+(\.\d+)?\s*$/.test((n.textContent || '').trim())).length;
    const itemLinks = document.querySelectorAll('a[href*="item.taobao.com"],a[href*="/item.htm?id="]').length;
    return {
      url: location.href,
      title: document.title,
      headings: pick('h1,h2,h3'),
      priceCandidates: pick('[class*="price"],[class*="Price"]'),
      titleCandidates: pick('[class*="title"],[class*="Title"]'),
      itemCards: pick('[class*="item"],[data-item-id]'),
      linksWithId: [...document.querySelectorAll('a[href*="id="]')].slice(0, 5).map((a) => a.getAttribute('href')),
      diagnostics: {
        skeletonNodes,
        priceLikeTextNodes,
        itemLinks,
        bodyTextLength: (document.body?.innerText || '').length,
        usableForBackfill: skeletonNodes === 0 && priceLikeTextNodes > 0 && itemLinks > 0,
      },
    };
  });

  summary.probeMeta = {
    site,
    waitMs,
    usedStorageState,
    note: usedStorageState
      ? '本次只读复用了本机本人登录态（未输出任何 cookie 内容）'
      : '本次未复用登录态；需要登录才可见的页面可能只返回骨架屏',
  };
  console.log(JSON.stringify(summary, null, 2));
  console.log('\n本探针只读、不回填。请由 B0 实测逐字段核对后，手工回填 app/config/site-rules/*.json。');
  if (!summary.diagnostics.usableForBackfill) {
    console.log('⚠ 本次页面仍是骨架屏 / 空壳或未渲染出商品字段：输出只能用于诊断，禁止据此回填任何选择器。');
    console.log('  请确认：① 本人已登录且登录态有效；② 贴入的是真实商品详情页或搜索结果页；③ 适当加大 waitMs 重试。');
  }
  console.log('未核对的字段保持空槽（「未获取」），不猜测、不填 0、不阻断整体。');
} catch (e) {
  console.error(`探针没能读完这个页面：${String(e && e.message ? e.message : e)}`);
  console.error('若页面需要登录或出现验证环节，请本人在浏览器里处理后再试；探针不自动登录、不绕过验证。');
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
}
