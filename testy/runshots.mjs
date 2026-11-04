// jak runm.mjs, ale po teście kilka zrzutów widoku 3D z różnych ujęć (SHOTS=prefiks)
import puppeteer from 'puppeteer-core';
import fs from 'fs'; import os from 'os'; import path from 'path';
const [,, query, ...files] = process.argv;
const code = files.map((f) => fs.readFileSync(f, 'utf8')).join('\n;\n');
const browser = await puppeteer.launch({ headless: 'new', executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--enable-unsafe-webgpu', '--enable-features=WebGPU', '--disable-gpu-sandbox', '--ignore-gpu-blocklist', '--window-size=1400,900'],
  protocolTimeout: 0, userDataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'w3d-')) });
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 900 });
page.on('console', (m) => { const t = m.text(); if (/error|Error|warn/i.test(t) || t.startsWith('[T]')) console.log('PAGE:', t.slice(0, 2000)); });
page.on('pageerror', (e) => console.log('PAGEERR:', e.message));
await page.goto(`http://localhost:${process.env.PORT || 5199}/` + (query || ''), { waitUntil: 'load' });
await page.waitForFunction(() => window.__sim, { timeout: 120000 });
await page.evaluate(`(async () => { const sim = window.__sim; const log = (...a) => console.log('[T] ' + a.join(' ')); ${code}; })()`);
await page.evaluate(() => document.querySelector('#viewSeg button[data-v="3d"]').click());
const cv = await page.$('#cxy'); const bb = await cv.boundingBox(); const cx = bb.x + bb.width / 2, cy = bb.y + bb.height / 2;
const views = [['a', 0, 0, 0], ['b', -700, 0, 0], ['c', -1100, 120, -60], ['d', -400, 0, 200]];   // [nazwa, kółko, przeciągnięcie x, y]
for (const [nm, wh, dx, dy] of views) {
  await page.evaluate(() => { const c = document.getElementById('cxy'); c.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); });
  await page.mouse.move(cx, cy);
  if (wh) await page.mouse.wheel({ deltaY: wh });
  if (dx || dy) { await page.mouse.down(); await page.mouse.move(cx + dx, cy + dy, { steps: 8 }); await page.mouse.up(); }
  await page.evaluate(async () => { await window.__sim.draw(); await new Promise((r) => setTimeout(r, 1200)); await window.__sim.draw(); });
  await new Promise((r) => setTimeout(r, 800));
  await page.screenshot({ path: `${process.env.SHOTS || 'v'}_${nm}.png`, clip: { x: bb.x, y: bb.y, width: bb.width, height: bb.height } });
}
console.log('RESULT ok'); await browser.close();
