// ═══════════════════════════════════════════════════════════════════════════
// End-to-end smoke test: real headless Chrome against the real app.
//
// Self-contained (no test framework): serves public/ on 127.0.0.1:4173,
// launches the locally installed Chrome via puppeteer-core, then drives the
// actual UI:
//   1. Employee (alice): login → clock in (demo location) → clock out
//      → My Attendance shows her named records
//   2. Admin: login → Dashboard → Employees → Geofences → Reports
//      (all three chart canvases must actually render)
//   3. No uncaught page errors / console errors during any of it
//
// Run:        node tests/e2e.mjs
// Requires:   node 18+, Chrome installed, and puppeteer-core available:
//             npm i --no-save puppeteer-core
//             (one-time, local-only — never deployed, app stays backend-free)
// ═══════════════════════════════════════════════════════════════════════════

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PUBLIC_DIR = path.join(ROOT, 'public');
const PORT = 4173;
const HOST = '127.0.0.1';
const BASE = `http://${HOST}:${PORT}`;
const APP_URL = `${BASE}/index.html`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Tiny static server (public/ only, that's the whole deployable) ─────────
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '': 'application/octet-stream', // .nojekyll etc.
};

const server = http.createServer(async (req, res) => {
  try {
    const urlPath = decodeURIComponent(new URL(req.url, BASE).pathname);
    const rel = urlPath === '/' ? 'index.html' : urlPath.slice(1);
    const filePath = path.join(PUBLIC_DIR, rel);
    if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); res.end(); return; }
    const data = await readFile(filePath);
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || MIME[''] });
    res.end(data);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  }
});

await new Promise((resolve) => server.listen(PORT, HOST, resolve));
console.log(`✅ Static server on ${BASE}`);

// ── Locate locally installed Chrome ────────────────────────────────────────
import { existsSync } from 'node:fs';
function findChrome() {
  const candidates = process.env.CHROME_PATH ? [process.env.CHROME_PATH] : [];
  if (process.platform === 'win32') {
    for (const base of [process.env['PROGRAMFILES'], process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA].filter(Boolean)) {
      candidates.push(
        path.join(base, 'Google/Chrome/Application/chrome.exe'),
        path.join(base, 'Microsoft/Edge/Application/msedge.exe'),
      );
    }
  } else if (process.platform === 'darwin') {
    candidates.push('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
  } else {
    candidates.push('/usr/bin/google-chrome', '/usr/bin/chromium-browser', '/usr/bin/chromium');
  }
  return candidates.find((p) => { try { return existsSync(p); } catch { return false; } });
}

let puppeteer;
try {
  puppeteer = (await import('puppeteer-core')).default;
} catch {
  console.error('❌ puppeteer-core not found. Run:  npm i --no-save puppeteer-core');
  server.close();
  process.exit(1);
}
const executablePath = findChrome();
if (!executablePath) {
  console.error('❌ Chrome not found. Set CHROME_PATH to your chrome.exe and retry.');
  server.close();
  process.exit(1);
}

const browser = await puppeteer.launch({
  executablePath,
  headless: 'new',
  args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
});

let pageErrors = [];
try {
  // ── helpers ──────────────────────────────────────────────────────────────
  const trackErrors = (page) => {
    page.on('pageerror', (err) => pageErrors.push(`pageerror: ${err.message}\n${err.stack || ''}`));
    page.on('console', (msg) => {
      if (msg.type() === 'error' && !/favicon/i.test(msg.text())) {
        pageErrors.push(`console.error: ${msg.text()}`);
      }
    });
  };
  const idle = (page) =>
    page.waitForNetworkIdle({ idleTime: 400, timeout: 8000 }).catch(() => {});
  const bodyIncludes = (text) => (sel) => // sel = PuppeteerElement (unused; runs on body)
    sel.evaluate((el, t) => el.innerText.includes(t), text);
  const waitForBodyText = (page, text) =>
    page.waitForFunction(
      (t) => document.body && document.body.innerText.includes(t),
      { polling: 200, timeout: 8000 },
      text,
    );

  // ── shared login routine ─────────────────────────────────────────────────
  async function loginAs(username, password) {
    // Fresh browser context per login: pages in the same context share
    // localStorage, so a previous user's saved session would auto-login
    // the next page and hide the login form before we can type into it.
    const context = await (browser.createBrowserContext
      ? browser.createBrowserContext()
      : browser.createIncognitoBrowserContext());
    const page = await context.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    trackErrors(page);
    await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
    await page.type('#login-username', username);
    await page.type('#login-password', password);
    await page.click('#login-form button[type="submit"]');
    // Wait until the app shell is visible (login succeeded)
    await page.waitForFunction(
      () => {
        const shell = document.getElementById('app-shell');
        return shell && !shell.classList.contains('hidden');
      },
      { polling: 200, timeout: 8000 },
    );
    await idle(page);
    return { page, context };
  }

  // ══ 1. Employee flow: alice — login, clock in, clock out ════════════════
  console.log('\n── Employee flow (alice) ──');
  let page, ctx, context;
  ({ page, context } = await loginAs('alice', 'emp123'));
  ctx = context;

  const dashHeading = await page.waitForFunction(
    () => document.querySelector('#main-content h1')?.textContent || '',
    { polling: 200, timeout: 8000 },
  );
  console.log('  dashboard heading:', await dashHeading.jsonValue());

  await page.waitForSelector('#clock-btn', { timeout: 8000 });
  const clockBtnText = (sel) => sel.evaluate((el) => el.textContent.trim());
  console.log('  clock button before:', await clockBtnText(await page.$('#clock-btn')));

  // Use the demo-location helper (no GPS in headless), then clock IN
  await page.click('#use-office-btn');
  await page.click('#clock-btn');
  await waitForBodyText(page, '🟢 Clocked In');
  console.log('  ✅ clocked IN — status card shows "Clocked In"');

  // Clock OUT
  await page.waitForSelector('#clock-btn', { timeout: 8000 });
  await page.click('#clock-btn');
  await waitForBodyText(page, '⚪ Not Clocked In');
  console.log('  ✅ clocked OUT — status card shows "Not Clocked In"');

  // My Attendance must list her records with her NAME (join fix), not "undefined"
  await page.click('.sidebar-link[data-page="my-attendance"]');
  await waitForBodyText(page, 'Alice Johnson');
  console.log('  ✅ My Attendance lists records with employee name');

  await ctx.close();

  // ══ 2. Admin flow: login → dashboard → employees → geofences → reports ══
  console.log('\n── Admin flow ──');
  ({ page, context } = await loginAs('admin', 'admin123'));
  ctx = context;

  await waitForBodyText(page, 'Admin Dashboard');
  await waitForBodyText(page, 'Total Employees');
  console.log('  ✅ Dashboard renders stat cards');

  await page.click('.sidebar-link[data-page="employees"]');
  await waitForBodyText(page, 'Employee Management');
  await waitForBodyText(page, 'Alice Johnson');
  console.log('  ✅ Employees table renders seeded staff');

  await page.click('.sidebar-link[data-page="geofences"]');
  await waitForBodyText(page, 'Geofence Management');
  await waitForBodyText(page, 'Makati Office');
  console.log('  ✅ Geofences page renders list + map');

  await page.click('.sidebar-link[data-page="reports"]');
  await waitForBodyText(page, 'Reports & Analytics');
  // All three charts must be real, painted canvases (not blank stubs)
  await page.waitForFunction(
    () => {
      const ids = ['report-trend-chart', 'report-status-chart', 'report-dept-chart'];
      return ids.every((id) => {
        const c = document.getElementById(id);
        return c && c.width > 0 && c.height > 0;
      });
    },
    { polling: 200, timeout: 8000 },
  );
  console.log('  ✅ Reports render all 3 charts (trend, status, department)');
  await sleep(500); // let chart animation finish before we inspect

  // Department table must have rows (regression: endpoint used to crash)
  await waitForBodyText(page, 'Engineering');
  console.log('  ✅ Department summary table has data');

  await ctx.close();

  // ══ 3. Console / page errors ════════════════════════════════════════════
  if (pageErrors.length) {
    console.error('\n❌ Browser errors captured:');
    for (const e of pageErrors) console.error('   ' + e);
    process.exitCode = 1;
  } else {
    console.log('\n✅ E2E PASSED — no console or page errors');
  }
} catch (err) {
  console.error('\n❌ E2E FAILED:', err.message);
  process.exitCode = 1;
} finally {
  await browser.close().catch(() => {});
  server.close();
  setTimeout(() => process.exit(process.exitCode || 0), 200).unref();
}
