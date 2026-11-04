// Test bez okna: otwiera symulację w Chrome (WebGPU) i wykonuje skrypt(y) testowe w kontekście strony.
// Użycie (serwer Vite musi działać, domyślnie port 5199: w katalogu projektu `npx vite --port 5199`):
//   node run.mjs "<query>" plik1.js [plik2.js …]      np. node run.mjs "?lx=100&res=100" t4.js
// Pliki są sklejane w jedną funkcję async; dostępne: sim (= window.__sim), log(...) (wypisuje „PAGE: [T] …”).
// Zmienne środowiskowe: PORT (inny serwer, np. 5198 z oryginalnym kodem), CHROME (ścieżka do Chrome; bez niej
// puppeteer używa własnego Chrome – `npx puppeteer browsers install chrome`).
import puppeteer from 'puppeteer';
import fs from 'fs';
import os from 'os';
import path from 'path';
const [,, query, ...files] = process.argv;
const code = files.map((f) => fs.readFileSync(f, 'utf8')).join('\n;\n');
const browser = await puppeteer.launch({
  headless: 'new',
  executablePath: process.env.CHROME || undefined,
  args: ['--enable-unsafe-webgpu', '--enable-features=WebGPU', '--disable-gpu-sandbox', '--ignore-gpu-blocklist', '--window-size=1400,900'],
  protocolTimeout: 0,
  userDataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'w3d-')),
});
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 900 });
page.on('console', (m) => { const t = m.text(); if (/error|Error|warn/i.test(t) || t.startsWith('[T]')) console.log('PAGE:', t.slice(0, 2000)); });
page.on('pageerror', (e) => console.log('PAGEERR:', e.message));
await page.goto(`http://localhost:${process.env.PORT || 5199}/` + (query || ''), { waitUntil: 'load' });
await page.waitForFunction(() => window.__sim, { timeout: 120000 });
const t0 = Date.now();
const res = await page.evaluate(`(async () => { const sim = window.__sim; const log = (...a) => { const s = a.map((x) => typeof x === 'string' ? x : JSON.stringify(x)).join(' '); console.log('[T] ' + s); }; ${code}; return 'ok'; })()`);
console.log('RESULT', res, ((Date.now() - t0) / 1000).toFixed(0) + ' s');
await browser.close();
