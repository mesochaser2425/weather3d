// Zrzuty zakładek interfejsu: po kolei każda zakładka; TABS=wx,atm,... ; pierwszy argument – adres (query), drugi – prefiks plików
import puppeteer from 'puppeteer-core';
import fs from 'fs'; import os from 'os'; import path from 'path';
const [,, query = '?dx=5000&nx=100&ny=100', prefix = 'ui'] = process.argv;
const P = process.env.PORT || 5230, W = +(process.env.W || 1500), H = +(process.env.H || 950);
const tabs = (process.env.TABS || 'wx,atm,ter,view,mon,set').split(',');
const prof = process.env.PROFILE ? path.join(os.tmpdir(), 'w3d-prof-' + process.env.PROFILE) : fs.mkdtempSync(path.join(os.tmpdir(), 'w3d-'));
const browser = await puppeteer.launch({ headless: 'new', executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--enable-unsafe-webgpu', '--enable-features=WebGPU', '--disable-gpu-sandbox', '--ignore-gpu-blocklist', `--window-size=${W},${H}`], protocolTimeout: 0, userDataDir: prof });
const page = await browser.newPage();
await page.setViewport({ width: W, height: H });
page.on('console', (m) => { const t = m.text(); if (/error|Error/.test(t) || t.startsWith('[T]')) console.log('PAGE:', t.slice(0, 1500)); });
page.on('pageerror', (e) => console.log('PAGEERR:', e.message, (e.stack || '').split('\n').slice(0, 4).join(' | ')));
await page.setRequestInterception(true);
page.on('request', (r) => { if (/open-meteo/.test(r.url())) r.abort(); else r.continue(); });
await page.goto(`http://localhost:${P}/${query}`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__sim, { timeout: 180000 });
const days = +(process.env.DAYS || 0);
await page.evaluate(async (d) => {
  const sim = window.__sim;
  sim.stop();
  const a = await sim.run(1), b = await sim.run(1), dt = (b.simHours - a.simHours) * 3600;
  if (d > 0) await sim.run(Math.round(d * 86400 / dt));
  await sim.draw();
}, days);
if (process.env.PRE) { const r = await page.evaluate(process.env.PRE); if (r !== undefined) console.log('PRE:', JSON.stringify(r)); }
for (const t of tabs) {
  await page.evaluate(async (tt) => {
    if (tt !== 'none') { const b = document.querySelector(`#tabs button[data-tab="${tt}"]`); if (!document.body.classList.contains('drawer') || !b.classList.contains('on')) b.click(); }
    await window.__sim.draw();
    await new Promise((r) => setTimeout(r, 450));
    await window.__sim.draw();
  }, t);
  await new Promise((r) => setTimeout(r, 300));
  if (process.env.ACT) await page.evaluate(process.env.ACT);
  await page.screenshot({ path: `${prefix}_${t}.png` });
  // treść zakładki przewinięta na koniec (długie zakładki)
  if (process.env.SCROLL) {
    await page.evaluate(() => { const e = document.querySelector('.tab.on'); if (e) e.scrollTop = e.scrollHeight; });
    await new Promise((r) => setTimeout(r, 150));
    await page.screenshot({ path: `${prefix}_${t}2.png` });
    await page.evaluate(() => { const e = document.querySelector('.tab.on'); if (e) e.scrollTop = 0; });
  }
}
console.log('ok');
await browser.close();
