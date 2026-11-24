/**
 * Playwright 为可选运行时依赖：动态 import，未安装或浏览器未下载时返回 null，
 * 由上层给明确降级文案，服务与页面其余功能照常可用。
 */
export async function loadPlaywright() {
  try {
    const mod = await import('playwright');
    return mod && mod.chromium ? mod : null;
  } catch {
    return null;
  }
}

export const INSTALL_HINT = '在工程目录执行 npm install，再执行 npx playwright install chromium';

export async function browserUsable(pw) {
  if (!pw) return false;
  try {
    const browser = await pw.chromium.launch({ headless: true });
    await browser.close();
    return true;
  } catch {
    return false;
  }
}
