// Strona tytułowa: przeciąganie rogu i środka ramki, liczba wczytań strony
import puppeteer from 'puppeteer-core';
import fs from 'fs'; import os from 'os'; import path from 'path';
const P = process.env.PORT || 5230;
const browser = await puppeteer.launch({ headless: 'new', executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--enable-unsafe-webgpu', '--enable-features=WebGPU', '--disable-gpu-sandbox', '--ignore-gpu-blocklist', '--window-size=1500,950'], protocolTimeout: 0,
  userDataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'w3d-')) });
const page = await browser.newPage();
await page.setViewport({ width: 1500, height: 950 });
const loads = [];
page.on('load', () => loads.push(page.url()));
page.on('pageerror', (e) => console.log('PAGEERR:', e.message));
await page.setRequestInterception(true);
page.on('request', (r) => { if (/open-meteo/.test(r.url())) r.abort(); else r.continue(); });
await page.goto(`http://localhost:${P}/?title`, { waitUntil: 'load' });
await page.waitForSelector('#titleScr.on');
await new Promise((r) => setTimeout(r, 1500));
const q = (s) => page.evaluate(s);
const info = () => q(`[document.getElementById('ttLx').value, document.getElementById('ttLy').value, document.getElementById('ttPlace').textContent].join(' / ')`);
const bb = await (await page.$('#ttMap')).boundingBox();
const cx = bb.x + bb.width / 2, cy = bb.y + bb.height / 2, a = 0.21 * bb.height;
console.log('start', await info());
const drag = async (x0, y0, x1, y1) => { await page.mouse.move(x0, y0); await new Promise((r) => setTimeout(r, 50)); await page.mouse.down(); for (let n = 1; n <= 8; n++) { await page.mouse.move(x0 + (x1 - x0) * n / 8, y0 + (y1 - y0) * n / 8); await new Promise((r) => setTimeout(r, 30)); } await page.mouse.up(); await new Promise((r) => setTimeout(r, 200)); };
await drag(cx + a, cy + a, cx + a + 120, cy + a + 40);      // róg SE w prawo-dół
console.log('po rogu SE', await info());
await drag(cx, cy, cx - 200, cy + 60);                       // cała ramka
console.log('po przesunięciu ramki', await info());
await page.screenshot({ path: 'title5.png' });
console.log('wczytania przed Start:', loads.length);
await q(`document.getElementById('ttFlat').click()`);
await page.waitForFunction(() => !document.getElementById('loadScr').classList.contains('on'), { timeout: 200000 });
await new Promise((r) => setTimeout(r, 1500));
console.log(JSON.stringify(await q(`({ url: location.search, date: document.getElementById('date').value, loc: document.getElementById('location').selectedOptions[0].text, shape: document.getElementById('shape').value, speed: document.getElementById('chipSpeed').textContent, err: document.getElementById('err').textContent })`)));
console.log('wczytania razem:', loads.length, loads.join(' , '));
await browser.close();
