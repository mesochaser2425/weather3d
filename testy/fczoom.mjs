// Meteogram tygodniowy (zakładka Weather): kółko, przeciąganie, przyciski i dwuklik prawdziwymi zdarzeniami myszy, zrzuty ekranu.
// Użycie: serwer Vite, `node fczoom.mjs` (PORT, OUTDIR – zrzuty). Zapytania do Open-Meteo zablokowane. ~1 min.
import puppeteer from 'puppeteer-core';
import fs from 'fs';
import os from 'os';
import path from 'path';
const PORT = process.env.PORT || 5240, OUT = process.env.OUTDIR || fs.mkdtempSync(path.join(os.tmpdir(), 'w3dfc-'));
fs.mkdirSync(OUT, { recursive: true });
const browser = await puppeteer.launch({ headless: 'new', executablePath: process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--enable-unsafe-webgpu', '--enable-features=WebGPU', '--disable-gpu-sandbox', '--ignore-gpu-blocklist', '--window-size=1400,900'], protocolTimeout: 0,
  userDataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'w3d-')) });
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 900, deviceScaleFactor: 2 });
await page.setRequestInterception(true);
page.on('request', (r) => { if (/open-meteo/.test(r.url())) r.abort(); else r.continue(); });
page.on('console', (m) => { const t = m.text(); if (/error/i.test(t) && !/open-meteo|ERR_FAILED|Failed to load/i.test(t)) console.log('PAGE:', t.slice(0, 300)); });
page.on('pageerror', (e) => console.log('PAGEERR:', e.message));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const view = () => page.evaluate(() => window.__sim.fcView());
const days = (v) => `okno ${(v.a / 86400).toFixed(2)} + ${(v.span / 86400).toFixed(2)} doby`;
let fails = 0;
const check = (ok, what) => { console.log(`${ok ? 'OK ' : 'ŹLE'} ${what}`); if (!ok) fails++; };

await page.goto(`http://localhost:${PORT}/?dx=8000&nx=40&ny=40`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__sim && window.__sim.ready(), { timeout: 300000 });
await page.evaluate(() => document.querySelector('#tabs button[data-tab=wx]').click());
await page.waitForFunction(() => window.__sim.fcView().n > 56, { timeout: 180000 });   // prognoza na cały tydzień (zapis co 3 h)
// żeby okno się nie przesuwało w trakcie sprawdzania
await page.evaluate(() => window.__sim.stop());
await wait(500);
const box = await (await page.$('#cfc')).boundingBox();
await page.evaluate(() => document.getElementById('cfc').scrollIntoView({ block: 'center' }));
await wait(800);
const b = await (await page.$('#cfc')).boundingBox();
const clip = { x: b.x - 4, y: b.y - 4, width: b.width + 8, height: b.height + 8 };
const shot = (n) => page.screenshot({ path: path.join(OUT, n), clip, captureBeyondViewport: false });   // bez tej opcji zrzut przesuwa układ strony
console.log('pole', box.width.toFixed(0), '×', box.height.toFixed(0));
await shot('week.png');
let v0 = await view();
check(v0.span === v0.week && v0.a === 0, `start: cały tydzień (${days(v0)})`);

// kółko w połowie szerokości: czas pod kursorem zostaje na miejscu
const M = 30, px = b.x + b.width / 2, py = b.y + b.height / 2;
const fr = (px - b.x - M) / (b.width - 2 * M);
await page.mouse.move(px, py);
const tc0 = v0.a + fr * v0.span;
await page.mouse.wheel({ deltaY: -600 });
await wait(200);
let v1 = await view();
check(v1.span < v0.span && Math.abs(v1.a + fr * v1.span - tc0) < 60, `kółko: mniejsze okno, czas pod kursorem bez zmian (${days(v1)})`);
await page.mouse.wheel({ deltaY: -600 });
await wait(200);
v1 = await view();
await shot('zoom2.png');
console.log('    ', days(v1));
await page.mouse.wheel({ deltaY: -3000 });
await wait(200);
v1 = await view();
check(Math.abs(v1.span - 12 * 3600) < 1, `kółko: najmniej 12 h (${days(v1)})`);
await shot('zoom12h.png');

// przeciąganie w prawo cofa czas
await page.mouse.wheel({ deltaY: 500 });
await wait(200);
const v2 = await view();
await page.mouse.move(px, py);
await page.mouse.down();
await page.mouse.move(px + 60, py, { steps: 4 });
await page.mouse.up();
await wait(200);
const v3 = await view();
const want = v2.a - 60 / (b.width - 2 * M) * v2.span;
check(Math.abs(v3.a - Math.max(0, want)) < 120 && v3.span === v2.span, `przeciąganie: okno cofa się o 60 px (${days(v2)} → ${days(v3)})`);

// dwuklik: cały tydzień
await page.mouse.move(px, py);
await page.mouse.down({ clickCount: 1 }); await page.mouse.up({ clickCount: 1 });
await page.mouse.down({ clickCount: 2 }); await page.mouse.up({ clickCount: 2 });
await wait(200);
const v4 = await view();
check(v4.span === v4.week && v4.a === 0, `dwuklik: cały tydzień (${days(v4)})`);

// przyciski
await page.click('#fcZp');
await wait(200);
const v5 = await view();
await page.click('#fcZm');
await wait(200);
const v6 = await view();
check(v5.span < v4.span && v6.span === v6.week, `przyciski + i − (${days(v5)} → ${days(v6)})`);

// na całym tygodniu kółko w dół nie blokuje przewijania panelu
const sc = () => page.evaluate(() => { let e = document.getElementById('cfc').parentElement; while (e && e.scrollHeight <= e.clientHeight + 1) e = e.parentElement; return e ? e.scrollTop : -1; });
await page.evaluate(() => { let e = document.getElementById('cfc').parentElement; while (e && e.scrollHeight <= e.clientHeight + 1) e = e.parentElement; if (e) e.scrollTop = 0; });
await wait(200);
const c = await (await page.$('#cfc')).boundingBox();
if (c.y + 20 < 900) {
  const s0 = await sc();
  await page.mouse.move(c.x + c.width / 2, Math.min(880, c.y + 20));
  await page.mouse.wheel({ deltaY: 200 });
  await wait(400);
  const s1 = await sc();
  check(s1 > s0, `cały tydzień: kółko w dół przewija panel (${s0} → ${s1})`);
} else console.log('    (meteogram poza ekranem po przewinięciu – bez sprawdzenia przewijania)');
console.log('zrzuty:', OUT);
console.log(fails ? `BŁĘDY: ${fails}` : 'wszystko OK');
await browser.close();
