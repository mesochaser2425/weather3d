// Test pędzla powierzchni: działająca pętla klatek, malowanie myszą pustyni i tajgi, potem prawy przycisk (usuwanie); zrzuty mapy
import puppeteer from 'puppeteer-core';
import fs from 'fs'; import os from 'os'; import path from 'path';
const P = process.env.PORT || 5230;
const browser = await puppeteer.launch({ headless: 'new', executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--enable-unsafe-webgpu', '--enable-features=WebGPU', '--disable-gpu-sandbox', '--ignore-gpu-blocklist', '--window-size=1500,950'], protocolTimeout: 0,
  userDataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'w3d-')) });
const page = await browser.newPage();
await page.setViewport({ width: 1500, height: 950 });
page.on('console', (m) => { const t = m.text(); if (/error|Error/.test(t) || t.startsWith('[T]')) console.log('PAGE:', t.slice(0, 800)); });
page.on('pageerror', (e) => console.log('PAGEERR:', e.message));
await page.setRequestInterception(true);
page.on('request', (r) => { if (/open-meteo/.test(r.url())) r.abort(); else r.continue(); });
await page.goto(`http://localhost:${P}/?dx=2000&nx=100&ny=100`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__sim, { timeout: 180000 });
await page.waitForFunction(() => document.getElementById('chipSpeed').textContent !== '–' && parseFloat(document.getElementById('chipSpeed').textContent) > 0, { timeout: 180000 });
const q = (s) => page.evaluate(s);
await q(`document.querySelector('#tabs button[data-tab="ter"]').click()`);
await new Promise((r) => setTimeout(r, 300));
await q(`document.getElementById('paint').click()`);
const opts = await q(`[...document.getElementById('paintWhat').options].map((o) => o.value + '=' + o.text).join(' | ')`);
console.log('pędzle:', opts);
const setBrush = (v) => q(`(() => { const s = document.getElementById('paintWhat'); s.value = '${v}'; s.dispatchEvent(new Event('change')); })()`);
await setBrush('veg:7');
console.log('warstwa po wyborze pędzla:', await q(`document.getElementById('fieldH').value`), await q(`document.getElementById('xyInfo').textContent`));
await q(`document.getElementById('brush').value = 12; document.getElementById('brush').dispatchEvent(new Event('input'))`);
await q(`document.body.classList.remove('drawer')`);
await new Promise((r) => setTimeout(r, 300));
const bb = await (await page.$('#cxy')).boundingBox();
const stroke = async (fx0, fy0, fx1, fy1, button = 'left') => {
  await page.mouse.move(bb.x + bb.width * fx0, bb.y + bb.height * fy0);
  await page.mouse.down({ button });
  for (let n = 1; n <= 12; n++) { await page.mouse.move(bb.x + bb.width * (fx0 + (fx1 - fx0) * n / 12), bb.y + bb.height * (fy0 + (fy1 - fy0) * n / 12)); await new Promise((r) => setTimeout(r, 60)); }
  await page.mouse.up({ button });
  await new Promise((r) => setTimeout(r, 200));
};
await stroke(0.2, 0.3, 0.8, 0.3);
await setBrush('veg:2');
await stroke(0.2, 0.6, 0.8, 0.6);
await page.screenshot({ path: 'brush1.png' });
await setBrush('veg:7');
await stroke(0.45, 0.2, 0.55, 0.4, 'right');
await new Promise((r) => setTimeout(r, 300));
await page.screenshot({ path: 'brush2.png' });
const r = await q(`(async () => { const s = window.__sim; s.stop(); const st = JSON.parse(JSON.stringify(s.stateForTest ? s.stateForTest() : {})); return { err: document.getElementById('err').textContent, tip: document.getElementById('legXY').querySelector('.note').textContent }; })()`);
console.log(JSON.stringify(r));
await browser.close();
