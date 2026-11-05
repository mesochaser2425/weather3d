// Jak runm.mjs, ale skrypt może robić zrzuty w trakcie: await shot('nazwa') → OUT + nazwa + .png
import puppeteer from 'puppeteer-core';
import fs from 'fs'; import os from 'os'; import path from 'path';
const [,, query, ...files] = process.argv;
const code = files.map((f) => fs.readFileSync(f, 'utf8')).join('\n;\n');
const browser = await puppeteer.launch({ headless: 'new', executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--enable-unsafe-webgpu', '--enable-features=WebGPU', '--disable-gpu-sandbox', '--ignore-gpu-blocklist', '--window-size=1400,1000'],
  protocolTimeout: 0, userDataDir: process.env.PROFILE ? path.join(os.tmpdir(), 'w3d-prof-' + process.env.PROFILE) : fs.mkdtempSync(path.join(os.tmpdir(), 'w3d-')) });
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 1000 });
await page.setRequestInterception(true);
page.on('request', (r) => { if (/open-meteo/.test(r.url())) r.abort(); else r.continue(); });
page.on('console', (m) => { const t = m.text(); if (/error|Error|warn/i.test(t) || t.startsWith('[T]')) console.log('PAGE:', t.slice(0, 3000)); });
page.on('pageerror', (e) => console.log('PAGEERR:', e.message));
const OUT = process.env.OUT || 's_';
await page.exposeFunction('shot', async (name) => { await page.screenshot({ path: OUT + name + '.png' }); return 1; });
await page.exposeFunction('save', async (name, txt) => { fs.writeFileSync(OUT + name, txt); return 1; });
await page.goto(`http://localhost:${process.env.PORT}/` + (query || ''), { waitUntil: 'load' });
await page.waitForFunction(() => window.__sim, { timeout: 200000 });
const t0 = Date.now();
await page.evaluate(`(async () => { const sim = window.__sim; const log = (...a) => { const s = a.map((x) => typeof x === 'string' ? x : JSON.stringify(x)).join(' '); console.log('[T] ' + s); }; ${code}; })()`);
console.log('RESULT ok', ((Date.now() - t0) / 1000).toFixed(0) + ' s');
await browser.close();
